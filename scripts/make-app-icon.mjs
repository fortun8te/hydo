// Hydo's app icon: one of the real bodies, lit from inside.
//
// Built from `blob-kernel.js` rather than drawn by hand, so the icon is the
// SAME silhouette the app renders. If a body is ever retuned, the icon is one
// command away from matching again instead of slowly becoming a lie.
//
//   node scripts/make-app-icon.mjs [shape] [out.svg]
//
// Writes SVG. Rasterise with scripts/rasterize-icon.mjs, which uses the real
// browser rather than a converter, so what ships is what a browser draws.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { He, al } from "../src/umbra/blob-kernel.js";
import "../src/umbra/shapes-extra.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHAPE = process.argv[2] || "pebble";
const OUT = process.argv[3] || join(HERE, "..", "src", "kit", "images", "hydo-icon.svg");

const body = al[SHAPE];
if (!body) throw new Error(`no such shape: ${SHAPE}. Have: ${Object.keys(al).join(", ")}`);

// macOS wants the art inset inside the rounded square, not bleeding to the
// edge — the system adds its own mask and a full-bleed shape reads as clipped.
const S = 1024;
const R = S * 0.2237; // the squircle radius Apple actually uses
const SCALE = 0.62;
const K = (S / (He * 2)) * SCALE;
const CX = S / 2;
const CY = S / 2 + S * 0.012; // a hair low: optical centre sits above true centre

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <defs>
    <!-- The ground. Deep at the corners, brighter behind the body, so the
         square itself looks lit rather than filled. -->
    <radialGradient id="ground" cx="50%" cy="58%" r="72%">
      <stop offset="0%"   stop-color="#3FA9FF"/>
      <stop offset="46%"  stop-color="#1682F5"/>
      <stop offset="100%" stop-color="#0A50C8"/>
    </radialGradient>

    <!-- The body. Light pools at the bottom and falls off upward, which is
         what makes it read as glowing from within rather than lit from above
         like every other icon. -->
    <linearGradient id="skin" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%"   stop-color="#FFFFFF"/>
      <stop offset="34%"  stop-color="#EAF7FF"/>
      <stop offset="72%"  stop-color="#8FD4FF"/>
      <stop offset="100%" stop-color="#3BA8FF"/>
    </linearGradient>

    <filter id="bloom" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="${(S * 0.052).toFixed(1)}"/>
    </filter>
    <filter id="softglow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="${(S * 0.018).toFixed(1)}"/>
    </filter>
  </defs>

  <rect width="${S}" height="${S}" rx="${R.toFixed(1)}" fill="url(#ground)"/>

  <g transform="translate(${CX} ${CY}) scale(${K.toFixed(5)}) translate(${-He} ${-He})">
    <!-- The halo is the body's own shape, blurred, drawn twice. One shape
         blurred once is a smudge; a wide pass plus a tight one gives the
         falloff a real light has. -->
    <path d="${body.path}" fill="#BFE6FF" opacity="0.55" filter="url(#bloom)"/>
    <path d="${body.path}" fill="#EAF8FF" opacity="0.5" filter="url(#softglow)"/>
    <path d="${body.path}" fill="url(#skin)"/>

    <!-- Eyes. Cut from the ground colour, not painted dark: they read as holes
         through to the square behind, which is why they stay legible when the
         icon is 32px in a Dock. -->
    <ellipse cx="${(He - 30).toFixed(1)}" cy="${(He - 6).toFixed(1)}" rx="17" ry="24" fill="#0B5FD0" opacity="0.92"/>
    <ellipse cx="${(He + 30).toFixed(1)}" cy="${(He - 6).toFixed(1)}" rx="17" ry="24" fill="#0B5FD0" opacity="0.92"/>
  </g>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`icon (${SHAPE}) -> ${OUT}`);
