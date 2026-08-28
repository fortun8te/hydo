"use strict";

/**
 * Photograph and MEASURE the update ticker and the account menu, in a real
 * BrowserWindow, in both themes.
 *
 * Why measured and not asserted from source: this repo has now lost the same
 * fight three times — a rule applies its class, changes no pixels, and the
 * source reads perfectly. `.hy-dialog button` at (0,1,1) beat
 * `.hy-btn--primary` at (0,1,0) and painted a white label onto a white button.
 * The two new selectors here are in exactly that position:
 *
 *   - `.account-menu__meta--update` would sit at (0,1,0) against the existing
 *     `.sand-sidebar .account-menu__meta` at (0,2,0), which sets
 *     `color: var(--sand-text-secondary)`. It would LOSE. So it is written
 *     three classes deep, and this file reads the computed colour back to
 *     prove the blue actually landed.
 *   - `.sand-update` cannot inherit from `.sand-sidebar .sand-plugins` for
 *     the same reason, so every property is restated — and the computed
 *     background is checked here rather than trusted.
 *
 * Same safety choices as scripts/settings-shot.cjs, which this is modelled on:
 * `?mock=1` and NO preload, so `window.hydo` is src/lib/devmock.js and
 * electron/main.cjs — which owns the user's real roster — is never loaded. A
 * built fixture bundle over file://, because in a sandboxed shell Electron's
 * network service cannot come up and every http:// load fails ERR_FAILED.
 *
 *   npx electron scripts/update-ticker-shot.cjs <out-prefix>
 *
 * Exits on every path, including the throwing ones.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");

const OUTDIR = path.join(os.tmpdir(), "hydo-settings-shot-dist");
const PREFIX = process.argv[2] || path.join(os.tmpdir(), "hydo-update-ticker");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fixtureIndex() {
  const index = path.join(OUTDIR, "index.html");
  if (!fs.existsSync(index)) {
    throw new Error(`no fixture bundle at ${index} — build it first (see scripts/update-ticker-test.cjs)`);
  }
  return index;
}

// Get into the app and open the account menu the way a person does: click the
// account row in the sidebar foot. Driving React state would prove nothing
// about whether the control is reachable.
const OPEN = `(async () => {
  const signIn = [...document.querySelectorAll("button")].find((b) => /sign in/i.test(b.textContent || ""));
  if (signIn) {
    signIn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1400));
  }
  const acct = document.querySelector(".sand-account");
  if (!acct) return "no account button";
  acct.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  return document.querySelector(".account-menu") ? "open" : "no menu";
})()`;

/**
 * Everything below is read off the LIVE layout and the LIVE cascade. A
 * computed colour that equals the secondary-text colour means the rule lost,
 * whatever the stylesheet says.
 */
const MEASURE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const tick = document.querySelector(".sand-update");
  const label = document.querySelector(".sand-update__label");
  const dot = document.querySelector(".sand-update__dot");
  const menu = document.querySelector(".account-menu");
  const items = menu ? [...menu.querySelectorAll(".account-menu__item")] : [];
  const updateItem = items.find((b) => /software update/i.test(b.textContent || "")) || null;
  const badge = updateItem ? updateItem.querySelector(".account-menu__meta--update") : null;
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const plugins = document.querySelector(".sand-plugins");
  return {
    ticker: {
      present: !!tick,
      text: tick ? (tick.textContent || "").trim() : null,
      box: box(tick),
      bg: cs(tick) ? cs(tick).backgroundColor : null,
      labelColor: cs(label) ? cs(label).color : null,
      labelSize: cs(label) ? cs(label).fontSize : null,
      dotBg: cs(dot) ? cs(dot).backgroundColor : null,
      // Proof it is genuinely smaller than the two rows it sits above, which
      // is the whole "lil" in "a lil blue ticker".
      pluginsBox: box(plugins),
    },
    menu: {
      present: !!menu,
      items: items.map((b) => (b.textContent || "").trim()),
      updateItemText: updateItem ? (updateItem.textContent || "").trim() : null,
      // Same tag, same class, same icon slot as its neighbours: if the update
      // row diverges in shape it reads as a different kind of thing.
      updateItemTag: updateItem ? updateItem.tagName : null,
      updateItemClass: updateItem ? updateItem.className : null,
      updateItemHasIcon: !!(updateItem && updateItem.querySelector(".gb-icon")),
      updateItemHeight: updateItem ? Math.round(updateItem.getBoundingClientRect().height) : null,
      siblingHeights: items.map((b) => Math.round(b.getBoundingClientRect().height)),
      badgeText: badge ? (badge.textContent || "").trim() : null,
      badgeColor: cs(badge) ? cs(badge).color : null,
      // The colour the badge would have if the specificity fight were lost.
      // Compared, not eyeballed.
      metaDefaultColor: (() => {
        const plain = document.createElement("span");
        plain.className = "account-menu__meta";
        if (menu) {
          menu.appendChild(plain);
          const c = getComputedStyle(plain).color;
          plain.remove();
          return c;
        }
        return null;
      })(),
      // The icon font must actually have this glyph. An undefined
      // .gb-icon-* class renders a blank box and looks like a missing icon.
      iconClass: updateItem
        ? [...updateItem.querySelectorAll(".gb-icon")].map((i) => i.className).join(" ")
        : null,
    },
    theme: document.documentElement.dataset.theme || null,
  };
})()`;

app.whenReady().then(async () => {
  let code = 0;
  try {
    const index = fixtureIndex();
    const out = {};
    // ONE window, reloaded per theme — destroying it between themes takes the
    // last window with it and the next loadFile dies with ERR_FAILED.
    let shared = null;
    for (const theme of ["dark", "light"]) {
      const win = shared || (shared = new BrowserWindow({ width: 1240, height: 900, show: false }));
      await win.loadFile(index, { query: { mock: "1" } });
      await sleep(3200);
      // Through the setting, the way the app does it. Stamping data-theme on
      // <html> by hand tests the stylesheet, not the app.
      await win.webContents.executeJavaScript(
        `window.hydo.setSettings({ appearance: ${JSON.stringify(theme)} }).then(() => 1)`
      );
      await sleep(700);
      const opened = await win.webContents.executeJavaScript(OPEN);
      if (opened !== "open") throw new Error(`could not open the account menu: ${opened}`);
      await sleep(400);
      const seen = await win.webContents.executeJavaScript(`document.documentElement.dataset.theme`);
      if (seen !== (theme === "dark" ? "cursor-dark" : "cursor-light")) {
        throw new Error(`theme did not apply: <html data-theme> is ${seen}`);
      }
      out[theme] = await win.webContents.executeJavaScript(MEASURE);
      const png = (await win.webContents.capturePage()).toPNG();
      if (png.length < 5000) throw new Error("blank frame");
      fs.writeFileSync(`${PREFIX}-${theme}.png`, png);
    }
    fs.writeFileSync(`${PREFIX}.json`, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`update-ticker-shot ok — ${PREFIX}-{dark,light}.png, ${PREFIX}.json`);
  } catch (err) {
    console.error(`update-ticker-shot failed — ${(err && err.message) || err}`);
    code = 1;
  } finally {
    app.exit(code);
  }
});

process.on("uncaughtException", (e) => {
  console.error(`update-ticker-shot crashed — ${e && e.message}`);
  app.exit(1);
});
