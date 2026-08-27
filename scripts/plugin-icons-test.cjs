"use strict";

// Guards the bug this file is named after: a broken icon lookup renders
// silently as an empty tile (see plugins.css's `::before` postmortem) or a
// letter tile that looks fine in code review. This test instead opens every
// asset PLUGIN_LOGOS points at and fails loud if the file is missing or
// zero-byte — the two ways a "real brand icon" quietly turns into nothing.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL, fileURLToPath } = require("node:url");

const ROOT = path.join(__dirname, "..");

async function loadIcons() {
  return import(pathToFileURL(path.join(ROOT, "src/lib/plugin-icons.js")).href);
}

async function main() {
  const mod = await loadIcons();
  const { PLUGIN_LOGOS, pluginIconUrl, pluginPrettyName } = mod;

  assert.ok(PLUGIN_LOGOS && typeof PLUGIN_LOGOS === "object", "PLUGIN_LOGOS exports an object");
  const ids = Object.keys(PLUGIN_LOGOS);
  assert.ok(ids.length >= 20, "PLUGIN_LOGOS should carry the full marketplace roster, not a handful");

  // Every mapped id must resolve to a real file on disk with actual bytes —
  // a 0-byte file (a curl that hit a 404 and got saved anyway) passes an
  // "exists" check but renders as nothing, same as the missing-class bug.
  for (const id of ids) {
    const url = PLUGIN_LOGOS[id];
    assert.ok(url.startsWith("file://"), `${id}: PLUGIN_LOGOS entries are local kit assets, got ${url}`);
    const filePath = fileURLToPath(url);
    assert.ok(fs.existsSync(filePath), `${id}: missing asset ${filePath}`);
    const size = fs.statSync(filePath).size;
    assert.ok(size > 200, `${id}: asset ${filePath} is empty or truncated (${size} bytes)`);
  }

  // The rows a real dev-mock run actually shows (see src/lib/devmock.js's
  // pluginCatalog) must each resolve to a non-empty icon — this is the exact
  // set a manual pass through the app would look at.
  for (const id of ["github", "slack", "notion", "linear", "figma"]) {
    const src = pluginIconUrl({ id, name: id });
    assert.ok(src, `${id}: pluginIconUrl() returned nothing — falls back to a letter tile`);
  }

  // Unknown ids still fall back honestly (empty string ⇒ letter tile) rather
  // than throwing or returning a bogus lookalike path.
  assert.equal(pluginIconUrl({ id: "totally-unknown-mcp-server-xyz" }), "");
  assert.equal(pluginIconUrl(null), "");

  // Pretty-name aliasing keeps working — a regression here would silently
  // rename a row back to its raw slug id.
  assert.equal(pluginPrettyName({ id: "chatgpt-unlimited" }), "ChatGPT Unlimited");
  assert.equal(pluginPrettyName({ id: "unknown-id", name: "Some Server" }), "Some Server");

  console.log(`plugin-icons-test: ok (${ids.length} mapped assets, all present and non-empty)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
