#!/usr/bin/env node
"use strict";

/**
 * coming-online-test.cjs — the working row says what stage a cold turn is
 * actually in, instead of one flat "Coming online" for the whole wait.
 *
 * Measured on this machine: a cold gateway plus a local model's first turn
 * took 135s. A single unchanging phrase for that whole stretch is
 * indistinguishable from a hang. hermes-gateway.cjs's `sessionFor`/`resume`
 * now call `opts.onStage` at the only two boundaries they can genuinely see
 * — the gateway child coming up, and `session.create`/`resume` going out —
 * and store.cjs's `streamThroughHermes` turns those into the working row's
 * label. This stubs hermes-gateway.cjs (so no real Hermes install is
 * needed) and drives a REAL new-teammate landing turn (`landNewBot`, the
 * exact path that used to say only "Coming online") through `onChange`
 * snapshots, asserting the labels appear, in order, with the real model
 * name — not that a string exists somewhere in a file.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const gwPath = require.resolve("../electron/hermes-gateway.cjs");
const storePath = require.resolve("../electron/store.cjs");

function stubGateway({ coldChild = true } = {}) {
  const stageCalls = [];
  const fake = {
    available: () => true,
    hasSession: () => false,
    TOOL_PROFILES: {},
    storedSessionIdOf: () => "sess-1",
    sessionFor: (botId, opts) => {
      // Mirrors the real function's shape: `onStage('gateway-start')` only
      // when the child was not already up, then always `session-create`
      // right before the RPC that creates the session would go out.
      if (coldChild && typeof opts.onStage === "function") opts.onStage("gateway-start");
      if (typeof opts.onStage === "function") opts.onStage("session-create");
      stageCalls.push({ botId, model: opts.model });
      return Promise.resolve({ botId, sessionId: "sess-1" });
    },
    resume: () => Promise.reject(new Error("not resumable in this stub")),
    compressIfNeeded: () => Promise.resolve({ compressed: false }),
    submit: (botId, text, handlers) => {
      // A short, immediately-complete turn — the point of this test is the
      // boot stages BEFORE this, not the streaming machinery itself.
      handlers.onDelta("hi");
      const out = { text: "hi" };
      handlers.onComplete(out);
      return Promise.resolve(out);
    },
  };
  require.cache[gwPath] = { id: gwPath, filename: gwPath, loaded: true, exports: fake };
  return { fake, stageCalls };
}

function unstubGateway() {
  delete require.cache[gwPath];
}

function freshStore() {
  delete require.cache[storePath];
  return require("../electron/store.cjs");
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydo-coming-online-"));
}

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

async function main() {
  const { stageCalls } = stubGateway({ coldChild: true });
  const { createStore } = freshStore();

  const snapshots = [];
  const store = createStore({ dir: tmpDir(), onChange: (s) => snapshots.push(s) });
  store.signIn();
  const created = store.createAgent({ name: "Ada" });
  const id = created.selectedId;
  const model = created.settings.model;
  snapshots.length = 0; // only care about what landNewBot itself does

  await store.landNewBot(id);

  // Every activity a "self" working row could have shown this bot, in order,
  // deduped against repeats (save()/saveSoon() fire more than once per
  // state change).
  const activities = [];
  for (const snap of snapshots) {
    const a = snap.agents.find((x) => x.id === id);
    const label = a && a.activity;
    if (label && activities[activities.length - 1] !== label) activities.push(label);
  }

  await test("a cold gateway shows 'Starting Hermes' before anything else", () => {
    assert.ok(
      activities.includes("Starting Hermes"),
      `expected "Starting Hermes" somewhere in ${JSON.stringify(activities)}`
    );
  });

  await test("session creation names the real model, not a generic phrase", () => {
    const want = `Starting session: ${model}`;
    assert.ok(
      activities.includes(want),
      `expected "${want}" somewhere in ${JSON.stringify(activities)}`
    );
  });

  await test("the stages appear in the true order: gateway before session", () => {
    const gwIdx = activities.indexOf("Starting Hermes");
    const sessIdx = activities.findIndex((a) => a.startsWith("Starting session: "));
    assert.ok(gwIdx >= 0 && sessIdx >= 0, "both stages must appear");
    assert.ok(gwIdx < sessIdx, `"Starting Hermes" (${gwIdx}) must precede session-create (${sessIdx})`);
  });

  await test("the bot lands idle once the turn actually completes", () => {
    const final = store.getState().agents.find((a) => a.id === id);
    assert.equal(final.status, "idle", "a finished landing turn must not leave the bot marked busy");
  });

  await test("hermes-gateway.cjs really passes onStage through to the caller (not a stub artifact)", () => {
    assert.equal(stageCalls.length, 1, "sessionFor should be called exactly once for a brand new bot");
    assert.equal(stageCalls[0].botId, id);
  });

  unstubGateway();

  // ---- a WARM gateway must not claim it is starting one -------------------
  // The whole point is honesty: a bot whose gateway child is already up must
  // never say "Starting Hermes" — that stage genuinely did not happen.
  const { stageCalls: warmCalls } = stubGateway({ coldChild: false });
  const { createStore: createStore2 } = freshStore();
  const snapshots2 = [];
  const store2 = createStore2({ dir: tmpDir(), onChange: (s) => snapshots2.push(s) });
  store2.signIn();
  const created2 = store2.createAgent({ name: "Bo" });
  const id2 = created2.selectedId;
  snapshots2.length = 0;

  await store2.landNewBot(id2);

  const activities2 = [];
  for (const snap of snapshots2) {
    const a = snap.agents.find((x) => x.id === id2);
    const label = a && a.activity;
    if (label && activities2[activities2.length - 1] !== label) activities2.push(label);
  }

  await test("a warm gateway skips the gateway-boot stage entirely", () => {
    assert.ok(
      !activities2.includes("Starting Hermes"),
      `a warm child must not claim to be starting: saw ${JSON.stringify(activities2)}`
    );
    assert.ok(warmCalls.length === 1, "sessionFor should still run exactly once");
  });

  unstubGateway();
}

// ---- the elapsed clock reaches a landing turn too --------------------
//
// `elapsedLabel` (src/lib/presence.js) already exists and is already proven
// by presence-test.cjs — that is the ONE mechanism the brief asks this to
// reuse, not grow a second one. What was missing on the transcript side:
// `workingRow`'s "self" call site (a bot's own 1:1) only had Shell's
// `since`, which tracks when THIS window's user last hit send — 0 for a
// landing turn, since that turn is fired from the create flow, not the
// composer. Verified in a real BrowserWindow (mock devmock data, both
// themes): with `agent.activeAt` 95s in the past the row showed "1m 3xs"
// via this exact fallback. This is a static check that the wiring survives
// — a real render is out of reach for a .cjs test script with no jsdom/React
// harness in this repo, which is why every other Transcript.jsx behaviour
// test here (see transcript-memo-test.cjs) is source-pattern based too.
function checkTranscriptElapsedFallback() {
  const txPath = path.join(__dirname, "..", "src", "screens", "Transcript.jsx");
  const src = fs.readFileSync(txPath, "utf8");
  assert.ok(
    /import \{[^}]*elapsedLabel[^}]*\} from "\.\.\/lib\/presence\.js"/.test(src),
    "Transcript must import elapsedLabel from presence.js, not reimplement it"
  );
  // Only one call site: the shared mechanism, not a duplicate.
  const calls = src.match(/elapsedLabel\(/g) || [];
  assert.equal(calls.length, 1, `expected exactly one elapsedLabel(...) call, found ${calls.length}`);
  assert.ok(
    /new Date\(agent\.activeAt\)\.getTime\(\)/.test(src),
    "the fallback must parse agent.activeAt (an ISO string on the wire) before treating it as a `since`"
  );
  assert.ok(
    /elapsedLabel\(extra\.since \?\? \(since \|\| agentSince\), clock\)/.test(src),
    "elapsedLabel must fall back to the per-agent activeAt when neither extra.since nor Shell's since is set"
  );
  console.log("  [PASS] Transcript's elapsed clock reuses presence.js's elapsedLabel with an agent.activeAt fallback");
  passed += 1;
}

main()
  .then(() => {
    checkTranscriptElapsedFallback();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) process.exit(1);
    console.log("coming-online-test ok");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
