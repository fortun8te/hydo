"use strict";

/**
 * Drives the real Home / Settings / CommandPalette screens in a real
 * BrowserWindow and writes one JSON blob for scripts/three-ui-fixes-test.cjs
 * to assert on.
 *
 * Same safety choice as scripts/settings-shot.cjs: `?mock=1` and NO preload,
 * so `window.hydo` is the devmock (src/lib/devmock.js) and the real roster in
 * main.cjs/store.cjs is never touched. The build is a `--mode development`
 * bundle in a temp dir, built by the caller (three-ui-fixes-test.cjs) before
 * this process starts — running vite build from inside Electron's main
 * process leaves its network service unable to come back up, so file://
 * loads fail afterward. Measured in scripts/settings-shot.cjs already.
 *
 *   npx electron scripts/three-ui-fixes-shot.cjs <built-outdir> <unused-userdata> <out.json>
 */

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const OUTDIR = process.argv[2];
const OUT = process.argv[4];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const SIGN_IN = `(async () => {
  const btn = [...document.querySelectorAll("button")].find((b) => /sign in/i.test(b.textContent || ""));
  if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1000));
  return !!document.querySelector(".sand-sidebar, .sand-home");
})()`;

app.whenReady().then(async () => {
  let code = 0;
  const out = {};
  try {
    const index = path.join(OUTDIR, "index.html");
    const win = new BrowserWindow({ width: 1280, height: 900, show: false });
    await win.loadFile(index, { query: { mock: "1" } });
    await sleep(1200);
    const signedIn = await win.webContents.executeJavaScript(SIGN_IN);
    if (!signedIn) throw new Error("sign-in did not reach the shell");

    // ---- 1. Home empty-state buttons, both themes --------------------------
    // Requires an EMPTY roster (Home.jsx's own condition, not just
    // "nothing selected") — devmock seeds 5 agents, so they're removed here.
    // Devmock only, never electron/store.cjs's real state.
    // Home.jsx's empty state needs the whole roster empty, and Shell.jsx
    // falls back to `entries[0]` (a channel, say) whenever `selectedId`
    // matches nothing — so channels have to go too, or the fallback lands on
    // a channel transcript instead of Home. Devmock state only.
    out.deleteResult = await win.webContents.executeJavaScript(`(async () => {
      const s = await window.hydo.getState();
      for (const a of s.agents) await window.hydo.deleteAgent(a.id);
      for (const c of s.channels || []) await window.hydo.deleteChannel(c.id);
      await window.hydo.select(null);
      const s2 = await window.hydo.getState();
      return { before: s.agents.length, after: s2.agents.length, selected: s2.selectedId };
    })()`);
    await sleep(700);

    const MEASURE_HOME = `(() => {
      const wrap = document.querySelector(".sand-home__actions");
      if (!wrap) return null;
      const solidBtn = wrap.querySelector(".ghost.ghost--solid");
      const ghostBtn = [...wrap.querySelectorAll(".ghost")].find((b) => !b.classList.contains("ghost--solid"));
      const read = (b) => {
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        return { height: Math.round(r.height * 100) / 100, border: cs.borderTopWidth, padding: cs.padding };
      };
      return { solid: read(solidBtn), ghost: read(ghostBtn) };
    })()`;

    out.homeButtons = {};
    out.homeButtons.dark = await win.webContents.executeJavaScript(MEASURE_HOME);
    await win.webContents.executeJavaScript(
      `window.hydo.setSettings({ appearance: "light" }).then(() => 1)`
    );
    await sleep(400);
    out.homeButtons.light = await win.webContents.executeJavaScript(MEASURE_HOME);
    await win.webContents.executeJavaScript(
      `window.hydo.setSettings({ appearance: "dark" }).then(() => 1)`
    );
    await sleep(300);

    // ---- reload for a fresh roster (avatar + palette need real agents) -----
    await win.loadFile(index, { query: { mock: "1" } });
    await sleep(1200);
    await win.webContents.executeJavaScript(SIGN_IN);
    await sleep(400);
    // Seed an avatar so the preview path (vs. the initials-only path) runs,
    // and stub HTMLInputElement.click so a real OS file-picker never opens
    // headless — the test only needs to know the file input WAS asked to
    // open, not to drive the native dialog.
    await win.webContents.executeJavaScript(`(async () => {
      await window.hydo.setSettings({ userAvatar: ${JSON.stringify(TINY_PNG)} });
      window.__fileClicks = 0;
      const orig = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type === "file") { window.__fileClicks += 1; return; }
        return orig.call(this);
      };
    })()`);
    await sleep(300);

    // ---- 2. Settings avatar: preview vs. change --------------------------
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", code: "Comma", metaKey: true, bubbles: true }))`
    );
    await sleep(700);

    const avatar = {};
    // Click the avatar itself.
    await win.webContents.executeJavaScript(`(() => {
      window.__fileClicks = 0;
      document.querySelector(".settings__avatar--edit").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    })()`);
    await sleep(400);
    avatar.previewAfterAvatarClick = await win.webContents.executeJavaScript(
      `!!document.querySelector(".hy-rc-mv-dialog")`
    );
    avatar.previewImageNatural = await win.webContents.executeJavaScript(
      `(() => { const img = document.querySelector(".hy-rc-mv-image"); return !!img && img.src.startsWith("data:image/png"); })()`
    );
    avatar.fileDialogAfterAvatarClick = await win.webContents.executeJavaScript(`window.__fileClicks > 0`);
    // Close the preview the same way a user would, then click the badge.
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`
    );
    await sleep(300);
    await win.webContents.executeJavaScript(`(() => {
      window.__fileClicks = 0;
      document.querySelector(".settings__avatar-hint").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    })()`);
    await sleep(400);
    avatar.previewAfterBadgeClick = await win.webContents.executeJavaScript(
      `!!document.querySelector(".hy-rc-mv-dialog")`
    );
    avatar.fileDialogAfterBadgeClick = await win.webContents.executeJavaScript(`window.__fileClicks > 0`);
    out.avatar = avatar;

    // Close settings.
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`
    );
    await sleep(400);

    // ---- 3. Command palette tabs actually filter ---------------------------
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }))`
    );
    await sleep(500);

    const COUNT_ROWS = `(() => {
      const items = [...document.querySelectorAll(".hy-palette__item")];
      const cmdCount = items.filter((b) => b.querySelector(".hy-palette__item-chord, .gb-icon-circle") || true).length;
      // Bot rows carry an UmbraFace mark (svg/canvas), command rows a gb-icon.
      const botCount = items.filter((b) => !b.querySelector(".gb-icon")).length;
      return { total: items.length, botCount, cmdCount: items.length - botCount };
    })()`;
    const CLICK_TAB = (label) => `(() => {
      const tab = [...document.querySelectorAll(".hy-palette__tab")].find(
        (b) => (b.textContent || "").trim() === ${JSON.stringify(label)}
      );
      if (!tab) return false;
      tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    })()`;

    out.palette = {};
    out.palette.all = await win.webContents.executeJavaScript(COUNT_ROWS);
    if (!(await win.webContents.executeJavaScript(CLICK_TAB("Bots")))) throw new Error("no 'Bots' tab found");
    await sleep(200);
    out.palette.bots = await win.webContents.executeJavaScript(COUNT_ROWS);
    if (!(await win.webContents.executeJavaScript(CLICK_TAB("Actions")))) throw new Error("no 'Actions' tab found");
    await sleep(200);
    out.palette.actions = await win.webContents.executeJavaScript(COUNT_ROWS);

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(`three-ui-fixes-shot failed — ${(err && err.stack) || err}`);
    code = 1;
  } finally {
    app.exit(code);
  }
});

process.on("uncaughtException", (e) => {
  console.error(`three-ui-fixes-shot crashed — ${e && e.message}`);
  app.exit(1);
});
