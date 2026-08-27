"use strict";

// Geometry detail, chosen from the size a face is actually drawn at.
//
// `detail` multiplies the mesh — meridians are round(12 * detail), and the rim
// resolution scales with it. At 4 that is 48 meridians, and the path string
// handed to the DOM every frame for ONE 36px avatar measured ~195,000
// characters: a mesh nobody can see at that size, rebuilt every frame, on
// every face in the roster. Measured after: 48,796.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const face = fs.readFileSync(path.join(ROOT, "src/umbra/UmbraFace.jsx"), "utf8");

// ---- the ladder is stepped, not continuous -------------------------------
// getGeometry caches on `shape|dense|detail`, so a continuous function would
// build and keep a separate mesh for every pixel size in the app.
const m = /function detailFor\(size\) \{([\s\S]*?)\n\}/.exec(face);
assert.ok(m, "detailFor exists");
const body = m[1];
const levels = [...body.matchAll(/return (\d)/g)].map((x) => Number(x[1]));
assert.ok(levels.length <= 4, `a small number of levels, got ${levels.length}`);
assert.ok(levels.includes(4), "full size still gets the full mesh");

// Evaluate it for real rather than reading the source.
// eslint-disable-next-line no-new-func
const detailFor = new Function("size", body.replace(/^\s*\/\/.*$/gm, ""));
assert.equal(detailFor(36), 2, "a roster row is the cheap mesh");
assert.equal(detailFor(22), 2);
assert.equal(detailFor(72), 3, "the bot rail's mark sits between");
assert.equal(detailFor(160), 4, "the lab keeps everything");
// Monotonic: a bigger face must never get a coarser mesh than a smaller one.
for (let a = 8; a < 400; a += 7) {
  assert.ok(detailFor(a + 7) >= detailFor(a), `not monotonic around ${a}`);
}
// Junk must not silently become the most expensive setting.
for (const junk of [null, undefined, NaN, -10, "abc", {}]) {
  const v = detailFor(junk);
  assert.ok(v >= 2 && v <= 4, `junk size gives a sane detail: ${v}`);
}

// ---- every avatar is built at a size-derived detail ----------------------
// Three creation sites. Two take the component's own size; the third is
// stillFrame, which takes the detail its cache was keyed on. One site left on
// the fixed constant would make a face swap mesh as it morphed.
const sites = face.match(/createAvatar\(.*$/gm) || [];
assert.equal(sites.length, 3, `three creation sites, got ${sites.length}`);
for (const line of sites) {
  assert.ok(
    /detailFor\(size\)\)\s*;?\s*$/.test(line) || /,\s*detail\)\s*;?\s*$/.test(line),
    `builds at a derived detail, not a constant: ${line.trim()}`
  );
}
assert.ok(
  !/createAvatar\([^\n]*DETAIL\)/.test(face),
  "nothing still builds at the fixed constant"
);

// ---- the rest-frame cache is keyed on detail -----------------------------
// It caches GEOMETRY. One built at detail 2 must never be handed to a face
// drawing at 4, which a key of shape|motion alone would happily do.
assert.ok(
  /function stillFrame\(shapeId, motionId, detail/.test(face),
  "stillFrame takes a detail"
);
assert.ok(
  /const key = shapeId \+ "\|" \+ motionId \+ "\|" \+ detail;/.test(face),
  "and the cache key includes it"
);

console.log("face-detail-test ok");
