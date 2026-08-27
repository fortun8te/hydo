"use strict";

/**
 * Job 2 of the light-mode + approvals-UI pass: docs/SAFETY.md gap #1/#2 —
 * no UI (and, underneath it, no verified plumbing) to see/change a bot's
 * `approvals.mode` or revoke its permanent allowlist. This pins the plumbing
 * in `electron/bot-home.cjs` that `electron/approval-settings.cjs` calls:
 *
 *   - an unset mode reads back as the honest "inherited default", not a
 *     fabricated choice
 *   - a set mode writes to THIS bot's own profile config.yaml, never the
 *     launch home (`~/.hermes/config.yaml`) — the exact scoping bug
 *     `learning.frames` has per docs/HERMES-GAPS.md
 *   - only smart/manual are accepted — never `off`, which would be this app
 *     turning on the no-prompts knob for someone
 *   - the mode SURVIVES `prepare()`, which runs at the start of every turn
 *     and rewrites config.yaml from the launch-config mirror. Before the
 *     fix in this pass, a per-bot mode override would have been silently
 *     clobbered back to the mirrored value on the bot's very next turn —
 *     same failure class as the "runs every turn, stomps a choice" bugs
 *     already found in this file.
 *   - the allowlist can be read and one entry revoked without disturbing
 *     the rest of the file or other entries
 *
 * Uses a real (disposable) profile dir under the real ~/.hermes/profiles —
 * same pattern as scripts/bot-home-test.cjs, since `profileDir()` always
 * resolves under `os.homedir()`, not a mockable root.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const botHome = require("../electron/bot-home.cjs");

const botId = `apvtest${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const home = botHome.profileDir(botId);

function cleanup() {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
process.on("exit", cleanup);

try {
  // ---- no config.yaml yet: honest "inherited default" ----------------
  assert.ok(!fs.existsSync(path.join(home, "config.yaml")));
  {
    const r = botHome.getApprovalMode(botId);
    assert.equal(r.mode, "smart");
    assert.equal(r.isDefault, true);
    assert.equal(r.mode, botHome.DEFAULT_APPROVAL_MODE);
  }

  // ---- setting writes to the BOT'S OWN profile, not the launch home ---
  const launchConfig = path.join(os.homedir(), ".hermes", "config.yaml");
  const launchBefore = fs.existsSync(launchConfig) ? fs.readFileSync(launchConfig, "utf8") : null;

  const written = botHome.setApprovalMode(botId, "manual");
  assert.equal(written.mode, "manual");
  assert.equal(written.isDefault, false);

  const launchAfter = fs.existsSync(launchConfig) ? fs.readFileSync(launchConfig, "utf8") : null;
  assert.equal(launchAfter, launchBefore, "setApprovalMode must never touch the launch home's config.yaml");

  const cfgFile = path.join(home, "config.yaml");
  assert.ok(fs.existsSync(cfgFile));
  assert.match(fs.readFileSync(cfgFile, "utf8"), /mode:\s*manual/);

  {
    const r = botHome.getApprovalMode(botId);
    assert.equal(r.mode, "manual");
    assert.equal(r.isDefault, false);
  }

  // ---- refuses to widen past smart/manual -----------------------------
  assert.throws(() => botHome.setApprovalMode(botId, "off"), /smart\/manual/);
  assert.throws(() => botHome.setApprovalMode(botId, "yolo"), /smart\/manual/);
  // The refusal must not have touched the file.
  assert.equal(botHome.getApprovalMode(botId).mode, "manual");

  // ---- survives prepare(), which runs every turn -----------------------
  // Simulate a normal Hydo session start on this bot AFTER the user set
  // manual. Before the fix, writeProfileConfig() would stamp the file back
  // to whatever the launch config mirrors in, silently discarding this.
  const hydoDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-approvals-"));
  try {
    botHome.prepare(hydoDir, botId, "# soul\n");
    const r = botHome.getApprovalMode(botId);
    assert.equal(r.mode, "manual", "approvals.mode must survive prepare() rewriting config.yaml");
    assert.equal(r.isDefault, false);
  } finally {
    fs.rmSync(hydoDir, { recursive: true, force: true });
  }

  // Setting it back to smart is a real, explicit choice too — not silently
  // treated as "no choice made" just because it matches the default value.
  botHome.setApprovalMode(botId, "smart");
  {
    const r = botHome.getApprovalMode(botId);
    assert.equal(r.mode, "smart");
    assert.equal(r.isDefault, false, "an explicit smart is still a choice, not the inherited-default case");
  }

  // ---- allowlist: read + revoke one entry, leave the rest -------------
  assert.deepEqual(botHome.readAllowlist(botId), []);

  // Hand-write the shape Hermes' save_permanent_allowlist() actually
  // produces (tools/approval.py:3139 — a top-level `command_allowlist` list)
  // rather than going through setApprovalMode, so this also proves the
  // reader parses Hermes' own format, not just Hydo's writer's.
  const cur = fs.readFileSync(cfgFile, "utf8");
  fs.writeFileSync(
    cfgFile,
    `${cur.replace(/\s*$/, "")}\ncommand_allowlist:\n  - "git status"\n  - "npm test*"\n  - "ls -la"\n`
  );
  assert.deepEqual(botHome.readAllowlist(botId), ["git status", "npm test*", "ls -la"]);

  const rev = botHome.revokeAllowlistEntry(botId, "npm test*");
  assert.equal(rev.changed, true);
  assert.deepEqual(rev.allowlist, ["git status", "ls -la"]);
  assert.deepEqual(botHome.readAllowlist(botId), ["git status", "ls -la"]);
  // The mode set two blocks up must not have been disturbed by an edit to a
  // completely different top-level key.
  assert.equal(botHome.getApprovalMode(botId).mode, "smart");

  // Revoking something not on the list is a no-op, not an error and not a
  // rewrite that could scramble the file.
  const before = fs.readFileSync(cfgFile, "utf8");
  const noop = botHome.revokeAllowlistEntry(botId, "does not exist");
  assert.equal(noop.changed, false);
  assert.equal(fs.readFileSync(cfgFile, "utf8"), before);

  // Revoking down to empty leaves valid, re-readable YAML.
  botHome.revokeAllowlistEntry(botId, "git status");
  botHome.revokeAllowlistEntry(botId, "ls -la");
  assert.deepEqual(botHome.readAllowlist(botId), []);
  assert.match(fs.readFileSync(cfgFile, "utf8"), /command_allowlist:\s*\[\]/);

  console.log("approval-settings-test ok");
} finally {
  cleanup();
}
