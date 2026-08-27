"use strict";

/**
 * IPC surface for the Hermes approval mode + permanent allowlist.
 *
 * `docs/SAFETY.md` gap #1 and #2: Hydo wires the approval GATE correctly
 * per-bot profile, but has no UI to see or change `approvals.mode` (every
 * bot silently inherits Hermes' own `smart` default) and no UI to see or
 * revoke the "always" allowlist an approval answer can build up forever.
 * This file is that surface — read/write against ONE bot's own profile home
 * (`~/.hermes/profiles/hydo<id>/config.yaml`, via `bot-home.cjs`), never the
 * launch home. Getting that scoping wrong is the exact bug this project
 * keeps finding (`learning.frames` in docs/HERMES-GAPS.md).
 *
 * Registered here rather than in `electron/main.cjs` (excluded from this
 * pass) — `registerIpc()` is called once from `store.cjs`, whose own module
 * load already happens inside the Electron main process before any window
 * exists, so timing is identical to registering inline in main.cjs.
 *
 * Guarded on `process.versions.electron`: several test scripts `require()`
 * store.cjs (and therefore this file) under plain `node`, where the
 * `electron` package resolves to a path string, not `{ ipcMain }`. Without
 * the guard, loading store.cjs outside Electron would throw at import time
 * and take every one of those tests down with it.
 */

const botHome = require("./bot-home.cjs");

function ok(extra) {
  return { ok: true, ...extra };
}

function nope(err) {
  return { ok: false, error: String((err && err.message) || err || "error") };
}

let registered = false;

function registerIpc() {
  if (registered) return;
  if (!process.versions || !process.versions.electron) return;
  registered = true;

  const { ipcMain } = require("electron");

  // Current effective mode for one bot, honest about whether it is an
  // explicit choice or an inherited default — and the allowlist it has
  // accumulated, so both gaps in docs/SAFETY.md get one read call.
  ipcMain.handle("hydo:approvalSettings", (_e, botId) => {
    if (!botId) return nope("botId required");
    try {
      const { mode, isDefault } = botHome.getApprovalMode(botId);
      return ok({
        mode,
        isDefault,
        default: botHome.DEFAULT_APPROVAL_MODE,
        allowlist: botHome.readAllowlist(botId),
      });
    } catch (err) {
      return nope(err);
    }
  });

  // `bot-home.cjs#setApprovalMode` itself refuses anything but smart/manual —
  // enforced twice (there and here) is not redundant, it is the two ends of
  // one IPC boundary neither trusting the other's validation alone.
  ipcMain.handle("hydo:setApprovalMode", (_e, botId, mode) => {
    if (!botId) return nope("botId required");
    try {
      return ok(botHome.setApprovalMode(botId, mode));
    } catch (err) {
      return nope(err);
    }
  });

  ipcMain.handle("hydo:revokeApproval", (_e, botId, pattern) => {
    if (!botId || !pattern) return nope("botId and pattern required");
    try {
      return ok(botHome.revokeAllowlistEntry(botId, pattern));
    } catch (err) {
      return nope(err);
    }
  });
}

module.exports = { registerIpc };
