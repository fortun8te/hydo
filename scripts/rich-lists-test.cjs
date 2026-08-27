"use strict";

/**
 * Numbered lists, and the size a file chip prints.
 *
 * This one is NOT a source-text test. The two things it guards are behaviour,
 * not spelling: `1.` has to come out of the parser as an <ol> block carrying
 * the right `start`, and 36000 bytes has to come out of the formatter as
 * exactly "36kB". A grep for `type: "ol"` proves neither.
 *
 * RichContent.jsx is JSX, so node cannot require() it. But every function
 * involved here is pure JavaScript with no JSX in its body — parseBlocks
 * builds plain objects and hands the inline work to a renderer it never
 * calls, and humanSize is arithmetic. So we lift those exact declarations out
 * of the real source by brace matching and run THEM. If someone edits the
 * parser, this test runs the edit; it cannot go stale against a copy.
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "src", "screens", "RichContent.jsx"), "utf8");

/** The source of one top-level `function name(...) { ... }`, braces matched. */
function fnSource(name) {
  const at = src.indexOf(`\nfunction ${name}(`);
  assert.notEqual(at, -1, `RichContent no longer declares function ${name}`);
  let i = src.indexOf("{", at);
  let depth = 0;
  for (let j = i; j < src.length; j += 1) {
    const ch = src[j];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(at, j + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** The source of one top-level single-line `const NAME = ...;`. */
function constSource(name) {
  // Up to the first semicolon, so a trailing `// comment` is left behind.
  const m = new RegExp(`^const ${name} = [^\\n;]*;`, "m").exec(src);
  assert.ok(m, `RichContent no longer declares const ${name}`);
  return m[0];
}

const CONSTS = [
  "MAX_INPUT",
  "MAX_DEPTH",
  "RE_FENCE",
  "RE_HEADING",
  "RE_HR",
  "RE_QUOTE",
  "RE_UL",
  "RE_OL",
  "RE_TASK",
  "RE_TABLE_DIV",
];
const FNS = ["toText", "normalize", "indentOf", "isBlockStart", "parseBlocks", "humanSize"];

const lifted = [...CONSTS.map(constSource), ...FNS.map(fnSource)].join("\n\n");
// eslint-disable-next-line no-new-func
const { parseBlocks, humanSize } = new Function(
  `${lifted}\nreturn { parseBlocks, humanSize };`
)();

// ---- ordered lists render at all -------------------------------------------
// The bug this exists for: bullets worked, `1.` did not, and a teammate that
// answered "here's a random one:" with a seven-item list produced seven
// paragraphs with the digits stranded in the prose.
const seven = parseBlocks(
  [
    "Here's a random one:",
    "",
    "1. Water the plants",
    "2. Buy oat milk",
    "3. Book the dentist",
    "4. Renew the passport",
    "5. Reply to Anna",
    "6. Cancel the gym",
    "7. Back up the laptop",
  ].join("\n")
);
assert.equal(seven.length, 2, "a lead-in paragraph and one list, not nine paragraphs");
assert.equal(seven[0].type, "p");
assert.equal(seven[1].type, "ol", "`1.` is an ordered list, not prose");
assert.equal(seven[1].items.length, 7, "all seven items belong to the same list");
assert.equal(seven[1].start, 1);

// `1)` is the same list as `1.` — models write both.
assert.equal(parseBlocks("1) one\n2) two")[0].type, "ol");

// ---- a list that does not start at 1 ---------------------------------------
// The number the model wrote is the number the reader has to see: a list that
// renumbers itself from 1 silently rewrites what the teammate said.
const fromFive = parseBlocks("5. five\n6. six\n7. seven");
assert.equal(fromFive[0].type, "ol");
assert.equal(fromFive[0].start, 5, "an ol keeps the number it started on");
assert.equal(fromFive[0].items.length, 3);

// ---- nesting ---------------------------------------------------------------
const nested = parseBlocks("1. Outer\n   1. Inner a\n   2. Inner b\n2. Second");
assert.equal(nested[0].type, "ol");
assert.equal(nested[0].items.length, 2, "the indented pair does not become top-level items");
const innerBlocks = nested[0].items[0];
const innerList = innerBlocks.find((b) => b.type === "ol");
assert.ok(innerList, "the indented list is parsed inside its parent item");
assert.equal(innerList.items.length, 2);

// A bullet list nested under a numbered one stays a bullet list: the two kinds
// must not merge, or "1. a" followed by "- b" becomes one run of items.
const mixed = parseBlocks("1. Outer\n   - bullet\n2. Second");
assert.equal(mixed[0].type, "ol");
assert.ok(
  mixed[0].items[0].some((b) => b.type === "ul"),
  "a bullet nested under a number stays a bullet"
);

// ---- ordered and unordered do not run together -----------------------------
const both = parseBlocks("- bullet\n1. number");
assert.equal(both.length, 2, "a change of list kind starts a new list");
assert.equal(both[0].type, "ul");
assert.equal(both[1].type, "ol");

// ---- the things that must NOT become lists ---------------------------------
// A year, a price, a version. `RE_OL` needs the separator AND the space, and
// these are the sentences that used to trip renderers that did not.
for (const line of ["2024 was a long year", "1.5x the speed", "10.times do"]) {
  assert.equal(parseBlocks(line)[0].type, "p", `"${line}" is prose, not a list`);
}

// Checklists stay checklists — the task-list branch sits inside the same
// block, and an ordered list must not swallow it.
const tasks = parseBlocks("- [ ] one\n- [x] two");
assert.equal(tasks[0].type, "tasks");
assert.equal(tasks[0].items[1].done, true);

// ---- totality --------------------------------------------------------------
// parseBlocks is reached from a memoised render on every streaming tick; a
// throw here is a blank transcript.
for (const bad of [undefined, null, 0, {}, [], "1.", "1. ", "\n\n1.\n"]) {
  assert.doesNotThrow(() => parseBlocks(bad), `parseBlocks(${JSON.stringify(bad)}) threw`);
}

// ---- the size on a file chip -----------------------------------------------
// The reference is literal: "36kB". Lowercase k, capital B, no space, no
// decimal. Anything else ("36 KB", "35.2 KB") is a different design.
assert.equal(humanSize(36000), "36kB", "36000 bytes reads as 36kB");
assert.equal(humanSize(4200), "4kB");
assert.equal(humanSize(812000), "812kB");
assert.equal(humanSize(999), "999B", "under a thousand stays in bytes");
assert.equal(humanSize(5200000), "5.2MB", "megabytes keep one decimal until 10");
assert.equal(humanSize(42000000), "42MB");
assert.equal(humanSize(3200000000), "3.2GB");
assert.ok(!/\s/.test(humanSize(36000)), "no space between the number and the unit");
// A size that is already a string (some callers pass one) is passed through,
// and a numeric string is still formatted rather than printed raw.
assert.equal(humanSize("36000"), "36kB");
assert.equal(humanSize("about 36kB"), "about 36kB");
// Missing or nonsense sizes print nothing at all, so the chip falls back to
// its kind label rather than showing "NaN".
for (const bad of [undefined, null, NaN, -1, "", {}]) {
  assert.equal(humanSize(bad), "", `humanSize(${String(bad)}) must be empty`);
}

// ---- and the chip actually prints it ---------------------------------------
// The formatter being right is worth nothing if the chip shows the kind label
// instead. `size || label` is the line that puts the size first.
assert.ok(
  /const size = humanSize\(f\.size\);/.test(src),
  "FileChip formats the size it was given"
);
assert.ok(
  /\{size \|\| label\}/.test(src),
  "and prints the size under the name, falling back to the kind only when there is none"
);
// The download control is a real button next to the name, not a click on the
// chip itself — opening a file and saving a copy are different intentions.
assert.ok(src.includes("hy-rc-file-dl"), "there is a download button");
assert.ok(src.includes("window.hydo.saveFile"), "which goes through the bridge");

console.log("rich-lists-test ok");
