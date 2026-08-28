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
 * How many source files changed after this bundle was built.
 *
 * Only the directories that actually end up IN the bundle, so a doc edit or a
 * new test does not offer someone a ninety-second rebuild for nothing. Cheap
 * by construction: a bounded walk of two trees, no git, no spawning.
 */
function newerThanBuild(repo, builtAt) {
  const at = Date.parse(builtAt || "");
  if (!repo || !at) return 0;
  let count = 0;
  const walk = (dir, depth) => {
    if (depth > 6 || count > 50) return;
    let items = [];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      if (it.name === "node_modules" || it.name.startsWith(".")) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!/\.(cjs|js|jsx|css|html)$/.test(it.name)) continue;
      // The stamp is written BY the build, so it is always newer than the
      // build and would make every bundle look stale forever.
      if (it.name === "build-stamp.json") continue;
      try {
        if (fs.statSync(full).mtimeMs > at) count += 1;
      } catch {
        /* vanished mid-walk */
      }
    }
  };
  walk(path.join(repo, "electron"), 0);
  walk(path.join(repo, "src"), 0);
  return count;
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
  // Source edited SINCE this bundle was built.
  //
  // Comparing commits alone was the real hole: the overwhelmingly common case
  // on this machine is source that changed without being committed — the user
  // editing, or a teammate editing on their behalf — and against `HEAD` that
  // is invisible. The app then sat there with nothing to say while the
  // installed build was genuinely out of date, which is exactly what "the
  // updating is dodgy" describes. `behind` still wins when it applies; this
  // only speaks when the commit count cannot.
  const stale = behind === 0 ? newerThanBuild(i.repo, i.builtAt) : 0;
  return {
    ok: true,
    state: behind > 0 ? "behind" : stale > 0 ? "stale" : workDirty ? "dirty" : "current",
    behind,
    stale,
    dirty: workDirty !== "",
    head,
    headShort: head.slice(0, 7),
    checkedAt: new Date().toISOString(),
  };
}

const APPS_DIR = "/Applications";
const INSTALLED = path.join(APPS_DIR, "Hydo.app");


/**
 * Where npm actually is.
 *
 * THE reason "Update failed" was a loop. A GUI-launched Mac app does not
 * inherit a login shell's PATH -- it gets roughly /usr/bin:/bin:/usr/sbin:
 * /sbin -- and on this machine npm lives at ~/.hermes/node/bin/npm, which is
 * on none of those. So `execFile("npm", ...)` was ENOENT before a build ever
 * started, the handler reported the generic "The build failed", and pressing
 * retry did exactly the same nothing. The same class of bug the gateway
 * already fixes by prepending ~/.ascii/bin to its child's PATH.
 *
 * Ordered by how much they are worth trusting: an explicit override, then the
 * interpreter we are already running under, then the usual install roots, then
 * the user's own login shell as a last resort (correct, but it spawns a shell,
 * so it is not the first thing tried).
 */
function npmCandidates() {
  const home = os.homedir();
  const out = [];
  const override = String(process.env.HYDO_NPM || "").trim();
  if (override) out.push(override);
  // Node ships npm beside it. `process.execPath` in a packaged app is
  // Electron, not node, so this only helps unpackaged -- but when it helps it
  // is the most correct answer available.
  try {
    out.push(path.join(path.dirname(process.execPath), "npm"));
  } catch {
    /* execPath is always set in practice */
  }
  out.push(
    path.join(home, ".hermes", "node", "bin", "npm"),
    "/opt/homebrew/bin/npm",
    "/usr/local/bin/npm",
    "/usr/bin/npm"
  );
  // nvm keeps one npm per installed version; take the newest that exists.
  try {
    const nvm = path.join(home, ".nvm", "versions", "node");
    const versions = fs.readdirSync(nvm).sort().reverse();
    for (const v of versions) out.push(path.join(nvm, v, "bin", "npm"));
  } catch {
    /* no nvm on this machine */
  }
  return out;
}

/** @returns {string} an absolute npm path, or "" when there is genuinely none. */
function findNpm() {
  for (const c of npmCandidates()) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* unreadable candidate is just a miss */
    }
  }
  // Last resort: ask the user's own shell, which knows about version managers
  // we have never heard of. Bounded, and failure here is still just "".
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const found = String(
      execFileSync(shell, ["-lc", "command -v npm"], {
        timeout: 5000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    ).trim();
    if (found && fs.existsSync(found)) return found;
  } catch {
    /* no shell, or npm genuinely absent */
  }
  return "";
}

/** PATH for the build child: npm's own directory first, then the usual ones. */
function buildPath(npmBin) {
  const dirs = [];
  if (npmBin) dirs.push(path.dirname(npmBin));
  dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
  const existing = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return [...new Set([...dirs, ...existing])].join(path.delimiter);
}

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
    const npmBin = findNpm();
    if (!npmBin) {
      // Say WHICH thing is missing. "The build failed" sent the user to press
      // retry on an error that could never resolve itself.
      resolve({
        ok: false,
        reason: "npm was not found on this machine.",
        detail:
          "Hydo builds itself with npm and could not locate it. Set HYDO_NPM to the full path of your npm binary, or install Node.",
      });
      return;
    }
    const started = Date.now();
    execFile(
      npmBin,
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
        // A GUI-launched app has almost no PATH, and `npm run pack` shells
        // out to node, electron-builder and git in turn — all of which need
        // to be findable by the CHILD, not just by us.
        env: { ...process.env, npm_config_yes: "true", PATH: buildPath(npmBin) },
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

module.exports = { buildInfo, check, rebuildAndInstall, install, findNpm, buildPath, STAMP_PATH, INSTALLED };
