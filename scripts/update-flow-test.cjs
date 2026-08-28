"use strict";

/**
 * Updating, end to end: the ticker, the account-menu entry, the reopen, and
 * what a teammate looks like on the far side of a restart.
 *
 * scripts/updates-pane-test.cjs already pins the Settings pane (no hand-typed
 * version, no dead controls, an atomic swap in /Applications). This suite
 * covers the four things that pass added:
 *
 *  1. NOTHING IS EVER SHOWN FOR AN UPDATE THAT DOES NOT EXIST. `statusFrom` in
 *     electron/main.cjs is the single gate, and every non-"behind" state —
 *     "current", "dirty", "dev", and above all "unknown" — must come out
 *     `available: false`. "unknown" is the one that matters: a packaged app on
 *     a laptop with no repo cannot tell, and a badge there would be a
 *     confident wrong status.
 *
 *  2. NO POLLING. There is no release server; the mechanism is `git rev-list`
 *     against a local checkout. A setInterval or a focus listener re-running
 *     that would be a background process burning cycles on a question whose
 *     answer changes when someone commits.
 *
 *  3. THE REOPEN GOES THROUGH THE REAL SHUTDOWN. `app.exit(0)` skips
 *     `will-quit`, which is the ONLY place `box stop` is awaited. The box is
 *     billed per second and the idle sweep dies with the process, so the old
 *     relaunch handler left a remote machine awake with nothing left on this
 *     Mac that knew how to stop it. `app.quit()` runs will-quit — box stop and
 *     `gateway.shutdown()`, awaited — and exits from there.
 *
 *     MEASURED while writing this: a parent that hard-exits without calling
 *     gateway.shutdown() does NOT orphan its python child (it was gone inside
 *     a second). The Hermes half was never leaking; the box half was. Both are
 *     covered by going through will-quit, and this suite pins the route rather
 *     than either symptom.
 *
 *  4. A TURN INTERRUPTED BY THE RESTART COMES BACK HONEST. Measured, not
 *     assumed, against a real store on a temp directory: before this pass a
 *     state.json written mid-turn reloaded with `status: "working"`, its
 *     activity line, its tool mark, and a bot bubble still carrying
 *     `streaming: true` — a teammate spinning forever under an animated
 *     bubble for an answer that died with the process.
 *
 * Plus the live-layout half, which no source assertion can do: the ticker and
 * the account-menu row are photographed and MEASURED in a real BrowserWindow
 * in both themes. That is here because this repo keeps losing the same fight —
 * a rule applies its class, wins nothing, and changes no pixels
 * (`.hy-dialog button` (0,1,1) over `.hy-btn--primary` (0,1,0), which made a
 * white button's label invisible). Computed colours are read back.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const main = read("electron/main.cjs");
const preload = read("electron/preload.cjs");
const shell = read("src/screens/Shell.jsx");
const sidebar = read("src/screens/Sidebar.jsx");
const menu = read("src/screens/AccountMenu.jsx");
const sidebarCss = read("src/screens/sidebar.css");
const tokens = read("src/kit/tokens.css");
const icons = read("src/kit/icons.css");

// ── 1. an update that does not exist is never shown ───────────────────────
// statusFrom is lifted out of main.cjs and run for real rather than grepped:
// the rule is a boolean, and a boolean is worth executing.
const src = main.slice(main.indexOf("function statusFrom("));
const body = src.slice(0, src.indexOf("\n}\n") + 3);
// eslint-disable-next-line no-new-func
const statusFrom = new Function(`${body}; return statusFrom;`)();

const CASES = [
  [{ state: "behind", behind: 4 }, true, "four real commits ahead is the one true case"],
  [{ state: "behind", behind: 0 }, false, "'behind' with nothing to install is not an update"],
  [{ state: "current" }, false, "up to date shows nothing"],
  [{ state: "dirty", behind: 0 }, false, "uncommitted edits are not an update"],
  [{ state: "dev", behind: 0 }, false, "running from source has nothing to update to"],
  [{ state: "unknown", behind: 0 }, false, "cannot tell must say nothing at all"],
  // The dangerous shape: a check that failed to read git but left a stale
  // count behind. State is what decides, never the number on its own.
  [{ state: "unknown", behind: 9 }, false, "a count without a 'behind' state proves nothing"],
];
for (const [check, want, why] of CASES) {
  assert.equal(statusFrom({ channel: "release" }, check).available, want, why);
}
assert.equal(statusFrom(null, null).available, false, "no check at all is not an update");
assert.equal(statusFrom(null, undefined).behind, 0, "a missing count is 0, never NaN");
assert.equal(statusFrom({}, { state: "behind", behind: "3" }).behind, 3, "the count reaches the UI as a number");

// The renderer must not widen that gate on its own. Shell only ever sets the
// count when main said `available`.
assert.ok(
  /if \(gone \|\| !res \|\| !res\.available\) return;/.test(shell),
  "Shell must trust main's `available` flag rather than re-deriving it from `behind`"
);
// And the ticker is mounted on a positive count, not on truthiness of an object.
assert.ok(/\{updateBehind > 0 \? \(/.test(sidebar), "the ticker must be mounted on a positive commit count");
assert.ok(
  /const behind = Number\(updateBehind\) \|\| 0;/.test(menu),
  "the account-menu badge must coerce its count, so undefined cannot render"
);
assert.ok(/\{behind > 0 \? \(/.test(menu), "the badge only exists when there is something to install");

// ── 2. no polling, no network ─────────────────────────────────────────────
const askAt = shell.indexOf("const [updateBehind, setUpdateBehind]");
assert.ok(askAt > 0, "Shell must hold the update count");
const askBlock = shell.slice(askAt, shell.indexOf("const onUpdate", askAt));
assert.ok(/useEffect\(/.test(askBlock), "the check runs in an effect");
assert.ok(/\}, \[\]\);/.test(askBlock), "with an EMPTY dependency list — once per launch, not per render");
for (const banned of ["setInterval", "setTimeout", "addEventListener", "fetch("]) {
  assert.ok(
    !askBlock.includes(banned),
    `the update check must not ${banned} — there is no server to poll and no timer to justify`
  );
}
// The cache in main is what makes "once" cheap even if something asks twice.
assert.ok(/let updateCache = null;/.test(main), "main must cache the answer");
assert.ok(
  /if \(!updateCache\) \{/.test(main),
  "hydo:updateStatus must shell out to git at most once per launch"
);
assert.ok(
  /updateCache = statusFrom\(info, res\);/.test(main),
  "an explicit check must write through, or the ticker and the pane can disagree"
);
// ── 3. the reopen is a real, ordered shutdown ─────────────────────────────
const relaunchAt = main.indexOf('ipcMain.handle("hydo:relaunch"');
assert.ok(relaunchAt > 0, "main.cjs has no relaunch handler");
const relaunch = main.slice(relaunchAt, main.indexOf("ipcMain.handle(", relaunchAt + 20));
// Nothing anywhere in this feature reaches the network. (electron-updater
// being absent from package.json is pinned by updates-pane-test.cjs; what
// matters here is that no handler on the update path opens a socket or arms
// a timer — the whole mechanism is `git rev-list` against a local checkout.)
const updatePath = main.slice(main.indexOf('ipcMain.handle("hydo:buildInfo"'), relaunchAt);
for (const banned of ["net.request", "https.", "fetch(", "setInterval"]) {
  assert.ok(!updatePath.includes(banned), `the update handlers must not ${banned}`);
}
assert.ok(
  /status === "working"/.test(relaunch),
  "the reopen must refuse while a teammate is mid-turn, exactly like the install"
);
assert.ok(/flushStore\(\);/.test(relaunch), "the debounced store write must be flushed before the process ends");
assert.ok(/app\.relaunch\(/.test(relaunch), "it must actually arm the relaunch");
assert.ok(
  /app\.quit\(\);/.test(relaunch),
  "app.quit, so will-quit runs — see the note in the handler"
);
assert.ok(
  !/app\.exit\(/.test(relaunch),
  "app.exit SKIPS will-quit, which orphans the box and the Hermes gateway of the OLD bundle"
);
assert.ok(/execPath/.test(relaunch), "it must reopen the INSTALLED bundle, not this process's binary");
assert.ok(
  /fs\.existsSync\(installed\)/.test(relaunch),
  "relaunching into a missing executable is a quit that never comes back"
);
// will-quit is the thing being relied on, so pin that it still does both jobs.
const willQuit = main.slice(main.indexOf('app.on("will-quit"'), main.indexOf('app.on("before-quit", flushStore)'));
assert.ok(/stopBoxOnExit\(\)/.test(willQuit), "will-quit must stop the shared box");
assert.ok(/gateway\.shutdown\(\)/.test(willQuit), "will-quit must shut the Hermes gateway down");
assert.ok(/app\.exit\(0\)/.test(willQuit), "and only then exit");
// The install itself still must NOT relaunch as a side effect.
const rebuild = main.slice(
  main.indexOf('ipcMain.handle("hydo:rebuildAndInstall"'),
  main.indexOf("ipcMain.handle(", main.indexOf('ipcMain.handle("hydo:rebuildAndInstall"') + 20)
);
assert.ok(!/app\.relaunch/.test(rebuild), "installing must never restart the app on its own");

// Every new bridge call is wired the whole way through.
for (const name of ["updateStatus", "relaunch"]) {
  assert.ok(new RegExp(`\\b${name}: \\(`).test(preload), `preload must expose ${name}`);
  assert.ok(new RegExp(`ipcMain\\.handle\\("hydo:${name}"`).test(main), `main must handle hydo:${name}`);
}
assert.ok(/window\.hydo\?\.updateStatus/.test(shell), "Shell must call the bridge, not import build-info");

// ── 4. a turn interrupted by the restart comes back honest ────────────────
// Run against a REAL store on a temp directory. `opts.complete` keeps the
// cold-start Hermes resume out of it; this is a test about what LOADS.
const { createStore } = require(path.join(ROOT, "electron/store.cjs"));
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-restart-"));
try {
  const crashed = {
    agents: [
      {
        id: "bot1",
        kind: "bot",
        name: "Ada",
        model: "hermes-1",
        provider: "hermes",
        hermesSessionId: "abcd1234",
        // Exactly what setStatus(id, "working") leaves in state.json.
        status: "working",
        workingIn: "bot1",
        activity: "Reading files",
        activityDetail: "rg --files",
        activityIcon: "figma",
      },
    ],
    channels: [],
    sections: [],
    settings: {},
    messages: {
      bot1: [
        { id: "m1", role: "user", text: "summarise the repo" },
        // The bubble streamThroughHermes opens. `streaming` is cleared only by
        // commitBeat, which never runs if the process dies first.
        { id: "m2", role: "bot", kind: "chat", text: "I looked at", streaming: true },
      ],
    },
  };
  fs.writeFileSync(path.join(sandbox, "state.json"), JSON.stringify(crashed));
  const store = createStore({ dir: sandbox, complete: true });
  const state = store.getState();
  const ada = state.agents.find((a) => a.id === "bot1");
  assert.ok(ada, "the roster must survive the restart");

  // The bug this pins: `status` used to come back "working" and nothing would
  // ever clear it, because the turn that would have called setStatus("idle")
  // died with the old process.
  assert.equal(ada.status, "idle", "a teammate must never come back from a restart still spinning");
  assert.equal(ada.workingIn, null, "and not claiming a conversation either");
  assert.equal(ada.activity, "", "the activity line described a tool call that no longer exists");
  assert.equal(ada.activityDetail, "", "so did its detail");
  assert.equal(ada.activityIcon, "", "and its brand mark");

  // What must NOT be thrown away: the conversation, and the durable Hermes
  // session id the cold-start resume needs to pick the thread back up.
  assert.equal(ada.hermesSessionId, "abcd1234", "the Hermes session id must survive, or continuity is impossible");
  const msgs = state.messages.bot1;
  assert.equal(msgs.length, 2, "no message is dropped by the recovery");
  assert.equal(msgs[1].text, "I looked at", "the partial text is kept — it is real, it just stopped");
  assert.equal(msgs[1].streaming, false, "but it must not still render as a live stream");
  assert.equal(msgs[1].interrupted, true, "it must be MARKED, so the transcript can say the turn was cut short");
  assert.ok(!msgs[0].interrupted, "a finished message is untouched");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

// The renderer has to actually say it. A flag nothing renders is worse than
// no flag: it looks handled in the store and reads as a finished answer.
const transcript = read("src/screens/Transcript.jsx");
assert.ok(/msg\.interrupted \?/.test(transcript), "Transcript must render the interrupted marker");
assert.ok(/hy-interrupted/.test(transcript) && /hy-interrupted/.test(read("src/screens/transcript.css")),
  "and it must be styled, or it renders as unstyled body text");
// The store's own resume path is what makes continuity possible at all, so
// pin that the restart still tries to rebind each teammate's session.
const store = read("electron/store.cjs");
assert.ok(/resumeStoredHermes/.test(store), "a restart must rebind stored Hermes sessions");
assert.ok(/gateway\s*\n?\s*\.resume\(agent\.id, agent\.hermesSessionId/.test(store),
  "using the persisted session id");

// ── 5. the ticker and the menu row, measured in a real window ─────────────
// Two processes on purpose: running the vite build with execFileSync from
// inside the Electron main process leaves that process unable to start its
// network service, and every later page load dies ERR_FAILED.
const OUTDIR = path.join(os.tmpdir(), "hydo-settings-shot-dist");
const PREFIX = path.join(os.tmpdir(), "hydo-update-ticker");
// NODE_ENV, not --mode: `import.meta.env.DEV` is computed from NODE_ENV, and
// without it the devmock chunk is dropped and the app renders its signed-out
// screen forever.
execFileSync("npx", ["vite", "build", "--mode", "development", "--outDir", OUTDIR, "--emptyOutDir"], {
  cwd: ROOT,
  stdio: "ignore",
  timeout: 5 * 60 * 1000,
  env: { ...process.env, NODE_ENV: "development" },
});
const electron = require(path.join(ROOT, "node_modules", "electron"));
execFileSync(electron, [path.join(__dirname, "update-ticker-shot.cjs"), PREFIX], {
  cwd: ROOT,
  stdio: "ignore",
  timeout: 5 * 60 * 1000,
});

const shot = JSON.parse(fs.readFileSync(`${PREFIX}.json`, "utf8"));
assert.deepEqual(Object.keys(shot), ["dark", "light"], "both themes must be photographed");

const rgb = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const same = (a, b) => JSON.stringify(rgb(a)) === JSON.stringify(rgb(b));

for (const [theme, page] of Object.entries(shot)) {
  const where = (msg) => `${theme}: ${msg}`;
  const t = page.ticker;
  const m = page.menu;

  assert.ok(t.present, where("the ticker must be in the sidebar foot when there is an update"));
  assert.match(t.text, /Update ready/, where("and say what it is"));
  assert.match(t.text, /3 new/, where("with the count the mock reports, not a hardcoded one"));

  // "a lil blue ticker" — both halves, measured.
  assert.ok(t.box.h > 0 && t.box.w > 0, where("the ticker must have real layout, not zero box"));
  assert.ok(
    t.box.h < t.pluginsBox.h,
    where(`the ticker (${t.box.h}px) must be shorter than the Plugins row (${t.pluginsBox.h}px) — "lil"`)
  );
  assert.ok(t.box.h <= 32, where(`${t.box.h}px is not a small ticker`));

  // Blue. Not "has the class": the computed colour, read back off the live
  // cascade, and specifically NOT the same colour as ordinary label text —
  // the exact way `.hy-dialog button` beat `.hy-btn--primary` and made a
  // label invisible while the source looked right.
  const [r, g, b] = rgb(t.labelColor);
  assert.ok(b > r + 40 && b > g + 20, where(`the ticker label is not blue: ${t.labelColor}`));
  assert.ok(!same(t.labelColor, "rgb(252, 252, 252)"), where("the label must not fall back to plain text colour"));
  const dot = rgb(t.dotBg);
  assert.ok(dot[2] > dot[0] + 40, where(`the ticker dot is not blue: ${t.dotBg}`));
  // The tinted ground must actually be painted, not transparent.
  assert.ok(!/rgba\(0, 0, 0, 0\)/.test(t.bg), where(`the ticker has no background: ${t.bg}`));

  // The account menu carries the entry, in the same shape as its neighbours.
  assert.ok(m.present, where("the account menu must open"));
  assert.ok(
    m.items.some((x) => /^Software Update/.test(x)),
    where(`no Software Update entry — menu is ${JSON.stringify(m.items)}`)
  );
  assert.equal(m.updateItemTag, "BUTTON", where("it must be a button like every other row"));
  assert.match(m.updateItemClass, /account-menu__item/, where("with the shared item class"));
  assert.ok(m.updateItemHasIcon, where("and an icon in the same slot"));
  // Same row height as the rest, within a pixel of rounding.
  const others = m.siblingHeights.filter((h) => h !== m.updateItemHeight);
  assert.ok(
    others.every((h) => Math.abs(h - m.updateItemHeight) <= 1),
    where(`the update row is ${m.updateItemHeight}px against siblings ${JSON.stringify(m.siblingHeights)}`)
  );

  // The badge, and the specificity fight it was in.
  assert.equal(m.badgeText, "3 new", where("the badge must carry the real count"));
  assert.ok(
    !same(m.badgeColor, m.metaDefaultColor),
    where(
      `the badge computed to ${m.badgeColor}, the same as a plain .account-menu__meta ` +
        `(${m.metaDefaultColor}) — the (0,2,0) sidebar rule won and the class changed no pixels`
    )
  );
  const badge = rgb(m.badgeColor);
  assert.ok(badge[2] > badge[0] + 40, where(`the badge is not blue: ${m.badgeColor}`));
}

// The two themes must genuinely differ. Stamping data-theme by hand produced
// two identical "themes" the first time this harness was written.
assert.ok(
  !same(shot.dark.ticker.labelColor, shot.light.ticker.labelColor),
  "dark and light must use different blues — a single blue fails contrast in one of them"
);
for (const f of ["dark", "light", "dark-closed", "light-closed"]) {
  // Four frames, not two: the account menu covers the ticker, so the closed
  // frame is the only one that shows the ticker sitting in the foot.
  assert.ok(fs.existsSync(`${PREFIX}-${f}.png`), `${f} frame was not captured`);
}

// ── 6. the tokens and the icon actually exist ─────────────────────────────
// --hy-update must be defined in BOTH theme blocks. A token defined only in
// dark renders as an empty custom property in light, and `color: var(--x)`
// with no fallback then inherits — silently.
assert.equal(
  (tokens.match(/^\s*--hy-update:/gm) || []).length,
  2,
  "--hy-update must be defined once per theme block, or one theme has no colour"
);
assert.equal((tokens.match(/^\s*--hy-update-soft:/gm) || []).length, 2, "same for the tint");
// The selector that has to win, written deep enough to.
assert.ok(
  /\.sand-sidebar \.account-menu__item \.account-menu__meta--update/.test(sidebarCss),
  "the badge rule must out-specify `.sand-sidebar .account-menu__meta` (0,2,0)"
);
// The icon class must be one the font actually defines. An undefined
// .gb-icon-* renders a blank box that reads as a missing icon.
const iconClass = (menu.match(/gb-icon gb-icon-([a-z0-9-]+)/g) || []).map((s) => s.replace("gb-icon gb-icon-", ""));
for (const name of iconClass) {
  assert.ok(
    new RegExp(`\\.gb-icon-${name}::before`).test(icons),
    `AccountMenu uses .gb-icon-${name}, which src/kit/icons.css does not define`
  );
}

console.log("update-flow-test ok");
