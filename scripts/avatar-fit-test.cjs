"use strict";

/**
 * The profile picture has to FILL its circle.
 *
 * `.sand-account img` set `width: 22px; border-radius: 0` for the small marks
 * in that row. At (0,1,1) it outranks the avatar's own `.sand-foot__avatar`
 * (0,1,0), so a real photo was squeezed to 22px with square corners and left
 * floating inside its 40px ring — the picture visibly not filling the circle.
 *
 * Nothing errored, both rules were individually correct, and the losing one
 * read perfectly well in the file. Only the cascade was wrong, which is why
 * this is a test about SPECIFICITY rather than about the presence of a rule.
 *
 * Confirmed against the real element in an Electron window: 22x22 / radius 0
 * before, 40x40 / radius 50% after.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./lib/source-scan.cjs");

const ROOT = path.join(__dirname, "..");
// Strip comments before parsing selectors. The comment above the fixed rule
// quotes the broken selector to explain it, and a scan that cannot tell prose
// from a selector would forbid writing the explanation down — which is how a
// fix loses the reason it existed.
const styles = stripComments(fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8"));
const sidebar = fs.readFileSync(path.join(ROOT, "src/screens/sidebar.css"), "utf8");

// The avatar's own rule still says "fill me".
const own = /\.sand-foot__avatar\s*\{([^}]*)\}/.exec(sidebar);
assert.ok(own, ".sand-foot__avatar exists");
assert.ok(/width:\s*100%/.test(own[1]), "the avatar fills its container");
assert.ok(/border-radius:\s*inherit/.test(own[1]), "and takes the container's shape");
assert.ok(/object-fit:\s*cover/.test(own[1]), "cover, so a non-square photo crops rather than squashing");

// And nothing in the account row is allowed to out-specify it.
//
// A bare `.sand-account img` would match the avatar too. Any rule that sizes an
// img in that row must exclude it by name.
const sizers = [...styles.matchAll(/([^{}]*\.sand-account[^{}]*)\{([^}]*)\}/g)].filter(
  ([, , body]) => /width\s*:|border-radius\s*:/.test(body)
);
for (const [, selector, body] of sizers) {
  const parts = selector.split(",").map((p) => p.trim());
  for (const p of parts) {
    if (!/\bimg\b/.test(p)) continue;
    assert.ok(
      /:not\(\.sand-foot__avatar\)/.test(p),
      `"${p}" sizes an img in the account row and would beat .sand-foot__avatar — ` +
        `exclude the avatar (it sets: ${body.trim().replace(/\s+/g, " ")})`
    );
  }
}

console.log(`avatar-fit-test ok (${sizers.length} account-row sizing rule(s) checked)`);
