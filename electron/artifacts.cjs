"use strict";

/**
 * Artifacts: things a teammate MADE that you can look at.
 *
 * Hermes has no artifact system. What it has is `open_preview` in the
 * `desktop_ui` toolset, which emits `preview.open {url,label}` where `url` may
 * be an https link, a localhost dev server, or an absolute FILE PATH. The file
 * case is the one that matters: it is a chart, a table, a report the bot just
 * wrote into its own workspace. This module turns that into something the app
 * can show, version, and re-open later.
 *
 * THE SECURITY PROPERTY THAT MUST NOT BE LOST
 *
 * The HTML here is written by a language model. The renderer it would display
 * in holds `window.hydo`, the full preload bridge: filesystem, shell, every
 * IPC channel. Rendering model-authored HTML in that context is a complete
 * escape, not a theoretical one.
 *
 * So this module only ever returns TEXT. It never hands back a path for the
 * renderer to load, and the renderer must put that text in an iframe with
 * `sandbox="allow-scripts"` and NO `allow-same-origin` — an opaque origin, so
 * scripts run but can reach neither the parent nor the disk. See Artifact.jsx.
 *
 * Second rule: a bot may only show files from ITS OWN workspace. The path
 * arrives from a model, so `..` traversal and symlinks out are both assumed
 * hostile and both are checked below.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const kinds = require("./preview-kinds.cjs");

/** Big enough for a real dashboard, small enough not to wedge the renderer. */
const MAX_BYTES = 2_000_000;

// The pane's OWN renderers, by extension. Anything not here still opens: it
// falls through to `preview-kinds.cjs`, which classifies ~200 more.
const KIND_BY_EXT = {
  html: "html",
  htm: "html",
  svg: "svg",
  md: "markdown",
  markdown: "markdown",
  json: "json",
  csv: "csv",
  tsv: "csv",
  txt: "text",
  log: "text",
};

/** Bigger than a text file, small enough to inline as a data URI. */
const MAX_BINARY = 12_000_000;

/**
 * docx / doc / rtf / odt to HTML, using macOS' own `textutil`.
 *
 * Deliberately not a bundled converter. `textutil` ships with the OS, handles
 * the whole Word family including the old binary .doc, and costs the app
 * nothing. On a machine without it this returns "" and the caller degrades to
 * "cannot preview" rather than throwing.
 */
function docToHtml(abs) {
  try {
    return execFileSync("textutil", ["-convert", "html", "-stdout", abs], {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 24 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

/**
 * HEIC / TIFF / PSD / camera RAW to PNG, using macOS' `sips`.
 *
 * Chromium cannot decode any of these, so without a transcode a photo
 * straight off an iPhone is a dead chip. `sips` is built in and handles the
 * whole family including RAW.
 */
function imageToPng(abs) {
  const out = path.join(
    os.tmpdir(),
    `hydo-prev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`
  );
  try {
    execFileSync("sips", ["-s", "format", "png", abs, "--out", out], {
      timeout: 30_000,
      stdio: "ignore",
    });
    const buf = fs.readFileSync(out);
    return buf;
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(out);
    } catch {
      /* nothing to clean up */
    }
  }
}

/**
 * pptx / key / odp to a text outline, via `uv run --with python-pptx`.
 *
 * A deck is not renderable here, but its CONTENT is the useful part: which
 * slides, what each says. Better than "cannot preview".
 */
function slidesToText(abs) {
  const py = [
    "import sys",
    "from pptx import Presentation",
    "p = Presentation(sys.argv[1])",
    "for i, s in enumerate(p.slides, 1):",
    "    print(f'--- Slide {i} ---')",
    "    for sh in s.shapes:",
    "        if sh.has_text_frame:",
    "            for para in sh.text_frame.paragraphs:",
    "                t = ''.join(r.text for r in para.runs).strip()",
    "                if t: print(t)",
    "    print()",
  ].join("\n");
  try {
    return execFileSync("uv", ["run", "--quiet", "--with", "python-pptx", "python", "-c", py, abs], {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 24 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

/**
 * xlsx / ods to CSV, via `uv run --with openpyxl`.
 *
 * `uv` installs nothing permanently and caches after the first run, so a
 * spreadsheet viewer costs no bundle and no setup. Absent uv, the caller says
 * so instead of failing silently.
 */
function sheetToCsv(abs) {
  const py = [
    "import sys, csv, io",
    "from openpyxl import load_workbook",
    "wb = load_workbook(sys.argv[1], read_only=True, data_only=True)",
    "out = io.StringIO(); w = csv.writer(out)",
    "ws = wb[wb.sheetnames[0]]",
    "n = 0",
    "for row in ws.iter_rows(values_only=True):",
    "    w.writerow(['' if c is None else c for c in row])",
    "    n += 1",
    "    if n > 2000: break",
    "print(out.getvalue(), end='')",
  ].join("\n");
  try {
    return execFileSync("uv", ["run", "--quiet", "--with", "openpyxl", "python", "-c", py, abs], {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 24 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

function classify(target) {
  const raw = String(target || "").trim();
  if (!raw) return { kind: "none" };
  if (/^https?:\/\//i.test(raw)) {
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(raw);
    return { kind: local ? "server" : "url", url: raw };
  }
  const clean = raw.replace(/^file:\/\//, "");
  // `ext` and `previewKind` ride along so a ROW can say what a file actually
  // is. `kind` stays "file" because Artifact.jsx switches on it to decide how
  // to frame the thing, and that decision is about the payload, not the name.
  // Without this every attachment in the thread was labelled "File", docx and
  // csv and png alike.
  const ext = path.extname(clean).slice(1).toLowerCase();
  return { kind: "file", filePath: clean, ext, previewKind: kinds.kindOf(clean) };
}

/**
 * Is `abs` really inside `root`?
 *
 * `startsWith` alone is wrong twice over: "/w/bots/a2" starts with "/w/bots/a"
 * without being inside it, and a symlink inside the workspace can point
 * anywhere on disk. Compare realpaths, with a separator on the end.
 */
function contains(root, abs) {
  let r;
  try {
    r = fs.realpathSync(root);
  } catch {
    return false;
  }
  // `realpathSync` THROWS on a path that does not exist, so resolving the
  // target directly would report every typo as an escape attempt. Resolve the
  // deepest ancestor that does exist instead — that is where a symlink could
  // hide — and re-attach the missing tail lexically.
  let head = path.resolve(abs);
  const tail = [];
  for (;;) {
    try {
      head = fs.realpathSync(head);
      break;
    } catch {
      const parent = path.dirname(head);
      // Walked past the filesystem root without finding anything real.
      if (parent === head) return false;
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
  const a = tail.length ? path.join(head, ...tail) : head;
  if (a === r) return true;
  return a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/**
 * Read an artifact a bot asked to show.
 *
 * @param {string} workspace  the bot's OWN workspace; nothing outside it is readable
 * @param {string} target     url / localhost / absolute path, as Hermes normalised it
 */
function readArtifact(workspace, target) {
  const c = classify(target);
  if (c.kind === "none") return { ok: false, reason: "empty" };
  // A URL is not ours to read. The renderer decides whether to frame it or
  // hand it to the browser; either way no file is touched.
  if (c.kind === "url" || c.kind === "server") {
    return { ok: true, kind: c.kind, url: c.url };
  }

  const abs = path.resolve(c.filePath);
  const name = path.basename(abs);
  if (!workspace || !contains(workspace, abs)) {
    // Deliberately not "file not found": this is a bot reaching outside its
    // sandbox, and it should read as a refusal in the log, not a typo.
    return { ok: false, reason: "outside-workspace", name, path: abs };
  }
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { ok: false, reason: "missing", name, path: abs };
  }
  if (!stat.isFile()) return { ok: false, reason: "not-a-file", name, path: abs };
  if (stat.size > MAX_BYTES) {
    return { ok: false, reason: "too-big", name, path: abs, size: stat.size };
  }

  const ext = path.extname(abs).slice(1).toLowerCase();
  const meta = {
    name,
    path: abs,
    ext,
    size: stat.size,
    modifiedAt: new Date(stat.mtimeMs).toISOString(),
  };

  // The pane's own renderers first.
  const own = KIND_BY_EXT[ext];
  if (own) return { ok: true, kind: own, ...meta, text: fs.readFileSync(abs, "utf8") };

  // Then everything else preview-kinds knows about.
  const fk = kinds.kindOf(name);
  switch (fk.kind) {
    case "text":
      return { ok: true, kind: "text", lang: fk.lang, ...meta, text: fs.readFileSync(abs, "utf8") };

    case "doc": {
      const html = docToHtml(abs);
      if (!html) return { ok: false, reason: "no-converter", ...meta };
      return { ok: true, kind: "html", converted: "textutil", ...meta, text: html };
    }

    case "sheet": {
      const csv = sheetToCsv(abs);
      if (!csv) return { ok: false, reason: "no-converter", ...meta };
      return { ok: true, kind: "csv", converted: "openpyxl", ...meta, text: csv };
    }

    case "image-convert": {
      if (stat.size > MAX_BINARY) return { ok: false, reason: "too-big", ...meta };
      const png = imageToPng(abs);
      if (!png) return { ok: false, reason: "no-converter", ...meta };
      return {
        ok: true,
        kind: "image",
        converted: "sips",
        ...meta,
        src: `data:image/png;base64,${png.toString("base64")}`,
      };
    }

    case "slides": {
      const text = slidesToText(abs);
      if (!text) return { ok: false, reason: "no-converter", ...meta };
      return { ok: true, kind: "text", lang: "", converted: "python-pptx", ...meta, text };
    }

    case "image":
    case "vector":
    case "pdf":
    case "video":
    case "audio": {
      if (stat.size > MAX_BINARY) return { ok: false, reason: "too-big", ...meta };
      const b64 = fs.readFileSync(abs).toString("base64");
      return { ok: true, kind: fk.kind, ...meta, src: `data:${fk.mime};base64,${b64}` };
    }

    default:
      return { ok: false, reason: "unsupported", ...meta, fileKind: fk.kind };
  }
}

/** A stable id for "the same artifact, rewritten" so versions group together. */
function artifactKey(botId, target) {
  const c = classify(target);
  const tail = c.kind === "file" ? path.resolve(c.filePath) : c.url || "";
  return `${botId}:${tail}`;
}

function titleFor(target, label) {
  const clean = String(label || "").trim();
  const c = classify(target);
  // A FILE is named by its filename, even when the bot passed a label.
  // A label like "Todo" hides the fact that the thing on disk is called
  // random-todo-list.docx, which is what you would look for in Finder and what
  // tells you at a glance that it is a Word file at all.
  if (c.kind === "file") return path.basename(c.filePath) || clean.slice(0, 80) || "Artifact";
  if (clean) return clean.slice(0, 80);
  try {
    const u = new URL(c.url);
    return (u.hostname + u.pathname).replace(/\/$/, "").slice(0, 80) || "Artifact";
  } catch {
    return "Artifact";
  }
}

module.exports = { readArtifact, classify, contains, artifactKey, titleFor, MAX_BYTES, KIND_BY_EXT };
