"use strict";

// Clicking is not starting.
//
// The user's words: "if I keep clicking/exiting then obviously don't count that
// as separate fucking starts." On the trial, create, resume AND fork each spend
// one of 5/minute, 25/hour, 75/day — so every avoidable call is a real budget a
// real person runs out of by flicking a panel open and shut.
//
// box-runtime-test.cjs already pins that FIFTY CONCURRENT callers are one start.
// That is a different failure: the in-flight `starting` promise only merges
// callers that overlap in time, and a human clicking twice does not overlap. So
// this file pins the sequential cases:
//   - a status read never starts anything,
//   - repeated status reads inside the cache window are one round-trip,
//   - a second Wake click moments after the first spends nothing,
//   - the local start budget refuses before the wire rather than after it,
//   - stopping drops both the cache and the cooldown, so Stop-then-Wake works.

const assert = require("node:assert/strict");
const {
  createBoxRuntime,
  STATUS_TTL_MS,
  START_COOLDOWN_MS,
  START_WINDOWS,
} = require("../electron/box-runtime.cjs");

/** A fake CLI with a controllable clock, recording every call it is handed. */
function harness({ boxId = "bx_1", state = "stopped" } = {}) {
  const calls = [];
  let stored = boxId;
  let box = boxId ? { id: boxId, state, type: "small" } : null;
  let clock = 1_000_000;
  const rt = createBoxRuntime({
    installed: () => true,
    now: () => clock,
    getBoxId: () => stored,
    setBoxId: (id) => {
      stored = id;
    },
    run: async (args) => {
      calls.push(args.join(" "));
      if (args[0] === "stop" && box) box.state = "stopped";
      return { ok: true, out: "" };
    },
    exec: async (args) => {
      calls.push(args.join(" "));
      const cmd = args[0];
      if (cmd === "status") {
        return { ok: true, json: { account: { loginState: "active", identifier: "t@example.com" } } };
      }
      if (cmd === "limits") return { ok: true, json: { accessTier: "trial", creditBalanceHours: 5 } };
      if (cmd === "info") return box ? { ok: true, json: { box } } : { ok: false, reason: "gone" };
      if (cmd === "resume") {
        box = { ...box, state: "running" };
        return { ok: true, json: { box } };
      }
      if (cmd === "new") {
        box = { id: "bx_new", state: "running", type: "small" };
        return { ok: true, json: { box } };
      }
      if (cmd === "list") return { ok: true, json: { boxes: box ? [box] : [] } };
      return { ok: true, json: {} };
    },
  });
  return {
    rt,
    calls,
    tick: (ms) => {
      clock += ms;
    },
    starts: () => calls.filter((c) => /^(new|resume|fork)\b/.test(c)).length,
    statuses: () => calls.filter((c) => c.startsWith("status")).length,
  };
}

async function main() {
  // ---- opening a panel READS, it never starts ------------------------------
  // "Never resume just because a panel was opened": curiosity is not work.
  {
    const h = harness({ state: "stopped" });
    for (let i = 0; i < 12; i += 1) await h.rt.status();
    assert.equal(h.starts(), 0, "reading status must never spend a start");
  }

  // ---- a burst of opens is ONE round-trip ----------------------------------
  {
    const h = harness();
    await h.rt.status();
    const after = h.calls.length;
    for (let i = 0; i < 20; i += 1) await h.rt.status();
    assert.equal(h.calls.length, after, "20 more reads inside the cache window must cost nothing");
    // And it does expire, or the panel would show a stale machine forever.
    h.tick(STATUS_TTL_MS + 1);
    await h.rt.status();
    assert.ok(h.calls.length > after, "the cache must expire, not pin the state");
  }

  // ---- concurrent reads coalesce too --------------------------------------
  // A rail mount and the Shell header check land in the same tick; without
  // coalescing that is two `box status` calls for one answer.
  {
    const h = harness();
    await Promise.all(Array.from({ length: 8 }, () => h.rt.status()));
    assert.equal(h.statuses(), 1, `8 simultaneous reads must be one status call, got ${h.statuses()}`);
  }

  // ---- click, click, click = ONE start -------------------------------------
  // Sequential, not concurrent: this is the case `starting` cannot catch.
  {
    const h = harness({ state: "stopped" });
    const a = await h.rt.ensureRunning();
    h.tick(300);
    const b = await h.rt.ensureRunning();
    h.tick(300);
    const c = await h.rt.ensureRunning();
    assert.ok(a.ok && b.ok && c.ok, "all three clicks succeed");
    assert.equal(h.starts(), 1, `three clicks must be ONE start, got ${h.starts()}`);
    assert.ok(b.coalesced && c.coalesced, "the later clicks say they were coalesced");
    assert.equal(b.id, a.id, "and they answer with the same machine");
  }

  // ---- a machine that is already running is not started again --------------
  {
    const h = harness({ state: "running" });
    await h.rt.ensureRunning();
    h.tick(START_COOLDOWN_MS + 1000);
    await h.rt.ensureRunning();
    assert.equal(h.starts(), 0, "a running box is never resumed on top of itself");
  }

  // ---- the start budget is enforced BEFORE the wire ------------------------
  // A refused start still costs a round-trip if the API is the one refusing —
  // and teaches the next click nothing.
  {
    const perMinute = START_WINDOWS.find((w) => w.name === "minute").max;
    const h = harness({ state: "stopped" });
    let last = null;
    for (let i = 0; i < perMinute + 3; i += 1) {
      last = await h.rt.ensureRunning();
      // Past the cooldown each time, so only the budget can stop it, and back
      // to sleep so each click has real work to do.
      h.tick(START_COOLDOWN_MS + 1);
      await h.rt.stop();
      h.tick(1);
    }
    assert.equal(h.starts(), perMinute, `the minute budget is ${perMinute}, spent ${h.starts()}`);
    assert.ok(!last.ok && last.reason === "start-budget", "and the caller is told which budget it hit");
    assert.equal(last.window, "minute", "named window so the UI can say it in English");

    // The window slides — it is a budget, not a lockout.
    h.tick(61_000);
    const later = await h.rt.ensureRunning();
    assert.ok(later.ok, "a minute later it may start again");
  }

  // ---- Stop then Wake actually wakes --------------------------------------
  // The nastiest bug the cooldown could have introduced: answering a Wake click
  // from the remembered result of a start whose machine has since been stopped,
  // leaving the UI saying "running" over a machine that is asleep.
  {
    const h = harness({ state: "stopped" });
    await h.rt.ensureRunning();
    assert.equal(h.starts(), 1);
    await h.rt.stop();
    h.tick(200); // well inside the cooldown
    const again = await h.rt.ensureRunning();
    assert.ok(again.ok, "waking after a stop works");
    assert.ok(!again.coalesced, "and it is a real start, not the remembered one");
    assert.equal(h.starts(), 2, "stop-then-wake is genuinely two starts");
  }

  // ---- a stopped machine does not read as running -------------------------
  {
    const h = harness({ state: "stopped" });
    await h.rt.ensureRunning();
    assert.equal((await h.rt.status()).state, "running");
    await h.rt.stop();
    assert.equal((await h.rt.status()).state, "stopped", "stop must drop the cached 'running'");
  }

  // ---- busy is never served from a snapshot -------------------------------
  // The Stop button reads `busy`; a cached zero would offer to yank the machine
  // out from under a job that started a second ago.
  {
    const h = harness({ state: "running" });
    await h.rt.status();
    const release = h.rt.hold("job-1");
    const st = await h.rt.status();
    assert.ok(st.cached, "this answer is the cached one");
    assert.equal(st.busy, 1, "but busy is live, not cached");
    release();
  }

  console.log("box-thrift-test ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ---- source guards: the cheap paths must stay cheap ------------------------
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const runtime = fs.readFileSync(path.join(root, "electron/box-runtime.cjs"), "utf8");
  const rail = fs.readFileSync(path.join(root, "src/screens/ComputerRail.jsx"), "utf8");
  const shell = fs.readFileSync(path.join(root, "src/screens/Shell.jsx"), "utf8");

  // The standing bans, restated here because this file also edits the runtime.
  for (const banned of ["--no-auto-stop", "ttlSeconds: null", "28800"]) {
    if (runtime.includes(banned)) throw new Error(`box-runtime must never contain ${banned}`);
  }

  // `ensureRunning` must not decide "create" from a cached status: an
  // eight-second-old "missing" would create a SECOND machine on a two-machine
  // account.
  if (!/status\(\{ fresh: true \}\)/.test(runtime)) {
    throw new Error("ensureRunning must read status fresh, never from the cache");
  }

  // Nothing that merely LOOKS may start the machine.
  const railOpens = /boxEnsure/.test(rail.slice(rail.indexOf("const refresh"), rail.indexOf("async function wake")));
  if (railOpens) throw new Error("opening the Computer rail must never call boxEnsure");
  if (/boxEnsure/.test(shell)) throw new Error("Shell must only read box status, never start the machine");
  if (/setInterval[\s\S]{0,120}boxStatus/.test(shell)) throw new Error("no polling of a paid API from the header");
}

console.log("box-thrift-test (source guards) ok");
