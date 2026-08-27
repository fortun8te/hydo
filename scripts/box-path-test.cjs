"use strict";

/**
 * The teammate's shell must be able to find `box`.
 *
 * This is not a style check. The box CLI installs to ~/.ascii/bin, which is on
 * nobody's PATH by default — not a login shell here, and certainly not the
 * environment an Electron app launched from the Dock hands to its Hermes child.
 * The gateway built the child env as `{...process.env}` and nothing else, so a
 * teammate that followed its own AGENTS.md instructions to the letter got
 * `box: command not found`, and the entire shared-machine feature was a
 * paragraph of prose pointing at a binary its shell could not see.
 *
 * Nothing errored. That is why it needs a test rather than a comment.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const gateway = fs.readFileSync(path.join(ROOT, "electron/hermes-gateway.cjs"), "utf8");

// ---- the fix is present, and is guarded ------------------------------------
assert.ok(
  /\.ascii['"],\s*['"]bin['"]/.test(gateway),
  "the gateway must put the box CLI's directory on the child's PATH"
);
assert.ok(
  /fs\.existsSync\(asciiBin\)/.test(gateway),
  "only add the directory when it exists — not every machine has the box CLI"
);
assert.ok(
  /includes\(asciiBin\)/.test(gateway),
  "do not add it twice; a PATH that grows on every restart is its own bug"
);
assert.ok(
  /\$\{asciiBin\}\$\{path\.delimiter\}\$\{env\.PATH\}/.test(gateway),
  "PREPEND, so a box the user installed deliberately elsewhere still wins"
);

// ---- and it actually works on a real child ---------------------------------
//
// Reproduces the env construction and asks a child process to resolve `box`.
// Skipped where the CLI is not installed, because there the honest answer is
// that there is nothing to find.
const asciiBin = path.join(os.homedir(), ".ascii", "bin");
if (fs.existsSync(path.join(asciiBin, "box"))) {
  const base = { ...process.env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  const resolve = (env) => {
    try {
      return execFileSync("sh", ["-lc", "command -v box"], { env, encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  assert.strictEqual(resolve(base), "", "the bare Dock-launch PATH must NOT find box (else this test proves nothing)");
  const fixed = { ...base, PATH: `${asciiBin}${path.delimiter}${base.PATH}` };
  assert.strictEqual(resolve(fixed), path.join(asciiBin, "box"), "with the fix, a child resolves box");
  console.log("box-path-test ok (resolved on a real child)");
} else {
  console.log("box-path-test ok (source guards only; no box CLI on this machine)");
}
