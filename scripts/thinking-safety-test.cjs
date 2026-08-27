"use strict";

/**
 * A teammate must never silently lose its reasoning.
 *
 * Measured on the user's own box (docs/LOCAL-MODEL.md): with the scratchpad off,
 * Qwen3.8-Flash-Next answers the bat-and-ball question **0.10 instead of 0.05**
 * — three times faster and wrong. On an easy question it is identical and
 * quicker. So the setting is worth having and catastrophic to apply broadly.
 *
 * Two ways it could be applied broadly by accident, both real:
 *
 *   1. Two `providers:` entries pointing at ONE url are ONE entry. Hermes
 *      rewrites `custom:<name>` to bare `custom` and then matches `extra_body`
 *      by BASE URL ALONE (agent_init.py:429), so the first entry in the file
 *      decides for every name aimed at that server. Proven on the wire: with
 *      both on the same url, asking for the CAREFUL one still sent
 *      enable_thinking:false. The naive config turns thinking off for
 *      everything.
 *   2. The fast lane widening past the one turn it was built for.
 *
 * Nothing errors in either case. The model just gets quietly worse at exactly
 * the questions it is worth having for. Hence a test rather than a comment.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const lp = require("../electron/local-providers.cjs");

const ROOT = path.join(__dirname, "..");
const store = fs.readFileSync(path.join(ROOT, "electron/store.cjs"), "utf8");

// ---- the lane is opt-in, and refuses by default -----------------------------
//
// Against whatever is really in ~/.hermes/config.yaml right now: no provider may
// resolve a fast twin unless the user deliberately added one at a DIFFERENT
// address. Shipping this on by guesswork is the failure that costs correctness.
for (const p of lp.list()) {
  const twin = lp.fastLaneFor(p.id, p.model || "");
  if (twin) {
    // A twin is allowed — but only a real one, at its own address.
    const mine = lp.list().find((x) => `custom:${x.id}` === twin || x.id === twin.replace(/^custom:/, ""));
    assert.ok(mine, `${p.id} resolved a twin (${twin}) that is not in the config`);
    assert.notStrictEqual(
      String(mine.api || "").replace(/\/+$/, ""),
      String(p.api || "").replace(/\/+$/, ""),
      `${p.id}'s fast twin shares its url — Hermes matches extra_body by url, so BOTH lanes would lose thinking`
    );
  }
}

// ---- and only the greeting may ever take it ---------------------------------
assert.ok(
  /flags\.lean/.test(store),
  "the fast lane must be gated on the landing turn Hydo writes itself"
);
// Assert the EXPRESSION, not a window around the first mention. The first
// mention is a comment, and a fixed-size window from it silently missed the
// gate thirteen lines later — a test that fails for the wrong reason is one
// edit away from being "fixed" by widening it until it passes.
assert.ok(
  /const fastLane =\s*\n?\s*flags\.lean && typeof gateway\.fastLaneFor === "function"/.test(store),
  "a turn the user typed must never take the fast lane: a wrong answer costs more than ten seconds of waiting"
);

console.log(`thinking-safety-test ok (${lp.list().length} providers, none silently degraded)`);
