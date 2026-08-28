#!/usr/bin/env node
"use strict";

/**
 * local-grok-name-test.cjs — the name of a MODEL never decides which MACHINE
 * answers.
 *
 * A self-hosted box can serve a GGUF called anything its author felt like,
 * `grok-something` included. Two places in the settings path used to read that
 * string and force `provider = xai-oauth`, which quietly moved the turn off the
 * user's own hardware and onto the network — the exact opposite of what picking
 * a local endpoint means, and invisible until a bill or an offline laptop made
 * it visible.
 *
 * The provider id is the only thing that knows where a turn runs, so it is the
 * only thing allowed to decide. These assertions go through the REAL store
 * (load path and setSettings path) against a REAL config file rather than
 * asking whether a regex is still spelled the same way, because the bug was
 * never in the regex — it was in what the regex was permitted to overwrite.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-grokname-"));
const cfg = path.join(dir, "config.yaml");
// `mybox` deliberately serves a model whose name contains "grok".
fs.writeFileSync(
  cfg,
  [
    "providers:",
    "  mybox:",
    "    api: http://127.0.0.1:8888/v1",
    "    default_model: grok-ish-local-gguf",
    "  otherbox:",
    "    api: http://127.0.0.1:8889/v1",
    "    default_model: Qwen3.8-Flash-Next",
    "",
  ].join("\n")
);

const prev = process.env.HYDO_HERMES_CONFIG;
process.env.HYDO_HERMES_CONFIG = cfg;
for (const k of Object.keys(require.cache)) {
  if (k.includes("/electron/")) delete require.cache[k];
}
const modelPick = require("../electron/model-pick.cjs");

test("a configured endpoint is recognised as local", () => {
  assert.equal(modelPick.isLocalProvider("mybox"), true);
  assert.equal(modelPick.isLocalProvider("otherbox"), true);
});

test("xai-oauth is not a local endpoint", () => {
  assert.equal(modelPick.isLocalProvider("xai-oauth"), false);
  assert.equal(modelPick.isLocalProvider(""), false);
  assert.equal(modelPick.isLocalProvider(null), false);
});

test("a grok-named model on a local box stays on that box", () => {
  assert.equal(
    modelPick.sessionProvider({ provider: "mybox" }, { model: "grok-ish-local-gguf" }),
    "mybox"
  );
});

test("a muse-named model on a local box stays on that box too", () => {
  assert.equal(
    modelPick.sessionProvider({ provider: "mybox" }, { model: "muse-spark-local" }),
    "mybox"
  );
});

test("the hosted path is untouched: real Grok still routes to xAI", () => {
  assert.equal(modelPick.sessionProvider({}, { model: "grok-4.6" }), modelPick.DEFAULT_PROVIDER);
  assert.equal(
    modelPick.sessionProvider({ provider: "xai" }, { model: "grok-4.6" }),
    modelPick.DEFAULT_PROVIDER
  );
});

const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-grokname-store-"));
const store = require("../electron/store.cjs").createStore({ dir: storeDir });
store.signIn();

test("setSettings onto a grok-named local model does not reroute to xAI", () => {
  store.setSettings({ provider: "mybox", model: "Qwen3.8-Flash-Next" });
  const after = store.setSettings({ model: "grok-ish-local-gguf" });
  assert.equal(after.settings.provider, "mybox", "provider was overwritten by the model name");
  assert.equal(after.settings.model, "grok-ish-local-gguf");
});

test("an explicit provider change is still obeyed", () => {
  const after = store.setSettings({ provider: "xai-oauth", model: "grok-4.6" });
  assert.equal(after.settings.provider, "xai-oauth");
});

test("switching back to cloud from local works by naming the provider", () => {
  store.setSettings({ provider: "mybox", model: "grok-ish-local-gguf" });
  const after = store.setSettings({ provider: "xai-oauth", model: "grok-4.6" });
  assert.equal(after.settings.provider, "xai-oauth");
});

test("a reload does not reroute a local endpoint either", () => {
  store.setSettings({ provider: "mybox", model: "grok-ish-local-gguf" });
  for (const k of Object.keys(require.cache)) {
    if (k.includes("/electron/store.cjs")) delete require.cache[k];
  }
  const reopened = require("../electron/store.cjs").createStore({ dir: storeDir });
  const s = reopened.getState().settings;
  assert.equal(s.provider, "mybox", "the load path rerouted a local endpoint");
  assert.equal(s.model, "grok-ish-local-gguf");
});

if (prev == null) delete process.env.HYDO_HERMES_CONFIG;
else process.env.HYDO_HERMES_CONFIG = prev;

if (failed) {
  console.log(`local-grok-name-test FAILED (${failed})`);
  process.exit(1);
}
console.log("local-grok-name-test ok — the model name never moves the machine");
