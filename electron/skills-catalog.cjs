"use strict";

/**
 * Unified skills + MCP catalog for Claude Code, Codex, and Hermes.
 * Node stdlib only. Total: missing/unreadable/malformed → empty, never throw.
 * Cache is in-memory; call refresh() to rebuild.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOME = os.homedir();

const PATHS = {
  claudeSkills: path.join(HOME, ".claude", "skills"),
  claudePlugins: path.join(HOME, ".claude", "plugins"),
  claudeInstalledPlugins: path.join(HOME, ".claude", "plugins", "installed_plugins.json"),
  claudeJson: path.join(HOME, ".claude.json"),
  claudeMcpJson: path.join(HOME, ".claude", "mcp.json"),
  claudeSettings: path.join(HOME, ".claude", "settings.json"),
  codexConfig: path.join(HOME, ".codex", "config.toml"),
  codexSkills: path.join(HOME, ".codex", "skills"),
  codexPrompts: path.join(HOME, ".codex", "prompts"),
  hermesSkills: path.join(HOME, ".hermes", "skills"),
  hermesBundledSkills: path.join(HOME, ".hermes", "hermes-agent", "skills"),
  hermesOptionalSkills: path.join(HOME, ".hermes", "hermes-agent", "optional-skills"),
  hermesOptionalMcps: path.join(HOME, ".hermes", "hermes-agent", "optional-mcps"),
  hermesConfig: path.join(HOME, ".hermes", "config.yaml"),
  hydoOptionalSkills: path.join(__dirname, "..", "optional-skills"),
  hydoOptionalMcps: path.join(__dirname, "..", "optional-mcps"),
};

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".archive",
  ".curator_backups",
  ".hub",
  ".install-manifests",
  "cache",
]);

const SECRET_KEY = /^(env|headers|api[_-]?key|token|secret|password|authorization|bearer|credentials)$/i;

let cache = null;

function refresh() {
  cache = null;
  return catalog();
}

function catalog() {
  if (cache) return cache;
  const sources = [];
  const skills = [];
  const servers = [];
  const seenSkill = new Set();
  const seenServer = new Set();

  function addSkill(item) {
    const key = item.source + "\0" + item.id + "\0" + item.path;
    if (seenSkill.has(key)) return;
    seenSkill.add(key);
    skills.push(item);
  }
  function addServer(item) {
    const key = item.source + "\0" + item.id + "\0" + item.configPath;
    if (seenServer.has(key)) return;
    seenServer.add(key);
    servers.push(item);
  }

  scanClaudeSkills(sources, addSkill);
  scanClaudePlugins(sources, addSkill);
  scanClaudeServers(sources, addServer);
  scanCodexSkills(sources, addSkill);
  scanCodexPrompts(sources, addSkill);
  scanCodexServers(sources, addServer);
  scanHermesSkillTree("hermes-user-skills", PATHS.hermesSkills, sources, addSkill, {
    skipHidden: true,
  });
  scanHermesSkillTree("hermes-bundled-skills", PATHS.hermesBundledSkills, sources, addSkill);
  scanHermesSkillTree("hermes-optional-skills", PATHS.hermesOptionalSkills, sources, addSkill);
  scanHermesServers(sources, addServer);
  scanOptionalMcps(sources);
  probeMissingHydoOptionals(sources);

  cache = { skills, servers, sources };
  return cache;
}

function listSkills() {
  return { skills: catalog().skills };
}

function listServers() {
  return { servers: catalog().servers };
}

function sourceEntry(source, filePath, found, count) {
  return { source, path: filePath, found: !!found, count: count || 0 };
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function parseJson(file) {
  const t = readText(file);
  if (t == null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function parseFrontmatter(text) {
  if (!text || typeof text !== "string") return {};
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const rawLine of m[1].split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart() !== rawLine) continue;
    if (rawLine.trim().startsWith("#")) continue;
    const colon = rawLine.indexOf(":");
    if (colon <= 0) continue;
    const key = rawLine.slice(0, colon).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) continue;
    let val = rawLine.slice(colon + 1).trim();
    if (!val) continue;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function walkSkillMd(root, opts) {
  const found = [];
  const skipHidden = opts && opts.skipHidden;
  function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const name = ent.name;
      if (SKIP_DIR_NAMES.has(name)) continue;
      if (skipHidden && name.startsWith(".")) continue;
      const full = path.join(dir, name);
      try {
        if (ent.isSymbolicLink()) {
          let st;
          try {
            st = fs.statSync(full);
          } catch {
            continue;
          }
          if (st.isDirectory()) walk(full, depth + 1);
          else if (st.isFile() && name === "SKILL.md") found.push(full);
          continue;
        }
      } catch {
        continue;
      }
      if (ent.isDirectory()) walk(full, depth + 1);
      else if (ent.isFile() && name === "SKILL.md") found.push(full);
    }
  }
  walk(root, 0);
  return found;
}

function skillFromMd(file, source, namespace) {
  const fm = parseFrontmatter(readText(file) || "");
  const dir = path.dirname(file);
  const fallback = path.basename(dir);
  const name = String(fm.name || fallback).trim() || fallback;
  const description = String(fm.description || "").trim();
  const ns = namespace || name;
  return {
    id: ns.includes(":") ? ns : name,
    name,
    description,
    source,
    path: file,
    namespace: ns,
  };
}

function scanClaudeSkills(sources, addSkill) {
  const root = PATHS.claudeSkills;
  if (!exists(root)) {
    sources.push(sourceEntry("claude", root, false, 0));
    return;
  }
  const files = walkSkillMd(root, { skipHidden: true });
  let n = 0;
  for (const f of files) {
    addSkill(skillFromMd(f, "claude", path.basename(path.dirname(f))));
    n += 1;
  }
  sources.push(sourceEntry("claude", root, true, n));
}

function scanClaudePlugins(sources, addSkill) {
  const manifest = PATHS.claudeInstalledPlugins;
  const data = parseJson(manifest);
  if (!data || typeof data !== "object") {
    sources.push(sourceEntry("claude", manifest, exists(manifest), 0));
    return;
  }
  const plugins = data.plugins && typeof data.plugins === "object" ? data.plugins : {};
  let n = 0;
  for (const [pluginKey, installs] of Object.entries(plugins)) {
    const pluginName = String(pluginKey).split("@")[0] || pluginKey;
    const list = Array.isArray(installs) ? installs : [];
    for (const inst of list) {
      const installPath = inst && inst.installPath;
      if (!installPath || !exists(installPath)) continue;
      const files = walkSkillMd(installPath);
      for (const f of files) {
        const skillName = path.basename(path.dirname(f));
        const ns = pluginName + ":" + skillName;
        addSkill(skillFromMd(f, "claude", ns));
        n += 1;
      }
    }
  }
  sources.push(sourceEntry("claude", manifest, true, n));
}

function serverRecord(id, name, transport, command, source, configPath) {
  return {
    id: String(id || name),
    name: String(name || id),
    transport: transport || "stdio",
    command: command == null ? "" : String(command),
    source,
    configPath,
  };
}

function redactCommandFromCfg(cfg) {
  if (!cfg || typeof cfg !== "object") return { transport: "stdio", command: "" };
  const transport =
    cfg.transport ||
    cfg.type ||
    (cfg.url ? "http" : "stdio");
  let command = cfg.command || cfg.url || "";
  if (Array.isArray(cfg.args) && cfg.args.length && cfg.command) {
    command = [cfg.command].concat(cfg.args.map(String)).join(" ");
  }
  return { transport: String(transport), command: String(command) };
}

function scanClaudeServers(sources, addServer) {
  const files = [
    PATHS.claudeJson,
    PATHS.claudeMcpJson,
    PATHS.claudeSettings,
  ];
  for (const file of files) {
    if (!exists(file)) {
      sources.push(sourceEntry("claude", file, false, 0));
      continue;
    }
    const data = parseJson(file);
    const map =
      data && typeof data.mcpServers === "object" && data.mcpServers
        ? data.mcpServers
        : null;
    if (!map) {
      sources.push(sourceEntry("claude", file, true, 0));
      continue;
    }
    let n = 0;
    for (const [name, cfg] of Object.entries(map)) {
      if (SECRET_KEY.test(name)) continue;
      const { transport, command } = redactCommandFromCfg(cfg);
      addServer(serverRecord(name, name, transport, command, "claude", file));
      n += 1;
    }
    sources.push(sourceEntry("claude", file, true, n));
  }
}

function scanCodexSkills(sources, addSkill) {
  const root = PATHS.codexSkills;
  if (!exists(root)) {
    sources.push(sourceEntry("codex", root, false, 0));
    return;
  }
  const files = walkSkillMd(root);
  let n = 0;
  for (const f of files) {
    const rel = path.relative(root, path.dirname(f)).replace(/\\/g, "/");
    addSkill(skillFromMd(f, "codex", rel || path.basename(path.dirname(f))));
    n += 1;
  }
  sources.push(sourceEntry("codex", root, true, n));
}

function scanCodexPrompts(sources, addSkill) {
  const root = PATHS.codexPrompts;
  if (!exists(root)) {
    sources.push(sourceEntry("codex", root, false, 0));
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    sources.push(sourceEntry("codex", root, true, 0));
    return;
  }
  let n = 0;
  for (const ent of entries) {
    if (!ent.isFile() || !/\.(md|txt)$/i.test(ent.name)) continue;
    const full = path.join(root, ent.name);
    const text = readText(full) || "";
    const fm = parseFrontmatter(text);
    const name = (fm.name || ent.name.replace(/\.(md|txt)$/i, "")).trim();
    addSkill({
      id: "prompt:" + name,
      name,
      description: String(fm.description || firstLine(text)).trim(),
      source: "codex",
      path: full,
      namespace: "prompt:" + name,
    });
    n += 1;
  }
  sources.push(sourceEntry("codex", root, true, n));
}

function firstLine(text) {
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#") && t !== "---") return t.slice(0, 200);
  }
  return "";
}

function scanCodexServers(sources, addServer) {
  const file = PATHS.codexConfig;
  const text = readText(file);
  if (text == null) {
    sources.push(sourceEntry("codex", file, false, 0));
    return;
  }
  const blocks = parseTomlMcpServers(text);
  let n = 0;
  for (const [name, cfg] of Object.entries(blocks)) {
    const { transport, command } = redactCommandFromCfg(cfg);
    addServer(serverRecord(name, name, transport, command, "codex", file));
    n += 1;
  }
  sources.push(sourceEntry("codex", file, true, n));
}

function parseTomlMcpServers(text) {
  const servers = {};
  let current = null;
  let inEnv = false;
  for (const raw of text.split(/\r?\n/)) {
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
        if (!servers[current]) servers[current] = {};
        continue;
      }
      if (srvM) {
        current = srvM[1] || srvM[2] || srvM[3];
        inEnv = false;
        if (!servers[current]) servers[current] = {};
        continue;
      }
      current = null;
      inEnv = false;
      continue;
    }
    if (!current || inEnv) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    if (SECRET_KEY.test(key)) continue;
    servers[current][key] = parseTomlValue(kv[2]);
  }
  return servers;
}

function parseTomlValue(raw) {
  const v = raw.trim();
  if (v.startsWith("[")) {
    const inner = v.replace(/^\[/, "").replace(/\]\s*$/, "");
    if (!inner.trim()) return [];
    return inner.split(",").map((p) => unquote(p.trim()));
  }
  if (v === "true") return true;
  if (v === "false") return false;
  return unquote(v);
}

function unquote(v) {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function scanHermesSkillTree(label, root, sources, addSkill, opts) {
  if (!exists(root)) {
    sources.push(sourceEntry("hermes", root, false, 0));
    return;
  }
  const files = walkSkillMd(root, opts || {});
  let n = 0;
  for (const f of files) {
    const rel = path.relative(root, path.dirname(f)).replace(/\\/g, "/");
    addSkill(skillFromMd(f, "hermes", rel || path.basename(path.dirname(f))));
    n += 1;
  }
  sources.push(sourceEntry("hermes", root, true, n));
}

function scanHermesServers(sources, addServer) {
  const file = PATHS.hermesConfig;
  const text = readText(file);
  if (text == null) {
    sources.push(sourceEntry("hermes", file, false, 0));
    return;
  }
  const map = parseYamlMcpServers(text);
  let n = 0;
  for (const [name, cfg] of Object.entries(map)) {
    const { transport, command } = redactCommandFromCfg(cfg);
    addServer(serverRecord(name, name, transport, command, "hermes", file));
    n += 1;
  }
  sources.push(sourceEntry("hermes", file, true, n));
}

function parseYamlMcpServers(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  let start = -1;
  for (; i < lines.length; i++) {
    if (lines[i] === "mcp_servers:" || lines[i].trim() === "mcp_servers:") {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return {};
  const servers = {};
  let current = null;
  let inArgs = false;
  let inEnv = false;
  for (i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.match(/^[ ]*/)[0].length;
    if (indent === 0) break;
    if (indent === 2 && /:[ \t]*$/.test(line) && !line.trim().startsWith("-")) {
      current = line.trim().replace(/:$/, "");
      inArgs = false;
      inEnv = false;
      if (!SECRET_KEY.test(current)) servers[current] = { args: [] };
      else current = null;
      continue;
    }
    if (!current || !servers[current]) continue;
    if (inEnv) {
      if (indent >= 6) continue;
      inEnv = false;
    }
    const t = line.trim();
    if (indent === 4 && /^env:\s*$/.test(t)) {
      inEnv = true;
      inArgs = false;
      continue;
    }
    if (indent === 4 && /^args:\s*$/.test(t)) {
      inArgs = true;
      continue;
    }
    if (inArgs && indent >= 6 && t.startsWith("-")) {
      servers[current].args.push(t.replace(/^-/, "").trim());
      continue;
    }
    inArgs = false;
    if (indent === 4) {
      const colon = t.indexOf(":");
      if (colon <= 0) continue;
      const key = t.slice(0, colon).trim();
      if (SECRET_KEY.test(key)) continue;
      let val = t.slice(colon + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key === "args" && val.startsWith("[")) {
        servers[current].args = val
          .replace(/^\[/, "")
          .replace(/\]$/, "")
          .split(",")
          .map((x) => unquote(x.trim()))
          .filter(Boolean);
      } else {
        servers[current][key] = val;
      }
    }
  }
  return servers;
}

function scanOptionalMcps(sources) {
  const root = PATHS.hermesOptionalMcps;
  if (!exists(root)) {
    sources.push(sourceEntry("hermes", root, false, 0));
    return;
  }
  let n = 0;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    sources.push(sourceEntry("hermes", root, true, 0));
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory() && !ent.name.startsWith(".")) n += 1;
  }
  sources.push(sourceEntry("hermes", root, true, n));
}

function probeMissingHydoOptionals(sources) {
  sources.push(
    sourceEntry("hermes", PATHS.hydoOptionalSkills, exists(PATHS.hydoOptionalSkills), 0)
  );
  sources.push(
    sourceEntry("hermes", PATHS.hydoOptionalMcps, exists(PATHS.hydoOptionalMcps), 0)
  );
}

module.exports = {
  listSkills,
  listServers,
  catalog,
  refresh,
};
