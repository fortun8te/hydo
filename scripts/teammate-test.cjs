"use strict";

const assert = require("node:assert/strict");
const { extractDirectives } = require("../electron/store.cjs");

// A bot hiring a permanent teammate, not spawning a throwaway worker.
// The shape mirrors PING: one line, stripped from the bubble, never leaked.

const one = extractDirectives(
  [
    "Spinning someone up for the shop work.",
    'TEAMMATE: {"name":"Hydo Shop","description":"UI + cheap mode","brief":"Own the bot rail."}',
  ].join("\n")
);
assert.equal(one.dirs.teammate.length, 1);
assert.equal(one.dirs.teammate[0].name, "Hydo Shop");
assert.equal(one.dirs.teammate[0].brief, "Own the bot rail.");
assert.equal(one.text, "Spinning someone up for the shop work.", "the directive never reaches a bubble");

// `TEAMMATE: create {...}` is accepted too, the way ROUTINE spells it.
const withCreate = extractDirectives('TEAMMATE: create {"name":"Coms"}');
assert.equal(withCreate.dirs.teammate.length, 1);
assert.equal(withCreate.text, "");

// Several in one turn.
const many = extractDirectives(
  'TEAMMATE: {"name":"A"}\nTEAMMATE: {"name":"B"}\nDone.'
);
assert.equal(many.dirs.teammate.length, 2);
assert.equal(many.text, "Done.");

// Malformed JSON must NOT be swallowed silently — the line stays visible so
// the failure is loud rather than a teammate that never appears.
const broken = extractDirectives('TEAMMATE: {"name": oops}');
assert.equal(broken.dirs.teammate.length, 0);
assert.ok(broken.text.includes("TEAMMATE"), "a broken directive stays in the text");

// Prose that merely mentions the word is not a directive.
const prose = extractDirectives("I could hire a TEAMMATE for this if you want.");
assert.equal(prose.dirs.teammate.length, 0);
assert.equal(prose.text, "I could hire a TEAMMATE for this if you want.");

// The other directives still parse alongside it.
const mixed = extractDirectives(
  'TEAMMATE: {"name":"A"}\nPING: {"name":"Dev","text":"hi"}\nREACT: {"emoji":"\u{1F44D}"}\nok'
);
assert.equal(mixed.dirs.teammate.length, 1);
assert.equal(mixed.dirs.ping.length, 1);
assert.equal(mixed.dirs.react.length, 1);
assert.equal(mixed.text, "ok");

// The store has to actually act on it, and must not steal the selection.
const src = require("node:fs").readFileSync(
  require("node:path").join(__dirname, "..", "electron", "store.cjs"),
  "utf8"
);
assert.ok(src.includes("spawnTeammate"), "the store can hire");
assert.ok(/for \(const spec of extracted\.dirs\.teammate/.test(src), "the turn applies it");

// Slice the function body out rather than regexing across the whole file: an
// unbounded [\s\S]* happily matches something a thousand lines later.
const start = src.indexOf("async function spawnTeammate");
assert.ok(start > 0, "spawnTeammate is a real function");
const body = src.slice(start, src.indexOf("\n  load();", start));
assert.ok(body.length > 200 && body.length < 6000, "sliced the body, not the file");
assert.ok(body.includes("unread: true"), "a hire lands as unread, it does not yank the user");
assert.ok(!/state\.selectedId\s*=/.test(body), "hiring must never move the selection");
assert.ok(body.includes("pushMsg(hirer.id"), "the hirer's thread shows the hire");
assert.ok(body.includes('kind: "tally"'), "and leaves a Messaged tally you can click");

// The soul has to document it, or no bot will ever emit it.
const soul = require("node:fs").readFileSync(
  require("node:path").join(__dirname, "..", "electron", "SOUL.default.md"),
  "utf8"
);
assert.ok(soul.includes("TEAMMATE:"), "soul teaches the directive");
assert.ok(/Never show[\s\S]*TEAMMATE:/.test(soul), "and lists it under Never show");

console.log("teammate-test ok");
