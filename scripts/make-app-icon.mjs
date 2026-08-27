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

// The blob is BIGGER than the square and crops against it.
//
// That is the whole character of the reference: a face that does not fit, so
// it leans out past the top-left and gets cut by the corner radius. An inset
// blob sitting politely in the middle reads as a logo; one pressed against the
// glass reads as somebody in there.
const S = 1024;
const R = S * 0.2237; // Apple's squircle radius
const SCALE = 0.96; // just under the square, so it crops on two edges only
const K = (S / (He * 2)) * SCALE;
// Low and left, so it crops against the left and bottom edges the way the
// reference does . and the top-right stays open ground, which is what lets the
// thing read as lit rather than as a pale square.
const CX = S * 0.44;
const CY = S * 0.56;

/** A tilted, rounded slit. The reference's eyes are not ellipses. */
function eye(cx, cy, w, h, tilt) {
  return `<rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}"
      width="${w}" height="${h}" rx="${(w / 2).toFixed(1)}"
      transform="rotate(${tilt} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="url(#pupil)"/>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <defs>
    <!-- The ground. Deep, so the glow off the body has something to sit in. -->
    <radialGradient id="ground" cx="42%" cy="38%" r="88%">
      <stop offset="0%"   stop-color="#1B62D6"/>
      <stop offset="45%"  stop-color="#0B3E9E"/>
      <stop offset="100%" stop-color="#041C52"/>
    </radialGradient>

    <!-- The body, lit from the top-left like the reference, falling into
         shadow at the lower right rather than glowing evenly. -->
    <linearGradient id="skin" x1="0.16" y1="0.06" x2="0.82" y2="0.96">
      <stop offset="0%"   stop-color="#FFFFFF"/>
      <stop offset="30%"  stop-color="#E6F3FF"/>
      <stop offset="62%"  stop-color="#A8D6FF"/>
      <stop offset="100%" stop-color="#4E9CF0"/>
    </linearGradient>

    <!-- Eyes are cut to the ground colour, so they read as holes rather than
         as painted dots and survive at 32px. -->
    <linearGradient id="pupil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#0B3F92"/>
      <stop offset="100%" stop-color="#052A6B"/>
    </linearGradient>

    <clipPath id="squircle">
      <rect width="${S}" height="${S}" rx="${R.toFixed(1)}"/>
    </clipPath>

    <filter id="bloom" x="-70%" y="-70%" width="240%" height="240%">
      <feGaussianBlur stdDeviation="${(S * 0.06).toFixed(1)}"/>
    </filter>
    <filter id="tight" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${(S * 0.014).toFixed(1)}"/>
    </filter>
  </defs>

  <g clip-path="url(#squircle)">
    <rect width="${S}" height="${S}" fill="url(#ground)"/>

    <g transform="translate(${CX} ${CY}) scale(${K.toFixed(5)}) translate(${-He} ${-He})">
      <!-- Halo first, twice: one wide pass for the light in the room, one
           tight pass for the edge. A single blur is a smudge. -->
      <path d="${body.path}" fill="#CFE9FF" opacity="0.5" filter="url(#bloom)"/>
      <path d="${body.path}" fill="#EFF8FF" opacity="0.45" filter="url(#tight)"/>
      <path d="${body.path}" fill="url(#skin)"/>

      ${eye(He - 26, He - 4, 30, 74, -13)}
      ${eye(He + 30, He - 12, 26, 62, -13)}
    </g>
  </g>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`icon (${SHAPE}) -> ${OUT}`);
