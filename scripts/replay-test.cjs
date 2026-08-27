"use strict";

// Hermes' reconnect contract, client half.
//
// Every event frame carries a per-session `seq`. After a blip the client calls
// `session.events.since` with its watermark and the gateway replays what it
// missed. Hydo tracked the seq and never read it — so the bookkeeping existed,
// the replay did not, and any interruption swallowed mid-stream output in
// silence. That reads as a teammate stopping mid-sentence.
//
// Worse: `rt.lastSeq` was written to without ever being CREATED, so the first
// seq-bearing frame threw `Cannot read properties of undefined (reading
// 'set')` — uncaught, inside a readline handler, which ends the whole event
// stream rather than dropping one frame.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const src = fs.readFileSync(path.join(__dirname, "../electron/hermes-gateway.cjs"), "utf8");

// ---- the Map exists before anything writes to it -------------------------
assert.ok(/lastSeq: new Map\(\)/.test(src), "lastSeq must be created on the runtime");
assert.ok(/replayEpoch: ''/.test(src), "and the epoch alongside it");
// Proof the old shape really did throw, so this test is guarding something real.
assert.throws(() => {
  const rt = { pending: new Map() };
  rt.lastSeq.set("s", 1);
}, TypeError);

// ---- one bad frame may never take down the stream ------------------------
assert.ok(
  /try \{\s*\n\s*handleLine\(rt, line\);\s*\n\s*\} catch/.test(src),
  "the readline handler must be guarded: an uncaught throw there ends the stream"
);

// ---- the watermark is actually READ --------------------------------------
assert.ok(src.includes("session.events.since"), "the replay RPC is called");
assert.ok(/last_seen: since/.test(src), "with the watermark we tracked");
assert.ok(/function replayMissed/.test(src), "there is a replay path");
assert.ok(/replayMissed\(rt, bot\.sessionId\)/.test(src), "and resume triggers it");

// ---- replayed frames go through the SAME dispatch ------------------------
// Hermes returns bare event objects (the frame's `params`) precisely so a
// client can hand them to its existing path. A second dispatch would drift.
const replay = src.slice(src.indexOf("function replayMissed"));
assert.ok(/routeEvent\(rt, ev\)/.test(replay), "replayed frames use the normal route");
assert.ok(/rt\.lastSeq\.set\(sid/.test(replay), "and advance the watermark as they go");

// ---- a gateway restart must reset the watermark --------------------------
// Seq counters live in the gateway PROCESS. After a restart they begin at 1
// while the client still holds a high watermark, so `events.since(sid, 97)`
// returns nothing forever with truncated:false — the client believes it missed
// nothing, and every future replay is empty too. The epoch is the only signal.
assert.ok(/replayEpoch !== epoch/.test(src), "an epoch change is detected on the live path");
assert.ok(/lastSeq\.clear\(\)/.test(src), "and wipes the stale watermarks");
assert.ok(/res\.epoch !== rt\.replayEpoch/.test(replay), "checked on the replay path too");

// ---- a gap is reported, not papered over ---------------------------------
assert.ok(/res\.truncated/.test(replay), "truncation is handled");
assert.ok(/gap on/.test(replay), "and said out loud — a known gap beats a silent one");

console.log("replay-test ok");
