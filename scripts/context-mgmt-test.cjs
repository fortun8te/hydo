"use strict";

const assert = require("node:assert/strict");
const cm = require("../electron/context-mgmt.cjs");

assert.equal(cm.contextPercent({ context_percent: 40 }, { context_percent: 72 }), 72);
assert.equal(cm.contextPercent(null, { context_percent: 12 }), 12);
assert.equal(cm.shouldCompact(70, 70), true);
assert.equal(cm.shouldCompact(69, 70), false);
assert.equal(cm.shouldCompact(0, 70), false);

const agent = {};
cm.applyUsageToAgent(agent, { context_percent: 81, context_used: 1000, context_max: 1234, compressions: 2 });
assert.equal(agent.contextPercent, 81);
assert.equal(agent.compressions, 2);

const md = cm.agentsMarkdown("# Workspace rules\nNever leave.", "You are terse.");
assert.ok(md.includes("Workspace rules"));
assert.ok(md.includes("terse"));
assert.ok(!md.includes("Memory snapshot"));

const { compressIfNeeded, pinFor } = require("../electron/hermes-gateway.cjs");
assert.equal(typeof compressIfNeeded, "function");

const storeSrc = require("node:fs").readFileSync(
  require("node:path").join(__dirname, "../electron/store.cjs"),
  "utf8"
);
const compactDecl = storeSrc.indexOf("const COMPACT_AT_PERCENT");
const compactUse = storeSrc.indexOf(">= COMPACT_AT_PERCENT");
assert.ok(compactDecl >= 0 && compactUse >= 0 && compactDecl < compactUse, "COMPACT_AT_PERCENT must be declared before use");
assert.ok(!storeSrc.includes("Private memory snapshot:"), "standing must not dump memory snapshots");
assert.ok(storeSrc.includes("opts.complete"), "injected complete still short-circuits Hermes");
assert.ok(storeSrc.includes("raw = await complete(system, userText, agent.model || state.settings.model)"), "defaultComplete fallback still wired");

const gwSrc = require("node:fs").readFileSync(
  require("node:path").join(__dirname, "../electron/hermes-gateway.cjs"),
  "utf8"
);
assert.ok(gwSrc.includes("opts.hermesProfile"), "session.create must take hermesProfile, not tool profile, as Hermes home");
assert.ok(gwSrc.includes("p.profile = hermesProfile"), "Hermes identity profile is params.profile");
assert.equal(pinFor({ profile: "writer" }).includes("file"), true);
assert.equal(pinFor({ profile: "writer", hermesProfile: "bot-home-xyz" }), pinFor({ profile: "writer" }));

console.log("context-mgmt-test ok");
