"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const preload = fs.readFileSync(path.join(ROOT, "electron/preload.cjs"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "electron/main.cjs"), "utf8");
const gateway = fs.readFileSync(path.join(ROOT, "electron/hermes-gateway.cjs"), "utf8");
const store = fs.readFileSync(path.join(ROOT, "electron/store.cjs"), "utf8");

const ipc = [...preload.matchAll(/invoke\("hydo:([^"]+)"/g)].map((m) => m[1]);
assert.ok(ipc.length > 20, "preload hydo API too small");
for (const name of ipc) {
  const needle = `"hydo:${name}"`;
  assert.ok(main.includes(needle), `main missing handler hydo:${name}`);
}

const must = [
  ["hermes-gateway", gateway, ["session.compress", "computer_use", "hermesProfile", "respondGate"]],
  ["store", store, ["compressIfNeeded", "botHome.prepare", "contextMgmt", "answerGate", "computer_use"]],
];
for (const [label, src, needles] of must) {
  for (const n of needles) {
    assert.ok(src.includes(n), `${label} missing ${JSON.stringify(n)}`);
  }
}

assert.ok(gateway.includes("DEFAULT_PROFILE = 'builder'"));
assert.ok(!store.includes('cwd: path.join(dir, "bots", agent.id)') || store.includes("home.cwd"));

console.log(`wiring-check ok ipc=${ipc.length}`);
