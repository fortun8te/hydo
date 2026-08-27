"use strict";

/**
 * Preview for a file CHIP in the transcript.
 *
 * Thin wrapper over `artifacts.readArtifact` so a file is never viewable in
 * the artifact pane and dead as a chip. The only difference is that a chip is
 * not owned by a bot's workspace: it is a file the user or a tool named, so
 * containment is the caller's business and the whole disk is in scope here.
 */

const fs = require("node:fs");
const path = require("node:path");
const kinds = require("./preview-kinds.cjs");

const MAX = 400000;

function previewFile(filePath) {
  const abs = path.resolve(String(filePath || ""));
  const name = path.basename(abs);
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { ok: false, reason: "missing", name };
  }
  // `readArtifact` bounds to a root; the chip path has none, so pass the file's
  // own directory as the root — containment is then trivially satisfied and
  // the shared classification, converters and size caps all still apply.
  const { readArtifact } = require("./artifacts.cjs");
  const res = readArtifact(path.dirname(abs), abs);
  if (res.ok && typeof res.text === "string" && res.text.length > MAX) {
    return { ...res, text: `${res.text.slice(0, MAX)}\n\u2026`, truncated: true };
  }
  if (res.ok) return res;
  // Unknown type: still show the bytes if they look like text, rather than
  // refusing outright. A chip that cannot open is worse than a rough preview.
  const c = kinds.kindOf(name);
  if (c.kind === "unknown") {
    try {
      const buf = fs.readFileSync(abs);
      const head = buf.subarray(0, 4096);
      // NUL byte anywhere near the start means binary; do not print it.
      if (!head.includes(0)) {
        return { ok: true, kind: "text", name, path: abs, text: buf.toString("utf8").slice(0, MAX) };
      }
    } catch {
      /* fall through to the failure below */
    }
  }
  return res;
}

module.exports = { previewFile, MAX };
