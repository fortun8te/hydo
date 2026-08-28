const fs = require("node:fs");
const path = require("node:path");

const SOUL_MARK = /<!--\s*hydo-soul:\s*(\d+)\s*-->/;
const SOUL_VERSION = 39;
const SOUL_PACKED = path.join(__dirname, "SOUL.default.md");

function loadDefaultSoul() {
  try {
    const raw = fs.readFileSync(SOUL_PACKED, "utf8");
    if (raw.trim()) return raw.endsWith("\n") ? raw : `${raw}\n`;
  } catch {
    /* packed file missing — last-resort stub */
  }
  return `<!-- hydo-soul: ${SOUL_VERSION} -->\n# Hydo teammate\n\nDo the work. Workspace only. Memory tool + SHARED.md. computer_use for the desktop. SKIP is channels only.\n`;
}

const DEFAULT_SOUL = loadDefaultSoul();

function soulVersionOf(text) {
  const m = SOUL_MARK.exec(String(text || ""));
  return m ? Number(m[1]) : 0;
}

/** Write built-in soul unless the user owns a custom SOUL.md (no hydo-soul stamp). */
function seedSoulFile(file, text) {
  const body = String(text || DEFAULT_SOUL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, body);
    return "wrote";
  }
  let prev = "";
  try {
    prev = fs.readFileSync(file, "utf8");
  } catch {
    fs.writeFileSync(file, body);
    return "wrote";
  }
  const ver = soulVersionOf(prev);
  if (ver >= SOUL_VERSION) return "current";
  const stock =
    ver > 0 ||
    /teammate in iMessage/.test(prev) ||
    /Talk like Grok Bot/.test(prev) ||
    /Never dump tools to the user/.test(prev);
  if (!stock && ver === 0) return "custom";
  fs.writeFileSync(file, body);
  return "upgraded";
}

const USER_LIMIT = 2000;

function botDir(root, id) {
  return path.join(root, "bots", id);
}

function memoryFile(root, id) {
  return path.join(botDir(root, id), "MEMORY.md");
}

function userFile(root, id) {
  return path.join(botDir(root, id), "USER.md");
}

function readOrSeed(file, fallback) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fallback);
    return fallback;
  }
}

function visibleBody(raw) {
  let t = String(raw || "").trim();
  t = t.replace(/<!--[\s\S]*?-->/g, "").trim();
  return t;
}

function soulSnapshot(root, id) {
  const file = path.join(botDir(root, id), "SOUL.md");
  seedSoulFile(file, DEFAULT_SOUL);
  try {
    return visibleBody(fs.readFileSync(file, "utf8"));
  } catch {
    return visibleBody(DEFAULT_SOUL);
  }
}

function memorySnapshot(root, id) {
  const file = memoryFile(root, id);
  return readOrSeed(file, "").trim();
}

function memoryAdd(root, id, text) {
  const file = memoryFile(root, id);
  const prev = memorySnapshot(root, id);
  const line = `- ${String(text || "").trim()}`;
  if (!line.slice(2)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, prev ? `${prev}\n${line}\n` : `${line}\n`);
}

function userSnapshot(root, id) {
  return readOrSeed(userFile(root, id), "").trim();
}

function parseLines(body) {
  return String(body || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function writeLines(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.length ? `${lines.join("\n")}\n` : "");
}

function bodySize(lines) {
  if (!lines.length) return 0;
  return lines.join("\n").length;
}

function bounded(lines, limit, keepIdx) {
  if (limit == null) return lines;
  const next = lines.slice();
  if (
    keepIdx != null &&
    keepIdx >= 0 &&
    keepIdx < next.length &&
    bodySize(next) > limit
  ) {
    next.push(next.splice(keepIdx, 1)[0]);
  }
  while (next.length > 1 && bodySize(next) > limit) next.shift();
  if (next.length && bodySize(next) > limit) {
    const clipped = next[next.length - 1].slice(0, limit).trim();
    return clipped ? [clipped] : [];
  }
  return next;
}

function bullet(text) {
  return `- ${String(text || "").trim()}`;
}

function matchIndex(lines, needle) {
  const n = String(needle || "").trim();
  if (!n) throw new Error("Match text cannot be empty.");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(n)) hits.push(i);
  }
  if (!hits.length) throw new Error(`No entry matched '${n}'.`);
  const unique = new Set(hits.map((i) => lines[i]));
  if (unique.size > 1) {
    throw new Error(`Multiple entries matched '${n}'. Be more specific.`);
  }
  return hits[0];
}

function userAdd(root, id, text) {
  const file = userFile(root, id);
  const line = bullet(text);
  if (!line.slice(2)) return;
  const lines = parseLines(userSnapshot(root, id));
  if (lines.includes(line)) return;
  lines.push(line);
  writeLines(file, bounded(lines, USER_LIMIT));
}

function replaceEntry(file, body, needle, text, limit) {
  const line = bullet(text);
  if (!line.slice(2)) throw new Error("Content cannot be empty.");
  const lines = parseLines(body);
  const idx = matchIndex(lines, needle);
  lines[idx] = line;
  writeLines(file, bounded(lines, limit, idx));
}

function removeEntry(file, body, needle) {
  const lines = parseLines(body);
  const idx = matchIndex(lines, needle);
  lines.splice(idx, 1);
  writeLines(file, lines);
}

function memoryReplace(root, id, needle, text) {
  replaceEntry(memoryFile(root, id), memorySnapshot(root, id), needle, text);
}

function memoryRemove(root, id, needle) {
  removeEntry(memoryFile(root, id), memorySnapshot(root, id), needle);
}

function userReplace(root, id, needle, text) {
  replaceEntry(userFile(root, id), userSnapshot(root, id), needle, text, USER_LIMIT);
}

function userRemove(root, id, needle) {
  removeEntry(userFile(root, id), userSnapshot(root, id), needle);
}

module.exports = {
  DEFAULT_SOUL,
  SOUL_VERSION,
  soulVersionOf,
  seedSoulFile,
  soulSnapshot,
  memorySnapshot,
  memoryAdd,
  memoryReplace,
  memoryRemove,
  userSnapshot,
  userAdd,
  userReplace,
  userRemove,
};
