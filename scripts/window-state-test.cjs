"use strict";

/**
 * The window opens where you left it.
 *
 * Every launch used to be exactly 1280x860 at the OS default position, so
 * resizing Hydo was something you did once per session, forever.
 *
 * The interesting part is not saving, it is refusing to restore. Two ways this
 * feature bricks an app, both guarded here:
 *
 *   - a rect on a monitor that is no longer plugged in puts the window
 *     somewhere you cannot click, and
 *   - saving `getBounds()` while fullscreen means the next launch opens at
 *     display size with no title bar to grab.
 *
 * The geometry itself was round-tripped through a real BrowserWindow
 * (save 1100x720 at 120,90 -> relaunch -> identical rect).
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const main = fs.readFileSync(path.join(__dirname, "..", "electron/main.cjs"), "utf8");

assert.ok(/loadWindowState/.test(main) && /saveWindowState/.test(main), "state is saved and restored");
assert.ok(/window\.json/.test(main), "kept beside the store, not inside it — geometry belongs to this screen, not to the user's teammates");

// Never trust a saved rect.
assert.ok(/getAllDisplays\(\)/.test(main), "the rect is checked against the CURRENT displays");
// The two floors have to be the SAME number, or a legitimately narrow saved
// window is discarded and the app reopens at its default size every launch.
// Read out of the source rather than pinned to a literal: `minWidth` was 980
// and is now 400, and a test that hardcodes it just has to be edited again.
{
  const floor = main.match(/minWidth:\s*(\d+)/);
  const height = main.match(/minHeight:\s*(\d+)/);
  assert.ok(floor && height, "main.cjs names a minWidth and a minHeight");
  assert.ok(
    new RegExp(`width < ${floor[1]} \\|\\| height < ${height[1]}`).test(main),
    `a rect under the app's own minimums (${floor[1]}x${height[1]}) is discarded rather than fought with`
  );
}
assert.ok(
  /getNormalBounds\(\)/.test(main) && !/win\.getBounds\(\)/.test(main),
  "save the NORMAL bounds; persisting a fullscreen rect opens an unreachable window next time"
);

// Writing on every frame of a drag is a disk write per frame.
assert.ok(/setTimeout\(\(\) => saveWindowState\(win\), \d+\)/.test(main), "resize/move are debounced");
assert.ok(/win\.on\("close"/.test(main), "and flushed on close, since the debounce may not have fired");
assert.ok(/isMinimized\(\)/.test(main), "a minimised window's rect is not the one to remember");

// Geometry is a convenience and must never be the reason a quit fails.
const save = /function saveWindowState\([\s\S]*?\n\}/.exec(main);
assert.ok(save && /catch/.test(save[0]), "saving is wrapped — a bad write must not break quit");
const load = /function loadWindowState\([\s\S]*?\n\}/.exec(main);
assert.ok(load && /catch/.test(load[0]), "loading is wrapped — a corrupt file must not break launch");

console.log("window-state-test ok");
