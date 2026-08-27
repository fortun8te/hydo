"use strict";

/**
 * Per-bot sandbox + Hermes home.
 *
 * Files the agent writes live in <hydo>/bots/<id>/workspace — never the
 * user's home or the hydo repo. Memory uses a Hermes *internal* profile
 * (no profile picker in the UI): ~/.hermes/profiles/hydo<id>/ so the
 * memory tool does not merge teammates. SHARED.md in every workspace is
 * the team pool.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKILL_SOURCES = [
  path.join(os.homedir(), ".hermes", "skills"),
  path.join(os.homedir(), ".hermes", "hermes-agent", "skills"),
  path.join(os.homedir(), ".hermes", "hermes-agent", "optional-skills"),
  path.join(os.homedir(), ".claude", "skills"),
  path.join(os.homedir(), ".codex", "skills"),
];

function profileName(botId) {
  const hex = String(botId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 48);
  return `hydo${hex || "bot"}`;
}

function profileDir(botId) {
  return path.join(os.homedir(), ".hermes", "profiles", profileName(botId));
}

function workspaceDir(hydoDir, botId) {
  return path.resolve(String(hydoDir), "bots", String(botId), "workspace");
}

function sharedMemoryFile(hydoDir) {
  return path.resolve(String(hydoDir), "shared", "MEMORY.md");
}

function lstatSafe(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function linkOrCopy(src, dest) {
  const existing = lstatSafe(dest);
  if (existing) {
    if (existing.isSymbolicLink()) {
      try {
        fs.statSync(dest);
        return;
      } catch {
        try {
          fs.unlinkSync(dest);
        } catch {
          return;
        }
      }
    } else {
      return;
    }
  }
  try {
    fs.symlinkSync(src, dest);
  } catch {
    try {
      if (!lstatSafe(dest) && fs.statSync(src).isFile()) fs.copyFileSync(src, dest);
    } catch {
      /* best-effort */
    }
  }
}

function ensureSharedLink(src, dest) {
  const existing = lstatSafe(dest);
  if (existing) {
    if (existing.isSymbolicLink()) {
      try {
        if (fs.realpathSync(dest) === fs.realpathSync(src)) return;
      } catch {
        /* broken or mismatched */
      }
    }
    try {
      fs.unlinkSync(dest);
    } catch {
      return;
    }
  }
  linkOrCopy(src, dest);
}

function isSkillDir(from, ent) {
  if (ent.name.startsWith(".")) return false;
  if (ent.isDirectory()) return true;
  if (!ent.isSymbolicLink()) return false;
  try {
    return fs.statSync(from).isDirectory();
  } catch {
    return false;
  }
}

function linkSkillTree(srcRoot, destRoot, depth = 0) {
  if (!srcRoot || !fs.existsSync(srcRoot) || depth > 3) return;
  let entries;
  try {
    entries = fs.readdirSync(srcRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const from = path.join(srcRoot, ent.name);
    if (!isSkillDir(from, ent)) continue;
    if (fs.existsSync(path.join(from, "SKILL.md"))) {
      linkOrCopy(from, path.join(destRoot, ent.name));
      continue;
    }
    linkSkillTree(from, destRoot, depth + 1);
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeIfMissing(file, body) {
  if (fs.existsSync(file)) return;
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, body);
}

const AGENTS_STAMP = `# Workspace rules

This folder is your sandbox. Write files here.

- Home is this directory. If the user named a path on their machine (Downloads, Desktop, a full path), read or copy it **here**. Don't wander unasked. Don't write outside this folder unless they asked to put the file back.
- Never \`rm -rf\`. Never touch Hydo or Hermes install files.
- Team: \`SHARED.md\`. Private: the **memory** tool.
- Desktop: Hermes \`computer_use\` only. No cua, no vision_analyze for clicking.
- Heavy coding: the harness under **Models** below (Grok Build, OpenCode, Cursor, or this shell).
`;

/**
 * Per-bot Hermes config.
 *
 * A profile with no config.yaml does NOT inherit ~/.hermes/config.yaml. It
 * falls all the way through to the code defaults in config_defaults.py, and
 * nothing says so . the values coincide often enough to look like inheritance.
 * Verified by asking Hermes itself:
 *
 *   HERMES_HOME=~/.hermes             hermes config get compression.tail_mode  -> lean
 *   HERMES_HOME=~/.hermes/profiles/…  hermes config get compression.tail_mode  -> legacy
 *
 * `legacy` is the old tail-retention policy: after a compaction it drags a
 * large slice of the old conversation into every subsequent turn. Nous' own
 * compaction evals put it around 162K retained against ~49K for `lean`. That
 * is paid on EVERY turn of a long-lived thread . which is exactly what a
 * teammate you keep for months is.
 *
 * Written narrowly on purpose: only the keys where the code default is the
 * wrong choice for a long-running teammate. Everything else stays Hermes'
 * business, so a Hermes upgrade that improves a default still reaches us.
 */
const PROFILE_CONFIG = `# Written by Hydo. A Hermes profile does not inherit ~/.hermes/config.yaml,
# so anything not set here is the code default, not your own setting.
compression:
  tail_mode: lean
`;

function writeProfileConfig(home) {
  const file = path.join(home, "config.yaml");
  try {
    // Only when it would change: this file is cheap, but a bot may have been
    // given settings by hand and rewriting them every launch would be rude.
    if (fs.existsSync(file)) {
      const cur = fs.readFileSync(file, "utf8");
      if (cur.includes("tail_mode")) return;
      fs.writeFileSync(file, `${cur.replace(/\s*$/, "")}\n${PROFILE_CONFIG}`);
      return;
    }
    fs.writeFileSync(file, PROFILE_CONFIG);
  } catch {
    /* a profile without it still runs, just on the older tail policy */
  }
}

function prepare(hydoDir, botId, soulText) {
  if (!hydoDir) throw new Error("prepare: hydoDir required");
  if (!botId) throw new Error("prepare: botId required");

  const cwd = workspaceDir(hydoDir, botId);
  ensureDir(cwd);
  ensureDir(path.join(hydoDir, "bots", botId, "logs"));

  const shared = sharedMemoryFile(hydoDir);
  writeIfMissing(
    shared,
    "# Shared team memory\n\nFacts every Hydo teammate should know. Keep it short.\n"
  );
  const sharedLink = path.join(cwd, "SHARED.md");
  ensureSharedLink(shared, sharedLink);

  const home = profileDir(botId);
  for (const d of ["memories", "sessions", "skills", "logs", "workspace", "cron"]) {
    ensureDir(path.join(home, d));
  }

  writeProfileConfig(home);

  const launchHome = path.join(os.homedir(), ".hermes");
  const envSrc = path.join(launchHome, ".env");
  const envDest = path.join(home, ".env");
  if (fs.existsSync(envSrc) && !fs.existsSync(envDest)) {
    try {
      fs.copyFileSync(envSrc, envDest);
    } catch {
      /* auth still falls back to launch home */
    }
  }

  const { seedSoulFile, DEFAULT_SOUL } = require("./soul.cjs");
  // Packed SOUL.default.md — never the stripped snapshot (that loses the stamp).
  void soulText;
  seedSoulFile(path.join(home, "SOUL.md"), DEFAULT_SOUL);
  seedSoulFile(path.join(hydoDir, "bots", botId, "SOUL.md"), DEFAULT_SOUL);

  const skillsDest = path.join(home, "skills");
  for (const src of SKILL_SOURCES) linkSkillTree(src, skillsDest);

  fs.writeFileSync(path.join(cwd, "AGENTS.md"), AGENTS_STAMP);

  const hydoMemory = path.join(hydoDir, "bots", botId, "MEMORY.md");
  const hydoUser = path.join(hydoDir, "bots", botId, "USER.md");
  const profileMemory = path.join(home, "memories", "MEMORY.md");
  const profileUser = path.join(home, "USER.md");
  writeIfMissing(hydoMemory, "# Memory\n\nPrivate to this teammate. Hermes memory tool writes here via this profile home.\n");
  writeIfMissing(hydoUser, "# User\n");
  if (fs.existsSync(hydoMemory) && !fs.existsSync(profileMemory)) {
    try {
      fs.copyFileSync(hydoMemory, profileMemory);
    } catch {
      /* ignore */
    }
  }
  writeIfMissing(profileMemory, "# Memory\n");
  if (fs.existsSync(hydoUser) && !fs.existsSync(profileUser)) {
    try {
      fs.copyFileSync(hydoUser, profileUser);
    } catch {
      /* ignore */
    }
  }
  writeIfMissing(profileUser, "# User\n");

  return {
    cwd,
    profile: profileName(botId),
    hermesHome: home,
    sharedMemory: shared,
    memoryFile: profileMemory,
  };
}

function appendSubagentLog(hydoDir, botId, evt) {
  if (!hydoDir || !botId || !evt) return;
  const file = path.join(path.resolve(String(hydoDir)), "bots", String(botId), "logs", "subagents.jsonl");
  try {
    ensureDir(path.dirname(file));
    const row = {
      at: new Date().toISOString(),
      type: evt.type || evt.phase || "",
      goal: evt.goal || "",
      status: evt.status || "",
      subagentId: evt.subagent_id || evt.subagentId || "",
    };
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  } catch {
    /* log must never break a turn */
  }
}

function readSharedMemory(hydoDir) {
  try {
    return fs.readFileSync(sharedMemoryFile(hydoDir), "utf8").trim();
  } catch {
    return "";
  }
}

module.exports = {
  profileName,
  profileDir,
  workspaceDir,
  sharedMemoryFile,
  prepare,
  appendSubagentLog,
  readSharedMemory,
  AGENTS_STAMP,
};
