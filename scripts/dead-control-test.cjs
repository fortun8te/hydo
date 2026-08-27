"use strict";

// dead-control-test.cjs — regressions for this app's signature failure: a
// control that is wired end to end, never errors, and does nothing.
//
// Each block below pins one bug that actually shipped and was found by
// driving the real renderer with Electron (⌘K, Escape, the "Expand sidebar"
// button, and the Computer rail's Wake button against a rejecting IPC).
// This repo has no jsdom render step — every other suite here asserts on
// source shape (see wiring-check.cjs, computer-rail-test.cjs) — so that is
// what these do too, phrased tightly enough that the bug cannot come back
// without tripping one of them.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const shell = read("src/screens/Shell.jsx");
const sidebar = read("src/screens/Sidebar.jsx");
const computerRail = read("src/screens/ComputerRail.jsx");
const shortcuts = read("src/lib/shortcuts.js");
const rails = read("src/screens/rails.css");

// -- 1. ⌘K could never open the command palette --------------------------
// runCommand() ended with an unconditional `setPaletteOpen(false)`, so the
// one command whose whole job is to toggle that state was undone in the same
// batch. Fully wired (KEYMAP -> matchEvent -> runCommand -> <CommandPalette
// open={paletteOpen}/>) and completely dead.
assert.ok(
  shell.includes('case "sand.commandPalette": setPaletteOpen((v) => !v);'),
  "Shell no longer toggles paletteOpen for sand.commandPalette"
);
assert.ok(
  /if \(id !== "sand\.commandPalette"\) setPaletteOpen\(false\);/.test(shell),
  "runCommand's trailing setPaletteOpen(false) must skip the palette's own command, or ⌘K is dead again"
);
assert.ok(
  !/\n\s*setPaletteOpen\(false\);\n\s*\}/.test(shell),
  "an unconditional setPaletteOpen(false) at the end of runCommand is the exact bug"
);

// -- 2. Escape did not close the rails or the artifact viewer ------------
// The two surfaces that cover the transcript longest had no keyboard exit at
// all; the only way out was a small chevron in their header.
const escBlock = shell.slice(shell.indexOf('if (e.key === "Escape") {'));
assert.ok(escBlock.length > 0, "Shell has no Escape handler at all");
assert.ok(escBlock.includes("setArtifactId(null)"), "Escape must close the artifact viewer");
assert.ok(escBlock.includes("setRail(null)"), "Escape must close the open rail");
// …but never over the top of a modal that owns its own Escape, and never
// while the caret is in a field.
assert.ok(escBlock.includes("e.defaultPrevented"), "Escape must yield to a handler that already claimed it");
assert.ok(escBlock.includes("isTypingTarget(e.target)"), "Escape must not fire while typing");
assert.ok(
  /document\.querySelector\("\.hy-dialog, \.hy-palette, \.hy-find, \.hy-sheet, \[role='dialog'\]"\)/.test(escBlock),
  "Escape must not collapse the rail behind an open dialog/palette/find/sheet"
);
assert.ok(
  /export function isTypingTarget/.test(shortcuts),
  "isTypingTarget must stay exported so Shell and matchEvent share ONE definition of 'the caret is in a field'"
);
assert.ok(
  shell.includes('import { matchEvent, isTypingTarget } from "../lib/shortcuts.js"'),
  "Shell must import isTypingTarget rather than growing a second copy"
);

// -- 3. "Expand sidebar" did nothing below the breakpoint ----------------
// Shell renders `collapsed || tooNarrow`, so under 880px the rail is forced.
// Both toggle buttons still painted, and clicking either changed only hidden
// state — which then sprang out when the window was widened again.
assert.ok(sidebar.includes("canToggle = true"), "Sidebar lost its canToggle prop");
assert.ok(shell.includes("canToggle={!tooNarrow}"), "Shell must tell Sidebar when the rail is forced");
assert.ok(
  shell.includes('case "sand.toggleSidebar": if (!tooNarrow) setCollapsed((v) => !v);'),
  "⌘B must not flip hidden collapse state while the width overrules it"
);
// Neither toggle button may render unguarded.
for (const label of ['title="Expand sidebar"', 'aria-label="Expand sidebar"']) {
  const i = sidebar.indexOf(label);
  assert.ok(i > 0, `Sidebar no longer has ${label}`);
  assert.ok(
    sidebar.slice(Math.max(0, i - 400), i).includes("canToggle ?"),
    `the ${label} button must be behind canToggle`
  );
}

// -- 4. A rejected IPC froze the Computer rail forever -------------------
// boxEnsure/boxStop/boxStatus are CLI round-trips: they can REJECT, which is
// not the same as answering {ok:false}. Unguarded, the throw escaped the
// handler, setBusy("") never ran, and the button sat disabled on "Starting…"
// with no error under it. Verified live by stubbing boxEnsure to reject.
for (const fn of ["boxEnsure", "boxStop", "boxStatus", "boxLimits"]) {
  const i = computerRail.indexOf(`window.hydo?.${fn}?.`);
  assert.ok(i > 0, `ComputerRail no longer calls ${fn}`);
  const before = computerRail.slice(Math.max(0, i - 400), i);
  assert.ok(before.includes("try {"), `${fn} must be awaited inside a try — a rejection freezes the rail`);
}
assert.ok(
  computerRail.includes('reason: (e && e.message) || "Could not start it."'),
  "a rejected boxEnsure must still put a truthful reason on screen"
);
assert.ok(
  computerRail.includes('reason: (e && e.message) || "Could not stop it."'),
  "a rejected boxStop must still put a truthful reason on screen"
);

// -- 5. break-all chopped the workspace explainer mid-word ---------------
// One <p> carries both a filesystem path (no spaces, must break anywhere)
// and a prose sentence. `word-break: break-all` served the first and wrecked
// the second: "reads and write / s", "Everyt / hing".
const note = rails.slice(rails.indexOf(".bot-rail__workspace-note {"));
const noteRule = note.slice(0, note.indexOf("}"));
assert.ok(noteRule.includes("overflow-wrap: anywhere"), "the workspace note must use overflow-wrap: anywhere");
assert.ok(!noteRule.includes("word-break: break-all"), "word-break: break-all chops ordinary English mid-word");

console.log("dead-control-test ok");
