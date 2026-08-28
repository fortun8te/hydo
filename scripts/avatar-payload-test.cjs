#!/usr/bin/env node
"use strict";

/**
 * avatar-payload-test.cjs — the picture must not ride on the hot path.
 *
 * MEASURED before this fix, on the user's real state.json: 127,924 bytes
 * total, of which `settings.userAvatar` was 127,534 -- 99.7%. That payload is
 * JSON-cloned by `publicState()` and then structured-cloned across IPC on
 * every push, and the streaming path pushes roughly ten times a second while a
 * reply comes in. Nearly all of the per-token copying cost was one image that
 * had not changed since the user picked it.
 *
 * So the assertions here are about SIZE, not about whether a function exists:
 * a refactor that keeps the token machinery but lets the bytes back into the
 * pushed state would pass a structural test and lose the entire point.
 *
 * The rehydration in preload is asserted too, because the whole reason no
 * component in src/ changed is that the renderer still receives a data URI.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
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

const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const main = stripComments(read("electron/main.cjs"));
const preload = stripComments(read("electron/preload.cjs"));

// A realistic avatar: 128KB of base64, the size measured in the real store.
const BIG = `data:image/png;base64,${"A".repeat(128 * 1024)}`;

// Lift the real token/lightState logic out of main.cjs and run it, rather
// than reimplementing it here where it could drift.
const crypto = require("node:crypto");
const tokenSrc = main.match(/const avatarToken = \(uri\) => \{[\s\S]*?\n  \};/);
assert.ok(tokenSrc, "avatarToken is gone from electron/main.cjs");
const lightSrc = main.match(/const lightState = \(\) => \{[\s\S]*?\n  \};/);
assert.ok(lightSrc, "lightState is gone from electron/main.cjs");

const avatarStash = new Map();
// eslint-disable-next-line no-new-func
const avatarToken = new Function(
  "crypto",
  "avatarStash",
  `${tokenSrc[0].replace(/^  /gm, "")}; return avatarToken;`
)(crypto, avatarStash);

let fakeState;
// eslint-disable-next-line no-new-func
const lightState = new Function(
  "store",
  "avatarToken",
  `${lightSrc[0].replace(/^  /gm, "")}; return lightState;`
)({ getState: () => fakeState }, avatarToken);

test("the pushed state does not carry the avatar bytes", () => {
  fakeState = { settings: { userAvatar: BIG, userName: "Michael" }, agents: [], messages: {} };
  const heavy = JSON.stringify(fakeState).length;
  const light = JSON.stringify(lightState()).length;
  assert.ok(heavy > 100_000, "the fixture avatar is not representative");
  assert.ok(
    light < 1000,
    `the pushed payload is still ${light} bytes — the avatar is riding on the hot path`
  );
  // The real reduction, stated as a ratio so the intent survives a resize.
  assert.ok(light < heavy / 100, "the payload did not shrink by at least 100x");
});

test("the token is stable for the same image and different for another", () => {
  fakeState = { settings: { userAvatar: BIG } };
  const a = lightState().settings.userAvatar;
  const b = lightState().settings.userAvatar;
  assert.equal(a, b, "the same image produced two tokens — the renderer would refetch forever");
  fakeState = { settings: { userAvatar: `${BIG}B` } };
  assert.notEqual(lightState().settings.userAvatar, a, "a different image reused the same token");
});

test("no avatar stays no avatar, not a token for the empty string", () => {
  fakeState = { settings: { userAvatar: "" } };
  assert.equal(lightState().settings.userAvatar, "");
});

test("an already-tokenised state is not tokenised twice", () => {
  fakeState = { settings: { userAvatar: "hydo-avatar:deadbeef" } };
  assert.equal(lightState().settings.userAvatar, "hydo-avatar:deadbeef");
});

test("the stash is bounded", () => {
  for (let i = 0; i < 40; i += 1) {
    fakeState = { settings: { userAvatar: `${BIG}${i}` } };
    lightState();
  }
  assert.ok(avatarStash.size <= 9, `the stash grew to ${avatarStash.size} images — that is a leak`);
});

test("preload hands the renderer a data URI, not a token", () => {
  assert.ok(/function rehydrateAvatar\(/.test(preload), "the rehydration is gone");
  assert.ok(
    /onState: \(fn\) => \{\s*const listener = \(_e, state\) => fn\(rehydrateAvatar\(state, fn\)\)/.test(preload),
    "pushed state reaches the renderer without being rehydrated"
  );
  assert.ok(/hydo:avatarData/.test(preload), "there is no way to fetch the bytes");
  assert.ok(
    /avatarCache/.test(preload),
    "the bytes are fetched with no cache — that is one IPC per push, worse than before"
  );
  // getState is a second door onto the same state.
  const at = preload.indexOf("getState: () =>");
  assert.ok(at > 0, "getState is gone");
  const gs = preload.slice(at, at + 900);
  assert.ok(/hydo-avatar:/.test(gs), "getState() would hand a caller a raw token");
});

test("main still answers with the bytes when asked", () => {
  assert.ok(
    /ipcMain\.handle\("hydo:avatarData"/.test(main),
    "nothing can resolve a token, so the avatar can never render"
  );
});

if (failed) {
  console.log(`avatar-payload-test FAILED (${failed})`);
  process.exit(1);
}
console.log("avatar-payload-test ok — the avatar is off the streaming path");
