// Hydo's app icon: one of the real bodies, glowing through a blue ground.
//
// Built from `blob-kernel.js` rather than drawn by hand, so the icon is the
// SAME silhouette the app renders. If a body is ever retuned, the icon is one
// command away from matching again instead of slowly becoming a lie.
//
//   node scripts/make-app-icon.mjs [shape] [out.svg]
//
// Writes SVG. Rasterise with scripts/rasterize-icon.cjs, which uses the real
// browser rather than a converter, so what ships is what a browser draws.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { al } from "../src/umbra/blob-kernel.js";
import "../src/umbra/shapes-extra.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHAPE = process.argv[2] || "pebble";
const OUT = process.argv[3] || join(HERE, "..", "src", "kit", "images", "hydo-icon.svg");

const body = al[SHAPE];
if (!body) throw new Error(`no such shape: ${SHAPE}. Have: ${Object.keys(al).join(", ")}`);

// The blob RISES FROM THE BOTTOM and is cropped by the square.
//
// That is the whole composition of the reference: a wide dome filling the lower
// three quarters, its crown a quarter of the way down, cut flat by the bottom
// edge. It is not a mark centred in a tile — it is something large, close to
// the glass, that does not fit. The open blue above the crown is what gives the
// glow somewhere to fall, so the top quarter stays empty on purpose.
//
// The placement is DERIVED FROM THE PATH'S OWN BOUNDING BOX, not from `He` and
// a hand-tuned scale. `He` is a half-extent the engine uses for layout and it
// is not the drawn width, so composing against it meant every number here was a
// guess corrected by looking — and a retuned body would silently move the face
// off the tile. Measuring the path puts the crown and the width where they were
// asked for, whatever the body is.
const S = 1024;
const R = S * 0.2237; // Apple's squircle radius

const BOX = (() => {
  const n = body.path.match(/-?\d+(\.\d+)?/g).map(Number);
  const xs = [];
  const ys = [];
  for (let i = 0; i < n.length - 1; i += 2) {
    xs.push(n[i]);
    ys.push(n[i + 1]);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
})();

const WIDTH = 1.06; // just wider than the tile, so it crops left and right
const CROWN = 0.25; // where the top of the dome sits, as a fraction of the tile
const K = (S * WIDTH) / (BOX.x1 - BOX.x0);
const TX = S * 0.5 - ((BOX.x0 + BOX.x1) / 2) * K;
const TY = S * CROWN - BOX.y0 * K;

// Eyes are placed in TILE coordinates, not body coordinates.
//
// They are the part a person actually reads, and their position relative to the
// SQUARE is what the reference fixes — not their position relative to whatever
// silhouette is behind them. Fractions of S, measured off the reference.
const EYE = [
  { cx: 0.417, cy: 0.601, rx: 0.071, ry: 0.105 },
  { cx: 0.653, cy: 0.562, rx: 0.071, ry: 0.112 },
];
const TILT = -7;

/**
 * An eye is a soft vertical OVAL, not a slit.
 *
 * And it is LIGHTER than the body it sits on, not darker — the reference's eyes
 * read as two bright pools rather than as punched holes, which is what keeps
 * the face friendly instead of masked. They are the one place in the icon with
 * a hard edge, so they survive the downscale to 32px that the glow does not.
 */
function eye(e) {
  const cx = e.cx * S;
  const cy = e.cy * S;
  return `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}"
      rx="${(e.rx * S).toFixed(1)}" ry="${(e.ry * S).toFixed(1)}"
      transform="rotate(${TILT} ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="url(#eye)"/>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <defs>
    <!-- The ground is BLUE and bright, lit from the top.
         A vivid azure at the crown falling to a deeper blue at the floor, so
         the tile has a sky and the body has something to rise out of. -->
    <linearGradient id="ground" x1="0.5" y1="0" x2="0.42" y2="1">
      <stop offset="0%"   stop-color="#1B9DF6"/>
      <stop offset="38%"  stop-color="#0F8AEA"/>
      <stop offset="100%" stop-color="#0C7FE6"/>
    </linearGradient>

    <!-- The body is a LIT VOLUME, not a white shape.
         White at the rim and blue-cyan through the middle: the fill below is
         painted white first, then this radial lays the blue back into the
         centre. Doing it in that order is what produces the bright halo edge —
         a body filled blue with a white outline drawn on top always reads as a
         sticker, because the outline has a start and an end and light does
         not. -->
    <radialGradient id="core" cx="50%" cy="63%" r="56%">
      <stop offset="0%"   stop-color="#3BC4FA" stop-opacity="1"/>
      <stop offset="58%"  stop-color="#4ACDFB" stop-opacity="0.98"/>
      <stop offset="80%"  stop-color="#8FDFFD" stop-opacity="0.66"/>
      <stop offset="92%"  stop-color="#D3F1FE" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>

    <!-- Eyes: pale, faintly cool, brighter at the top like a wet surface. -->
    <linearGradient id="eye" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0%"   stop-color="#FFFFFF"/>
      <stop offset="55%"  stop-color="#EAF8FF"/>
      <stop offset="100%" stop-color="#C7ECFF"/>
    </linearGradient>

    <clipPath id="squircle">
      <rect width="${S}" height="${S}" rx="${R.toFixed(1)}"/>
    </clipPath>

    <!-- Three blurs, not one.
         "wide" is the light the body throws into the blue above it, "bloom" is
         the soft shoulder on the silhouette, "edge" is the last bit of lift
         right at the rim. A single Gaussian at any radius gives a smudge at one
         scale and nothing at the others. -->
    <filter id="wide" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="${(S * 0.085).toFixed(1)}"/>
    </filter>
    <filter id="bloom" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="${(S * 0.045).toFixed(1)}"/>
    </filter>
    <filter id="edge" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${(S * 0.009).toFixed(1)}"/>
    </filter>
  </defs>

  <g clip-path="url(#squircle)">
    <rect width="${S}" height="${S}" fill="url(#ground)"/>

    <g transform="translate(${TX.toFixed(2)} ${TY.toFixed(2)}) scale(${K.toFixed(5)})">
      <!-- Glow passes, widest first, all in white so the blue ground shows
           through them rather than being tinted twice. -->
      <path d="${body.path}" fill="#FFFFFF" opacity="0.16" filter="url(#wide)"/>
      <path d="${body.path}" fill="#FFFFFF" opacity="0.46" filter="url(#bloom)"/>
      <path d="${body.path}" fill="#FFFFFF" opacity="0.78" filter="url(#edge)"/>

      <!-- White body, THEN the blue laid back into its middle. See #core. -->
      <path d="${body.path}" fill="#FFFFFF"/>
      <path d="${body.path}" fill="url(#core)"/>

    </g>

    ${EYE.map(eye).join("\n    ")}
  </g>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`icon (${SHAPE}) -> ${OUT}`);
