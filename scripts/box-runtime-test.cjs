"use strict";

// ONE Ascii Box for the whole desk.
//
// The failure this guards against is arithmetic: a box id stored on the agent
// instead of the app gives one machine per bot and a bill to match. Fifty bots
// must be one machine, and `boxEnabled` must be a permission rather than a
// provisioning trigger.
//
// Every fact asserted here was checked against the real CLI first:
//   - `box new` takes `--type`, NOT `--size`, and has no `--name` at all,
//     which is why the id is persisted rather than looked up.
//   - creating, forking and resuming each count against the start limits.
//   - trial caps auto-stop at 7200s and rejects longer with
//     `trial_auto_stop_required`, so the clamp has to happen before the call.

const assert = require("node:assert/strict");
const { createBoxRuntime, DEFAULT_TYPE, DEFAULT_TTL, TRIAL_MAX_TTL } = require("../electron/box-runtime.cjs");

/** A fake CLI that records every call. */
function harness({ boxId = "", trial = true, existing = null } = {}) {
  const calls = [];
  let stored = boxId;
  let box = existing;
  const rt = createBoxRuntime({
    installed: () => true,
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
      if (cmd === "status") return { ok: true, json: { account: { loginState: "signed in" } } };
      if (cmd === "limits") {
        return { ok: true, json: { accessTier: trial ? "trial" : "user", creditBalanceHours: 555 } };
      }
      if (cmd === "info") return box ? { ok: true, json: { box } } : { ok: false, reason: "gone" };
      if (cmd === "resume") {
        box = { ...box, state: "running" };
        return { ok: true, json: { box } };
      }
      if (cmd === "new") {
        box = { id: "bx_new1", state: "running", type: DEFAULT_TYPE };
        return { ok: true, json: { box } };
      }
      return { ok: true, json: {} };
    },
  });
  return { rt, calls, get id() { return stored; } };
}

async function main() {
  // ---- create sends type small and a real ttl -------------------------------
  {
    const h = harness();
    const res = await (h.rt.ensureRunning());
    assert.ok(res.ok && res.created, "first call creates");
    const create = h.calls.find((c) => c.startsWith("new"));
    assert.ok(create, "it called box new");
    assert.ok(create.includes(`--type ${DEFAULT_TYPE}`), `type must be ${DEFAULT_TYPE}: ${create}`);
    // `--size` is not a flag on this CLI. Sending it fails the whole create.
    assert.ok(!create.includes("--size"), "there is no --size flag on box new");
    assert.ok(/--ttl \d+/.test(create), `a ttl is always sent: ${create}`);
    assert.ok(!/--ttl (null|undefined|0)\b/.test(create), "never a null ttl");
    assert.ok(!create.includes("--no-auto-stop"), "auto-stop is never disabled by default");
    assert.equal(h.id, "bx_new1", "the id is persisted on the app");
  }

  // ---- the trial ceiling is applied BEFORE the call -------------------------
  // The API answers `trial_auto_stop_required` to anything longer, so clamping
  // after a failure means one wasted start against a 75/day budget.
  {
    const h = harness({ trial: true });
    assert.equal(h.rt.ttlFor(8 * 3600, true), TRIAL_MAX_TTL, "8h clamps to the trial max");
    assert.equal(h.rt.ttlFor(undefined, true), DEFAULT_TTL, "the default is 30 minutes");
    assert.equal(h.rt.ttlFor(0, true), DEFAULT_TTL);
    assert.ok(h.rt.ttlFor(8 * 3600, false) > TRIAL_MAX_TTL, "off trial the ceiling lifts");
  }

  // ---- FIFTY bots is ONE machine -------------------------------------------
  // The whole point. Concurrent callers share one in-flight create.
  {
    const h = harness();
    const all = await Promise.all(Array.from({ length: 50 }, () => h.rt.ensureRunning()));
    const creates = h.calls.filter((c) => c.startsWith("new")).length;
    const resumes = h.calls.filter((c) => c.startsWith("resume")).length;
    assert.equal(creates + resumes, 1, `50 bots must yield ONE start, got ${creates} new + ${resumes} resume`);
    assert.equal(new Set(all.map((r) => r.id)).size, 1, "all fifty get the same id");
    assert.ok(!h.calls.some((c) => c.startsWith("fork")), "fork is never called");
  }

  // ---- a remembered id is resumed, never re-created -------------------------
  {
    const h = harness({ boxId: "bx_843rh875", existing: { id: "bx_843rh875", state: "stopped" } });
    const res = await (h.rt.ensureRunning());
    assert.ok(res.resumed, "a stopped box resumes");
    assert.equal(res.id, "bx_843rh875", "same id");
    assert.ok(!h.calls.some((c) => c.startsWith("new")), "and never creates a second machine");
  }

  // ---- an id whose machine is gone reads as `missing`, not `stopped` --------
  // "stopped" would make Resume the obvious action, and Resume would fail
  // forever against a machine that no longer exists.
  {
    const h = harness({ boxId: "bx_dead", existing: null });
    const st = await (h.rt.status());
    assert.equal(st.state, "missing");
  }

  // ---- stop respects the refcount ------------------------------------------
  // Two teammates can use the machine at once; the first to finish must not pull
  // it out from under the second.
  {
    const h = harness({ boxId: "bx_1", existing: { id: "bx_1", state: "running" } });
    const releaseA = h.rt.hold("a");
    const releaseB = h.rt.hold("b");
    assert.equal(h.rt.busy, 2);
    let res = await (h.rt.stop());
    assert.equal(res.ok, false, "refuses while jobs are in flight");
    releaseA();
    res = await (h.rt.stop());
    assert.equal(res.ok, false, "still busy with one left");
    releaseB();
    assert.equal(h.rt.busy, 0);
    res = await (h.rt.stop());
    assert.ok(res.ok, "stops once nothing is in flight");
    assert.ok(h.calls.some((c) => c.startsWith("stop bx_1")), "and it really called stop");
  }

  // ---- quit stops even mid-job ---------------------------------------------
  {
    const h = harness({ boxId: "bx_1", existing: { id: "bx_1", state: "running" } });
    h.rt.hold("a");
    const res = await (h.rt.stop({ force: true }));
    assert.ok(res.ok, "force wins, for app quit");
  }

  // ---- idle is a real question, not a timer ---------------------------------
  {
    let t = 1_000_000;
    const rt = createBoxRuntime({
      installed: () => true,
      getBoxId: () => "bx_1",
      now: () => t,
      exec: async () => ({ ok: true, json: {} }),
    });
    assert.equal(rt.idleFor(1000), false, "never used is not idle");
    const release = rt.hold("a");
    t += 60_000;
    assert.equal(rt.idleFor(1000), false, "busy is not idle");
    release();
    assert.equal(rt.idleFor(1000), false, "just released is not idle yet");
    t += 60_000;
    assert.equal(rt.idleFor(1000), true, "idle once the quiet period passes");
  }

  // ---- the id lives on the app, never on an agent --------------------------
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../electron/box-runtime.cjs"), "utf8");
  assert.ok(!/agent\.boxId|agentId.*boxId/.test(src), "a box id must never be stored per agent");



  // ---- adopt a machine the user already made -----------------------------
  // A fresh install remembers no id, but the account may already have the box
  // the user created by hand. Creating alongside it is the worst outcome
  // available: it spends one of 75 daily starts, adds a second machine against
  // a TWO machine limit, and splits the team's files across two disks that
  // will never see each other.
  {
    // One box on the account, made outside Hydo.
    const theirs = { id: "bx_843rh875", state: "idle", type: "default" };
    const h = { id: "", adopted: "" };
    const rt = createBoxRuntime({
      installed: () => true,
      getBoxId: () => h.id,
      setBoxId: (id) => {
        h.adopted = id;
      },
      exec: async (args) => {
        if (args[0] === "status") return { ok: true, json: { account: { loginState: "signed in" } } };
        if (args[0] === "limits") return { ok: true, json: { accessTier: "trial" } };
        if (args[0] === "list") return { ok: true, json: { boxes: [theirs] } };
        if (args[0] === "new") throw new Error("must NOT create when one already exists");
        return { ok: true, json: {} };
      },
    });
    const res = await rt.ensureRunning();
    assert.ok(res.ok && res.adopted, "adopts the box already on the account");
    assert.equal(res.id, "bx_843rh875");
    assert.equal(h.adopted, "bx_843rh875", "and remembers it as the desk's machine");
  }

  // Two or more is a real question about which one is the team's, and guessing
  // is how you write to a disk that is not yours.
  {
    let created = false;
    const rt = createBoxRuntime({
      installed: () => true,
      getBoxId: () => "",
      setBoxId: () => {},
      exec: async (args) => {
        if (args[0] === "status") return { ok: true, json: { account: { loginState: "signed in" } } };
        if (args[0] === "limits") return { ok: true, json: { accessTier: "trial" } };
        if (args[0] === "list") {
          return { ok: true, json: { boxes: [{ id: "bx_a", state: "idle" }, { id: "bx_b", state: "idle" }] } };
        }
        if (args[0] === "new") {
          created = true;
          return { ok: true, json: { box: { id: "bx_new", state: "running" } } };
        }
        return { ok: true, json: {} };
      },
    });
    const res = await rt.ensureRunning();
    assert.ok(created, "with two candidates it does not guess, it makes its own");
    assert.equal(res.id, "bx_new");
  }

  console.log("box-runtime-test ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ---- the store wakes the machine only when it should ----------------------
// Two ways to be wrong, and they are not symmetric. Waking for "hey" bills for
// nothing. NOT waking when the bot needed Linux costs one extra call, because
// the bot wakes it itself a step later. So the predicate errs toward silence.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const store = fs.readFileSync(path.join(__dirname, "../electron/store.cjs"), "utf8");

  const m = /const WANTS_BOX =\s*\n?\s*(\/.*\/i);/.exec(store);
  if (!m) throw new Error("WANTS_BOX predicate not found");
  // eslint-disable-next-line no-eval
  const re = eval(m[1]);

  for (const quiet of ["hey", "thanks", "what time is it", "write me a poem", "hi!!", "read src/store.js"]) {
    if (re.test(quiet)) throw new Error(`must NOT wake the machine for: "${quiet}"`);
  }
  for (const loud of [
    "run box exec on the shared machine",
    "apt-get install ffmpeg",
    "open chrome on the box",
    "use the linux workspace for this",
    "sudo systemctl restart nginx",
  ]) {
    if (!re.test(loud)) throw new Error(`should wake the machine for: "${loud}"`);
  }

  // Permission AND intent, never one alone.
  if (!/agent\.boxEnabled && wantsBox\(userText\)/.test(store)) {
    throw new Error("waking must require both the toggle and a turn that needs it");
  }
  // A refcount that leaks on an error is a machine that never stops, and the
  // error path is the one it would leak on.
  if (!/finally \{[\s\S]{0,600}releaseBox\(\)/.test(store)) {
    throw new Error("the hold must be released in a finally, not only on success");
  }
  // The store must not be able to spend money on its own.
  if (/require\(["']\.\/box-runtime\.cjs["']\)/.test(store)) {
    throw new Error("the store must be HANDED a runtime, never import one");
  }
}

console.log("box-runtime-test (turn wiring) ok");

// ---- presets can grant the machine, but never a machine of their own ------
{
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { createStore } = require("../electron/store.cjs");
  const presets = fs.readFileSync(path.join(__dirname, "../src/lib/bot-presets.js"), "utf8");

  // Exactly one preset turns the shared machine on. If every preset did, then
  // "make a bot" would mean "start billing" and the toggle would be theatre.
  const enabled = (presets.match(/boxEnabled: true/g) || []).length;
  if (enabled !== 1) throw new Error(`exactly one preset may enable the box, found ${enabled}`);
  if (!/id: "operator"/.test(presets)) throw new Error("the operator preset is the one");
  if (!/boxEnabled: preset\.boxEnabled === true/.test(presets)) {
    throw new Error("presetPatch must pass the flag explicitly, not spread it");
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-preset-"));
  const store = createStore({ dir, complete: async () => "ok" });
  store.signIn();

  const made = store.createAgent({
    name: "Ops",
    toolProfile: "builder",
    toolsets: ["browser"],
    boxEnabled: true,
  });
  const a = made.agents[0];
  if (a.boxEnabled !== true) throw new Error("the operator preset grants the permission");
  if (!a.toolsets.includes("browser")) throw new Error("and seeds its toolsets");
  // Permission is not provisioning: a created agent must carry no box id.
  if ("boxId" in a) throw new Error("an agent must never hold a box id");

  // A stale preset naming a toolset that no longer exists must not pin it.
  const junk = store.createAgent({ name: "X", toolsets: ["browser", "not_a_real_toolset"] });
  if (junk.agents[0].toolsets.length !== 1) {
    throw new Error("toolsets from a preset are validated against the real allowlist");
  }
}

console.log("box-runtime-test (presets) ok");
