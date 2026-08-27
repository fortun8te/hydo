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
- Data: use a real markdown table. For a chart, a fenced \`\`\`chart block of JSON: \`{"type":"bar"|"line","title"?,"labels":[...],"series":[{"name"?,"values":[num|null,...]}]}\` or \`{"type":"stat","label"?,"value","delta"?}\`. Omit unknown values as \`null\` — never invent one.
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
/**
 * The rules in AGENTS.md that should not be advice.
 *
 * `approvals.deny` is fnmatch globs against terminal commands, and it blocks
 * BEFORE the --yolo / mode=off bypass . which makes it the only place a rule
 * holds regardless of what the review model decides or what anyone turns off
 * in a hurry. AGENTS.md already says "never rm -rf" and "never touch Hydo or
 * Hermes install files", but a sentence in a prompt is a request. These are
 * the same two rules as enforcement.
 *
 * Deliberately short. Every glob here is a command a teammate has no business
 * running under any circumstances . not a list of things that are usually
 * unwise, which is what the approval flow is already for. A long deny list
 * turns into a teammate that cannot work and a user who disables it.
 */
const DENY_GLOBS = [
  // Recursive force-delete, in the spellings that actually get typed.
  "rm -rf *",
  "rm -fr *",
  "rm -r -f *",
  "sudo rm -rf *",
  // Its own installation, and Hydo's. A teammate that breaks these cannot
  // report that it broke them.
  "* ~/.hermes/*",
  "* ~/Projects/hydo/*",
  // Piping the network into a shell. This is how a prompt injection becomes
  // code execution, and no legitimate task needs it done blind.
  "*curl*|*sh*",
  "*wget*|*sh*",
  // Disk devices.
  "dd if=* of=/dev/*",
  "mkfs*",
];

const PROFILE_CONFIG = `# Written by Hydo. A Hermes profile does not inherit ~/.hermes/config.yaml,
# so anything not set here is the code default, not your own setting.
compression:
  tail_mode: lean
`;

/**
 * Read the `mode:` scalar out of a profile config's LAST `approvals:` block
 * (same "last block wins" rule as `withDeny` below — YAML honours the final
 * duplicate key, so a mode set by a Settings UI must land there, not in an
 * earlier shadowed block). Returns null when no explicit mode is written,
 * which is the "silently inheriting Hermes' smart default" case the UI needs
 * to tell apart from an actual choice.
 */
function extractApprovalsMode(text) {
  const lines = String(text || "").split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/^approvals:/.test(lines[i])) at = i;
  if (at < 0) return null;
  for (let i = at + 1; i < lines.length && /^\s/.test(lines[i]); i++) {
    const m = /^\s+mode:\s*(.+?)\s*(#.*)?$/.exec(lines[i]);
    if (m) return m[1].replace(/^["']|["']$/, "").replace(/["']$/, "");
  }
  return null;
}

/**
 * Set (or insert) `mode:` in the LAST `approvals:` block, leaving every
 * other key in that block — timeout, cron_mode, deny, smart_policy, etc. —
 * untouched.
 */
function withMode(text, mode) {
  const lines = String(text).split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/^approvals:/.test(lines[i])) at = i;
  if (at < 0) return `${text.replace(/\s*$/, "")}\napprovals:\n  mode: ${mode}\n`;
  let end = at + 1;
  for (; end < lines.length && /^\s/.test(lines[end]); end++) {
    if (/^\s+mode:\s*/.test(lines[end])) {
      lines[end] = `  mode: ${mode}`;
      return lines.join("\n");
    }
  }
  lines.splice(at + 1, 0, `  mode: ${mode}`);
  return lines.join("\n");
}

/**
 * Fold the deny globs INTO whichever `approvals:` block the file ends up with.
 *
 * The first version of this emitted its own `approvals:` block, and the launch
 * config's `approvals:` was then mirrored in after it. YAML takes the LAST
 * definition of a duplicate key, so the deny list was silently discarded .
 * `hermes config get approvals.deny` answered `[]`. Which is exactly the
 * failure a deny list exists to prevent: a rule that looks enforced and is not
 * is worse than one you know you do not have.
 */
function withDeny(text) {
  const deny = ["  deny:", ...DENY_GLOBS.map((g) => `    - ${JSON.stringify(g)}`)].join("\n");
  const lines = String(text).split("\n");
  // The LAST approvals block, because that is the one YAML honours.
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/^approvals:/.test(lines[i])) at = i;
  if (at < 0) return `${text.replace(/\s*$/, "")}\napprovals:\n${deny}\n`;
  let end = at + 1;
  while (end < lines.length && /^\s/.test(lines[end])) {
    // Already denies something (hand-written, or a re-run): leave it be
    // rather than stacking a second list it would then shadow.
    if (/^\s+deny:/.test(lines[end])) return text;
    end++;
  }
  lines.splice(end, 0, deny);
  return lines.join("\n");
}

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
const MIRROR_KEYS = [
  "mcp_servers",
  "timezone",
  "web",
  "skills",
  // Custom OpenAI-compatible endpoints — a local model on your own hardware,
  // an LM Studio, an Ollama, an Unsloth server on the machine next to you.
  //
  // Hermes names them in a `providers:` block (`api`, `api_key`,
  // default_model`, `transport`) and a session picks one BY NAME. So a profile
  // without this block does not merely lose a default — it has never heard of
  // the provider the session is asking for, and the turn dies at agent init.
  //
  // This is the same shape as the mcp_servers bug: the thing was configured in
  // the launch home, every teammate ran somewhere else, and the feature did
  // nothing for anybody while looking entirely set up.
  "providers",
  "fallback_providers",
  // Real-profile browsing: `browser.use_real_profile` lets a teammate browse
  // with the user's OWN logins, from a managed snapshot of their default
  // Chrome/Edge/Brave profile (never the live one — that would fight for the
  // lock). It is the answer to "can it see my sessions", and without it a
  // teammate hits a login wall on every site the user is already signed into.
  //
  // It has to be mirrored because Hermes reads it PER PROFILE, deliberately:
  // tools/browser_tool.py:1435 says "in a multiplexed gateway each profile's
  // config must decide for itself". Hydo is exactly that gateway, so a value
  // set in the launch home would have reached nobody — the third time this
  // trap has appeared here, after mcp_servers and providers.
  //
  // Mirroring it also keeps it a per-teammate decision rather than a global
  // one, which is the right shape for something whose whole risk is that it
  // browses as YOU.
  "browser",
  // Subagent routing. Hermes resolves a delegated child's model from
  // `delegation.model` AT EVERY DISPATCH, and empty means "inherit the
  // parent" (config_defaults.py, the delegation block). So a teammate pinned
  // to an expensive model spends that model on every piece of grunt work it
  // fans out . which is the opposite of why you fan work out. Mirroring the
  // block means the choice Michael makes once in his own Hermes config is the
  // choice his teammates' subagents actually run on.
  //
  // Note: `reasoning_effort` is NOT part of this block in this version of
  // Hermes, whatever third-party guides say. Only model, provider, base_url,
  // api_key and api_mode are.
  "delegation",
  // Approvals. His own config says timeout 90 and cron_mode deny; the code
  // default is 300 and the profile was silently getting that instead. An
  // approval prompt that waits five minutes when he chose ninety seconds is
  // a teammate that looks hung.
  "approvals",
];

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
  const want = withDeny(mirrored ? `${PROFILE_CONFIG}\n${mirrored}\n` : PROFILE_CONFIG);
  try {
    // Only when it would change: this file is cheap, but a bot may have been
    // given settings by hand and rewriting them every launch would be rude.
    // Rewritten when it would CHANGE, so adding a plugin reaches existing
    // teammates on their next turn instead of only new ones . but a byte
    // identical write is skipped, because this file is read at session start
    // and churn buys nothing.
    if (fs.existsSync(file)) {
      const cur = fs.readFileSync(file, "utf8");
      // `prepare()` runs at the start of every turn, so a plain `want` here
      // would silently overwrite an `approvals.mode` a user set for THIS bot
      // (via Settings/BotRail) with whatever the launch config mirrors in —
      // the exact "runs every turn, clobbers a per-bot choice" trap this repo
      // keeps finding. Carrying the CURRENT file's mode forward makes this a
      // no-op when nobody has overridden it (mirrored value === mirrored
      // value) and a real preservation when they have.
      const keepMode = extractApprovalsMode(cur);
      const finalWant = keepMode ? withMode(want, keepMode) : want;
      if (cur === finalWant) return;
      // Only ours is replaced. A profile someone edited by hand keeps what
      // they wrote; the mirrored blocks are appended to it instead.
      if (cur.startsWith("# Written by Hydo.")) {
        fs.writeFileSync(file, finalWant);
        return;
      }
      if (cur.includes("tail_mode")) return;
      fs.writeFileSync(file, `${cur.replace(/\s*$/, "")}\n${finalWant}`);
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
  // The STAMP is a floor, nothing more. store.cjs owns the full file (stamp +
  // model block + the shared-machine section) and writes it once per turn; if
  // this wrote a different full text they would overwrite each other every
  // turn, which is a bug this file has already had once.
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

/**
 * Hermes' own code default (config_defaults.py: `"approvals": {"mode": "smart"}`).
 * Used only to LABEL an inherited value honestly — never written as a
 * "choice" on a bot that has none, and never widened past what Hermes itself
 * ships with.
 */
const DEFAULT_APPROVAL_MODE = "smart";

/**
 * The effective `approvals.mode` for one bot's own profile — never the
 * launch home. `isDefault: true` means the profile's config.yaml has no
 * explicit `mode:` line, i.e. this bot is silently inheriting Hermes' smart
 * default rather than running on a choice anyone made. That distinction is
 * the whole point: docs/SAFETY.md's gap #1 is that this was invisible.
 */
function getApprovalMode(botId) {
  const file = path.join(profileDir(botId), "config.yaml");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { mode: DEFAULT_APPROVAL_MODE, isDefault: true };
  }
  const mode = extractApprovalsMode(text);
  return mode ? { mode, isDefault: false } : { mode: DEFAULT_APPROVAL_MODE, isDefault: true };
}

/**
 * Write `approvals.mode` into THIS bot's own profile config.yaml — never
 * `~/.hermes/config.yaml` (the launch home), which is exactly the class of
 * bug `docs/HERMES-GAPS.md` documents for `learning.frames`. Only `smart`
 * and `manual` are accepted: `off` is Hermes' own no-prompts knob, and this
 * app is never the one that turns it on for someone.
 */
function setApprovalMode(botId, mode) {
  if (mode !== "smart" && mode !== "manual") {
    throw new Error(`refusing to set approvals.mode to "${mode}" — only smart/manual are offered here`);
  }
  const home = profileDir(botId);
  ensureDir(home);
  const file = path.join(home, "config.yaml");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  fs.writeFileSync(file, withMode(text || "approvals:\n", mode));
  return getApprovalMode(botId);
}

/**
 * The permanent "always" allowlist Hermes accumulates per profile
 * (`tools/approval.py:save_permanent_allowlist` writes `command_allowlist`
 * as a top-level YAML list). Read-only text parse, same reasoning as
 * `yamlBlocks` above: no YAML dependency for four lines of format.
 */
function readAllowlist(botId) {
  const file = path.join(profileDir(botId), "config.yaml");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/^command_allowlist:/.test(lines[i])) at = i;
  if (at < 0) return [];
  const out = [];
  for (let i = at + 1; i < lines.length && /^\s/.test(lines[i]); i++) {
    const m = /^\s*-\s*(.+?)\s*$/.exec(lines[i]);
    if (m) out.push(m[1].replace(/^["']|["']$/g, ""));
  }
  return out;
}

function writeAllowlist(botId, patterns) {
  const file = path.join(profileDir(botId), "config.yaml");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  const lines = text.split("\n");
  const body = patterns.length
    ? [`command_allowlist:`, ...patterns.map((p) => `  - ${JSON.stringify(p)}`)]
    : [`command_allowlist: []`];
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (/^command_allowlist:/.test(lines[i])) at = i;
  if (at < 0) {
    fs.writeFileSync(file, `${text.replace(/\s*$/, "")}\n${body.join("\n")}\n`);
    return;
  }
  let end = at + 1;
  while (end < lines.length && /^\s/.test(lines[end])) end++;
  lines.splice(at, end - at, ...body);
  fs.writeFileSync(file, lines.join("\n"));
}

/**
 * Revoke one entry from a bot's own permanent allowlist. Additive UI (a
 * button that removes something) never gets to write an allowlist longer
 * than what was already there — `patterns` here can only shrink.
 */
function revokeAllowlistEntry(botId, pattern) {
  const current = readAllowlist(botId);
  const next = current.filter((p) => p !== pattern);
  if (next.length === current.length) return { changed: false, allowlist: current };
  writeAllowlist(botId, next);
  return { changed: true, allowlist: next };
}

module.exports = {
  profileName,
  profileDir,
  workspaceDir,
  sharedMemoryFile,
  DEFAULT_APPROVAL_MODE,
  getApprovalMode,
  setApprovalMode,
  readAllowlist,
  revokeAllowlistEntry,
  prepare,
  appendSubagentLog,
  readSharedMemory,
  AGENTS_STAMP,
};
