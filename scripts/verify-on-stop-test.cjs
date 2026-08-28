"use strict";

/**
 * Verify-on-stop actually reaches a teammate.
 *
 * Hydo's defining bug is a change that passes the suite and moves no pixels.
 * Hermes ships the only thing in the stack that argues with "done": when a
 * turn edits code and then tries to finish without fresh passing verification
 * evidence, `agent/verification_stop.py` appends ONE bounded follow-up. Hydo
 * had never turned it on.
 *
 * The failure this test exists to prevent is not "the setting is wrong". It is
 * the failure this repo keeps re-discovering: config written into
 * ~/.hermes/config.yaml that no teammate ever reads, because every teammate
 * runs in its own profile home. `MIRROR_KEYS` is an ALLOWLIST, and it has now
 * silently hidden `mcp_servers`, `providers` and `browser` — three for three.
 * So this asserts on a REAL generated profile file, not on the allowlist.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { stripComments } = require("./lib/source-scan.cjs");

const ROOT = path.join(__dirname, "..");
const botHome = require(path.join(ROOT, "electron", "bot-home.cjs"));

let failed = 0;
const check = (label, fn) => {
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`  FAIL ${label}: ${(err && err.message) || err}`);
  }
};

// ---- the block Hydo writes ------------------------------------------------
check("a profile gets verify_on_stop even with no launch config at all", () => {
  const block = botHome.agentBlock("");
  assert.match(block, /^agent:$/m, "must be a real top-level agent block");
  assert.match(block, /^ {2}verify_on_stop: true$/m);
});

check("an explicit launch-config value wins over Hydo's default", () => {
  const block = botHome.agentBlock("agent:\n  verify_on_stop: false\n");
  assert.match(block, /^ {2}verify_on_stop: false$/m, "the user must be able to turn it off globally");
});

// Two `agent:` keys in one YAML file is not a merge — the last replaces the
// first outright. That trap once silently discarded this file's approvals.deny
// list, so it gets a test rather than a comment.
check("exactly one agent: block, whatever the launch config says", () => {
  const block = botHome.agentBlock("agent:\n  max_turns: 180\n  verify_on_stop: true\n");
  assert.equal((block.match(/^agent:$/gm) || []).length, 1);
});

// The whole `agent` block is NOT mirrored, deliberately. `disabled_toolsets` is
// the user's list for his own CLI; Hydo decides a teammate's tools per bot via
// HERMES_TUI_TOOLSETS. A mirrored copy could subtract from a pin the UI shows
// as enabled — a control that looks on and is off.
check("the rest of the agent block is not dragged along", () => {
  const block = botHome.agentBlock(
    "agent:\n  max_turns: 180\n  reasoning_effort: high\n  disabled_toolsets:\n    - code_execution\n  personalities:\n    pirate: arrr\n"
  );
  for (const leaked of ["max_turns", "reasoning_effort", "disabled_toolsets", "personalities", "pirate"]) {
    assert.ok(!block.includes(leaked), `${leaked} must not be mirrored into a teammate profile`);
  }
});

check("nested mappings never leak as subkeys", () => {
  const got = botHome.yamlSubKeys(
    "agent:\n  personalities:\n    verify_on_stop: not-a-setting\n  verify_guidance: true\n",
    "agent",
    ["verify_on_stop", "verify_guidance"]
  );
  assert.deepEqual(got, { verify_guidance: "true" }, "a two-level-deep key is a different setting");
});

// ---- the real file on disk ------------------------------------------------
// Read back what `prepare()` actually wrote. Trusting MIRROR_KEYS is exactly
// the mistake that hid three features from every teammate.
check("a generated profile config really carries the key", () => {
  const id = "verifyonstoptest" + process.pid;
  const hydoDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-vos-"));
  const home = botHome.profileDir(id);
  try {
    botHome.prepare(hydoDir, id);
    const text = fs.readFileSync(path.join(home, "config.yaml"), "utf8");
    assert.match(text, /^agent:$/m, "no agent block in the generated profile");
    assert.match(text, /^ {2}verify_on_stop: true$/m);
    // Duplicate top-level keys are silently last-wins, so a second one would
    // be a live bug, not a cosmetic one.
    assert.equal((text.match(/^agent:$/gm) || []).length, 1, "duplicate agent: block");
  } finally {
    fs.rmSync(hydoDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---- the Hermes side still has the shape we wired to ----------------------
// If a Hermes upgrade renames the key or drops the module, verify-on-stop
// becomes config that does nothing — which is the exact failure mode this
// whole change exists to stop. Skipped when Hermes is not installed, because
// the suite has to pass on a machine without it.
const VS = path.join(os.homedir(), ".hermes", "hermes-agent", "agent", "verification_stop.py");
check("Hermes still reads agent.verify_on_stop, and still bounds the nudge", () => {
  if (!fs.existsSync(VS)) return;
  const py = fs.readFileSync(VS, "utf8");
  assert.match(py, /agent_cfg\.get\("verify_on_stop"\)/, "Hermes renamed the config key");
  assert.match(py, /max_attempts: int = 2/, "the nudge is no longer bounded — it would fire every turn");
  assert.match(py, /_NON_CODE_VERIFY_EXTENSIONS/, "the doc/markdown suppression is gone");
});

if (failed) {
  console.error(`verify-on-stop: ${failed} failed`);
  process.exit(1);
}
console.log("verify-on-stop ok — the key reaches a real profile, and nothing else from agent: does");
