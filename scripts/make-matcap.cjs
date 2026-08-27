#!/usr/bin/env node
"use strict";

/**
 * Render a chrome matcap.
 *
 * A matcap ("material capture") is a picture of a lit sphere. You look up a
 * pixel by the surface NORMAL at the point you are shading, so all the
 * lighting, the reflections and the falloff come along for free. It is the
 * standard way to get a convincing metal without a renderer, and for a convex
 * body it is not an approximation of a reflection, it IS one.
 *
 * Why generated rather than downloaded: the big public matcap libraries say
 * outright that their textures "were obtained from various websites", which is
 * not a licence. This is rendered here from first principles, so there is
 * nothing to attribute and the material can be tuned.
 *
 * The physics, kept honest:
 *   n     surface normal, straight out of the sphere
 *   v     view vector, (0,0,1), an orthographic camera
 *   r     reflect(-v, n), where the pixel is looking in the environment
 *   env   what it finds there: sky, horizon, floor, two soft area lights
 *   F     Fresnel, Schlick. At grazing angles metal reflects nearly
 *         everything, which is why the rim goes bright instead of dark.
 *
 * Output: PNG, written with zlib. No dependencies.
 *
 *   node scripts/make-matcap.cjs [size] [out.png]
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZE = Number(process.argv[2]) || 256;
const OUT =
  process.argv[3] || path.join(__dirname, "..", "src", "kit", "images", "matcap-chrome.png");

// ── the environment the sphere is standing in ────────────────────────────
//
// A soft studio: bright sky above, a hard horizon, a warm floor, and two area
// lights. The horizon being HARD is what reads as polish — a mirror does not
// blur what it reflects, and a smooth gradient here would give plastic.

// How far to lean from the true reflection toward the surface normal.
// 0 = physically correct and flat-looking; 1 = a plain lit ball with no
// reflection at all. 0.62 keeps the hard horizon and puts it on the face.
const NORMAL_BIAS = 0.62;

const SKY_HI = [0.97, 0.98, 1.0];
const SKY_LO = [0.55, 0.62, 0.72];
const FLOOR_NEAR = [0.86, 0.83, 0.78]; // warm: wood, skin, tungsten
const FLOOR_FAR = [0.17, 0.19, 0.22];
const HORIZON = [0.06, 0.07, 0.09];

/** Two soft rectangular sources, the way a studio actually looks. */
const LIGHTS = [
  { dir: norm([-0.45, 0.72, 0.52]), size: 0.34, power: 1.0 }, // key, upper left
  { dir: norm([0.62, 0.28, 0.44]), size: 0.5, power: 0.34 }, // fill, right
];

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
};

/** What a ray pointing in direction `d` sees. */
function environment(d) {
  const y = d[1];
  let col;
  if (y >= 0) {
    // Sky. Compresses toward the horizon, so most of the visible sky sits in
    // the top of the range and the band near y=0 is thin and dark.
    col = mix(SKY_LO, SKY_HI, Math.pow(y, 0.55));
    // The horizon line itself: narrow and dark, the single most important
    // feature in the whole image.
    col = mix(HORIZON, col, smooth(0.0, 0.085, y));
  } else {
    const t = Math.pow(-y, 0.7);
    col = mix(FLOOR_FAR, FLOOR_NEAR, t);
    col = mix(HORIZON, col, smooth(0.0, 0.1, -y));
  }

  // Area lights, added not mixed: they are emitters.
  for (const L of LIGHTS) {
    const a = clamp01(dot(d, L.dir));
    const hit = Math.pow(a, 2 / (L.size * L.size));
    const s = hit * L.power;
    col = [col[0] + s, col[1] + s, col[2] + s];
  }
  return col;
}

/** Schlick. Chrome's F0 is high and slightly cool. */
const F0 = [0.78, 0.8, 0.83];
function fresnel(cosT) {
  const f = Math.pow(1 - clamp01(cosT), 5);
  return [
    F0[0] + (1 - F0[0]) * f,
    F0[1] + (1 - F0[1]) * f,
    F0[2] + (1 - F0[2]) * f,
  ];
}

/** Linear to sRGB. Skipping this is why hand-tuned metal looks muddy. */
function toSrgb(c) {
  const g = (x) => {
    const v = clamp01(x);
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  };
  return [Math.round(g(c[0]) * 255), Math.round(g(c[1]) * 255), Math.round(g(c[2]) * 255)];
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const half = size / 2;
  const AA = 2; // supersample, or the silhouette is a staircase
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < AA; sy++) {
        for (let sx = 0; sx < AA; sx++) {
          const px01 = ((x + (sx + 0.5) / AA) - half) / half;
          const py01 = ((y + (sy + 0.5) / AA) - half) / half;
          const d2 = px01 * px01 + py01 * py01;
          if (d2 > 1) continue; // outside the sphere
          // Normal. y flipped: image space is down-positive, world is up.
          const n = [px01, -py01, Math.sqrt(1 - d2)];
          const v = [0, 0, 1];
          const nv = dot(n, v);
          // r = reflect(-v, n)
          const refl = [
            2 * nv * n[0] - v[0],
            2 * nv * n[1] - v[1],
            2 * nv * n[2] - v[2],
          ];
          // Sample along a blend of the reflection and the NORMAL.
          //
          // Pure reflection is physically right and looks flat here. On a
          // mirror sphere the ray at the centre points back at the camera, so
          // the whole room compresses into the outer ring and the middle
          // shows only whatever is behind the viewer. Correct for a chrome
          // ball photograph; useless on a 36px character, where the middle is
          // all you can see.
          //
          // Leaning toward the normal sweeps the environment across the
          // visible face instead: the horizon crosses the body, the sky sits
          // on top, the floor bounce underneath. Every stylised matcap does
          // this. It is a deliberate cheat and it is the whole reason this
          // reads as metal at small sizes.
          const dir = norm([
            refl[0] * (1 - NORMAL_BIAS) + n[0] * NORMAL_BIAS,
            refl[1] * (1 - NORMAL_BIAS) + n[1] * NORMAL_BIAS,
            refl[2] * (1 - NORMAL_BIAS) + n[2] * NORMAL_BIAS,
          ]);
          const env = environment(dir);
          const F = fresnel(nv);
          r += env[0] * F[0];
          g += env[1] * F[1];
          b += env[2] * F[2];
          a += 1;
        }
      }
      const i = (y * size + x) * 4;
      if (!a) {
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
        continue;
      }
      const n = AA * AA;
      const [R, G, B] = toSrgb([r / a, g / a, b / a]);
      px[i] = R;
      px[i + 1] = G;
      px[i + 2] = B;
      px[i + 3] = Math.round((a / n) * 255); // coverage = antialiased edge
    }
  }
  return px;
}

// ── PNG, by hand ──────────────────────────────────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(px, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Each scanline is prefixed with its filter byte; 0 = none.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png(render(SIZE), SIZE));
console.log(`matcap ${SIZE}x${SIZE} -> ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)}KB)`);
