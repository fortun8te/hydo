"use strict";

// Faces that nobody can see must not compute frames.
//
// WHY THIS MATTERED
//
// One animated face is not cheap. Measured in node on the engine's own code
// (blob body, DETAIL 4, the config UmbraFace actually ships):
//
//     computeFrame()  ~0.5ms      svgFrame()  ~2.3ms      total ~3.3ms/frame
//     the body path it produces:  65 depth rings, 12,480 vertices,
//                                 ~133,000 characters of `d`
//
// That `d` is then handed to the DOM every frame, so the browser re-parses and
// re-tessellates 130KB of path data on top of the 3.3ms of JS. At 60fps that is
// roughly a FIFTH of the main thread for a single face. The number of faces
// running at any instant is therefore the largest single lever in the renderer.
//
// And most of them are not on screen. A channel where five teammates are
// working puts a spinning face on the header of every message they send; the
// transcript scrolls, so nearly all of those sit above the fold. The roster
// does the same when the sidebar is scrolled, and everything in it is hidden
// outright when the sidebar is collapsed. All of that was running.
//
// THE ONE RULE THIS TEST EXISTS TO PROTECT
//
// The gate defaults to VISIBLE. An environment that cannot observe — no
// IntersectionObserver, a test renderer, or a document whose intersection
// observations are suspended because it is hidden (which is exactly what a
// backgrounded Electron window does, alongside suspending rAF) — must leave
// every face animating as before. If the default were false, a face would
// freeze wherever the observer never reported, and that failure is invisible
// until someone looks at a mark that has stopped.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const face = fs.readFileSync(path.join(ROOT, "src/umbra/UmbraFace.jsx"), "utf8");

// ---- the gate exists and feeds the loop -----------------------------------
assert.ok(/function useOnScreen\(\)/.test(face), "there is an on-screen gate");
// The gate hands back a CALLBACK ref, not an object ref. UmbraFace renders two
// different <svg> roots and an object ref with a stable `[ref]` dep kept
// observing whichever one committed first, long after it left the DOM.
assert.ok(
  /const \[el, setEl\] = useState\(null\);[\s\S]{0,200}watchSeen\(el, setSeen\), \[el\]\)/.test(face),
  "the gate re-observes when the observed element is swapped"
);
assert.ok(
  /!still && onScreen,/.test(face),
  "the rAF loop only runs when the face is both animating AND on screen"
);
assert.ok(
  /const S = \(!still && onScreen && liveFrame\) \|\| body\.rest\.frame;/.test(face),
  "a paused face paints its cached rest frame, not a body frozen mid-spin"
);

// ---- it fails safe --------------------------------------------------------
assert.ok(
  /const \[seen, setSeen\] = useState\(true\);/.test(face),
  "the gate DEFAULTS TO VISIBLE — see the note above; flipping this freezes faces"
);
assert.ok(
  /typeof IntersectionObserver !== "function"/.test(face),
  "no IntersectionObserver means the face keeps animating"
);

// ---- one observer, not one per face ---------------------------------------
// Same reason there is one rAF for every face rather than one each: a roster
// plus a channel transcript is easily 60 marks.
assert.ok(/let seenIO = null;/.test(face), "the observer is module-wide");
assert.ok(
  (face.match(/new IntersectionObserver\(/g) || []).length === 1,
  "exactly one IntersectionObserver is ever constructed"
);

// ---- and it does not leak -------------------------------------------------
// Both halves: the element stops being observed, and its callback leaves the
// map. Dropping either one keeps a detached <svg> and a React setState alive
// for as long as the observer does.
assert.ok(/seenIO\.unobserve\(el\)/.test(face), "unmount stops observing the element");
assert.ok(/seenFns\.delete\(el\)/.test(face), "unmount drops the callback too");

// ---- the ref is actually on the rendered node ----------------------------
// The component has two return shapes (the blank fallback and the real face)
// and both mount the same ref, or a face that fell back to blank once would
// never be observed again.
assert.equal(
  (face.match(/ref=\{hostRef\}/g) || []).length,
  2,
  "both the blank and the painted <svg> carry the observed ref"
);

console.log("offscreen-face-test OK");

// ---- the frame loop is given every value it reads --------------------------
//
// `useLiveFrame` calls `detailFor(size)`, and for a while `size` was not one of
// its parameters and not module scope. That is a ReferenceError thrown into the
// effect's own `try`, whose `catch` answers by setting the frame to null — so
// every animating face in the app fell back to its rest frame, with no error in
// any console. Measured in a real Electron window: 0 of 5 Home faces moved
// before the fix, 5 of 5 after.
//
// The lesson is not about `size`. It is that a `catch` around a whole animation
// setup turns a typo into a silent, app-wide freeze, so the inputs to that
// block are worth asserting by name.
const sig = /function useLiveFrame\(([^)]*)\)/.exec(face);
assert.ok(sig, "useLiveFrame exists");
assert.ok(
  /\bsize\b/.test(sig[1]),
  "useLiveFrame takes `size` — it calls detailFor(size), and a free `size` freezes every face"
);
assert.ok(
  /\}, \[active, shapeId, stagger, idleSeed, size\]\);/.test(face),
  "the frame effect re-runs when size changes, or a resized face keeps the wrong tessellation"
);
