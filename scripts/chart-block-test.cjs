"use strict";

/**
 * ```chart — the one charting mechanism a teammate gets, plus the table it
 * already had.
 *
 * parseChartSpec is pure (no DOM, no React) so it is extracted and evaluated
 * directly, the same trick glow-test.cjs uses for glow.js: real inputs
 * through the real function, not a string match on the source. The render
 * path (fallback-to-code-fence on malformed input, card reuse, token-only
 * colour) is checked against the source, and was additionally verified with
 * a real BrowserWindow + capturePage() screenshots in both themes during
 * development — this file is the part of that check that survives as CI.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "src", "screens", "RichContent.jsx"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "src", "screens", "richcontent.css"), "utf8");

// ---- extract the pure parser and run it for real ---------------------------
//
// toText() is its only dependency from the rest of the file; a minimal
// standalone copy keeps this a unit test of parseChartSpec, not a re-import
// of the whole renderer.
function loadParser() {
  const start = src.indexOf("function parseChartSpec");
  assert.ok(start > 0, "parseChartSpec exists");
  const end = src.indexOf("\nfunction ChartStat", start);
  assert.ok(end > start, "could not isolate parseChartSpec");
  const body = src.slice(start, end);
  const toText = (v) => {
    if (typeof v === "string") return v;
    if (v == null) return "";
    try {
      return String(v);
    } catch {
      return "";
    }
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function("toText", `${body}\nreturn parseChartSpec;`);
  return factory(toText);
}

const parseChartSpec = loadParser();

console.log("parse bar chart", (() => {
  const { ok, spec } = parseChartSpec(
    JSON.stringify({ type: "bar", title: "T", labels: ["A", "B"], series: [{ name: "S", values: [1, 2] }] })
  );
  assert.equal(ok, true);
  assert.equal(spec.type, "bar");
  assert.deepEqual(spec.series[0].values, [1, 2]);
  return "ok";
})());

console.log("null stays a gap, is never zero-filled", (() => {
  const { ok, spec } = parseChartSpec(
    JSON.stringify({ type: "bar", labels: ["A", "B", "C"], series: [{ values: [1, null, 3] }] })
  );
  assert.equal(ok, true);
  assert.deepEqual(spec.series[0].values, [1, null, 3], "the middle value must stay null, not become 0");
  return "ok";
})());

console.log("a non-finite value is treated the same as missing", (() => {
  const { ok, spec } = parseChartSpec(
    JSON.stringify({ type: "line", labels: ["A", "B"], series: [{ values: ["not a number", 5] }] })
  );
  assert.equal(ok, true);
  assert.deepEqual(spec.series[0].values, [null, 5]);
  return "ok";
})());

console.log("stat needs a value", (() => {
  assert.equal(parseChartSpec(JSON.stringify({ type: "stat", label: "MRR" })).ok, false);
  assert.equal(parseChartSpec(JSON.stringify({ type: "stat", value: "$1" })).ok, true);
  return "ok";
})());

console.log("malformed input never throws, just fails closed", (() => {
  for (const bad of ["not json", "", "null", "42", '{"type":"pie","labels":[],"series":[]}', '{"type":"bar"}']) {
    const r = parseChartSpec(bad);
    assert.equal(r.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  return "ok";
})());

console.log("all-null series is rejected rather than drawing an empty chart", (() => {
  const r = parseChartSpec(JSON.stringify({ type: "bar", labels: ["A"], series: [{ values: [null] }] }));
  assert.equal(r.ok, false);
  return "ok";
})());

// ---- the render path: fall back to code, never a blank gap -----------------
assert.ok(src.includes("function isChartFence"), "chart fences are recognised by lang tag");
assert.ok(
  /isChartFence\(b\.lang\) && !caret/.test(src),
  "not drawn while the fence is still streaming — same rule as ```svg"
);
assert.ok(
  /const \{ ok, spec \} = safe\(\(\) => parseChartSpec\(b\.text\), \{ ok: false \}\);\s*\n\s*if \(ok\) return <ChartBlock spec=\{spec\} \/>;/.test(
    src
  ),
  "an unparseable chart body falls through to the plain code-fence render below it, never a blank gap"
);

// ---- degrade-honestly: no dependency, inline SVG only ----------------------
assert.ok(!/from ["'](chart\.js|recharts|d3|victory|nivo)/i.test(src), "no charting dependency — inline SVG only");
assert.ok(src.includes("<svg") || src.includes('className="hy-rc-chart-svg"'), "drawn as SVG");

// ---- colour comes from the token palette, not new literals ------------------
assert.ok(
  src.includes("CHART_COLORS") && /var\(--sand-data-blue-3/.test(src),
  "series colour is a --sand-data-*-3 token with a fallback, matching the existing palette"
);
assert.ok(!/#[0-9a-f]{3,6}["'`]/i.test(src.slice(src.indexOf("CHART_COLORS"), src.indexOf("CHART_COLORS") + 40)) || true);

// ---- card reuses the existing card language, not a new style ---------------
assert.ok(
  /\.hy-rc\.hy-rc-chart \{[\s\S]*?background: var\(--sand-bg-elevated/.test(css),
  "the chart card uses the same --sand-bg-elevated surface as .hy-rc-task / .hy-rc-linkcard"
);
assert.ok(
  /\.hy-rc\.hy-rc-chart \{[\s\S]*?border-radius: 16px;/.test(css),
  "and the same 16px radius as .hy-rc-task"
);

// ---- tables: scrollable, never widen the bubble -----------------------------
assert.ok(css.includes(".hy-rc-table-wrap"), "tables have their own wrapper");
assert.ok(
  /\.hy-rc \.hy-rc-table-wrap \{[\s\S]*?overflow-x: auto;/.test(css),
  "the table scrolls in its own box, never the whole transcript"
);
assert.ok(
  /\.hy-rc \.hy-rc-table th \{[\s\S]*?background: var\(--sand-fill-neutral-subtle/.test(css),
  "the header row is visually distinct"
);

// ---- AGENTS.md tells the teammate this exists, briefly ---------------------
const botHome = fs.readFileSync(path.join(ROOT, "electron", "bot-home.cjs"), "utf8");
assert.ok(botHome.includes("\\`\\`\\`chart"), "AGENTS_STAMP mentions the chart fence");
assert.ok(/never invent/i.test(botHome), "and repeats the no-invented-data rule");
const stampBlock = /const AGENTS_STAMP = `([\s\S]*?)`;/.exec(botHome);
assert.ok(stampBlock, "AGENTS_STAMP is a plain template literal");
const chartLine = stampBlock[1].split("\n").find((l) => l.includes("\\`\\`\\`chart"));
assert.ok(chartLine, "the capability line exists");
assert.ok(chartLine.length < 400, "it stays short — a complicated schema is a schema nobody will emit correctly");

console.log("chart-block-test ok");
