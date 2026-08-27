"use strict";

/**
 * The front of the prompt must not change between turns.
 *
 * A local endpoint caches the prompt prefix, and the saving is not small.
 * Measured against the user's box with the builder profile's 29 tool schemas
 * (3,338 prompt tokens):
 *
 *   cold                 9.4s   before a single output token
 *   warm, same prompt    1.5s   3,334 of 3,338 tokens cached
 *   same tools, new msg  2.6s   2,822 cached
 *
 * So the schema cost is once per SESSION, not once per turn — as long as the
 * prefix is byte-identical. Put anything volatile near the front and every turn
 * pays the cold price again: roughly EIGHT SECONDS, per message, forever, for a
 * timestamp nobody asked to see.
 *
 * This already bit once in a different disguise: a changed `reasoning_effort`
 * counted as a different session, so the session was rebuilt before every first
 * real turn. That was priced as "a wasteful extra call" until this measurement
 * showed it was discarding the cache.
 *
 * Nothing errors when this regresses. The app just gets slow, on a model where
 * slow is the whole problem. Hence a test.
 */

const assert = require("node:assert");
const modelPick = require("../electron/model-pick.cjs");

const agent = {
  id: "a1",
  name: "Dev",
  toolProfile: "builder",
  model: "unsloth/Qwen3.8-Flash-Next-GGUF",
  provider: "unsloth",
  boxEnabled: true,
  toolsets: [],
};
const settings = {
  model: "unsloth/Qwen3.8-Flash-Next-GGUF",
  provider: "unsloth",
  boxId: "bx_843rh875",
};

// ---- same inputs must give the same bytes ---------------------------------
const first = modelPick.agentsModelBlock(agent, settings);
const again = modelPick.agentsModelBlock(agent, settings);
assert.strictEqual(first, again, "the model block must be a pure function of its inputs");

// ---- and must contain nothing that moves on its own -----------------------
//
// Checked as VALUES, not by grepping the source: a comment explaining the rule
// would otherwise trip a source scan, which has happened three times in this
// repo already.
const volatile = [
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "an ISO timestamp"],
  [/\b\d{1,2}:\d{2}\s?(AM|PM)\b/i, "a wall clock"],
  [/\b1[6-9]\d{8,}\b/, "an epoch millisecond stamp"],
  [/\bsession[-_]?id\b/i, "a per-session id"],
];
for (const [re, what] of volatile) {
  assert.ok(
    !re.test(first),
    `the model block carries ${what}, which invalidates the prefix cache on every turn`
  );
}

// ---- the box block too, since it sits in the same file --------------------
//
// It names a box id, which is stable, but it must not start naming a state or
// an uptime — both of those move.
assert.ok(
  !/\b(awake|asleep|running|stopped)\b/i.test(first),
  "the model block must not carry the machine's STATE; that changes under you"
);

console.log(`prefix-cache-test ok (${first.length} stable bytes)`);
