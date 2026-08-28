"use strict";

/**
 * Durable regression coverage for three UI fixes, all measured in a real
 * BrowserWindow with computed geometry rather than asserted on source text —
 * this app's own signature bug is a rule that applies its class and changes
 * no pixels (a more-specific selector silently wins), which no grep can see.
 *
 * 1. Home empty-state: "New teammate" (.ghost.ghost--solid) and "New channel"
 *    (.ghost) must render at the SAME height in both themes. Measured with
 *    getBoundingClientRect, not asserted equal by pinning a height.
 * 2. Settings account avatar: clicking the avatar itself must open a bigger
 *    preview (MediaViewer) without also opening the file picker; clicking the
 *    small camera badge must open the file picker without also opening the
 *    preview. The two gestures must not fire on the same click.
 * 3. Command palette tabs: "Bots" must hide every command row and keep every
 *    bot row; "Actions" must do the reverse. A tab that changes nothing is
 *    the dead-control bug scripts/dead-control-test.cjs exists to catch.
 *
 * Built with `vite build --mode development` (not the prod build) so
 * `import.meta.env.DEV` stays true and the devmock sign-in path renders —
 * see the same note in scripts/settings-groups-test.cjs.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const OUTDIR = path.join(os.tmpdir(), "hydo-three-fixes-dist");
const UD = path.join(os.tmpdir(), "hydo-three-fixes-ud");
const OUT = path.join(os.tmpdir(), "hydo-three-fixes-result.json");

fs.rmSync(UD, { recursive: true, force: true });

execFileSync("npx", ["vite", "build", "--mode", "development", "--outDir", OUTDIR, "--emptyOutDir"], {
  cwd: ROOT,
  stdio: "ignore",
  timeout: 5 * 60 * 1000,
  env: { ...process.env, NODE_ENV: "development" },
});

const electron = require(path.join(ROOT, "node_modules", "electron"));
execFileSync(electron, [path.join(__dirname, "three-ui-fixes-shot.cjs"), OUTDIR, UD, OUT], {
  cwd: ROOT,
  stdio: "inherit",
  timeout: 60 * 1000,
});

const r = JSON.parse(fs.readFileSync(OUT, "utf8"));

// -- 1. Home empty-state buttons --------------------------------------------
for (const theme of ["dark", "light"]) {
  const b = r.homeButtons[theme];
  assert.ok(b, `home buttons not measured in ${theme}`);
  assert.ok(b.solid && b.ghost, `both empty-state buttons must exist in ${theme}`);
  assert.equal(
    b.solid.height,
    b.ghost.height,
    `${theme}: "New teammate" (${b.solid.height}px) and "New channel" (${b.ghost.height}px) must be the same height`
  );
  assert.equal(b.solid.border, b.ghost.border, `${theme}: the two buttons must carry the same border width`);
}

// -- 2. Settings avatar preview vs. change ----------------------------------
assert.ok(r.avatar, "avatar interaction was not measured");
assert.equal(r.avatar.previewAfterAvatarClick, true, "clicking the avatar must open the MediaViewer preview");
assert.equal(
  r.avatar.fileDialogAfterAvatarClick,
  false,
  "clicking the avatar must NOT also open the file picker (one click, one gesture)"
);
assert.equal(
  r.avatar.previewAfterBadgeClick,
  false,
  "clicking the small camera badge must NOT open the preview (its click stops propagation)"
);
assert.equal(r.avatar.fileDialogAfterBadgeClick, true, "clicking the camera badge must open the file picker");
assert.equal(r.avatar.previewImageNatural, true, "the preview must show the avatar image, not an empty viewer");

// -- 3. Command palette tabs actually filter ---------------------------------
assert.ok(r.palette, "palette tabs were not measured");
assert.ok(r.palette.all.cmdCount > 0, "the 'All' tab must show at least one command row to begin with");
assert.ok(r.palette.all.botCount > 0, "the 'All' tab must show at least one bot row (fixture agents were seeded)");
assert.equal(r.palette.bots.cmdCount, 0, "the 'Bots' tab must hide every command row");
assert.equal(r.palette.bots.botCount, r.palette.all.botCount, "the 'Bots' tab must keep every bot row");
assert.equal(r.palette.actions.botCount, 0, "the 'Actions' tab must hide every bot row");
assert.equal(r.palette.actions.cmdCount, r.palette.all.cmdCount, "the 'Actions' tab must keep every command row");

console.log("three-ui-fixes-test ok — home buttons, avatar preview/change split, palette tabs all verified in a real window");
