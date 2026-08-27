// Grok's 18 body silhouettes, turned into point outlines the character engine
// can inflate into a body.
//
// The kernel draws every shape in one 0..228.541 box centred on He (114.2705)
// and Grok renders them all through one fixed viewBox, so a teardrop and a hex
// keep their relative sizes. The engine works in a space centred on (0,0), so
// each sampled point is translated by -He and scaled by K.
//
// The path sampler here is plain arithmetic, NOT getPointAtLength. The kernel's
// paths only use M/L/C/Q/Z (verified across all 18), and a hand-rolled walker
// gives byte-identical points in a browser, in Electron and in bare node — which
// is what lets scripts/face-proof.mjs prove the real geometry headless instead
// of proving a fallback.

import { He, al } from "./blob-kernel.js";

// Half-width of the kernel box in engine units: a silhouette that fills Grok's
// box comes out 2 * RIM_R across here.
export const RIM_R = 114;
// Body depth. Slightly deeper than it is wide, which is what gives the turned
// head somewhere to put the eyes.
export const ER_Z = 118;
export const K = RIM_R / He;

const SAMPLES = 192;

// Grok renders every silhouette through ONE fixed viewBox — "-15 -15 259 259"
// around a body that spans 0..228.541 — so the frame is 129.5 kernel units from
// the body centre in every direction and a wide shape (wedge, dome) overhangs
// it rather than being shrunk to fit. That is what keeps a teardrop and a hex
// reading as the same size in a roster.
//
// contentExtent() is per character, so using it would scale each of the 18
// differently. BOX_EXTENT is Grok's frame instead, in engine units, pushed
// through the same perspective divide the engine draws with (character-runtime
// keeps its focal length in `var F = 620`).
const BOX_KERNEL = 129.5;
const FOCAL = 620;


export const BOX_EXTENT = (() => {
  const r = BOX_KERNEL * K;
  return (r * FOCAL) / Math.sqrt(FOCAL * FOCAL - r * r);
})();

// ---------------------------------------------------------------- path sampler

function readNums(src, i) {
  const out = [];
  let n = src.length;
  while (i < n) {
    while (i < n && (src[i] === " " || src[i] === "," || src[i] === "\n" || src[i] === "\t")) i++;
    const c = src[i];
    if (i >= n || !(c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9"))) break;
    let j = i + 1;
    while (j < n) {
      const d = src[j];
      if (d >= "0" && d <= "9") { j++; continue; }
      if (d === ".") { j++; continue; }
      if ((d === "e" || d === "E")) { j++; if (src[j] === "-" || src[j] === "+") j++; continue; }
      break;
    }
    const v = parseFloat(src.slice(i, j));
    if (!Number.isFinite(v)) break;
    out.push(v);
    i = j;
  }
  return [out, i];
}

// Flatten to a dense polyline. Curves are split into fixed pieces; the resample
// below evens them out by arc length, so the piece count only has to be finer
// than the eventual sampling.
const CURVE_STEPS = 24;

function flatten(d) {
  const pts = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  const push = (px, py) => {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last[0] - px) < 1e-9 && Math.abs(last[1] - py) < 1e-9) return;
    pts.push([px, py]);
  };
  let i = 0;
  const n = d.length;
  let cmd = "";
  while (i < n) {
    const ch = d[i];
    if (ch === " " || ch === "," || ch === "\n" || ch === "\t") { i++; continue; }
    if (ch >= "A" && ch <= "Z") { cmd = ch; i++; }
    else if (ch >= "a" && ch <= "z") { cmd = ch; i++; }
    if (cmd === "Z" || cmd === "z") { push(sx, sy); x = sx; y = sy; continue; }
    const [a, ni] = readNums(d, i);
    if (a.length === 0) { i++; continue; }
    i = ni;
    const rel = cmd >= "a";
    const up = cmd.toUpperCase();
    const size = up === "M" || up === "L" ? 2 : up === "C" ? 6 : up === "Q" ? 4 : up === "H" || up === "V" ? 1 : 2;
    for (let k = 0; k + size <= a.length; k += size) {
      const ox = rel ? x : 0, oy = rel ? y : 0;
      if (up === "M") {
        x = a[k] + ox; y = a[k + 1] + oy;
        if (pts.length === 0) { sx = x; sy = y; }
        push(x, y);
        cmd = rel ? "l" : "L";
      } else if (up === "L") {
        x = a[k] + ox; y = a[k + 1] + oy; push(x, y);
      } else if (up === "H") {
        x = a[k] + ox; push(x, y);
      } else if (up === "V") {
        y = a[k] + oy; push(x, y);
      } else if (up === "C") {
        const x1 = a[k] + ox, y1 = a[k + 1] + oy, x2 = a[k + 2] + ox, y2 = a[k + 3] + oy;
        const x3 = a[k + 4] + ox, y3 = a[k + 5] + oy;
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const t = s / CURVE_STEPS, u = 1 - t;
          push(
            u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3
          );
        }
        x = x3; y = y3;
      } else if (up === "Q") {
        const x1 = a[k] + ox, y1 = a[k + 1] + oy, x2 = a[k + 2] + ox, y2 = a[k + 3] + oy;
        for (let s = 1; s <= CURVE_STEPS; s++) {
          const t = s / CURVE_STEPS, u = 1 - t;
          push(u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2);
        }
        x = x2; y = y2;
      } else {
        x = a[k] + ox; y = a[k + 1] + oy; push(x, y);
      }
    }
  }
  return pts;
}

// Even out by arc length so the engine's ring builder gets a uniform rim.
function resample(poly, count) {
  const n = poly.length;
  if (n < 3) return null;
  const seg = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    seg[i] = l;
    total += l;
  }
  if (!(total > 0)) return null;
  const out = [];
  let i = 0, run = 0;
  for (let s = 0; s < count; s++) {
    const target = (s / count) * total;
    while (i < n - 1 && run + seg[i] < target) { run += seg[i]; i++; }
    const a = poly[i], b = poly[(i + 1) % n];
    const t = seg[i] > 0 ? (target - run) / seg[i] : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Sample any SVG path into `count` evenly spaced points. Exported for tests. */
export function samplePath(d, count = SAMPLES) {
  return resample(flatten(String(d || "")), count);
}

// ---------------------------------------------------------------- rims

const rimCache = new Map();

export function shapeIdOf(id) {
  return al[id] ? id : "hex";
}

/** Grok's silhouette for `shapeId`, centred on (0,0) in engine units. */
export function rimFor(shapeId) {
  const id = shapeIdOf(shapeId);
  const hit = rimCache.get(id);
  if (hit) return hit;
  let pts = samplePath(al[id].path, SAMPLES);
  if (!pts) pts = null;
  else {
    pts = pts.map((p) => [(p[0] - He) * K, (p[1] - He) * K]);
    // The engine's ring builder wants one consistent winding and the kernel's
    // paths are not all drawn the same way round.
    if (signedArea(pts) < 0) pts.reverse();
  }
  rimCache.set(id, pts);
  return pts;
}

// The kernel ships per-shape face tuning because a teardrop cannot wear the
// same face as a capsule: x/y shift the pair, sx/sy scale how far the eyes sit
// from centre, eye scales the capsules.
export function faceTune(shapeId) {
  const f = al[shapeIdOf(shapeId)].face || {};
  return {
    x: f.x ?? 0,
    y: f.y ?? 0,
    sx: f.sx ?? 1,
    sy: f.sy ?? 1,
    eye: f.eye ?? 1,
  };
}

// ---------------------------------------------------------------- face numbers
//
// Fitted against the real kit screenshot (screens/01-chat.png) rather than
// guessed. The roster avatars there are ~43px across, so every number below was
// checked by rendering this engine, scaling it to the same body width and
// measuring both images the same way (scratchpad harness, see the report):
//
//                       reference        this spec
//   eye box (of body W)  0.116 x 0.186   0.114 x 0.180
//   centre-to-centre     0.279           0.279
//   pair offset x / y    +0.186 / -0.128 +0.168 / -0.129
//   capsule lean         -19deg          -20deg
//
// The pair sits ABOVE and RIGHT of centre because the head is turned and
// pitched: that is the engine posing a 3D head, not a 2D nudge, which is why
// the eyes stay on the body while it spins.

// Body half-width in engine units is RIM_R, so a percentage of body WIDTH is
// that percentage of 2 * RIM_R.
const W = RIM_R * 2;

export const FACE = {
  // Head yaw/pitch fed to the engine as cfg.turn / cfg.tilt.
  turn: 21,
  tilt: -13.5,
  // Lean of each capsule. SAME sign on both eyes — cfg.eyeAngle would mirror
  // them, which Grok does not do, so it goes on the spec instead.
  eyeAngle: -20,
  eyeW: 0.0640 * W,
  eyeH: 0.1640 * W,
  eyeSp: 0.2965 * W,
  eyeY: -0.2237 * W,
};

/** A createAvatar() spec for a Grok shape id. */
export function specFor(shapeId) {
  const id = shapeIdOf(shapeId);
  const tune = faceTune(id);
  const pts = rimFor(id);
  return {
    id: `grok:${id}`,
    name: id,
    shape: pts ? "rim" : "squircle",
    shapeArgs: pts ? { pts } : {},
    body: "#17191C",
    eye: "#141414",
    er: { x: ER_Z, y: ER_Z, z: ER_Z },
    eyes: {
      w: FACE.eyeW * tune.eye,
      h: FACE.eyeH * tune.eye,
      sp: FACE.eyeSp * tune.sx,
      py: FACE.eyeY * tune.sy + tune.y * K,
      aL: FACE.eyeAngle,
      aR: FACE.eyeAngle,
    },
  };
}
