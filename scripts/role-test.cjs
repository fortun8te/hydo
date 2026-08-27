"use strict";

// Pointing an EXISTING bot at a use case.
//
// Every teammate made before presets existed has a default profile and an
// empty description, and re-making one to get those is absurd. But a bot you
// already have has a name you chose and, once it has done real work, a
// description it wrote for ITSELF about what it turned out to be for.
// Overwriting either with a preset's guess is a worse bot, not a better one.
//
// So a role sets capability, not identity.

const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

async function main() {
  const url = pathToFileURL(path.join(__dirname, "../src/lib/bot-presets.js")).href;
  const { BOT_PRESETS, roleFor, presetPatch } = await import(url);

  const operator = BOT_PRESETS.find((p) => p.id === "operator");
  assert.ok(operator, "the operator preset exists");

  // ---- identity is never touched -----------------------------------------
  const worked = {
    name: "Finance Guy",
    label: "money",
    description: "I reconcile invoices against the bank export.",
  };
  const patch = roleFor(operator, worked);
  assert.ok(!("name" in patch), "a role never renames a bot you named");
  assert.ok(!("description" in patch), "nor overwrites a description it wrote itself");
  assert.ok(!("label" in patch), "nor a label you set");
  assert.ok(!("blob" in patch) && !("shape" in patch), "nor how it looks");

  // ---- capability is what it sets ----------------------------------------
  assert.equal(patch.toolProfile, "builder");
  assert.deepEqual(patch.toolsets, ["browser"]);
  assert.equal(patch.boxEnabled, true, "the operator role grants the shared machine");
  // A floor, not a pin: auto must still be able to climb from here.
  assert.equal(patch.profilePinned, false);

  // ---- an EMPTY description is not identity, it is a gap -----------------
  const fresh = { name: "test", label: "", description: "" };
  const filled = roleFor(operator, fresh);
  assert.ok(filled.description && filled.description.length > 10, "an empty description gets filled");
  assert.equal(filled.label, "desktop");
  assert.ok(!("name" in filled), "but the name is still never touched");

  // Whitespace is empty. " " is not a description somebody meant.
  const blank = roleFor(operator, { description: "   ", label: "  " });
  assert.ok("description" in blank && "label" in blank, "whitespace counts as empty");

  // ---- exactly one role may grant the machine ---------------------------
  const granting = BOT_PRESETS.filter((p) => roleFor(p, {}).boxEnabled === true);
  assert.equal(granting.length, 1, "only the operator role turns the shared machine on");

  // ---- creating and re-roling stay different --------------------------
  // presetPatch names a NEW bot; roleFor must not.
  assert.ok("name" in presetPatch(operator), "creating a bot names it");
  assert.ok(!("name" in roleFor(operator, {})), "re-roling one does not");

  console.log("role-test ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
