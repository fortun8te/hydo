// glow-test.cjs — the opt-in glow paint (src/umbra/glow.js) and its wiring.
//
// Two things this guards, both of which were the whole point of the feature:
//
//   1. Every tint glows in ITS OWN colour. The icon this is ported from
//      hardcodes azure, so the easy mistake is a purple blob with a blue halo.
//      The ramps are asserted per tint against the tint's own hue.
//   2. A face WITHOUT `glow` renders exactly what it rendered before the prop
//      existed. UmbraFace is on ~15 screens; a glow that leaks is a redesign of
//      the whole app, not an option.
//
// The paint is asserted by evaluating it; the wiring is asserted against the
// source of UmbraFace.jsx, the same way offscreen-face-test.cjs guards the
// on-screen gate — there is no bundler in `npm test`, and what actually
// reaches a browser was checked with a real BrowserWindow and screenshots.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
let fails = 0;
function ok(name, fn) {
  try {
    fn();
    console.log("ok   " + name);
  } catch (err) {
    fails++;
    console.log("FAIL " + name + " — " + err.message);
  }
}

// ---------------------------------------------------------------- the paint
//
// glow.js is an ES module with no imports of its own, so it is cheap to
// evaluate here without a bundler: strip the `export` keywords and run it.
function loadGlow() {
  const code = fs.readFileSync(path.join(SRC, "umbra", "glow.js"), "utf8").replace(/^export /gm, "");
  const mod = {};
  // eslint-disable-next-line no-new-func
  new Function("exports", code + "\nexports.glowPaint = glowPaint; exports.mixHex = mixHex; exports.GLOW_GEOM = GLOW_GEOM;")(mod);
  return mod;
}

const { glowPaint, mixHex, GLOW_GEOM } = loadGlow();

function rgb(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Which channel dominates, so "is this red glowing red" is answerable. */
function dominant(hex) {
  const [r, g, b] = rgb(hex);
  if (r >= g && r >= b) return "r";
  if (g >= r && g >= b) return "g";
  return "b";
}

// The real tint list, read from marks.js the same way (pure data, no imports).
function loadColors() {
  const code = fs
    .readFileSync(path.join(SRC, "lib", "marks.js"), "utf8")
    .split("export const SHAPES")[0]
    .replace(/^export /gm, "");
  const mod = {};
  // eslint-disable-next-line no-new-func
  new Function("exports", code + "\nexports.COLORS = COLORS;")(mod);
  return mod.COLORS;
}

const COLORS = loadColors();

ok("mixHex interpolates and clamps", () => {
  assert.strictEqual(mixHex("#000000", "#FFFFFF", 0.5).toLowerCase(), "#808080");
  assert.strictEqual(mixHex("#123456", "#FFFFFF", 0).toLowerCase(), "#123456");
  assert.strictEqual(mixHex("#123456", "#FFFFFF", 2).toLowerCase(), "#ffffff");
  // A junk tint must still paint something rather than throwing into a catch
  // that blanks the face.
  assert.match(mixHex("nonsense", "#FFFFFF", 0.5), /^#[0-9a-f]{6}$/i);
});

ok("every tint glows in its own hue", () => {
  for (const c of COLORS) {
    if (c.metal) continue; // chrome is a reflection; glow is off for it by design
    // Chalk and Grey are near-neutral: "which channel dominates" is noise at
    // two units of spread, so hue is only asserted where there is a hue.
    if (Math.max(...rgb(c.value)) - Math.min(...rgb(c.value)) < 12) continue;
    const g = glowPaint(c);
    const core = g.core[0].color;
    assert.strictEqual(
      dominant(core),
      dominant(c.value),
      `${c.id}: core ${core} does not share the dominant channel of ${c.value}`
    );
    assert.strictEqual(dominant(g.halo[0].color), dominant(c.value), `${c.id}: halo is off-hue`);
  }
});

ok("the core is lit, not chalked", () => {
  // The failure mode of "mix white into the body colour" is a pastel with no
  // glow in it. The centre must be BRIGHTER than the flat body and no less
  // saturated, for every tint that has a hue at all.
  for (const c of COLORS) {
    if (c.metal || c.id === "gray" || c.id === "black") continue;
    const core = rgb(glowPaint(c).core[0].color);
    const body = rgb(c.value);
    const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    assert.ok(lum(core) >= lum(body) - 1, `${c.id}: core is darker than the body`);
    const sat = (v) => Math.max(...v) - Math.min(...v);
    assert.ok(sat(core) >= sat(body) * 0.9, `${c.id}: core lost saturation (${sat(core)} vs ${sat(body)})`);
  }
});

ok("the rim is white and the ramps fade out", () => {
  const g = glowPaint(COLORS.find((c) => c.id === "blue"));
  assert.strictEqual(g.rim, "#FFFFFF");
  assert.strictEqual(g.core[g.core.length - 1].opacity, 0);
  assert.strictEqual(g.halo[g.halo.length - 1].opacity, 0);
  // Offsets must climb, or the gradient renders in an order nobody chose.
  for (const ramp of [g.core, g.halo]) {
    for (let i = 1; i < ramp.length; i++) assert.ok(ramp[i].offset > ramp[i - 1].offset, "offsets out of order");
  }
});

ok("the halo reaches past the body and the core sits low", () => {
  assert.ok(GLOW_GEOM.haloR > 1, "halo must spill past the silhouette or it is not a glow");
  assert.ok(GLOW_GEOM.coreR > 1, "core must reach the rim");
  assert.ok(GLOW_GEOM.coreY > 0, "the icon's core is LOW in the belly");
});

// ------------------------------------------------------------- the wiring

const FACE = fs.readFileSync(path.join(SRC, "umbra", "UmbraFace.jsx"), "utf8");

ok("glow is opt-in and defaults off", () => {
  assert.ok(/\n  glow = false,/.test(FACE), "`glow` is not a prop with a false default");
  // Everything glow paints hangs off `glowInk`, and `glowInk` is null unless
  // the prop was passed — so a face nobody asked to glow cannot grow one of
  // these layers by accident.
  assert.ok(/const lit = glow && !isChrome;/.test(FACE), "glow is not gated on the prop");
  assert.ok(/glowInk = useMemo\(\(\) => \(lit \? glowPaint\(color\) : null\)/.test(FACE), "glowInk is not derived from the gate");
  for (const layer of ["uf-glow-halo", "url(#${haloId})", "url(#${coreId})"]) {
    const i = FACE.indexOf(layer);
    assert.ok(i > 0, `missing glow layer: ${layer}`);
  }
  // Body fill, seam stroke and the core path all key off glowInk.
  assert.ok(/fill=\{glowInk \? glowInk\.rim : `url\(#\$\{gradId\}\)`\}/.test(FACE), "the body fill does not fall back to the old gradient");
  assert.ok(/stroke=\{glowInk \? glowInk\.rim : `url\(#\$\{gradId\}\)`\}/.test(FACE), "the seam stroke does not fall back to the old gradient");
  assert.ok(/\{glowInk \? <path d=\{S\.bodyD\} fill=\{`url\(#\$\{coreId\}\)`\} \/> : null\}/.test(FACE), "the core is not painted over a white body");
});

ok("chrome ignores glow", () => {
  // The matcap already contains every light in the scene; lighting it twice is
  // the bug that made metal read as grey plastic (see configFor).
  assert.ok(/const lit = glow && !isChrome;/.test(FACE), "chrome is not excluded");
});

ok("no live filter: glow adds no feGaussianBlur", () => {
  // Twelve faces are live in the default window and each hands the DOM a
  // ~130KB path every frame; a filter would re-blur a larger-than-the-face
  // region on every one of them. The only feGaussianBlur in the file is the
  // engine's pre-existing overlay blur.
  // Rendered elements only: the file's prose names `<feGaussianBlur>` twice
  // while explaining the Skia port and the icon it borrows from.
  const blurs = FACE.match(/<feGaussianBlur\s/g) || [];
  assert.strictEqual(blurs.length, 1, "glow introduced a live blur filter");
  const glowDefs = FACE.slice(FACE.indexOf("{glowInk ? ("), FACE.indexOf("{S.bodyD ? ("));
  assert.ok(!/filter=/.test(glowDefs), "a glow layer points at a filter");
});

ok("the light theme dims the halo rather than moving it", () => {
  const css = fs.readFileSync(path.join(SRC, "styles.css"), "utf8");
  assert.ok(/\.uf-glow-halo/.test(css), "no rule for the halo");
  const light = css.match(/\[data-theme="cursor-light"\][^{]*\.uf-glow-halo\s*\{([^}]*)\}/);
  assert.ok(light, "the light theme does not touch the halo — it reads as a smudge on white");
  assert.ok(/opacity/.test(light[1]) && !/transform|r:|cx|cy/.test(light[1]), "the light override must be opacity only");
});

process.exit(fails ? 1 : 0);
