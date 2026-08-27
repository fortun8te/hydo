"use strict";

/**
 * ONE Ascii Box for the whole desk.
 *
 * Not one per bot. Fifty bots is one machine. The id lives on the APP
 * (`settings.boxId`), never on an agent, because the moment it lives on an
 * agent you get one machine per agent and a bill to match.
 *
 * `agent.boxEnabled` means "this bot is allowed to use the shared machine". It
 * is a permission, not a provisioning trigger: turning it on creates nothing,
 * turning it off deletes nothing, and making ten bots starts zero boxes.
 *
 * Why one machine is the right shape and not just the cheap one: the disk IS
 * the product. A browser signed into a dashboard, a font installed, a CSV left
 * in a folder . the next teammate should find all of it. Two machines means
 * logging into the same site twice.
 *
 * Facts checked against the live CLI and account, not assumed:
 *   - `box new` takes `--type` (small|default|large). There is NO `--name`,
 *     which is why the id must be persisted rather than looked up by name.
 *   - `box list --json` already carries `desktopUrl`, `state`, `type` and `ip`,
 *     so watching a screen costs no extra call.
 *   - Creating, forking AND resuming each count against the start limits
 *     (trial: 5/min, 25/hour, 75/day).
 *   - A stopped box is free and keeps its disk.
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(os.homedir(), ".ascii", "bin", "box");

/**
 * Cost law, in constants so it cannot drift into prose.
 *
 * `small` is 0.5x rate. TTL 1800 is thirty minutes: long enough that a job
 * does not trip over it, short enough that a forgotten machine costs pennies.
 * TRIAL_MAX_TTL is the hard ceiling the API enforces . asking for more comes
 * back as `trial_auto_stop_required`, so clamp before sending rather than
 * after failing.
 */
const DEFAULT_TYPE = "small";
const DEFAULT_TTL = 1800;
const TRIAL_MAX_TTL = 7200;
const IDLE_STOP_MS = 10 * 60 * 1000;

function run(args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      CLI,
      [...args, "--no-update"],
      { timeout: opts.timeout || 60_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = String(stdout || "").trim();
        if (err) {
          resolve({ ok: false, reason: String(stderr || err.message).trim().slice(0, 400), out });
          return;
        }
        resolve({ ok: true, out });
      }
    );
  });
}

async function runJson(args, opts) {
  const res = await run([...args, "--json"], opts);
  if (!res.ok) return res;
  try {
    const lines = res.out.split("\n").filter((l) => l.trim().startsWith("{"));
    return { ok: true, json: JSON.parse(lines[lines.length - 1] || res.out) };
  } catch {
    return { ok: false, reason: "unparseable CLI output", out: res.out.slice(0, 300) };
  }
}

const installed = () => {
  try {
    return fs.existsSync(CLI);
  } catch {
    return false;
  }
};

/** States the API reports for a machine that is up and billing. */
const LIVE = new Set(["provisioned", "cloning", "ready", "idle", "running"]);
const isLive = (b) => !!b && LIVE.has(String(b.state || "").toLowerCase());

/**
 * The singleton.
 *
 * `store` is injected so this stays testable without Electron: it needs to
 * read and write exactly one field, `settings.boxId`.
 */
function createBoxRuntime(opts = {}) {
  const exec = opts.exec || runJson;
  const plainExec = opts.run || run;
  const getBoxId = opts.getBoxId || (() => "");
  const setBoxId = opts.setBoxId || (() => {});
  const isInstalled = opts.installed || installed;
  const now = opts.now || (() => Date.now());

  /**
   * In-flight jobs, by token.
   *
   * A refcount rather than a boolean: two teammates can be using the machine
   * at once, and the second one finishing must not stop it under the first.
   * Only zero means idle.
   */
  const inFlight = new Set();
  let lastUsedAt = 0;
  let starting = null;

  async function info(id) {
    if (!id) return null;
    const res = await exec(["info", String(id)], { timeout: 30_000 });
    if (!res.ok) return null;
    return res.json && res.json.box ? res.json.box : res.json;
  }

  async function status() {
    if (!isInstalled()) return { ok: true, installed: false, signedIn: false };
    const st = await exec(["status"], { timeout: 20_000 });
    const acct = (st.ok && st.json && st.json.account) || {};
    const signedIn = String(acct.loginState || "").toLowerCase() === "signed in";
    const id = getBoxId();
    const box = signedIn && id ? await info(id) : null;
    return {
      ok: true,
      installed: true,
      signedIn,
      account: acct.identifier || "",
      id: id || "",
      // A remembered id whose machine is gone is `missing`, not `stopped`.
      // Saying "stopped" would make Resume the obvious action and Resume would
      // fail forever.
      state: !id ? "none" : !box ? "missing" : isLive(box) ? "running" : "stopped",
      type: box ? box.type : null,
      ip: box ? box.ip : null,
      desktopUrl: box ? box.desktopUrl : null,
      busy: inFlight.size,
      lastUsedAt,
    };
  }

  async function limits() {
    if (!isInstalled()) return { ok: false, reason: "not-installed" };
    const res = await exec(["limits"], { timeout: 20_000 });
    if (!res.ok) return res;
    const l = res.json || {};
    return {
      ok: true,
      trial: String(l.accessTier || "") === "trial",
      hoursLeft: l.creditBalanceHours ?? null,
      activeBoxes: l.activeBoxes ?? 0,
      maxActiveBoxes: l.maxActiveBoxes ?? null,
      startsToday: l.starts && l.starts.day ? l.starts.day : null,
      trialEndsAt: l.subscriptionTrialEndsAt || null,
    };
  }

  /** The TTL we may actually ask for. Clamped before the call, never after. */
  function ttlFor(requested, trial) {
    const want = Number(requested) || DEFAULT_TTL;
    const cap = trial ? TRIAL_MAX_TTL : Number.MAX_SAFE_INTEGER;
    return Math.max(60, Math.min(want, cap));
  }

  /**
   * The machine, running.
   *
   * Resumes the remembered id, or creates ONE and remembers it. Concurrent
   * callers share a single in-flight promise: fifty bots asking at once is one
   * create, not fifty . and creating, resuming and forking all count against
   * the same per-minute start limit, so a stampede is not merely wasteful, it
   * gets rate-limited.
   */
  async function ensureRunning(reason = {}) {
    if (!isInstalled()) return { ok: false, reason: "not-installed" };
    if (starting) return starting;

    starting = (async () => {
      const st = await status();
      if (!st.signedIn) return { ok: false, reason: "signed-out" };
      if (st.state === "running") {
        lastUsedAt = now();
        return { ok: true, id: st.id, reused: true };
      }

      const lim = await limits();
      const trial = !!(lim.ok && lim.trial);
      const ttl = ttlFor(reason.ttlSeconds, trial);

      if (st.state === "stopped") {
        const res = await exec(["resume", st.id], { timeout: 180_000 });
        if (!res.ok) return res;
        lastUsedAt = now();
        return { ok: true, id: st.id, resumed: true };
      }

      // Before creating anything: is there already a machine on this account?
      //
      // Hydo remembers one id, and a fresh install remembers none . but the
      // account may already have the box the user made by hand. Creating
      // alongside it is the worst outcome available: it spends a start, adds a
      // second machine against a two-machine limit, and splits the team's
      // files across two disks that will never see each other.
      //
      // Adopt only when there is EXACTLY one. Two or more is a real question
      // about which is the team's, and guessing at that is how you end up
      // writing to a stranger's disk.
      if (!st.id) {
        const existing = await exec(["list"], { timeout: 30_000 });
        const rows =
          existing.ok && existing.json
            ? Array.isArray(existing.json)
              ? existing.json
              : existing.json.boxes || []
            : [];
        if (rows.length === 1 && rows[0] && rows[0].id) {
          setBoxId(rows[0].id);
          lastUsedAt = now();
          if (!isLive(rows[0])) {
            const back = await exec(["resume", rows[0].id], { timeout: 180_000 });
            if (!back.ok) return back;
            return { ok: true, id: rows[0].id, adopted: true, resumed: true };
          }
          return { ok: true, id: rows[0].id, adopted: true };
        }
      }

      const args = ["new", "--type", reason.type || DEFAULT_TYPE, "--ttl", String(ttl)];
      const res = await exec(args, { timeout: 240_000 });
      if (!res.ok) return res;
      const made = res.json && res.json.box ? res.json.box : res.json;
      const id = made && made.id;
      if (!id) return { ok: false, reason: "create returned no id" };
      setBoxId(id);
      lastUsedAt = now();
      return { ok: true, id, created: true, ttl, type: reason.type || DEFAULT_TYPE };
    })().finally(() => {
      starting = null;
    });

    return starting;
  }

  /** Claim the machine for a job. Returns a release function. */
  function hold(token) {
    const key = token || `job-${Math.random().toString(36).slice(2)}`;
    inFlight.add(key);
    lastUsedAt = now();
    return () => {
      inFlight.delete(key);
      lastUsedAt = now();
    };
  }

  /**
   * Stop it. Snapshots the disk, pauses billing.
   *
   * Refuses while a job is in flight unless forced, because the whole point of
   * the refcount is that one teammate finishing does not pull the machine out
   * from under another.
   */
  async function stop({ force = false } = {}) {
    const id = getBoxId();
    if (!id) return { ok: true, reason: "no-box" };
    if (inFlight.size && !force) return { ok: false, reason: "busy", busy: inFlight.size };
    return plainExec(["stop", String(id)], { timeout: 120_000 });
  }

  /** True when nothing is running and nothing has used it for a while. */
  function idleFor(ms = IDLE_STOP_MS) {
    return inFlight.size === 0 && lastUsedAt > 0 && now() - lastUsedAt >= ms;
  }

  return {
    status,
    limits,
    ensureRunning,
    hold,
    stop,
    idleFor,
    ttlFor,
    info,
    get busy() {
      return inFlight.size;
    },
  };
}

module.exports = {
  createBoxRuntime,
  installed,
  CLI,
  DEFAULT_TYPE,
  DEFAULT_TTL,
  TRIAL_MAX_TTL,
  IDLE_STOP_MS,
  isLive,
};
