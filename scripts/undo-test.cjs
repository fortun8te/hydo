"use strict";

// Undo the last exchange.
//
// Not the file rollback Hydo already ships: that puts FILES back, this makes
// the model forget. Conflating them would be the worst outcome available, so
// they are named for what each actually does.
//
// The thing this must never do is desync. Hermes' history and Hydo's thread
// are two stores; rewinding one leaves the visible chat and the model's memory
// disagreeing about what was said, which is worse than no undo at all —
// the next turn answers a question you can still see and it cannot.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("module");

// Stub the gateway so this needs no Hermes running.
let removed = 2;
let throws = null;
const realLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === "./hermes-gateway.cjs") {
    return {
      undoTurn: async () => {
        if (throws) throw new Error(throws);
        return { removed };
      },
    };
  }
  return realLoad.call(this, req, ...rest);
};

const { createStore } = require("../electron/store.cjs");
const chat = (st, id) => (st.messages[id] || []).filter((m) => m.kind === "chat");

async function main() {
  const store = createStore({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), "hydo-undo-")),
    complete: async () => "reply",
  });
  store.signIn();
  let st = store.createAgent({ name: "T" });
  const id = st.agents[0].id;
  await store.send(id, "first");
  await store.send(id, "second");
  assert.equal(chat(store.getState(), id).length, 4, "two exchanges to start");

  // ---- both halves, or neither ------------------------------------------
  st = await store.undoLast(id);
  assert.equal(chat(st, id).length, 2, "the last exchange leaves the transcript too");
  // Trimmed back to and INCLUDING the user's message. Popping only the reply
  // would leave the prompt sitting there with nothing under it, which reads as
  // a message that was ignored.
  const left = chat(st, id);
  assert.equal(left[left.length - 1].role, "bot", "the previous exchange is intact");

  // ---- a refusal must not trim ------------------------------------------
  // Hermes refuses mid-turn on purpose rather than racing prompt.submit's own
  // history write. If Hydo trimmed anyway, the transcript would lose a turn
  // the model still remembers — the exact desync this guards.
  throws = "session busy — /interrupt the current turn before /undo";
  const beforeBusy = chat(store.getState(), id).length;
  st = await store.undoLast(id);
  assert.equal(chat(st, id).length, beforeBusy, "a busy refusal changes nothing");
  const ev = (st.messages[id] || []).filter((m) => m.kind === "event").pop();
  assert.ok(/still working/i.test(ev.text), "and says so, actionably");
  throws = null;

  // ---- Hermes removing nothing means we remove nothing -------------------
  removed = 0;
  const beforeZero = chat(store.getState(), id).length;
  st = await store.undoLast(id);
  assert.equal(chat(st, id).length, beforeZero, "removed:0 trims nothing");
  removed = 2;

  // ---- the two undos stay distinct in the UI -----------------------------
  const rail = fs.readFileSync(path.join(__dirname, "../src/screens/BotRail.jsx"), "utf8");
  assert.ok(/Forget the last message/.test(rail), "the memory one is named for what it does");
  assert.ok(/Put back files this Bot changed/.test(rail), "and the file one still says files");
  assert.ok(/undoLast\?\.\(agent\?\.id\)/.test(rail), "wired");

  const store2 = fs.readFileSync(path.join(__dirname, "../electron/store.cjs"), "utf8");
  assert.ok(/if \(!removed\) return publicState\(\);/.test(store2), "no trim without confirmation");
  assert.ok(/logAction\(agent\.id, "undo"/.test(store2), "an undo is recorded");

  console.log("undo-test ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
