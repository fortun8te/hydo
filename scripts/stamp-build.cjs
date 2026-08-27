"use strict";

/**
 * Write down what this build IS, at the moment it is made.
 *
 * A packaged Hydo.app has no .git — it is a bundle in /Applications, not a
 * checkout — so anything the Updates pane wants to say about the commit has to
 * be captured here, on the machine that ran the build, and carried inside the
 * bundle. electron/build-info.cjs reads this file back.
 *
 * Run from `npm run build`, which every packaging path goes through.
 * Failing to reach git is not a build failure: the stamp is written anyway
 * with nulls, and the pane says "build unknown" instead of an empty
 * parenthesis. A build that refuses to build because git is missing would be a
 * worse bug than a build that cannot name its own commit.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "electron", "build-stamp.json");

const git = (...args) => {
  try {
    return String(execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })).trim();
  } catch {
    return null;
  }
};

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const sha = git("rev-parse", "HEAD");
const count = git("rev-list", "--count", "HEAD");
const top = git("rev-parse", "--show-toplevel");

const stamp = {
  version: pkg.version,
  // Monotonic and derived. Nobody types this.
  build: Number(count) || null,
  sha,
  // Was the working copy clean when this was built? A dirty build is not
  // reproducible from its sha, and the pane says so rather than implying the
  // commit is the whole truth.
  dirty: git("status", "--porcelain") ? true : false,
  builtAt: new Date().toISOString(),
  // Absolute, so the installed app can find the working copy it came from —
  // that path is the only "update server" this app has.
  repo: top || ROOT,
};

fs.writeFileSync(OUT, `${JSON.stringify(stamp, null, 2)}\n`);
