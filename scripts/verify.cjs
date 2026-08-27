#!/usr/bin/env node
"use strict";

/**
 * Prove a change is good WITHOUT killing the app you are talking through.
 *
 * A teammate improving Hydo has a problem the rest of the codebase does not:
 * the obvious way to check its work (`npm run app`) rebuilds and relaunches
 * Electron, which tears down the window the user is watching and the session
 * the bot is answering in. So there was no safe verify loop, and a bot either
 * guessed or broke the app to find out.
 *
 * This builds and runs every suite, changes nothing that is running, and
 * prints a machine-readable summary at the end so a teammate can report the
 * result instead of pasting a wall of output.
 *
 * `npm run verify` — safe, run it as often as you like.
 * `npm run app`    — rebuild AND relaunch. That one interrupts the user.
 */

const { execFileSync, execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const quick = process.argv.includes("--quick");

function suites() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  // Derived from the real test script, so a suite added there is picked up
  // here without anyone remembering to update two lists.
  return [...String(pkg.scripts.test || "").matchAll(/node (scripts\/[\w.-]+\.cjs)/g)]
    .map((m) => m[1])
    .filter((f) => !only.length || only.some((o) => f.includes(o)));
}

function run(label, fn) {
  const t0 = Date.now();
  try {
    const out = fn();
    return { label, ok: true, ms: Date.now() - t0, out: String(out || "").trim() };
  } catch (err) {
    const out = [err.stdout, err.stderr].filter(Boolean).map(String).join("\n").trim();
    return { label, ok: false, ms: Date.now() - t0, out: out || String(err.message) };
  }
}

const results = [];

if (!quick) {
  results.push(
    run("build", () =>
      execSync("npx vite build", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    )
  );
}

// Every suite runs even after one fails. The `&&` chain in `npm test` stops at
// the first failure, so you fix one thing, re-run, and discover the next —
// which is the slowest possible way to find out you broke three things.
for (const file of suites()) {
  results.push(
    run(path.basename(file, ".cjs"), () =>
      execFileSync(process.execPath, [file], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
      })
    )
  );
}

const failed = results.filter((r) => !r.ok);
for (const r of failed) {
  console.log(`\n─── FAIL ${r.label} ${"─".repeat(Math.max(0, 40 - r.label.length))}`);
  console.log(r.out.split("\n").slice(0, 24).join("\n"));
}

const slow = results.filter((r) => r.ms > 4000).map((r) => `${r.label} ${(r.ms / 1000).toFixed(1)}s`);
console.log(
  `\nVERIFY ${failed.length ? "FAIL" : "OK"}  ${results.length - failed.length}/${results.length} passed` +
    (failed.length ? `  failing: ${failed.map((r) => r.label).join(", ")}` : "") +
    (slow.length ? `  slow: ${slow.join(", ")}` : "")
);
process.exit(failed.length ? 1 : 0);
