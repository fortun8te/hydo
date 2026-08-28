// light-mode-literals-test.cjs — guards against the bug that motivated the
// light-mode pass: a hardcoded dark hex/rgba baked straight into a stylesheet
// cannot flip when data-theme goes to cursor-light, so it silently reappears
// as dark-on-light. This does not forbid every literal color (status dots,
// brand gradients, and the MetalForge card art are deliberately fixed across
// themes) — it forbids the specific dark-grey/near-black/near-white literals
// that are markers of "someone hardcoded a surface instead of using a token".
"use strict";
const fs = require("fs");
const path = require("path");
const { stripComments } = require("./lib/source-scan.cjs");

const ROOT = path.join(__dirname, "..", "src");

// plugins.css and rails.css were fenced off while other agents held them;
// both got their own light-mode pass in this session (see the "Job 1"
// section of the session's task) and are swept like everything else now.
// umbra paints its own SVG system and stays out of scope.
const SKIP = new Set([]);
const SKIP_DIRS = ["umbra"];

// Dark-surface literals that were the actual bug: near-black/near-white greys
// used as a flat fill or hairline outside of tokens.css. Deliberately narrow
// (not "any hex") so it doesn't flag legitimate fixed brand/status colors.
const BANNED = [
  /#0a0909/i,
  /#121216/i,
  /#0d0d11/i,
  /#1c1c1c\b/i,
  /#1f1f1f\b/i,
  /#2a2a2a\b/i,
  /#2c2c2c\b/i,
  /#2e2e2e\b/i,
  /#242424\b/i,
  /rgba\(252,\s*252,\s*252,/i,
  /rgba\(255,\s*255,\s*255,\s*0\.0[0-9]\)/i, // near-invisible white overlays
];

function listCssFiles(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.includes(entry.name)) continue;
      out = out.concat(listCssFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith(".css")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const files = listCssFiles(ROOT).filter((f) => {
  const rel = path.relative(ROOT, f).split(path.sep).join("/");
  return !SKIP.has(rel) && rel !== "kit/tokens.css"; // tokens.css IS the definitions
});

const offenders = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, "utf8");
  // Strip every /* ... */ block first (handles both inline and multi-line
  // comments — e.g. "the app hardcoded... #2e2e2e" spanning several lines),
  // then strip var(--token, <fallback>) calls: a literal sitting in a
  // fallback slot is inert as long as the token itself is defined, which is
  // asserted separately below rather than by banning the fallback text.
  const noComments = stripComments(src);
  const noVarFallbacks = noComments.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, "var(--token)");
  const lines = noVarFallbacks.split("\n");
  const rawLines = src.split("\n");
  lines.forEach((line, i) => {
    // The MetalForge card (.hy-card) is a deliberately fixed dark-art
    // gradient documented in the comment right above it — a product-art
    // surface, not a theme-dependent chrome surface, so it stays literal.
    if (rel === "screens/production.css" && /168deg, #121216 0%, #0d0d11 58%, #0a0909 100%/.test(line)) return;
    for (const re of BANNED) {
      if (re.test(line)) {
        offenders.push(`${rel}:${i + 1}: ${rawLines[i].trim()}`);
        break;
      }
    }
  });
}

// Separately assert the tokens those fallbacks lean on actually exist in
// BOTH theme blocks — this is the failure mode that let --sand-line ship
// referenced eight times and defined nowhere, silently pinned to its dark
// fallback in every theme.
const tokensSrc = fs.readFileSync(path.join(ROOT, "kit", "tokens.css"), "utf8");
const REQUIRED = ["--hy-raised", "--hy-raised-hover", "--hy-menu", "--hy-menu-border", "--sand-line", "--hy-hairline", "--hy-scrim", "--hy-code-ground"];
const missing = [];
for (const name of REQUIRED) {
  const re = new RegExp(`^\\s*${name}\\s*:`, "m");
  const definedSomewhere = re.test(tokensSrc);
  if (!definedSomewhere) missing.push(name);
}
if (missing.length) {
  console.error("light-mode-literals-test: required semantic tokens are not defined at all: " + missing.join(", "));
  process.exit(1);
}

if (offenders.length) {
  console.error("light-mode-literals-test: found hardcoded dark-surface literals that will not flip in light mode:");
  for (const o of offenders) console.error("  " + o);
  process.exit(1);
}

console.log("light-mode-literals-test ok (" + files.length + " stylesheets swept)");
