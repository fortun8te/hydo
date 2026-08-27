const { app, BrowserWindow, ipcMain, shell, Notification } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { createStore } = require("./store.cjs");
const gateway = require("./hermes-gateway.cjs");
const plugins = require("./hermes-plugins.cjs");
const box = require("./box.cjs");

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

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
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

  // ---- the team computer -------------------------------------------------
  // One shared cloud Linux machine for every teammate. Read-only handlers are
  // safe to call whenever; `ensure` and `stop` cost money and are deliberate.
  ipcMain.handle("hydo:boxStatus", () => box.status());
  ipcMain.handle("hydo:boxLimits", () => box.limits());
  ipcMain.handle("hydo:boxList", () => box.list());
  ipcMain.handle("hydo:boxEnsure", () => box.ensure());
  ipcMain.handle("hydo:boxDesktop", (_e, id) => box.desktopUrl(id));
  ipcMain.handle("hydo:boxStop", (_e, id) => box.stop(id));

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
