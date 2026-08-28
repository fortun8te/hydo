#!/usr/bin/env node
"use strict";

/**
 * bubble-contrast-test.cjs — the user's own words must be readable.
 *
 * MEASURED: the user bubble in dark mode was #141414 text on #5a5a5a fill,
 * a contrast ratio of 2.67:1 — under the 4.5:1 floor, and the washed-out grey
 * the user reported by screenshot.
 *
 * The cause was token reuse rather than a colour anyone picked: the bubble
 * borrowed `--sand-text-on-primary`, which is correct for the primary FILL
 * (light in dark mode, so dark text on it) and wrong for a mid-grey pill. The
 * two surfaces only looked interchangeable in one theme.
 *
 * This computes the real WCAG ratio from the real tokens, so a future palette
 * edit that breaks it fails here rather than in a screenshot.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}

const root = path.join(__dirname, "..");
const tokens = fs.readFileSync(path.join(root, "src", "kit", "tokens.css"), "utf8");
const production = fs.readFileSync(path.join(root, "src", "screens", "production.css"), "utf8");

/** Every value a token takes, in source order: [light, dark] for this file. */
function valuesOf(name) {
  const out = [];
  const re = new RegExp(`--${name}:\\s*([^;]+);`, "g");
  let m;
  while ((m = re.exec(tokens))) out.push(m[1].trim());
  return out;
}

const lum = (hex) => {
  const h = hex.replace("#", "");
  const c = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const fills = valuesOf("sand-fill-bubble-user").filter((v) => v.startsWith("#"));
const texts = valuesOf("sand-text-bubble-user").filter((v) => v.startsWith("#"));

test("the user bubble has its own text token, in both themes", () => {
  assert.equal(texts.length, 2, `expected a light and a dark value, found ${texts.length}`);
  assert.equal(fills.length, 2, `expected a light and a dark fill, found ${fills.length}`);
});

test("the bubble text clears 4.5:1 in every theme", () => {
  fills.forEach((fill, i) => {
    const r = ratio(texts[i], fill);
    assert.ok(
      r >= 4.5,
      `${texts[i]} on ${fill} is ${r.toFixed(2)}:1 — the user's own words are hard to read`
    );
  });
});

test("the bubble does not borrow the primary-fill text colour again", () => {
  const at = production.indexOf(".sand-transcript-row--user .sand-bubble");
  assert.ok(at > 0, "the user bubble rule is gone");
  const rule = production.slice(at, production.indexOf("}", at));
  assert.ok(
    /--sand-text-bubble-user/.test(rule),
    "the user bubble is not using its own text token"
  );
  assert.ok(
    !/color:\s*var\(--sand-text-on-primary[^,)]*\)\s*;/.test(rule),
    "the bubble reads --sand-text-on-primary directly again — that is the 2.67:1 bug"
  );
});

test("the working label is visible without hovering it", () => {
  // The shimmering activity label was display:none unless hovered, so a
  // teammate mid-turn animated a dot and never said what it was doing.
  const shown = production.match(
    /\.sand-inchat\[data-kind="work"\] \.sand-inchat__busy[\s\S]{0,140}?\}/
  );
  assert.ok(shown, "the working label has no non-hover rule");
  assert.ok(/display:\s*inline/.test(shown[0]), "the working label is still hidden while working");
});

if (failed) {
  console.log(`bubble-contrast-test FAILED (${failed})`);
  process.exit(1);
}
console.log("bubble-contrast-test ok — the user bubble is readable and the busy label shows");
