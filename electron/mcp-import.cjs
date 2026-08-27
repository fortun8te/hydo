"use strict";

/**
 * Bring Claude Code + Codex MCP servers into Hermes so Hydo bots can use them.
 * Computer-use stacks (cua / open-computer) stay blocked — Hermes computer_use
 * owns the desktop. node_repl is ChatGPT-app-only and is skipped.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
function isBlockedComputerUseMcp(name) {
  const n = String(name || "").trim().toLowerCase();
  if (n === "cua" || n.startsWith("cua-") || n.endsWith("-cua")) return true;
  if (n.includes("open-computer") || n.includes("open_computer")) return true;
  if (n === "computer-use" || n === "computer_use") return true;
  return false;
}

const HOME = os.homedir();
const SKIP = new Set(["node_repl", "node-repl"]);

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function parseJson(p) {
  const t = readText(p);
  if (t == null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function parseTomlValue(raw) {
  let s = String(raw || "").trim();
  if (s.startsWith("[")) {
    try {
      return JSON.parse(s.replace(/,(\s*[\]}])/g, "$1"));
    } catch {
      const inner = s.slice(1, -1);
      return inner
        .split(",")
        .map((x) => String(x).trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  const n = Number(s);
  if (Number.isFinite(n) && s !== "") return n;
  return s;
}

function parseTomlMcp(text) {
  const servers = {};
  let current = null;
  let inEnv = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      const ident = table[1];
      const envM = ident.match(/^mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))\.env$/);
      const srvM = ident.match(/^mcp_servers\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_.-]+))$/);
      if (envM) {
        current = envM[1] || envM[2] || envM[3];
        inEnv = true;
        servers[current] ||= {};
        servers[current].env ||= {};
        continue;
      }
      if (srvM) {
        current = srvM[1] || srvM[2] || srvM[3];
        inEnv = false;
        servers[current] ||= {};
        continue;
      }
      current = null;
      inEnv = false;
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = parseTomlValue(kv[2]);
    if (inEnv) {
      servers[current].env[key] = val;
    } else {
      servers[current][key] = val;
    }
  }
  return servers;
}

function fromClaudeMap(map, source) {
  const out = [];
  if (!map || typeof map !== "object") return out;
  for (const [name, cfg] of Object.entries(map)) {
    if (!cfg || typeof cfg !== "object") continue;
    out.push(normalize(name, cfg, source));
  }
  return out;
}

function normalize(name, cfg, source) {
  const n = String(name || "").trim();
  const command = cfg.command ? String(cfg.command) : "";
  const url = cfg.url ? String(cfg.url) : "";
  const args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
  const env = cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env) ? { ...cfg.env } : {};
  const headers = cfg.headers && typeof cfg.headers === "object" ? { ...cfg.headers } : undefined;
  return {
    name: n,
    source,
    command,
    url,
    args,
    env,
    headers,
    timeout: cfg.timeout || cfg.startup_timeout_sec || undefined,
    enabled: cfg.enabled !== false,
  };
}

function skipName(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return true;
  if (SKIP.has(n)) return true;
  if (isBlockedComputerUseMcp(n)) return true;
  return false;
}

function harvest() {
  const byName = new Map();
  function add(row) {
    if (!row || skipName(row.name)) return;
    if (!row.command && !row.url) return;
    if (!byName.has(row.name)) byName.set(row.name, row);
  }

  const claudeJson = parseJson(path.join(HOME, ".claude.json"));
  if (claudeJson && claudeJson.mcpServers) {
    for (const row of fromClaudeMap(claudeJson.mcpServers, "claude")) add(row);
  }
  // Claude Code scopes MCP servers PER PROJECT as well as globally, under
  // `projects["<abs path>"].mcpServers`. Reading only the global map missed
  // every server added while working in a repo — which in practice is most of
  // the interesting ones, because that is where you add them.
  if (claudeJson && claudeJson.projects && typeof claudeJson.projects === "object") {
    for (const proj of Object.values(claudeJson.projects)) {
      if (proj && proj.mcpServers) {
        for (const row of fromClaudeMap(proj.mcpServers, "claude")) add(row);
      }
    }
  }
  const claudeMcp = parseJson(path.join(HOME, ".claude", "mcp.json"));
  if (claudeMcp && claudeMcp.mcpServers) {
    for (const row of fromClaudeMap(claudeMcp.mcpServers, "claude")) add(row);
  }

  const toml = readText(path.join(HOME, ".codex", "config.toml"));
  if (toml) {
    const blocks = parseTomlMcp(toml);
    for (const [name, cfg] of Object.entries(blocks)) add(normalize(name, cfg, "codex"));
  }

  const figmaMcp = path.join(
    HOME,
    ".claude",
    "plugins",
    "cache",
    "claude-plugins-official",
    "figma"
  );
  if (exists(figmaMcp)) {
    let versions;
    try {
      versions = fs.readdirSync(figmaMcp);
    } catch {
      versions = [];
    }
    for (const v of versions) {
      const mcp = parseJson(path.join(figmaMcp, v, ".mcp.json"));
      if (mcp && mcp.mcpServers) {
        for (const row of fromClaudeMap(mcp.mcpServers, "claude-plugin")) add(row);
      }
    }
  }

  return [...byName.values()];
}

function names() {
  return harvest().map((r) => r.name);
}

function toHermesConfig(row) {
  const cfg = { enabled: true };
  if (row.url) cfg.url = row.url;
  if (row.command) cfg.command = row.command;
  if (row.args && row.args.length) cfg.args = row.args;
  if (row.env && Object.keys(row.env).length) cfg.env = row.env;
  if (row.headers) cfg.headers = row.headers;
  if (row.timeout) cfg.timeout = Number(row.timeout) || 120;
  return cfg;
}

/**
 * Register harvested servers on the live Hermes gateway. Already-present names
 * are left alone. Fail-soft: one bad server does not stop the rest.
 */
async function sync(gateway) {
  const rows = harvest();
  const result = { added: [], existed: [], failed: [], skipped: rows.length };
  if (!gateway || !gateway.available()) return { ...result, skipped: rows.length, reason: "no gateway" };
  try {
    await gateway.ensure();
  } catch (err) {
    return { ...result, reason: err.message };
  }
  for (const row of rows) {
    try {
      await gateway.addMcpServer(row.name, toHermesConfig(row));
      result.added.push(row.name);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (/already exists/i.test(msg) || /4090/.test(msg)) result.existed.push(row.name);
      else result.failed.push({ name: row.name, error: msg });
    }
  }
  result.skipped = 0;
  return result;
}

module.exports = {
  harvest,
  names,
  toHermesConfig,
  sync,
  skipName,
};
