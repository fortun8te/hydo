"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const A = require("../electron/artifacts.cjs");

const ROOT = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-art-"));
const ws = path.join(tmp, "bots", "b1", "workspace");
fs.mkdirSync(ws, { recursive: true });
fs.writeFileSync(path.join(ws, "chart.html"), "<h1>steps</h1>");
fs.writeFileSync(path.join(ws, "data.csv"), "day,steps\nmon,900\n");
fs.writeFileSync(path.join(tmp, "secret.html"), "<h1>not yours</h1>");

// ---- classify --------------------------------------------------------------
assert.equal(A.classify("https://example.com").kind, "url");
assert.equal(A.classify("http://localhost:5173").kind, "server");
assert.equal(A.classify("http://127.0.0.1:3000/x").kind, "server");
assert.equal(A.classify("/a/b.html").kind, "file");
assert.equal(A.classify("file:///a/b.html").filePath, "/a/b.html");
assert.equal(A.classify("").kind, "none");

// ---- CONTAINMENT. The path comes from a model; assume it is hostile. -------
const outside = [
  "/etc/passwd",
  path.join(ws, "..", "..", "..", "secret.html"),
  path.join(tmp, "secret.html"),
  path.join(ws, "../../../../../../etc/hosts"),
];
for (const bad of outside) {
  const res = A.readArtifact(ws, bad);
  assert.equal(res.ok, false, `must refuse ${bad}`);
  assert.equal(res.reason, "outside-workspace", `and say why for ${bad}`);
}

// A sibling workspace whose path is a string-prefix of this one must NOT pass:
// "…/bots/b1/workspace2" starts with "…/bots/b1/workspace".
const sibling = ws + "2";
fs.mkdirSync(sibling, { recursive: true });
fs.writeFileSync(path.join(sibling, "x.html"), "<p>other bot</p>");
assert.equal(A.readArtifact(ws, path.join(sibling, "x.html")).reason, "outside-workspace");

// A symlink pointing out of the workspace is still out of the workspace.
const link = path.join(ws, "escape.html");
try {
  fs.symlinkSync(path.join(tmp, "secret.html"), link);
  assert.equal(A.readArtifact(ws, link).reason, "outside-workspace", "symlinks do not escape");
} catch (e) {
  if (e.code !== "EPERM") throw e;
}

// ---- the happy path --------------------------------------------------------
const okRes = A.readArtifact(ws, path.join(ws, "chart.html"));
assert.equal(okRes.ok, true);
assert.equal(okRes.kind, "html");
assert.equal(okRes.text, "<h1>steps</h1>");
assert.equal(A.readArtifact(ws, path.join(ws, "data.csv")).kind, "csv");
assert.equal(A.readArtifact(ws, path.join(ws, "nope.html")).reason, "missing");
fs.writeFileSync(path.join(ws, "app.exe"), "x");
assert.equal(A.readArtifact(ws, path.join(ws, "app.exe")).reason, "unsupported");

// A URL is never read off disk.
assert.equal(A.readArtifact(ws, "https://example.com").ok, true);
assert.equal(A.readArtifact(ws, "https://example.com").text, undefined);

// Size cap.
fs.writeFileSync(path.join(ws, "huge.html"), "x".repeat(A.MAX_BYTES + 10));
assert.equal(A.readArtifact(ws, path.join(ws, "huge.html")).reason, "too-big");

// ---- versioning keys -------------------------------------------------------
assert.equal(A.artifactKey("b1", "/w/a.html"), A.artifactKey("b1", "/w/a.html"));
assert.notEqual(A.artifactKey("b1", "/w/a.html"), A.artifactKey("b2", "/w/a.html"));
assert.notEqual(A.artifactKey("b1", "/w/a.html"), A.artifactKey("b1", "/w/b.html"));
assert.equal(A.titleFor("/w/chart.html", ""), "chart.html");
assert.equal(A.titleFor("/w/chart.html", "Steps"), "Steps");

// ---- THE SANDBOX. This is the security property; assert it in the source. --
const art = fs.readFileSync(path.join(ROOT, "src", "screens", "Artifact.jsx"), "utf8");
assert.ok(art.includes('const SANDBOX = "allow-scripts"'), "sandbox is allow-scripts");
assert.ok(
  !/allow-same-origin/.test(art.replace(/allow-same-origin`/g, "").replace(/\ballow-same-origin\b(?=[^"']*\*\/)/g, "")) ||
    !/sandbox=\{?["'][^"']*allow-same-origin/.test(art),
  "allow-same-origin must never appear in the sandbox attribute"
);
assert.ok(art.includes("srcDoc"), "content goes in via srcdoc");
// An iframe `src` is only ever allowed to be a `data:` URI produced by the
// reader. A PATH would give the frame a real file:// origin and with it the
// ability to read the disk; a data: URI in a sandboxed frame stays opaque.
{
  const srcs = [...art.matchAll(/<iframe[\s\S]{0,400}?\bsrc=\{([^}]+)\}/g)].map((m) => m[1].trim());
  for (const expr of srcs) {
    assert.equal(expr, "art.src", `iframe src must be the reader's data: URI, got ${expr}`);
  }
  // …and the reader must only ever put a data: URI in `src`.
  const reader = fs.readFileSync(path.join(ROOT, "electron", "artifacts.cjs"), "utf8");
  const assigns = [...reader.matchAll(/src: ([^,\n}]+)/g)].map((m) => m[1].trim());
  for (const a of assigns) {
    assert.ok(/^`data:/.test(a), `reader src must be a data: URI, got ${a}`);
  }
}
assert.ok(art.includes('sandbox={SANDBOX}'), "the frame uses the constant");

// The gateway must actually deliver the event that starts all this.
const gw = fs.readFileSync(path.join(ROOT, "electron", "hermes-gateway.cjs"), "utf8");
assert.ok(gw.includes("'preview.open'"), "preview.open is handled, not dropped");
assert.ok(gw.includes("onArtifact"), "and forwarded to the store");
const store = fs.readFileSync(path.join(ROOT, "electron", "store.cjs"), "utf8");
assert.ok(store.includes("recordArtifact"), "the store records artifacts");
assert.ok(store.includes("onArtifact:"), "and is subscribed to the event");
// The owning bot decides the workspace, never the caller.
assert.ok(
  /readArtifact\(artifactId\)\s*\{[\s\S]*botHome\.prepare\(dir, row\.botId\)/.test(store),
  "the workspace comes from the artifact's own bot"
);

console.log("artifact-test ok");

// ---- the renderer's document handling -------------------------------------
// Not imported (it is JSX); asserted against the source, which is where the
// bug was: `/<html[\s>]/` alone missed `<!doctype html><meta…>`, a complete
// document that never writes the tag, and wrapping one nests a doctype inside
// <body> — a blank pane for a perfectly good file.
assert.ok(art.includes("function isDocument"), "complete documents are detected");
assert.ok(/<!doctype/.test(art), "…including by doctype, not just <html>");
assert.ok(art.includes("<head[") || art.includes("<head[\\s>]"), "…and by <head>");
assert.ok(/isDocument\(body\) \? body : shell\(body\)/.test(art), "and passed through unwrapped");

// A chart must not flash white before its own CSS lands.
assert.ok(art.includes("color-scheme: dark"), "the shell is dark by default");
// CSV goes through a real parser, not split(',') — quoted fields contain commas.
assert.ok(art.includes("function parseCsv"), "csv is parsed properly");
assert.ok(art.includes("escapeHtml"), "text kinds are escaped, not injected raw");

// The soul has to tell bots this exists, or nothing will ever call open_preview.
const soul = fs.readFileSync(path.join(ROOT, "electron", "SOUL.default.md"), "utf8");
// The soul routes to the skill rather than restating the tool: the method
// lives in `hydo-artifact`, which loads on demand and costs nothing per turn.
// What the soul must still guarantee is that a bot can FIND it.
assert.ok(soul.includes("hydo-artifact"), "soul routes to the artifact skill");
assert.ok(/^\|.*`hydo-artifact`.*\|$/m.test(soul), "from the skill routing table");
const skill = fs.readFileSync(
  path.join(require("node:os").homedir(), ".hermes", "skills", "hydo-artifact", "SKILL.md"),
  "utf8"
);
assert.ok(skill.includes("open_preview"), "and the skill itself teaches the tool");

console.log("artifact renderer ok");
