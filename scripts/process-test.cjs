"use strict";

// Background processes a teammate left running.
//
// `terminal` is in the `builder` profile, so a teammate can leave a dev server
// or a watcher going after its turn ends, and until now the only way to find
// one was Activity Monitor.
//
// The important half of this is what is NOT wired. Hermes also exposes
// `process.stop`, which is `kill_all()` with NO session scope — on a desk
// where teammates share a gateway it reaps another one's work. Only the two
// session-scoped methods are exposed.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const R = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const gw = R("electron/hermes-gateway.cjs");
const main = R("electron/main.cjs");
const preload = R("electron/preload.cjs");
const rail = R("src/screens/BotRail.jsx");

// ---- session scoped, both of them ----------------------------------------
assert.ok(/'process\.list', \{ session_id: bot\.sessionId \}/.test(gw), "list is scoped to this bot's session");
assert.ok(/process_id: pid/.test(gw) && /'process\.kill'/.test(gw), "kill names one process");
assert.ok(/session_id: bot\.sessionId,\n\s*process_id: pid/.test(gw), "and is scoped too");

// ---- the dangerous one stays unwired -------------------------------------
// This is the assertion that matters. `process.stop` is kill_all across every
// session on the gateway.
assert.ok(!/'process\.stop'/.test(gw), "process.stop is kill_all with no session scope — never expose it");
assert.ok(!/killAll|process\.stop/.test(preload), "and it must not reach the renderer");

// ---- no session yet is an ANSWER, not an error ---------------------------
// A teammate that has never taken a turn has nothing running. The rail should
// show nothing, not an error state.
assert.ok(/\.catch\(\(\) => \[\]\)/.test(gw), "listProcesses degrades to empty rather than rejecting");

// ---- wired end to end ----------------------------------------------------
assert.ok(/hydo:processes/.test(main) && /hydo:killProcess/.test(main), "ipc handlers exist");
assert.ok(/processes: \(agentId\)/.test(preload), "exposed to the renderer");
assert.ok(/window\.hydo\?\.processes\?\.\(agent\.id\)/.test(rail), "and the rail actually calls it");
assert.ok(/window\.hydo\?\.killProcess\?\.\(agent\.id/.test(rail), "and can stop one");

// ---- polled only while the rail is open ----------------------------------
// This is an RPC and a stray background process is rare, so a permanent timer
// costs more than the answer is worth.
assert.ok(/setInterval\(read, 5000\)/.test(rail), "polled on a slow interval");
assert.ok(/clearInterval\(t\)/.test(rail), "and cleaned up when the rail closes");

// ---- the section hides when there is nothing -----------------------------
assert.ok(/\{procs\.length \? \(/.test(rail), "no 'nothing running' row to learn to skip");

console.log("process-test ok");
