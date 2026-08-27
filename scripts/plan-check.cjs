#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PLAN = path.join(ROOT, "docs/ELECTRON-HERMES-PLAN.md");

function main() {
  const src = fs.readFileSync(PLAN, "utf8");
  const headings = [
    "## Feature Gap Analysis",
    "## UI Improvement Checklist",
    "## Sub-Agent Strategy",
    "## Production-Readiness Roadmap",
    "## Efficiency Enhancements",
  ];
  for (const h of headings) {
    assert.ok(src.includes(h), `plan missing heading ${JSON.stringify(h)}`);
  }

  const needles = [
    ".nd",
    "pdf",
    "PDF",
    "html",
    "HTML",
    "property.zip",
    "spinner",
    "easing",
    "pause",
    "do not rewrite",
    "file-management",
    "computer-use",
    "Muse",
    "ocodex",
  ];
  for (const n of needles) {
    assert.ok(src.includes(n), `plan missing ${JSON.stringify(n)}`);
  }

  const words = src.trim().split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 800, `plan too short: ${words} words`);
  assert.ok(words <= 1500, `plan too long: ${words} words`);

  console.log(`plan-check ok headings=${headings.length} words=${words}`);
}

main();
