"use strict";

/**
 * Durable regression coverage for the account-menu restyle (denser rows,
 * lighter/smaller icons, a real exit glyph on Log out, a lifted dark card
 * with a hairline border). Measured in a real BrowserWindow with computed
 * geometry, not asserted from source text — this app's signature bug is a
 * rule that applies its class and changes no pixels because a more-specific
 * one already won, which no grep can see.
 *
 * Before -> after, both measured this way (see the task's final report for
 * the full readout):
 *   row height        36px -> 28px
 *   item padding       9px 10px -> 6px 9px
 *   font-size          14px -> 13px
 *   icon box / font    18px/16px -> 16px/14px
 *   dark card border-color alpha  0.15 -> 0.16 (hairline-strong, not the
 *     generic border-default the base rule falls back to)
 *
 * Built with `vite build --mode development` so `import.meta.env.DEV` stays
 * true and the devmock sign-in path renders (same reasoning as every other
 * *-shot.cjs pair in this repo, e.g. scripts/three-ui-fixes-test.cjs).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { stripComments } = require("./lib/source-scan.cjs");

const ROOT = path.join(__dirname, "..");
const OUTDIR = path.join(os.tmpdir(), "hydo-account-menu-style-dist");
const UD = path.join(os.tmpdir(), "hydo-account-menu-style-ud");
const OUT = path.join(os.tmpdir(), "hydo-account-menu-style-result.json");
const SHOTDIR = path.join(os.tmpdir(), "hydo-account-menu-style-shots");

fs.rmSync(UD, { recursive: true, force: true });

execFileSync("npx", ["vite", "build", "--mode", "development", "--outDir", OUTDIR, "--emptyOutDir"], {
  cwd: ROOT,
  stdio: "ignore",
  timeout: 5 * 60 * 1000,
  env: { ...process.env, NODE_ENV: "development" },
});

const electron = require(path.join(ROOT, "node_modules", "electron"));
execFileSync(electron, [path.join(__dirname, "account-menu-shot.cjs"), OUTDIR, OUT, SHOTDIR], {
  cwd: ROOT,
  stdio: "inherit",
  timeout: 90 * 1000,
});

const r = JSON.parse(fs.readFileSync(OUT, "utf8"));

for (const theme of ["dark", "light"]) {
  const t = r[theme];
  assert.ok(t, `${theme}: account menu was not measured`);

  // -- density: rows visibly tighter than the pre-restyle 36px/"9px 10px" --
  assert.ok(t.settings.height <= 30, `${theme}: Settings row height ${t.settings.height}px must be <= 30px (was 36px)`);
  assert.equal(t.settings.padding, "6px 9px", `${theme}: item padding must be the denser 6px 9px (was 9px 10px)`);
  assert.equal(t.settings.fontSize, "13px", `${theme}: item font-size must be 13px (was 14px)`);

  // -- icons: smaller box than the pre-restyle 18px/16px ------------------
  assert.ok(t.settings.iconWidth <= 16, `${theme}: icon box ${t.settings.iconWidth}px must be <= 16px (was 18px)`);
  assert.equal(t.settings.iconFontSize, "14px", `${theme}: icon font-size must be 14px (was 16px)`);

  // -- the icon class actually resolves to a real glyph, both rows --------
  // (the empty-glyph bug: a class with no matching rule renders a 0x0
  // nothing that looks exactly like this passing by accident)
  assert.notEqual(t.settings.iconContent, "none", `${theme}: Settings icon glyph must resolve (not "none")`);
  assert.notEqual(t.settings.iconContent, '""', `${theme}: Settings icon glyph must resolve to non-empty content`);
  assert.notEqual(t.logout.iconContent, "none", `${theme}: Log out icon glyph must resolve (not "none")`);

  // -- log-out glyph: an exit mark, not the plain forward arrow -----------
  assert.equal(
    t.logout.iconClass,
    "gb-icon gb-icon-arrow-bracket-from-right",
    `${theme}: Log out must use the exit-bracket glyph, not gb-icon-arrow-right ("go forward")`
  );
}

// -- dark card: lifted off flat #1c1c1c, not pure --hy-menu --------------
// color-mix's serialized color() form varies by engine, so parse channels
// out of "color(srgb r g b)" rather than string-comparing against a literal.
const darkBg = r.dark.card.background;
const m = darkBg.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)/);
assert.ok(m, `dark card background should serialize as color(srgb ...) from the color-mix, got: ${darkBg}`);
const [, cr, cg, cb] = m.map(Number);
// pure --hy-menu (#1c1c1c) is 28/255 = 0.1098 per channel; the mix must land
// visibly above that (toward --hy-raised, #2e2e2e = 0.1804) without going
// all the way to it.
assert.ok(cr > 0.112 && cr < 0.181, `dark card background red channel ${cr} must sit between --hy-menu and --hy-raised`);

// -- both themes: a real hairline border, not none/transparent -----------
for (const theme of ["dark", "light"]) {
  assert.match(r[theme].card.border, /^1px solid rgba?\(/, `${theme}: card must keep a real 1px border`);
}

// -- light mode must not have gone dark: card background stays near-white --
const lightM = r.light.card.background.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)/);
assert.ok(lightM, `light card background should serialize as color(srgb ...), got: ${r.light.card.background}`);
const lightR = Number(lightM[1]);
assert.ok(lightR > 0.9, `light mode card must stay a light surface (red channel ${lightR}), not become a dark card on a white app`);

// -- source-scan guards, comments stripped first (four scripts tonight ----
// tripped over the comment explaining the very fix they were checking) --
const jsxStripped = stripComments(fs.readFileSync(path.join(ROOT, "src", "screens", "AccountMenu.jsx"), "utf8"));
assert.ok(
  /gb-icon-arrow-bracket-from-right/.test(jsxStripped),
  "AccountMenu.jsx must reference the exit-bracket icon class outside of comments"
);
assert.ok(
  !/gb-icon-arrow-right["'\s/]/.test(jsxStripped.replace(/gb-icon-arrow-right-(up|down)/g, "")),
  "AccountMenu.jsx must not still use the plain forward arrow (gb-icon-arrow-right) for Log out"
);

// The icon class must actually resolve to a CSS rule (not a 0x0 nothing) —
// checked directly against icons.css so a future rename of the glyph can't
// silently regress into the empty-glyph bug.
const iconsStripped = stripComments(fs.readFileSync(path.join(ROOT, "src", "kit", "icons.css"), "utf8"));
assert.ok(
  /\.gb-icon-arrow-bracket-from-right::before\s*\{\s*content:/.test(iconsStripped),
  "src/kit/icons.css must define a rule for .gb-icon-arrow-bracket-from-right (else it renders as 0x0)"
);

console.log(
  "account-menu-style-test ok — density, icon size, exit glyph, and dark/light card colour all verified in a real window"
);
