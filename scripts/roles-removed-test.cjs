#!/usr/bin/env node
"use strict";

/**
 * roles-removed-test.cjs — the "Role" preset picker (BotRail) is gone, for
 * good, per direct user feedback ("i dont care about roles its bs pls
 * remove it").
 *
 * Three things this guards:
 *
 *   1. `roleFor` no longer exists in bot-presets.js. `BOT_PRESETS` and
 *      `presetPatch` stay — those back the "Start from" picker in
 *      BotCreate.jsx, a DIFFERENT feature (a starting template for a NEW
 *      bot) that nobody complained about.
 *   2. The rail no longer renders a "Role" field or calls `roleFor`.
 *   3. An agent record written by an OLDER build that still carries a
 *      stored `role` field loads fine and comes back without one — dropped
 *      on read, not resurrected. Exercised through a real `createStore`
 *      reload from a hand-written state.json, the same way
 *      store-extras-test.cjs proves reload behaviour, rather than calling
 *      the private `normalizeAgent` directly.
 *
 * Usage: node scripts/roles-removed-test.cjs   (exit 0 on success)
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createStore } = require("../electron/store.cjs");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

let fails = 0;
function ok(name, fn) {
  try {
    fn();
    console.log("ok   " + name);
  } catch (err) {
    fails++;
    console.log("FAIL " + name + " — " + err.message);
  }
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hydo-roles-"));
}

// -------------------------------------------------------------- the source

ok("bot-presets.js has no roleFor, but keeps the creation-time preset API", () => {
  const code = fs.readFileSync(path.join(SRC, "lib", "bot-presets.js"), "utf8");
  assert.ok(!/roleFor/.test(code), "roleFor is still defined or referenced");
  assert.ok(/export const BOT_PRESETS/.test(code), "BOT_PRESETS should stay — creation still uses it");
  assert.ok(/export function presetPatch/.test(code), "presetPatch should stay — creation still uses it");
});

ok("BotRail no longer imports roleFor or renders a Role field", () => {
  const rail = fs.readFileSync(path.join(SRC, "screens", "BotRail.jsx"), "utf8");
  assert.ok(!/roleFor/.test(rail), "roleFor is still referenced in BotRail.jsx");
  assert.ok(!/bot-rail__role/.test(rail), "the Role chip markup is still rendered");
  assert.ok(!/<span className="bot-rail__field-label">Role<\/span>/.test(rail), "a Role field label is still rendered");
  // BOT_PRESETS itself is the "Start from" picker's data — the rail (an
  // EXISTING bot) has no business importing it once roleFor is gone.
  assert.ok(!/BOT_PRESETS/.test(rail), "BotRail.jsx still imports/uses BOT_PRESETS");
});

ok("BotCreate's unrelated 'Start from' preset picker is untouched", () => {
  const create = fs.readFileSync(path.join(SRC, "screens", "BotCreate.jsx"), "utf8");
  assert.ok(/BOT_PRESETS/.test(create), "the create dialog should still offer starting presets");
  assert.ok(/presetPatch/.test(create), "creating from a preset should still work");
});

// -------------------------------------------------------------- the store

ok("a legacy stored `role` on an agent is dropped on load, nothing else breaks", () => {
  const dir = tmpdir();
  const file = path.join(dir, "state.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      signedIn: true,
      agents: [
        {
          id: "legacy-1",
          name: "Old Operator",
          blob: "purple",
          shape: "hex",
          // The dead field an older build could have written.
          role: "operator",
          toolProfile: "builder",
          boxEnabled: true,
        },
      ],
      channels: [],
      messages: {},
      routines: {},
      settings: {},
    })
  );

  const store = createStore({ dir, complete: async () => "ok" });
  const agent = store.getState().agents.find((a) => a.id === "legacy-1");
  assert.ok(agent, "the legacy agent did not survive loading at all");
  assert.ok(!("role" in agent), "a stored `role` field was not dropped on read");
  // Everything else about the agent — the actual capability fields — must
  // still be intact. Dropping `role` must not take anything else with it.
  assert.equal(agent.name, "Old Operator");
  assert.equal(agent.blob, "purple");
  // Not asserting toolProfile stays "builder": normalizeState has its own,
  // unrelated one-time migration that drops any un-pinned pre-auto agent to
  // "chat" (see the comment above that migration in store.cjs). This test
  // only owns the `role` field.
  assert.equal(agent.boxEnabled, true);
});

process.exit(fails ? 1 : 0);
