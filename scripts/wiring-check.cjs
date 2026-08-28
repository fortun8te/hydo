"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./lib/source-scan.cjs");

const ROOT = path.join(__dirname, "..");
const preload = fs.readFileSync(path.join(ROOT, "electron/preload.cjs"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "electron/main.cjs"), "utf8");
const gateway = fs.readFileSync(path.join(ROOT, "electron/hermes-gateway.cjs"), "utf8");
const store = stripComments(fs.readFileSync(path.join(ROOT, "electron/store.cjs"), "utf8"));
// Almost every handler lives in main.cjs (excluded from this pass), but
// approval-settings.cjs registers its own three via ipcMain.handle directly —
// see its header comment for why (registered from store.cjs's own module
// load instead, guarded on process.versions.electron). A preload call is
// "wired" if the literal channel string reaches ipcMain.handle ANYWHERE in
// the main process, not specifically in main.cjs.
const approvalSettings = fs.readFileSync(path.join(ROOT, "electron/approval-settings.cjs"), "utf8");

const ipc = [...preload.matchAll(/invoke\("hydo:([^"]+)"/g)].map((m) => m[1]);
assert.ok(ipc.length > 20, "preload hydo API too small");
for (const name of ipc) {
  const needle = `"hydo:${name}"`;
  assert.ok(
    main.includes(needle) || approvalSettings.includes(needle),
    `main missing handler hydo:${name}`
  );
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

// ---- the smoke test must never pass by not running -------------------------
//
// `main.cjs` takes a single-instance lock (added to stop launches stacking a
// whole second Hermes tree). `smoke.cjs` boots that same file, so with the real
// app open it could not get the lock, quit before printing a word, and exit 0.
// `npm run smoke` reported success while testing nothing — and the app being
// open is exactly when anyone would run it.
//
// Nothing errored. The only symptom was silence, which reads as success.
{
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "electron/main.cjs"), "utf8");
  const smoke = fs.readFileSync(path.join(root, "scripts/smoke.cjs"), "utf8");

  assert.ok(
    /HYDO_SMOKE/.test(smoke),
    "smoke.cjs must ask main.cjs to stand down its single-instance lock"
  );
  assert.ok(
    /!SMOKE && !app\.requestSingleInstanceLock\(\)/.test(main),
    "main.cjs must honour that request, or the smoke test silently exits 0"
  );
  console.log("wiring-check (smoke can boot) ok");
}
