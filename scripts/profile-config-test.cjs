"use strict";

// Per-bot Hermes config.
//
// A Hermes profile with no config.yaml does NOT inherit ~/.hermes/config.yaml.
// It falls through to the code defaults, and nothing announces that — several
// values coincide with the user's own settings, which makes it look like
// inheritance right up until one doesn't.
//
// Verified against the real binary:
//   HERMES_HOME=~/.hermes             config get compression.tail_mode -> lean
//   HERMES_HOME=~/.hermes/profiles/…  config get compression.tail_mode -> legacy
//
// `legacy` drags a large slice of the old conversation into every turn after a
// compaction. That is paid forever on a long-lived thread, which is exactly
// what a teammate you keep is.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const botHome = require("../electron/bot-home.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-profcfg-"));
const id = `cfgtest${Date.now().toString(36)}`;
const profile = path.join(os.homedir(), ".hermes", "profiles", `hydo${id}`);
const file = path.join(profile, "config.yaml");

try {
  botHome.prepare(dir, id, "soul");
  assert.ok(fs.existsSync(file), "a new bot profile gets a config.yaml");
  const body = fs.readFileSync(file, "utf8");
  assert.ok(/tail_mode:\s*lean/.test(body), "and it pins the lean tail policy");

  // Narrow on purpose: only the keys where the code default is wrong for a
  // long-lived teammate. Everything else stays Hermes' business, so an upgrade
  // that improves a default still reaches us.
  assert.ok(!/model:|provider:|toolsets:/.test(body), "it does not restate what Hydo already sends per session");

  // Hand-edited settings survive. Rewriting a profile on every launch would
  // silently undo anything the user or the bot put there.
  fs.writeFileSync(file, "compression:\n  tail_mode: lean\nsomething_else: 1\n");
  botHome.prepare(dir, id, "soul");
  assert.ok(
    fs.readFileSync(file, "utf8").includes("something_else"),
    "prepare() does not clobber an existing profile config"
  );

  // A profile config that predates this and lacks the key gets it appended
  // rather than replaced.
  fs.writeFileSync(file, "something_else: 1\n");
  botHome.prepare(dir, id, "soul");
  const merged = fs.readFileSync(file, "utf8");
  assert.ok(merged.includes("something_else"), "existing keys kept");
  assert.ok(/tail_mode:\s*lean/.test(merged), "and the missing one added");

  console.log("profile-config-test ok");
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}
