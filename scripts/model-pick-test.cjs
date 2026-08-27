"use strict";

const assert = require("node:assert/strict");
const mp = require("../electron/model-pick.cjs");

assert.equal(mp.sessionModel({ model: "bot-x" }, { model: "set-y" }), "bot-x");
assert.equal(mp.sessionModel({}, { model: "set-y" }), "set-y");
assert.equal(mp.sessionModel({}, {}), "grok-4.6");
assert.equal(mp.normalizeChatModel("stealth/ox-alpha"), "grok-4.6");
assert.equal(mp.isBannedChatModel("stealth/ox-alpha"), true);
assert.equal(mp.sessionProvider({}, { model: "muse-spark-1.2-contributor" }), "meta-ai");
assert.equal(mp.sessionProvider({}, { model: "grok-4.6", provider: "meta-ai" }), "xai-oauth");
assert.equal(mp.sessionProvider({}, { model: "grok-4.6", provider: "xai" }), "xai-oauth");
assert.equal(mp.codingModel({}, { model: "grok-4.6", codingModel: "" }), "grok-4.6");
assert.equal(mp.codingModel({}, { model: "grok-4.6", codingModel: "grok-4.5" }), "grok-4.5");
assert.equal(mp.grokCliModel("xai/grok-4.6"), "grok-4.6");
assert.equal(mp.grokCliModel("grok-4.5"), "grok-4.5");
assert.equal(mp.grokCliModel("stealth/ox-alpha"), "");
assert.equal(mp.grokFlag("grok-4.6"), "-m grok-4.6");
assert.equal(mp.grokFlag("claude-sonnet"), "");
assert.equal(mp.normalizeHarness("opencode"), "opencode");
assert.equal(mp.harnessInfo({ codingHarness: "cursor" }).connecting, "Connecting to Cursor");
assert.ok(mp.agentsModelBlock({}, { codingHarness: "opencode" }).includes("OpenCode"));
const block = mp.agentsModelBlock({}, { model: "grok-4.6" });
assert.ok(block.includes("-m grok-4.6"));
assert.ok(block.includes("Hermes session model"));
console.log("model-pick-test ok");
