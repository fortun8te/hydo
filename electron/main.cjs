const { app, BrowserWindow, ipcMain, shell, Notification, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createStore } = require("./store.cjs");
const gateway = require("./hermes-gateway.cjs");
const plugins = require("./hermes-plugins.cjs");
const boxRuntime = require("./box-runtime.cjs");

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
  app.setPath("userData", path.join(app.getPath("appData"), "Hydo"));
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
    if (width < 980 || height < 640) return null;
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

function createWindow() {
  const saved = loadWindowState();
  const win = new BrowserWindow({
    ...(saved || {}),
    width: (saved && saved.width) || 1280,
    height: (saved && saved.height) || 860,
    minWidth: 980,
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

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
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
if (!app.requestSingleInstanceLock()) {
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

  push = () => {
    win?.webContents.send("hydo:state", store.getState());
  };

  ipcMain.handle("hydo:getState", () => store.getState());
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
  ipcMain.handle("hydo:deleteAgent", (_e, id) => {
    const next = store.deleteAgent(id);
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
    const { previewFile } = require("./file-preview.cjs");
    return previewFile(filePath);
  });
  ipcMain.handle("hydo:saveFile", async (e, filePath, name) => {
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
  ipcMain.handle("hydo:deleteEntries", (_e, ids) => {
    const next = store.deleteEntries(ids);
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
  attach("hydo:attachFile", (id, p, o) => gateway.attachFile(id, p, o || {}));
  attach("hydo:attachImage", (id, p) => gateway.attachImage(id, p));
  attach("hydo:attachImageBytes", (id, b64, o) => gateway.attachImageBytes(id, b64, o || {}));
  attach("hydo:attachPdf", (id, p, o) => gateway.attachPdf(id, p, o || {}));
  attach("hydo:pasteClipboard", (id) => gateway.pasteClipboard(id));
  attach("hydo:detachImage", (id, p) => gateway.detachImage(id, p));

  // ── Hermes' own learning store (read + curate) ──────────────────────────
  ipcMain.handle("hydo:learningFrames", (_e, o) => gateway.learningFrames(o || {}));
  ipcMain.handle("hydo:learningDetail", (_e, id) => gateway.learningDetail(id));
  ipcMain.handle("hydo:learningEdit", async (_e, id, content) => {
    if (!gateway.available()) return nope("Hermes is not installed");
    try {
      return ok({ result: await gateway.learningEdit(id, content) });
    } catch (err) {
      return nope(err.message);
    }
  });
  ipcMain.handle("hydo:learningDelete", async (_e, id) => {
    if (!gateway.available()) return nope("Hermes is not installed");
    try {
      return ok({ result: await gateway.learningDelete(id) });
    } catch (err) {
      return nope(err.message);
    }
  });
  ipcMain.handle("hydo:insights", (_e, days) => gateway.insights(days));

  // ── Cron (Hermes' real scheduler, alongside Hydo's own routine loop) ───
  ipcMain.handle("hydo:cron", async (_e, action, params) => {
    if (!gateway.available()) return nope("Hermes is not installed");
    try {
      return ok({ result: await gateway.cron(action, params || {}) });
    } catch (err) {
      return nope(err.message);
    }
  });

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

  // Idle sweep, in Electron main rather than inside the VM . a machine cannot
  // be trusted to switch itself off. Stopping early costs a few seconds of
  // resume; not stopping costs the month's hours.
  const idleTimer = setInterval(() => {
    if (boxes.idleFor()) boxes.stop().catch(() => {});
  }, 60_000);
  app.on("before-quit", () => {
    clearInterval(idleTimer);
    // Force, because quitting must not leave a machine running just because a
    // job was in flight when the window closed.
    boxes.stop({ force: true }).catch(() => {});
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

app.on("will-quit", (e) => {
  flushStore();
  if (!gateway.available()) return;
  e.preventDefault();
  gateway.shutdown().finally(() => app.exit(0));
});

app.on("before-quit", flushStore);

app.on("window-all-closed", () => {
  flushStore();
  if (process.platform !== "darwin") app.quit();
});

// A crash or a SIGTERM from `npm run relaunch` skips the app events entirely.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    try {
      flushStore();
    } finally {
      app.exit(0);
    }
  });
}
