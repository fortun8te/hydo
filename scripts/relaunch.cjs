#!/usr/bin/env node
"use strict";

/**
 * Rebuild and restart Hydo, safely.
 *
 * Two things make the naive version dangerous, and both are handled here.
 *
 * 1. `pkill electron` would kill Claude, Cursor, Discord, Grok Bot and every
 *    other Electron app on the machine. Only processes launched from THIS
 *    repo's node_modules are touched, matched on their full path.
 *
 * 2. The window is the user's. Restarting it interrupts whatever they were
 *    reading, so this refuses to run unless the build and the tests pass
 *    first: a relaunch into a broken app is worse than no relaunch.
 *
 * The conversation survives — the store persists to state.json and Hermes
 * sessions are resumed on boot — but the interruption is real, so this is not
 * something to do on a whim. `npm run verify` proves a change without it.
 */

const { execFileSync, spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MARKER = path.join(ROOT, "node_modules", "electron");
const force = process.argv.includes("--force");

function ours() {
  try {
    const ps = execFileSync("ps", ["-eo", "pid=,command="], { encoding: "utf8" });
    return ps
      .split("\n")
      .filter((l) => l.includes(MARKER))
      .map((l) => Number(l.trim().split(/\s+/)[0]))
      .filter(Boolean);
  } catch {
    return [];
  }
}

if (!force) {
  process.stdout.write("verifying first…\n");
  try {
    execFileSync(process.execPath, [path.join(__dirname, "verify.cjs")], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    console.error("\nNOT relaunching: verify failed. Fix it, or pass --force.");
    process.exit(1);
  }
}

const pids = ours();
if (pids.length) {
  process.stdout.write(`stopping ${pids.length} Hydo process(es)\n`);
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
}

// Detached, so the new app is not a child of whatever shell a teammate ran
// this from and does not die when that turn ends.
const child = spawn("npx", ["electron", "."], {
  cwd: ROOT,
  env: { ...process.env, HYDO_DIST: "1" },
  detached: true,
  stdio: "ignore",
});
child.unref();
process.stdout.write("Hydo relaunched from dist.\n");
