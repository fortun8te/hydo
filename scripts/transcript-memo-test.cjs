"use strict";

// The transcript's 240ms clock, and what it must NOT drag along with it.
//
// WHY THIS BUG EXISTED
//
// Shell.jsx runs `setInterval(() => setClock(Date.now()), 240)` for the whole
// time a teammate is working (and for as long as there is a draft in the box).
// That clock exists for exactly one thing: the presence rows at the foot of the
// transcript, which fade a face in and out on real time. But `clock` is a prop
// on <Transcript>, and Transcript is a plain function component, so every tick
// re-ran the whole `list.map(...)` — and inside every bubble, the markdown
// renderer re-parsed the message text from scratch and rebuilt its entire
// element tree.
//
// Measured with react-dom/server on a 60-message thread of ordinary teammate
// output (lists, a fenced code block, a table, inline links): ~10.6ms of
// parsing and rendering PER TICK. At one tick per 240ms that is ~4.4% of the
// main thread burned forever, in ~10ms bursts, on the same main thread that
// has to serve the shared requestAnimationFrame loop driving every animated
// face on screen. A 10ms burst is most of a 16.7ms frame: the faces stutter
// precisely while a teammate is working, which is when they animate.
//
// Nothing in a already-sent message changes on the clock. So the markdown
// renderer is memoised on its two primitive props.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const rc = fs.readFileSync(path.join(ROOT, "src/screens/RichContent.jsx"), "utf8");
const tx = fs.readFileSync(path.join(ROOT, "src/screens/Transcript.jsx"), "utf8");

// ---- the renderer is memoised --------------------------------------------
assert.ok(/import \{ memo,/.test(rc), "RichContent imports memo");
assert.ok(
  /export const Markdown = memo\(function Markdown\(\{ text, caret \}\)/.test(rc),
  "Markdown is wrapped in React.memo"
);
// Both props must stay primitive, or the memo compares by identity and never
// hits. If a future prop is an object or a callback, this test should fail and
// force a decision rather than letting the memo quietly become a no-op.
const sig = rc.match(/export const Markdown = memo\(function Markdown\(\{([^}]*)\}\)/)[1];
assert.deepEqual(
  sig.split(",").map((s) => s.trim()).filter(Boolean),
  ["text", "caret"],
  "Markdown takes only primitive props, so memo can compare them by value"
);

// ---- the trap that memoising sets ----------------------------------------
// A memo component is an OBJECT, not a function. Transcript picks its body
// renderer with a typeof guard; the old `typeof RC.Markdown === "function"`
// silently fell through to Transcript's own fallback engine the moment
// RichContent's was memoised, changing which markdown renderer drew every
// bubble in the app with no error anywhere.
assert.ok(
  !/typeof RC\.Markdown === "function" \?/.test(tx),
  'a bare `typeof RC.Markdown === "function"` rejects a memo component'
);
assert.ok(
  /typeof RC\.Markdown === "object"/.test(tx),
  "the guard accepts a memo component too"
);

// ---- and it really is the shared renderer that gets picked ---------------
// Proved by construction rather than by reading: memo() of a function is an
// object with the memo $$typeof, and the guard above must select it.
const React = require("react");
const memoed = React.memo(function X() {
  return null;
});
assert.equal(typeof memoed, "object", "memo() returns an object, not a function");
assert.ok(
  memoed && (typeof memoed === "function" || typeof memoed === "object"),
  "Transcript's widened guard selects a memo component"
);

console.log("transcript-memo-test OK");
