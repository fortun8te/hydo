"use strict";

/**
 * What build is this, really.
 *
 * The Updates pane used to read `label="Build 2026.08.26.2"` — a string typed
 * into JSX. It was accurate for exactly one day and then quietly lied on every
 * rebuild, which is the same class of bug as a control that does nothing: it
 * looks like information and isn't. Nothing here is typed by hand; every field
 * is either read off package.json, stamped by scripts/stamp-build.cjs at build
 * time, or asked of git at the moment the pane is opened.
 *
 * Three facts, kept separate on purpose:
 *   - version   — package.json, the only place a human edits a version.
 *   - stamp     — electron/build-stamp.json, written by the build that made
 *                 THIS bundle: sha, dirty flag, timestamp, and the absolute
 *                 path of the repo it was built from.
 *   - channel   — `release` only when Electron says app.isPackaged. An
 *                 unpackaged run is `dev` even with a perfectly good stamp
 *                 sitting next to it, because that stamp describes the last
 *                 packaging, not the code currently being served by vite.
 *
 * There is no update SERVER. `git remote -v` is empty, the gh token is invalid
 * and electron-updater is not a dependency, so a "Check for updates" button
 * would be a control that always fails. What is true instead: this machine has
 * the repo the app was built from, so the app can compare its own stamped sha
 * against that working copy's HEAD and rebuild itself from it. That is what
 * check() and the rebuild path below do — offline, no server, no account.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFile, execFileSync } = require("node:child_process");

const HERE = __dirname;
const STAMP_PATH = path.join(HERE, "build-stamp.json");
const PKG_PATH = path.join(HERE, "..", "package.json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** git, synchronously, with every failure mode collapsed to null. */
function git(repo, args, timeout = 4000) {
  try {
    return String(
      execFileSync("git", ["-C", repo, ...args], { timeout, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    ).trim();
  } catch {
    return null;
  }
}

/**
 * The repo this build came from.
 *
 * Packaged, the only honest answer is the path the stamp recorded — the bundle
 * in /Applications is not itself a git checkout. Unpackaged we are standing in
 * the repo, so prefer that: a stale stamp from a week-old pack must not make a
 * dev run report someone else's directory.
 */
function repoRoot(stamp, packaged) {
  if (!packaged) {
    const here = git(path.join(HERE, ".."), ["rev-parse", "--show-toplevel"]);
    if (here) return here;
  }
  const stamped = stamp && typeof stamp.repo === "string" ? stamp.repo : "";
  if (stamped && fs.existsSync(path.join(stamped, ".git"))) return stamped;
  return null;
}

/**
 * Describe the running build. `packaged` is passed in rather than required
 * from electron, so the test suite can call this without an Electron process.
 */
function buildInfo(packaged) {
  const pkg = readJson(PKG_PATH) || {};
  const stamp = readJson(STAMP_PATH);
  const channel = packaged ? "release" : "dev";
  const repo = repoRoot(stamp, packaged);
  // In dev the stamp's sha is the wrong answer by construction, so ask the
  // working copy directly and say so.
  const liveSha = channel === "dev" && repo ? git(repo, ["rev-parse", "HEAD"]) : null;
  const sha = liveSha || (stamp && stamp.sha) || null;
  // The build number: `git rev-list --count HEAD`, which only ever goes up and
  // needs no counter file anyone could forget to commit. A packaged app on
  // another machine has no .git, so the number is CAPTURED into the stamp at
  // build time and merely read back here; when neither the stamp nor a repo
  // can supply it the answer is null and the pane says "build unknown" rather
  // than rendering an empty pair of parentheses.
  const liveBuild = channel === "dev" && repo ? git(repo, ["rev-list", "--count", "HEAD"]) : null;
  const stampedBuild = stamp && Number.isFinite(Number(stamp.build)) ? Number(stamp.build) : null;
  const build = Number(liveBuild) || stampedBuild || null;
  const dirty = channel === "dev" && repo ? git(repo, ["status", "--porcelain"]) !== "" : !!(stamp && stamp.dirty);
  return {
    version: String(pkg.version || "0.0.0"),
    build,
    channel,
    sha,
    shortSha: sha ? sha.slice(0, 7) : null,
    dirty,
    // Packaged: when the bundle was built. Dev: there is no build, so null
    // rather than a borrowed timestamp that would read as this session's.
    builtAt: channel === "release" && stamp ? stamp.builtAt || null : null,
    stampedVersion: stamp ? stamp.version || null : null,
    repo,
    platform: `${os.platform()}-${os.arch()}`,
    electron: process.versions.electron || null,
  };
}

/**
 * How far behind the working copy is this build.
 *
 * `rev-list --count sha..HEAD` is the whole mechanism. It answers offline, it
 * cannot be wrong about a commit that exists locally, and when the stamped sha
 * is not in the repo at all (built elsewhere, or history rewritten) it fails
 * loudly instead of guessing — which is reported as `unknown`, not as current.
 */
function check(info) {
  const i = info || buildInfo(false);
  if (i.channel === "dev") {
    return {
      ok: true,
      state: "dev",
      behind: 0,
      dirty: i.dirty,
      reason: "Running from source — there is nothing to update to.",
    };
  }
  if (!i.repo) {
    return { ok: true, state: "unknown", behind: 0, dirty: false, reason: "The repo this was built from is not on this machine." };
  }
  if (!i.sha) {
    return { ok: true, state: "unknown", behind: 0, dirty: false, reason: "This build carries no commit stamp." };
  }
  const known = git(i.repo, ["cat-file", "-e", `${i.sha}^{commit}`]);
  // cat-file prints nothing on success, so "" is a hit and null is a miss.
  if (known === null) {
    return { ok: true, state: "unknown", behind: 0, dirty: false, reason: "This build's commit is not in the working copy." };
  }
  const count = git(i.repo, ["rev-list", "--count", `${i.sha}..HEAD`]);
  const head = git(i.repo, ["rev-parse", "HEAD"]);
  const workDirty = git(i.repo, ["status", "--porcelain"]);
  if (count === null || head === null) {
    return { ok: true, state: "unknown", behind: 0, dirty: false, reason: "git could not be read." };
  }
  const behind = Number(count) || 0;
  return {
    ok: true,
    state: behind > 0 ? "behind" : workDirty ? "dirty" : "current",
    behind,
    dirty: workDirty !== "",
    head,
    headShort: head.slice(0, 7),
    checkedAt: new Date().toISOString(),
  };
}

const APPS_DIR = "/Applications";
const INSTALLED = path.join(APPS_DIR, "Hydo.app");

/**
 * Rebuild from the working copy and swap the result into /Applications.
 *
 * Two hard rules, both learned the obvious way:
 *
 *  - /Applications/Hydo.app is NEVER written in place. electron-builder writes
 *    into the repo's dist/, we `ditto` that into a sibling temp directory, and
 *    only then do two renames. A rename within one volume is atomic, so at no
 *    instant is there a half-copied Hydo.app — a failure anywhere before the
 *    swap leaves the installed app untouched.
 *  - It never relaunches. Killing the app the user is looking at, to install a
 *    build they have not been told about, is not an update, it is a crash with
 *    a nice name. The renderer asks.
 */
function rebuildAndInstall(opts) {
  const o = opts || {};
  const repo = o.repo;
  return new Promise((resolve) => {
    if (!repo || !fs.existsSync(path.join(repo, "package.json"))) {
      resolve({ ok: false, reason: "No working copy to build from." });
      return;
    }
    const started = Date.now();
    execFile(
      "npm",
      ["run", "pack"],
      {
        cwd: repo,
        // electron-builder is slow and chatty; 20 minutes is well past the
        // measured ~90s and still bounded, so a wedged build cannot hang the
        // handler forever.
        timeout: 20 * 60 * 1000,
        maxBuffer: 32 * 1024 * 1024,
        // CSC_IDENTITY_AUTO_DISCOVERY=false is already in the pack script.
        // There are no signing certificates on this machine and a failed
        // signing step fails the whole build.
        env: { ...process.env, npm_config_yes: "true" },
      },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            reason: "The build failed.",
            detail: String(stderr || stdout || err.message).trim().split("\n").slice(-6).join("\n"),
          });
          return;
        }
        const built = path.join(repo, "dist", `mac-${process.arch}`, "Hydo.app");
        if (!fs.existsSync(built)) {
          resolve({ ok: false, reason: `The build produced no app at ${built}.` });
          return;
        }
        try {
          resolve({ ...install(built), seconds: Math.round((Date.now() - started) / 1000) });
        } catch (e) {
          resolve({ ok: false, reason: e.message });
        }
      }
    );
  });
}

/**
 * Put a freshly built .app at /Applications/Hydo.app without ever leaving a
 * partial one there. Exported so the swap can be tested on its own.
 */
function install(built, dir) {
  const apps = dir || APPS_DIR;
  const target = path.join(apps, "Hydo.app");
  const staged = path.join(apps, ".Hydo.app.staged");
  const old = path.join(apps, ".Hydo.app.previous");
  fs.rmSync(staged, { recursive: true, force: true });
  fs.rmSync(old, { recursive: true, force: true });
  // ditto, not cp: it preserves the bundle's symlinks and extended attributes,
  // and a cp -R of a Framework's Versions/Current is how you get an app that
  // launches to a dyld error.
  execFileSync("ditto", [built, staged], { timeout: 10 * 60 * 1000, stdio: "ignore" });
  const had = fs.existsSync(target);
  if (had) fs.renameSync(target, old);
  try {
    fs.renameSync(staged, target);
  } catch (e) {
    // Put the old one back rather than leaving /Applications with no Hydo.
    if (had) fs.renameSync(old, target);
    throw e;
  }
  fs.rmSync(old, { recursive: true, force: true });
  return { ok: true, installed: target, replaced: had };
}

module.exports = { buildInfo, check, rebuildAndInstall, install, STAMP_PATH, INSTALLED };
