/**
 * hot-path-test — the composer must not re-render the app.
 *
 * Measured before this was fixed, typing 40 characters into the composer:
 *   Shell 84, Sidebar 84, Transcript 84, Composer 84 renders,
 *   6.1ms median / 9.1ms p95 of synchronous React work per keystroke.
 * After:
 *   Sidebar 0, Transcript 6, 2.1ms median / 2.7ms p95.
 *
 * Three separate things caused it, and each one is easy to reintroduce
 * without noticing, because every one of them looks correct:
 *   1. `window.hydo.setDraft` on every keystroke — an ipcMain handler that
 *      writes the store to disk and pushes a whole new state back, so
 *      `thread`/`agents`/`selected` changed identity per character.
 *   2. the composer's draft STRING handed to Transcript, which only ever
 *      asks whether it is empty.
 *   3. the presence clock effect keyed on that string, tearing down and
 *      rebuilding a 240ms interval per character.
 *
 * These assertions are the guard rails. None of them can catch a new inline
 * arrow prop, so the bundle/render comments in Shell.jsx say so too.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { stripComments } = require("./lib/source-scan.cjs");
// Comments stripped before every source scan: the rules below are written
// down in the very files they police, and a scan that cannot tell prose
// from code turns "explain why" into a test failure.
const read = (p) => stripComments(fs.readFileSync(path.join(__dirname, "..", p), "utf8"));

const shell = read("src/screens/Shell.jsx");
const transcript = read("src/screens/Transcript.jsx");
const sidebar = read("src/screens/Sidebar.jsx");
const presence = read("src/lib/presence.js");

// ---- the two heavy subtrees are memoised -----------------------------------
assert.ok(/export default memo\(Transcript\)/.test(transcript), "Transcript is memoised");
assert.ok(/export default memo\(Sidebar\)/.test(sidebar), "Sidebar is memoised");

// ---- and are actually given stable props -----------------------------------
// A memo fed a fresh arrow every render is worse than no memo: it renders just
// the same and pays for a shallow compare. Assert the two elements carry no
// inline arrow at all.
function element(src, tag) {
  const i = src.indexOf(`<${tag}\n`);
  assert.ok(i !== -1, `<${tag}> is rendered in Shell`);
  const end = src.indexOf("/>", i);
  assert.ok(end > i, `<${tag}> element is self-closing`);
  return src.slice(i, end);
}
for (const tag of ["Transcript", "Sidebar"]) {
  const el = element(shell, tag);
  // A prop whose value is an arrow function literal. `sending={a && !b}` and
  // `channel={x ? y : null}` are fine — they are values, not fresh identities.
  assert.ok(
    !/=\{\s*(?:\([^)]*\)|\w+)\s*=>/.test(el),
    `<${tag}> takes no inline arrow props — they defeat the memo`
  );
  assert.ok(!/\|\| \[\]/.test(el), `<${tag}> takes no freshly-minted array literal`);
}

// ---- the transcript gets a boolean, not the text ---------------------------
assert.ok(/draft=\{draftFilled\}/.test(shell), "Transcript is told IF there is a draft, not what it says");
assert.ok(
  /const draftFilled = String\(draft \|\| ""\)\.trim\(\)\.length > 0;/.test(shell),
  "and draftFilled is derived from the draft"
);
// String(false) === "false" is truthy, so presence has to check the boolean
// first or an empty draft reads as a full one and the blob never leaves.
assert.ok(/typeof draft === "boolean"/.test(presence), "presence handles the boolean form explicitly");

// ---- the presence clock is keyed on emptiness, not on the text -------------
assert.ok(
  /\}, \[draftFilled, sending, workingHere, linger\]\);/.test(shell),
  "the 240ms presence interval is not rebuilt on every keystroke"
);

// ---- the store write is debounced, and always flushed ----------------------
assert.ok(!/window\.hydo\.setDraft\(selected\.id/.test(shell), "no direct per-keystroke setDraft");
assert.ok(/queueDraft\(selected\.id, value\)/.test(shell), "typing queues the write");
// Every one of these is a moment where something reads the store copy back. A
// debounce without them loses the half-typed message, which is far worse than
// a slow one.
assert.ok(/flushDraft\(\);\n    setDraft\(selected\?\.draft/.test(shell), "flushed before switching conversation");
assert.ok(/useEffect\(\(\) => flushDraft, \[flushDraft\]\);/.test(shell), "flushed on unmount");
assert.ok(/pendingDraft\.current = null;/.test(shell), "and dropped on send, never flushed after it");

// ---- lastKeyAt is coarse on purpose ----------------------------------------
assert.ok(/function keyStamp\(\)/.test(shell) && /Math\.floor\(Date\.now\(\) \/ 1000\) \* 1000/.test(shell),
  "lastKeyAt is rounded to the second so it is not a per-keystroke prop change");
assert.ok(!/setLastKeyAt\(Date\.now\(\)\)/.test(shell), "nothing still stamps it exactly");

console.log("hot-path-test ok");
