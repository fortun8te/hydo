"use strict";

/**
 * Drives the real Shell in a real BrowserWindow and writes one JSON blob for
 * scripts/overlay-narrow-glow-test.cjs to assert on, plus PNG screenshots.
 *
 * Same safety choice as scripts/three-ui-fixes-shot.cjs: `?mock=1` and NO
 * preload, so `window.hydo` is the devmock (src/lib/devmock.js) and the real
 * roster in main.cjs/store.cjs is never touched. The `--mode development`
 * build is made by the CALLER before this process starts — running vite build
 * from inside Electron's main process leaves its network service unable to
 * come back up, so file:// loads fail afterward.
 *
 *   npx electron scripts/overlay-narrow-glow-shot.cjs <outdir> <shotdir> <out.json>
 */

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const OUTDIR = process.argv[2];
const SHOTS = process.argv[3];
const OUT = process.argv[4];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIGN_IN = `(async () => {
  const btn = [...document.querySelectorAll("button")].find((b) => /sign in/i.test(b.textContent || ""));
  if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1000));
  return !!document.querySelector(".sand-sidebar, .sand-home");
})()`;

// Every modal/overlay surface this app has, by the selector it actually paints
// under. Counting these in the live DOM is the only honest test of exclusivity:
// a state machine that "looks" exclusive in source can still render two.
const SURFACES = {
  settings: ".hy-dialog[aria-label='Settings']",
  plugins: ".hy-plugins",
  botCreate: ".hy-botcreate",
  channelCreate: ".hy-chcreate",
  palette: ".hy-palette",
  find: ".hy-find",
  sheet: ".sheet",
  artifact: ".artifact-modal",
  confirm: ".confirm",
  contextMenu: ".sand-menu, .hy-menu, [role='menu']:not(.account-menu)",
  accountMenu: ".account-menu",
};

const OPEN_SURFACES = `(() => {
  const map = ${JSON.stringify(SURFACES)};
  const on = [];
  for (const [name, sel] of Object.entries(map)) if (document.querySelector(sel)) on.push(name);
  return on;
})()`;

const key = (k, extra = {}) =>
  `document.dispatchEvent(new KeyboardEvent("keydown", ${JSON.stringify({
    key: k,
    bubbles: true,
    ...extra,
  })}))`;

app.whenReady().then(async () => {
  let code = 0;
  const out = { surfaces: SURFACES };
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    const index = path.join(OUTDIR, "index.html");
    const win = new BrowserWindow({ width: 1280, height: 900, show: false });
    const js = (src) => win.webContents.executeJavaScript(src);
    const shot = async (name) => {
      const img = await win.capturePage();
      fs.writeFileSync(path.join(SHOTS, `${name}.png`), img.toPNG());
    };

    await win.loadFile(index, { query: { mock: "1" } });
    await sleep(1200);
    if (!(await js(SIGN_IN))) throw new Error("sign-in did not reach the shell");
    await sleep(500);

    /* ---- 1. Overlay exclusivity, measured in the DOM -------------------- */
    // Open one, then another, by the same routes a user has: the + composer
    // button (bot composer) and Cmd-, (Settings) — the exact pair the
    // screenshot caught on screen together.
    // The route the screenshot came from: the composer "+" menu, then its
    // "New Bot" row. Two clicks, because the + opens a menu first — and that
    // menu is itself a surface the composer must dismiss.
    const openBotCreate = `(async () => {
      const plus = document.querySelector(".sand-composer__plus");
      if (!plus) return "no-plus";
      plus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const row = [...document.querySelectorAll(".sand-slash__label")]
        .filter((x) => /^new bot$/i.test((x.textContent || "").trim()))
        .map((x) => x.closest("button, li, [role='option']") || x.parentElement)[0];
      if (!row) return "no-row";
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return "clicked";
    })()`;

    out.exclusivity = {};
    // a) bot composer, then Settings.
    out.exclusivity.botCreateVia = await js(openBotCreate);
    await sleep(500);
    out.exclusivity.afterBotCreate = await js(OPEN_SURFACES);
    await shot("01-botcreate");
    await js(key(",", { metaKey: true }));
    await sleep(600);
    out.exclusivity.afterSettingsOverBotCreate = await js(OPEN_SURFACES);
    await shot("02-settings-replaces-botcreate");

    // b) Settings, then the command palette.
    await js(key("k", { metaKey: true }));
    await sleep(500);
    out.exclusivity.afterPaletteOverSettings = await js(OPEN_SURFACES);
    await shot("03-palette-replaces-settings");

    // c) Escape closes the one that is up, and nothing is left behind.
    await js(key("Escape"));
    await sleep(400);
    out.exclusivity.afterEscape = await js(OPEN_SURFACES);

    // d) A palette row that opens Settings must LEAVE Settings open — the
    //    "close the palette after running a row" line used to be a blind
    //    close of the single overlay slot.
    await js(key("k", { metaKey: true }));
    await sleep(400);
    out.exclusivity.paletteRowRan = await js(`(() => {
      const row = [...document.querySelectorAll(".hy-palette__item")].find(
        (b) => /settings/i.test(b.textContent || "")
      );
      if (!row) return false;
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    })()`);
    await sleep(600);
    out.exclusivity.afterPaletteRowOpensSettings = await js(OPEN_SURFACES);
    await js(key("Escape"));
    await sleep(400);

    // e) An in-progress composer draft must survive an overlay round trip.
    await js(`(() => {
      const el = document.querySelector(".sand-composer__input");
      if (!el) return false;
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      set.call(el, "half typed message");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(300);
    out.draftBefore = await js(`document.querySelector(".sand-composer__input").value`);
    await js(key(",", { metaKey: true }));
    await sleep(500);
    await js(key("Escape"));
    await sleep(500);
    out.draftAfter = await js(`document.querySelector(".sand-composer__input").value`);

    /* ---- 3. Glow sits with Color and Shape ------------------------------ */
    // Open the bot rail on a bot.
    await js(`(() => {
      const b = document.querySelector(".sand-header-bot__mark");
      if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    })()`);
    await sleep(600);
    const MEASURE_GLOW = `(() => {
      const fields = [...document.querySelectorAll(".bot-rail .bot-rail__field")];
      const byLabel = (t) =>
        fields.find((f) => ((f.querySelector(".bot-rail__field-label") || {}).textContent || "").trim() === t);
      const read = (name) => {
        const f = byLabel(name);
        if (!f) return null;
        const group = f.querySelector(".bot-rail__swatches");
        const btns = group ? [...group.querySelectorAll("button")] : [];
        const r0 = btns[0] ? btns[0].getBoundingClientRect() : null;
        const lab = f.querySelector(".bot-rail__field-label");
        const lcs = lab ? getComputedStyle(lab) : null;
        return {
          top: Math.round(f.getBoundingClientRect().top),
          group: !!group,
          buttons: btns.length,
          firstW: r0 ? Math.round(r0.width) : null,
          firstH: r0 ? Math.round(r0.height) : null,
          labelSize: lcs ? lcs.fontSize : null,
          labelColor: lcs ? lcs.color : null,
          pressed: btns.map((b) => b.getAttribute("aria-pressed")),
        };
      };
      return {
        color: read("Color"),
        shape: read("Shape"),
        glow: read("Glow"),
        checkboxes: document.querySelectorAll(".bot-rail__check input[type=checkbox]").length,
        glowCheckboxLabels: [...document.querySelectorAll(".bot-rail__check")].filter((l) =>
          /^glow$/i.test((l.textContent || "").trim())
        ).length,
      };
    })()`;
    out.glow = { dark: await js(MEASURE_GLOW) };
    await shot("04-botrail-glow-dark");
    // Toggling it must change the stored value AND the painted face.
    out.glowToggle = await js(`(async () => {
      const g = [...document.querySelectorAll(".bot-rail .bot-rail__field")].find(
        (f) => ((f.querySelector(".bot-rail__field-label") || {}).textContent || "").trim() === "Glow"
      );
      const btns = [...g.querySelectorAll("button")];
      const before = document.querySelectorAll(".bot-rail__blob .uf-glow-halo").length;
      btns[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      const onHalos = document.querySelectorAll(".bot-rail__blob .uf-glow-halo").length;
      btns[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      const offHalos = document.querySelectorAll(".bot-rail__blob .uf-glow-halo").length;
      return { before, onHalos, offHalos };
    })()`);
    await js(`window.hydo.setSettings({ appearance: "light" }).then(() => 1)`);
    await sleep(600);
    out.glow.light = await js(MEASURE_GLOW);
    await shot("05-botrail-glow-light");
    await js(`window.hydo.setSettings({ appearance: "dark" }).then(() => 1)`);
    await sleep(400);

    /* ---- 2. Narrow ------------------------------------------------------ */
    const MEASURE_WIDTH = `(() => {
      const r = (el) => (el ? el.getBoundingClientRect() : null);
      const box = (el) => {
        const b = r(el);
        return b ? { x: Math.round(b.x), w: Math.round(b.width), right: Math.round(b.right) } : null;
      };
      const de = document.documentElement;
      return {
        inner: window.innerWidth,
        // The one objective failure: content wider than the window, i.e. the
        // layout has stopped fitting and something is clipped or scrolled.
        overflow: de.scrollWidth - de.clientWidth,
        sidebar: box(document.querySelector(".sand-sidebar")),
        collapsed: (document.querySelector(".sand-sidebar") || {}).dataset
          ? document.querySelector(".sand-sidebar").dataset.collapsed
          : null,
        main: box(document.querySelector(".sand-main")),
        composer: box(document.querySelector(".sand-composer")),
        input: box(document.querySelector(".sand-composer__input")),
        rail: box(document.querySelector(".bot-rail")),
        titlebar: box(document.querySelector(".sand-titlebar")),
        bubble: box(document.querySelector(".sand-msg, .hy-msg, .sand-bubble")),
      };
    })()`;

    const MEASURE_MODAL = `(() => {
      const de = document.documentElement;
      const card = document.querySelector(".hy-dialog__card, .hy-palette__card");
      const r = card ? card.getBoundingClientRect() : null;
      const nav = document.querySelector(".hy-dialog__nav");
      const panel = document.querySelector(".settings__panel");
      const head = document.querySelector(".settings__head");
      return {
        open: !!card,
        navW: nav ? Math.round(nav.getBoundingClientRect().width) : null,
        navLabelShown: nav ? getComputedStyle(nav.querySelector("button > span")).display !== "none" : null,
        panelW: panel ? Math.round(panel.getBoundingClientRect().width) : null,
        // Text wider than the box it sits in is the clipping the 198px nav
        // caused. Measured, not eyeballed.
        headClipped: head ? head.scrollWidth > head.clientWidth + 1 : null,
        overflow: de.scrollWidth - de.clientWidth,
        cardW: r ? Math.round(r.width) : null,
        cardX: r ? Math.round(r.x) : null,
        cardRight: r ? Math.round(r.right) : null,
        inner: window.innerWidth,
      };
    })()`;

    out.widths = {};
    const WIDTHS = [980, 900, 800, 700, 600, 520, 480, 440, 400, 360, 320];
    for (const w of WIDTHS) {
      win.setBounds({ width: w, height: 900 });
      await sleep(500);
      const noRail = await js(MEASURE_WIDTH);
      await shot(`w-${w}-norail`);
      // And with the widest right-hand pane open, which is the real floor.
      await js(`(() => {
        const b = document.querySelector(".sand-header-bot__mark");
        if (b) b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      })()`);
      await sleep(450);
      const withRail = await js(MEASURE_WIDTH);
      await shot(`w-${w}-rail`);
      await js(key("Escape"));
      await sleep(300);
      // The two biggest modals, at the same width: a dialog with its own nav
      // rail is the other thing that can stop fitting.
      await js(key(",", { metaKey: true }));
      await sleep(550);
      const settings = await js(MEASURE_MODAL);
      if (w <= 600) await shot(`w-${w}-settings`);
      await js(key("Escape"));
      await sleep(300);
      await js(key("k", { metaKey: true }));
      await sleep(450);
      const palette = await js(MEASURE_MODAL);
      await js(key("Escape"));
      await sleep(300);
      out.widths[w] = { noRail, withRail, settings, palette };
    }

    win.setBounds({ width: 600, height: 900 });
    await sleep(500);
    await js(`window.hydo.setSettings({ appearance: "light" }).then(() => 1)`);
    await sleep(500);
    await shot("w-600-light");
    out.widths.light600 = await js(MEASURE_WIDTH);

    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify({ widths: out.widths, exclusivity: out.exclusivity }, null, 2));
  } catch (err) {
    console.error(`overlay-narrow-glow-shot failed — ${(err && err.stack) || err}`);
    code = 1;
  } finally {
    app.exit(code);
  }
});

process.on("uncaughtException", (e) => {
  console.error(`overlay-narrow-glow-shot crashed — ${e && e.message}`);
  app.exit(1);
});
