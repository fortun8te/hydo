"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const soul = require("../electron/soul.cjs");
const botHome = require("../electron/bot-home.cjs");

assert.ok(soul.DEFAULT_SOUL.includes("hydo-soul: 27"));
assert.ok(soul.DEFAULT_SOUL.includes("memory"));
assert.ok(soul.DEFAULT_SOUL.includes("computer_use"));
assert.ok(soul.DEFAULT_SOUL.includes("delegate_task"));
assert.ok(soul.DEFAULT_SOUL.includes("dispatcher"));
assert.ok(soul.DEFAULT_SOUL.includes("Workers start blank"));
assert.ok(soul.DEFAULT_SOUL.includes("one-step lookup"));
assert.ok(soul.DEFAULT_SOUL.includes("SHARED.md"));
assert.ok(soul.DEFAULT_SOUL.includes("SKIP"));
assert.ok(!soul.DEFAULT_SOUL.includes("short bubbles as you go"));
assert.equal(soul.SOUL_VERSION, 27);
assert.ok(soul.DEFAULT_SOUL.includes("unslop"));
assert.ok(soul.DEFAULT_SOUL.includes("web_search"));
assert.ok(!soul.DEFAULT_SOUL.includes("\u2014"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-soul-"));
const id = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
const snap = soul.soulSnapshot(dir, id);
assert.ok(snap.includes("Hydo teammate"));
assert.ok(snap.includes("computer_use"));
assert.ok(!snap.includes("hydo-soul:"));

const botFile = path.join(dir, "bots", id, "SOUL.md");
assert.equal(soul.seedSoulFile(botFile, soul.DEFAULT_SOUL), "current");
fs.writeFileSync(botFile, "<!-- hydo-soul: 1 -->\n# old\n");
assert.equal(soul.seedSoulFile(botFile, soul.DEFAULT_SOUL), "upgraded");
assert.ok(fs.readFileSync(botFile, "utf8").includes("hydo-soul: 27"));
fs.writeFileSync(botFile, "# Teammate\n\nYou are a teammate in iMessage, not a chatbot. Talk like Grok Bot.\n");
assert.equal(soul.seedSoulFile(botFile, soul.DEFAULT_SOUL), "upgraded");
fs.writeFileSync(botFile, "# my custom soul\nBe weird.\n");
assert.equal(soul.seedSoulFile(botFile, soul.DEFAULT_SOUL), "custom");
assert.ok(fs.readFileSync(botFile, "utf8").includes("Be weird"));

const home = botHome.prepare(dir, id);
assert.ok(fs.readFileSync(path.join(home.hermesHome, "SOUL.md"), "utf8").includes("computer_use"));
assert.ok(fs.readFileSync(path.join(home.cwd, "AGENTS.md"), "utf8").includes("sandbox"));

console.log("soul-test ok");
