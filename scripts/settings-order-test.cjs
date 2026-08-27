"use strict";

/**
 * The General pane's row order, and the tokens/sec measurement behind it.
 *
 * Two things are pinned here.
 *
 * 1. ORDER. The pane used to read Chat model → Own hardware → Local endpoint →
 *    harness, i.e. you picked a model before saying whose machine ran it, and
 *    the switch that decides everything sat under the thing it decides. The
 *    order is now the shape of the decision: local or not → which machine →
 *    which model → what does the heavy coding. A future edit that drops a row
 *    back above the switch should fail here, not in someone's eyes.
 *
 * 2. HONESTY of the rate. `contextMgmt.measureRate` must return null — so the
 *    UI renders nothing — for every case where a number would be invented.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const jsx = fs.readFileSync(path.join(root, "src/screens/Settings.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/screens/settings.css"), "utf8");
const contextMgmt = require(path.join(root, "electron/context-mgmt.cjs"));
const modelPick = require(path.join(root, "electron/model-pick.cjs"));

// ── 1. row order ──────────────────────────────────────────────────────────
const ORDER = ["Where turns run", "Local endpoint", "Chat model", "Coding harness", "Timezone"];
let cursor = -1;
for (const label of ORDER) {
  const at = jsx.indexOf(`label="${label}"`);
  assert.ok(at > 0, `Settings.jsx has no row labelled ${label}`);
  assert.ok(at > cursor, `row "${label}" must come after "${ORDER[ORDER.indexOf(label) - 1]}"`);
  cursor = at;
}
// The old label is gone, so nobody re-adds the switch under the model by
// resurrecting the row it used to live in.
assert.equal(jsx.includes('label="Own hardware"'), false, "the switch row is 'Where turns run' now");

// The one genuinely inert row is hidden rather than left clickable: the Grok
// Build model flag does nothing under any other harness, and said so.
assert.ok(
  /\{harness === "grok-build" && \(\s*<Row/.test(jsx),
  "the Grok Build model row must be hidden unless the harness is Grok Build",
);
// The endpoint picker is NOT hidden on hosted — it aims the Local button, so
// it has to be settable before the flip.
assert.ok(
  /\{localList\.length > 1 && \(/.test(jsx),
  "the endpoint row is gated on having more than one endpoint, not on being local",
);

// ── 2. the harness tells the truth about leaving your machine ─────────────
// Established by reading model-pick.agentsModelBlock: the harness is prose in
// AGENTS.md instructing a shell-out, not a router. Grok Build therefore runs
// `grok -p` against xAI even when the chat model is on the user's own box.
const localBlock = modelPick.agentsModelBlock(
  { model: "unsloth/Qwen3.8-Flash-Next-GGUF", provider: "unsloth" },
  { codingHarness: "grok-build" },
);
assert.ok(localBlock.includes("grok --no-auto-update"), "grok-build still shells out to the Grok CLI");
const shellBlock = modelPick.agentsModelBlock({}, { codingHarness: "shell" });
assert.ok(!/grok --no-auto-update/.test(shellBlock), "the shell harness must not invoke grok");
assert.ok(/signs in to xAI/.test(jsx), "the harness row must say Grok Build does not run on your hardware");
assert.ok(/Workspace shell — local/.test(jsx), "the local harness option must be named as local");
// grokCliModel() emits -m only for a grok-* id, so "Same as chat" under a local
// chat model is a promise the code does not keep. The label has to change.
assert.equal(modelPick.grokCliModel("unsloth/Qwen3.8-Flash-Next-GGUF"), "");
assert.equal(modelPick.grokFlag("unsloth/Qwen3.8-Flash-Next-GGUF"), "");
assert.ok(/chatIsGrok \? "Same as chat"/.test(jsx), "the coding-model row must not promise 'same as chat' for a non-Grok id");

// ── 3. the rate is measured, never invented ───────────────────────────────
assert.equal(contextMgmt.outputTokensOf(null), null);
assert.equal(contextMgmt.outputTokensOf({}), null);
assert.equal(contextMgmt.outputTokensOf({ output: 512 }), 512);
assert.equal(contextMgmt.outputTokensOf({ completion_tokens: 280 }), 280);

// Nothing has run yet: no previous mark, so no delta, so no number.
assert.equal(contextMgmt.measureRate(undefined, { output: 280 }, 20450), null);
// A payload with no token counts at all.
assert.equal(contextMgmt.measureRate(0, { context_percent: 12 }, 20450), null);
// Too short / too few tokens to be anything but latency.
assert.equal(contextMgmt.measureRate(0, { output: 4 }, 40), null);
assert.equal(contextMgmt.measureRate(0, { output: 4 }, 9000), null);
assert.equal(contextMgmt.measureRate(300, { output: 300 }, 9000), null);
// A compaction can only ever add output, but guard the negative anyway.
assert.equal(contextMgmt.measureRate(500, { output: 300 }, 9000), null);

// The real shape, from two measured turns against the user's own endpoint:
// 280 completion tokens in 20.45s and 67 in 5.69s.
const a = contextMgmt.measureRate(0, { output: 280 }, 20450);
assert.ok(a && Math.abs(a.rate - 13.7) < 0.1, `expected ~13.7 tok/s, got ${a && a.rate}`);
const b = contextMgmt.measureRate(280, { output: 347 }, 5688);
assert.ok(b && Math.abs(b.rate - 11.8) < 0.1, `expected ~11.8 tok/s, got ${b && b.rate}`);
assert.equal(b.tokens, 67);

// ── 4. the UI refuses a rate it cannot vouch for ──────────────────────────
// All three gates must be in the source: running local, a sample exists, and
// the sample was taken on the endpoint currently shown.
assert.ok(/runningLocal &&/.test(jsx), "the rate must be gated on running local");
assert.ok(/sample\.provider === activeLocal\.id/.test(jsx), "the rate must belong to the shown endpoint");
assert.ok(/tok\/s last turn/.test(jsx), "the rate must be labelled as the last measured turn");
assert.ok(css.includes(".settings__rate"), "the rate needs its own subdued style");

console.log("settings-order-test ok");
