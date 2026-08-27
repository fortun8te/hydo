// The icon's lit body, as a paint any tint can wear.
//
// scripts/make-app-icon.mjs lights ONE body in ONE blue: a saturated core low
// in the belly, a broad white halo over the crown, a bright rim on the
// silhouette. Its comments record what the near misses looked like — a core at
// cy66/r52 drowned the body in white, cy55/r70 flattened it to uniform cyan
// with a hairline rim — so the ramp shape below is the icon's shipped one
// (cy58 / r64, five stops) rather than a fresh guess.
//
// What changes here is where the colour comes from. The icon hardcodes azure;
// a purple teammate must glow purple, so every stop is MIXED FROM THE TINT'S
// OWN pair (`value` and the kit's bright `from`), and only the white it fades
// to is shared. Pure data in, plain objects out: no React, no DOM, so the
// ramps can be asserted in a node test instead of eyeballed in a screenshot.
//
// The icon reaches its halo with three feGaussianBlur passes. This does not.
// Twelve faces are live in the default window and each one already hands the
// DOM a ~130KB path every frame; a filter re-runs on every one of those frames
// and blurs a region larger than the face. The passes are baked into
// gradients instead — static geometry that never changes with the frame — for
// the same reason the icon bakes its own once at build time.

const HEX = /^#?([0-9a-f]{6})$/i;

function rgb(hex) {
  const m = HEX.exec(String(hex || "").trim());
  if (!m) return [154, 154, 154]; // the roster's grey, so a bad tint still paints
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex(c) {
  return "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/** `t` of `b` laid over `a`, per channel. */
export function mixHex(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  const k = Math.max(0, Math.min(1, t));
  return hex([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * k));
}

const WHITE = "#FFFFFF";

// The icon's five core stops, with its whites turned into "how much white is
// mixed into this tint". Offsets and opacities are the icon's, untouched.
const CORE = [
  { offset: 0, white: 0.0, opacity: 1 },
  { offset: 0.62, white: 0.06, opacity: 0.98 },
  { offset: 0.84, white: 0.5, opacity: 0.6 },
  { offset: 0.95, white: 0.85, opacity: 0.22 },
  { offset: 1, white: 1, opacity: 0 },
];

// The bloom the body throws into the ground around it. In the icon this is the
// "wide" pass — white on blue, because the icon owns its ground. A face does
// not: it sits on whatever surface the app paints, so the bloom carries the
// TINT (a white cloud on a white sidebar is a grey smudge, and on a dark one it
// is a second, colourless blob). Its overall strength is a CSS variable so the
// light theme can pull it down without the geometry changing.
const HALO = [
  { offset: 0, white: 0.24, opacity: 0.55 },
  { offset: 0.5, white: 0.16, opacity: 0.3 },
  { offset: 0.78, white: 0.08, opacity: 0.08 },
  { offset: 1, white: 0.04, opacity: 0 },
];

/**
 * Core, halo and rim for one tint.
 *
 * `value` is the colour the body renders in; `bright` is the kit's upper
 * gradient stop for that tint, and it is what the light is made of — mixing
 * white into the flat body colour alone gave a chalky pastel with no glow in
 * it, because a lit thing gets more SATURATED before it gets whiter, not less.
 */
export function glowPaint(color) {
  const value = (color && color.value) || "#9A9A9A";
  const bright = (color && color.from) || value;
  const lit = mixHex(value, bright, 0.75);
  return {
    core: CORE.map((s) => ({ offset: s.offset, color: mixHex(lit, WHITE, s.white), opacity: s.opacity })),
    halo: HALO.map((s) => ({ offset: s.offset, color: mixHex(lit, WHITE, s.white), opacity: s.opacity })),
    // The body is painted WHITE and the core laid back into its middle, in
    // that order. A tinted body with a white outline drawn on top reads as a
    // sticker, because an outline has a start and an end and light does not —
    // the icon's own note, and the reason `rim` is a fill colour here rather
    // than a stroke.
    rim: WHITE,
  };
}

// Geometry, in the engine's body units, as multiples of the face's extent.
//
// The icon's core sits at cy 58% / r 64% of a tile whose body is cropped by the
// bottom edge. A face is not cropped, so the same ramp is re-expressed against
// the body's own half-extent: a little below centre, reaching just past the
// silhouette.
export const GLOW_GEOM = {
  coreY: 0.18,
  coreR: 1.24,
  haloY: 0.06,
  haloR: 1.62,
};
