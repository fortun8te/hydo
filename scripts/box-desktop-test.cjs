"use strict";

/**
 * Watching the machine has to actually connect, and has to happen inside Hydo.
 *
 * The Open button used to hand `desktopUrl` to the system browser. One click,
 * two bugs:
 *
 *   1. That URL is the Moonlight/WebRTC stream, and the vendor's own docs say
 *      WebRTC "relies on UDP and peer connectivity, so on restrictive,
 *      corporate, or low-bandwidth networks it can be choppy or fail to
 *      connect". Observed exactly: the browser sat on "Connecting to desktop
 *      stream..." forever against a box that was up, with a matching hostId and
 *      a live IP. Nothing errored; it simply never arrived.
 *   2. It threw the user out of the app to look at their own teammate.
 *
 * `--vnc` tunnels over plain HTTPS. Lower frame rate, and it connects —
 * measured from a cold Electron window: "Connected (encrypted)", a live
 * 1280x788 canvas, the real Ubuntu desktop.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const runtime = fs.readFileSync(path.join(ROOT, "electron/box-runtime.cjs"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "electron/main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(ROOT, "electron/preload.cjs"), "utf8");

// ---- VNC, not the stream that hangs ----------------------------------------
assert.ok(/async function desktopUrl\(/.test(runtime), "the runtime can produce a desktop URL");
assert.ok(/vnc = true/.test(runtime), "and it defaults to VNC, because the WebRTC one does not connect here");
assert.ok(/args\.push\("--vnc"\)/.test(runtime), "which means passing --vnc to the CLI");

// Fetched fresh: the URL carries a session token and a spent one is a blank
// screen with no explanation.
const fn = /async function desktopUrl\([\s\S]*?\n  \}/.exec(runtime);
assert.ok(fn, "desktopUrl body");
assert.ok(!/cache|memo/i.test(fn[0]), "never cached — a stale token renders nothing and says nothing");

// ---- in Hydo, not in Safari -------------------------------------------------
assert.ok(/hydo:boxDesktop/.test(main), "main opens the desktop itself");
assert.ok(/new BrowserWindow\(/.test(main), "in a Hydo-owned window");
const handler = /ipcMain\.handle\("hydo:boxDesktop"[\s\S]*?\n  \}\);/.exec(main);
assert.ok(handler, "the handler");
assert.ok(
  /contextIsolation: true[\s\S]*?nodeIntegration: false[\s\S]*?sandbox: true/.test(handler[0]),
  "sandboxed with no preload: this renders a REMOTE machine's screen and must never reach the store, the gateway or the box CLI"
);
assert.ok(
  /desktopWin\.isDestroyed\(\)/.test(handler[0]),
  "one window, reused — each is a live connection to a machine billed by the second"
);
assert.ok(/boxDesktop:/.test(preload), "exposed to the renderer");

// ---- and the rail must use it ----------------------------------------------
const rail = fs.readFileSync(path.join(ROOT, "src/screens/ComputerRail.jsx"), "utf8");
assert.ok(
  !/openExternal\?\.\(st\.desktopUrl\)/.test(rail),
  "the rail must NOT hand the hanging WebRTC URL to the system browser"
);

console.log("box-desktop-test ok");
