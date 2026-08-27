// Six more bodies, built with the kernel's own generators.
//
// Every shape in `al` is `sl(label, pathString)`. `sl` does the rest on its
// own: it re-centres and rescales the path into the shared 228.541 box, walks
// it for a point cloud, then derives the radius, the belt, the horizontal span
// at every height, the turn ring, and the largest ellipse that fits inside
// (which is where the eyes go). So a new body is one path, and it inherits the
// depth slices, the poke hop, the spin and the eye placement for free.
//
// Which is also the constraint: these are drawn with the same four builders the
// original eighteen use, in the same units, so a Pentagon and a Hex are the
// same character wearing a different silhouette. Nothing here introduces a new
// rendering path.
//
//   $ft(points, radius)     polygon with rounded corners; radius may be an
//                           array, applied per-vertex in order
//   U$e(r, n, radius, a0)   regular n-gon of radius r, rounded, rotated to a0
//   H$e(rx, ry, k)          superellipse; k=2 ellipse, k>2 boxy, k<2 pinched
//   Tan(circles)            the union of [x, y, r] circles, as one smooth
//                           outline — metaballs, which is how Cloud is made

import { He, al, sl, $ft, U$e, H$e, Tan } from "./blob-kernel.js";

const TAU = Math.PI * 2;
// Straight up. The kernel's angles run clockwise from east, so every shape
// that should sit on a flat base or point at the ceiling starts here.
const UP = -Math.PI / 2;

/** A star of `points` tips, alternating between two radii. */
function star(points, outer, inner, round) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = UP + (i / (points * 2)) * TAU;
    pts.push([He + Math.cos(a) * r, He + Math.sin(a) * r]);
  }
  // Tips sharper than the valleys: a star with equal rounding everywhere reads
  // as a blurry flower.
  return $ft(pts, round);
}

/** A plus sign: `arm` half-width, reaching `reach` from centre. */
function plus(arm, reach, round) {
  const p = [];
  // One quadrant, mirrored round four times, so the arms cannot drift.
  for (let q = 0; q < 4; q++) {
    const a = UP + (q / 4) * TAU;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const at = (x, y) => [He + x * cos - y * sin, He + x * sin + y * cos];
    p.push(at(-arm, -reach), at(arm, -reach), at(arm, -arm));
  }
  return $ft(p, round);
}

const EXTRA = {
  // Between Hex and Wedge, and the only one of the three that has a flat base
  // with a point on top.
  pentagon: sl("Pentagon", U$e(115, 5, 24, UP)),
  // A square stood on its corner. Gem is a superellipse and stays soft in the
  // middle of each edge; this one is straight-sided.
  diamond: sl("Diamond", U$e(117, 4, 22, UP)),
  star: sl("Star", star(5, 116, 52, [9, 15])),
  // Metaballs, the same construction as Cloud, arranged on the axes instead of
  // scattered. The centre fills in because the lobes overlap.
  clover: sl("Clover", Tan([
    [He, He - 52, 56],
    [He, He + 52, 56],
    [He - 52, He, 56],
    [He + 52, He, 56],
  ])),
  cross: sl("Cross", plus(40, 114, 18)),
  // Wider than tall, which nothing else in the set is: Capsule and Cylinder are
  // both upright, and Tablet is a rounded rectangle rather than a curve.
  oval: sl("Oval", H$e(114, 84, 2.2)),
};

/**
 * Register them.
 *
 * Mutating `al` rather than shipping a second table on purpose: `rims.js`,
 * the face solver and `shapeIdOf` all read `al` directly, and a shape that
 * exists in one table and not the other renders as a silent fallback to Hex.
 * Import order does the rest . every module that touches shapes goes through
 * `rims.js`, which imports the kernel, and this file is imported beside it.
 */
for (const [id, body] of Object.entries(EXTRA)) {
  if (!al[id]) al[id] = body;
}

export const EXTRA_SHAPE_IDS = Object.keys(EXTRA);
export default EXTRA;
