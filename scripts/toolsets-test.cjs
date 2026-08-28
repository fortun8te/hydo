"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { stripComments } = require("./lib/source-scan.cjs");
const gw = require("../electron/hermes-gateway.cjs");

const { pinFor, toolProfiles, TOOL_PROFILES } = gw;
const ROOT = path.join(__dirname, "..");

// ---- the shipped profiles must not have moved -----------------------------
// These strings are what every existing bot is running on. Adding the extras
// mechanism must be purely additive.
assert.equal(pinFor({ profile: "chat" }), "clarify,memory,todo");
assert.equal(pinFor({ profile: "writer" }), "clarify,file,memory,skills,todo");
assert.equal(
  pinFor({ profile: "researcher" }),
  "clarify,desktop_ui,file,memory,skills,todo,web"
);
assert.equal(
  pinFor({ profile: "builder" }),
  "clarify,computer_use,delegation,desktop_ui,file,memory,session_search,skills,terminal,todo,web"
);

// `desktop_ui` carries `open_preview`, so artifacts work out of the box on the
// default profile. Without it a bot cannot show you anything it makes.
for (const p of ["builder", "researcher"]) {
  assert.ok(pinFor({ profile: p }).split(",").includes("desktop_ui"), `${p} can show artifacts`);
}
// The lean profiles stay lean; Abilities is how you add it there.
for (const p of ["chat", "writer"]) {
  assert.ok(!pinFor({ profile: p }).split(",").includes("desktop_ui"), `${p} stays lean`);
  assert.ok(
    pinFor({ profile: p, extraToolsets: ["desktop_ui"] }).split(",").includes("desktop_ui"),
    `${p} can opt in`
  );
}
assert.equal(pinFor({ profile: "full" }), "", "full stays Hermes' own resolution");
assert.equal(pinFor({}), pinFor({ profile: "builder" }), "builder is still the default");

// ---- extras are ADDITIVE, and sorted so children are shared ---------------
assert.equal(
  pinFor({ profile: "writer", extraToolsets: ["browser"] }),
  "browser,clarify,file,memory,skills,todo"
);
assert.equal(
  pinFor({ profile: "writer", extraToolsets: ["browser", "vision"] }),
  pinFor({ profile: "writer", extraToolsets: ["vision", "browser"] }),
  "order must not fork a second python child"
);
// A profile toolset asked for again is not duplicated.
assert.equal(pinFor({ profile: "writer", extraToolsets: ["file"] }), pinFor({ profile: "writer" }));

// ---- `full` + extras cannot silently drop the extras ----------------------
// An empty pin means "Hermes decides", which cannot carry an extra. It has to
// become a real list instead, or asking for browser on a full bot does nothing.
const fullBrowser = pinFor({ profile: "full", extraToolsets: ["browser"] });
assert.ok(fullBrowser.includes("browser"), "full + browser must actually pin browser");
assert.notEqual(fullBrowser, "", "and stop being an empty pin");

// ---- extras still respect the desktop-control block -----------------------
for (const bad of ["cua", "open-computer", "computer-use", "cua-driver"]) {
  assert.ok(
    !pinFor({ profile: "chat", extraToolsets: [bad] }).split(",").includes(bad),
    `${bad} is blocked as an extra, not just as an MCP`
  );
}

// ---- explicit `toolsets` still REPLACES, extras still add on top ----------
assert.equal(pinFor({ toolsets: ["memory"] }), "memory");
assert.equal(pinFor({ toolsets: ["memory"], extraToolsets: ["browser"] }), "browser,memory");

// ---- profiles are still advertised for the rail ---------------------------
const names = toolProfiles().map((p) => p.name);
assert.deepEqual(names.sort(), Object.keys(TOOL_PROFILES).sort());
assert.equal(toolProfiles().filter((p) => p.isDefault).length, 1);

// ---- the UI must be able to reach it --------------------------------------
assert.equal(typeof gw.listToolsets, "function", "gateway exposes the live registry");
const preload = fs.readFileSync(path.join(ROOT, "electron", "preload.cjs"), "utf8");
assert.ok(preload.includes("hydo:toolsets"), "toolsets is on the preload bridge");
const main = fs.readFileSync(path.join(ROOT, "electron", "main.cjs"), "utf8");
assert.ok(main.includes('ipcMain.handle("hydo:toolsets"'), "and handled in main");
const rail = stripComments(fs.readFileSync(path.join(ROOT, "src", "screens", "BotRail.jsx"), "utf8"));
assert.ok(rail.includes("window.hydo?.toolsets?.()"), "the rail asks Hermes for the list");
assert.ok(rail.includes("toggleToolset"), "and can write it back");
assert.ok(!/const\s+TOOLSETS\s*=\s*\[/.test(rail), "no hardcoded copy of Hermes' registry");

// ---- the store must persist it --------------------------------------------
const store = fs.readFileSync(path.join(ROOT, "electron", "store.cjs"), "utf8");
assert.ok(store.includes('"toolsets"'), "setAgent accepts toolsets");
assert.equal(
  (store.match(/extraToolsets:/g) || []).length,
  2,
  "both gateway call sites forward it (create + resume)"
);

console.log("toolsets-test ok");

// ---- Undo (rollback) must be reachable ------------------------------------
// The whole rollback path was wired end to end — gateway, store, IPC, preload —
// and no screen ever called it, so a bot with `terminal` + `file` could edit
// anything you own with no undo but git.
const shell = fs.readFileSync(path.join(ROOT, "src", "screens", "Shell.jsx"), "utf8");
const rb = fs.readFileSync(path.join(ROOT, "src", "screens", "Rollback.jsx"), "utf8");
assert.ok(shell.includes("<Rollback"), "the undo panel is mounted");
assert.ok(rail.includes("onOpenUndo"), "and reachable from the bot rail");
for (const fn of ["rollbackList", "rollbackDiff", "rollbackRestore"]) {
  assert.ok(preload.includes(fn), `${fn} is bridged`);
  assert.ok(rb.includes(fn), `${fn} is actually called by the UI`);
}
// Restoring one file is disk-only and safe mid-turn; a full restore also
// rewinds history. Both must go through the confirm, and say which is which.
assert.ok(rb.includes("ConfirmDialog"), "restores are confirmed");
assert.ok(/filePath\s*\?/.test(rb), "the two restores are distinguished");

// ---- Stop must survive a background turn ----------------------------------
// `sending` is only true while the send IPC is in flight; a first-job
// background yield resolves it immediately while the bot keeps working.
assert.ok(
  /busy=\{sending \|\| workingHere\}/.test(shell),
  "stop stays available for the whole turn, not just the send"
);

console.log("rollback+stop wiring ok");
