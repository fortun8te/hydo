"use strict";

// Routines and a machine that was switched off.
//
// The honest answer to "do my routines run while my computer is off" is NO, and
// this file exists so that answer stays true in code rather than in a comment.
//
// Nothing is running while the Mac is off. Hermes is a local binary; Hydo's own
// poll is a local timer; and the shared Ascii box is STOPPED whenever it is
// idle — which is the whole reason it is affordable, and on the trial tier is
// not even optional, since every box must carry an auto-stop of two hours or
// less. There is no always-on host in this architecture to fire a schedule
// from, so a routine cannot fire at 07:00 on a sleeping machine.
//
// What CAN be true, and what this test pins, is catch-up: a routine whose time
// passed while the app was closed must come due the moment the app is back,
// exactly once, no matter how long it was away. That is the difference between
// "you missed Monday" and "Monday never happened".

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("module");

// No Hermes, and no cron registration side effects.
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === "./hermes-gateway.cjs") {
    return { available: () => false, cron: async () => null };
  }
  return realLoad.call(this, req, ...rest);
};

const { createStore } = require("../electron/store.cjs");

const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

async function main() {
  const store = createStore({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), "hydo-routine-off-")),
    complete: async () => "done",
  });
  store.signIn();
  let st = store.createAgent({ name: "T" });
  const agentId = st.agents[0].id;

  // A routine that came due three days ago, while the machine was off.
  const dueAt = Date.now() - 72 * HOUR;
  store.select(agentId);
  st = store.createRoutine({
    name: "Morning check",
    instruction: "Check the build",
    at: iso(dueAt),
  });
  const routine = (st.routines[agentId] || [])[0];
  assert.ok(routine, "the routine was created");

  // ---- it is due the moment we are back ---------------------------------
  // NOT skipped for being in the past. A routine that quietly drops the runs
  // you were asleep for is worse than one that never existed: you believe it
  // is watching something and it is not.
  let due = store.dueRoutines();
  assert.ok(due.includes(routine.id), "a routine missed while the app was closed is due on return");

  // ---- three days away is ONE run, not three ----------------------------
  // The catch-up is for the occurrence, not for every occurrence that would
  // have happened. Coming back from a holiday to seventy-two identical
  // messages is its own kind of broken.
  assert.equal(due.length, 1, "one missed occurrence, one run");

  // ---- and once it has run, it stops being due --------------------------
  await store.runRoutine(routine.id);
  due = store.dueRoutines();
  assert.ok(!due.includes(routine.id), "a routine that has run is no longer due");

  // ---- a paused routine stays paused across the outage ------------------
  st = store.createRoutine({ name: "Paused one", instruction: "Do not run", at: iso(dueAt) });
  const paused = (st.routines[agentId] || []).find((r) => r.name === "Paused one");
  store.setRoutine(paused.id, { active: false });
  assert.ok(!store.dueRoutines().includes(paused.id), "being switched off does not un-pause anything");

  // ---- a routine still in the future is not due -------------------------
  st = store.createRoutine({ name: "Later", instruction: "Later", at: iso(Date.now() + 6 * HOUR) });
  const later = (st.routines[agentId] || []).find((r) => r.name === "Later");
  assert.ok(!store.dueRoutines().includes(later.id), "a future routine is not dragged forward");

  console.log("routine-offline-test ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
