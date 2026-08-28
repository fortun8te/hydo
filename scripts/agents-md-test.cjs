"use strict";

// AGENTS.md must be written only when it CHANGES.
//
// It sits at the front of every Hermes prompt, and xAI caches on a reused
// prefix — anything that makes the prefix look new costs the 75% cached-input
// discount on everything behind it. store.cjs guards its own write with a
// read-and-compare for exactly that reason.
//
// That guard could never hold. `botHome.prepare()` runs FIRST on every turn
// (streamThroughHermes calls it before touching AGENTS.md) and unconditionally
// wrote the bare AGENTS_STAMP over the file. store.cjs then compared that
// against stamp + model block, always found a mismatch, and rewrote. Two
// writes and a fresh mtime on every single turn, for the whole life of a bot,
// with the optimisation's comment sitting right above the dead branch.
//
// The stamp is a floor: if it is already at the head of the file, whoever
// wrote the rest owns the file.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const botHome = require("../electron/bot-home.cjs");
const modelPick = require("../electron/model-pick.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-agentsmd-"));
const id = `agentsmd${Date.now().toString(36)}`;
const profile = path.join(os.homedir(), ".hermes", "profiles", `hydo${id}`);

const agent = { id, name: "Test", model: "", provider: "" };
const settings = { model: "grok-4.6", provider: "xai-oauth" };
const want = `${botHome.AGENTS_STAMP}\n${modelPick.agentsModelBlock(agent, settings)}\n`;

// Exactly what streamThroughHermes does, once per turn.
function turn() {
  const home = botHome.prepare(dir, id, "soul");
  const file = path.join(home.cwd, "AGENTS.md");
  let cur = "";
  try {
    cur = fs.readFileSync(file, "utf8");
  } catch {
    cur = "";
  }
  if (cur !== want) {
    fs.writeFileSync(file, want);
    return true;
  }
  return false;
}

try {
  assert.equal(turn(), true, "the first turn writes AGENTS.md");
  assert.equal(turn(), false, "the second turn leaves it alone");
  assert.equal(turn(), false, "and so does every turn after that");

  const file = path.join(botHome.workspaceDir(dir, id), "AGENTS.md");
  assert.equal(fs.readFileSync(file, "utf8"), want, "the model block survives prepare()");

  // A stamp change (an app upgrade) still reaches an existing workspace.
  fs.writeFileSync(file, "# something older\n");
  botHome.prepare(dir, id, "soul");
  assert.ok(
    fs.readFileSync(file, "utf8").startsWith(botHome.AGENTS_STAMP),
    "a file missing the current stamp is restamped"
  );

  console.log("agents-md ok");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}

// ---- the shared-machine section has exactly ONE writer --------------------
// bot-home's prepare() runs first every turn and store.cjs writes the full
// file after it. If prepare() wrote a DIFFERENT full text (stamp + box block)
// the two would overwrite each other on every single turn — which is the exact
// bug this file already caught once, and which costs the cached-prefix
// discount on everything behind AGENTS.md.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const botHome = fs.readFileSync(path.join(__dirname, "../electron/bot-home.cjs"), "utf8");
  const store = fs.readFileSync(path.join(__dirname, "../electron/store.cjs"), "utf8");

  assert.ok(
    !/Shared Linux machine/.test(botHome),
    "prepare() must not write the box section — it only lays down the stamp floor"
  );
  assert.ok(
    /Shared Linux machine/.test(store),
    "store.cjs, the single full-file writer, owns the box section"
  );
  assert.ok(
    /agentsWant = `\$\{botHome\.AGENTS_STAMP\}/.test(store),
    "and it still builds from the shared stamp rather than a copy of it"
  );
  // Named only when this teammate may actually use the machine.
  assert.ok(/agent\.boxEnabled && boxId/.test(store), "gated on the permission AND a real id");
}

console.log("agents-md-test (box section) ok");

// ---- a teammate must know what it can reach ------------------------------
// A bot carried no idea of its own toolsets, so "can you check that site" from
// one without `browser` became an improvised answer or a flat failure — and
// the user was left to work out which switch was missing. Naming the switch is
// what turns setup from something you must already understand into something
// the teammate tells you.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const store = fs.readFileSync(path.join(__dirname, "../electron/store.cjs"), "utf8");

  assert.ok(/## What you can reach/.test(store), "AGENTS.md says what it carries");
  // The actual tools, not the profile's NAME.
  //
  // This block used to say `Tool profile **${agent.toolProfile}**` and then
  // tell the teammate to "name the switch: extra toolsets are the **Advanced**
  // section of this Bot's panel". MEASURED consequence: asked to chase a
  // support chat, a teammate replied with a wall of markdown about which panel
  // to change; asked what it could do, it recited its tool profile in bold.
  // The soul bans exactly that, and lost seven straight attempts, because THIS
  // is rewritten into the prompt every turn and names specifics.
  //
  // The distinction that resolves it: a toolset is the teammate's to take, the
  // shared machine is not.
  assert.ok(/Tools available this turn/.test(store), "states the real tools");
  assert.ok(/gatewayProfiles\[agent\.toolProfile/.test(store), "built from the real profile");
  assert.ok(/plus \$\{extras\.join/.test(store), "and the real extras, not a guess");
  assert.ok(
    !/Tool profile \*\*/.test(store),
    "the profile NAME is back in the prompt — that is what it recited at the user"
  );

  // A toolset it can grant itself must never become advice about a panel.
  assert.ok(/SELF: \{\\"toolsets/.test(store), "does not tell the teammate it can widen itself");
  assert.ok(
    /never send him to the \*\*Advanced\*\* panel/.test(store),
    "the Advanced panel is offered as advice again"
  );

  // The box is genuinely user-only, so naming THAT switch is still right.
  assert.ok(/\*\*Linux workspace\*\*/.test(store), "and where the shared machine is turned on");
  assert.ok(/NOT yours to switch on/.test(store), "the box must be named as the user's to enable");
  assert.ok(/do not fail silently/.test(store), "and forbids the two bad alternatives");

  // Still one writer. This block goes in the same single assembly as the rest;
  // a second writer would put AGENTS.md back to being rewritten twice a turn.
  assert.ok(
    /agentsWant = `\$\{botHome\.AGENTS_STAMP\}[\s\S]{0,160}\$\{reachBlock\}\$\{rulesBlock\}`/.test(store),
    "appended to the one authoritative agentsWant"
  );
  // Standing rules ride here too, and it has to be THIS file rather than the
  // `standing()` string: that string only feeds the non-Hermes `complete`
  // path, so a rule put there reaches a code path the app does not use.
  assert.ok(/const rulesBlock =/.test(store), "standing rules are not in AGENTS.md");
  assert.ok(/botHome\.readRules\(dir\)/.test(store), "rules are not read from the shared board");
}

console.log("agents-md-test (reach) ok");
