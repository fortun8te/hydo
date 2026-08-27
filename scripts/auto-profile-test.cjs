"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pickProfile, escalated, LADDER, rank } = require("../electron/auto-profile.cjs");

const ROOT = path.join(__dirname, "..");

// ---- cheap stays cheap ----------------------------------------------------
// The whole point: "hey" must not cost 16.6k of tool schema.
for (const q of ["hey", "yes", "no", "thanks", "what time is it", "how are you", "ok cool"]) {
  assert.equal(pickProfile(q, "chat"), "chat", `"${q}" needs nothing`);
}

// ---- it climbs when the message needs it ----------------------------------
assert.equal(pickProfile("read src/store.js for me", "chat"), "writer", "files -> writer");
assert.equal(pickProfile("open the invoice pdf", "chat"), "writer");
assert.equal(pickProfile("what's the latest grok pricing", "chat"), "researcher", "web -> researcher");
assert.equal(pickProfile("run the tests", "chat"), "builder", "shell -> builder");
assert.equal(pickProfile("commit that and push", "chat"), "builder");
assert.equal(pickProfile("make me a chart of my steps", "chat"), "builder", "artifacts -> builder");
assert.equal(pickProfile("delegate this to three workers", "chat"), "builder");
// A long brief is a real job whatever words it used.
assert.equal(pickProfile("x ".repeat(260), "chat"), "writer", "a long brief is not small talk");
// Attachments mean files even with no filename in the text.
assert.equal(pickProfile("what do you think", "chat", { hasAttachments: true }), "writer");

// ---- ESCALATE ONLY --------------------------------------------------------
// Once a bot has used the shell the transcript is full of shell output it may
// need to reason about. Taking the tool away mid-thread makes it unable to
// follow up on its own work: cheap-then-rich saves a little each turn,
// rich-then-cheap is a broken assistant.
for (const cur of LADDER) {
  const got = pickProfile("hey", cur);
  assert.ok(rank(got) >= rank(cur), `"hey" must not downgrade ${cur}, got ${got}`);
}
assert.equal(pickProfile("thanks", "builder"), "builder", "never falls back down");
assert.equal(pickProfile("read a file", "builder"), "builder");

// ---- a hand-picked profile is a decision ----------------------------------
assert.equal(pickProfile("run the tests", "chat", { pinned: true }), "chat", "pinned wins");
assert.equal(pickProfile("hey", "full", { pinned: true }), "full");

// ---- unsure escalates, because the asymmetry is the design ----------------
// A wrong cheap guess costs a whole wasted turn and a confused reply. A wrong
// rich guess costs only tokens.
assert.ok(rank(pickProfile("can you look at this and sort it out", "chat")) >= rank("writer"));

// ---- never throws on junk -------------------------------------------------
for (const bad of [null, undefined, "", 12, {}, " "]) {
  const got = pickProfile(bad, "chat");
  assert.ok(LADDER.includes(got), `junk input still returns a real profile: ${got}`);
}
assert.ok(LADDER.includes(pickProfile("hey", "nonsense-profile")));

assert.equal(escalated("chat", "builder"), true);
assert.equal(escalated("builder", "chat"), false);
assert.equal(escalated("chat", "chat"), false);

// ---- wired into the turn, and logged --------------------------------------
const store = fs.readFileSync(path.join(ROOT, "electron", "store.cjs"), "utf8");
assert.ok(store.includes("autoProfile.pickProfile"), "the turn asks for a profile");
assert.ok(store.includes("agent.profilePinned"), "and respects a hand-picked one");
assert.ok(/logAction\(agent\.id, "profile"/.test(store), "an escalation is logged, not silent");
assert.ok(store.includes("function logAction"), "there is an action log");
assert.ok(store.includes("listLog"), "and it can be read");

console.log("auto-profile-test ok");
