"use strict";

/**
 * A custom OpenAI-compatible endpoint has to reach the TEAMMATE, not just the
 * config file you edited.
 *
 * Hydo runs every teammate in its own Hermes profile and mirrors an ALLOWLIST
 * of config blocks into it. `providers` was not on that list — and a session
 * picks a provider BY NAME. A profile without the block has not merely lost a
 * default; it has never heard of the name being asked for, and the turn dies at
 * agent init.
 *
 * Same shape as the mcp_servers bug this project already hit: configured in the
 * launch home, every teammate running somewhere else, the feature doing nothing
 * for anybody while looking entirely set up.
 *
 * Proven end to end separately: a stub OpenAI server on 127.0.0.1:8899 that
 * enforces the API key (401 without it), registered as a provider, and a real
 * teammate pointed at it answered "STUB_ANSWER_OK".
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const home = fs.readFileSync(path.join(ROOT, "electron/bot-home.cjs"), "utf8");

const list = /const MIRROR_KEYS = \[([\s\S]*?)\n\];/.exec(home);
assert.ok(list, "MIRROR_KEYS exists");
const keys = [...list[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

assert.ok(
  keys.includes("providers"),
  "custom endpoints must be mirrored, or a teammate has never heard of the provider its session names"
);
assert.ok(keys.includes("fallback_providers"), "and their fallbacks with them");

// The blocks that were already load-bearing — a future edit must not drop one
// while adding another.
// Real-profile browsing is read PER PROFILE by Hermes on purpose
// (tools/browser_tool.py:1435 — "in a multiplexed gateway each profile's config
// must decide for itself"), so an unmirrored `browser` block reaches no
// teammate at all. Third instance of this trap here, after mcp_servers and
// providers, which is why it is pinned rather than trusted.
assert.ok(keys.includes("browser"), "browser.use_real_profile must reach the teammate's own profile");

for (const k of ["mcp_servers", "skills", "delegation", "approvals"]) {
  assert.ok(keys.includes(k), `${k} must stay mirrored`);
}

// It is an allowlist on purpose: a profile is meant to be its own thing.
assert.ok(
  /ALLOWLIST, not a copy/.test(home),
  "the allowlist is deliberate and the comment saying so must survive"
);

console.log(`providers-mirror-test ok (${keys.length} blocks mirrored)`);
