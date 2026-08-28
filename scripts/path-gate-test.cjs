#!/usr/bin/env node
"use strict";

/**
 * path-gate-test.cjs — which paths the RENDERER is allowed to name.
 *
 * `hydo:previewFile` read any path it was given and `hydo:saveFile` copied any
 * path out. The renderer is sandboxed, but it renders artifacts a model wrote,
 * so "the renderer asked" is not "the user asked" -- and `~/.ssh/id_rsa` was as
 * valid an argument as an attachment.
 *
 * The rule is consent-based rather than a blanket ban, because a blanket ban
 * would break attaching a file from anywhere outside Hydo's own directories,
 * which is most files: the native picker IS the consent, so a picked path is
 * allowed and everything else must live under a directory Hydo owns.
 *
 * The predicate is lifted out of main.cjs and RUN, not pattern-matched, so a
 * rewrite that keeps the name and loses the rule fails here.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { stripComments } = require("./lib/source-scan.cjs");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}

const main = stripComments(fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8"));

const grab = (re, what) => {
  const m = main.match(re);
  assert.ok(m, `${what} is gone from electron/main.cjs`);
  return m[0];
};
const src = [
  grab(/const pickedPaths = new Set\(\);/, "pickedPaths"),
  grab(/function rememberPicked\(p\) \{[\s\S]*?\n\}/, "rememberPicked"),
  grab(/function allowedRoots\(\) \{[\s\S]*?\n\}/, "allowedRoots"),
  grab(/function pathAllowed\(p\) \{[\s\S]*?\n\}/, "pathAllowed"),
].join("\n");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-gate-"));
// eslint-disable-next-line no-new-func
const mod = new Function(
  "path",
  "process",
  "app",
  `${src}; return { pathAllowed, rememberPicked, pickedPaths };`
)(path, { env: {} }, { getPath: () => ROOT });

test("Hydo's own directory is readable", () => {
  assert.equal(mod.pathAllowed(path.join(ROOT, "artifacts", "chart.png")), true);
  assert.equal(mod.pathAllowed(ROOT), true);
});

test("the rest of the disk is not", () => {
  for (const p of [
    path.join(os.homedir(), ".ssh", "id_rsa"),
    path.join(os.homedir(), ".hermes", "config.yaml"),
    "/etc/passwd",
    path.join(os.homedir(), ".grok", "auth.json"),
  ]) {
    assert.equal(mod.pathAllowed(p), false, `${p} was readable by the renderer`);
  }
});

test("a sibling directory with the same prefix is not inside the root", () => {
  // The classic prefix bug: `${ROOT}-evil` startsWith `${ROOT}`.
  assert.equal(mod.pathAllowed(`${ROOT}-evil/secrets`), false, "a prefix match passed as containment");
});

test("a path the user picked in the native dialog is allowed", () => {
  const picked = path.join(os.homedir(), "Documents", "invoice.pdf");
  assert.equal(mod.pathAllowed(picked), false, "allowed before it was ever picked");
  mod.rememberPicked(picked);
  assert.equal(mod.pathAllowed(picked), true, "the user's own choice was refused");
  // Picking one file grants that file, not its directory.
  assert.equal(
    mod.pathAllowed(path.join(os.homedir(), "Documents", "other.pdf")),
    false,
    "picking one file granted its whole directory"
  );
});

test("traversal does not escape the root", () => {
  assert.equal(mod.pathAllowed(path.join(ROOT, "..", "..", "etc", "passwd")), false);
});

test("empty and rubbish are refused", () => {
  for (const p of ["", null, undefined]) assert.equal(mod.pathAllowed(p), false);
});

test("the picked set is bounded", () => {
  for (let i = 0; i < 600; i += 1) mod.rememberPicked(`/tmp/pick-${i}`);
  assert.ok(mod.pickedPaths.size <= 501, `the picked set grew to ${mod.pickedPaths.size}`);
});

test("every path-taking handler is actually gated", () => {
  for (const h of ["hydo:previewFile", "hydo:saveFile", "hydo:attachAny"]) {
    const at = main.indexOf(h);
    assert.ok(at > 0, `${h} is gone`);
    assert.ok(
      /pathAllowed/.test(main.slice(at, at + 400)),
      `${h} does not check the path it is handed`
    );
  }
  assert.ok(/const attachPath = /.test(main), "the attach handlers lost their gate");
  for (const h of ["hydo:attachFile", "hydo:attachImage", "hydo:attachPdf"]) {
    assert.ok(
      new RegExp(`attachPath\\("${h}"`).test(main),
      `${h} is registered without the path gate`
    );
  }
  // Bytes are not a path, and gating them would just be wrong.
  assert.ok(
    /attach\("hydo:attachImageBytes"/.test(main),
    "attachImageBytes should not be path-gated — it carries bytes"
  );
});

test("the picker records what the user chose", () => {
  const at = main.indexOf('ipcMain.handle("hydo:pickFiles"');
  assert.ok(at > 0, "the picker is gone");
  assert.ok(
    /rememberPicked/.test(main.slice(at, at + 800)),
    "picked files are never remembered, so every attachment outside Hydo would be refused"
  );
});

/**
 * The launch-home leak.
 *
 * `cron.manage` and `learning.*` both go through `request()` with no pin,
 * which resolves the DEFAULT profile -- the user's own ~/.hermes, not any
 * teammate's. Nothing in src/ called either, and two of the four learning
 * methods were WRITES, so the renderer could edit and delete the user's
 * personal learning store under no teammate's name.
 *
 * These stay off the bridge until the RPCs take a `profile` param. The test
 * is written against the BRIDGE, not against the gateway functions, because
 * keeping those for main-side use is fine -- what must not exist is a way for
 * renderer code to reach them.
 */
const preload = stripComments(
  fs.readFileSync(path.join(__dirname, "..", "electron", "preload.cjs"), "utf8")
);

test("the dead cron bridge is gone", () => {
  assert.ok(!/ipcMain\.handle\("hydo:cron"/.test(main), "hydo:cron is still on the bridge");
  assert.ok(!/cron:/.test(preload), "cron is still exposed to the renderer");
});

test("nothing profile-unscoped reaches the renderer", () => {
  for (const m of ["learningFrames", "learningDetail", "learningEdit", "learningDelete"]) {
    assert.ok(
      !new RegExp(`${m}:`).test(preload),
      `${m} is exposed to the renderer but reads the user's own ~/.hermes, not a bot profile`
    );
    assert.ok(
      !new RegExp(`ipcMain\\.handle\\("hydo:${m}"`).test(main),
      `hydo:${m} still has a handler`
    );
  }
  // image.generate and pet.* are named in the same finding; they were never
  // exposed, and this keeps it that way.
  // `insights.get` is read-only, but it is still the USER's own session
  // stats rather than a teammate's, and nothing rendered it.
  assert.ok(!/insights:/.test(preload), "insights is exposed but reads the launch home");
  for (const m of ["imageGenerate", "petGenerate", "petHatch"]) {
    assert.ok(!new RegExp(`${m}:`).test(preload), `${m} was added without profile scoping`);
  }
});

if (failed) {
  console.log(`path-gate-test FAILED (${failed})`);
  process.exit(1);
}
console.log("path-gate-test ok — the renderer names Hydo's files or the user's picks, nothing else");
