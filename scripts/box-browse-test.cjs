"use strict";

/**
 * The browsing ladder in the AGENTS.md box block, pinned rung by rung.
 *
 * Measured on the real box (bx_843rh875) on 2026-08-27, and written up in
 * docs/BOX.md:
 *
 *   - `box exec` wire cost is 0.45s. Three of them cost 1.50s; the same three
 *     chained into one exec cost 0.59s. The wire is the cheap half — the
 *     expensive half is that a second call is a second whole TURN of a 31 tok/s
 *     model, which is why the block says "one errand, one command".
 *   - `html2text` is already installed at /usr/bin/html2text and strips a 1.0 MB
 *     Wikipedia page to 107 KB of text in 0.1s. Under the same `head -c 2000`
 *     cap, the Hacker News front page yields 1 story as raw HTML and 13 as
 *     text. That is the whole point: the cap spends bytes on answers instead of
 *     markup.
 *   - `google-chrome --headless --dump-dom` renders JavaScript in ~3s and costs
 *     ZERO lux sessions, which matters because lux is capped at 20/day for the
 *     entire team. It silently prints NOTHING if its --user-data-dir is reused,
 *     so the block hands out `$(mktemp -d)`.
 *
 * Each rung is one a model does not reach for on its own. Nothing errors when
 * one goes missing — the teammates just quietly get slower and more expensive,
 * on a model where slow is the whole problem. Hence a test.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const store = fs.readFileSync(path.join(__dirname, "..", "electron", "store.cjs"), "utf8");
const m = /const boxBlock =([\s\S]*?)\n        : "";/.exec(store);
assert.ok(m, "boxBlock not found in store.cjs");
const block = m[1];

// ---- the rungs, in the order a teammate must try them ---------------------
const at = (needle) => {
  const i = block.indexOf(needle);
  assert.notStrictEqual(i, -1, `the browsing ladder must name \`${needle}\``);
  return i;
};
const curl = at("curl -sL");
const text = at("html2text");
const chrome = at("--dump-dom");
const lux = at("lux start");

assert.ok(
  curl < text && text < chrome && chrome < lux,
  "the ladder must read cheapest-first: curl → html2text → headless dump-dom → lux"
);

// The extraction has to happen ON the box, before the bytes cross the wire and
// enter context. `curl | html2text` on the far side is the entire saving.
assert.ok(
  /curl -sL[^`]*\|[^`]*html2text/.test(block),
  "html2text must be piped from curl in one box-side command, not suggested loosely"
);

// A reused --user-data-dir makes headless Chrome exit with EMPTY stdout and a
// zero status: a false negative that reads as "the page is empty". Measured
// twice on the box. The block must hand out a fresh one.
assert.ok(
  /mktemp -d/.test(block),
  "headless Chrome must be given a FRESH --user-data-dir; a reused one silently prints nothing"
);
assert.ok(
  /--headless/.test(block) && /--no-sandbox/.test(block),
  "the dump-dom rung must be spelled out; a half-remembered chrome flag set does not run"
);

// lux is the last rung and a rationed one: 20 sessions a day for the whole
// team, one at a time per box. A step cap keeps a confused session from
// spending the day's budget on one goal.
assert.ok(/--max-steps/.test(block), "the lux rung must cap steps; a runaway session spends the day's budget");
assert.ok(/20\/day|20 a day|20 sessions/.test(block), "the lux rung must name the daily cap");

// ---- one errand, one command ----------------------------------------------
assert.ok(
  /one command|One errand/i.test(block),
  "the block must tell teammates to chain commands rather than make a second box exec"
);

// ---- and the ladder must not grow a cheap-looking dead end ----------------
// `cat` a page, or ask for a screenshot, and the saving is gone.
assert.ok(/screenshot/i.test(block), "screenshots must still be forbidden by name");
assert.ok(!/\blynx\b|\bw3m\b|\bpandoc\b/.test(block), "none of those are installed on the box; html2text is");

console.log("box-browse-test (browsing ladder) ok");

// ---- the wake runs ALONGSIDE the turn, not in front of it ------------------
//
// Measured on the box: `box resume` returns in 0.28s, and the first `box exec`
// that actually answers is 5.9s after it. That whole 5.9s used to be spent
// before the model was allowed to emit its first token, because the turn
// awaited ensureRunning inline. At 31 tok/s the model takes far longer than
// that to write its first command, so the wait was pure wall clock.
//
// Two halves, and both matter. It must NOT be awaited up front, and the finally
// MUST await it before releasing — a hold taken after its release is a machine
// that never stops, which is the expensive direction to be wrong in.
assert.ok(
  !/await box\.ensureRunning\(\{ reason: "turn"/.test(store),
  "the per-turn wake must not be awaited before the model runs: that is 5.9s of dead wall clock"
);
assert.ok(
  /boxWake = box[\s\S]{0,80}\.ensureRunning\(\{ reason: "turn"/.test(store),
  "the per-turn wake must still be started, and kept as a promise"
);
const fin = /\} finally \{[\s\S]*?if \(releaseBox\) releaseBox\(\);/.exec(store);
assert.ok(fin, "the turn must still release its box hold in a finally");
assert.ok(
  /if \(boxWake\) await boxWake;/.test(fin[0]),
  "the finally must await the wake before releasing, or a late hold outlives the turn"
);

console.log("box-browse-test (wake overlaps the turn) ok");
