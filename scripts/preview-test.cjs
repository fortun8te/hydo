"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");

async function loadPreview() {
  return import(pathToFileURL(path.join(ROOT, "src/lib/file-preview.js")).href);
}

async function loadSpin() {
  return import(pathToFileURL(path.join(ROOT, "src/umbra/spin-turn.js")).href);
}

async function main() {
  const prev = await loadPreview();
  assert.equal(prev.normKind("", ".nd"), "nd");
  assert.equal(prev.KIND_LABEL.nd, "ND document");
  assert.equal(prev.isTextish({ name: "notes.nd" }), true);
  assert.equal(prev.normKind("", "pdf"), "pdf");
  assert.equal(prev.normKind("", ".html"), "html");
  assert.equal(prev.isTextish({ name: "page.html" }), true);
  assert.equal(prev.normKind("", "zip"), "archive");
  assert.equal(prev.isPropertyZip({ name: "property.zip" }), true);
  assert.equal(prev.isTextish({ name: "photo.png" }), false);

  const spin = await loadSpin();
  assert.equal(spin.spinTurn(0), 0);
  const mid = spin.spinTurn(0.4);
  assert.ok(mid > 10 && mid < 350, `mid revolution ${mid}`);
  const endMotion = spin.spinTurn(1 - spin.SPIN_PAUSE - 0.001);
  assert.ok(endMotion > 300, `ease-out near 360, got ${endMotion}`);
  const pause = spin.spinTurn(1 - spin.SPIN_PAUSE / 2);
  assert.ok(Math.abs(pause) <= spin.SPIN_WOBBLE + 0.01, `wobble ${pause}`);

  const { previewFile } = require(path.join(ROOT, "electron/file-preview.cjs"));
  const pdf = path.join(os.tmpdir(), "hydo-empty.pdf");
  fs.writeFileSync(pdf, "%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const blob = previewFile(pdf);
  assert.equal(blob.ok, true);
  assert.ok(String(blob.src).startsWith("data:application/pdf;base64,"));

  const { listZip } = require(path.join(ROOT, "electron/zip-list.cjs"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-zip-"));
  const zipPath = path.join(dir, "property.zip");
  const inner = path.join(dir, "hello.nd");
  fs.writeFileSync(inner, "title: demo\n");
  const zipped = spawnSync("zip", ["-j", zipPath, inner], { encoding: "utf8" });
  if (zipped.status === 0 && fs.existsSync(zipPath)) {
    const listed = listZip(zipPath);
    assert.equal(listed.ok, true);
    assert.ok(
      listed.entries.some((e) => e.name.endsWith("hello.nd")),
      JSON.stringify(listed.entries)
    );
  } else {
    // zip(1) missing — still prove the parser rejects garbage
    fs.writeFileSync(zipPath, "not a zip");
    const listed = listZip(zipPath);
    assert.equal(listed.ok, false);
  }

  console.log("preview-test ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
