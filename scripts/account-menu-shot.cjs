"use strict";

/**
 * Drives the real Sidebar/AccountMenu in a real BrowserWindow and writes one
 * JSON blob for scripts/account-menu-style-test.cjs to assert on, plus PNG
 * screenshots for eyeball review. Same `?mock=1` / no-preload approach as
 * scripts/three-ui-fixes-shot.cjs — window.hydo is the devmock, so the real
 * roster in electron/store.cjs is never touched.
 *
 *   npx electron scripts/account-menu-shot.cjs <built-outdir> <out.json> <shot-dir>
 */

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const OUTDIR = process.argv[2];
const OUT = process.argv[3];
const SHOTDIR = process.argv[4];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIGN_IN = `(async () => {
  const btn = [...document.querySelectorAll("button")].find((b) => /sign in/i.test(b.textContent || ""));
  if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 2500));
  return !!document.querySelector(".sand-sidebar, .sand-home");
})()`;

const OPEN_MENU = `(() => {
  const btn = document.querySelector(".sand-account");
  if (!btn) return false;
  btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
})()`;

// Real computed values, not source guesses — this app's signature bug is a
// rule that applies its class and changes no pixels because a more-specific
// one already won.
const MEASURE = `(() => {
  const card = document.querySelector(".sand-sidebar .account-menu");
  if (!card) return null;
  const cardCs = getComputedStyle(card);
  const items = [...card.querySelectorAll(".account-menu__item")];
  const settingsItem = items.find((b) => /settings/i.test(b.textContent || ""));
  const logoutItem = items.find((b) => /log out/i.test(b.textContent || ""));
  const readItem = (b) => {
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const icon = b.querySelector(".gb-icon");
    const iconCs = icon ? getComputedStyle(icon, "::before") : null;
    const iconR = icon ? icon.getBoundingClientRect() : null;
    return {
      height: Math.round(r.height * 100) / 100,
      padding: cs.padding,
      fontSize: cs.fontSize,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      iconClass: icon ? icon.className : null,
      iconContent: iconCs ? iconCs.content : null,
      iconFontSize: icon ? getComputedStyle(icon).fontSize : null,
      iconWidth: iconR ? Math.round(iconR.width * 100) / 100 : null,
      iconHeight: iconR ? Math.round(iconR.height * 100) / 100 : null,
    };
  };
  return {
    card: {
      background: cardCs.backgroundColor,
      border: cardCs.borderTopWidth + " " + cardCs.borderTopStyle + " " + cardCs.borderTopColor,
      borderRadius: cardCs.borderRadius,
      padding: cardCs.padding,
      boxShadow: cardCs.boxShadow,
    },
    settings: readItem(settingsItem),
    logout: readItem(logoutItem),
    itemCount: items.length,
  };
})()`;

app.whenReady().then(async () => {
  let code = 0;
  const out = {};
  try {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    const index = path.join(OUTDIR, "index.html");
    const win = new BrowserWindow({ width: 1280, height: 900, show: false });
    await win.loadFile(index, { query: { mock: "1" } });
    await sleep(1200);
    const signedIn = await win.webContents.executeJavaScript(SIGN_IN);
    if (!signedIn) {
      const html = await win.webContents.executeJavaScript("document.body.innerHTML.slice(0,2000)");
      throw new Error("sign-in did not reach the shell -- body: " + html);
    }
    await sleep(400);

    for (const theme of ["dark", "light"]) {
      await win.webContents.executeJavaScript(
        `window.hydo.setSettings({ appearance: ${JSON.stringify(theme)} }).then(() => 1)`
      );
      await sleep(400);
      const opened = await win.webContents.executeJavaScript(OPEN_MENU);
      if (!opened) throw new Error(`account button not found (${theme})`);
      await sleep(400);
      out[theme] = await win.webContents.executeJavaScript(MEASURE);
      if (!out[theme]) throw new Error(`account menu did not open (${theme})`);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(SHOTDIR, `account-menu-${theme}.png`), img.toPNG());
      // close the menu before switching theme
      await win.webContents.executeJavaScript(OPEN_MENU);
      await sleep(200);
    }

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(`account-menu-shot failed — ${(err && err.stack) || err}`);
    code = 1;
  } finally {
    app.exit(code);
  }
});

process.on("uncaughtException", (e) => {
  console.error(`account-menu-shot crashed — ${e && e.message}`);
  app.exit(1);
});
