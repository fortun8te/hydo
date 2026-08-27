"use strict";

/**
 * The team computer.
 *
 * ONE cloud Linux machine that every teammate shares — not one per bot. That
 * is the same shape Grok Bot uses, and three separate things push toward it:
 *
 *   - Shared state is the point. A bot that installs a font, logs into a
 *     dashboard or writes a CSV should leave that there for the next one. One
 *     box per bot means five bots log into the same site five times.
 *   - Box bills per running machine, and the trial allows TWO concurrent
 *     boxes. A machine per teammate is neither affordable nor permitted.
 *   - Stopped boxes are free. One machine that sleeps when nobody is using it
 *     costs nothing at rest, which is only true if there is one of them.
 *
 * What is NOT shared: each teammate gets its own directory under
 * `/home/box/hydo/<botId>` for scratch work. That is a convention, not a jail
 * — another bot can read it if it goes looking. Worth saying plainly rather
 * than implying an isolation that does not exist. Chat, memory and routines
 * stay on this Mac, in the bot's own profile.
 *
 * Everything here shells out to the `box` CLI rather than reimplementing the
 * HTTP API. The CLI is what the vendor keeps current, it already handles auth
 * and token refresh, and `--json` is documented as stable output.
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CLI = path.join(os.homedir(), ".ascii", "bin", "box");

/** The name we give the shared machine, so we can find it again. */
const TEAM_BOX = "hydo-team";

/**
 * How long the box may sit idle before Hydo stops it.
 *
 * Stopped is FREE and resuming restores from snapshot, so the only cost of
 * being wrong here is a few seconds of wait. Being wrong the other way burns
 * the month's hours while nobody is watching. The trial caps auto-stop at two
 * hours; this is deliberately far below that.
 */
const IDLE_STOP_MS = 12 * 60 * 1000;

/**
 * Always-on, for routines that must fire while the Mac is shut.
 *
 * A stopped box runs NOTHING . it is a frozen filesystem snapshot, there are
 * no wake timers, and auto-stop counts from creation rather than from last
 * activity. So "run this every morning whether or not my laptop is open" has
 * exactly one shape: a box that never stops.
 *
 * The arithmetic decides the size, and it is close:
 *
 *   a month            2,592,000 s
 *   the $20 plan       2,000,000 VM-seconds
 *   small   (0.5x)     1,296,000  . 65% of the plan. Fits, with headroom.
 *   default (1x)       2,592,000  . 130%. Does not fit.
 *   large   (2x)       5,184,000  . 259%.
 *
 * So an always-on team computer is a SMALL box or it is a surprise bill. Two
 * vCPUs and 4GB is thin for a desktop, which is the honest trade: a machine
 * that is always there, or a faster one that is only there when you are.
 *
 * Requires a payment method . `--no-auto-stop` is refused on the trial, which
 * caps auto-stop at two hours and cannot disable it.
 */
const ALWAYS_ON_SIZE = "small";
const MONTH_SECONDS = 2_592_000;
const PLAN_SECONDS = 2_000_000;
const SIZE_RATE = { small: 0.5, default: 1, large: 2 };

/** What running this size continuously would cost, as a share of the plan. */
function alwaysOnCost(size = ALWAYS_ON_SIZE) {
  const rate = SIZE_RATE[size] ?? 1;
  const used = MONTH_SECONDS * rate;
  return {
    size,
    vmSeconds: used,
    planSeconds: PLAN_SECONDS,
    percentOfPlan: Math.round((used / PLAN_SECONDS) * 100),
    fits: used <= PLAN_SECONDS,
  };
}

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

/** `--json` output, parsed. The CLI documents this as stable; text output is not. */
async function runJson(args, opts) {
  const res = await run([...args, "--json"], opts);
  if (!res.ok) return res;
  try {
    // Some commands emit JSONL. The last complete object is the result.
    const lines = res.out.split("\n").filter((l) => l.trim().startsWith("{"));
    return { ok: true, json: JSON.parse(lines[lines.length - 1] || res.out) };
  } catch {
    return { ok: false, reason: "unparseable CLI output", out: res.out.slice(0, 300) };
  }
}

function installed() {
  try {
    return fs.existsSync(CLI);
  } catch {
    return false;
  }
}

/**
 * Where we stand: is the CLI here, is someone signed in, is there a plan.
 *
 * Deliberately never throws and never invents. "signed out" is a real answer
 * and the UI needs to be able to say it.
 */
async function status() {
  if (!installed()) {
    return {
      ok: true,
      installed: false,
      signedIn: false,
      reason: "The box CLI is not installed.",
    };
  }
  const res = await runJson(["status"], { timeout: 20_000 });
  if (!res.ok) return { ok: true, installed: true, signedIn: false, reason: res.reason };
  const acct = (res.json && res.json.account) || {};
  return {
    ok: true,
    installed: true,
    signedIn: String(acct.loginState || "").toLowerCase() === "signed in",
    account: acct.identifier || "",
    plan: acct.plan || null,
    apiHealthy: !!(res.json && res.json.api && res.json.api.healthy),
  };
}

/** Plan limits, so the UI can say what the trial actually allows. */
async function limits() {
  if (!installed()) return { ok: false, reason: "not-installed" };
  const res = await runJson(["limits"], { timeout: 20_000 });
  return res.ok ? { ok: true, limits: res.json } : res;
}

/** Every box on the account, with its state. */
async function list() {
  if (!installed()) return { ok: false, reason: "not-installed" };
  const res = await runJson(["list"], { timeout: 30_000 });
  if (!res.ok) return res;
  const raw = res.json;
  const rows = Array.isArray(raw) ? raw : raw && Array.isArray(raw.boxes) ? raw.boxes : [];
  return { ok: true, boxes: rows };
}

/** The shared machine, if it exists yet. */
async function findTeamBox() {
  const res = await list();
  if (!res.ok) return null;
  return (
    res.boxes.find((b) => String(b.name || b.alias || "").toLowerCase() === TEAM_BOX) || null
  );
}

/**
 * The team computer, running and ready to take work.
 *
 * Creates it the first time, resumes it when it has been stopped, and returns
 * the same machine every other time. Never creates a second one: a duplicate
 * would split the team's files in half and double the bill.
 */
async function ensure(opts = {}) {
  const st = await status();
  if (!st.installed) return { ok: false, reason: "not-installed" };
  if (!st.signedIn) return { ok: false, reason: "signed-out" };

  const found = await findTeamBox();
  if (!found) {
    // `alwaysOn` is what makes a routine fire with the laptop shut, and it is
    // also what turns this from "pennies when I use it" into a standing
    // monthly cost. It is never the default.
    const args = ["new", "--name", TEAM_BOX];
    if (opts.alwaysOn) args.push("--size", ALWAYS_ON_SIZE, "--no-auto-stop");
    const made = await runJson(args, { timeout: 180_000 });
    if (!made.ok) return made;
    return { ok: true, box: made.json, created: true };
  }
  const state = String(found.state || found.status || "").toLowerCase();
  if (/stopped|archiv|paused/.test(state)) {
    const back = await runJson(["resume", String(found.id)], { timeout: 180_000 });
    if (!back.ok) return back;
    return { ok: true, box: back.json || found, resumed: true };
  }
  return { ok: true, box: found };
}

/**
 * A URL that shows the machine's screen.
 *
 * This is how you watch a teammate work rather than reading about it
 * afterwards. VNC by default: the docs call it the more stable transport on
 * locked-down networks, and this is a thing you leave open in a pane.
 */
async function desktopUrl(id, { vnc = true } = {}) {
  if (!installed()) return { ok: false, reason: "not-installed" };
  const args = ["desktop", String(id)];
  if (vnc) args.push("--vnc");
  const res = await runJson(args, { timeout: 45_000 });
  if (!res.ok) return res;
  const j = res.json || {};
  const url = j.url || j.desktopUrl || j.streamUrl || "";
  return url ? { ok: true, url } : { ok: false, reason: "no url in response" };
}

/** Run a command on the machine. `box exec` goes over the API, not SSH. */
async function exec(id, command, { background = false, timeout = 120_000 } = {}) {
  if (!installed()) return { ok: false, reason: "not-installed" };
  const args = ["exec", String(id)];
  if (background) args.push("--background");
  args.push("--", "sh", "-lc", String(command));
  return run(args, { timeout });
}

/** This teammate's own folder on the shared disk. A convention, not a jail. */
function botDir(botId) {
  return `/home/box/hydo/${String(botId || "").replace(/[^a-zA-Z0-9-]/g, "")}`;
}

/** Make it, once, before handing the path to a teammate. */
async function ensureBotDir(id, botId) {
  const dir = botDir(botId);
  const res = await exec(id, `mkdir -p ${dir}`, { timeout: 30_000 });
  return res.ok ? { ok: true, dir } : res;
}

/**
 * Put the machine to sleep.
 *
 * Snapshots and pauses billing; a resume brings the disk back. This is the
 * whole cost story: a team computer nobody is using should cost nothing, and
 * the only way that is true is if something actually stops it.
 */
async function stop(id) {
  if (!installed()) return { ok: false, reason: "not-installed" };
  return run(["stop", String(id)], { timeout: 120_000 });
}

module.exports = {
  CLI,
  TEAM_BOX,
  IDLE_STOP_MS,
  ALWAYS_ON_SIZE,
  alwaysOnCost,
  installed,
  status,
  limits,
  list,
  findTeamBox,
  ensure,
  desktopUrl,
  exec,
  botDir,
  ensureBotDir,
  stop,
};
