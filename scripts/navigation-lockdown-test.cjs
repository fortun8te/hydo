#!/usr/bin/env node
"use strict";

/**
 * navigation-lockdown-test.cjs — the app window renders the app, and links go
 * to the browser only when they are links.
 *
 * Two holes this locks:
 *
 *   1. `setWindowOpenHandler` handed every `window.open()` URL to
 *      `shell.openExternal` with no scheme check, while the `hydo:openExternal`
 *      IPC ten lines away DID check. `window.open("file:///…")` was therefore
 *      the documented check's own bypass, and openExternal on a file:// or
 *      custom scheme is "ask the OS to run whatever is registered for this".
 *   2. There was no `will-navigate` guard, so anything able to set
 *      `location` — artifact content a model wrote, included — could replace
 *      the renderer with a remote page that still sat behind the preload
 *      bridge.
 *
 * The scheme rules are asserted against the REAL source predicate rather than
 * a copy of it, so a future edit to `isAppUrl` cannot pass here while breaking
 * the app.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./lib/source-scan.cjs");

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

const src = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
const code = stripComments(src);

// Lift the real predicate out of main.cjs and run it. main.cjs cannot be
// required outside Electron, so this evaluates the one function under test.
const m = code.match(/function isAppUrl\(url\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, "isAppUrl is gone from electron/main.cjs");
// eslint-disable-next-line no-new-func
const isAppUrl = new Function(`${m[0]}; return isAppUrl;`)();

test("the app's own origins are navigable", () => {
  assert.equal(isAppUrl("file:///Applications/Hydo.app/Contents/index.html"), true);
  assert.equal(isAppUrl("http://localhost:5173/"), true);
  assert.equal(isAppUrl("http://127.0.0.1:5173/index.html"), true);
});

test("everywhere else is not", () => {
  for (const url of [
    "https://example.com",
    "https://localhost.evil.com/",
    "http://evil.com/?x=localhost",
    "javascript:alert(1)",
    "data:text/html,<h1>hi</h1>",
    "",
    null,
    "not a url",
  ]) {
    assert.equal(isAppUrl(url), false, `${JSON.stringify(url)} was treated as the app`);
  }
});

test("the popup handler gates the scheme before openExternal", () => {
  const h = code.match(/setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]*?\n  \}\)/);
  assert.ok(h, "the main window's window-open handler is gone");
  const body = h[0];
  assert.ok(/https\?:/.test(body), "window.open() reaches shell.openExternal with no scheme check");
  assert.ok(/action: "deny"/.test(body), "the popup is no longer denied");
  // The gate must come before the call, not after it.
  assert.ok(
    body.indexOf("https?:") < body.indexOf("openExternal"),
    "the scheme test does not guard the openExternal call"
  );
});

test("will-navigate is guarded on the app window", () => {
  assert.ok(/on\("will-navigate"/.test(code), "no will-navigate guard");
  const g = code.match(/on\("will-navigate", \(e, url\) => \{[\s\S]*?isAppUrl[\s\S]*?\n  \}\)/);
  assert.ok(g, "the app window's will-navigate guard does not consult isAppUrl");
  assert.ok(/preventDefault\(\)/.test(g[0]), "the guard does not actually prevent the navigation");
});

test("webviews cannot be attached", () => {
  const w = code.match(/on\("will-attach-webview"[\s\S]*?\n  \}\)/);
  assert.ok(w, "no will-attach-webview guard");
  assert.ok(/preventDefault\(\)/.test(w[0]), "the webview guard does not prevent attachment");
});

test("the remote-screen window opens no popups and does not wander", () => {
  const idx = code.indexOf("desktopWin");
  assert.ok(idx > 0, "the desktop window is gone");
  const tail = code.slice(idx);
  assert.ok(
    /desktopWin\.webContents\.setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/.test(tail),
    "the remote-screen window still allows popups"
  );
  assert.ok(/vncOrigin/.test(tail), "the remote-screen window has no same-origin navigation guard");
});

test("the IPC path still checks its scheme too", () => {
  const i = code.match(/ipcMain\.handle\("hydo:openExternal"[\s\S]*?\n  \}\)/);
  assert.ok(i, "hydo:openExternal is gone");
  assert.ok(/blocked-scheme/.test(i[0]), "the IPC scheme check was lost");
});

if (failed) {
  console.log(`navigation-lockdown-test FAILED (${failed})`);
  process.exit(1);
}
console.log("navigation-lockdown-test ok — the window renders the app, links go to the browser");
