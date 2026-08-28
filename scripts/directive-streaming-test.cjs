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

  // ── the same seam, in every other path ──────────────────────────────────
  //
  // The streaming/extraction seam is not specific to one caller. Every place
  // that asked "did this turn say anything?" read `extracted.text`, which is
  // empty whenever streaming already opened a bubble. Each of these was wrong
  // in its own way, and each is asserted separately because a shared helper
  // that only one caller uses is not a fix.

  await test("a SKIP in a DM leaves no bubble behind", async () => {
    const store = stub("SKIP");
    const id = store.createAgent({ name: "Bot" }).selectedId;
    store.select(id);
    const st = await store.send("you there");
    assert.deepEqual(
      bubbles(st, id),
      [],
      'the literal word "SKIP" was left in the DM transcript'
    );
  });

  await test("a SKIP that also renames still renames", async () => {
    const store = stub('SKIP\nSELF: {"name":"Renamed"}');
    const id = store.createAgent({ name: "Bot" }).selectedId;
    store.select(id);
    const st = await store.send("go");
    assert.equal(
      st.agents.find((a) => a.id === id).name,
      "Renamed",
      "a silent turn threw away its own directives"
    );
    assert.deepEqual(bubbles(st, id), [], "a silent turn still posted something");
  });

  await test("the first-run opening is not doubled by the canned fallback", async () => {
    const store = stub("Hey Michael. What are you in the middle of?");
    const id = store.createAgent({ name: "Bot" }).selectedId;
    await store.landNewBot(id);
    const shown = bubbles(store.getState(), id);
    assert.ok(shown.length >= 1, "no opening at all");
    // The canned landing lines are the fallback for "the model said nothing".
    // Reading `text` made that look true for a streamed opening, so BOTH were
    // printed: the model's line, then the canned ones underneath it.
    assert.ok(
      shown.some((t) => /in the middle of/.test(t)),
      "the model's own opening was lost"
    );
    assert.equal(
      shown.filter((t) => /in the middle of/.test(t)).length,
      shown.length,
      `canned landing lines were printed under the real opening: ${JSON.stringify(shown)}`
    );
  });

  await test("every caller asks about silence the same way", async () => {
    // `extracted.text` is empty for any streamed turn, so testing SKIP against
    // it is always the wrong question. Nothing may go back to doing that.
    const src = fs.readFileSync(path.join(__dirname, "..", "electron", "store.cjs"), "utf8");
    const { stripComments } = require("./lib/source-scan.cjs");
    const code = stripComments(src);
    const bad = code.match(/SKIP[^\n]{0,40}test\(\s*(?:String\()?extracted\.text/g) || [];
    assert.deepEqual(bad, [], `a SKIP check is reading .text instead of .spoken: ${bad.join(", ")}`);
    assert.ok(/function isQuietTurn\(/.test(code), "the shared silence check is gone");
    assert.ok(/function retractTurn\(/.test(code), "the shared bubble retraction is gone");
  });

  if (failed) {
    console.log(`directive-streaming-test FAILED (${failed})`);
    process.exit(1);
  }
  console.log("directive-streaming-test ok — directives land in plain turns, syntax stays hidden");
  process.exit(0);
})();
