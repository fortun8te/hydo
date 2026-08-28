"use strict";

/**
 * Strip comments before scanning source. One copy, because ten tests had
 * grown their own.
 *
 * This exists because of a bug class this repo hit FOUR times in one night: a
 * test scans production source for a pattern, and trips over the COMMENT that
 * explains the very fix it is checking.
 *
 *  - `scripts/light-mode-contrast-test.cjs` — a selector scan matched
 *    `--sand-*` written in prose above the rule.
 *  - `scripts/test.cjs` — a ban on `flags.lean ? "minimal"` was tripped by the
 *    comment quoting the pattern it bans.
 *  - `scripts/sidebar-sections-test.cjs`, `scripts/user-name-test.cjs` — same
 *    shape.
 *
 * The consequence is worse than a flaky test: it makes writing down WHY a rule
 * exists a test failure. A test that forbids the explanation is a test someone
 * deletes, and the rule goes with it.
 *
 * Newlines are PRESERVED (comments become blank space, not nothing) so that
 * line numbers and multi-line `[\s\S]` assertions still line up with the file
 * on disk — an earlier ad-hoc stripper deleted them and silently glued a rule
 * onto the previous one.
 */

/** Replace every non-newline character with a space. */
const blank = (m) => m.replace(/[^\n]/g, " ");

/**
 * Block comments (`/* ... *\/`, JS and CSS alike) and whole-line `//`
 * comments.
 *
 * Whole-line only for `//`: a trailing `//` is ambiguous with a URL
 * (`https://…`) and with a regex literal, and getting that wrong would delete
 * real code out from under an assertion — a silently PASSING test, which is
 * the worse failure of the two.
 */
function stripComments(src) {
  return String(src == null ? "" : src)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

/** Read a file and strip its comments in one step. */
function readStripped(fs, file) {
  return stripComments(fs.readFileSync(file, "utf8"));
}

module.exports = { stripComments, readStripped };
