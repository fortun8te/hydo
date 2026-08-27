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
  // TOP-LEVEL only. `delegation.model` is a different thing from the session
  // model . one routes a delegated child, the other is what Hydo already sends
  // on session.create . and an unanchored /model:/ conflates them.
  assert.ok(
    !/^(model|provider|toolsets):/m.test(body),
    "it does not restate what Hydo already sends per session"
  );

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

  // ---- the launch config's MCP servers reach the bot ---------------------
  // This is the one that was actually broken. Hermes resolves a session's MCP
  // servers by NAME against the config of whatever HERMES_HOME it started
  // with, and every Hydo bot starts in its own profile home. Servers added
  // from the Plugins screen land in the LAUNCH home, so every name Hydo pinned
  // was silently dropped as unknown . connecting an app changed nothing for
  // any teammate, and nothing errored, because the resolver just filters.
  //
  //   HERMES_HOME=~/.hermes             config get mcp_servers -> the servers
  //   HERMES_HOME=~/.hermes/profiles/…  config get mcp_servers -> "not set"
  const launch = path.join(os.homedir(), ".hermes", "config.yaml");
  if (fs.existsSync(launch)) {
    const src = fs.readFileSync(launch, "utf8");
    fs.rmSync(file, { force: true });
    botHome.prepare(dir, id, "soul");
    const body = fs.readFileSync(file, "utf8");
    for (const key of ["mcp_servers", "timezone", "web", "skills", "delegation", "approvals"]) {
      if (new RegExp(`^${key}:`, "m").test(src)) {
        assert.ok(
          new RegExp(`^${key}:`, "m").test(body),
          `${key} must be mirrored into the profile, or the bot runs on a default nobody chose`
        );
      }
    }
    // Mirrored as TEXT, so a comment or ordering the user wrote survives and
    // nothing is reformatted on the way through.
    const m = /^mcp_servers:\n([\s\S]*?)(?=\n[A-Za-z_]|$)/m.exec(src);
    if (m) {
      assert.ok(body.includes(m[0].trimEnd()), "the block is copied verbatim, not re-emitted");
    }
    // Still narrow: a profile is meant to be its own thing.
    assert.ok(!/^model:/m.test(body), "not a blind copy of the launch config");

    // `delegation.model` is resolved by Hermes AT EVERY DISPATCH and empty
    // means "inherit the parent", so without this block a teammate pinned to
    // an expensive model spends it on every piece of work it fans out . the
    // opposite of why you fan work out.
    if (/^delegation:/m.test(src)) {
      assert.ok(/^delegation:/m.test(body), "subagent routing reaches the bot");
    }
  }

  // ---- adding a plugin reaches EXISTING teammates -------------------------
  // Rewritten when it would change, so a bot made last week picks a new server
  // up on its next turn instead of only new bots getting it.
  {
    fs.writeFileSync(file, "# Written by Hydo.\ncompression:\n  tail_mode: lean\n");
    botHome.prepare(dir, id, "soul");
    assert.ok(
      fs.readFileSync(file, "utf8").length > 60,
      "a stale Hydo-written config is refreshed, not left alone"
    );
    const once = fs.readFileSync(file, "utf8");
    botHome.prepare(dir, id, "soul");
    assert.equal(fs.readFileSync(file, "utf8"), once, "and an identical write is skipped");
  }

  console.log("profile-config-test ok");
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}
