"use strict";

// The teammate's plan, in the thread.
//
// It existed only in the settings rail, behind a panel you have to open — so
// the one thing that says what a teammate is doing during a long job was the
// one thing you could not see while watching it work.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const card = fs.readFileSync(path.join(ROOT, "src/screens/PlanCard.jsx"), "utf8");
const comp = fs.readFileSync(path.join(ROOT, "src/screens/Composer.jsx"), "utf8");
const shell = fs.readFileSync(path.join(ROOT, "src/screens/Shell.jsx"), "utf8");
const tx = fs.readFileSync(path.join(ROOT, "src/screens/Transcript.jsx"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "src/screens/composer.css"), "utf8");
const store = fs.readFileSync(path.join(ROOT, "electron/store.cjs"), "utf8");

// ---- the plan is Hermes', mirrored ---------------------------------------
// Editing it here would put a second author on a list the model re-reads as
// its own.
assert.ok(store.includes("function captureTodos"), "todos are lifted off the Hermes tool stream");
assert.ok(!/onChange.*todos|setTodos/.test(card), "the card is read only");

// ---- short by default ----------------------------------------------------
// A fifteen-step plan must never push the actual reply off screen.
assert.ok(card.includes("useState(false)"), "collapsed until asked");
assert.ok(/hy-plan__now/.test(card) && /text-overflow: ellipsis/.test(css), "the headline is one line");

// ---- it survives a model that forgets to mark progress -------------------
// Falling back to the first unfinished step matters: without it a plan whose
// steps are all still "pending" would show nothing at all.
assert.ok(
  card.includes('states.findIndex((s) => s !== "done")'),
  "falls back to the first unfinished step"
);
// Hermes' status vocabulary is not fixed, so both spellings are accepted.
assert.ok(card.includes('"in_progress"') && card.includes('"in-progress"'), "tolerates both spellings");
assert.ok(card.includes('"completed"') && card.includes('"complete"'));

// ---- attached to the prompt box, not to the thread ----------------------
// A plan is current state, not history. In the transcript it scrolled away
// with the turn that produced it and landed somewhere different every time,
// depending on where the thread ended.
assert.ok(comp.includes("<PlanCard"), "the composer renders it");
assert.ok(!tx.includes("PlanCard"), "the transcript does not");
assert.ok(shell.includes("planOwner"), "the shell decides whose plan it is");
assert.ok(/\.hy-plan \{[^}]*position: absolute/s.test(css), "anchored to the composer");
assert.ok(/\.hy-plan \{[^}]*bottom: calc\(100% \+ 6px\)/s.test(css), "sits above the pill");

// It must look like the slash menu, not like a bubble: same surface, same
// border, same shadow. Both hang off the same edge of the same control.
assert.ok(/\.hy-plan \{[^}]*background: var\(--hy-menu\)/s.test(css), "the quick-menu ground");

// ---- it extends UPWARD ---------------------------------------------------
// The list is written first in the DOM so it stacks above the strip: the strip
// stays welded to the composer and the steps grow away from it, instead of
// shoving the thing you are typing into.
const listAt = card.indexOf("hy-plan__list");
const barAt = card.indexOf("hy-plan__bar");
assert.ok(listAt > 0 && barAt > 0 && listAt < barAt, "the list renders before the strip");
assert.ok(/\.hy-plan \{[^}]*justify-content: flex-end/s.test(css), "bottom-anchored");
// Growing upward is what removes the need to scroll it into view at all . the
// earlier version in the transcript needed a post-commit effect for that.
assert.ok(!card.includes("scrollIntoView"), "nothing to scroll: it opens away from the composer");

// ---- the flex-crush bug --------------------------------------------------
// In the transcript this was a flex child and rendered 2px tall with all of
// its content still inside it. Keep the collapsed strip a real height.
assert.ok(/\.hy-plan__bar \{[^}]*min-height: 26px/s.test(css), "the strip has a floor height");

assert.ok(css.includes("prefers-reduced-motion"), "the live tick can be stilled");

console.log("plan-test ok");
