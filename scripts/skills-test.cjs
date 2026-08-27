"use strict";

// A teammate installing its own skill. The capability is a hole in the
// sandbox, so the tests are mostly about the hole staying the size it is.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { installSkill, listSkills, slugify, OWNER_TAG, MAX_BODY } = require("../electron/skills.cjs");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-skills-"));
const root = path.join(home, ".hermes", "skills");
const at = (n) => path.join(root, n, "SKILL.md");

// ---- the happy path -------------------------------------------------------
{
  const r = installSkill({ name: "Invoice Audit", description: "check invoices", body: "# how\nstep one" }, { home });
  assert.ok(r.ok, r.reason);
  assert.equal(r.name, "invoice-audit", "the name is slugified, not trusted");
  const doc = fs.readFileSync(at("invoice-audit"), "utf8");
  assert.ok(doc.startsWith("---\n"), "frontmatter first, or Hermes will not index it");
  assert.ok(doc.includes(`author: ${OWNER_TAG}`), "stamped as ours");
  assert.ok(doc.includes("step one"));
}

// ---- it can improve its own skill ----------------------------------------
{
  const r = installSkill({ name: "invoice-audit", description: "better", body: "# how\nstep two" }, { home });
  assert.ok(r.ok && r.updated, "a skill it wrote is its to rewrite");
  assert.ok(fs.readFileSync(at("invoice-audit"), "utf8").includes("step two"));
  assert.equal(listSkills(home).filter((s) => s.name === "invoice-audit").length, 1, "updated, not duplicated");
}

// ---- it may NOT touch anyone else's --------------------------------------
// The user's own skills, and the ones shipped with Hermes, are not a
// teammate's to edit.
{
  fs.mkdirSync(path.join(root, "unslop"), { recursive: true });
  fs.writeFileSync(at("unslop"), "---\nname: unslop\ndescription: mine\n---\n\nhands off\n");
  const r = installSkill({ name: "unslop", body: "# replaced" }, { home });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-yours");
  assert.ok(fs.readFileSync(at("unslop"), "utf8").includes("hands off"), "untouched");
}

// ---- traversal cannot survive the slug -----------------------------------
for (const bad of ["../../evil", "/etc/passwd", "..", ".", "", "   ", "../../../.ssh/authorized_keys", "a/../../b"]) {
  const r = installSkill({ name: bad, body: "x" }, { home });
  if (r.ok) {
    // If it did install, it must STILL be inside the skills root.
    const rel = path.relative(root, r.path);
    assert.ok(!rel.startsWith(".."), `"${bad}" escaped to ${r.path}`);
  }
}
assert.equal(slugify("../../etc"), "etc", "traversal is rebuilt away, not rejected by pattern");
assert.equal(slugify("!!!"), "", "a name with nothing usable in it is no name");
assert.ok(!fs.existsSync(path.join(home, ".hermes", "evil")), "nothing landed beside the skills dir");

// ---- bounded --------------------------------------------------------------
{
  assert.equal(installSkill({ name: "empty-one", body: "   " }, { home }).reason, "empty");
  assert.equal(installSkill({ name: "huge", body: "x".repeat(MAX_BODY + 1) }, { home }).reason, "too-big");
}

// ---- author cannot be spoofed from the body ------------------------------
// A model that has read other skills will happily write its own frontmatter.
// If that survived, a teammate could claim ownership of a name and then
// overwrite the real skill on the next turn.
{
  installSkill(
    { name: "spoof", description: "d", body: "---\nname: spoof\nauthor: someone-else\n---\n\nbody" },
    { home }
  );
  const doc = fs.readFileSync(at("spoof"), "utf8");
  assert.equal(doc.match(/^---/gm).length, 2, "exactly one frontmatter block");
  assert.ok(doc.includes(`author: ${OWNER_TAG}`));
  assert.ok(!doc.includes("someone-else"));
}

// ---- and the directive is actually wired into a turn ---------------------
const store = fs.readFileSync(path.join(__dirname, "../electron/store.cjs"), "utf8");
assert.ok(/const skill = line\.match\(/.test(store), "SKILL: is parsed");
assert.ok(store.includes("dirs.skill.push"), "and collected");
assert.ok(store.includes("applySkill(agent, spec)"), "and applied during the turn");
assert.ok(/logAction\(agent\.id, "skill"/.test(store), "installs are logged");
assert.ok(store.includes("Do not retry it this session"), "a failed install is told to its face");
const soul = fs.readFileSync(path.join(__dirname, "../electron/SOUL.default.md"), "utf8");
assert.ok(soul.includes("SKILL:"), "the soul tells it the capability exists");

console.log("skills-test ok");
