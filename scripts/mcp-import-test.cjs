"use strict";

const assert = require("node:assert/strict");
const imp = require("../electron/mcp-import.cjs");

assert.equal(imp.skipName("cua"), true);
assert.equal(imp.skipName("open-computer"), true);
assert.equal(imp.skipName("computer-use"), true);
assert.equal(imp.skipName("node_repl"), true);
assert.equal(imp.skipName("pencil"), false);
assert.equal(imp.skipName("figma"), false);

const rows = imp.harvest();
const names = rows.map((r) => r.name);
assert.ok(names.includes("pencil"), `pencil missing: ${names.join(",")}`);
assert.ok(!names.includes("cua"));
assert.ok(!names.includes("open-computer"));
assert.ok(!names.includes("node_repl"));
assert.ok(names.includes("blender-mcp") || names.includes("exa") || names.includes("figma"));
const pencil = rows.find((r) => r.name === "pencil");
assert.ok(pencil.command.includes("Pencil"));
const figma = rows.find((r) => r.name === "figma");
if (figma) assert.ok(figma.url && figma.url.includes("figma"));

const cfg = imp.toHermesConfig(pencil);
assert.equal(cfg.command, pencil.command);
assert.ok(Array.isArray(cfg.args));

console.log(`mcp-import-test ok n=${names.length} ${names.join(",")}`);

// Claude Code scopes MCP servers per project as well as globally, under
// `projects["<abs path>"].mcpServers`. Reading only the global map missed
// every server added while working inside a repo, which is where you add most
// of them. Assert the source is read, not a frozen list of names.
{
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "electron", "mcp-import.cjs"),
    "utf8"
  );
  assert.ok(/claudeJson\.projects/.test(src), "project-scoped servers are harvested");
  assert.ok(/proj\.mcpServers/.test(src), "from each project's own map");
}
