"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const K = require("../electron/preview-kinds.cjs");
const ROOT = path.join(__dirname, "..");

// ---- breadth ---------------------------------------------------------------
const all = Object.values(K.known()).flat();
assert.ok(all.length > 150, `a lot of formats, got ${all.length}`);

const expect = {
  "main.ts": "text", "app.tsx": "text", "s.py": "text", "m.go": "text",
  "a.rs": "text", "b.swift": "text", "c.kt": "text", "d.rb": "text",
  "e.css": "text", "f.scss": "text", "g.sql": "text", "h.yaml": "text",
  "i.toml": "text", "j.diff": "text", "k.ipynb": "text", "l.tex": "text",
  "m.sh": "text", "n.tf": "text", "o.graphql": "text", "p.vue": "text",
  "q.png": "image", "r.jpg": "image", "s.webp": "image", "t.avif": "image",
  "u.svg": "vector",
  "v.mp4": "video", "w.mov": "video", "x.webm": "video",
  "y.mp3": "audio", "z.wav": "audio", "aa.flac": "audio",
  "bb.pdf": "pdf",
  "cc.docx": "doc", "dd.doc": "doc", "ee.rtf": "doc", "ff.odt": "doc",
  "gg.xlsx": "sheet", "hh.ods": "sheet",
  "ii.pptx": "slides",
  "jj.zip": "archive", "kk.tar": "archive",
  "ll.obj": "model3d", "mm.glb": "model3d", "nn.stl": "model3d",
  "oo.ttf": "font", "pp.woff2": "font",
};
for (const [f, kind] of Object.entries(expect)) {
  assert.equal(K.kindOf(f).kind, kind, `${f} should be ${kind}`);
}

// ---- extensionless files -------------------------------------------------
// The bug this guards: an "" entry in the extension table caught every
// extensionless file BEFORE the by-name lookup, so Dockerfile lost its
// language and .gitignore was classified by nothing.
assert.equal(K.kindOf("Dockerfile").lang, "dockerfile");
assert.equal(K.kindOf("Makefile").lang, "makefile");
assert.equal(K.kindOf("README").lang, "markdown");
assert.equal(K.kindOf("Gemfile").lang, "ruby");
assert.equal(K.kindOf(".gitignore").kind, "text");
assert.equal(K.kindOf(".babelrc").lang, "json");
assert.equal(K.kindOf(".env.local").kind, "text");
assert.ok(!Object.prototype.hasOwnProperty.call(K.TEXT, ""), "no catch-all empty extension");

// A leading dot is the whole name, not an extension.
assert.equal(K.kindOf(".hidden.png").kind, "image", "a dotted name still keeps its real ext");
// Unknown extensions are honestly unknown; the chip reader sniffs for text.
assert.equal(K.kindOf("thing.qqq").kind, "unknown");
// No extension and no known name is still probably text, and showing it is
// recoverable where refusing is not.
assert.equal(K.kindOf("noext").kind, "text");
// Path segments must not confuse it.
assert.equal(K.kindOf("/a/b.c/d/main.py").kind, "text");

// ---- case ------------------------------------------------------------------
assert.equal(K.kindOf("PHOTO.PNG").kind, "image");
assert.equal(K.kindOf("Report.DOCX").kind, "doc");

// ---- one registry, both readers -------------------------------------------
const art = fs.readFileSync(path.join(ROOT, "electron", "artifacts.cjs"), "utf8");
const chip = fs.readFileSync(path.join(ROOT, "electron", "file-preview.cjs"), "utf8");
assert.ok(art.includes("preview-kinds.cjs"), "the artifact pane uses the registry");
assert.ok(chip.includes("readArtifact"), "and the chip reader shares the same path");
// Converters must be things already on the machine, not a bundled library.
assert.ok(art.includes("textutil"), "Word family via macOS textutil");
assert.ok(art.includes('"uv"'), "spreadsheets via uv, which installs nothing");
assert.ok(art.includes("timeout:"), "every subprocess is bounded");
assert.ok(art.includes("MAX_BINARY"), "binaries are size-capped before inlining");

// Containment still holds for every new kind.
assert.equal(K.kindOf("x.png").kind, "image");
const A = require("../electron/artifacts.cjs");
assert.equal(A.readArtifact(ROOT, "/etc/hosts").reason, "outside-workspace");

console.log("preview-kinds-test ok");
