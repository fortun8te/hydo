#!/usr/bin/env node
"use strict";

/**
 * benchmark.cjs — replay a real Grok Bot transcript against a fresh teammate.
 *
 * "It feels stiff" is not actionable, and three times this week it was wrong
 * about the cause: the first diagnosis was the prose, and the actual defects
 * were a missing name in context, directives that silently never applied, and
 * a menu ban firing on a direct question. Guessing at soul edits without
 * running a turn is how that keeps happening.
 *
 * So each case in scripts/benchmarks/ stores the user's real messages next to
 * the reply the reference client gave, and this prints ours beside theirs.
 * It does not score anything — there is no honest automatic metric for "does
 * this sound like a person", and a number would only invite tuning against
 * the number. It puts the two transcripts side by side and leaves the
 * judgement where it belongs.
 *
 *   node scripts/benchmark.cjs            # every case
 *   node scripts/benchmark.cjs james nate # named cases
 *
 * Real tokens on a real model, so NOT part of `npm test`. Each case gets a
 * throwaway store directory and a throwaway profile root: the user's own
 * roster, state.json and ~/.hermes profiles are never touched.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CASES = path.join(__dirname, "benchmarks");

// Before requiring the store: bot-home reads this at profile-creation time,
// and without it every run would leave permanent profiles in the user's real
// Hermes home (1,198 of them accumulated that way before it was overridable).
process.env.HYDO_PROFILE_ROOT =
  process.env.HYDO_PROFILE_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), "hydo-bench-profiles-"));

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const USER = "\x1b[36m";
const OURS = "\x1b[32m";
const THEIRS = "\x1b[33m";

const wrap = (text, indent) => {
  const width = 92;
  const pad = " ".repeat(indent);
  return String(text || "")
    .split("\n")
    .flatMap((line) => {
      const out = [];
      let cur = "";
      for (const word of line.split(/\s+/)) {
        if (!word) continue;
        if ((cur + " " + word).trim().length > width) {
          out.push(cur.trim());
          cur = word;
        } else {
          cur += ` ${word}`;
        }
      }
      out.push(cur.trim());
      return out.length ? out : [""];
    })
    .map((l) => pad + l)
    .join("\n");
};

async function runCase(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hydo-bench-${spec.name}-`));
  delete require.cache[require.resolve("../electron/store.cjs")];
  const store = require("../electron/store.cjs").createStore({ dir });
  store.signIn();
  const id = store.createAgent({ name: spec.bot || "New Bot" }).selectedId;
  store.select(id);

  console.log(`\n${"=".repeat(100)}`);
  console.log(`${spec.name.toUpperCase()}  —  ${spec.about}`);
  console.log("=".repeat(100));

  let seen = 0;
  for (const turn of spec.turns) {
    console.log(`\n${USER}USER:${RESET}`);
    console.log(wrap(turn.user, 2));

    let state;
    const started = Date.now();
    try {
      state = await store.send(turn.user);
    } catch (err) {
      console.log(`  ${OURS}OURS:${RESET} (turn failed: ${err && err.message})`);
      continue;
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    // Only the bubbles this turn produced, in order.
    const all = (state.messages[id] || []).filter((m) => m.role === "bot" && m.kind === "chat");
    const fresh = all.slice(seen);
    seen = all.length;
    const agent = state.agents.find((a) => a.id === id);

    console.log(`\n${OURS}OURS${RESET} ${DIM}(${agent.name}, ${fresh.length} bubble(s), ${secs}s)${RESET}`);
    if (!fresh.length) console.log(wrap("(said nothing)", 2));
    for (const m of fresh) console.log(wrap(m.text, 2));

    if (turn.reference) {
      console.log(`\n${THEIRS}THEIRS${RESET} ${DIM}(reference)${RESET}`);
      console.log(wrap(turn.reference, 2));
    }

    // Anything the turn changed about the teammate itself is part of the
    // answer: a rename that did not land reads as the model ignoring the user.
    if (agent.description) console.log(`\n${DIM}  description: ${agent.description.slice(0, 160)}${RESET}`);
    const others = state.agents.filter((a) => a.id !== id);
    if (others.length) {
      console.log(`${DIM}  roster now: ${others.map((a) => a.name).join(", ")}${RESET}`);
    }
  }
}

(async () => {
  const want = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const files = fs
    .readdirSync(CASES)
    .filter((f) => f.endsWith(".json"))
    .filter((f) => !want.length || want.includes(path.basename(f, ".json")));

  if (!files.length) {
    console.error(`No benchmark named ${want.join(", ")}. Available: ${fs.readdirSync(CASES).filter((f) => f.endsWith(".json")).map((f) => path.basename(f, ".json")).join(", ")}`);
    process.exit(1);
  }

  for (const f of files) {
    const spec = JSON.parse(fs.readFileSync(path.join(CASES, f), "utf8"));
    try {
      await runCase(spec);
    } catch (err) {
      console.error(`\n${spec.name} failed: ${err && err.message}`);
    }
  }

  try {
    await require("../electron/hermes-gateway.cjs").shutdown();
  } catch {
    /* nothing to shut down */
  }
  console.log("\nDone. Compare OURS against THEIRS by eye — there is no honest score for this.");
  process.exit(0);
})();
