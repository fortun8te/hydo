"use strict";

/**
 * Whose name is this app wearing?
 *
 * Three separate bugs met here, and every one of them shipped:
 *
 *   1. `state.settings.userName` seeded to the literal "Michael" — the
 *      developer's name — in six places, including the fallback every prompt
 *      read when addressing the user. On anyone else's machine the app opened
 *      already calling them Michael.
 *   2. `accountName()` DISCARDED a stored one-word name and returned a
 *      hardcoded "Michael Knaap", so setting your name to "Sam" changed
 *      nothing. A one-word name is a name.
 *   3. There was no field anywhere in the app to set it.
 *
 * None of it errored, which is why it lasted.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const store = fs.readFileSync(path.join(ROOT, "electron/store.cjs"), "utf8");
const shell = fs.readFileSync(path.join(ROOT, "src/screens/Shell.jsx"), "utf8");
const settings = fs.readFileSync(path.join(ROOT, "src/screens/Settings.jsx"), "utf8");

// ---- nobody's name is baked in ---------------------------------------------
//
// Strip comments first: these very files explain the bug BY NAMING IT, and a
// test that cannot tell an explanation from a value would ban writing the
// explanation down.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const codeOnly = strip(store);
const shellCode = strip(shell);
assert.ok(!/"Michael"/.test(codeOnly), "no hardcoded first name in the store");
assert.ok(!/Michael Knaap/.test(shellCode), "no hardcoded full name in the shell");
assert.ok(!/ACCOUNT_FULL_NAME/.test(shellCode), "and the constant is gone, not merely unused");

// ---- the default comes from the machine, with a neutral floor --------------
assert.ok(/const DEFAULT_USER_NAME =/.test(store), "there is one named default");
assert.ok(/os\.userInfo\(\)/.test(store), "seeded from the OS account name");
assert.ok(/"You"/.test(store), 'and floors at "You" — a teammate saying "You" is plain; saying a stranger\'s name is uncanny');
assert.ok(/userName: DEFAULT_USER_NAME/.test(store), "fresh installs use it");

// ---- a one-word name survives ----------------------------------------------
const fn = /function accountName\(settings\) \{[\s\S]*?\n\}/.exec(shell);
assert.ok(fn, "accountName exists");
assert.ok(
  !/includes\(" "\)/.test(fn[0]),
  "a one-word name must NOT be thrown away for containing no space"
);
// Run the real logic rather than reading it.
const accountName = new Function("settings", fn[0] + "\nreturn accountName(settings);");
assert.strictEqual(accountName({ userName: "Sam" }), "Sam", "one word is a name");
assert.strictEqual(accountName({ userName: "Sam Vimes" }), "Sam Vimes", "so is two");
assert.strictEqual(
  accountName({ userName: "Sam", userFullName: "Samuel Vimes" }),
  "Samuel Vimes",
  "an explicit full name still wins"
);
assert.strictEqual(accountName({}), "You", "and nothing at all is not somebody else");

// ---- it is bounded, because it reaches prompts ------------------------------
assert.ok(
  /hasOwnProperty\.call\(patch, "userName"\)/.test(store),
  "the patch is validated, not merged blind"
);
assert.ok(/slice\(0, 60\)/.test(store), "capped: this string lands in prompts and in state.json");
assert.ok(
  /state\.settings\.userName = v \|\| DEFAULT_USER_NAME/.test(store),
  "clearing the field falls back rather than leaving the sidebar blank"
);

// ---- and there is somewhere to type it -------------------------------------
assert.ok(/aria-label="Your name"|ariaLabel="Your name"/.test(settings), "Settings has a name field");
assert.ok(/onChange=\{\(userName\) => onChange\(\{ userName \}\)\}/.test(settings), "wired to the store");

console.log(`user-name-test ok (this machine would default to "${
  (() => { try { const u = os.userInfo().username; return u.charAt(0).toUpperCase() + u.slice(1); } catch { return "You"; } })()
}")`);
