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
