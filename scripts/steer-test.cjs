"use strict";

// Sending to a teammate that is already working.
//
// Hermes has two different steers and which is right depends on where the work
// actually is. If the teammate delegated, the WORKER is heading the wrong way.
// If the teammate is doing it itself, `session.steer` redirects its live turn.
//
// Hydo only ever called the first. `gateway.steer` sat in preload with a
// comment explaining why it mattered and was called from nowhere, so a message
// sent to a busy teammate that had NOT delegated was filed as a note for the
// next turn — "actually, do it the other way" arrived after the wrong thing
// was already finished.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const src = fs.readFileSync(path.join(__dirname, "../electron/store.cjs"), "utf8");
const gw = fs.readFileSync(path.join(__dirname, "../electron/hermes-gateway.cjs"), "utf8");

// The block that runs when a send lands on a busy teammate.
const i = src.indexOf("if (agent.backgroundTurn || hermesBusy(agent.id))");
assert.ok(i > 0, "the busy path still exists");
const block = src.slice(i, i + 2000);

// ---- worker first, because it is the more precise target -----------------
const atWorker = block.indexOf("steerSubagent");
const atTurn = block.indexOf("gateway.steer(");
assert.ok(atWorker > 0, "a delegated worker is steered");
assert.ok(atTurn > 0, "and the teammate's OWN turn is steered when it has not delegated");
assert.ok(atWorker < atTurn, "worker first: it is the thing actually heading the wrong way");

// ---- the note is the fallback, not the plan ------------------------------
// It lands a turn late, which is worse than steering and much better than
// silence — so it must still be reachable on every failure path.
assert.ok(/const noted = \(\) =>/.test(block), "the note is a named fallback");
assert.ok(
  (block.match(/noted\(\)/g) || []).length >= 4,
  "reachable from both steer failures, the no-path branch, and the throw"
);
// A rejected steer must not vanish: both calls fall back rather than .catch(()=>{}).
assert.ok(!/steerSubagent\([^)]*\)\.catch\(\(\) => \{\}\)/.test(block), "a failed worker steer still notes");
assert.ok(!/gateway\.steer\([^)]*\)\.catch\(\(\) => \{\}\)/.test(block), "a failed turn steer still notes");

// ---- it is logged, because a redirect is a thing that happened -----------
assert.ok(/logAction\(agent\.id, "steer"/.test(block), "steering is recorded in the action log");

// ---- the gateway really exposes both -------------------------------------
assert.ok(/function steer\(botId, text\)/.test(gw), "session.steer wrapper exists");
assert.ok(/function steerSubagent\(botId, subagentId, text\)/.test(gw), "subagent.steer wrapper exists");
assert.ok(/^  steer,$/m.test(gw), "and steer is exported, not just defined");

console.log("steer-test ok");
