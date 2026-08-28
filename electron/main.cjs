const { app, BrowserWindow, ipcMain, shell, Notification, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createStore } = require("./store.cjs");
const gateway = require("./hermes-gateway.cjs");
const plugins = require("./hermes-plugins.cjs");
const boxRuntime = require("./box-runtime.cjs");
const localProviders = require("./local-providers.cjs");
const crypto = require("node:crypto");
const buildInfo = require("./build-info.cjs");

// One rebuild at a time. Two concurrent `npm run pack` runs share one dist/
// directory and would race each other into a corrupt bundle.
let rebuilding = false;

/**
 * The sidebar ticker's answer, computed at most once per launch.
 *
 * Null means "not asked yet", never "no update" - the two must not collapse,
 * because the renderer draws nothing for one and would draw a stale nothing
 * for the other. hydo:updateStatus fills it; hydo:checkBuild overwrites it.
 */
let updateCache = null;

/**
 * Turn a buildInfo/check pair into the one boolean the sidebar is allowed to
 * act on, plus the numbers it renders.
 *
 * `available` is deliberately narrow: state "behind" AND a positive commit
 * count. Everything else - "current", "dirty", "dev", and above all "unknown"
 * (no repo on this machine, a packaged app copied to another laptop, history
 * rewritten under the stamped sha) - is NOT available and shows nothing.
 *
 * That asymmetry is the rule this whole feature lives under: a badge for an
 * update that does not exist is a confident wrong status, which this codebase
 * treats as a bug. Silence is always an available correct answer here.
 */
function statusFrom(info, check) {
  const c = check || {};
  const behind = Number(c.behind) || 0;
  const stale = Number(c.stale) || 0;
  return {
    // Two ways an installed build can genuinely be out of date, and only one
    // of them was ever reported. "behind" is commits it does not have;
    // "stale" is source edited since it was built, which is the common case
    // here and was invisible against HEAD. Everything else -- "current",
    // "dirty", "dev", and above all "unknown" -- still shows nothing, because
    // a badge for an update that does not exist is a confident wrong status.
    available: (c.state === "behind" && behind > 0) || (c.state === "stale" && stale > 0),
    behind,
    stale,
    state: c.state || "unknown",
    channel: (info && info.channel) || "dev",
  };
}

// Every Hermes-backed handler below degrades to a truthful empty answer rather
// than rejecting into the renderer: `available()` false must leave the app
// usable, not throw dialogs at someone who simply has not installed Hermes.
const ok = (value) => ({ ok: true, ...value });
const nope = (reason) => ({ ok: false, reason });

const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";

/**
 * Be Hydo, not Electron.
 *
 * Unpackaged, Electron takes the app name from its OWN bundle for the menu
 * bar and the Dock, so both said "Electron" and the About item said "About
 * Electron".
 *
 * userData was already correct . Electron resolves that from package.json's
 * `name`, which is "hydo", so state.json and every bot workspace already live
 * in ~/Library/Application Support/Hydo. The explicit setPath is therefore not
 * a move, it is a PIN: setName changes what the path would resolve to, and on
 * a case-sensitive volume "hydo" and "Hydo" are two different directories.
 * Naming it outright means renaming the app can never silently orphan
 * somebody's teammates.
 *
 * Both must run before `whenReady`: userData is cached on first access.
 */
app.setName("Hydo");
app.setAppUserModelId("com.hydo.app");
try {
  // One env override, for verification only.
  //
  // The pin below is deliberate and stays the default. But with NO way around
  // it, `npm run smoke`, `npm run app` and a bare `electron .` all read and
  // write the user's REAL roster — so any automated check that boots the app
  // is one bad write away from the thing it was meant to protect. A teammate
  // asked to verify its own UI change would have had no safe way to do it.
  //
  // Explicit and absolute only: a relative path would resolve against whatever
  // cwd the caller happened to have, which is how a "temp" dir ends up inside
  // someone's home. Anything unusable falls through to the pin rather than
  // guessing.
  const override = String(process.env.HYDO_USER_DATA || "").trim();
  if (override && path.isAbsolute(override)) {
    fs.mkdirSync(override, { recursive: true });
    app.setPath("userData", override);
  } else {
    app.setPath("userData", path.join(app.getPath("appData"), "Hydo"));
  }
} catch {
  /* already resolved: keep whatever it picked rather than crash on boot */
}

/**
 * Say whether the GPU is actually doing the work.
 *
 * Electron enables hardware acceleration by default, so it is tempting to
 * assume and move on . which is what I did until I measured it. It can also
 * fall back to software silently: a driver blocklist, a remote session, a
 * VM. This app animates SVG faces on a rAF loop, so a silent fallback to
 * software compositing is the difference between smooth and visibly bad, with
 * nothing anywhere saying why.
 *
 * Read AFTER a window exists. Queried before that it reports
 * `disabled_software` for everything regardless of the truth, which is a
 * convincing way to misdiagnose a machine that is perfectly fine.
 */
function logGpu() {
  try {
    const s = app.getGPUFeatureStatus() || {};
    const soft = ["gpu_compositing", "rasterization"].filter(
      (k) => s[k] && !String(s[k]).startsWith("enabled")
    );
    if (soft.length) {
      console.warn(`[hydo] software rendering: ${soft.map((k) => `${k}=${s[k]}`).join(", ")}`);
    }
  } catch {
    /* never worth failing to launch over */
  }
}

/** The Dock icon, which a packaged .app gets from its bundle and dev does not. */
function brandDock() {
  if (process.platform !== "darwin" || !app.dock) return;
  const icon = path.join(__dirname, "..", "build", "icon-512.png");
  try {
    if (fs.existsSync(icon)) app.dock.setIcon(icon);
  } catch {
    /* a missing raster is not worth failing to launch over */
  }
}

/**
 * Where the window was last time.
 *
 * Every launch opened at exactly 1280x860 in the OS default position, so
 * resizing the app was a thing you did once per session, forever. Kept beside
 * the store rather than inside it: window geometry is a property of this
 * machine's screen, not of the user's teammates, and state.json is already
 * re-serialised on every save.
 *
 * Restored defensively. A saved rect can name a monitor that is no longer
 * plugged in, and a window placed on a display that does not exist is a window
 * you cannot reach — so the rect has to intersect a CURRENT display, or it is
 * discarded and the default used.
 */
const WINDOW_STATE_FILE = () => path.join(app.getPath("userData"), "window.json");

function loadWindowState() {
  try {
    const raw = JSON.parse(fs.readFileSync(WINDOW_STATE_FILE(), "utf8"));
    const { x, y, width, height } = raw || {};
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    // Must match the BrowserWindow floor below, or a legitimately narrow
    // saved window is thrown away and the app reopens at 1280 every launch.
    if (width < 400 || height < 640) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { width, height };
    const onScreen = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      // Its title bar has to be grabbable, not merely some pixel of it visible.
      return x + width > b.x + 80 && x < b.x + b.width - 80 && y >= b.y - 8 && y < b.y + b.height - 40;
    });
    return onScreen ? { x, y, width, height } : { width, height };
  } catch {
    return null;
  }
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    // getNormalBounds, not getBounds: saving the FULLSCREEN rect means the next
    // launch opens a window the size of the display with no way back.
    const b = win.getNormalBounds();
    fs.writeFileSync(WINDOW_STATE_FILE(), JSON.stringify(b));
  } catch {
    /* geometry is a convenience; never let it break a quit */
  }
}



/**
 * Which paths the RENDERER is allowed to name.
 *
 * `hydo:previewFile` read any path it was handed, and `hydo:saveFile` copied
 * any path out. The renderer is sandboxed, but it renders artifacts a model
 * wrote, so "the renderer asked for it" is not the same as "the user asked for
 * it" -- and `~/.ssh/id_rsa` is as valid an argument as an attachment.
 *
 * Two things legitimately name a path:
 *
 *   1. Hydo's own directories -- bot workspaces, the store, artifacts. Bounded
 *      and known.
 *   2. A file the USER chose in the native picker. That dialog IS the consent,
 *      so those paths are remembered here and allowed once granted; without
 *      this, gating would break every attachment of a file living anywhere
 *      else, which is most of them.
 *
 * Anything else is refused. This is defence in depth rather than a wall: a
 * teammate with shell tools can read files directly. What it removes is the
 * path where content Hydo RENDERS can turn into content Hydo READS.
 */
const pickedPaths = new Set();
function rememberPicked(p) {
  const abs = path.resolve(String(p || ""));
  if (!abs) return;
  // Bounded: this is a session-lifetime set fed by a human clicking a dialog,
  // but it should still not grow without limit.
  if (pickedPaths.size > 500) pickedPaths.delete(pickedPaths.values().next().value);
  pickedPaths.add(abs);
}
function allowedRoots() {
  const roots = [];
  try {
    roots.push(app.getPath("userData"));
  } catch {
    /* not ready yet */
  }
  const home = process.env.HYDO_USER_DATA;
  if (home) roots.push(path.resolve(home));
  return roots.filter(Boolean).map((r) => path.resolve(r));
}
/** @returns {boolean} whether the renderer may name this path. */
function pathAllowed(p) {
  const abs = path.resolve(String(p || ""));
  if (!abs) return false;
  if (pickedPaths.has(abs)) return true;
  return allowedRoots().some((root) => abs === root || abs.startsWith(root + path.sep));
}

/**
 * Is this the app itself, rather than somewhere the app was pushed to?
 *
 * Packaged builds load the bundle over file://; `npm run dev` loads it from
 * the Vite dev server on localhost. Nothing else is Hydo.
 */
function isAppUrl(url) {
  const raw = String(url || "");
  if (!raw) return false;
  if (raw.startsWith("file://")) return true;
  try {
    const u = new URL(raw);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function createWindow() {
  const saved = loadWindowState();
  const win = new BrowserWindow({
    ...(saved || {}),
    width: (saved && saved.width) || 1280,
    height: (saved && saved.height) || 860,
    /* 980 forbade a narrow window outright: half a 1440 screen is 720, and the
       app simply refused. What 980 was really holding up was the RIGHT-HAND
       RAIL, a fixed 320px column that did not shrink — measured in a real
       window at 440px, `.sand-main` came out 48px wide and the composer input
       0px, i.e. the message box was gone. That is fixed in CSS, not by this
       number: below 880 (the same breakpoint the roster already collapses at)
       the rail lays itself over the transcript instead of pushing it out
       (src/screens/rails.css), and the Settings nav drops its labels for its
       icons under 720 (src/kit/ui.css).

       400 is measured, not chosen: scripts/overlay-narrow-glow-shot.cjs drives
       a real window down to 320px and asserts zero horizontal overflow, a
       full-width transcript with the rail open, and an unclipped Settings
       body at every step. 400 is the last width where the composer input is
       still ~192px — wide enough to be a message box rather than a slot. */
    minWidth: 400,
    minHeight: 640,
    title: "Hydo",
    // Windows and Linux take the window icon from here. macOS reads it from
    // the .app bundle instead, so in `npm run app` the Dock still shows
    // Electron's default . that is the packaged icon's job, not this one's.
    icon: path.join(__dirname, "..", "build", "icon-512.png"),
    backgroundColor: "#070707",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Debounced: a drag fires these continuously, and each one is a disk write.
  let geomTimer = null;
  const remember = () => {
    clearTimeout(geomTimer);
    geomTimer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on("resize", remember);
  win.on("move", remember);
  // And once more synchronously on close, because the debounce may not have
  // fired yet when the user resizes and immediately quits.
  win.on("close", () => {
    clearTimeout(geomTimer);
    saveWindowState(win);
  });

  // Same scheme gate as the `hydo:openExternal` IPC, for the same reason: the
  // URL can come from an artifact a model wrote, and `shell.openExternal`
  // hands file:// and custom schemes straight to the OS to open with whatever
  // is registered for them. This handler had no gate while the IPC beside it
  // did, so `window.open` was the way around the check.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(String(url || ""))) shell.openExternal(url);
    return { action: "deny" };
  });
  // The app window renders the app and nothing else. Without this, anything
  // that can set `location` — injected artifact content included — replaces
  // the whole renderer with a remote page that still sits behind the preload
  // bridge. Only the app's own origin (file:// in a package, the Vite dev
  // server otherwise) may load here; everything else is refused and, if it is
  // a normal web link, opened in the real browser instead.
  win.webContents.on("will-navigate", (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(String(url || ""))) shell.openExternal(url);
  });
  win.webContents.on("will-attach-webview", (e) => {
    // Hydo has no <webview>. One appearing means content wrote it.
    e.preventDefault();
  });
  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.log(`[fail-load] ${code} ${desc} ${url}`);
  });

  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(1);
    // Only meaningful once something has been painted.
    logGpu();
  });

  const distIndex = path.join(__dirname, "../dist/index.html");
  if (app.isPackaged || process.env.HYDO_DIST === "1") {
    win.loadFile(distIndex);
  } else {
    let fellBack = false;
    win.loadURL(DEV_URL);
    win.webContents.on("did-fail-load", () => {
      if (fellBack || app.isPackaged) return;
      if (!fs.existsSync(distIndex)) return;
      fellBack = true;
      win.loadFile(distIndex);
    });
  }
  return win;
}

// The store lives inside whenReady(), but the quit handlers below are at
// module scope and fire before/after it. They need a reference that exists
// either way, so the store publishes itself here on creation. Without this,
// `store.flush()` in `will-quit` threw ReferenceError and took the app down.
let liveStore = null;
/**
 * The box runtime, published out of whenReady() for the same reason liveStore
 * is: the quit and signal handlers below are at module scope and fire outside
 * it. Without a reference here, the only code that knows how to stop the
 * machine is unreachable from the only place that knows the app is ending.
 */
let liveBoxes = null;

/**
 * One Hydo, however many times you launch it.
 *
 * Every instance starts its OWN Hermes gateway, and every teammate in it is a
 * python child of that gateway. So a second launch is not a second window, it
 * is a second copy of the whole tree: measured on this machine, one live app
 * was holding five children while a long-running Hermes desktop next to it held
 * seventy-five, at 0.8 GB. Stacking those is how you end up with a laptop full
 * of agents nobody is talking to.
 *
 * The second launch hands its argv to the first and exits, so double-clicking
 * the app in the Dock raises the window you already have instead of building a
 * new one beside it.
 */
// The smoke test boots this same file to check the real app comes up, so it
// must be allowed a second instance — otherwise the lock below quits it before
// it prints anything, and it exits 0. That is what happened: adding the lock
// turned `npm run smoke` into a no-op that reported success whenever the app
// was open, which is every time anyone would think to run it.
const SMOKE = process.env.HYDO_SMOKE === "1";

if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

app.whenReady().then(() => {
  brandDock();
  let push = () => {};
  let win;

  const store = createStore({
    dir: app.getPath("userData"),
    onChange: () => push(),
    // The store decided this message is worth a toast (speaker has
    // notifications on, user is looking elsewhere). All that is left is
    // whether the OS will show one, and what a click should do.
    onNotify: ({ conversationId, title, body }) => {
      if (!Notification.isSupported()) return;
      // Focused window means the user is right here — a toast would be noise.
      if (win && win.isFocused()) return;
      const n = new Notification({ title, body, silent: false });
      n.on("click", () => {
        store.select(conversationId);
        push();
        if (win) {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
      });
      n.show();
    },
  });
  liveStore = store;
  win = createWindow();
  const mcpImport = require("./mcp-import.cjs");
  mcpImport.sync(gateway).catch((err) => {
    console.log(`[mcp-import] ${err.message}`);
  });

  /**
   * The user's avatar, kept OUT of the state that streams to the renderer.
   *
   * MEASURED on this machine: state.json was 127,924 bytes, of which the
   * avatar was 127,534 -- 99.7% of it. That whole payload was JSON-cloned by
   * `publicState()` AND structured-cloned across IPC on every push, and the
   * streaming path pushes about ten times a second while a reply comes in. So
   * the app spent most of its per-token budget copying a picture that had not
   * changed since the user chose it.
   *
   * The renderer still receives a plain data URI: the swap is undone in
   * preload.cjs, which fetches the bytes once per distinct avatar and caches
   * them. Nothing in src/ knows this happens.
   */
  const avatarStash = new Map(); // token -> data URI
  const avatarToken = (uri) => {
    const s = String(uri || "");
    if (!s) return "";
    const token = `hydo-avatar:${crypto.createHash("sha1").update(s).digest("hex").slice(0, 16)}`;
    if (!avatarStash.has(token)) {
      // One entry per distinct image. Bounded, because an unbounded cache of
      // 128KB strings is the leak this function exists to avoid.
      if (avatarStash.size > 8) avatarStash.delete(avatarStash.keys().next().value);
      avatarStash.set(token, s);
    }
    return token;
  };
  /** State as the renderer sees it: identical, minus the avatar bytes. */
  const lightState = () => {
    const st = store.getState();
    const uri = st && st.settings && st.settings.userAvatar;
    if (!uri || String(uri).startsWith("hydo-avatar:")) return st;
    return { ...st, settings: { ...st.settings, userAvatar: avatarToken(uri) } };
  };

  push = () => {
    win?.webContents.send("hydo:state", lightState());
  };

  ipcMain.handle("hydo:avatarData", (_e, token) => avatarStash.get(String(token || "")) || "");
  ipcMain.handle("hydo:getState", () => lightState());
  ipcMain.handle("hydo:signIn", () => {
    const next = store.signIn();
    push();
    return next;
  });
  ipcMain.handle("hydo:signOut", () => {
    const next = store.signOut();
    push();
    return next;
  });
  ipcMain.handle("hydo:select", (_e, id) => {
    const next = store.select(id);
    push();
    return next;
  });
  ipcMain.handle("hydo:createAgent", (_e, patch) => {
    const next = store.createAgent(patch || {});
    push();
    const id = next.selectedId;
    // landNewBot is a real Hermes turn now, so it is awaited and pushed when
    // it lands rather than fired and forgotten. The bot keeps spinning until
    // its own opening bubble is in the thread.
    setTimeout(() => {
      Promise.resolve(store.landNewBot(id))
        .catch(() => {})
        .finally(push);
    }, 400);
    return next;
  });
  ipcMain.handle("hydo:deleteAgent", async (_e, id) => {
    const next = await store.deleteAgent(id);
    push();
    return next;
  });
  ipcMain.handle("hydo:setSettings", (_e, patch) => {
    const next = store.setSettings(patch);
    push();
    return next;
  });
  ipcMain.handle("hydo:setAgent", (_e, id, patch) => {
    const next = store.setAgent(id, patch);
    push();
    return next;
  });
  ipcMain.handle("hydo:send", async (_e, text, opts) => {
    const next = await store.send(text, opts || {});
    push();
    return next;
  });
  ipcMain.handle("hydo:setDraft", (_e, id, draft) => {
    const next = store.setDraft(id, draft);
    push();
    return next;
  });
  ipcMain.handle("hydo:createRoutine", (_e, patch) => {
    const next = store.createRoutine(patch);
    push();
    return next;
  });
  ipcMain.handle("hydo:setRoutine", (_e, id, patch) => {
    const next = store.setRoutine(id, patch);
    push();
    return next;
  });
  ipcMain.handle("hydo:deleteRoutine", (_e, id) => {
    const next = store.deleteRoutine(id);
    push();
    return next;
  });
  ipcMain.handle("hydo:runRoutine", async (_e, id) => {
    const next = await store.runRoutine(id);
    push();
    return next;
  });
  ipcMain.handle("hydo:choose", async (_e, messageId, choiceId) => {
    const next = await store.choose(messageId, choiceId);
    push();
    return next;
  });
  ipcMain.handle("hydo:chooseCustom", async (_e, messageId, text) => {
    const next = await store.chooseCustom(messageId, text);
    push();
    return next;
  });
  ipcMain.handle("hydo:answerApproval", async (_e, messageId, choice) => {
    const next = await store.answerApproval(messageId, choice);
    push();
    return next;
  });
  ipcMain.handle("hydo:answerClarify", async (_e, messageId, answer) => {
    const next = await store.answerClarify(messageId, answer);
    push();
    return next;
  });
  ipcMain.handle("hydo:answerGate", async (_e, messageId, value) => {
    const next = await store.answerGate(messageId, value);
    push();
    return next;
  });
  ipcMain.handle("hydo:previewZip", (_e, filePath) => {
    const { listZip } = require("./zip-list.cjs");
    return listZip(filePath);
  });
  ipcMain.handle("hydo:previewFile", (_e, filePath) => {
    if (!pathAllowed(filePath)) return { ok: false, reason: "blocked-path" };
    const { previewFile } = require("./file-preview.cjs");
    return previewFile(filePath);
  });
  ipcMain.handle("hydo:saveFile", async (e, filePath, name) => {
    if (!pathAllowed(filePath)) return { ok: false, reason: "blocked-path" };
    const abs = path.resolve(String(filePath || ""));
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return { ok: false, reason: "missing" };
    }
    const { dialog, BrowserWindow } = require("electron");
    const win = BrowserWindow.fromWebContents(e.sender);
    const pick = await dialog.showSaveDialog(win, {
      defaultPath: String(name || path.basename(abs)),
    });
    if (pick.canceled || !pick.filePath) return { ok: false, canceled: true };
    fs.copyFileSync(abs, pick.filePath);
    return { ok: true, path: pick.filePath };
  });
  ipcMain.handle("hydo:interrupt", async (_e, agentId) => {
    const next = await store.interrupt(agentId);
    push();
    return next;
  });
  ipcMain.handle("hydo:openWorkspace", async (_e, agentId) => {
    const cwd = store.workspacePath(agentId);
    if (!cwd) return { ok: false, reason: "no workspace" };
    try {
      fs.mkdirSync(cwd, { recursive: true });
    } catch {
      /* openPath still tries */
    }
    const err = await shell.openPath(cwd);
    return err ? { ok: false, reason: err } : { ok: true, path: cwd };
  });
  ipcMain.handle("hydo:createChannel", (_e, patch) => {
    const next = store.createChannel(patch);
    push();
    return next;
  });
  ipcMain.handle("hydo:setChannel", (_e, id, patch) => {
    const next = store.setChannel(id, patch);
    push();
    return next;
  });
  ipcMain.handle("hydo:toggleChannelMember", (_e, channelId, agentId) => {
    const next = store.toggleChannelMember(channelId, agentId);
    push();
    return next;
  });
  ipcMain.handle("hydo:deleteChannel", (_e, id) => {
    const next = store.deleteChannel(id);
    push();
    return next;
  });

  // ── Reactions ──────────────────────────────────────────────────────────
  ipcMain.handle("hydo:react", async (_e, messageId, emoji) => {
    const next = await store.react(messageId, emoji);
    push();
    return next;
  });

  // ── Roster ─────────────────────────────────────────────────────────────
  ipcMain.handle("hydo:setPinned", (_e, id, pinned) => {
    const next = store.setPinned(id, pinned);
    push();
    return next;
  });
  ipcMain.handle("hydo:setUnread", (_e, id, unread) => {
    const next = store.setUnread(id, unread);
    push();
    return next;
  });
  ipcMain.handle("hydo:setHidden", (_e, id, hidden) => {
    const next = store.setHidden(id, hidden);
    push();
    return next;
  });
  ipcMain.handle("hydo:createSection", (_e, patch) => {
    const next = store.createSection(patch || {});
    push();
    return next;
  });
  ipcMain.handle("hydo:renameSection", (_e, id, name) => {
    const next = store.renameSection(id, name);
    push();
    return next;
  });
  ipcMain.handle("hydo:deleteSection", (_e, id) => {
    const next = store.deleteSection(id);
    push();
    return next;
  });
  ipcMain.handle("hydo:moveToSection", (_e, ids, sectionId) => {
    const next = store.moveToSection(ids, sectionId);
    push();
    return next;
  });
  ipcMain.handle("hydo:deleteEntries", async (_e, ids) => {
    const next = await store.deleteEntries(ids);
    push();
    return next;
  });
  ipcMain.handle("hydo:duplicateAgent", (_e, id) => {
    const next = store.duplicateAgent(id);
    push();
    return next;
  });

  // ── Steering (talk to a teammate mid-turn, without cancelling it) ──────
  ipcMain.handle("hydo:steer", async (_e, agentId, text) => {
    const next = await store.steer(agentId, text);
    push();
    return next;
  });

  // ── Usage & billing (real numbers, not a hardcoded percentage) ─────────
  ipcMain.handle("hydo:usage", (_e, agentId) => store.usage(agentId));

  // ── Model picker ───────────────────────────────────────────────────────
  ipcMain.handle("hydo:listModels", async (_e, agentId, opts) => {
    if (!gateway.available()) return nope("Hermes is not installed");
    const payload = await gateway.modelOptions(agentId, opts || {});
    return payload ? ok({ ...payload }) : nope("model.options unavailable");
  });

  // ── Local / self-hosted endpoints (~/.hermes/config.yaml `providers:`) ──
  // These are not in `model.options` as anything you can tell apart from the
  // forty hosted providers, and a local server that is off looks exactly like
  // a broken model once a turn fails. So: list them, and probe them, from the
  // main process — the api_key is read inside local-providers.cjs and never
  // crosses this boundary. See docs/LOCAL-MODEL.md.
  ipcMain.handle("hydo:localProviders", () => ok({ providers: localProviders.list() }));
  // The shelf this endpoint holds, not just the one line in config.yaml.
  ipcMain.handle("hydo:localModels", async (_e, id) => {
    const found = localProviders.list().find((p) => p.id === id);
    if (!found) return nope("No such provider in ~/.hermes/config.yaml");
    const res = await localProviders.models(found, { key: localProviders.keyFor(found.id) });
    return res.ok ? ok({ id: found.id, models: res.models }) : nope(res.reason);
  });

  ipcMain.handle("hydo:probeLocalProvider", async (_e, id) => {
    const found = localProviders.list().find((p) => p.id === id);
    if (!found) return nope("No such provider in ~/.hermes/config.yaml");
    const status = await localProviders.probe(found, { key: localProviders.keyFor(found.id) });
    return ok({ id: found.id, host: found.host, status });
  });

  // ── Hermes-side transcript (the real one, beyond Hydo's state.json) ────
  ipcMain.handle("hydo:history", (_e, agentId) => gateway.history(agentId));
  ipcMain.handle("hydo:listSessions", (_e, o) => gateway.listSessions(o || {}));
  ipcMain.handle("hydo:resumeSession", async (_e, agentId, sessionId, o) => {
    if (!gateway.available()) return nope("Hermes is not installed");
    try {
      return ok({ session: await gateway.resume(agentId, sessionId, o || {}) });
    } catch (err) {
      return nope(err.message);
    }
  });

  // ── Attachments ────────────────────────────────────────────────────────
  const attach = (name, fn) =>
    ipcMain.handle(name, async (_e, ...args) => {
      if (!gateway.available()) return nope("Hermes is not installed");
      try {
        return ok({ result: await fn(...args) });
      } catch (err) {
        return nope(err.message);
      }
    });
  // Same gate as previewFile/saveFile: a path the renderer names must be one
  // Hydo owns or one the user picked. `attachImageBytes` carries bytes, not a
  // path, so it is deliberately not gated here.
  const attachPath = (name, fn) =>
    attach(name, (id, p, ...rest) => {
      if (!pathAllowed(p)) throw new Error("blocked-path");
      return fn(id, p, ...rest);
    });
  attachPath("hydo:attachFile", (id, p, o) => gateway.attachFile(id, p, o || {}));
  attachPath("hydo:attachImage", (id, p) => gateway.attachImage(id, p));
  attach("hydo:attachImageBytes", (id, b64, o) => gateway.attachImageBytes(id, b64, o || {}));
  attachPath("hydo:attachPdf", (id, p, o) => gateway.attachPdf(id, p, o || {}));
  attach("hydo:pasteClipboard", (id) => gateway.pasteClipboard(id));
  attach("hydo:detachImage", (id, p) => gateway.detachImage(id, p));

  // Hermes' learning store is deliberately NOT on the renderer bridge.
  //
  // Same defect as `hydo:cron` below, and worse in one respect. `learning.*`
  // goes to the LAUNCH gateway -- the user's own ~/.hermes -- not to any
  // teammate's profile, because `request()` without a pin resolves the default
  // profile. Nothing in src/ called these, and two of the four were WRITES:
  // the renderer could edit and delete the user's personal learning store
  // under no teammate's name.
  //
  // Re-exposing them needs the RPC to take a `profile` param first (see
  // docs/HERMES-GAPS.md); until then the honest surface is none. The
  // `gateway.learning*` functions remain for main-side use.

  // Hermes' cron store is deliberately NOT on the renderer bridge.
  //
  // Nothing in src/ called it, and `cron.manage` goes to the LAUNCH gateway --
  // the user's own ~/.hermes -- not to a bot's profile. So the only thing it
  // offered a renderer was the ability to write scheduled jobs into the user's
  // personal Hermes under no teammate's name. `gateway.cron()` still exists
  // for main-side use if the routine loop ever wants it.

  // ── Tool profiles (the context-cost lever) ─────────────────────────────
  ipcMain.handle("hydo:toolProfiles", () => ok({ profiles: gateway.toolProfiles() }));
  // The live toolset registry from this Hermes, not a copy. Empty when Hermes
  // is down, which the rail renders as "unavailable" rather than as "none".
  ipcMain.handle("hydo:toolsets", async () => ok({ toolsets: await gateway.listToolsets() }));
  ipcMain.handle("hydo:listSkills", () => {
    try {
      const catalog = require("./skills-catalog.cjs");
      return ok(catalog.listSkills());
    } catch (err) {
      return nope(err.message);
    }
  });
  ipcMain.handle("hydo:runtimeStatus", () => ok({ runtimes: gateway.runtimeStatus() }));

  // ── Compaction ─────────────────────────────────────────────────────────
  ipcMain.handle("hydo:compact", async (_e, agentId) => {
    const next = await store.compact(agentId);
    push();
    return next;
  });

  // ── Rollback (undo a teammate's file changes) ──────────────────────────
  // Open a link in the real browser. Scheme-checked: the URL reaches here from
  // an artifact, which a model wrote, and `shell.openExternal` will happily
  // hand file:// or a custom scheme to the OS.
  /**
   * Native file picker, returning real paths.
   *
   * Hermes' attach handlers take a PATH, not bytes, and Electron 42 removed
   * `File.path` from dropped files in favour of `webUtils.getPathForFile`.
   * A native dialog sidesteps that entirely, and is the better affordance
   * anyway: it starts where the user actually keeps things.
   */
  ipcMain.handle("hydo:pickFiles", async () => {
    const { dialog } = require("electron");
    const res = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      buttonLabel: "Attach",
    });
    if (res.canceled) return { ok: true, files: [] };
    // The dialog is the consent. Remember what the user chose so the attach
    // and preview handlers can accept these paths without accepting every path.
    for (const p of res.filePaths || []) rememberPicked(p);
    return {
      ok: true,
      files: (res.filePaths || []).map((p) => ({
        path: p,
        name: path.basename(p),
        ext: path.extname(p).slice(1).toLowerCase(),
        size: (() => {
          try {
            return fs.statSync(p).size;
          } catch {
            return 0;
          }
        })(),
      })),
    };
  });

  /**
   * Hand a file to a teammate's Hermes session, routed by type.
   *
   * Images and PDFs have dedicated handlers because Hermes treats them as
   * content the model can actually SEE; everything else goes through
   * `attachFile`, which puts it on the turn as a readable document.
   */
  ipcMain.handle("hydo:attachAny", async (_e, agentId, filePath) => {
    if (!pathAllowed(filePath)) return { ok: false, reason: "blocked-path" };
    const ext = String(path.extname(filePath || "")).slice(1).toLowerCase();
    try {
      if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext)) {
        return { ok: true, kind: "image", res: await gateway.attachImage(agentId, filePath) };
      }
      if (ext === "pdf") {
        return { ok: true, kind: "pdf", res: await gateway.attachPdf(agentId, filePath, {}) };
      }
      return { ok: true, kind: "file", res: await gateway.attachFile(agentId, filePath, {}) };
    } catch (err) {
      return { ok: false, reason: err.message, ext };
    }
  });

  // ---- the one shared box ------------------------------------------------
  // The id lives on settings, never on an agent: a box id per agent is a
  // machine per agent and a bill to match. Read-only handlers are free to
  // call; `ensure` starts billing and is deliberate.
  const boxes = boxRuntime.createBoxRuntime({
    getBoxId: () => (store.getState().settings || {}).boxId || "",
    setBoxId: (id) => {
      store.setSettings({ boxId: id });
      push();
    },
  });
  // The store never imports the runtime . it is handed one, so a test store
  // cannot spend money.
  if (typeof store.attachBox === "function") store.attachBox(boxes);
  liveBoxes = boxes;

  // Background processes a teammate left running. Session scoped: one bot
  // cannot see or reap another's.
  // What the teammate's live session actually has enabled, which is not
  // necessarily what Hydo asked for.
  ipcMain.handle("hydo:sessionToolsets", (_e, agentId) =>
    gateway.sessionToolsets(agentId).then((toolsets) => ok({ toolsets }))
  );
  ipcMain.handle("hydo:undoLast", async (_e, agentId) => {
    const next = await store.undoLast(agentId);
    push();
    return next;
  });
  ipcMain.handle("hydo:processes", (_e, agentId) =>
    gateway.listProcesses(agentId).then((processes) => ok({ processes }))
  );
  ipcMain.handle("hydo:killProcess", async (_e, agentId, processId) => {
    try {
      await gateway.killProcess(agentId, processId);
      return ok({});
    } catch (err) {
      return nope(err.message);
    }
  });

  ipcMain.handle("hydo:boxStatus", () => boxes.status());
  ipcMain.handle("hydo:boxLimits", () => boxes.limits());
  ipcMain.handle("hydo:boxEnsure", (_e, reason) => boxes.ensureRunning(reason || {}));
  ipcMain.handle("hydo:boxStop", () => boxes.stop());

  /**
   * Watch the machine's screen inside Hydo, not in Safari.
   *
   * The button used to hand `desktopUrl` to the system browser, which meant
   * leaving the app to look at your own teammate — and landing on the Moonlight
   * stream, which hangs forever on any network that blocks its UDP. Both of
   * those were the same click.
   *
   * A Hydo-owned BrowserWindow, and the VNC URL, which tunnels over HTTPS and
   * connects. Verified from a cold window: "Connected (encrypted)", a live
   * canvas, the real desktop.
   *
   * One window, reused. A desktop stream is a live connection to a machine
   * billed by the second, and stacking three of them is three of those.
   */
  let desktopWin = null;
  ipcMain.handle("hydo:boxDesktop", async () => {
    const got = await boxes.desktopUrl({ vnc: true });
    if (!got.ok) return got;
    if (desktopWin && !desktopWin.isDestroyed()) {
      desktopWin.show();
      desktopWin.focus();
      // Re-navigate: the token in the previous URL may be spent, and a blank
      // screen with no explanation is worse than a reconnect.
      desktopWin.loadURL(got.url);
      return { ok: true, reused: true, mode: got.mode };
    }
    desktopWin = new BrowserWindow({
      width: 1280,
      height: 820,
      title: "Computer",
      backgroundColor: "#141414",
      // Nothing of Hydo's is exposed to it: this renders a remote machine's
      // screen and must never reach the store, the gateway, or the box CLI.
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    desktopWin.on("closed", () => {
      desktopWin = null;
    });
    // This window shows one remote screen. It opens no popups, and it does not
    // follow the remote page anywhere else.
    desktopWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const vncOrigin = (() => {
      try {
        return new URL(got.url).origin;
      } catch {
        return "";
      }
    })();
    desktopWin.webContents.on("will-navigate", (e, url) => {
      let same = false;
      try {
        same = Boolean(vncOrigin) && new URL(url).origin === vncOrigin;
      } catch {
        same = false;
      }
      if (!same) e.preventDefault();
    });
    await desktopWin.loadURL(got.url);
    return { ok: true, mode: got.mode };
  });

  // Idle sweep, in Electron main rather than inside the VM . a machine cannot
  // be trusted to switch itself off. Stopping early costs a few seconds of
  // resume; not stopping costs the month's hours.
  //
  // Ticking every 30s rather than 60s because the idle window is now 3 minutes
  // (box-runtime.cjs), and a 60s tick against a 3-minute window is up to a
  // third of the window spent billing past the decision. At 30s the overshoot
  // is capped at 30 billed seconds. The tick itself is a local comparison of
  // two numbers — it makes no API call, so its only cost is this arithmetic.
  const idleTimer = setInterval(() => {
    if (boxes.idleFor()) boxes.stop().catch(() => {});
  }, 30_000);
  app.on("before-quit", () => {
    clearInterval(idleTimer);
    // The stop itself is issued from `stopBoxOnExit` in will-quit, where it can
    // actually be awaited. Firing it here as well would be two `box stop` calls
    // for one quit.
  });

  ipcMain.handle("hydo:dismissClarify", async (_e, id) => {
    const next = await store.dismissClarify(id);
    push();
    return next;
  });
  ipcMain.handle("hydo:openExternal", (_e, url) => {
    const raw = String(url || "");
    if (!/^https?:\/\//i.test(raw)) return { ok: false, reason: "blocked-scheme" };
    shell.openExternal(raw);
    return { ok: true };
  });
  // ── Updates ────────────────────────────────────────────────────────────
  // There is no update server: no git remote, no valid gh token, no
  // electron-updater. What exists is the working copy this build came from, so
  // "update" means "compare against, and rebuild from, that checkout".
  // electron/build-info.cjs holds the whole mechanism and the reasoning.
  ipcMain.handle("hydo:buildInfo", () => ok({ info: buildInfo.buildInfo(app.isPackaged) }));
  ipcMain.handle("hydo:checkBuild", () => {
    const info = buildInfo.buildInfo(app.isPackaged);
    const res = buildInfo.check(info);
    // Write through, so the ticker agrees with the pane the user just read
    // instead of holding a launch-time answer beside a fresher one.
    updateCache = statusFrom(info, res);
    return ok({ info, check: res });
  });
  ipcMain.handle("hydo:rebuildAndInstall", async () => {
    const info = buildInfo.buildInfo(app.isPackaged);
    // Never while a turn is in flight. `npm run pack` pegs the machine for a
    // minute and a half and then swaps the bundle out from under a running
    // teammate; a half-finished answer is not something to spend on an update.
    const busy = (store.getState().agents || []).filter((a) => a.status === "working");
    if (busy.length) {
      return { ok: false, reason: "busy", detail: `${busy[0].name || "A teammate"} is mid-turn.` };
    }
    if (rebuilding) return { ok: false, reason: "already-running" };
    rebuilding = true;
    try {
      return await buildInfo.rebuildAndInstall({ repo: info.repo });
    } finally {
      rebuilding = false;
    }
  });
  /**
   * Quit and come back up in the bundle that is on disk NOW.
   *
   * Still never automatic - the renderer asks, after an install it watched
   * succeed. What changed is that this used to be three lines that were each
   * subtly wrong:
   *
   *  - `app.exit(0)` SKIPS `will-quit`, and `will-quit` is the ONLY place the
   *    shared box is stopped. The box is billed PER SECOND and the idle sweep
   *    dies with the process, so a relaunch through app.exit left a machine
   *    awake with nothing on this Mac that would ever stop it - the same bug
   *    `stopBoxOnExit` was written for, reached through the one exit path that
   *    skipped it. `app.quit()` runs `will-quit`, which awaits `box stop` and
   *    `gateway.shutdown()` and THEN calls `app.exit(0)` itself. The relaunch
   *    is armed before the quit and survives it.
   *
   *    MEASURED, 2026-08-28, on the Hermes side specifically: a parent that
   *    hard-exits without calling `gateway.shutdown()` does NOT orphan its
   *    python child - the child (pid 80267) was gone within one second. So the
   *    "two gateways over one profile" failure this was expected to fix does
   *    not occur; the box, which is remote and cannot notice a dead parent, is
   *    the resource that actually leaked. Both are handled by going through
   *    will-quit, but only one of them was ever broken.
   *  - No `execPath`. A relaunch re-execs whatever binary is running, which
   *    after "Rebuild and install" may be the pre-swap bundle the user is
   *    trying to leave. Pointing at /Applications/Hydo.app is what makes this
   *    an update rather than a restart.
   *  - No busy check. Same rule as the install: a turn in flight is work the
   *    user is waiting on, and the store's crash recovery can only mark it
   *    interrupted afterwards - it cannot finish it.
   */
  ipcMain.handle("hydo:relaunch", () => {
    const busy = (store.getState().agents || []).filter((a) => a.status === "working");
    if (busy.length) {
      return { ok: false, reason: "busy", detail: `${busy[0].name || "A teammate"} is mid-turn.` };
    }
    let execPath;
    if (app.isPackaged) {
      // The installed bundle, not this process's binary. Guarded with
      // existsSync: relaunching into a missing executable is a quit that never
      // comes back, which is strictly worse than not relaunching at all.
      const installed = path.join(buildInfo.INSTALLED, "Contents", "MacOS", "Hydo");
      if (fs.existsSync(installed)) execPath = installed;
      else if (!fs.existsSync(process.execPath)) {
        return { ok: false, reason: "no-bundle", detail: "There is no Hydo.app to reopen." };
      }
    }
    flushStore();
    app.relaunch(execPath ? { execPath } : undefined);
    // quit, NOT exit - see above. will-quit does the reaping and the exit.
    app.quit();
    return { ok: true, execPath: execPath || process.execPath };
  });

  /**
   * Is there something to install? Cached, on purpose.
   *
   * The sidebar ticker reads this, and a ticker that shelled out to git on a
   * timer would be a background process running `rev-list` forever for an
   * answer that changes when the user commits - which is not often and is
   * never urgent. So: computed at most once per launch, and refreshed only
   * when something explicitly checks (the Updates pane's "Check now", which
   * calls hydo:checkBuild below and writes through to this cache).
   */
  ipcMain.handle("hydo:updateStatus", (_e, opts) => {
    // `{ fresh: true }` is the periodic re-check: an app left open for a day
    // was answering with the count it computed at launch, so an update that
    // landed at noon stayed invisible until the next restart. The default is
    // still the cached answer -- this runs `git fetch`-less local git, but it
    // is still process spawning, and the ticker asks on every mount.
    if (!updateCache || (opts && opts.fresh)) {
      const info = buildInfo.buildInfo(app.isPackaged);
      updateCache = statusFrom(info, buildInfo.check(info));
    }
    return ok(updateCache);
  });

  /**
   * The whole update, in one call: check, build, install.
   *
   * The Settings pane's version asks for a confirm first, because someone who
   * wandered into Updates has not necessarily decided to give the machine up
   * for ninety seconds. The TICKER is different: it is mounted only when an
   * update genuinely exists, it says "Update ready", and pressing it is
   * already the deliberate act. Making that press open a pane containing
   * another button that opens a confirm containing a third button was four
   * clicks to do the thing the first click asked for.
   *
   * Everything that made the pane's path safe is kept -- the mid-turn refusal,
   * the single-flight guard, and the rule that the running app is not replaced
   * until the user chooses to reopen. Only the clicking is gone.
   */
  ipcMain.handle("hydo:updateNow", async () => {
    const info = buildInfo.buildInfo(app.isPackaged);
    const busy = (store.getState().agents || []).filter((a) => a.status === "working");
    if (busy.length) {
      return { ok: false, reason: "busy", detail: `${busy[0].name || "A teammate"} is mid-turn.` };
    }
    if (rebuilding) return { ok: false, reason: "already-running" };
    rebuilding = true;
    try {
      const res = await buildInfo.rebuildAndInstall({ repo: info.repo });
      if (res && res.ok) {
        // The cache described the build we just replaced.
        const next = buildInfo.buildInfo(app.isPackaged);
        updateCache = statusFrom(next, buildInfo.check(next));
      }
      return res;
    } finally {
      rebuilding = false;
    }
  });

  ipcMain.handle("hydo:readArtifact", (_e, id) => store.readArtifact(id));
  ipcMain.handle("hydo:listArtifacts", (_e, botId) => ok({ artifacts: store.listArtifacts(botId) }));
  ipcMain.handle("hydo:deleteArtifact", (_e, id) => {
    const next = store.deleteArtifact(id);
    push();
    return next;
  });
  ipcMain.handle("hydo:rollbackList", (_e, agentId) => store.rollbackList(agentId));
  ipcMain.handle("hydo:rollbackDiff", (_e, agentId, hash) => store.rollbackDiff(agentId, hash));
  ipcMain.handle("hydo:rollbackRestore", async (_e, agentId, hash, filePath) => {
    const next = await store.rollbackRestore(agentId, hash, filePath);
    push();
    return next;
  });

  // ── Plugins / connected apps ───────────────────────────────────────────
  ipcMain.handle("hydo:listPlugins", async () => {
    try {
      return await plugins.listPlugins();
    } catch (err) {
      return { ok: false, error: String(err && err.message ? err.message : err), servers: [], catalog: [] };
    }
  });
  ipcMain.handle("hydo:addPlugin", (_e, id) => plugins.addPlugin(id));
  ipcMain.handle("hydo:removePlugin", (_e, id) => plugins.removePlugin(id));
  ipcMain.handle("hydo:testPlugin", (_e, id) => plugins.testPlugin(id));
  ipcMain.handle("hydo:startPluginAuth", async (_e, id) => {
    const res = await plugins.startPluginAuth(id);
    // The OAuth page must open in the user's real browser — a BrowserWindow
    // would be an embedded-webview login, which is exactly what providers
    // refuse. openExternal, then the renderer polls.
    if (res.ok && res.authUrl) shell.openExternal(res.authUrl);
    return res;
  });
  ipcMain.handle("hydo:pollPluginAuth", (_e, id, sessionId) =>
    plugins.pollPluginAuth(id, sessionId)
  );
  ipcMain.handle("hydo:setPluginKey", (_e, id, value, envVar) =>
    plugins.setPluginKey(id, value, envVar)
  );

  setInterval(async () => {
    const due = store.dueRoutines();
    if (!due.length) return;
    for (const id of due) {
      await store.runRoutine(id);
    }
    push();
  }, 15000).unref();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// One shared python child backs every teammate; close its sessions cleanly
// rather than orphaning them when the window goes away.
//
// The store's disk write is DEBOUNCED (store.cjs `save`), so the flush here is
// not tidiness: without it, quitting inside the 900ms window silently drops
// whatever happened in it. Flush first, unconditionally, before anything that
// can end the process.
function flushStore() {
  try {
    liveStore?.flush();
  } catch {
    /* nothing persisted yet, or already gone */
  }
}

/**
 * Put the shared machine to sleep on the way out — and actually wait for it.
 *
 * This is the single most expensive bug available in this app. The box is
 * billed PER SECOND while awake, and the idle sweep above only runs while Hydo
 * is open. Quit the app with the machine up and nothing on this Mac is left
 * that will ever stop it; the only backstop is the box's own TTL, which is 30
 * minutes at best and was, until this pass, an unknown number the app never set
 * (see `resumeTtl` in box-runtime.cjs). A laptop closed on Friday was a machine
 * billing into Monday.
 *
 * It used to be `boxes.stop({ force: true }).catch(() => {})` in `before-quit`
 * — fired, never awaited, and immediately followed by `app.exit(0)` down the
 * `will-quit` path. Whether the request reached the wire was luck.
 *
 * `force`, because quitting must not leave a machine running just because a job
 * was in flight when the window closed. Bounded, because a hung CLI must lose
 * the app's quit rather than win it: `box stop` was measured at 0.22s on
 * 2026-08-27, so the 2s budget in box-runtime.cjs is ~9x the observed cost and
 * invisible to a person hitting Cmd-Q.
 *
 * Memoised: `will-quit` and the signal handlers can both reach it, and two
 * `box stop` calls for one quit is a wasted round-trip.
 */
let exitStop = null;
function stopBoxOnExit() {
  if (exitStop) return exitStop;
  if (!liveBoxes) return null;
  try {
    exitStop = liveBoxes
      .stop({ force: true, budgetMs: boxRuntime.QUIT_STOP_BUDGET_MS })
      .catch(() => ({ ok: false }));
  } catch {
    return null;
  }
  return exitStop;
}

app.on("will-quit", (e) => {
  flushStore();
  const stopping = stopBoxOnExit();
  if (!stopping && !gateway.available()) return;
  e.preventDefault();
  Promise.all([
    stopping || Promise.resolve(),
    gateway.available() ? gateway.shutdown() : Promise.resolve(),
  ]).finally(() => app.exit(0));
});

app.on("before-quit", flushStore);

app.on("window-all-closed", () => {
  flushStore();
  if (process.platform !== "darwin") app.quit();
});

// A crash or a SIGTERM from `npm run relaunch` skips the app events entirely.
//
// Which is why the box stop is here too, and not only in `will-quit`. These
// handlers called `app.exit(0)` outright, so every `npm run relaunch` — the
// most-used way to restart this app during development — left the shared
// machine awake and billing with nothing left that knew how to stop it. The
// idle sweep had died with the process.
//
// Same shape as the quit path: issue it, give it the measured budget, exit
// regardless. A signal is not a request that can be declined, so the exit is on
// a hard timer rather than on the stop resolving.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    try {
      flushStore();
    } catch {
      /* nothing persisted yet */
    }
    const stopping = stopBoxOnExit();
    if (!stopping) {
      app.exit(0);
      return;
    }
    const bail = setTimeout(() => app.exit(0), boxRuntime.QUIT_STOP_BUDGET_MS + 250);
    stopping.finally(() => {
      clearTimeout(bail);
      app.exit(0);
    });
  });
}
