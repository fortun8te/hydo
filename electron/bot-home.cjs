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

/**
 * Top-level blocks copied from the launch config into every bot profile.
 *
 * `mcp_servers` is the one that was actually broken. Hermes resolves a
 * session's MCP servers by NAME against the config of whatever HERMES_HOME it
 * was started with, and Hydo starts every bot in its own profile home. Servers
 * added from the Plugins screen go to the launch home (`mcp.servers.add` takes
 * a `profile` param and Hydo never passed one), so:
 *
 *   HERMES_HOME=~/.hermes             config get mcp_servers  -> chrome-devtools, …
 *   HERMES_HOME=~/.hermes/profiles/…  config get mcp_servers  -> "not set"
 *
 * Every name Hydo pinned was then dropped by the resolver as unknown. Which
 * means connecting an app in Plugins changed nothing for any teammate, and the
 * whole per-bot MCP design resolved to an empty list. It looked like it worked
 * because nothing errors: the pin is silently filtered.
 *
 * The rest are settings a teammate is simply wrong without. A bot on the code
 * default reasons in the wrong timezone and searches with a different backend
 * than the user's own CLI.
 *
 * An ALLOWLIST, not a copy of the file: a profile is meant to be its own
 * thing, and blindly inheriting everything would undo that on purpose.
 */
const MIRROR_KEYS = ["mcp_servers", "timezone", "web", "skills"];

/**
 * Lift whole top-level blocks out of a YAML file, as text.
 *
 * Text rather than parse-and-re-emit because there is no YAML dependency here
 * and adding one to move four blocks is not worth it . but also because
 * copying the bytes cannot reformat, reorder or lose a comment the user wrote.
 * A top-level block runs until the next line that starts in column zero.
 */
function yamlBlocks(text, keys) {
  const lines = String(text || "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*):/.exec(lines[i]);
    if (!m || !keys.includes(m[1])) continue;
    const block = [lines[i]];
    let j = i + 1;
    for (; j < lines.length; j++) {
      // Blank lines belong to the block only if more of it follows; a trailing
      // blank would otherwise glue the next block's comment on.
      if (/^\s*$/.test(lines[j]) || /^\s/.test(lines[j])) block.push(lines[j]);
      else break;
    }
    while (block.length && /^\s*$/.test(block[block.length - 1])) block.pop();
    out.push(block.join("\n"));
    i = j - 1;
  }
  return out.join("\n");
}

function writeProfileConfig(home) {
  const file = path.join(home, "config.yaml");
  let mirrored = "";
  try {
    const launch = path.join(os.homedir(), ".hermes", "config.yaml");
    if (fs.existsSync(launch)) {
      mirrored = yamlBlocks(fs.readFileSync(launch, "utf8"), MIRROR_KEYS);
    }
  } catch {
    /* no launch config: the bot runs on Hermes' defaults, as before */
  }
  const want = mirrored ? `${PROFILE_CONFIG}\n${mirrored}\n` : PROFILE_CONFIG;
  try {
    // Only when it would change: this file is cheap, but a bot may have been
    // given settings by hand and rewriting them every launch would be rude.
    // Rewritten when it would CHANGE, so adding a plugin reaches existing
    // teammates on their next turn instead of only new ones . but a byte
    // identical write is skipped, because this file is read at session start
    // and churn buys nothing.
    if (fs.existsSync(file)) {
      const cur = fs.readFileSync(file, "utf8");
      if (cur === want) return;
      // Only ours is replaced. A profile someone edited by hand keeps what
      // they wrote; the mirrored blocks are appended to it instead.
      if (cur.startsWith("# Written by Hydo.")) {
        fs.writeFileSync(file, want);
        return;
      }
      if (cur.includes("tail_mode")) return;
      fs.writeFileSync(file, `${cur.replace(/\s*$/, "")}\n${want}`);
      return;
    }
    fs.writeFileSync(file, want);
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

  // AGENTS.md sits at the FRONT of the prompt, and xAI's cache keys on a
  // reused prefix — so rewriting it is not free, it costs the 75%
  // cached-input discount on everything behind it. store.cjs already guards
  // its own write with a read-and-compare ("rewritten only when it CHANGES"),
  // but that guard could never hold: `prepare()` runs first on every turn and
  // clobbered the file back down to the bare stamp, so the compare always
  // mismatched and the file was rewritten twice per turn, forever.
  //
  // The stamp is a floor, not the whole file. If it is already there, whoever
  // wrote the rest owns the file.
  const agentsFile = path.join(cwd, "AGENTS.md");
  let agentsCur = "";
  try {
    agentsCur = fs.readFileSync(agentsFile, "utf8");
  } catch {
    agentsCur = "";
  }
  if (!agentsCur.startsWith(AGENTS_STAMP)) fs.writeFileSync(agentsFile, AGENTS_STAMP);

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
