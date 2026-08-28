"use strict";

/**
 * Durable regression coverage for two things left over from the overlay pass
 * (70fae62): the window's real narrow-width floor, and the Glow control's
 * move from a labelled checkbox into the Color/Shape idiom.
 *
 * Everything is measured in a real BrowserWindow with computed geometry —
 * scripts/overlay-narrow-glow-shot.cjs drives the live Shell down to 320px in
 * 11 steps and captures both getBoundingClientRect() numbers and PNGs, in
 * both themes. A source scan cannot see the signature bug here (a
 * more-specific rule wins and a class change paints no pixels), so this test
 * only trusts what actually got laid out on screen.
 *
 * Built with `vite build --mode development` so `import.meta.env.DEV` stays
 * true and the devmock sign-in path renders — see the same note in
 * scripts/three-ui-fixes-test.cjs.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
// A UNIQUE directory per run, not a fixed name in /tmp.
//
// The fixed names raced: this suite fails intermittently in the full chain and
// passes every time in isolation, because a second process running the same
// script would `rmSync` the shots directory out from under this one between
// the mkdir and a `writeFileSync` -- an ENOENT that reads like a broken
// feature and is actually two runs sharing one path. mkdtemp makes the
// collision impossible rather than unlikely.
const RUN = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-narrow-glow-"));
const OUTDIR = path.join(RUN, "dist");
const SHOTS = path.join(RUN, "shots");
const OUT = path.join(RUN, "result.json");

execFileSync("npx", ["vite", "build", "--mode", "development", "--outDir", OUTDIR, "--emptyOutDir"], {
  cwd: ROOT,
  stdio: "ignore",
  timeout: 5 * 60 * 1000,
  env: { ...process.env, NODE_ENV: "development" },
});

const electron = require(path.join(ROOT, "node_modules", "electron"));
execFileSync(electron, [path.join(__dirname, "overlay-narrow-glow-shot.cjs"), OUTDIR, SHOTS, OUT], {
  cwd: ROOT,
  stdio: "inherit",
  timeout: 4 * 60 * 1000,
});

const r = JSON.parse(fs.readFileSync(OUT, "utf8"));

// -- 1. minWidth: main.cjs claims 400 is the real, measured floor -----------
const mainSrc = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
const minWidthMatch = mainSrc.match(/minWidth:\s*(\d+)/);
assert.ok(minWidthMatch, "electron/main.cjs must set a BrowserWindow minWidth");
const minWidth = Number(minWidthMatch[1]);
assert.ok(minWidth <= 400, `main.cjs minWidth (${minWidth}) must be at or below the measured 400px floor`);

const WIDTHS = [980, 900, 800, 700, 600, 520, 480, 440, 400, 360, 320];
for (const w of WIDTHS) {
  const at = r.widths[w];
  assert.ok(at, `width ${w} was not measured`);

  for (const key of ["noRail", "withRail"]) {
    const m = at[key];
    assert.ok(m, `${w}px (${key}): no measurement`);
    assert.ok(m.inner === w, `${w}px (${key}): window did not actually resize (inner=${m.inner})`);
    assert.equal(m.overflow, 0, `${w}px (${key}): layout overflows by ${m.overflow}px — something is clipped`);

    // The roster force-collapses under 880 (Shell.jsx's `tooNarrow`); above
    // that it must stay the full 280px rail, not some new in-between state.
    if (w >= 880) {
      assert.equal(m.collapsed, "false", `${w}px (${key}): sidebar should not be collapsed yet`);
    } else {
      assert.equal(m.collapsed, "true", `${w}px (${key}): sidebar must force-collapse below 880px`);
    }

    // The composer input is the objective "still usable" bar: a window that
    // fits but leaves no room to type is not actually usable at that width.
    if (m.input) {
      assert.ok(m.input.w > 0, `${w}px (${key}): composer input has zero width`);
    }
  }

  // The widest right-hand pane open is the real floor claimed by main.cjs's
  // comment — it must never push the layout into overflow either.
  assert.equal(at.withRail.overflow, 0, `${w}px: rail open must not overflow`);

  if (at.settings) {
    assert.equal(at.settings.overflow, 0, `${w}px: Settings dialog overflows`);
    if (at.settings.open) {
      assert.equal(at.settings.headClipped, false, `${w}px: Settings header text is clipped`);
    }
  }
  if (at.palette) {
    assert.equal(at.palette.overflow, 0, `${w}px: command palette overflows`);
  }
}

// The light-theme spot check at 600px must be just as overflow-free.
assert.ok(r.widths.light600, "light-theme 600px was not measured");
assert.equal(r.widths.light600.overflow, 0, "600px in light theme overflows");

// -- 2. Overlay exclusivity still holds (sanity carried over from 70fae62) --
assert.ok(r.exclusivity, "exclusivity was not measured");
assert.deepEqual(r.exclusivity.afterEscape, [], "Escape must close whatever overlay is open");

// -- 3. Glow is a Color/Shape-style swatch pick, not a checkbox -------------
for (const theme of ["dark", "light"]) {
  const g = r.glow[theme];
  assert.ok(g, `glow field not measured in ${theme}`);
  assert.ok(g.glow, `${theme}: no field labelled "Glow"`);
  assert.ok(g.color, `${theme}: no field labelled "Color"`);
  assert.ok(g.shape, `${theme}: no field labelled "Shape"`);

  // Same group markup as Color/Shape: a .bot-rail__swatches group of
  // pressable buttons, not a .bot-rail__check labelled row.
  assert.equal(g.glow.group, true, `${theme}: Glow must render inside a .bot-rail__swatches group`);
  assert.equal(g.glow.buttons, 2, `${theme}: Glow must offer exactly two pressable faces (off/on)`);
  assert.deepEqual(
    g.glow.pressed.sort(),
    ["false", "true"],
    `${theme}: exactly one of Glow's two buttons must be aria-pressed`
  );

  // Same visual weight as its neighbours: Shape and Glow both render a
  // 36px UmbraFace preview button (bigger than Color's plain 22px dot,
  // by design — a shape/glow choice needs the face to judge it), so Glow
  // is measured against Shape, its actual twin. The field label itself
  // (size, color) must still match Color's exactly — that's the "not as
  // big of a UI ticker" part: a small caption over a row of faces, not a
  // checkbox row with its own bigger type.
  assert.equal(g.glow.firstW, g.shape.firstW, `${theme}: Glow swatch width must match Shape's`);
  assert.equal(g.glow.firstH, g.shape.firstH, `${theme}: Glow swatch height must match Shape's`);
  assert.equal(g.glow.labelSize, g.color.labelSize, `${theme}: Glow's label font-size must match Color's`);
  assert.equal(g.glow.labelColor, g.color.labelColor, `${theme}: Glow's label color must match Color's`);
}

// No leftover "Glow" row in the old checkbox idiom anywhere in the rail.
assert.equal(r.glow.dark.glowCheckboxLabels, 0, "Glow must not also render as a .bot-rail__check row");

// Toggling it must both flip the pressed state and repaint the preview face
// (the halo the umbra glow shader draws), not just change a stored flag.
assert.ok(r.glowToggle, "glow toggle interaction was not measured");
assert.ok(r.glowToggle.onHalos > r.glowToggle.before, "turning Glow on must add a glow halo to the preview face");
assert.equal(r.glowToggle.offHalos, r.glowToggle.before, "turning Glow back off must remove the glow halo again");

// -- 4. Screenshots actually exist for every claimed width ------------------
for (const w of WIDTHS) {
  for (const suffix of ["norail", "rail"]) {
    const p = path.join(SHOTS, `w-${w}-${suffix}.png`);
    assert.ok(fs.existsSync(p) && fs.statSync(p).size > 0, `missing/empty screenshot for ${w}px (${suffix})`);
  }
}
for (const name of ["04-botrail-glow-dark", "05-botrail-glow-light", "w-600-light"]) {
  const p = path.join(SHOTS, `${name}.png`);
  assert.ok(fs.existsSync(p) && fs.statSync(p).size > 0, `missing/empty screenshot ${name}`);
}

console.log(
  `overlay-narrow-glow-test ok — minWidth ${minWidth}px verified overflow-free ` +
    `at ${WIDTHS.join(", ")}px, Glow renders as a Color/Shape-style swatch pick in both themes. ` +
    `Screenshots at ${SHOTS}`
);
