#!/usr/bin/env node
"use strict";

/**
 * directive-streaming-test.cjs — directives must work in a PLAIN turn.
 *
 * `commitBeat()` fires only on a tool call or a subagent start. A text-only
 * turn therefore never commits: every token lands in the streamed bubble,
 * `leftover` stays empty, and `finishSpeak` was parsing the directives out of
 * an empty string.
 *
 * MEASURED before the fix, through the real store: a teammate replying
 *
 *     Adam it is.
 *     SELF: {"name":"Adam"}
 *
 * with no tool call kept the name "New Bot", AND showed the raw `SELF:` line
 * to the user in the transcript. Renaming, pinging, hiring and memory only
 * landed when the same turn happened to touch a tool, which is exactly why
 * they looked intermittent rather than broken -- and why a teammate asked to
 * rename itself could be told "you're literally called test" and try again.
 *
 * These go through the real store with a stub transport, because the bug is
 * in the seam between streaming and directive extraction; neither half is
 * wrong on its own.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const gwPath = require.resolve("../electron/hermes-gateway.cjs");
const storePath = require.resolve("../electron/store.cjs");

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}

/** A transport that streams `text` in ONE delta and calls no tools. */
function stub(text) {
  const fake = {
    available: () => true,
    hasSession: () => false,
    TOOL_PROFILES: {},
    storedSessionIdOf: () => "s",
    paceFor: () => ({ local: false, reasoningHonoured: true }),
    fastLaneFor: () => "",
    sessionFor: (b) => Promise.resolve({ botId: b, sessionId: `s${b}` }),
    resume: () => Promise.reject(new Error("no resume")),
    compressIfNeeded: () => Promise.resolve({ compressed: false }),
    submit: (b, t, h) => {
      h.onDelta(text);
      h.onComplete({ text });
      return Promise.resolve({ text });
    },
  };
  require.cache[gwPath] = { id: gwPath, filename: gwPath, loaded: true, exports: fake };
  delete require.cache[storePath];
  const store = require("../electron/store.cjs").createStore({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), "hydo-dir-")),
  });
  store.signIn();
  return store;
}

const bubbles = (st, id) =>
  (st.messages[id] || []).filter((m) => m.role === "bot" && m.kind === "chat").map((m) => m.text);

(async () => {
  console.log("directive-streaming-test");

  await test("SELF renames the teammate in a text-only turn", async () => {
    const store = stub('Adam it is.\nSELF: {"name":"Adam"}');
    const id = store.createAgent({ name: "New Bot" }).selectedId;
    store.select(id);
    const st = await store.send("call urself Adam");
    assert.equal(
      st.agents.find((a) => a.id === id).name,
      "Adam",
      "the rename never landed — this is the bug the user hit twice in one thread"
    );
  });

  await test("the raw directive line is not shown to the user", async () => {
    const store = stub('Adam it is.\nSELF: {"name":"Adam"}');
    const id = store.createAgent({ name: "New Bot" }).selectedId;
    store.select(id);
    const st = await store.send("go");
    const shown = bubbles(st, id).join("\n");
    assert.ok(!/SELF:/.test(shown), `the transcript shows machine syntax: ${JSON.stringify(shown)}`);
    assert.match(shown, /Adam it is\./, "the prose was thrown away with the directive");
  });

  await test("a reply that is ONLY a directive posts no empty bubble", async () => {
    const store = stub('SELF: {"name":"Quiet"}');
    const id = store.createAgent({ name: "New Bot" }).selectedId;
    store.select(id);
    const st = await store.send("go");
    assert.equal(st.agents.find((a) => a.id === id).name, "Quiet");
    assert.deepEqual(bubbles(st, id), [], "an empty bubble was left behind");
  });

  await test("ordinary prose is untouched", async () => {
    const store = stub("just a normal answer, nothing special.");
    const id = store.createAgent({ name: "Bot" }).selectedId;
    store.select(id);
    const st = await store.send("go");
    assert.deepEqual(bubbles(st, id), ["just a normal answer, nothing special."]);
  });

  await test("text that merely mentions a directive word is not eaten", async () => {
    const store = stub("the SELF: prefix is how you rename yourself, roughly.");
    const id = store.createAgent({ name: "Bot" }).selectedId;
    store.select(id);
    const st = await store.send("go");
    assert.equal(
      st.agents.find((a) => a.id === id).name,
      "Bot",
      "prose about a directive was executed as one"
    );
    assert.equal(bubbles(st, id).length, 1, "the explanation was dropped");
  });

  if (failed) {
    console.log(`directive-streaming-test FAILED (${failed})`);
    process.exit(1);
  }
  console.log("directive-streaming-test ok — directives land in plain turns, syntax stays hidden");
  process.exit(0);
})();
