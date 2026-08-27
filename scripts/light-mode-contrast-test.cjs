// light-mode-contrast-test.cjs — computed (not eyeballed) contrast ratios for
// the text tiers used on real content, in both themes.
//
// This session's light-mode pass found `.hy-botcreate__to` (the "To:" label
// in New Bot) painted with --hy-text-faint, which is 2.74:1 against
// --sand-bg-base in light mode — under the 3:1 floor for large/secondary
// text, and it is neither a placeholder nor a disabled control, so it isn't
// exempt. It was switched to --hy-text-muted (4.4:1+ in both themes). This
// guards two things: that regression, and the general claim that the named
// "real content" text tiers clear their bars against the base surface.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
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

// ---- parse the two theme blocks out of tokens.css --------------------------
const tokensSrc = fs.readFileSync(path.join(ROOT, "src", "kit", "tokens.css"), "utf8");

function blockFor(selectorRe) {
  const m = tokensSrc.match(selectorRe);
  assert.ok(m, "could not find theme block " + selectorRe);
  const start = m.index + m[0].length;
  const end = tokensSrc.indexOf("}", start);
  return tokensSrc.slice(start, end);
}

function varsIn(block) {
  const map = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    map[m[1]] = m[2].trim();
  }
  return map;
}

// hy-* tokens live in their own later `:root, [data-theme='cursor-light']` /
// `[data-theme='cursor-dark']` blocks (see the "Surfaces the app hardcoded"
// section) — separate from the generated --sand-* / --cursor-* blocks above,
// so light needs two source blocks merged (later one wins, matching cascade).
function themeVars(theme) {
  const blocks =
    theme === "light"
      ? [
          blockFor(/:root,\s*\[data-theme='cursor-light'\]\s*\{/),
          ...[...tokensSrc.matchAll(/:root,\s*\[data-theme='cursor-light'\]\s*\{/g)].map((m) => {
            const start = m.index + m[0].length;
            return tokensSrc.slice(start, tokensSrc.indexOf("}", start));
          }),
        ]
      : [...tokensSrc.matchAll(/\[data-theme='cursor-dark'\](?:,\s*:root\[data-theme='cursor-dark'\])?\s*\{/g)].map(
          (m) => {
            const start = m.index + m[0].length;
            return tokensSrc.slice(start, tokensSrc.indexOf("}", start));
          }
        );
  const merged = {};
  for (const b of blocks) Object.assign(merged, varsIn(b));
  return merged;
}

// ---- colour math -------------------------------------------------------
function hexToRgb(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  const n = parseInt(hex.slice(0, 6), 16);
  const alpha = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: alpha };
}

function mixOverWhiteOrBg(fgHex, bgHex) {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  };
}

function relLum({ r, g, b }) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fgHex, bgHex) {
  const fg = mixOverWhiteOrBg(fgHex, bgHex);
  const bg = hexToRgb(bgHex);
  const L1 = relLum(fg);
  const L2 = relLum(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

// ---- assertions ----------------------------------------------------------
// Tiers that paint REAL content (not placeholders, not disabled controls),
// checked against the base app surface in each theme. Bars per the brief:
// 4.5:1 body, 3:1 large/secondary.
const CASES = [
  { name: "sand-text-primary (body)", token: "sand-text-primary", bg: "sand-bg-base", min: 4.5 },
  { name: "sand-text-secondary (meta)", token: "sand-text-secondary", bg: "sand-bg-base", min: 4.5 },
  { name: "hy-text-muted (caption tier)", token: "hy-text-muted", bg: "sand-bg-base", min: 3 },
];

for (const theme of ["light", "dark"]) {
  const vars = themeVars(theme);
  for (const c of CASES) {
    ok(`${c.name} — ${theme}`, () => {
      const fg = vars[c.token];
      const bg = vars[c.bg];
      assert.ok(fg, `--${c.token} not defined for ${theme}`);
      assert.ok(bg, `--${c.bg} not defined for ${theme}`);
      const r = ratio(fg, bg);
      assert.ok(r >= c.min, `${r.toFixed(2)}:1 is under the ${c.min}:1 floor (fg=${fg} bg=${bg})`);
    });
  }
}

// ---- the specific regression: the "To:" label ----------------------------
const productionRaw = fs.readFileSync(path.join(ROOT, "src", "screens", "production.css"), "utf8");
// Strip comments first — the fix's own comment names the token it moved away
// from, which would otherwise self-trigger the "did it regress" check below.
const production = productionRaw.replace(/\/\*[\s\S]*?\*\//g, "");
ok('.hy-botcreate__to uses --hy-text-muted, not --hy-text-faint', () => {
  const m = production.match(/\.hy-botcreate__to\s*\{[^}]*\}/);
  assert.ok(m, "could not find .hy-botcreate__to rule");
  assert.ok(m[0].includes("--hy-text-muted"), "still painted with a sub-3:1 tier");
  assert.ok(!m[0].includes("--hy-text-faint"), "--hy-text-faint regressed back in");
});

console.log(fails ? `\n${fails} failed` : "\nlight-mode-contrast-test ok");
process.exit(fails ? 1 : 0);
