"use strict";

/**
 * Boot the real app and check it is alive.
 *
 * Everything else in scripts/ tests a module in isolation, and the browser
 * pane renders the renderer against a fixture. Neither exercises real
 * main.cjs + real preload + real store + the real state.json together, which
 * is the only combination the user ever actually runs — and it is where a
 * whole class of failure lives that no unit test can see. This project has
 * already shipped one: a const read before its declaration in a component,
 * which `vite build` compiles happily and which blanked the entire app.
 *
 *   npm run build && npx electron scripts/smoke.cjs
 *
 * Exits non-zero on: no window, an empty root, any uncaught exception or
 * unhandled rejection during boot, or a missing IPC handler.
 */

const path = require("node:path");
const { app, BrowserWindow } = require("electron");

process.env.HYDO_DIST = "1";

const problems = [];
process.on("uncaughtException", (e) => problems.push(`uncaught: ${e && e.message}`));
process.on("unhandledRejection", (e) => problems.push(`unhandled: ${e && e.message}`));

require(path.join(__dirname, "..", "electron", "main.cjs"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The bridge the renderer depends on, checked FROM the renderer.
//
// Not via `ipcMain.eventNames()` — `handle()` registrations live in a separate
// map and never appear there, so that reads as "everything is missing" on a
// perfectly healthy app. The question that matters is whether the renderer can
// reach these anyway, so it is asked there and one is really invoked.
const REQUIRED = [
  "getState",
  "send",
  "select",
  "createAgent",
  "setAgent",
  "boxStatus",
  "boxEnsure",
  "boxStop",
  "processes",
  "killProcess",
  "undoLast",
  "sessionToolsets",
];

app.whenReady().then(async () => {
  await sleep(6000);

  const wins = BrowserWindow.getAllWindows();
  if (!wins.length) {
    console.log("FAIL  no window was created");
    app.exit(1);
    return;
  }
  const win = wins[0];

  const probe = await win.webContents
    .executeJavaScript(
      `(() => {
        const root = document.getElementById('root');
        return {
          title: document.title,
          children: root ? root.children.length : 0,
          // Either the roster or the home screen means React mounted and the
          // store answered. A white window with a live title does not.
          mounted: !!document.querySelector('.sand-sidebar, .sand-home'),
        };
      })()`
    )
    .catch((e) => ({ err: e.message }));

  const bridge = await win.webContents
    .executeJavaScript(
      `(async () => {
        const want = ${JSON.stringify(REQUIRED)};
        const missing = want.filter((k) => typeof window.hydo?.[k] !== "function");
        // Prove the round trip, not just the shape: a preload that exposes a
        // name with no handler behind it rejects here.
        let roundTrip = "not attempted";
        try {
          const st = await window.hydo.getState();
          roundTrip = st && Array.isArray(st.agents) ? "ok" : "returned nothing usable";
        } catch (e) {
          roundTrip = "threw: " + e.message;
        }
        return { missing, roundTrip };
      })()`
    )
    .catch((e) => ({ missing: ["<probe failed>"], roundTrip: e.message }));
  const missing = bridge.missing;

  console.log(`title     ${win.getTitle()}`);
  console.log(`mounted   ${probe.mounted ? "yes" : "NO"}  (root children: ${probe.children})`);
  console.log(`bridge    ${missing.length ? `MISSING ${missing.join(", ")}` : `all ${REQUIRED.length} reachable`}`);
  console.log(`getState  ${bridge.roundTrip}`);
  console.log(`errors    ${problems.length ? problems.join(" | ") : "none"}`);

  const ok = probe.mounted && !missing.length && bridge.roundTrip === "ok" && !problems.length;
  console.log(ok ? "\nthe app boots" : "\nboot is broken");
  app.exit(ok ? 0 : 1);
});
