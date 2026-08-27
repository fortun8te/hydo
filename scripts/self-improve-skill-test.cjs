"use strict";

/**
 * The skill that lets a teammate change Hydo is itself load-bearing safety.
 *
 * It is the only thing standing between "a bot improved the sidebar" and "a
 * bot edited the checkout the running app is served from, or rewrote
 * state.json, which is where the user's teammates actually live". A skill is
 * prose, so nothing in the runtime enforces it — which is exactly why the
 * guardrails get a test. Prose rots silently; a deleted sentence looks like a
 * tidy-up.
 *
 * So this asserts the *rules are still written down*, not that they are
 * obeyed. And it checks every path and script the skill tells a teammate to
 * run really exists, because a workflow that 404s on step one is a workflow
 * the model will improvise around.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "skills", "hydo-self-improve", "SKILL.md");

let failed = 0;
const check = (label, fn) => {
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`  FAIL ${label}: ${(err && err.message) || err}`);
  }
};

assert.ok(fs.existsSync(FILE), `the skill is missing: ${FILE}`);
const doc = fs.readFileSync(FILE, "utf8");

// ---- well-formed, or Hermes will not index it -----------------------------
check("frontmatter first", () => {
  assert.ok(doc.startsWith("---\n"), "frontmatter must be the first thing in the file");
});

const fm = {};
for (const line of /^---\n([\s\S]*?)\n---/.exec(doc)[1].split("\n")) {
  const kv = /^([a-z_-]+):\s*(.*)$/i.exec(line.trim());
  if (kv) fm[kv[1].toLowerCase()] = kv[2].trim();
}

check("name matches its directory", () => {
  assert.equal(fm.name, "hydo-self-improve");
});
check("has a description a model can route on", () => {
  assert.ok(fm.description && fm.description.length > 40, "too short to trigger on");
  assert.ok(fm.description.length <= 200, "electron/skills.cjs truncates at 200 chars");
});
// installSkill() only overwrites files stamped `author: hydo-teammate`. Anything
// else comes back "not-yours". Keeping this skill OFF that tag means a teammate
// cannot use `SKILL: install` to rewrite the rules it is being held to.
check("not owned by the teammate tag", () => {
  assert.notEqual(fm.author, "hydo-teammate", "a bot could then overwrite its own guardrails");
});

// ---- the guardrails are still named --------------------------------------
const NAMED = [
  [/git worktree add/, "how to get off the live checkout"],
  [/Never edit files under `\/Users\/michael\/Projects\/hydo` directly/, "never the live checkout"],
  [/Application Support\/Hydo/, "never the user's app data"],
  [/[Nn]ever merge/, "never merge"],
  [/never `git push`/, "never push"],
  [/npm run smoke/, "the smoke test reads real state.json — it must be forbidden by name"],
  [/gh auth status/, "check GitHub before promising a PR"],
  [/no git remote/, "the honest degrade when GitHub cannot work"],
  [/do not run `gh auth login`/, "authenticating is the user's job, not a bot's"],
  [/npm test/, "the suite"],
  [/npm run build/, "the build"],
  [/scripts\/shot\.cjs/, "the screenshot, for the changes-no-pixels bug"],
  [/thinking off/, "do not disable thinking for code work"],
];
for (const [re, why] of NAMED) {
  check(`names: ${why}`, () => assert.match(doc, re));
}

// ---- nothing in it auto-applies anything ---------------------------------
// The rule the user cares about most: a change reaches the running app only
// when a human merges it.
for (const forbidden of [/git merge (?!hydo)/, /\bnpm run relaunch\b/, /--no-ff/, /gh pr merge/]) {
  check(`does not instruct: ${forbidden}`, () => assert.doesNotMatch(doc, forbidden));
}

// ---- everything it points at exists --------------------------------------
for (const ref of [
  "scripts/shot.cjs",
  "scripts/window-check.cjs",
  "scripts/sidebar-sections-test.cjs",
  "scripts/plan-active-test.cjs",
  "docs/LOCAL-MODEL.md",
  "electron/main.cjs",
]) {
  check(`referenced file exists: ${ref}`, () => {
    assert.ok(doc.includes(ref.split("/").pop()), `skill no longer mentions ${ref}`);
    assert.ok(fs.existsSync(path.join(ROOT, ref)), `${ref} is gone; the skill sends bots at nothing`);
  });
}

// The screenshot harness must not be able to reach the real app: it is the one
// verification step that boots Electron, so it is the one that could.
check("shot.cjs never loads main.cjs", () => {
  const shot = fs.readFileSync(path.join(ROOT, "scripts", "shot.cjs"), "utf8");
  assert.doesNotMatch(shot, /require\([^)]*main\.cjs/, "that would open the user's real state.json");
  assert.match(shot, /app\.exit\(/, "must always exit or it hangs the agent's shell");
});

// ---- the installed copy, if the user has one, is not a bot's to rewrite ---
check("installed copy is not teammate-owned", () => {
  const live = path.join(os.homedir(), ".hermes", "skills", "hydo-self-improve", "SKILL.md");
  if (!fs.existsSync(live)) return; // not installed on this machine: fine
  assert.doesNotMatch(fs.readFileSync(live, "utf8"), /^author:\s*hydo-teammate$/m);
});

if (failed) {
  console.error(`self-improve skill: ${failed} failed`);
  process.exit(1);
}
console.log("self-improve skill ok — worktree workflow, guardrails and every file it points at");
