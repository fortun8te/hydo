"use strict";

/**
 * The Updates pane: nothing typed by hand, nothing that does nothing.
 *
 * Two failures are pinned here, both of which had already shipped.
 *
 * 1. THE VERSION WAS A LITERAL. The pane read `label="Build 2026.08.26.2"` in
 *    JSX. It was correct for one day. A string in source that claims to
 *    describe the artifact it is compiled into is always going to drift, so
 *    this suite greps the whole pane for a semver or a dotted date and fails
 *    on one, whatever it says.
 *
 * 2. DEAD CONTROLS. Same disease scripts/dead-control-test.cjs was written
 *    for. Every button in this pane is followed from its onClick, through
 *    preload's bridge, to an ipcMain.handle in main.cjs, to a real exported
 *    function in build-info.cjs. A control that stops short anywhere on that
 *    chain fails here.
 *
 * Plus the safety rules for rebuild-and-install, which runs a build and swaps
 * a bundle in /Applications: never during a turn, never in place, never an
 * unasked-for relaunch.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const jsx = read("src/screens/Settings.jsx");
const preload = read("electron/preload.cjs");
const main = read("electron/main.cjs");
const stamper = read("scripts/stamp-build.cjs");
const pkg = JSON.parse(read("package.json"));
const buildInfo = require(path.join(ROOT, "electron/build-info.cjs"));

// The pane, isolated. Everything below reads only this slice, so an unrelated
// version-shaped string elsewhere in the file (a model id, say) cannot make
// this pass or fail by accident.
const start = jsx.indexOf('{pane === "updates" && (');
assert.ok(start > 0, "Settings.jsx has no updates pane");
const pane = jsx.slice(start, jsx.indexOf("</section>\n              </>", start));
assert.ok(pane.length > 200, "the updates pane slice came out empty");

// ── 1. no hand-typed version, anywhere in the pane ────────────────────────
// `Build 2026.08.26.2` and `0.1.1` are both caught by this. So is a date.
const LITERAL = /["'`][^"'`]*\b\d+\.\d+\.\d+/;
assert.ok(
  !LITERAL.test(pane),
  `the Updates pane contains a hardcoded version-shaped literal: ${(pane.match(LITERAL) || [])[0]}`
);
assert.ok(!/Build \d/.test(pane), "the build number must not be typed into JSX");
// It has to come from somewhere real instead.
assert.ok(/buildLabel\(build\)/.test(pane), "the version row must render buildLabel(build)");
assert.ok(
  /window\.hydo\?\.checkBuild/.test(jsx),
  "the pane must ask the main process for the build rather than importing package.json"
);

// The formatter itself must not invent anything either, and must never render
// an empty "()" when git was unavailable on the build machine.
const label = jsx.slice(jsx.indexOf("function buildLabel"), jsx.indexOf("function buildDesc"));
assert.ok(/info\.version/.test(label) && /info\.build/.test(label) && /info\.shortSha/.test(label));
assert.ok(/build unknown/.test(label), "buildLabel must have a truthful fallback for a missing commit count");
assert.ok(!LITERAL.test(label), "buildLabel must not carry a literal version");

// A dev run may never present itself as a release.
assert.ok(/info\.channel === "dev"/.test(jsx), "the pane must branch on the dev channel");
assert.ok(/this is not a release build/.test(jsx), "a dev run must say so in the pane");

// ── 2. the version is derived, end to end ─────────────────────────────────
// package.json is the ONLY place a version is typed, and build-info reads it.
assert.ok(/^\d+\.\d+\.\d+$/.test(pkg.version), "package.json needs a semver version");
const info = buildInfo.buildInfo(false);
assert.equal(info.version, pkg.version, "buildInfo must report package.json's version");
assert.equal(info.channel, "dev", "an unpackaged process is never a release");
assert.ok(info.build === null || Number.isInteger(info.build), "the build number is an integer or null, never a string");
assert.ok(info.sha === null || /^[0-9a-f]{40}$/.test(info.sha), "sha must be a real commit or null");
// buildInfo(true) claims to be packaged; it must not crash off a repo.
assert.doesNotThrow(() => buildInfo.buildInfo(true));

// The stamp is what carries those facts into a bundle that has no .git.
assert.ok(/rev-list", "--count", "HEAD/.test(stamper), "the stamper must capture the commit count");
assert.ok(/rev-parse", "HEAD/.test(stamper), "the stamper must capture the sha");
assert.ok(/Number\(count\) \|\| null/.test(stamper), "a missing commit count must become null, not NaN or ''");
assert.ok(
  pkg.scripts.build.includes("scripts/stamp-build.cjs"),
  "npm run build must stamp — every packaging path goes through it"
);
assert.ok(
  (pkg.build.files || []).some((f) => f.startsWith("electron/")),
  "the stamp lives in electron/, which must be in the packaged files"
);

// ── 3. every control reaches a real implementation ────────────────────────
// The chain, checked link by link, for each hydo call the pane makes.
const calls = [...pane.matchAll(/window\.hydo\??\.(\w+)/g)].map((m) => m[1]);
assert.ok(calls.length >= 3, `expected the pane to call several bridge methods, found ${calls.join(", ")}`);
for (const name of new Set(calls)) {
  assert.ok(
    new RegExp(`\\b${name}: \\(`).test(preload),
    `Settings calls window.hydo.${name} but preload does not expose it`
  );
  assert.ok(
    new RegExp(`ipcMain\\.handle\\("hydo:${name}"`).test(main),
    `preload invokes hydo:${name} but main.cjs registers no handler`
  );
}
for (const fn of ["buildInfo", "check", "rebuildAndInstall", "install"]) {
  assert.equal(typeof buildInfo[fn], "function", `build-info.cjs must export ${fn}`);
}
// And no button may be rendered with an onClick that goes nowhere.
for (const m of pane.matchAll(/onClick=\{\(\) => ([^}]*)\}/g)) {
  assert.ok(
    /window\.hydo|set[A-Z]/.test(m[1]),
    `a control in the Updates pane has an onClick that does nothing: ${m[1]}`
  );
}

// ── 4. the rebuild is honest about what it costs ──────────────────────────
// Told BEFORE it happens: the first click only explains.
assert.ok(/rebuild === "confirm"/.test(pane), "rebuild-and-install must be a two-step control");
assert.ok(/npm run pack/.test(pane), "the confirm step must name what it is about to run");
// Refused mid-turn, in the main process — not merely hidden in the renderer.
// Just this handler's body: the relaunch handler sits right after it, and a
// generous slice would swallow it and defeat the "never restarts" check.
const rebuildAt = main.indexOf('ipcMain.handle("hydo:rebuildAndInstall"');
assert.ok(rebuildAt > 0, "main.cjs has no rebuildAndInstall handler");
const handler = main.slice(rebuildAt, main.indexOf("ipcMain.handle(", rebuildAt + 20));
assert.ok(/status === "working"/.test(handler), "the rebuild must refuse while a teammate is mid-turn");
assert.ok(/rebuilding/.test(handler), "two concurrent rebuilds share one dist/ and must not be allowed");
// Never relaunches itself.
assert.ok(
  !/app\.relaunch\(\)/.test(handler),
  "installing must not restart the app — the pane asks first"
);
assert.ok(/label="Relaunch into the new build"/.test(pane), "there must be an explicit relaunch control");
assert.ok(/rebuild === "done" &&/.test(pane), "the relaunch control only appears after a successful install");

// ── 5. /Applications is never half-written ────────────────────────────────
const src = read("electron/build-info.cjs");
const swap = src.slice(src.indexOf("function install("));
assert.ok(/\.Hydo\.app\.staged/.test(swap), "the new bundle must be staged beside the target, not written over it");
assert.ok(/renameSync/.test(swap), "the swap must be a rename — a copy over the live app can be interrupted");
assert.ok(/ditto/.test(swap), "cp -R breaks a .app's framework symlinks; ditto is the right tool");
// The rollback: if the second rename fails the old app goes back.
assert.ok(/if \(had\) fs\.renameSync\(old, target\)/.test(swap), "a failed swap must restore the previous app");

// Prove the swap really is atomic-by-rename, on a temp directory rather than
// on the user's real /Applications.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-install-"));
try {
  const fake = path.join(sandbox, "src.app");
  fs.mkdirSync(path.join(fake, "Contents"), { recursive: true });
  fs.writeFileSync(path.join(fake, "Contents", "marker"), "v1");
  const first = buildInfo.install(fake, sandbox);
  assert.equal(first.replaced, false);
  assert.equal(fs.readFileSync(path.join(sandbox, "Hydo.app", "Contents", "marker"), "utf8"), "v1");
  fs.writeFileSync(path.join(fake, "Contents", "marker"), "v2");
  const second = buildInfo.install(fake, sandbox);
  assert.equal(second.replaced, true, "a second install must report that it replaced the old bundle");
  assert.equal(fs.readFileSync(path.join(sandbox, "Hydo.app", "Contents", "marker"), "utf8"), "v2");
  // No debris: the staging and backup directories must both be gone.
  assert.equal(fs.existsSync(path.join(sandbox, ".Hydo.app.staged")), false);
  assert.equal(fs.existsSync(path.join(sandbox, ".Hydo.app.previous")), false);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

// ── 6. the thing it cannot do is said, not drawn ──────────────────────────
// There is no git remote, no valid gh token and no electron-updater, so a
// "Check for updates" button would fail every time it was pressed.
// Matched case-insensitively and without leading words: the sentence was
// shortened once already ("There is no auto-updater and no download..." ->
// "No auto-updater — ..."), and a test that pins prose verbatim blocks every
// edit that makes the prose better. What must survive is the FACT.
assert.ok(/no auto-updater/i.test(pane), "the pane must say plainly that there is no auto-updater");
assert.equal(
  Object.keys(pkg.dependencies || {}).includes("electron-updater"),
  false,
  "if electron-updater is ever added, this pane's copy has to change with it"
);
assert.equal(pkg.build.publish, undefined, "there is no publish target; the pane says so");

console.log("updates-pane-test ok");
