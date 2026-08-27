#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const read = (p) => fs.readFileSync(p, "utf8");

const allSrc = walk(SRC);
const byExt = (re) => allSrc.filter((p) => re.test(p));
const jsxFiles = byExt(/\.jsx$/);
const cssFiles = byExt(/\.css$/);
const brandFiles = byExt(/\.(jsx|js|css)$/);

/** Replace comments with same-length whitespace so line numbers stay valid.
 *  Handles //, /* * /, and therefore JSX {/ * * /}. Strings/templates are left intact. */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  const skip = (end) => {
    while (i < n && !end()) {
      out += src[i] === "\n" ? "\n" : " ";
      i++;
    }
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c; i++;
      while (i < n) {
        out += src[i];
        if (src[i] === "\\" && q !== "`") { i++; if (i < n) out += src[i]; }
        else if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      skip(() => src[i] === "*" && src[i + 1] === "/");
      if (i < n) { out += "  "; i += 2; }
      continue;
    }
    if (c === "/" && d === "/") {
      skip(() => src[i] === "\n");
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;
function section(name, status, lines) {
  return lines.length
    ? [`${name}: ${status}`, ...lines.map((l) => `  ${l}`)].join("\n")
    : `${name}: ${status}`;
}

let failed = 0;
const parts = [];

// --- 1. BRAND ---
{
  const hits = [];
  for (const file of brandFiles) {
    const raw = read(file);
    const text = stripComments(raw);
    const re = /Grok/g;
    let m;
    while ((m = re.exec(text))) {
      const line = lineOf(text, m.index);
      const snippet = text.split("\n")[line - 1].trim().slice(0, 120);
      hits.push(`${rel(file)}:${line}  ${snippet}`);
    }
  }
  if (hits.length) failed++;
  parts.push(section("BRAND", hits.length ? "FAIL" : "PASS", hits));
}

// --- 2. ICONS ---
{
  const defined = new Set();
  const iconsCss = path.join(SRC, "kit/icons.css");
  if (fs.existsSync(iconsCss)) {
    const t = read(iconsCss);
    const re = /\.gb-icon-([a-z0-9-]+)/g;
    let m;
    while ((m = re.exec(t))) defined.add(m[1]);
  }
  const missing = [];
  const seen = new Set();
  for (const file of brandFiles) {
    const t = read(file);
    const re = /gb-icon-([a-z0-9-]+)/g;
    let m;
    while ((m = re.exec(t))) {
      if (defined.has(m[1])) continue;
      const key = `${rel(file)}:${lineOf(t, m.index)}:${m[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      missing.push(`${rel(file)}:${lineOf(t, m.index)}  gb-icon-${m[1]}`);
    }
  }
  if (missing.length) failed++;
  parts.push(section("ICONS", missing.length ? "FAIL" : "PASS", missing));
}

// --- 3. CSS IMPORTS ---
{
  const mainPath = path.join(SRC, "main.jsx");
  const mainSrc = fs.existsSync(mainPath) ? read(mainPath) : "";
  const missingMain = [];
  const fromMain = [];
  const reImp = /import\s+["']([^"']+)["']/g;
  let m;
  while ((m = reImp.exec(mainSrc))) {
    const spec = m[1];
    if (!spec.includes(".css")) continue;
    const resolved = path.resolve(SRC, spec);
    fromMain.push(resolved);
    if (!fs.existsSync(resolved)) {
      missingMain.push(`${rel(mainPath)}  missing ${spec}`);
    }
  }
  function cssImports(file, text) {
    const out = [];
    const re = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/g;
    let x;
    while ((x = re.exec(text))) out.push(path.resolve(path.dirname(file), x[1]));
    return out;
  }
  const reachable = new Set();
  const q = [...fromMain.filter((p) => fs.existsSync(p))];
  while (q.length) {
    const f = q.pop();
    if (reachable.has(f)) continue;
    reachable.add(f);
    if (!f.endsWith(".css")) continue;
    for (const nxt of cssImports(f, read(f))) {
      if (fs.existsSync(nxt)) q.push(nxt);
    }
  }
  const targets = [
    ...fs.readdirSync(path.join(SRC, "screens")).filter((n) => n.endsWith(".css")).map((n) => path.join(SRC, "screens", n)),
    ...fs.readdirSync(path.join(SRC, "kit")).filter((n) => n.endsWith(".css")).map((n) => path.join(SRC, "kit", n)),
  ];
  const orphans = targets.filter((p) => !reachable.has(p)).map((p) => `orphan  ${rel(p)}`);
  if (missingMain.length) failed++;
  const status = missingMain.length ? "FAIL" : orphans.length ? "WARN" : "PASS";
  parts.push(section("CSS IMPORTS", status, [...missingMain, ...orphans]));
}

// --- 4. TOKENS ---
{
  const tokensPath = path.join(SRC, "kit/tokens.css");
  const defined = new Set();
  if (fs.existsSync(tokensPath)) {
    const t = read(tokensPath);
    const re = /(--sand-[a-zA-Z0-9-]+)\s*:/g;
    let m;
    while ((m = re.exec(t))) defined.add(m[1]);
  }
  const warns = [];
  const reqs = [];
  function parseVar(s, start) {
    let i = start + 4, depth = 1, inner = "";
    while (i < s.length && depth) {
      const c = s[i++];
      if (c === "(") depth++;
      else if (c === ")") {
        if (--depth === 0) break;
      }
      inner += c;
    }
    return inner;
  }
  for (const file of brandFiles) {
    const t = read(file);
    const re = /var\(\s*(--sand-[a-zA-Z0-9-]+)/g;
    let m;
    while ((m = re.exec(t))) {
      const name = m[1];
      if (defined.has(name)) continue;
      const inner = parseVar(t, m.index);
      const comma = inner.indexOf(",");
      const hasFb = comma >= 0 && inner.slice(comma + 1).trim().length > 0;
      const loc = `${rel(file)}:${lineOf(t, m.index)}  ${name}${hasFb ? " (fallback)" : " (no fallback)"}`;
      if (!hasFb) reqs.push(loc);
      else warns.push(loc);
    }
  }
  if (reqs.length) failed++;
  const status = reqs.length ? "FAIL" : warns.length ? "WARN" : "PASS";
  parts.push(section("TOKENS", status, [...reqs, ...warns]));
}

// --- 5. DEAD CSS (heuristic) ---
{
  // Conservative: only harvest .class from selector lists (brace depth 0).
  // Skip @media/@keyframes/@font-face entirely; ignore dots inside url()/strings.
  function classesInCss(text) {
    const names = new Set();
    let i = 0;
    const n = text.length;
    let brace = 0;
    let skipAt = 0;
    let pendingSkip = false;
    while (i < n) {
      if (text[i] === "/" && text[i + 1] === "*") {
        i += 2;
        while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      if (text[i] === '"' || text[i] === "'") {
        const q = text[i++];
        while (i < n && text[i] !== q) i++;
        i++;
        continue;
      }
      if (text[i] === "@") {
        const rest = text.slice(i).toLowerCase();
        if (/^@(media|keyframes|-webkit-keyframes|font-face|supports)\b/.test(rest)) pendingSkip = true;
      }
      if (text[i] === "{") {
        if (pendingSkip || skipAt) skipAt++;
        pendingSkip = false;
        brace++;
        i++;
        continue;
      }
      if (text[i] === "}") {
        brace--;
        if (skipAt > 0) skipAt--;
        i++;
        continue;
      }
      if (!skipAt && !pendingSkip && brace === 0 && text[i] === ".") {
        const mm = text.slice(i).match(/^\.([A-Za-z_][\w-]*)/);
        if (mm) names.add(mm[1]);
      }
      i++;
    }
    return names;
  }
  const defined = new Map(); // class -> files
  for (const file of cssFiles) {
    for (const name of classesInCss(read(file))) {
      if (!defined.has(name)) defined.set(name, []);
      defined.get(name).push(rel(file));
    }
  }
  const jsxText = jsxFiles.map(read).join("\n");
  // Template-literal fragments: any ${}-bearing `...` — skip classes that appear inside one.
  const tmplFrags = [];
  for (const m of jsxText.matchAll(/`[^`]*`/g)) if (m[0].includes("${")) tmplFrags.push(m[0]);
  const dead = [];
  for (const [name, files] of defined) {
    if (/^is-/.test(name)) continue; // state suffixes (is-on, is-active, …)
    if (/^gb-icon/.test(name)) continue; // icon-font catalog, usually className={`gb-icon-${id}`}
    if (tmplFrags.some((t) => t.includes(name))) continue;
    const word = new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`);
    if (!word.test(jsxText)) dead.push(`${name}  (${files.join(", ")})`);
  }
  const note = "(heuristic: skips @media/@keyframes, is-* states, template-literal fragments)";
  parts.push(section("DEAD CSS", dead.length ? "WARN" : "PASS", [note, ...dead]));
}

const summary = failed
  ? `SUMMARY: FAIL  ${failed} required check(s) failed`
  : "SUMMARY: PASS  all required checks passed";
parts.push(summary);
console.log(parts.join("\n\n"));
process.exit(failed ? 1 : 0);
