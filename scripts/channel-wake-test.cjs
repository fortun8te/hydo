#!/usr/bin/env node
"use strict";

/**
 * channel-wake-test.cjs — a channel is a wake queue, not a round-robin.
 *
 * The old loop ran CHANNEL_ROUNDS (3) rounds x every member, each awaited in
 * turn. Six members was up to EIGHTEEN sequential model turns for one message:
 * eighteen turns of latency, and a full turn burned by every member that only
 * wanted to say SKIP. The rounds existed to fake a back-and-forth
 * synchronously.
 *
 * Grok Bot's shape instead: idle until woken, and quiet costs nothing extra.
 * One concurrent wake per member, and a SECOND turn only when a teammate
 * actually addresses someone by name -- an event, not a timer.
 *
 * These assertions COUNT REAL TURNS through a stub gateway and measure their
 * overlap in wall-clock, because "18 -> 6" and "sequential -> concurrent" are
 * claims about behaviour that a structural test cannot make. The stub is the
 * only fake part: the store, the channel loop and the directive parsing are
 * the real ones.
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

/**
 * @param reply  (botName, askText) => string   what that member says
 * @param delay  ms each turn takes, so overlap is observable
 */
function stubGateway(reply, delay = 60) {
  const turns = [];
  let live = 0;
  let peakLive = 0;
  const names = new Map();
  const fake = {
    available: () => true,
    hasSession: () => false,
    TOOL_PROFILES: {},
    storedSessionIdOf: () => "sess-1",
    paceFor: () => ({ local: false, reasoningHonoured: true }),
    fastLaneFor: () => "",
    sessionFor: (botId, opts) => {
      names.set(botId, (opts && opts.title) || botId);
      return Promise.resolve({ botId, sessionId: `sess-${botId}` });
    },
    resume: () => Promise.reject(new Error("no resume in this stub")),
    compressIfNeeded: () => Promise.resolve({ compressed: false }),
    submit: (botId, text, handlers) => {
      live += 1;
      peakLive = Math.max(peakLive, live);
      turns.push({ botId, text, at: Date.now() });
      return new Promise((resolve) => {
        setTimeout(() => {
          live -= 1;
          const out = { text: reply(names.get(botId) || botId, String(text || "")) };
          handlers.onDelta(out.text);
          handlers.onComplete(out);
          resolve(out);
        }, delay);
      });
    },
  };
  require.cache[gwPath] = { id: gwPath, filename: gwPath, loaded: true, exports: fake };
  return {
    turns,
    peak: () => peakLive,
    nameOf: (id) => names.get(id) || id,
  };
}

function freshStore() {
  delete require.cache[storePath];
  return require("../electron/store.cjs").createStore({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), "hydo-wake-")),
  });
}

/** Build a channel with `n` members and return {store, ch, ids, names}. */
function channelOf(store, n) {
  const ids = [];
  const names = [];
  for (let i = 0; i < n; i += 1) {
    const name = `Bot${i + 1}`;
    names.push(name);
    ids.push(store.createAgent({ name }).selectedId);
  }
  const st = store.createChannel({ name: "room", members: ids });
  const ch = (st.channels || [])[0];
  assert.ok(ch, "no channel was created");
  return { ch, ids, names };
}

(async () => {
  console.log("channel-wake-test");

  await test("six quiet members cost six turns, not eighteen", async () => {
    const gw = stubGateway(() => "SKIP");
    const store = freshStore();
    store.signIn();
    const { ch } = channelOf(store, 6);
    store.select(ch.id);
    await store.send("anyone got thoughts");
    assert.equal(
      gw.turns.length,
      6,
      `one message cost ${gw.turns.length} turns for six members — the rounds are back`
    );
  });

  await test("all six are woken at once, not one after another", async () => {
    // 200ms per turn, so the RATIO between serial and concurrent dominates the
    // fixed overhead of six real store turns. An earlier version used 80ms and
    // an absolute 300ms bar, which passed alone and failed inside the full
    // suite at 304ms -- a machine-load flake dressed up as a regression. The
    // overlap count below is the deterministic proof; the clock is the
    // sanity check, and it needs room.
    const gw = stubGateway(() => "SKIP", 200);
    const store = freshStore();
    store.signIn();
    const { ch } = channelOf(store, 6);
    store.select(ch.id);
    const t0 = Date.now();
    await store.send("hello");
    const elapsed = Date.now() - t0;
    assert.equal(gw.peak(), 6, `only ${gw.peak()} turns overlapped — the wave is still serial`);
    // Serial would be 6 x 200ms = 1200ms. Concurrent is ~200ms plus overhead;
    // anything under half the serial time cannot be a sequential run.
    assert.ok(
      elapsed < 600,
      `six concurrent 200ms turns took ${elapsed}ms — serial would be ~1200ms, so this is sequential`
    );
  });

  await test("silence leaves no trace in the transcript", async () => {
    stubGateway(() => "SKIP");
    const store = freshStore();
    store.signIn();
    const { ch } = channelOf(store, 4);
    store.select(ch.id);
    const st = await store.send("quiet please");
    const bot = (st.messages[ch.id] || []).filter((m) => m.role === "bot" && m.kind === "chat");
    assert.equal(bot.length, 0, "a SKIP was posted as a message");
  });

  await test("a member who speaks is posted", async () => {
    stubGateway((name) => (name === "Bot2" ? "I have something." : "SKIP"));
    const store = freshStore();
    store.signIn();
    const { ch } = channelOf(store, 4);
    store.select(ch.id);
    const st = await store.send("go");
    const bot = (st.messages[ch.id] || []).filter((m) => m.role === "bot" && m.kind === "chat");
    assert.equal(bot.length, 1, `expected one reply, got ${bot.length}`);
    assert.match(bot[0].text, /I have something/);
  });

  await test("no scheduled second round: nobody is woken twice for nothing", async () => {
    const gw = stubGateway((name) => (name === "Bot1" ? "Just me talking." : "SKIP"));
    const store = freshStore();
    store.signIn();
    const { ch } = channelOf(store, 5);
    store.select(ch.id);
    await store.send("go");
    assert.equal(gw.turns.length, 5, "a follow-up round ran even though nobody was addressed");
  });

  await test("addressing a teammate by name DOES wake them, once", async () => {
    let asked = 0;
    const gw = stubGateway((name, text) => {
      if (name === "Bot1" && !/said to you/.test(text)) {
        return 'Bot2 what do you reckon\nPING: {"name":"Bot2","text":"what do you reckon"}';
      }
      if (name === "Bot2" && /said to you/.test(text)) {
        asked += 1;
        return "Reckon it is fine.";
      }
      return "SKIP";
    });
    const store = freshStore();
    store.signIn();
    const { ch } = channelOf(store, 3);
    store.select(ch.id);
    const st = await store.send("go");
    assert.equal(asked, 1, "the addressed teammate was not woken");
    // 3 members + 1 peer wake.
    assert.equal(gw.turns.length, 4, `expected 3 wakes plus 1 peer wake, got ${gw.turns.length}`);
    const texts = (st.messages[ch.id] || []).filter((m) => m.role === "bot").map((m) => m.text);
    assert.ok(texts.some((t) => /Reckon it is fine/.test(t)), "the answer never reached the channel");
  });

  await test("two bots pinging each other terminate instead of looping", async () => {
    const gw = stubGateway((name) => {
      if (name === "Bot1") return 'over to you\nPING: {"name":"Bot2","text":"你"}';
      if (name === "Bot2") return 'back to you\nPING: {"name":"Bot1","text":"no you"}';
      return "SKIP";
    });
    const store = freshStore();
    store.signIn();
    const { ch } = channelOf(store, 2);
    store.select(ch.id);
    await store.send("go");
    // 2 initial + at most 2 more each, hard-stopped by the wake cap.
    assert.ok(gw.turns.length <= 6, `a ping loop ran ${gw.turns.length} turns — it is not bounded`);
    assert.ok(gw.turns.length >= 3, "the ping never woke anyone at all");
  });

  await test("a ping at someone outside the room does not wake them here", async () => {
    const gw = stubGateway((name) =>
      name === "Bot1" ? 'asking\nPING: {"name":"Outsider","text":"hi"}' : "SKIP"
    );
    const store = freshStore();
    store.signIn();
    const { ch, ids } = channelOf(store, 2);
    const outsider = store.createAgent({ name: "Outsider" }).selectedId;
    assert.ok(outsider && !ids.includes(outsider));
    store.select(ch.id);
    await store.send("go");
    const outsiderTurns = gw.turns.filter((t) => t.botId === outsider);
    assert.equal(outsiderTurns.length, 0, "a non-member was woken by a channel ping");
  });

  if (failed) {
    console.log(`channel-wake-test FAILED (${failed})`);
    process.exit(1);
  }
  console.log("channel-wake-test ok — one wake each, concurrent, follow-ups only when addressed");
  process.exit(0);
})();
