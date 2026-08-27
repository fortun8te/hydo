#!/usr/bin/env node
"use strict";

/**
 * local-fallback-test.cjs — a message must not be lost because the machine on
 * the user's desk was asleep.
 *
 * The failure this pins, measured before the fix, with the DEAD `lmstudio`
 * entry that is really in ~/.hermes/config.yaml (nothing listening on
 * localhost:1234): `store.send()` sat for 28.1s and posted one bubble reading
 * "API call failed after 3 retries: Connection error." The endpoint was never
 * named, the question was never answered, and the only recovery was to retype
 * it on another provider by hand.
 *
 * Everything below uses REAL sockets for reachability — a listener that is
 * closed for the offline cases, a real HTTP server serving a real
 * `/v1/models` listing for the healthy one — because a mocked probe would
 * prove only that the mock was mocked. Hermes itself is stubbed: the assertion
 * is WHICH provider a turn was handed, which is exactly what the stub can see
 * and a live Hermes cannot report.
 *
 * The four things that must stay true:
 *   1. the user's message is in the transcript either way;
 *   2. a turn that ran somewhere other than where the user chose SAYS so, in
 *      the transcript, in one plain sentence (never a silent substitution);
 *   3. a healthy local endpoint is left completely alone — the fallback is not
 *      a one-way door onto Grok;
 *   4. with nothing to fall back to, it says that too, and does not pretend.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const gwPath = require.resolve("../electron/hermes-gateway.cjs");
const storePath = require.resolve("../electron/store.cjs");
const fallbackPath = require.resolve("../electron/local-fallback.cjs");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  [FAIL] ${name}\n         ${err.stack || err.message}`);
  }
}

/** A port nobody is listening on: bound, its number read, then closed. */
function deadPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** A real OpenAI-compatible `/v1/models` listing, one loaded model. */
function liveServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "local-model", loaded: true }] }));
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

function writeConfig(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-fallback-cfg-"));
  const file = path.join(dir, "config.yaml");
  const lines = ["providers:"];
  for (const [name, api] of Object.entries(entries)) {
    lines.push(`  ${name}:`);
    lines.push(`    api: ${api}`);
    lines.push(`    api_key: sk-test`);
    lines.push(`    default_model: local-model`);
    lines.push(`    transport: chat_completions`);
  }
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

function freshFallback() {
  delete require.cache[fallbackPath];
  return require("../electron/local-fallback.cjs");
}

/**
 * A Hermes that records the provider each turn was built on.
 * `failLocal` makes the FIRST submit throw, which is the desk PC going to
 * sleep mid-stream — the case the preflight cannot catch.
 */
function stubGateway({ failFirstSubmit = false } = {}) {
  const built = [];
  let submits = 0;
  const fake = {
    available: () => true,
    hasSession: () => false,
    TOOL_PROFILES: {},
    storedSessionIdOf: () => "sess-1",
    paceFor: () => ({ local: false, reasoningHonoured: true }),
    fastLaneFor: () => "",
    sessionFor: (botId, opts) => {
      built.push({ provider: opts.provider, model: opts.model });
      return Promise.resolve({ botId, sessionId: "sess-1" });
    },
    resume: () => Promise.reject(new Error("not resumable in this stub")),
    compressIfNeeded: () => Promise.resolve({ compressed: false }),
    submit: (botId, text, handlers) => {
      submits += 1;
      if (failFirstSubmit && submits === 1) {
        return Promise.reject(new Error("Connection error."));
      }
      handlers.onDelta("answered");
      const out = { text: "answered" };
      handlers.onComplete(out);
      return Promise.resolve(out);
    },
  };
  require.cache[gwPath] = { id: gwPath, filename: gwPath, loaded: true, exports: fake };
  return { built, submits: () => submits };
}

function freshStore() {
  delete require.cache[storePath];
  delete require.cache[fallbackPath];
  return require("../electron/store.cjs").createStore;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydo-fallback-"));
}

function threadOf(state, id) {
  return state.messages[id] || [];
}

async function main() {
  console.log("local-fallback-test");

  // ── unit: the decision, against real sockets ───────────────────────────
  const dead = await deadPort();
  const live = await liveServer();

  {
    const file = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    const fb = freshFallback();
    const out = await fb.check("box", { file, hostedReady: () => true });
    await test("a local endpoint with nothing listening routes to the hosted model", () => {
      assert.equal(out.run, "hosted");
      assert.equal(out.provider, "xai-oauth");
      assert.match(out.note, /grok/i);
    });
    await test("the note names the endpoint that was skipped, not just 'an error'", () => {
      assert.ok(out.note.includes("box"), `note must name the provider: ${out.note}`);
      assert.ok(out.note.includes("127.0.0.1"), `note must name the host: ${out.note}`);
    });
  }

  {
    const file = writeConfig({ box: `http://127.0.0.1:${live.port}/v1` });
    const fb = freshFallback();
    const out = await fb.check("box", { file, hostedReady: () => true });
    await test("a local endpoint that answers is left alone", () => {
      assert.deepEqual(out, { run: "local" });
    });
  }

  {
    const file = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    const fb = freshFallback();
    const out = await fb.check("box", { file, hostedReady: () => false });
    await test("with no hosted model signed in it says so instead of inventing one", () => {
      assert.equal(out.run, "none");
      assert.match(out.note, /saved/i);
      assert.ok(!/Answered on/.test(out.note), "must not claim an answer it did not get");
    });
  }

  {
    // A hosted provider is not this module's business: no probe, no rerouting.
    const file = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    const fb = freshFallback();
    const out = await fb.check("xai-oauth", { file, hostedReady: () => true });
    await test("hosted providers are never rerouted", () => {
      assert.deepEqual(out, { run: "local" });
    });
  }

  {
    // Bounded: the probe result is cached, so a burst of turns does not become
    // a poll against a machine that is off.
    const file = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    const fb = freshFallback();
    let probes = 0;
    const probe = async () => {
      probes += 1;
      return { state: "offline", detail: "down" };
    };
    const at = 1_000_000;
    await fb.check("box", { file, probe, hostedReady: () => true, now: () => at });
    await fb.check("box", { file, probe, hostedReady: () => true, now: () => at + 1000 });
    await test("repeat turns inside the cache window do not re-probe a dead port", () => {
      assert.equal(probes, 1, "second turn must reuse the cached verdict");
    });
    await fb.check("box", { file, probe, hostedReady: () => true, now: () => at + 60_000 });
    await test("a stale bad verdict expires, so a woken machine is used again", () => {
      assert.equal(probes, 2);
    });
  }

  // ── the real turn: store.send() with a dead local endpoint ──────────────
  const prevCfg = process.env.HYDO_HERMES_CONFIG;
  const prevAuth = process.env.HYDO_HOSTED_AUTH;
  try {
    process.env.HYDO_HERMES_CONFIG = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    process.env.HYDO_HOSTED_AUTH = "1";
    const { built } = stubGateway();
    const createStore = freshStore();
    const store = createStore({ dir: tmpDir() });
    store.signIn();
    const id = store.createAgent({ name: "Ada" }).selectedId;
    store.setAgent(id, { provider: "box", model: "local-model" });
    store.select(id);
    const state = await store.send("does this survive the box being off?");
    const msgs = threadOf(state, id);

    await test("the user's message is in the transcript even though the box was off", () => {
      assert.ok(
        msgs.some((m) => m.role === "user" && m.text.includes("survive the box being off")),
        "the typed message must never be lost"
      );
    });
    await test("the transcript says, in plain words, that the turn ran elsewhere", () => {
      const note = msgs.find((m) => m.kind === "event" && /instead of box/i.test(m.text || ""));
      assert.ok(note, `expected a substitution note, got ${JSON.stringify(msgs.map((m) => m.text))}`);
      assert.match(note.text, /grok-4\.6/);
    });
    await test("the turn was actually built on the hosted provider, not the dead one", () => {
      assert.ok(built.length, "a session must have been built");
      assert.equal(built[built.length - 1].provider, "xai-oauth");
      assert.equal(built[built.length - 1].model, "grok-4.6");
    });
    await test("and the user got an answer", () => {
      assert.ok(msgs.some((m) => m.role === "bot" && m.text === "answered"));
    });
  } finally {
    delete require.cache[gwPath];
    if (prevCfg == null) delete process.env.HYDO_HERMES_CONFIG;
    else process.env.HYDO_HERMES_CONFIG = prevCfg;
    if (prevAuth == null) delete process.env.HYDO_HOSTED_AUTH;
    else process.env.HYDO_HOSTED_AUTH = prevAuth;
  }

  // ── the dead-control case: a HEALTHY box must still be used ─────────────
  try {
    process.env.HYDO_HERMES_CONFIG = writeConfig({ box: `http://127.0.0.1:${live.port}/v1` });
    process.env.HYDO_HOSTED_AUTH = "1";
    const { built } = stubGateway();
    const createStore = freshStore();
    const store = createStore({ dir: tmpDir() });
    store.signIn();
    const id = store.createAgent({ name: "Ada" }).selectedId;
    store.setAgent(id, { provider: "box", model: "local-model" });
    store.select(id);
    const state = await store.send("run this on my own machine");
    const msgs = threadOf(state, id);
    await test("a healthy local endpoint still runs the turn (no one-way door onto Grok)", () => {
      assert.equal(built[built.length - 1].provider, "box");
      assert.equal(built[built.length - 1].model, "local-model");
    });
    await test("and nothing is announced, because nothing was substituted", () => {
      assert.ok(
        !msgs.some((m) => m.kind === "event" && /instead of/i.test(m.text || "")),
        "a note with no substitution behind it would be its own lie"
      );
    });
  } finally {
    delete require.cache[gwPath];
  }

  // ── mid-turn death: the box slept AFTER the probe said it was fine ──────
  try {
    process.env.HYDO_HERMES_CONFIG = writeConfig({ box: `http://127.0.0.1:${live.port}/v1` });
    process.env.HYDO_HOSTED_AUTH = "1";
    const { built, submits } = stubGateway({ failFirstSubmit: true });
    const createStore = freshStore();
    const store = createStore({ dir: tmpDir() });
    store.signIn();
    const id = store.createAgent({ name: "Ada" }).selectedId;
    store.setAgent(id, { provider: "box", model: "local-model" });
    store.select(id);
    const state = await store.send("die halfway through this one");
    const msgs = threadOf(state, id);
    await test("a turn that dies mid-stream is retried on the hosted model", () => {
      assert.equal(built[built.length - 1].provider, "xai-oauth");
      assert.ok(msgs.some((m) => m.role === "bot" && m.text === "answered"), "the user gets an answer");
    });
    await test("the retry is announced too", () => {
      const note = msgs.find((m) => m.kind === "event" && /Retried on/i.test(m.text || ""));
      assert.ok(note, `expected a retry note, got ${JSON.stringify(msgs.map((m) => m.text))}`);
      assert.match(note.text, /box/);
    });
    await test("the retry is ONE retry, not a loop against a machine that is off", () => {
      assert.equal(submits(), 2, "exactly one local attempt and one hosted attempt");
    });
  } finally {
    delete require.cache[gwPath];
  }

  // ── nothing to fall back to: honest, and the message still stands ───────
  try {
    process.env.HYDO_HERMES_CONFIG = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    process.env.HYDO_HOSTED_AUTH = "0";
    const { built } = stubGateway();
    const createStore = freshStore();
    const store = createStore({ dir: tmpDir() });
    store.signIn();
    const id = store.createAgent({ name: "Ada" }).selectedId;
    store.setAgent(id, { provider: "box", model: "local-model" });
    store.select(id);
    const state = await store.send("no hosted model to save me");
    const msgs = threadOf(state, id);
    await test("with nothing to fall back to, the message is still in the transcript", () => {
      assert.ok(msgs.some((m) => m.role === "user" && m.text.includes("no hosted model")));
    });
    await test("and the app says nothing ran, rather than going quiet", () => {
      const note = msgs.find((m) => m.kind === "event" && /Didn't run this/i.test(m.text || ""));
      assert.ok(note, `expected an explicit refusal, got ${JSON.stringify(msgs.map((m) => m.text))}`);
      assert.match(note.text, /saved/i);
    });
    await test("no turn was submitted anywhere, and no bot bubble was faked", () => {
      assert.equal(built.length, 0, "nothing may be built when there is nowhere to run");
      assert.ok(
        !msgs.some((m) => m.role === "bot" && m.kind === "chat"),
        "a bot bubble here would be an answer nobody gave"
      );
    });
    await test("the bot is not left spinning", () => {
      const a = store.getState().agents.find((x) => x.id === id);
      assert.equal(a.status, "idle");
    });
  } finally {
    delete require.cache[gwPath];
    if (prevCfg == null) delete process.env.HYDO_HERMES_CONFIG;
    else process.env.HYDO_HERMES_CONFIG = prevCfg;
    if (prevAuth == null) delete process.env.HYDO_HOSTED_AUTH;
    else process.env.HYDO_HOSTED_AUTH = prevAuth;
  }

  live.srv.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
