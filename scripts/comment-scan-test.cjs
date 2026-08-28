"use strict";

/**
 * A test must never forbid writing down WHY a rule exists.
 *
 * Four times in one night a test in this directory scanned production source
 * and tripped over the COMMENT explaining the very fix it was checking:
 * `--sand-*` named in prose matched a selector scan; a ban on
 * `flags.lean ? "minimal"` was tripped by the comment quoting the pattern it
 * bans; a sentence pinned so tightly that improving the wording failed.
 *
 * The damage is not the red run. It is that the cheapest way to make the suite
 * green becomes deleting the explanation — and then the next person deletes
 * the rule, because nothing says why it is there.
 *
 * Ten tests had each grown their own stripper. This asserts there is now ONE,
 * that it behaves, and that every source-scanning test uses it.
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { stripComments } = require("./lib/source-scan.cjs");

const ROOT = path.join(__dirname, "..");
const SCRIPTS = path.join(ROOT, "scripts");

let failed = 0;
const check = (label, fn) => {
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`  FAIL ${label}: ${(err && err.message) || err}`);
  }
};

// ---- the helper itself ----------------------------------------------------
check("block comments go, in JS and CSS alike", () => {
  assert.equal(stripComments("a/* .sand-x */b").replace(/ +/g, " "), "a b");
  assert.ok(!stripComments("/* flags.lean ? \"minimal\" */\nx").includes("minimal"));
});

check("whole-line // comments go", () => {
  assert.ok(!stripComments('  // never write --hy-text-faint here\nreal();').includes("hy-text-faint"));
});

// Deleting a trailing `//` would eat a URL or a regex literal and take real
// code with it — a silently PASSING test, which is the worse of the two
// failures. So trailing comments deliberately survive.
check("a trailing // is left alone, because a URL looks exactly like one", () => {
  assert.ok(stripComments('const u = "https://x/y"; // note').includes("https://x/y"));
});

// Line numbers and multi-line [\s\S] assertions have to keep lining up with
// the file on disk. An earlier ad-hoc stripper deleted comments outright and
// silently glued a CSS rule onto the previous one.
check("newlines survive, so line numbers and [\\s\\S] spans still match", () => {
  const src = "a\n/* one\ntwo\nthree */\nb\n";
  assert.equal(stripComments(src).split("\n").length, src.split("\n").length);
});

check("an unterminated block comment does not eat the file", () => {
  assert.ok(stripComments("keep();\n/* dangling\n").includes("keep()"));
});

// ---- nobody re-grows their own -------------------------------------------
// One copy, or this whole class of bug comes back a stripper at a time.
const OWN_STRIPPER = /replace\(\s*\/\\\/\\\*\[\\s\\S\]/;
for (const name of fs.readdirSync(SCRIPTS).filter((f) => f.endsWith(".cjs"))) {
  if (name === "comment-scan-test.cjs") continue; // the pattern above is the pattern
  check(`${name} does not hand-roll a comment stripper`, () => {
    const src = fs.readFileSync(path.join(SCRIPTS, name), "utf8");
    assert.ok(
      !OWN_STRIPPER.test(src),
      "use stripComments() from scripts/lib/source-scan.cjs instead of a local copy"
    );
  });
}

if (failed) {
  console.error(`comment-scan: ${failed} failed`);
  process.exit(1);
}
console.log("comment-scan ok — one stripper, comments cannot fail a source scan");
