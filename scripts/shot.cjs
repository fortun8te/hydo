"use strict";

/**
 * Photograph the real app, in one command, without touching the user's data.
 *
 * This exists because of the failure this repo keeps re-discovering: a UI
 * change that is correct in the diff, green in the suite, and changes NO
 * PIXELS. `scripts/sidebar-sections-test.cjs` names one (a rule that lost to a
 * more specific selector); `scripts/plan-active-test.cjs` names another (a
 * control that errored and never repainted). A test asserting on the source
 * cannot see either. A photograph can.
 *
 *   npx electron scripts/shot.cjs [out.png]
 *
 * Two deliberate choices, both safety:
 *
 *  - It boots the VITE DEV SERVER and loads `?mock=1`, not the packaged app.
 *    `src/App.jsx` gates the dev mock on `import.meta.env.DEV`, so the mock
 *    roster only exists here. More importantly `electron/main.cjs` pins
 *    userData to `~/Library/Application Support/Hydo` with no environment
 *    override, so `npm run smoke` reads and writes the user's REAL
 *    `state.json`. An agent verifying a change must never do that. This script
 *    never loads main.cjs.
 *  - No preload, so `window.hydo` stays undefined and the fixture takes over —
 *    the same trick `scripts/window-check.cjs` uses.
 *
 * Exits 0 with a PNG on disk, or non-zero with a reason. Always exits.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow } = require("electron");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.HYDO_SHOT_PORT || 5199);
const OUT = path.resolve(process.argv.slice(2).find((a) => a.endsWith(".png")) || "/tmp/hydo-shot.png");
const WIDTH = Number(process.env.HYDO_SHOT_WIDTH || 1200);
const HEIGHT = Number(process.env.HYDO_SHOT_HEIGHT || 800);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Is something already serving on the port? Reuse it rather than fight it. */
async function alive() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(700) });
    return res.ok;
  } catch {
    return false;
  }
}

let vite = null;

async function startVite() {
  if (await alive()) return "reused";
  vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ROOT,
    stdio: "ignore",
    detached: false,
  });
  // Poll rather than sleep a fixed amount: a cold vite is slow, a warm one is
  // instant, and a hardcoded wait is wrong in both directions.
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    if (await alive()) return "started";
  }
  throw new Error(`vite never came up on :${PORT}`);
}

function stopVite() {
  if (vite && !vite.killed) {
    try {
      vite.kill("SIGTERM");
    } catch {
      /* going away anyway */
    }
  }
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    const how = await startVite();
    const win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false });
    await win.loadURL(`http://127.0.0.1:${PORT}/?mock=1`);
    // The shell renders in stages (fonts, the lazy route chunk, the mock's
    // own async install). Shooting too early photographs a blank frame and
    // reports success, which is exactly the lie this script exists to stop.
    await sleep(3500);

    const painted = await win.webContents.executeJavaScript(
      `(()=>{const r=document.getElementById('root');
        return r ? r.innerText.trim().length : 0;})()`
    );
    if (!painted) throw new Error("root is empty — the app did not render");

    const img = await win.webContents.capturePage();
    const png = img.toPNG();
    if (png.length < 5000) throw new Error(`png is ${png.length} bytes — that is a blank frame`);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, png);
    console.log(`shot ok — ${OUT} (${(png.length / 1024).toFixed(0)} kB, vite ${how}, ${WIDTH}x${HEIGHT})`);
  } catch (err) {
    console.error(`shot failed — ${(err && err.message) || err}`);
    code = 1;
  } finally {
    stopVite();
    app.exit(code);
  }
});

process.on("uncaughtException", (e) => {
  console.error(`shot crashed — ${e && e.message}`);
  stopVite();
  app.exit(1);
});
