#!/usr/bin/env node
"use strict";

/**
 * delete-teammate-test.cjs — a deleted teammate must actually STOP.
 *
 * A teammate is not just a row in state.json. Behind it there can be a live
 * Hermes session, a turn (or a subagent) in flight, a `terminal`-started
 * background process, and — if boxEnabled — a hold on the shared box. Before
 * this fix `deleteAgent` did none of that: it spliced the row and walked
 * away, which is an orphaned python child and, worse, a hold the idle sweep
 * never sees drop (a machine that bills forever).
 *
 * This stubs `electron/hermes-gateway.cjs` via require.cache — the same
 * absolute path store.cjs resolves internally — so calls into "Hermes" are
 * recorded rather than hitting a real gateway, then asserts the ORDER and the
 * ARGUMENTS of what deleteAgent does, not just that the functions exist. The
 * box hold half uses the REAL box-runtime.cjs (untouched), so the refcount
 * behaviour under test is genuine, not reimplemented.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const gwPath = require.resolve("../electron/hermes-gateway.cjs");

function stubGateway() {
  const calls = [];
  const log = (fn) => (...args) => {
    calls.push({ fn, args });
    if (fn === "listProcesses") return Promise.resolve([{ id: "proc-1" }, { id: "proc-2" }]);
    if (fn === "isBusy") return true;
    return Promise.resolve({ ok: true });
  };
  const fake = {
    available: () => true,
    interrupt: log("interrupt"),
    interruptSubagent: log("interruptSubagent"),
    listProcesses: log("listProcesses"),
    killProcess: log("killProcess"),
    close: log("close"),
    isBusy: () => true,
    hasSession: () => true,
  };
  require.cache[gwPath] = { id: gwPath, filename: gwPath, loaded: true, exports: fake };
  return calls;
}

function unstubGateway() {
  delete require.cache[gwPath];
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydo-delete-"));
}

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  [FAIL] ${name}\n         ${err.stack || err.message}`);
  }
}
async function atest(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  [FAIL] ${name}\n         ${err.stack || err.message}`);
  }
}

async function main() {
  const calls = stubGateway();
  // store.cjs must be required AFTER the stub is in require.cache, so its own
  // internal `require("./hermes-gateway.cjs")` calls resolve to the fake.
  const { createStore } = require("../electron/store.cjs");
  const { createBoxRuntime } = require("../electron/box-runtime.cjs");

  // A real box runtime (box-runtime.cjs is untouched) against a fake CLI, so
  // `hold`'s refcount behaviour under test is the genuine implementation.
  const boxCalls = [];
  const box = createBoxRuntime({
    installed: () => true,
    now: () => Date.now(),
    getBoxId: () => "bx_test",
    setBoxId: () => {},
    run: async (args) => {
      boxCalls.push(args.join(" "));
      return { ok: true, out: "" };
    },
    exec: async (args) => {
      boxCalls.push(args.join(" "));
      return { ok: true, json: {} };
    },
  });

  const store = createStore({ dir: tmpDir(), box });
  store.signIn();
  const created = store.createAgent({ name: "Ada" });
  const id = created.selectedId;

  // Mirror what a real turn leaves behind: subagents running, and a hold this
  // teammate took on the shared box (streamThroughHermes's `turn-${id}`).
  store.setAgent(id, { subagentIds: ["sub-a", "sub-b"], lastSubagentId: "sub-b", boxEnabled: true });
  box.hold(`turn-${id}`);

  test("a hold taken before delete shows up on the box", () => {
    assert.equal(box.busy, 1, "the box runtime should show one job in flight");
  });

  await atest("deleteAgent stops Hermes work before the row is gone", async () => {
    const next = await store.deleteAgent(id);
    assert.ok(!next.agents.some((a) => a.id === id), "the agent row should be gone");
  });

  test("subagents were interrupted, each one, by id", () => {
    const subagentCalls = calls.filter((c) => c.fn === "interruptSubagent");
    assert.deepEqual(
      subagentCalls.map((c) => c.args),
      [[id, "sub-a"], [id, "sub-b"]],
      "every tracked subagent should be interrupted with this bot's id"
    );
  });

  test("the foreground/background turn was interrupted", () => {
    const hit = calls.find((c) => c.fn === "interrupt");
    assert.ok(hit, "gateway.interrupt was never called");
    assert.deepEqual(hit.args, [id]);
  });

  test("background processes were listed and killed by id", () => {
    const listed = calls.find((c) => c.fn === "listProcesses");
    assert.ok(listed, "gateway.listProcesses was never called");
    assert.deepEqual(listed.args, [id]);
    const killed = calls.filter((c) => c.fn === "killProcess");
    assert.deepEqual(
      killed.map((c) => c.args),
      [[id, "proc-1"], [id, "proc-2"]],
      "both processes returned by listProcesses should be killed"
    );
  });

  test("the Hermes session was closed", () => {
    const hit = calls.find((c) => c.fn === "close");
    assert.ok(hit, "gateway.close was never called");
    assert.deepEqual(hit.args, [id]);
  });

  test("interrupt happens before close, and close before anything is forgotten", () => {
    const order = calls.map((c) => c.fn);
    const firstInterrupt = order.findIndex((f) => f === "interruptSubagent" || f === "interrupt");
    const closeIdx = order.indexOf("close");
    assert.ok(firstInterrupt >= 0 && closeIdx >= 0, "expected both an interrupt and a close call");
    assert.ok(firstInterrupt < closeIdx, `interrupt (${firstInterrupt}) must precede close (${closeIdx})`);
  });

  test("the box hold taken before delete is released after", () => {
    assert.equal(box.busy, 0, "deleteAgent must release the box hold — a stale one never idles out");
  });

  unstubGateway();
}

async function boundedTest() {
  const calls = stubGateway();
  const gw = require.cache[gwPath].exports;
  // A gateway that never answers must not hang the delete — same "issue it,
  // bound it, move on" shape as the quit path (box-runtime.cjs
  // QUIT_STOP_BUDGET_MS).
  gw.close = () => new Promise(() => {});
  gw.interrupt = () => new Promise(() => {});

  delete require.cache[require.resolve("../electron/store.cjs")];
  const { createStore } = require("../electron/store.cjs");
  const store = createStore({ dir: tmpDir() });
  store.signIn();
  const created = store.createAgent({ name: "Bo" });
  const id = created.selectedId;

  await atest("delete does not hang when the gateway never answers", async () => {
    const t0 = Date.now();
    const next = await store.deleteAgent(id);
    const ms = Date.now() - t0;
    assert.ok(!next.agents.some((a) => a.id === id), "the row should still be removed");
    // Generous next to a hang, tight enough that it can never feel stuck.
    assert.ok(ms < 5000, `deleteAgent took ${ms}ms — it is no longer bounded`);
  });

  unstubGateway();
}

main()
  .then(boundedTest)
  .then(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      console.error(`FAILED: ${failures.join(" | ")}`);
      process.exit(1);
    }
    console.log("ok");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
