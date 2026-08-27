"use strict";

// The body <-> three-dots trade, which a teammate performs every time it
// starts and stops writing.
//
// What was wrong: the effect bailed on `!dots`, so becoming the dots was
// animated and coming back was a hard cut. And <Dots> mounted the instant
// `dots` went true while the body stayed for the whole morph, so for ~340ms
// both were drawn at full opacity on top of each other instead of trading.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const face = fs.readFileSync(path.join(ROOT, "src/umbra/UmbraFace.jsx"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");

// ---- both directions animate ---------------------------------------------
assert.ok(face.includes("const DOTS_MS"), "the trade has its own duration");
assert.ok(
  !/if \(!dots \|\| reduced\) return undefined;/.test(face),
  "the effect must not bail on leaving the dots . that was the hard cut"
);
assert.ok(
  /setDotsPhase\(dots \? "in" : "out"\)/.test(face),
  "entering and leaving are both phases"
);

// ---- the dots outlive `dots` going false ---------------------------------
// Without this the body has nothing to cross-fade against on the way back.
assert.ok(
  face.includes('dots || dotsPhase === "out"'),
  "Dots stays mounted through the leaving animation"
);
assert.ok(
  face.includes("!(dots && !dotsPhase)"),
  "the body stays mounted for the whole trade, in both directions"
);

// ---- the wrapper exists, and is a WRAPPER --------------------------------
// The pose groups carry `transform` as an attribute; a CSS transform on the
// same element replaces it and flattens the face for the length of the
// animation. `.uf-body` must therefore have no transform of its own.
const wrapper = face.match(/<g className=\{dotsPhase \? `uf-body is-\$\{dotsPhase\}` : undefined\}>/);
assert.ok(wrapper, "the body is wrapped in a bare, animatable group");
const afterWrapper = face.slice(face.indexOf(wrapper[0]) + wrapper[0].length, face.indexOf(wrapper[0]) + wrapper[0].length + 200);
assert.ok(
  afterWrapper.includes("transform={`translate("),
  "the posed group is INSIDE the wrapper, not the wrapper itself"
);

// ---- the CSS it depends on actually ships --------------------------------
for (const rule of [
  ".umbra-face .uf-body",
  ".umbra-face .uf-body.is-in",
  ".umbra-face .uf-body.is-out",
  ".umbra-face .uf-dots.is-in circle",
  ".umbra-face .uf-dots.is-out circle",
]) {
  assert.ok(css.includes(rule), `styles.css defines ${rule}`);
}
for (const kf of ["uf-body-out", "uf-body-in", "uf-dot-in", "uf-dot-out"]) {
  assert.ok(css.includes(`@keyframes ${kf}`), `keyframes ${kf}`);
}
// Origin at each element's own centre, or the body collapses toward the SVG's
// top-left corner instead of toward itself.
assert.ok(/\.uf-body \{[^}]*transform-box: fill-box/s.test(css), "body scales about itself");
assert.ok(/\.uf-dots circle \{[^}]*transform-box: fill-box/s.test(css), "each dot scales about itself");
assert.ok(css.includes("prefers-reduced-motion"), "the trade is skippable");

// ---- the stagger reverses ------------------------------------------------
assert.ok(
  face.includes('phase === "in" ? i + 1 : 1 - i'),
  "left to right in, right to left out . one gesture reversing, not two animations"
);

console.log("dots-morph-test ok");
