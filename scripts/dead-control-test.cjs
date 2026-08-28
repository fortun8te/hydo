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
const composer = read("src/screens/Composer.jsx");

// -- 1. ⌘K could never open the command palette --------------------------
// runCommand() ended with an unconditional `setPaletteOpen(false)`, so the
// one command whose whole job is to toggle that state was undone in the same
// batch. Fully wired (KEYMAP -> matchEvent -> runCommand -> <CommandPalette
// open={paletteOpen}/>) and completely dead.
// The per-surface booleans were later replaced by ONE `overlay` state, so the
// bug can no longer be spelled the same way — but it can still be MADE. What
// must hold is unchanged: the palette's own command toggles it, and the
// trailing close that runs after every other command skips it.
assert.ok(
  /case "sand\.commandPalette": toggleOverlay\("palette"\);/.test(shell),
  "Shell no longer toggles the palette for sand.commandPalette"
);
assert.ok(
  /if \(id !== "sand\.commandPalette"\)\s*closers\.palette\(\);/.test(shell),
  "runCommand's trailing close must skip the palette's own command, or Cmd-K is dead again"
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
// Spelled `closers.artifact()` since the per-surface booleans became one
// `overlay` slot. The rule is the same one the original bug broke: the two
// surfaces that cover the transcript longest must have a way out that is not a
// small chevron in their header.
assert.ok(/closers\.artifact\(\)/.test(escBlock), "Escape must close the artifact viewer");
assert.ok(escBlock.includes("setRail(null)"), "Escape must close the open rail");
// …but never over the top of a modal that owns its own Escape, and never
// while the caret is in a field.
assert.ok(escBlock.includes("e.defaultPrevented"), "Escape must yield to a handler that already claimed it");
assert.ok(escBlock.includes("isTypingTarget(e.target)"), "Escape must not fire while typing");
// Each surface asserted separately, not as one exact string. The selector has
// since grown `[role='alertdialog']` for the confirm dialog — a STRICTER guard
// that the old verbatim match would have rejected. Pin the surfaces that must
// be covered; adding another is an improvement, not a regression.
{
  const sel = /document\.querySelector\("([^"]+)"\)/.exec(escBlock);
  assert.ok(sel, "Escape must ask the DOM what is on screen");
  for (const surface of [".hy-dialog", ".hy-palette", ".hy-find", ".hy-sheet", "role='dialog'"]) {
    assert.ok(
      sel[1].includes(surface),
      `Escape must not collapse the rail behind ${surface}`
    );
  }
}
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

// -- 6. every palette row must reach a case in runCommand ---------------
// The palette renders shortcuts.js's COMMANDS verbatim — it does no filtering
// by "is this implemented". `sand.openTools`, `sand.openWorkflows` and
// `sand.navigateForward` all shipped as rows (two with a chord printed beside
// them) that fell through `default: break`. This is the general form of that
// bug, so it is checked generally.
const ids = [...shortcuts.matchAll(/\{ id: "(sand\.[\w.]+)"/g)].map((m) => m[1]);
assert.ok(ids.length > 8, "could not parse shortcuts.js's command list");
const runCommand = shell.slice(shell.indexOf("function runCommand("), shell.indexOf("useEffect", shell.indexOf("function runCommand(")));
const dead = ids.filter((id) => id !== "sand.send" && !runCommand.includes(`case "${id}"`));
assert.deepEqual(dead, [], `palette commands with no case in runCommand (they do nothing when clicked): ${dead.join(", ")}`);

// And every chord in KEYMAP must land on one of those commands.
const chordIds = [...shortcuts.matchAll(/"[\w+]+": "(sand\.[\w.]+)"/g)].map((m) => m[1]);
const deadChords = chordIds.filter((id) => id !== "sand.send" && !runCommand.includes(`case "${id}"`));
assert.deepEqual(deadChords, [], `keyboard chords bound to a command runCommand ignores: ${deadChords.join(", ")}`);

// -- 8. Escape could not dismiss the slash / mention menu ---------------
// `menuMode()` derives the menu from the DRAFT ("/…" or "…@foo"), so the
// Escape branch's `onMenuToggle(false)` — which only clears the plus
// button's own flag — changed nothing, while preventDefault() made the key
// look handled. The menu stayed up until you deleted the slash.
assert.ok(composer.includes("const [dismissed, setDismissed] = useState(false)"), "Composer lost its Escape dismissal state");
assert.ok(
  composer.includes("const mode = dismissed ? null : menuMode(draft, menuOpen);"),
  "the draft-derived menu must honour an Escape dismissal, or Escape does nothing again"
);
assert.ok(
  /if \(e\.key === "Escape"\) \{\s*e\.preventDefault\(\);\s*setDismissed\(true\);/.test(composer),
  "Escape must set the dismissal, not just toggle the plus flag"
);
// …and it must lift on the next keystroke, or the menu is gone for good.
assert.ok(
  /useEffect\(\(\) => \{\s*setDismissed\(false\);\s*\}, \[draft\]\);/.test(composer),
  "the dismissal must reset when the draft changes"
);

// -- 7. every gb-icon-<name> in the app must have a rule in icons.css ----
// `gb-icon gb-icon-camera` shipped on Settings' avatar badge. The class
// applied, nothing errored, ::before resolved to `content: none`, and the
// badge painted as an empty 0x0 circle on hover. icons.css calls that glyph
// `device-camera`. Checked for every icon in the app, not just that one.
const jsxFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "umbra" || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(jsx?|css)$/.test(e.name) && e.name !== "icons.css") jsxFiles.push(full);
  }
})(path.join(ROOT, "src"));

const iconsCss = read("src/kit/icons.css");
const defined = new Set(
  [...iconsCss.matchAll(/^\.(gb-icon-[a-z0-9-]+)::before/gm)].map((m) => m[1])
);
assert.ok(defined.size > 400, "could not parse icons.css");

const missing = [];
for (const file of jsxFiles) {
  // Comments name these classes constantly (including the one right above
  // the fix for this very bug), so strip them first or the test flags prose.
  const src = fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  for (const m of src.matchAll(/gb-icon-[a-z0-9-]+/g)) {
    // `gb-icon-chevron-${open ? "down" : "up"}` — the literal half is a
    // prefix, not a name. Those families are asserted explicitly below.
    if (src.slice(m.index + m[0].length, m.index + m[0].length + 2) === "${") continue;
    if (!defined.has(m[0])) missing.push(`${path.relative(ROOT, file)}: ${m[0]}`);
  }
}
assert.deepEqual(missing, [], `icon classes with no rule in icons.css (they render a 0x0 box):\n  ${missing.join("\n  ")}`);

// The interpolated families, spelled out so a renamed glyph still trips.
for (const name of [
  "gb-icon-chevron-up", "gb-icon-chevron-down", "gb-icon-chevron-left", "gb-icon-chevron-right",
]) {
  assert.ok(defined.has(name), `${name} is interpolated in JSX but not defined in icons.css`);
}

console.log(`dead-control-test ok (${ids.length} commands, ${chordIds.length} chords, all reachable, ${defined.size} icons defined)`);
