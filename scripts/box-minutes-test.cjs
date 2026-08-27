"use strict";

/**
 * box-minutes-test.cjs — the machine is billed PER SECOND while awake, so this
 * file guards the seconds and the starts, not the tokens. `box-thrift-test.cjs`
 * already pins "a click is not a start"; this one pins "an idle machine is not
 * a running one, and a closed app is not an awake box".
 *
 * Every number asserted here was MEASURED against bx_843rh875 on 2026-08-27
 * with the real CLI, and the measurement is recorded next to the assertion:
 *
 *   `box stop`   API call returned in 0.22s; the box then sat in `stopping`
 *                for 9 more seconds before reaching `stopped`. Awake seconds.
 *   `box resume` returned `ready` in 0.28s, but the first `box exec` that
 *                actually succeeded was 5.6s later — 5.9s cold-to-usable.
 *   `box info --json` carries NO ttl/autoStop field. The server-side backstop
 *                is unobservable, so it has to be asserted on every resume.
 *
 * One sleep-and-wake cycle is therefore ~15 billed seconds plus ONE start.
 *
 * Usage: node scripts/box-minutes-test.cjs   (exit 0 on success)
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createBoxRuntime,
  DEFAULT_TTL,
  TRIAL_MAX_TTL,
  IDLE_STOP_MS,
  IDLE_STOP_MAX_MS,
  RESUME_TO_USABLE_MS,
  STOP_TAIL_MS,
  CYCLE_COST_MS,
  QUIT_STOP_BUDGET_MS,
  START_WINDOWS,
} = require("../electron/box-runtime.cjs");

let passed = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  [PASS] ${name}`);
    })
    .catch((err) => {
      failures.push(name);
      console.log(`  [FAIL] ${name}\n         ${err.message}`);
    });
}

/** A fake CLI that records every call and lets a test drive the box's state. */
function harness({ boxId = "bx_1", state = "stopped", now, settleAfter = 0 } = {}) {
  const calls = [];
  let stored = boxId;
  let box = { id: boxId, state, type: "default" };
  // How the 9-second tail behaves: the box answers `stopping` for a while and
  // then answers `stopped`, without anyone spending a start on it.
  let polls = 0;
  const rt = createBoxRuntime({
    installed: () => true,
    now: now || (() => Date.now()),
    // No real waiting: the `stopping` settle loop is 9 measured seconds of
    // machine time, and a test that spends them is a test nobody runs.
    sleep: async () => {},
    getBoxId: () => stored,
    setBoxId: (id) => {
      stored = id;
    },
    run: async (args) => {
      calls.push(args.join(" "));
      return { ok: true, out: "" };
    },
    exec: async (args) => {
      calls.push(args.join(" "));
      const cmd = args[0];
      if (cmd === "status") {
        return { ok: true, json: { account: { loginState: "active", identifier: "t@example.com" } } };
      }
      if (cmd === "limits") return { ok: true, json: { accessTier: "trial" } };
      if (cmd === "info") {
        polls += 1;
        if (settleAfter && polls > settleAfter && box.state === "stopping") box = { ...box, state: "stopped" };
        return { ok: true, json: { box } };
      }
      if (cmd === "resume") {
        box = { ...box, state: "running" };
        return { ok: true, json: { box } };
      }
      return { ok: true, json: {} };
    },
  });
  return {
    rt,
    calls,
    setState: (s) => {
      box = { ...box, state: s };
    },
  };
}

async function main() {
  // ---- the break-even is measured, and the window clears it ---------------
  // 9s of `stopping` tail + 5.9s of cold-to-usable resume = ~15 billed seconds
  // per nap. An idle second on a 1x box costs one billed second, so any quiet
  // stretch longer than the cycle is already cheaper asleep. The old 10-minute
  // window was 600s against a 15s cycle: 40x past break-even.
  await test("the idle window is set by STARTS, not by the seconds break-even", () => {
    assert.equal(CYCLE_COST_MS, RESUME_TO_USABLE_MS + STOP_TAIL_MS);
    assert.ok(CYCLE_COST_MS < 20_000, "a measured cycle is seconds, not minutes");
    assert.ok(
      IDLE_STOP_MS > CYCLE_COST_MS,
      "the window must at least cover the cycle it is trying to avoid"
    );
    // The real constraint: the local hourly budget is 24 starts. A window of T
    // minutes costs at most 60/T wakes an hour in the alternating case, so T
    // must be >= 60/24 = 2.5 minutes or the sweep alone can starve a real job.
    const hour = START_WINDOWS.find((w) => w.name === "hour");
    const worstWakesPerHour = 3_600_000 / IDLE_STOP_MS;
    assert.ok(
      worstWakesPerHour <= hour.max,
      `a ${IDLE_STOP_MS / 60000}min window can cost ${worstWakesPerHour} wakes/hour against a budget of ${hour.max}`
    );
    // And it must still be far under the trial's 2h auto-stop ceiling, or the
    // sweep is decoration.
    assert.ok(IDLE_STOP_MAX_MS < TRIAL_MAX_TTL * 1000, "even the widest window beats the server's");
  });

  // ---- the window widens as the day's starts run out ----------------------
  // A start refused at 6pm is a teammate that cannot work. Sleeping is an
  // optimisation; being unable to wake is an outage.
  await test("a drained start budget widens the idle window instead of napping", async () => {
    let t = 1_000_000;
    const h = harness({ now: () => t });
    assert.equal(h.rt.idleStopMs(), IDLE_STOP_MS, "a fresh budget uses the tight window");

    // Spend most of the day's budget, one start at a time, spread far enough
    // apart that the per-minute and per-hour windows never refuse.
    const day = START_WINDOWS.find((w) => w.name === "day");
    for (let i = 0; i < Math.ceil(day.max * 0.85); i += 1) {
      h.setState("stopped");
      await h.rt.ensureRunning();
      t += 6 * 60 * 1000;
    }
    assert.equal(
      h.rt.idleStopMs(),
      IDLE_STOP_MAX_MS,
      "past 80% of the day's starts the machine stays awake rather than spend one on a nap"
    );
  });

  // ---- idleFor still honours an explicit window ---------------------------
  await test("idleFor takes an explicit window and still respects the refcount", () => {
    let t = 0;
    const h = harness({ now: () => t });
    const release = h.rt.hold("job");
    t += 60_000;
    assert.equal(h.rt.idleFor(1000), false, "a job in flight is never idle");
    release();
    t += 60_000;
    assert.equal(h.rt.idleFor(1000), true, "released and quiet is idle");
    assert.equal(h.rt.idleFor(10 * 60_000), false, "a wider window is not idle yet");
  });

  // ---- EVERY resume asserts a TTL ----------------------------------------
  // `box info --json` was read field by field on 2026-08-27: there is no ttl
  // and no autoStop on it. So an omitted `--ttl` keeps a number the app can
  // neither see nor bound — and that number is the ONLY thing left when the Mac
  // is force-quit or loses power. Sending it rides a resume that was happening
  // anyway: no extra round-trip, no extra start.
  await test("resume asserts a bounded TTL rather than keeping an unknown one", async () => {
    const h = harness({ state: "stopped" });
    const res = await h.rt.ensureRunning();
    assert.ok(res.ok && res.resumed, "a stopped box resumes");
    const resume = h.calls.find((c) => c.startsWith("resume"));
    assert.ok(/--ttl \d+/.test(resume), `a ttl rides every resume: ${resume}`);
    const ttl = Number(/--ttl (\d+)/.exec(resume)[1]);
    assert.equal(ttl, DEFAULT_TTL, "and it is the 30-minute default");
    assert.ok(ttl <= TRIAL_MAX_TTL, "clamped to the trial ceiling without a limits round-trip");
    assert.ok(!h.calls.some((c) => c.startsWith("limits")), "the resume path still costs no limits call");
  });

  await test("a resume TTL is clamped to the trial ceiling, never sent raw", async () => {
    const h = harness({ state: "stopped" });
    await h.rt.ensureRunning({ ttlSeconds: 8 * 3600 });
    const resume = h.calls.find((c) => c.startsWith("resume"));
    assert.ok(resume.includes(`--ttl ${TRIAL_MAX_TTL}`), `8h must clamp to ${TRIAL_MAX_TTL}: ${resume}`);
  });

  // ---- a machine mid-stop is waited for, never resumed --------------------
  // Measured: `box stop` returns `{"status":"stopping"}` in 0.22s and the box
  // stays there 9 more seconds. Reading that as "stopped" spent one of 75 daily
  // starts on a race with a shutdown already in flight.
  await test("`stopping` is its own state and does not read as stopped", async () => {
    const h = harness({ state: "stopping" });
    const st = await h.rt.status({ fresh: true });
    assert.equal(st.state, "stopping", "mid-stop is not 'stopped' and not 'running'");
  });

  await test("ensureRunning waits out a stopping box instead of spending a start on it", async () => {
    const h = harness({ state: "stopping", settleAfter: 2 });
    const before = h.calls.filter((c) => c.startsWith("resume")).length;
    const res = await h.rt.ensureRunning();
    const resumes = h.calls.filter((c) => c.startsWith("resume")).length - before;
    assert.ok(res.ok, "it still ends up running");
    assert.equal(resumes, 1, "exactly one start, spent after the stop finished, never during it");
  });

  // ---- the quit stop is bounded, and it resolves --------------------------
  // The one thing worse than a box left running is an app that will not close.
  await test("stop({ budgetMs }) resolves inside its budget even if the CLI hangs", async () => {
    let stored = "bx_1";
    const rt = createBoxRuntime({
      installed: () => true,
      getBoxId: () => stored,
      setBoxId: (id) => {
        stored = id;
      },
      // A CLI that never answers. This is what a wedged `box` binary looks like.
      run: () => new Promise(() => {}),
      exec: async () => ({ ok: true, json: {} }),
    });
    const t0 = Date.now();
    const res = await rt.stop({ force: true, budgetMs: 120 });
    const took = Date.now() - t0;
    assert.equal(res.ok, false);
    assert.equal(res.reason, "stop-timeout");
    assert.ok(took < 2000, `a hung stop must lose the quit, took ${took}ms`);
  });

  await test("the quit budget is a race, not a bare await", () => {
    const src = fs.readFileSync(path.join(__dirname, "../electron/box-runtime.cjs"), "utf8");
    assert.ok(/Promise\.race\(/.test(src), "stop's budget has to be a race or it can hang the quit");
    assert.ok(QUIT_STOP_BUDGET_MS <= 3000, "a person hitting Cmd-Q must not notice this");
    // 0.22s measured; anything under a second would be racing the measurement.
    assert.ok(QUIT_STOP_BUDGET_MS >= 1000, "and it must comfortably clear the measured 0.22s call");
  });

  // ---- the app can no longer leave a machine awake by exiting -------------
  // This is the expensive one. The idle sweep only runs while Hydo is open;
  // `npm run relaunch` sends SIGTERM, and those handlers called `app.exit(0)`
  // outright, so every dev restart left the box billing with nothing left on
  // this Mac that knew how to stop it.
  await test("every exit path in main.cjs issues the box stop", () => {
    const src = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
    assert.ok(/function stopBoxOnExit\(/.test(src), "there is one memoised exit stop");
    assert.ok(
      /budgetMs: boxRuntime\.QUIT_STOP_BUDGET_MS/.test(src),
      "the exit stop is bounded by the measured budget, not the 120s default"
    );
    const willQuit = /app\.on\("will-quit"[\s\S]*?\n\}\);/.exec(src);
    assert.ok(willQuit && /stopBoxOnExit\(\)/.test(willQuit[0]), "will-quit stops the box");
    const signals = /for \(const sig of \["SIGINT"[\s\S]*?\n\}\n/.exec(src);
    assert.ok(signals, "the signal handlers are still there");
    assert.ok(
      /stopBoxOnExit\(\)/.test(signals[0]),
      "SIGTERM from `npm run relaunch` must stop the box, or every restart leaks a running machine"
    );
    assert.ok(
      /setTimeout\(\(\) => app\.exit\(0\)/.test(signals[0]),
      "and it must exit on a hard timer, because a signal is not a request that can be declined"
    );
    // The old shape: fired and forgotten, immediately followed by app.exit.
    // Code only: the doc comment above `stopBoxOnExit` quotes the old line on
    // purpose, and a ban that trips on its own explanation is a bad ban.
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    for (const hit of code.match(/\.stop\(\{[^}]*\}\)/g) || []) {
      if (!/force:\s*true/.test(hit)) continue;
      assert.ok(
        /budgetMs/.test(hit),
        `a forced stop on the exit path must be bounded, or it can hang the quit: ${hit}`
      );
    }
  });

  // ---- the sweep must not overshoot its own window ------------------------
  await test("the idle sweep ticks fast enough for a 3-minute window", () => {
    const src = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
    const m = /idleTimer = setInterval\([\s\S]*?\}, (\d[\d_]*)\);/.exec(src);
    assert.ok(m, "the idle sweep is still a timer");
    const tick = Number(m[1].replace(/_/g, ""));
    assert.ok(
      tick <= IDLE_STOP_MS / 4,
      `a ${tick}ms tick against a ${IDLE_STOP_MS}ms window overshoots by too much billed time`
    );
  });

  // ---- the standing bans survive this pass -------------------------------
  await test("nothing here disabled auto-stop or unbounded a TTL", () => {
    const src = fs.readFileSync(path.join(__dirname, "../electron/box-runtime.cjs"), "utf8");
    assert.ok(!/--no-auto-stop/.test(src), "--no-auto-stop stays banned");
    assert.ok(!/28800/.test(src), "28800 stays banned");
    assert.ok(!/ttlSeconds:\s*null/.test(src), "a null ttl stays banned");
    // Every --ttl on the wire is a number, never a passthrough.
    for (const hit of src.match(/"--ttl",\s*[^)\]]+/g) || []) {
      assert.ok(/String\(/.test(hit), `a ttl must be stringified from a clamped number: ${hit}`);
    }
  });
}

main().then(() => {
  if (failures.length) {
    console.error(`FAILED: ${failures.join(" | ")}`);
    process.exit(1);
  }
  console.log(`box-minutes-test ok (${passed} checks)`);
});
