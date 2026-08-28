#!/usr/bin/env node
"use strict";

/**
 * local-fallback-test.cjs — a message must not be lost because the machine on
 * the user's desk was asleep.
 *
 * The failure this pins, measured before the fix, with the DEAD `lmstudio`
 * entry that is really in ~/.hermes/config.yaml (nothing listening on
 * localhost:1234): `store.send()` sat for 28.1s and posted one bubble reading
 * "API call failed after 3 retries: Connection error." The endpoint was never
 * named, the question was never answered, and the only recovery was to retype
 * it on another provider by hand.
 *
 * Everything below uses REAL sockets for reachability — a listener that is
 * closed for the offline cases, a real HTTP server serving a real
 * `/v1/models` listing for the healthy one — because a mocked probe would
 * prove only that the mock was mocked. Hermes itself is stubbed: the assertion
 * is WHICH provider a turn was handed, which is exactly what the stub can see
 * and a live Hermes cannot report.
 *
 * The four things that must stay true:
 *   1. the user's message is in the transcript either way;
 *   2. a turn that ran somewhere other than where the user chose SAYS so, in
 *      the transcript, in one plain sentence (never a silent substitution);
 *   3. a healthy local endpoint is left completely alone — the fallback is not
 *      a one-way door onto Grok;
 *   4. with nothing to fall back to, it says that too, and does not pretend.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const gwPath = require.resolve("../electron/hermes-gateway.cjs");
const storePath = require.resolve("../electron/store.cjs");
const fallbackPath = require.resolve("../electron/local-fallback.cjs");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  [FAIL] ${name}\n         ${err.stack || err.message}`);
  }
}

/** A port nobody is listening on: bound, its number read, then closed. */
function deadPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** A real OpenAI-compatible `/v1/models` listing, one loaded model. */
function liveServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "local-model", loaded: true }] }));
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

function writeConfig(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-fallback-cfg-"));
  const file = path.join(dir, "config.yaml");
  const lines = ["providers:"];
  for (const [name, api] of Object.entries(entries)) {
    lines.push(`  ${name}:`);
    lines.push(`    api: ${api}`);
    lines.push(`    api_key: sk-test`);
    lines.push(`    default_model: local-model`);
    lines.push(`    transport: chat_completions`);
  }
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

function freshFallback() {
  delete require.cache[fallbackPath];
  return require("../electron/local-fallback.cjs");
}

/**
 * A Hermes that records the provider each turn was built on.
 * `failLocal` makes the FIRST submit throw, which is the desk PC going to
 * sleep mid-stream — the case the preflight cannot catch.
 */
function stubGateway({ failFirstSubmit = false } = {}) {
  const built = [];
  let submits = 0;
  const fake = {
    available: () => true,
    hasSession: () => false,
    TOOL_PROFILES: {},
    storedSessionIdOf: () => "sess-1",
    paceFor: () => ({ local: false, reasoningHonoured: true }),
    fastLaneFor: () => "",
    sessionFor: (botId, opts) => {
      built.push({ provider: opts.provider, model: opts.model });
      return Promise.resolve({ botId, sessionId: "sess-1" });
    },
    resume: () => Promise.reject(new Error("not resumable in this stub")),
    compressIfNeeded: () => Promise.resolve({ compressed: false }),
    submit: (botId, text, handlers) => {
      submits += 1;
      if (failFirstSubmit && submits === 1) {
        return Promise.reject(new Error("Connection error."));
      }
      handlers.onDelta("answered");
      const out = { text: "answered" };
      handlers.onComplete(out);
      return Promise.resolve(out);
    },
  };
  require.cache[gwPath] = { id: gwPath, filename: gwPath, loaded: true, exports: fake };
  return { built, submits: () => submits };
}

function freshStore() {
  delete require.cache[storePath];
  delete require.cache[fallbackPath];
  return require("../electron/store.cjs").createStore;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydo-fallback-"));
}

function threadOf(state, id) {
  return state.messages[id] || [];
}

async function main() {
  console.log("local-fallback-test");

  // ── unit: the decision, against real sockets ───────────────────────────
  const dead = await deadPort();
  const live = await liveServer();

  {
    const file = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    const fb = freshFallback();
    // CHANGED with the ask: a dead endpoint no longer routes anywhere by
    // itself, it asks. The hosted answer is still the one on offer.
    const out = await fb.check("box", { file, hostedReady: () => true, agentId: "bot-1" });
    await test("a local endpoint with nothing listening ASKS instead of rerouting", () => {
      assert.equal(out.run, "ask");
      assert.equal(out.provider, "xai-oauth");
      assert.match(out.question, /grok-4\.6/i);
      assert.match(out.question, /\?$/, "it has to actually be a question");
    });
    await test("the question names the endpoint that is down, not just 'an error'", () => {
      assert.ok(out.question.includes("box"), `must name the provider: ${out.question}`);
      assert.ok(out.question.includes("127.0.0.1"), `must name the host: ${out.question}`);
    });
    await test("with the session yes already given it reroutes, and still says so", () => {
      fb.grant("bot-1", "box");
      return fb.check("box", { file, hostedReady: () => true, agentId: "bot-1" }).then((yes) => {
        assert.equal(yes.run, "hosted");
        assert.match(yes.note, /instead of box/i);
        fb.forget("bot-1");
      });
    });
  }

  {
    const file = writeConfig({ box: `http://127.0.0.1:${live.port}/v1` });
    const fb = freshFallback();
    const out = await fb.check("box", { file, hostedReady: () => true });
    await test("a local endpoint that answers is left alone", () => {
      assert.deepEqual(out, { run: "local" });
    });
  }

  {
    const file = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    const fb = freshFallback();
    const out = await fb.check("box", { file, hostedReady: () => false });
    await test("with no hosted model signed in it says so instead of inventing one", () => {
      assert.equal(out.run, "none");
      assert.match(out.note, /saved/i);
      assert.ok(!/Answered on/.test(out.note), "must not claim an answer it did not get");
    });
  }

  {
    // A hosted provider is not this module's business: no probe, no rerouting.
    const file = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    const fb = freshFallback();
    const out = await fb.check("xai-oauth", { file, hostedReady: () => true });
    await test("hosted providers are never rerouted", () => {
      assert.deepEqual(out, { run: "local" });
    });
  }

  {
    // Bounded: the probe result is cached, so a burst of turns does not become
    // a poll against a machine that is off.
    const file = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    const fb = freshFallback();
    let probes = 0;
    const probe = async () => {
      probes += 1;
      return { state: "offline", detail: "down" };
    };
    const at = 1_000_000;
    await fb.check("box", { file, probe, hostedReady: () => true, now: () => at });
    await fb.check("box", { file, probe, hostedReady: () => true, now: () => at + 1000 });
    await test("repeat turns inside the cache window do not re-probe a dead port", () => {
      assert.equal(probes, 1, "second turn must reuse the cached verdict");
    });
    await fb.check("box", { file, probe, hostedReady: () => true, now: () => at + 60_000 });
    await test("a stale bad verdict expires, so a woken machine is used again", () => {
      assert.equal(probes, 2);
    });
  }

  // ── the real turn: store.send() with a dead local endpoint ──────────────
  const prevCfg = process.env.HYDO_HERMES_CONFIG;
  const prevAuth = process.env.HYDO_HOSTED_AUTH;
  try {
    process.env.HYDO_HERMES_CONFIG = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    process.env.HYDO_HOSTED_AUTH = "1";
    const { built } = stubGateway();
    const createStore = freshStore();
    const store = createStore({ dir: tmpDir() });
    store.signIn();
    const id = store.createAgent({ name: "Ada" }).selectedId;
    store.setAgent(id, { provider: "box", model: "local-model" });
    store.select(id);
    const state = await store.send("does this survive the box being off?");
    const msgs = threadOf(state, id);
    const card = msgs.find((m) => m.kind === "clarify" && m.reroute);

    await test("the user's message is in the transcript even though the box was off", () => {
      assert.ok(
        msgs.some((m) => m.role === "user" && m.text.includes("survive the box being off")),
        "the typed message must never be lost"
      );
    });
    // CHANGED: it asks first. Running anywhere else before this card is
    // answered is the exact thing the user asked to stop.
    await test("the transcript ASKS before running anywhere else", () => {
      assert.ok(card, `expected a question, got ${JSON.stringify(msgs.map((m) => m.text))}`);
      assert.match(card.text, /box/);
      assert.match(card.text, /grok-4\.6/);
      assert.equal(card.choices.length, 2);
    });
    await test("and nothing has been built or answered while the question stands", () => {
      assert.equal(built.length, 0, "no session may exist before the user agrees");
      assert.ok(!msgs.some((m) => m.role === "bot" && m.kind === "chat"), "no bubble either");
    });
    await test("the bot is not left spinning on an unanswered question", () => {
      assert.equal(store.getState().agents.find((x) => x.id === id).status, "idle");
    });

    // ── answering yes ────────────────────────────────────────────────────
    const after = await store.answerClarify(card.id, card.choices[0].text);
    const msgs2 = threadOf(after, id);
    await test("saying yes runs the ORIGINAL message on the hosted model", () => {
      assert.ok(built.length, "a session must have been built");
      assert.equal(built[built.length - 1].provider, "xai-oauth");
      assert.equal(built[built.length - 1].model, "grok-4.6");
    });
    await test("the substitution is still announced in plain words", () => {
      const note = msgs2.find((m) => m.kind === "event" && /instead of box/i.test(m.text || ""));
      assert.ok(note, `expected a substitution note, got ${JSON.stringify(msgs2.map((m) => m.text))}`);
      assert.match(note.text, /grok-4\.6/);
    });
    await test("and the user got an answer", () => {
      assert.ok(msgs2.some((m) => m.role === "bot" && m.text === "answered"));
    });

    // ── the session memory: it does not ask again ────────────────────────
    const again = await store.send("and this one too");
    const msgs3 = threadOf(again, id);
    await test("a second message this session is not re-asked", () => {
      assert.equal(
        msgs3.filter((m) => m.kind === "clarify" && m.reroute).length,
        1,
        "asking once per message would be intolerable"
      );
      assert.equal(built[built.length - 1].provider, "xai-oauth");
    });
    await test("but it still says so every time — consent is not permission to be quiet", () => {
      assert.equal(
        msgs3.filter((m) => m.kind === "event" && /instead of box/i.test(m.text || "")).length,
        2
      );
    });

    // ── and declining ────────────────────────────────────────────────────
    // A different teammate, because the first one has already said yes.
    const id2 = store.createAgent({ name: "Bo" }).selectedId;
    store.setAgent(id2, { provider: "box", model: "local-model" });
    store.select(id2);
    const builtBefore = built.length;
    const s4 = await store.send("no thanks, wait for my machine");
    const card2 = threadOf(s4, id2).find((m) => m.kind === "clarify" && m.reroute);
    const s5 = await store.answerClarify(card2.id, card2.choices[1].text);
    const msgs5 = threadOf(s5, id2);
    await test("declining runs NOTHING, anywhere", () => {
      assert.equal(built.length, builtBefore, "a no must not build a session");
      assert.ok(!msgs5.some((m) => m.role === "bot" && m.kind === "chat"));
    });
    await test("declining says so in a plain sentence, and the message is still there", () => {
      const said = msgs5.find((m) => m.kind === "event" && /Nothing ran/i.test(m.text || ""));
      assert.ok(said, `expected a plain refusal, got ${JSON.stringify(msgs5.map((m) => m.text))}`);
      assert.match(said.text, /send it again/i);
      assert.ok(msgs5.some((m) => m.role === "user" && m.text.includes("no thanks")));
    });
    await test("a no is not remembered as a yes for the next message", () => {
      return store.send("second try").then((s6) => {
        assert.equal(
          threadOf(s6, id2).filter((m) => m.kind === "clarify" && m.reroute).length,
          2,
          "declining must leave the next turn asking again, not silently routed"
        );
      });
    });
  } finally {
    delete require.cache[gwPath];
    if (prevCfg == null) delete process.env.HYDO_HERMES_CONFIG;
    else process.env.HYDO_HERMES_CONFIG = prevCfg;
    if (prevAuth == null) delete process.env.HYDO_HOSTED_AUTH;
    else process.env.HYDO_HOSTED_AUTH = prevAuth;
  }

  // ── the dead-control case: a HEALTHY box must still be used ─────────────
  try {
    process.env.HYDO_HERMES_CONFIG = writeConfig({ box: `http://127.0.0.1:${live.port}/v1` });
    process.env.HYDO_HOSTED_AUTH = "1";
    const { built } = stubGateway();
    const createStore = freshStore();
    const store = createStore({ dir: tmpDir() });
    store.signIn();
    const id = store.createAgent({ name: "Ada" }).selectedId;
    store.setAgent(id, { provider: "box", model: "local-model" });
    store.select(id);
    const state = await store.send("run this on my own machine");
    const msgs = threadOf(state, id);
    await test("a healthy local endpoint still runs the turn (no one-way door onto Grok)", () => {
      assert.equal(built[built.length - 1].provider, "box");
      assert.equal(built[built.length - 1].model, "local-model");
    });
    await test("and nothing is announced, because nothing was substituted", () => {
      assert.ok(
        !msgs.some((m) => m.kind === "event" && /instead of/i.test(m.text || "")),
        "a note with no substitution behind it would be its own lie"
      );
    });
  } finally {
    delete require.cache[gwPath];
  }

  // ── mid-turn death: the box slept AFTER the probe said it was fine ──────
  try {
    process.env.HYDO_HERMES_CONFIG = writeConfig({ box: `http://127.0.0.1:${live.port}/v1` });
    process.env.HYDO_HOSTED_AUTH = "1";
    const { built, submits } = stubGateway({ failFirstSubmit: true });
    const createStore = freshStore();
    const store = createStore({ dir: tmpDir() });
    store.signIn();
    const id = store.createAgent({ name: "Ada" }).selectedId;
    store.setAgent(id, { provider: "box", model: "local-model" });
    store.select(id);
    const state = await store.send("die halfway through this one");
    const msgs = threadOf(state, id);
    // CHANGED with the ask: a mid-stream death is not silently retried
    // somewhere else either. The rule is "never run a turn somewhere the user
    // did not agree to", and it does not stop applying because the box died
    // halfway through instead of before the start.
    const midCard = msgs.find((m) => m.kind === "clarify" && m.reroute);
    await test("a turn that dies mid-stream asks instead of retrying elsewhere", () => {
      assert.ok(midCard, `expected a question, got ${JSON.stringify(msgs.map((m) => m.text))}`);
      assert.match(midCard.text, /box/);
      assert.match(midCard.text, /Connection error/);
      assert.match(midCard.text, /grok-4\.6/);
    });
    await test("nothing was resubmitted while the question stood", () => {
      assert.equal(submits(), 1, "one local attempt, and no unapproved second one");
      assert.equal(built[built.length - 1].provider, "box");
    });
    await test("saying yes finishes the job the box dropped", () => {
      return store.answerClarify(midCard.id, midCard.choices[0].text).then((after) => {
        const t = threadOf(after, id);
        assert.equal(submits(), 2, "exactly one more attempt — not a loop");
        assert.ok(
          t.some((m) => m.role === "bot" && m.text === "answered"),
          "the dropped turn must actually get answered"
        );
      });
    });
  } finally {
    delete require.cache[gwPath];
  }

  // ── nothing to fall back to: honest, and the message still stands ───────
  try {
    process.env.HYDO_HERMES_CONFIG = writeConfig({ box: `http://127.0.0.1:${dead}/v1` });
    process.env.HYDO_HOSTED_AUTH = "0";
    const { built } = stubGateway();
    const createStore = freshStore();
    const store = createStore({ dir: tmpDir() });
    store.signIn();
    const id = store.createAgent({ name: "Ada" }).selectedId;
    store.setAgent(id, { provider: "box", model: "local-model" });
    store.select(id);
    const state = await store.send("no hosted model to save me");
    const msgs = threadOf(state, id);
    await test("with nothing to fall back to, the message is still in the transcript", () => {
      assert.ok(msgs.some((m) => m.role === "user" && m.text.includes("no hosted model")));
    });
    await test("and the app says nothing ran, rather than going quiet", () => {
      const note = msgs.find((m) => m.kind === "event" && /Didn't run this/i.test(m.text || ""));
      assert.ok(note, `expected an explicit refusal, got ${JSON.stringify(msgs.map((m) => m.text))}`);
      assert.match(note.text, /saved/i);
    });
    await test("no turn was submitted anywhere, and no bot bubble was faked", () => {
      assert.equal(built.length, 0, "nothing may be built when there is nowhere to run");
      assert.ok(
        !msgs.some((m) => m.role === "bot" && m.kind === "chat"),
        "a bot bubble here would be an answer nobody gave"
      );
    });
    await test("the bot is not left spinning", () => {
      const a = store.getState().agents.find((x) => x.id === id);
      assert.equal(a.status, "idle");
    });
  } finally {
    delete require.cache[gwPath];
    if (prevCfg == null) delete process.env.HYDO_HERMES_CONFIG;
    else process.env.HYDO_HERMES_CONFIG = prevCfg;
    if (prevAuth == null) delete process.env.HYDO_HOSTED_AUTH;
    else process.env.HYDO_HOSTED_AUTH = prevAuth;
  }

  live.srv.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
