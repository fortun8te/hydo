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
