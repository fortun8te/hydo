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
/**
 * The ceiling off trial. Documented at `/box/long-running-tasks`: 30 days
 * (2,592,000s), and anything larger is capped server-side anyway.
 *
 * It was `Number.MAX_SAFE_INTEGER`, which is not a number this API has ever
 * accepted . it just happened never to be sent, because nothing off trial had
 * been tried. A cap that only works because the path is dead is not a cap.
 */
const MAX_TTL = 2_592_000;
const IDLE_STOP_MS = 10 * 60 * 1000;

/**
 * How long a `status()` answer is worth reusing.
 *
 * The user's complaint, in their words: "if I keep clicking/exiting then
 * obviously don't count that as separate fucking starts." Opening the Computer
 * rail runs `status()`, and `status()` is two CLI round-trips (`box status` +
 * `box info`). Shell.jsx re-runs it on every `sheet`/`rail` change, so a user
 * flicking a panel open and shut was firing a pair of API calls per flick.
 *
 * Eight seconds because that is shorter than any state change a human can
 * cause without going through this app (wake and stop both invalidate the
 * cache themselves, below), and long enough that a burst of clicks collapses
 * into one round-trip.
 */
const STATUS_TTL_MS = 8000;

/**
 * The local half of the start budget.
 *
 * Trial is 5 starts/minute, 25/hour, 75/day, and create, resume AND fork each
 * spend one. A start that gets rate-limited server-side still cost a round-trip
 * and, worse, teaches nothing: the next click makes the same call again. So the
 * ceiling is enforced here, before the wire, and the caller is told which
 * window it hit.
 *
 * Deliberately one under the per-minute limit: `box` itself is not the only
 * thing on this account that can spend a start (the dashboard, the user's own
 * shell), so leaving one in hand is cheaper than being the caller that trips it.
 */
const START_WINDOWS = [
  { ms: 60_000, max: 4, name: "minute" },
  { ms: 3_600_000, max: 24, name: "hour" },
  { ms: 86_400_000, max: 70, name: "day" },
];

/**
 * How long after a start we refuse to start again for the same reason.
 *
 * The in-flight `starting` promise coalesces callers that overlap in TIME. It
 * does nothing for a click 300ms after the previous one resolved — and that is
 * exactly the double-click the user is describing. A start that just succeeded
 * is a machine that is already running, so the second click has nothing to do.
 */
const START_COOLDOWN_MS = 5000;

/**
 * One CLI call.
 *
 * `--no-update` goes in right AFTER the subcommand, never at the end. `box
 * exec <id> [COMMAND]...` and `box ssh <id> [COMMAND]...` take a variadic
 * trailing COMMAND, so a flag appended at the end is swallowed as part of the
 * command the box is asked to run. Verified against `box exec --help`.
 */
function placeFlags(args, flags) {
  const head = args.slice(0, 1);
  const rest = args.slice(1);
  const add = flags.filter((f) => !args.includes(f));
  return [...head, ...add, ...rest];
}

function run(args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      CLI,
      placeFlags(args, ["--no-update"]),
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

/**
 * A CLI call whose output is JSON . or JSONL, which is the part that bites.
 *
 * Verified in the docs (`/box/use-in-code`) and against the CLI: `box info`,
 * `box list`, `box status` and `box limits` emit ONE object, but LONG-RUNNING
 * commands . `box new` above all . emit JSON Lines: `created`, then any number
 * of `state` frames, then `ready`.
 *
 * This used to parse only the LAST line, which is the single most expensive
 * bug this file could hold: if the final frame is a `state` event carrying no
 * `id`, the caller reads "create returned no id" and throws away the id of a
 * machine that is now running and billing, against a two-machine account
 * limit, with nothing left that knows how to stop it.
 *
 * So: parse every line, and hand back the last frame that actually carries an
 * id alongside the last frame overall. An `event: "error"` frame is a failure
 * even when the process exited 0.
 */
function parseFrames(out) {
  const frames = [];
  for (const line of String(out || "").split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      frames.push(JSON.parse(t));
    } catch {
      /* a half-written frame is not a reason to lose the whole stream */
    }
  }
  return frames;
}

/** The box object inside a frame, whatever shape the frame chose. */
function boxOf(frame) {
  if (!frame || typeof frame !== "object") return null;
  if (frame.box && typeof frame.box === "object") return frame.box;
  return frame;
}

/** The id anywhere in a JSONL stream. Survives `ready` not being last. */
function idFrom(frames) {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const b = boxOf(frames[i]);
    const id = b && (b.id || b.boxId);
    if (typeof id === "string" && id) return id;
  }
  return "";
}

async function runJson(args, opts) {
  const res = await run(placeFlags(args, ["--json"]), opts);
  const frames = parseFrames(res.out);
  if (!res.ok) return { ...res, frames };
  const err = frames.find((f) => f && f.event === "error");
  if (err) {
    return { ok: false, reason: String(err.error || err.code || "box error").slice(0, 400), code: err.code || "", frames };
  }
  if (!frames.length) return { ok: false, reason: "unparseable CLI output", out: res.out.slice(0, 300) };
  return { ok: true, json: frames[frames.length - 1], frames };
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

  /**
   * Everything that exists so a click is not an API call.
   *
   * `statusAt`/`statusValue` is the cache; `statusInFlight` coalesces callers
   * that arrive while the first round-trip is still open — a rail mount and a
   * Shell header check land within the same tick, and without this they are two
   * `box status` calls for one answer.
   */
  let statusAt = 0;
  let statusValue = null;
  let statusInFlight = null;
  /** Timestamps of starts we actually spent, newest last. */
  const startsSpent = [];
  let lastStartAt = 0;
  let lastStartResult = null;

  /** Anything that CHANGES the machine must drop the cache, or the UI lies. */
  function invalidate() {
    statusAt = 0;
    statusValue = null;
  }

  /** Which start window, if any, this call would blow through. */
  function overBudget(at) {
    while (startsSpent.length && at - startsSpent[0] > 86_400_000) startsSpent.shift();
    for (const w of START_WINDOWS) {
      if (startsSpent.filter((t) => at - t < w.ms).length >= w.max) return w.name;
    }
    return "";
  }

  /** Record a start we spent. Create, resume and fork all count the same. */
  function spentStart(at) {
    startsSpent.push(at);
    lastStartAt = at;
  }

  async function info(id) {
    if (!id) return null;
    const res = await exec(["info", String(id)], { timeout: 30_000 });
    if (!res.ok) return null;
    return res.json && res.json.box ? res.json.box : res.json;
  }

  /**
   * The cached, coalesced front door. Everything outside this file calls this.
   *
   * `{ fresh: true }` is for the paths that must not act on a stale answer —
   * `ensureRunning` above all, because deciding "create" from an eight-second-
   * old "missing" is how you end up with a second machine.
   */
  async function status(opts = {}) {
    if (!opts.fresh && statusValue && now() - statusAt < STATUS_TTL_MS) {
      // `busy` is a live number, not a cached one: a job that started since the
      // snapshot must not read as idle, or the Stop button offers to yank the
      // machine out from under it.
      return { ...statusValue, busy: inFlight.size, cached: true };
    }
    if (statusInFlight) return statusInFlight;
    statusInFlight = statusFresh()
      .then((s) => {
        // Only a real answer is worth caching. Caching "not installed" or a
        // failed round-trip would pin a wrong state for eight seconds.
        if (s && s.installed && s.signedIn) {
          statusValue = s;
          statusAt = now();
        }
        return s;
      })
      .finally(() => {
        statusInFlight = null;
      });
    return statusInFlight;
  }

  async function statusFresh() {
    if (!isInstalled()) return { ok: true, installed: false, signedIn: false };
    const st = await exec(["status"], { timeout: 20_000 });
    const acct = (st.ok && st.json && st.json.account) || {};
    // Signed in is "not signed out", not a guess at the positive word.
    //
    // This was `=== "signed in"`, written from the signed-OUT value and a
    // guess at its opposite. The real one is "active", so a signed-in account
    // on a paid trial was told to run `box onboard`. An identifier plus the
    // absence of a signed-out marker is the check that survives the vendor
    // renaming its vocabulary, which it evidently does.
    const loginState = String(acct.loginState || acct.status || "").toLowerCase();
    const signedIn = !!acct.identifier && !!loginState && !/signed[\s_-]?out|logged[\s_-]?out/.test(loginState);
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
    // `null`, `undefined`, `0`, `NaN` and a string all land on the default.
    // Never `null` on the wire: the docs make a null TTL mean "auto-stop OFF",
    // which on trial is refused and off trial is a machine that runs forever.
    const want = Number(requested) || DEFAULT_TTL;
    const cap = trial ? TRIAL_MAX_TTL : MAX_TTL;
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

    // A start that just succeeded is a machine that is already running. The
    // in-flight promise only merges callers that OVERLAP; a second click 300ms
    // after the first resolved is a fresh call, and on the trial's 5/minute
    // budget that is the one the user actually noticed. Serving it from the
    // last result costs nothing and spends nothing.
    if (lastStartResult && lastStartResult.ok && now() - lastStartAt < START_COOLDOWN_MS) {
      lastUsedAt = now();
      return { ...lastStartResult, coalesced: true };
    }

    starting = (async () => {
      // Fresh, never cached: deciding "create" from a stale "missing" is a
      // second machine against a two-machine limit.
      const st = await status({ fresh: true });
      if (!st.signedIn) return { ok: false, reason: "signed-out" };
      if (st.state === "running") {
        lastUsedAt = now();
        return { ok: true, id: st.id, reused: true };
      }

      if (st.state === "stopped") {
        // No `limits` call on this path. Resume keeps the box's own TTL
        // (`box resume --help`: "Omit to keep the Box's current setting"), so
        // the trial ceiling is not a question here . and this is the common
        // path, walked every time the desk wakes up. It was paying for an API
        // round-trip whose answer it then threw away.
        const over = overBudget(now());
        if (over) return { ok: false, reason: "start-budget", window: over };
        const res = await exec(["resume", st.id], { timeout: 180_000 });
        if (!res.ok) return res;
        spentStart(now());
        invalidate();
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
      // `missing` counts as "no id" here, and that omission was a real bug.
      //
      // A remembered id whose machine has been deleted skipped adoption
      // entirely and went straight to `box new`. On a two-machine trial with
      // the user's own box already on the account, that is a second machine
      // beside the first, one of 75 daily starts spent, and the team's files
      // split across two disks . the exact outcome adoption exists to prevent,
      // undone by checking for a remembered STRING rather than a live machine.
      if (!st.id || st.state === "missing") {
        // `--all`, because `box list` defaults to `--filter r` . RUNNING only.
        // A stopped box is invisible to the default, so adoption would never
        // see the machine the user already made and would create a second one
        // beside it: exactly the outcome adoption exists to prevent, undone by
        // a default I had not checked.
        const existing = await exec(["list", "--all"], { timeout: 30_000 });
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
            const over = overBudget(now());
            if (over) return { ok: false, reason: "start-budget", window: over };
            const back = await exec(["resume", rows[0].id], { timeout: 180_000 });
            if (!back.ok) return back;
            spentStart(now());
            invalidate();
            return { ok: true, id: rows[0].id, adopted: true, resumed: true };
          }
          invalidate();
          return { ok: true, id: rows[0].id, adopted: true };
        }
      }

      // Only a real CREATE needs to know about the trial, because only
      // `--ttl` on `box new` can be refused for exceeding it.
      // Creating spends a start too, so the budget is checked before the
      // `limits` round-trip rather than after it.
      const over = overBudget(now());
      if (over) return { ok: false, reason: "start-budget", window: over };
      const lim = await limits();
      const trial = !!(lim.ok && lim.trial);
      const ttl = ttlFor(reason.ttlSeconds, trial);
      const args = ["new", "--type", reason.type || DEFAULT_TYPE, "--ttl", String(ttl)];
      const res = await exec(args, { timeout: 240_000 });
      if (!res.ok) return res;
      // `box new --json` is JSONL: `created`, then `state` frames, then
      // `ready`. Reading the id off the LAST frame alone loses a running,
      // billing machine whenever the stream does not end on `ready`, and there
      // is then nothing left on this Mac that knows how to stop it. So the id
      // is taken from anywhere in the stream, newest frame first.
      const made = boxOf(res.json) || {};
      const id = made.id || idFrom(res.frames || []);
      if (!id) return { ok: false, reason: "create returned no id" };
      setBoxId(id);
      spentStart(now());
      invalidate();
      lastUsedAt = now();
      return { ok: true, id, created: true, ttl, type: reason.type || DEFAULT_TYPE };
    })()
      .then((res) => {
        // Remembered so the cooldown above can answer the next click without a
        // call. Only successes: a failed start must stay retryable.
        if (res && res.ok) {
          lastStartResult = res;
          lastStartAt = now();
        }
        return res;
      })
      .finally(() => {
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
    // Both of these would otherwise make the app lie about a machine it just
    // put to sleep: the cached status would keep saying "running" for eight
    // seconds, and — worse — a Wake click inside the cooldown would be answered
    // from `lastStartResult` and never actually resume.
    invalidate();
    lastStartResult = null;
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
  MAX_TTL,
  IDLE_STOP_MS,
  STATUS_TTL_MS,
  START_COOLDOWN_MS,
  START_WINDOWS,
  isLive,
  parseFrames,
  idFrom,
  placeFlags,
};
