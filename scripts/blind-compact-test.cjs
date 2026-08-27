"use strict";

// The blind-compaction cadence must not be a modulo on the message count.
//
// streamThroughHermes has a fallback for backends that never report
// `context_percent`: once a thread is long enough, ask Hermes for the real
// number outright instead of trusting a cache nobody filled. Its own comment
// says why it matters — "a teammate kept for months rides into the context
// wall in silence. A bot you reset weekly never hits this. One you keep does."
//
// It was gated on `turnCount % BLIND_COMPACT_EVERY === 0`, where `turnCount` is
// `state.messages[conv].length`. That counter does NOT step by one, or even
// reliably by two: `splitBubbles` posts a bubble per paragraph, and routine
// notes, events, approvals and clarifies all land in the same array. So whether
// it ever lands on a multiple of 12 is luck, and for a bot that answers in two
// bubbles it never does — the branch is dead for the entire life of that bot.
//
// This test drives a real store to get the real sample sequence, shows the old
// rule never fires on it, and holds the new one (compare against the count we
// last asked at) to firing on the same sequence.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../electron/store.cjs");

// Mirrors the constants at the top of createStore.
const BLIND_COMPACT_AFTER = 24;
const BLIND_COMPACT_EVERY = 12;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-blind-"));

(async () => {
  try {
    // An ordinary teammate that answers in two bubbles.
    const store = createStore({ dir, complete: async () => "First line.\n\nSecond line." });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: "Builder" });

    // `turnCount` as streamThroughHermes samples it: after the user message is
    // pushed, before the reply.
    const samples = [];
    for (let i = 0; i < 40; i++) {
      samples.push(store.getState().messages[id].length + 1);
      await store.send(`hi ${i}`);
    }

    const steps = new Set(samples.slice(1).map((n, i) => n - samples[i]));
    assert.ok(!steps.has(1), "the message count does not step by one — modulo cadence is unsound");

    const oldRule = samples.filter((n) => n >= BLIND_COMPACT_AFTER && n % BLIND_COMPACT_EVERY === 0);
    assert.equal(oldRule.length, 0, "the modulo gate never fires on a real two-bubble thread");

    // The rule that shipped instead.
    let mark = 0;
    const fired = [];
    for (const n of samples) {
      if (n >= BLIND_COMPACT_AFTER && n - mark >= BLIND_COMPACT_EVERY) {
        mark = n;
        fired.push(n);
      }
    }
    assert.ok(fired.length >= 4, `the growth gate fires on the same thread (got ${fired.length})`);
    for (let i = 1; i < fired.length; i++) {
      assert.ok(fired[i] - fired[i - 1] >= BLIND_COMPACT_EVERY, "and never twice in a row");
    }

    // And it is a floor, not a ceiling: a thread that jumps (a routine note, a
    // burst of bubbles) still trips it.
    let m = 0;
    const jumpy = [10, 30, 31, 60].filter((n) => {
      if (n >= BLIND_COMPACT_AFTER && n - m >= BLIND_COMPACT_EVERY) {
        m = n;
        return true;
      }
      return false;
    });
    assert.deepEqual(jumpy, [30, 60], "a jump past the mark is not skipped");

    console.log("blind-compact ok");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
