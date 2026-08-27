"use strict";

/**
 * The avatar crop, and why it is not centred.
 *
 * A phone portrait is about 3:4 and its subject's head sits in the upper third,
 * so the MIDDLE square of one is the torso. Fed a real 960x1280 photo, the
 * centred version produced an avatar of a black t-shirt with the face clipped
 * off the top: technically the picture, useless at 32px in a sidebar.
 *
 * These are pure-geometry checks against the same numbers the canvas draw uses,
 * so they run without a DOM. The visual result was confirmed separately by
 * running the real `fileToAvatar` on a real photo in an Electron window.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "src/lib/avatar.js"), "utf8");

// The bias must be applied to the TOP offset, not the left one — biasing the
// horizontal axis would just shove every face off to one side.
assert.ok(
  /const overflowY = img\.naturalHeight - side;/.test(src),
  "the vertical overflow is named, so the bias is obviously vertical"
);
assert.ok(
  /overflowY \* 0\.18/.test(src),
  "tall images crop 18% down from the top, not 50%"
);
assert.ok(
  /\(img\.naturalWidth - side\) \/ 2/.test(src),
  "horizontal stays centred"
);

// Degrades safely on the shapes that have no choice to make.
const topFor = (w, h) => (h - Math.min(w, h)) * 0.18;
assert.strictEqual(topFor(800, 800), 0, "a square image has no overflow to bias");
assert.strictEqual(topFor(1600, 900), 0, "a landscape image's short side IS the height");
assert.ok(topFor(960, 1280) > 0, "a portrait moves up");

// And the bias must never push the crop off the bottom of the image.
for (const [w, h] of [[960, 1280], [1080, 1920], [700, 701], [400, 4000]]) {
  const side = Math.min(w, h);
  const top = (h - side) * 0.18;
  assert.ok(top >= 0, `crop starts inside the image (${w}x${h})`);
  assert.ok(top + side <= h + 1e-9, `crop ends inside the image (${w}x${h})`);
}

// The store validates what this produces; the shapes must agree or every save
// silently blanks the picture.
const store = fs.readFileSync(path.join(ROOT, "electron/store.cjs"), "utf8");
const validator = /data:image\\\/\(png\|jpeg\|webp\)/.test(store);
assert.ok(validator, "store still validates png/jpeg/webp");
assert.ok(
  /toDataURL\("image\/png"\)/.test(src) && /toDataURL\("image\/jpeg"/.test(src),
  "and the encoder only ever emits types that validator accepts"
);

console.log("avatar-test ok");
