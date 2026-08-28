#!/usr/bin/env node
"use strict";

/**
 * prune-profiles.cjs — remove Hermes profiles no teammate owns any more.
 *
 * `~/.hermes/profiles/hydo<id>/` is created per teammate and deliberately NOT
 * deleted when the teammate is (store.cjs: silently deleting someone's files
 * on a delete is its own bug). Two things then pile up:
 *
 *   - profiles for bots the user really did delete;
 *   - profiles written by the TEST SUITE, which used to land in the real
 *     Hermes home because `profileDir` was hardcoded. Measured on this
 *     machine before the fix: 1,198 profiles, 749MB. That leak is closed
 *     (HYDO_PROFILE_ROOT), but the existing debris still needs clearing.
 *
 * DRY RUN BY DEFAULT. Nothing is deleted without `--yes`, because this is the
 * user's data: a profile holds a teammate's MEMORY.md, USER.md, state.db and
 * cron jobs, and an orphan by Hydo's reckoning could still be one someone
 * cares about.
 *
 *   node scripts/prune-profiles.cjs            # list what would go
 *   node scripts/prune-profiles.cjs --yes      # actually delete
 *   node scripts/prune-profiles.cjs --keep-recent 7   # spare the last 7 days
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const DO_IT = args.includes("--yes");
const keepIdx = args.indexOf("--keep-recent");
const KEEP_DAYS = keepIdx >= 0 ? Number(args[keepIdx + 1]) || 0 : 0;

const botHome = require("../electron/bot-home.cjs");
const ROOT = botHome.profileRoot();

/** Profile names belonging to teammates that still exist. */
function liveProfileNames() {
  const dir =
    process.env.HYDO_USER_DATA ||
    path.join(os.homedir(), "Library", "Application Support", "Hydo");
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  } catch (err) {
    // Fail CLOSED: with no state file we cannot tell orphan from live, and
    // "delete everything" is the wrong guess to make with someone's data.
    console.error(`Cannot read Hydo state (${err.message}). Refusing to guess — nothing deleted.`);
    process.exit(2);
  }
  const agents = Array.isArray(state.agents) ? state.agents : [];
  return new Set(agents.map((a) => botHome.profileName(a.id)));
}

const live = liveProfileNames();
let entries;
try {
  entries = fs.readdirSync(ROOT).filter((n) => n.startsWith("hydo"));
} catch {
  console.log(`No profile directory at ${ROOT} — nothing to do.`);
  process.exit(0);
}

const cutoff = KEEP_DAYS > 0 ? Date.now() - KEEP_DAYS * 86400_000 : 0;
const sizeOf = (p) => {
  let total = 0;
  const walk = (d) => {
    let items = [];
    try {
      items = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      const full = path.join(d, it.name);
      if (it.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  };
  walk(p);
  return total;
};

const orphans = [];
let kept = 0;
for (const name of entries) {
  if (live.has(name)) {
    kept += 1;
    continue;
  }
  const full = path.join(ROOT, name);
  if (cutoff) {
    try {
      if (fs.statSync(full).mtimeMs > cutoff) {
        kept += 1;
        continue;
      }
    } catch {
      /* fall through and treat as an orphan */
    }
  }
  orphans.push(full);
}

const bytes = orphans.reduce((n, p) => n + sizeOf(p), 0);
const mb = (bytes / 1024 / 1024).toFixed(1);

console.log(`profiles root : ${ROOT}`);
console.log(`total         : ${entries.length}`);
console.log(`still in use  : ${kept}`);
console.log(`orphaned      : ${orphans.length}  (${mb} MB)`);

if (!orphans.length) process.exit(0);

if (!DO_IT) {
  console.log(`\nDry run. Nothing deleted.`);
  console.log(orphans.slice(0, 10).map((p) => `  ${path.basename(p)}`).join("\n"));
  if (orphans.length > 10) console.log(`  … and ${orphans.length - 10} more`);
  console.log(`\nRe-run with --yes to delete them.`);
  process.exit(0);
}

let gone = 0;
for (const p of orphans) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
    gone += 1;
  } catch (err) {
    console.error(`  could not remove ${path.basename(p)}: ${err.message}`);
  }
}
console.log(`\nRemoved ${gone} profile(s), ${mb} MB.`);
