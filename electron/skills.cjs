"use strict";

/**
 * A teammate writing down its own method.
 *
 * Hermes' `skills` toolset is in every tool profile, so a bot can already LIST
 * and READ skills. It could not write one. Its cwd is
 * `<hydo>/bots/<id>/workspace` and skills live in `~/.hermes/skills`, outside
 * the sandbox on purpose, so the one thing a teammate could never do was keep
 * what it worked out. Every job started from zero and the tenth invoice was
 * reasoned about exactly as slowly as the first.
 *
 * This is deliberately the narrowest possible hole in that wall: one markdown
 * file, in one directory, under a validated slug. It is not file access.
 *
 * What stops it being dangerous:
 *   - the slug is rebuilt from scratch out of [a-z0-9-], so `../` and absolute
 *     paths cannot survive being parsed, let alone be written
 *   - the resolved path is checked to still be inside the skills directory
 *     after resolution, because validating input is not the same as validating
 *     the result
 *   - a skill Hydo did not write is never overwritten. The user's own skills,
 *     and the ones shipped with Hermes, are not a teammate's to edit
 *   - size and count are capped, so a loop cannot fill the disk
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_BODY = 24_000;
const MAX_SKILLS = 60;
// Written into the frontmatter and checked before any overwrite. A skill
// without this line was written by someone else and is not ours to touch.
const OWNER_TAG = "hydo-teammate";

function skillsRoot(home) {
  return path.join(String(home || os.homedir()), ".hermes", "skills");
}

/**
 * A directory name that cannot escape. Built by keeping only safe characters
 * rather than by rejecting bad ones: a blocklist has to imagine every attack,
 * an allowlist only has to describe what a skill name looks like.
 */
function slugify(name) {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return /^[a-z0-9][a-z0-9-]*$/.test(s) ? s : "";
}

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(String(text || ""));
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z_-]+):\s*(.*)$/i.exec(line.trim());
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim();
  }
  return out;
}

/** Did Hydo write this one? */
function ownedByUs(file) {
  try {
    return parseFrontmatter(fs.readFileSync(file, "utf8")).author === OWNER_TAG;
  } catch {
    return false;
  }
}

function listSkills(home) {
  const root = skillsRoot(home);
  let names = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  return names
    .map((name) => {
      const file = path.join(root, name, "SKILL.md");
      let fm = {};
      try {
        fm = parseFrontmatter(fs.readFileSync(file, "utf8"));
      } catch {
        return null;
      }
      return { name, description: fm.description || "", mine: fm.author === OWNER_TAG };
    })
    .filter(Boolean);
}

/**
 * Install or update one skill.
 *
 * @returns {{ok:boolean, name?:string, path?:string, reason?:string, updated?:boolean}}
 */
function installSkill(spec, opts = {}) {
  const home = opts.home || os.homedir();
  const name = slugify(spec && spec.name);
  if (!name) return { ok: false, reason: "bad-name" };

  const body = String((spec && spec.body) || "").trim();
  if (!body) return { ok: false, reason: "empty" };
  if (body.length > MAX_BODY) return { ok: false, reason: "too-big" };

  const root = skillsRoot(home);
  const dir = path.join(root, name);
  // Validate the RESULT, not just the input. Checking the slug and then
  // trusting the join is how traversal bugs get written.
  if (path.resolve(dir) !== path.join(path.resolve(root), name)) {
    return { ok: false, reason: "outside-skills" };
  }

  const file = path.join(dir, "SKILL.md");
  const exists = fs.existsSync(file);
  if (exists && !ownedByUs(file)) return { ok: false, reason: "not-yours" };
  if (!exists && listSkills(home).length >= MAX_SKILLS) return { ok: false, reason: "too-many" };

  const description = String((spec && spec.description) || "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);

  // The body may already carry its own frontmatter from a model that has seen
  // other skills; strip it so there is exactly one block and `author` cannot
  // be spoofed by writing it into the body.
  const bare = body.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  const doc = `---\nname: ${name}\ndescription: ${description}\nauthor: ${OWNER_TAG}\n---\n\n${bare}\n`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, doc);
  } catch (err) {
    return { ok: false, reason: `write-failed: ${err.message}` };
  }
  return { ok: true, name, path: file, updated: exists };
}

module.exports = { installSkill, listSkills, slugify, skillsRoot, OWNER_TAG, MAX_BODY, MAX_SKILLS };
