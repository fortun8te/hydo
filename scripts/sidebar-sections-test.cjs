#!/usr/bin/env node
"use strict";

/**
 * sidebar-sections-test.cjs — collapsible sidebar sections and the
 * conversation context menu behind them.
 *
 * Two halves, for two different failure modes:
 *
 *   1. The STORE half runs for real. A section's folded state has to survive
 *      a restart, and deleting a section must never delete what was in it —
 *      both are round-tripped through a real store on a temp dir and read
 *      back from a second store pointed at the same directory. That is the
 *      only honest way to assert "across restart".
 *
 *   2. The SOURCE half guards the renderer, the same way dead-control-test
 *      and computer-rail-test do (there is no bundler or jsdom in `npm test`).
 *      What actually paints — the heading's flex layout beating the shared
 *      `display: block` rule above it, the chevron rotating, the folded
 *      section rendering zero rows — was measured in a real BrowserWindow
 *      with computed styles and screenshots while this was built; these
 *      assertions are phrased tightly enough that the bugs found there
 *      cannot come back silently.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { stripComments } = require("./lib/source-scan.cjs");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  [FAIL] ${name}\n         ${err.stack || err.message}`);
  }
}

// ------------------------------------------------------------------ store
const { createStore } = require("../electron/store.cjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-sections-"));

const store = createStore({ dir });
store.signIn();
store.createAgent({ name: "Ada" });
store.createAgent({ name: "Grace" });
let s = store.createAgent({ name: "Hopper" });
const ids = s.agents.map((a) => a.id);
s = store.createSection({ name: "Health", ids: [ids[0], ids[1]] });
const sectionId = s.sections[0].id;

test("createSection puts exactly the named entries in it and leaves the rest alone", () => {
  const inSection = s.agents.filter((a) => a.sectionId === sectionId).map((a) => a.id);
  assert.deepEqual(inSection.sort(), [ids[0], ids[1]].sort());
  const loose = s.agents.filter((a) => !a.sectionId);
  assert.equal(loose.length, 1, "the third bot must stay unassigned, not vanish");
});

test("a folded section is remembered as a settings key", () => {
  const next = store.setSettings({ collapsedSections: [sectionId] });
  assert.deepEqual(next.settings.collapsedSections, [sectionId]);
});

test("the Unassigned group folds under its own literal key", () => {
  const next = store.setSettings({ collapsedSections: [sectionId, "unassigned"] });
  assert.deepEqual(next.settings.collapsedSections.sort(), [sectionId, "unassigned"].sort());
});

test("junk from a hand-edited state.json cannot reach the sidebar's .includes", () => {
  const next = store.setSettings({ collapsedSections: "Health" });
  assert.deepEqual(next.settings.collapsedSections, [], "a non-array must clamp to []");
  store.setSettings({ collapsedSections: [sectionId, sectionId, "", null, "unassigned"] });
  const back = store.getState();
  assert.deepEqual(
    back.settings.collapsedSections.sort(),
    [sectionId, "unassigned"].sort(),
    "blanks dropped, duplicates deduped"
  );
});

test("the fold survives a restart", () => {
  // A second store over the same directory IS the restart: nothing is shared
  // in memory, so this only passes if the key really landed on disk and came
  // back through normalizeState.
  const reopened = createStore({ dir });
  const back = reopened.getState();
  assert.deepEqual(
    back.settings.collapsedSections.sort(),
    [sectionId, "unassigned"].sort(),
    "collapsedSections did not round-trip through state.json"
  );
  assert.equal(back.sections.length, 1);
  assert.equal(back.sections[0].name, "Health");
});

test("deleting a section keeps its conversations and drops only the fold key", () => {
  const after = store.deleteSection(sectionId);
  assert.equal(after.sections.length, 0);
  assert.equal(after.agents.length, 3, "deleting a section must not delete conversations");
  assert.ok(
    after.agents.every((a) => !a.sectionId),
    "orphaned conversations must fall back to Unassigned"
  );
  assert.deepEqual(
    after.settings.collapsedSections,
    ["unassigned"],
    "the dead section's fold key must go, and nothing else"
  );
});

test("moveToSection ignores an unknown id rather than hiding a conversation", () => {
  const after = store.moveToSection([ids[0]], "no-such-section");
  const moved = after.agents.find((a) => a.id === ids[0]);
  assert.equal(moved.sectionId, null, "an unknown section id must mean Unassigned, not limbo");
});

// ----------------------------------------------------------------- source
const sidebar = read("src/screens/Sidebar.jsx");
const shell = read("src/screens/Shell.jsx");
const css = read("src/screens/sidebar.css");

test("every conversation is drawn, section or not", () => {
  // The bug this guards: filtering rows by sectionId and forgetting the ones
  // that have none, so a conversation disappears from the app entirely.
  assert.ok(
    /blocks\.push\(\{ key: UNASSIGNED_KEY, id: null, name: "Unassigned", items: ungrouped \}\)/.test(
      sidebar
    ),
    "the Unassigned block must be pushed whenever sections exist"
  );
  assert.ok(
    /blocks\.push\(\{ key: UNASSIGNED_KEY, id: null, name: null, items: ungrouped \}\)/.test(sidebar),
    "with no sections at all the ungrouped rows must still be rendered, headless"
  );
});

test("the heading is a real disclosure control", () => {
  assert.ok(
    /aria-expanded=\{!block\.folded\}/.test(sidebar),
    "the section heading must report its own open state"
  );
  assert.ok(
    /onClick=\{\(\) => onToggleSection\?\.\(block\.key\)\}/.test(sidebar),
    "clicking the heading must toggle the fold"
  );
});

test("a folded section renders zero rows, not hidden ones", () => {
  assert.ok(
    /\{\(block\.folded \? \[\] : block\.items\)\.map\(/.test(sidebar),
    "folding must drop the rows from the tree — display:none leaves them focusable"
  );
});

test("the count appears exactly when the section is folded", () => {
  assert.ok(
    /\{block\.folded \? \(\s*<span className="sand-section__count">\{block\.items\.length\}<\/span>/.test(
      sidebar
    ),
    "a folded section must show how many conversations it is hiding"
  );
});

test("shift-range selection skips a folded section", () => {
  assert.ok(
    /const visible = pinnedTiles\.concat\(blocks\.flatMap\(\(b\) => \(b\.folded \? \[\] : b\.items\)\)\)/.test(
      sidebar
    ),
    "a shift-click must not silently select rows nobody can see"
  );
});

test("the fold is persisted, not component state", () => {
  // useState here would look right and forget on every reload, which is the
  // half-built version of this feature.
  assert.ok(
    /collapsedSections = \[\]/.test(sidebar),
    "Sidebar must take the folded keys as a prop"
  );
  assert.ok(
    /window\.hydo\.setSettings\(\{ collapsedSections: next \}\)/.test(shell),
    "Shell must write the fold through to the store"
  );
  assert.ok(
    /collapsedSections=\{collapsedSections\}/.test(shell) &&
      /onToggleSection=\{onToggleSection\}/.test(shell),
    "Shell must actually pass both down to Sidebar"
  );
  assert.ok(
    /useMemo\(\s*\(\) => state\.settings\.collapsedSections \|\| \[\],/.test(shell),
    "a fresh array here defeats Sidebar's memo on every composer keystroke"
  );
});

test("the heading's flex rule wins over the shared display:block above it", () => {
  // The signature bug in this codebase: a new rule applies its class and
  // changes no pixels because a more specific one already won. Both selectors
  // are one class deep inside .sand-sidebar, so ORDER is the only thing
  // deciding it — the flex rule must come last.
  const shared = css.indexOf(".sand-sidebar .sand-section__label,");
  const flex = css.indexOf(".sand-sidebar .sand-section__label {");
  assert.ok(shared >= 0 && flex > shared, "the flex rule must be declared after the block rule");
  const rule = css.slice(flex, css.indexOf("}", flex));
  assert.ok(/display:\s*flex/.test(rule), "the heading row must be a flex line");
  assert.ok(
    !/\.sand-section__rename/.test(rule),
    "the rename input must not be swept into the flex rule — it is an <input>"
  );
});

test("the chevron actually turns", () => {
  const shut = css.slice(css.indexOf('.sand-section__chev[data-open="false"]'));
  assert.ok(/transform:\s*rotate\(0deg\)/.test(shut.slice(0, 120)), "shut points right");
  const open = css.slice(css.indexOf(".sand-sidebar .sand-section__chev {"));
  assert.ok(/transform:\s*rotate\(90deg\)/.test(open.slice(0, 400)), "open points down");
  assert.ok(
    /prefers-reduced-motion/.test(css),
    "the rotation must be droppable for reduced motion"
  );
});

test("the context menu only offers things that are implemented", () => {
  // A control that looks finished and does nothing is a bug here. There is no
  // template store in this app, so there is no 'Share as template' row.
  assert.ok(!/Share as template/i.test(sidebar), "no dead 'Share as template' row");
  for (const label of [
    "Mark as Unread",
    "Copy conversation ID",
    "Hide from sidebar",
    "Duplicate",
    "New section",
  ]) {
    assert.ok(sidebar.includes(label), `the row menu lost "${label}"`);
  }
  // Every one of those has a handler behind it, wired from Shell.
  for (const prop of ["onMarkUnread", "onCopyId", "onHide", "onDuplicate", "onEditProfile"]) {
    assert.ok(
      new RegExp(`${prop}=\\{on[A-Za-z]+\\}`).test(shell),
      `${prop} is not passed to Sidebar, so its menu row is dead`
    );
  }
});

test("Delete still goes through the confirmed path, never straight to the store", () => {
  // deleteAgent interrupts the turn, kills leftover processes, closes the
  // Hermes session and releases the box hold. A menu item calling it directly
  // also skipped Shell's confirm dialog, which is how a mis-click used to
  // destroy a whole transcript.
  // Comments are stripped first: the note explaining this bug names the very
  // call it forbids, and matching that would pass forever by accident.
  const code = stripComments(sidebar);
  assert.ok(
    !/window\.hydo\.deleteAgent/.test(code),
    "the sidebar must hand entries up to Shell, not delete them itself"
  );
  assert.ok(
    /window\.hydo\.deleteAgent\?\.\(entry\.id\)/.test(shell),
    "Shell's confirm dialog must still be the one path into deleteAgent"
  );
  assert.ok(/onDelete\?\.\(list\)/.test(sidebar), "removeMany must delegate upward");
});

test("Escape closes the menu and it does not trap focus", () => {
  const ctx = read("src/screens/ContextMenu.jsx");
  assert.ok(/e\.key === "Escape"/.test(ctx) && /onClose\?\.\(\)/.test(ctx), "Escape must close it");
  assert.ok(/tabIndex=\{-1\}/.test(ctx), "menu items stay out of the tab order");
  assert.ok(
    !/focusin|focusout|preventScroll|trapFocus/.test(ctx),
    "no focus trap — the menu is dismissible, not modal"
  );
});

console.log(`\nsidebar sections: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
