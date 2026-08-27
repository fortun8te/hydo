"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "src", "umbra", "UmbraFace.jsx"), "utf8");

// Every branch writes cfg for its own state, so the frame a state CHANGES on
// used to be a hard cut: spin handed over at turn=712deg / lean=10 and fidget
// wrote turn=8 / lean=1. That snap is the "glitch between stages". There was a
// `wind` easing for exactly one path (morph -> rest) and nothing for the rest.
assert.ok(src.includes("function makeSettle"), "there is a settle layer");
assert.ok(src.includes("SETTLE_MS"), "with a duration");
assert.ok(src.includes("settle.mode !== mode"), "it triggers on a branch change");
assert.ok(src.includes("settle.last"), "and blends from what was actually drawn");

// Every branch must name itself, or a transition out of it is invisible to the
// settle and snaps exactly like before.
for (const m of ["poke", "morph", "spin", "wind", "fidget"]) {
  assert.ok(new RegExp('mode = "' + m + '"').test(src), "the " + m + " branch names itself");
}
assert.ok(/let mode = "rest"/.test(src), "and rest is the default");

// Yaw ACCUMULATES: after three revolutions spin sits at 1080deg. Easing that
// straight to 8deg would visibly unwind three whole turns.
assert.ok(src.includes("function nearestAngle"), "yaw takes the short way round");
const fnSrc = /function nearestAngle[\s\S]*?\n}/.exec(src)[0];
const nearestAngle = new Function(fnSrc + "; return nearestAngle;")();
assert.equal(nearestAngle(1080, 8), 1088, "1080 -> 8 becomes 1088, not three turns back");
assert.equal(nearestAngle(0, 0), 0);
assert.equal(nearestAngle(350, 10), 370, "wraps forward across zero");
assert.equal(nearestAngle(10, 350), -10, "and backward");
for (const pair of [[0, 359], [359, 0], [1080, 45], [-720, 30], [5, 185]]) {
  const d = Math.abs(nearestAngle(pair[0], pair[1]) - pair[0]);
  assert.ok(d <= 180.0001, "short way for " + pair[0] + " -> " + pair[1] + ", got " + d);
}

// hopY blends too, or a poke that ends mid-air drops the body a frame.
assert.ok(/settle\.from\.hopY/.test(src), "the jump height settles as well");

console.log("settle-test ok");
