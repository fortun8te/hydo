"use strict";

// The opening a new teammate gives you.
//
// Every bot ever created said "hey Michael. glad to be here." That was not the
// model being dull: the landing brief in store.cjs literally contained the
// sentence "It is fine to just be glad to be here and stop talking", and the
// soul carried the same words as an example. The bot was reading its
// instructions out loud.
//
// The rule this pins: the brief and the soul may describe the SHAPE of an
// opening. Neither may contain a phrase that would pass as one.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const store = fs.readFileSync(path.join(ROOT, "electron/store.cjs"), "utf8");
const soul = fs.readFileSync(path.join(ROOT, "electron/SOUL.default.md"), "utf8");

// The brief is everything between `const brief = [` and its `.join(" ")`.
const briefBlock = /const brief = \[([\s\S]*?)\]\s*\n\s*\.filter/.exec(store);
assert.ok(briefBlock, "the landing brief is still assembled as a list");
// Comments are allowed to name the old failure; instruction strings are not.
const briefText = briefBlock[1]
  .split("\n")
  .filter((l) => !/^\s*\/\//.test(l))
  .join("\n");

// Phrases that read as a greeting rather than as a description of one. Each of
// these has either shipped as a bot's actual opening or is one word away.
const CANNED = [
  "glad to be here",
  "good to be here",
  "happy to be here",
  "excited to be here",
  "ready when you are",
  "let's get started",
  "at your service",
  "how can i help",
  "what can i do for you",
  "nice to meet you",
];
for (const phrase of CANNED) {
  assert.ok(
    !briefText.toLowerCase().includes(phrase),
    `the landing brief hands the model a ready-made opening: "${phrase}"`
  );
}

// The soul's New thread section, up to the next heading.
const section = /## New thread\n([\s\S]*?)\n## /.exec(soul);
assert.ok(section, "the soul still has a New thread section");
for (const phrase of CANNED) {
  // The section is allowed to quote a phrase it is BANNING (in quotes). It is
  // not allowed to state one as the thing to say.
  const body = section[1].replace(/"[^"]*"/g, "");
  assert.ok(
    !body.toLowerCase().includes(phrase),
    `the soul demonstrates an opening instead of describing one: "${phrase}"`
  );
}

// ---- and it must ask for more than a hello -------------------------------
// The old brief capped the opening at twelve words AND forbade asking
// anything, which left a bare greeting as the only legal output. That is why
// every bot sounded identical whatever model was behind it.
assert.ok(!/under twelve words/i.test(briefText), "no cap that makes a bare hello the only option");
assert.ok(
  /one more thing that is actually yours/i.test(briefText),
  "the brief asks for a second beat"
);
// Something true about THIS moment, so two bots made an hour apart differ.
assert.ok(store.includes("partOfDay"), "the opening has something real to react to");

// ---- the menu ban survives ------------------------------------------------
// This half was right and must not be lost while fixing the other half.
assert.ok(/Not a menu/i.test(briefText), "still no menu");
assert.ok(/No SKIP/.test(briefText), "the opening turn may not be skipped");

console.log("opening-test ok");
