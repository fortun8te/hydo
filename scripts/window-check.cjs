"use strict";

/**
 * Drag the real window and watch the layout respond.
 *
 * Why this is a script and not a test: the browser pane the rest of this
 * project is verified in does not composite, so it fires no matchMedia change
 * events and advances no CSS transitions. Anything that only happens WHILE a
 * window is being resized is invisible there — which is how "the rail
 * collapses when you drag it narrow" stayed unverified for a while despite
 * being correct.
 *
 * A real BrowserWindow does all of it. Needs the dev server up:
 *
 *   npm run dev          # in another terminal, or vite on :5199
 *   npx electron scripts/window-check.cjs
 *
 * No preload on purpose: `window.hydo` stays undefined, so `?mock=1` installs
 * the dev fixture and the whole Shell renders without the main process.
 */

const { app, BrowserWindow } = require("electron");

const URL = process.env.HYDO_URL || "http://localhost:5199/?mock=1";
const BREAKPOINT = 880;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 800, show: false });
  try {
    await win.loadURL(URL);
  } catch (err) {
    console.error(`could not reach ${URL} — is the dev server running?`);
    app.exit(1);
    return;
  }
  await sleep(3000);

  const read = () =>
    win.webContents.executeJavaScript(`(()=>{
      const a = document.querySelector('.sand-sidebar');
      return { w: innerWidth, collapsed: a && a.dataset.collapsed === 'true',
               px: a ? Math.round(a.getBoundingClientRect().width) : null };
    })()`);

  let bad = 0;
  const check = async (label) => {
    const r = await read();
    // The rail IS the narrow layout, so below the breakpoint it must be
    // collapsed and above it must not be.
    const want = r.w < BREAKPOINT;
    const ok = r.collapsed === want;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${String(label).padEnd(16)} w=${r.w} collapsed=${r.collapsed} sidebar=${r.px}px`);
  };

  await check("start");
  for (const w of [1000, 900, 860, 800, 760]) {
    win.setSize(w, 800);
    await sleep(450);
    await check(`drag ${w}`);
  }
  for (const w of [860, 900, 1000, 1200]) {
    win.setSize(w, 800);
    await sleep(450);
    await check(`drag ${w}`);
  }

  console.log(bad ? `\n${bad} size(s) wrong` : "\nlayout tracks the window at every size");
  win.destroy();
  app.exit(bad ? 1 : 0);
});
