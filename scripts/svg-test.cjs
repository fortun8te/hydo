"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "src", "screens", "RichContent.jsx"), "utf8");

// THE SAFETY PROPERTY.
//
// SVG is a full document format: a <script> or <foreignObject> inside inlined
// markup executes in THIS renderer, which holds the preload bridge. Loaded
// through <img> with a data: URI, SVG scripting is disabled by the browser and
// external references do not resolve. So the drawing path must never inject.
assert.ok(src.includes("function svgDataUri"), "svg goes through a data: URI");
assert.ok(src.includes("data:image/svg+xml"), "as an image, not as markup");
assert.ok(
  /<img src=\{src\}/.test(src),
  "drawn with <img>, never dangerouslySetInnerHTML"
);
// The one thing that would undo all of it.
const svgRegion = src.slice(src.indexOf("hy-rc-svg") - 900, src.indexOf("hy-rc-svg") + 400);
assert.ok(
  !/dangerouslySetInnerHTML/.test(svgRegion),
  "the svg path must never inject markup"
);

// Guard rails on what is accepted at all.
assert.ok(src.includes("function isSvgFence"), "only svg-ish fences are drawn");
assert.ok(/!\/\^\\s\*<svg\[\\s>\]\/i\.test\(raw\)/.test(src) || src.includes("^\\s*<svg[\\s>]"),
  "must start with an <svg root");
assert.ok(src.includes("</svg>"), "and be closed — a half-streamed block stays code");
assert.ok(src.includes("400_000"), "with a size ceiling");
// While a message is still streaming the fence is incomplete; showing a broken
// image mid-stream is worse than showing the code.
assert.ok(/isSvgFence\(b\.lang, b\.text\) && !caret/.test(src), "not drawn while streaming");

console.log("svg-test ok");

// ---- links must actually open ---------------------------------------------
// They used to render blue and do nothing — "never clickable" was the comment.
// A teammate could hand you a URL and there was no way to follow it.
assert.ok(src.includes("function openableUrl"), "there is one gate for openable urls");
assert.ok(
  /\^https\?:\\\/\\\//.test(src) || src.includes("^https?:\\/\\/"),
  "and it is http(s) only — openExternal hands anything else to the OS"
);
assert.ok(src.includes("hy-rc-link--open"), "openable links are marked");
assert.ok(src.includes("window.hydo?.openExternal?."), "and go through the bridge");
assert.ok(
  /e\.preventDefault\(\)/.test(src),
  "the renderer must never navigate itself — there is no way back from that"
);
// Non-http links keep the old inert <span>, so the underline stays a promise.
assert.ok(/openable \? \(/.test(src), "non-http links stay inert text");

// ---- task lists ------------------------------------------------------------
assert.ok(src.includes("RE_TASK"), "GFM task lists are parsed");
assert.ok(src.includes('type: "tasks"'), "as their own block");
assert.ok(src.includes("tasks.every(Boolean)"), "a list is only a task list if EVERY item is one");
// Presentational only: ticking one would change nothing and imply it did.
assert.ok(!/type="checkbox"/.test(src), "no real checkbox — it is a record, not a control");

console.log("richtext-test ok");

// ---- math ------------------------------------------------------------------
assert.ok(src.includes('import katex from "katex"'), "KaTeX is bundled, not fetched");
assert.ok(src.includes('katex/dist/katex.min.css'), "and its fonts ship with it");
// dangerouslySetInnerHTML on model input is only safe because trust:false makes
// KaTeX refuse the commands that emit raw HTML. Assert it is set explicitly.
assert.ok(/trust: false/.test(src), "trust:false — the whole reason the HTML is safe");
assert.ok(/throwOnError: false/.test(src), "a bad macro must not take the bubble down");
// A bare `$` must NOT be a delimiter: "$5,000 to $8,000" is far more common in
// these threads than inline TeX, and eating the text between two prices is worse
// than not rendering math.
assert.ok(
  src.includes('ch === "$" && text[i + 1] === "$"'),
  "only doubled $$ is inline math"
);
assert.ok(!/ch === "\$" \)/.test(src), "never a single $ delimiter");
assert.ok(src.includes('text[i + 1] === "("'), "\\\\( ... \\\\) inline math");
assert.ok(src.includes('type: "math"'), "$$ on its own line is a display block");

console.log("math-test ok");
