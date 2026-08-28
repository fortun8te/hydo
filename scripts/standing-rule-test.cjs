#!/usr/bin/env node
"use strict";

/**
 * standing-rule-test.cjs — a rule the user sets is true for the WHOLE roster.
 *
 * Shared memory was the only thing teammates had in common, and it is
 * passive: everyone reads it, nothing tells anyone. So "from now on, log
 * every job to ClickUp" landed on whichever teammate happened to be in the
 * conversation, and the other five carried on exactly as before. The user
 * finds that out a week later, by watching it not happen.
 *
 * `RULE:` is the active half. It writes to shared/RULES.md, which rides on
 * every turn for every teammate, AND owes each of the others a one-time note
 * so a bot mid-conversation is actually told rather than left to re-read a
 * file it has no reason to open.
 *
 * RULES.md is deliberately not MEMORY.md: memory is a scratchpad teammates
 * rewrite as they learn, and a rule the user laid down must not be lost
 * because somebody tidied their notes.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const botHome = require("../electron/bot-home.cjs");
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

function stub(reply) {
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
      const out = { text: typeof reply === "function" ? reply(t) : reply };
      h.onDelta(out.text);
      h.onComplete(out);
      return Promise.resolve(out);
    },
  };
  require.cache[gwPath] = { id: gwPath, filename: gwPath, loaded: true, exports: fake };
  delete require.cache[storePath];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-rule-"));
  const store = require("../electron/store.cjs").createStore({ dir });
  store.signIn();
  return { store, dir };
}

(async () => {
  console.log("standing-rule-test");

  await test("the file half: rules are stored, deduped, and kept apart from memory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-rulefile-"));
    assert.equal(botHome.appendRule(dir, "Log every job to ClickUp"), true);
    // Same rule, different case and spacing, must not be added twice.
    assert.equal(botHome.appendRule(dir, "log every  JOB to clickup"), false);
    assert.equal(botHome.appendRule(dir, "Never post without asking"), true);
    assert.equal(botHome.appendRule(dir, "   "), false, "an empty rule was stored");
    const text = botHome.readRules(dir);
    assert.match(text, /Log every job to ClickUp/);
    assert.match(text, /Never post without asking/);
    // Separate file from shared memory, on purpose.
    assert.notEqual(botHome.rulesFile(dir), path.join(dir, "shared", "MEMORY.md"));
    assert.equal(botHome.readSharedMemory(dir), "", "a rule leaked into shared memory");
  });

  await test("the broadcast half: every other teammate is told, once", async () => {
    const { store, dir } = stub((text) =>
      /ClickUp/.test(text) ? 'Got it.\nRULE: {"text":"log every job to ClickUp"}' : "ok"
    );
    const a = store.createAgent({ name: "Chief" }).selectedId;
    store.createAgent({ name: "Writer" });
    store.createAgent({ name: "Designer" });
    store.select(a);
    const st = await store.send("anytime any agent works on something, log it to ClickUp");

    assert.match(botHome.readRules(dir), /log every job to ClickUp/, "the rule was not stored");
    const tally = (st.messages[a] || []).find((m) => m.kind === "tally" && /teammate/.test(m.text));
    assert.ok(tally, "nothing said the roster had been told");
    assert.match(tally.text, /Told 2 teammates/, `wrong count: ${tally && tally.text}`);
  });

  // The rule has to reach the path the APP actually uses.
  //
  // First attempt put it in the `standing()` string, which only feeds the
  // non-Hermes `complete` path. It passed nothing and would have shipped a
  // feature that worked in a test and never once in the product. The real
  // path is streamThroughHermes, which passes the soul and AGENTS.md — so the
  // rule has to be in the teammate's own AGENTS.md, and that is what this
  // asserts: the file on disk, for the OTHER teammate.
  await test("a rule reaches the other teammates' AGENTS.md, which is what the app sends", async () => {
    const { store, dir } = stub('Got it.\nRULE: {"text":"log every job to ClickUp"}');
    const a = store.createAgent({ name: "Chief" }).selectedId;
    const b = store.createAgent({ name: "Writer" }).selectedId;
    store.select(a);
    await store.send("always log work to ClickUp");
    store.select(b);
    await store.send("hello");
    const agentsMd = fs.readFileSync(
      path.join(botHome.workspaceDir(dir, b), "AGENTS.md"),
      "utf8"
    );
    assert.match(agentsMd, /Standing rules/, "the other teammate's prompt has no rules section");
    assert.match(agentsMd, /log every job to ClickUp/, "the other teammate never saw the rule");
  });

  await test("restating a rule does not re-notify anyone", async () => {
    const { store } = stub('RULE: {"text":"log every job to ClickUp"}\nOn it.');
    const a = store.createAgent({ name: "Chief" }).selectedId;
    store.createAgent({ name: "Writer" });
    store.select(a);
    await store.send("log to clickup");
    const st = await store.send("log to clickup again");
    const tallies = (st.messages[a] || []).filter((m) => m.kind === "tally" && /Told/.test(m.text));
    assert.equal(tallies.length, 1, `the roster was notified ${tallies.length} times for one rule`);
  });

  if (failed) {
    console.log(`standing-rule-test FAILED (${failed})`);
    process.exit(1);
  }
  console.log("standing-rule-test ok — one rule, whole roster, told once");
  process.exit(0);
})();
