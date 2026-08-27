"use strict";

// Typing a name into the rail fires setAgent PER KEYSTROKE. The thread must
// end up with ONE event reading original -> final, not one line per letter.
//
// The coalescing for this shipped broken: its recency guard compared `now()`,
// which is an ISO string, against a number of milliseconds. `string - number`
// is NaN, `NaN < ms` is false, and so the branch was never taken once. The
// test is written against the observable behaviour rather than the guard, so
// any future rewrite of the mechanism still has to produce one line.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createStore } = require("../electron/store.cjs");

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-rename-"));
  const store = createStore({ dir, complete: async () => "ok" });
  store.signIn();
  const s = store.createAgent({ name: "H" });
  return { store, id: s.agents[s.agents.length - 1].id };
}

function events(state, id) {
  return (state.messages[id] || []).filter((m) => m.kind === "event");
}

// ---- typing a name leaves one line ----------------------------------------
{
  const { store, id } = fresh();
  let s;
  for (const n of ["He", "Hea", "Heal", "Healt", "Health"]) s = store.setAgent(id, { name: n });
  const ev = events(s, id);
  assert.equal(ev.length, 1, `one rename line, got ${ev.length}: ${ev.map((e) => e.text)}`);
  assert.equal(ev[0].text, "You renamed H to Health.");
  assert.equal(ev[0].renameFrom, "H", "the pair reads ORIGINAL -> final, not previous -> final");
}

// ---- typing it back to where it started leaves nothing ---------------------
{
  const { store, id } = fresh();
  let s;
  for (const n of ["Ha", "Har", "Ha", "H"]) s = store.setAgent(id, { name: n });
  assert.equal(events(s, id).length, 0, "renamed back to itself is not a rename");
}

// ---- two deliberate renames stay two lines --------------------------------
// Coalescing is a typing artefact fix, not a licence to swallow history: the
// window is a minute, and these are stamped a day apart.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-rename-"));
  let clock = Date.parse("2026-01-01T00:00:00.000Z");
  const store = createStore({
    dir,
    complete: async () => "ok",
    now: () => new Date(clock).toISOString(),
  });
  store.signIn();
  let s = store.createAgent({ name: "H" });
  const id = s.agents[s.agents.length - 1].id;
  s = store.setAgent(id, { name: "Finn" });
  clock += 24 * 60 * 60 * 1000;
  s = store.setAgent(id, { name: "Sage" });
  const ev = events(s, id);
  assert.equal(ev.length, 2, `a day apart is two renames, got ${ev.length}`);
  assert.equal(ev[1].text, "You renamed Finn to Sage.");
}

console.log("rename-test ok");
