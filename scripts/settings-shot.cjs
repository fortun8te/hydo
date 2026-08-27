"use strict";

/**
 * Open the real Settings dialog in a real BrowserWindow, MEASURE it, and
 * photograph it in both themes.
 *
 * scripts/shot.cjs photographs the shell but cannot reach a dialog, and every
 * other suite in this repo asserts on source text — which cannot see a
 * specificity fight. This session already lost one (`.hy-dialog button` at
 * (0,1,1) beating `.settings__seg-btn` at (0,1,0)), so the group layout is
 * checked by reading getBoundingClientRect from the live document, not by
 * trusting the stylesheet.
 *
 *   npx electron scripts/settings-shot.cjs <pane> <out-prefix>
 *
 * Same safety choice as shot.cjs: `?mock=1` and NO preload, so `window.hydo`
 * is src/lib/devmock.js and main.cjs — which owns the real roster — is never
 * loaded.
 *
 * Unlike shot.cjs it loads a BUILT bundle over file:// rather than a vite dev
 * server over http. Measured, not assumed: in a sandboxed agent shell
 * Electron's network service cannot come up (`mach_port_rendezvous ... Unknown
 * service name`) and every http load fails with ERR_FAILED, while file:// is
 * fine. The build is `--mode development` into a temp outDir precisely because
 * devmock is gated on `import.meta.env.DEV`; the real dist/ is never touched.
 * Always exits.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow } = require("electron");

const OUTDIR = path.join(os.tmpdir(), "hydo-settings-shot-dist");
const PANE = process.argv[2] || "updates";
const PREFIX = process.argv[3] || `/tmp/hydo-settings-${PANE}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The fixture bundle, which must already exist.
 *
 * It is built by the caller, NOT here. Measured the hard way: running the vite
 * build with execFileSync from inside the Electron main process leaves the
 * process unable to start its network service afterwards
 * (`mach_port_rendezvous ... Permission denied`) and every subsequent load —
 * file:// included — dies with ERR_FAILED. So the build happens in a plain
 * node process first; see scripts/settings-groups-test.cjs.
 */
function fixtureIndex() {
  const index = path.join(OUTDIR, "index.html");
  if (!fs.existsSync(index)) {
    throw new Error(`no fixture bundle at ${index} — build it first (see scripts/settings-groups-test.cjs)`);
  }
  return index;
}

// Open Settings by clicking what a person clicks. Driving it through React
// state would prove nothing about whether the control is reachable.
const OPEN = (pane) => `(async () => {
  // The mock starts signed out, so the shell does not exist yet.
  const signIn = [...document.querySelectorAll("button")].find((b) => /sign in/i.test(b.textContent || ""));
  if (signIn) {
    signIn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (!document.querySelector(".hy-dialog")) {
    // ⌘, — the real shortcut, through Shell's real keydown handler. The
    // sidebar's own Settings item lives behind a menu, and this proves the
    // binding works at the same time.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: ",", code: "Comma", metaKey: true, bubbles: true })
    );
  }
  await new Promise((r) => setTimeout(r, 600));
  const nav = [...document.querySelectorAll(".hy-dialog button, .hy-dialog [role=tab]")].find(
    (b) => (b.textContent || "").trim().toLowerCase() === ${JSON.stringify(pane)}
  );
  if (nav) nav.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  return document.querySelector(".hy-dialog") ? "open" : "no dialog";
})()`;

// The measurement. Everything returned here is read off the layout.
const MEASURE = `(() => {
  const body = document.querySelector(".settings__body");
  if (!body) return { error: "no .settings__body" };
  const sections = [...body.querySelectorAll(".settings__section")];
  const groups = sections.map((sec) => {
    const label = sec.querySelector(".hy-section-label");
    const group = sec.querySelector(".hy-row-group");
    const rows = group ? [...group.querySelectorAll(":scope > .hy-row")] : [];
    const gr = group && group.getBoundingClientRect();
    return {
      label: label ? label.textContent.trim() : null,
      labelBottom: label ? label.getBoundingClientRect().bottom : null,
      groupTop: gr ? gr.top : null,
      groupBottom: gr ? gr.bottom : null,
      radius: group ? parseFloat(getComputedStyle(group).borderTopLeftRadius) : null,
      rows: rows.map((r) => {
        const d = r.querySelector(":scope > .hy-row__divider");
        const rr = r.getBoundingClientRect();
        return {
          text: (r.querySelector(".hy-row__label") || {}).textContent || "",
          top: rr.top,
          bottom: rr.bottom,
          divider: d ? d.getBoundingClientRect().top : null,
          dividerColor: d ? getComputedStyle(d).backgroundColor : null,
        };
      }),
      controls: [...sec.querySelectorAll("button, [role=button]")].map((b) => ({
        text: (b.textContent || "").trim(),
        disabled: !!b.disabled,
        w: b.getBoundingClientRect().width,
        h: b.getBoundingClientRect().height,
      })),
    };
  });
  return { groups, note: (body.querySelector(".settings__note") || {}).textContent || null };
})()`;

app.whenReady().then(async () => {
  let code = 0;
  try {
    const index = fixtureIndex();
    const out = {};
    // ONE window, reloaded per theme. Destroying it between themes takes the
    // last window with it, and the next loadFile then dies with ERR_FAILED
    // (the network service is already tearing down) — measured, twice.
    let shared = null;
    for (const theme of ["dark", "light"]) {
      const win = shared || (shared = new BrowserWindow({ width: 1240, height: 900, show: false }));
      await win.loadFile(index, { query: { mock: "1" } });
      await sleep(3200);
      // Set the theme the way the app does: through the setting. Stamping
      // data-theme on <html> by hand tests the stylesheet, not the app — and
      // it silently produced two IDENTICAL "themes" the first time.
      await win.webContents.executeJavaScript(
        `window.hydo.setSettings({ appearance: ${JSON.stringify(theme)} }).then(() => 1)`
      );
      await sleep(600);
      const opened = await win.webContents.executeJavaScript(OPEN(PANE));
      if (opened !== "open") throw new Error(`could not open Settings: ${opened}`);
      await sleep(500);
      const seen = await win.webContents.executeJavaScript(`document.documentElement.dataset.theme`);
      if (seen !== (theme === "dark" ? "cursor-dark" : "cursor-light")) {
        throw new Error(`theme did not apply: <html data-theme> is ${seen}`);
      }
      out[theme] = await win.webContents.executeJavaScript(MEASURE);
      const png = (await win.webContents.capturePage()).toPNG();
      if (png.length < 5000) throw new Error("blank frame");
      fs.writeFileSync(`${PREFIX}-${theme}.png`, png);
    }
    // Written to a file, not just stdout: scripts/settings-groups-test.cjs
    // reads this back and asserts on it, and mixing JSON with a human log line
    // on one stream is how that parse breaks.
    fs.writeFileSync(`${PREFIX}.json`, `${JSON.stringify(out, null, 2)}\n`);
    console.log(JSON.stringify(out, null, 2));
    console.log(`shot ok — ${PREFIX}-{dark,light}.png, ${PREFIX}.json`);
  } catch (err) {
    console.error(`settings-shot failed — ${(err && err.message) || err}`);
    code = 1;
  } finally {
    app.exit(code);
  }
});

process.on("uncaughtException", (e) => {
  console.error(`settings-shot crashed — ${e && e.message}`);
  app.exit(1);
});
