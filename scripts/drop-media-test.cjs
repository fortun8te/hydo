#!/usr/bin/env node
"use strict";

/**
 * drop-media-test.cjs — dropping a file, and a photo sent with text.
 *
 * Both were reported by screenshot. Both were real:
 *
 *   - the drop target was the composer strip ALONE. Dragging onto the
 *     transcript — most of the window, and the obvious place to aim — did
 *     nothing, and nothing highlighted, so a miss was indistinguishable from
 *     the feature not existing. Dropping a PDF was answered with total
 *     silence.
 *   - images rendered INSIDE the bubble, so a photo sent with a line of text
 *     came out boxed by the bubble's padding and cropped to its width.
 *
 * Driven through a real BrowserWindow with real DragEvents carrying real
 * Files, because "does a drag get recognised" is not a question source can
 * answer.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const RUN = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-dropmedia-"));
const OUTDIR = path.join(RUN, "dist");
const OUT = path.join(RUN, "res.json");

// `--mode development` AND NODE_ENV, or `import.meta.env.DEV` is false and the
// devmock sign-in never renders (measured: "sign-in did not reach the shell").
execFileSync("npx", ["vite", "build", "--mode", "development", "--outDir", OUTDIR, "--emptyOutDir"], {
  cwd: ROOT,
  stdio: "ignore",
  timeout: 5 * 60 * 1000,
  env: { ...process.env, NODE_ENV: "development" },
});

const electron = require(path.join(ROOT, "node_modules", "electron"));
execFileSync(electron, [path.join(__dirname, "drop-media-shot.cjs"), OUTDIR, OUT], {
  cwd: ROOT,
  stdio: "ignore",
  timeout: 4 * 60 * 1000,
});

const res = JSON.parse(fs.readFileSync(OUT, "utf8"));
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

console.log("drop-media-test");

test("dragging a file over the TRANSCRIPT is recognised and says so", () => {
  assert.equal(res.dragOverTranscript.ok, true, res.dragOverTranscript.why || "the drag was not dispatched");
  assert.equal(
    res.dragOverTranscript.overlay,
    true,
    "no drop target appeared — this is the reported bug: dragging onto the chat area did nothing"
  );
  assert.match(res.dragOverTranscript.overlayText, /drop to attach/i);
});

test("leaving clears it", () => {
  // dragleave fires for every child crossed, so a naive boolean flickers off
  // the moment the pointer passes over a bubble. The handler counts depth.
  assert.equal(res.afterLeave.overlay, false, "the overlay stayed up after the drag left");
});

test("a file that cannot be attached says why, instead of vanishing", () => {
  assert.ok(res.dropPdf.note, "dropping a PDF was answered with silence again");
  assert.match(res.dropPdf.note, /not an image|skipped/i);
  assert.match(res.dropPdf.note, /\+ button/, "it must point at the way that does work");
  assert.equal(res.dropPdf.overlay, false, "the overlay survived the drop");
});

test("a photo is its own block, not boxed inside the bubble", () => {
  assert.equal(res.media.found, true, "no image rendered at all");
  assert.equal(res.media.insideBubble, false, "the photo is still inside the text bubble");
  assert.equal(res.media.ownLine, true, "the photo is not on its own line above the bubble");
  assert.equal(res.media.objectFit, "contain", "cover crops away the part worth sending");
});

test("the photo actually has size on screen", () => {
  // The whole point of the app's signature bug class: present in the DOM,
  // zero pixels on screen. Measured 0x0 through RichContent's ImageGrid,
  // which is why the media line renders the plain path instead.
  assert.ok(res.media.width > 0, `the photo rendered ${res.media.width}px wide`);
  assert.ok(res.media.height > 0, `the photo rendered ${res.media.height}px tall`);
});

if (failed) {
  console.log(`drop-media-test FAILED (${failed})`);
  process.exit(1);
}
console.log("drop-media-test ok — drops are seen, refusals are spoken, photos have their own block");
