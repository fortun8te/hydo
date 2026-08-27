"use strict";

/**
 * slow-model-test — a teammate answering on the user's own hardware.
 *
 * The endpoint in docs/LOCAL-MODEL.md was measured at ~16 completion tokens
 * per second (214 tokens in 13.42s, 152 in 9.39s). Every number asserted here
 * is derived from that rate, because "slow" is not a feeling — it is a rate,
 * and a deadline is only wrong relative to one.
 *
 * Four things this pins:
 *   1. Which hosts count as "your own hardware". The address that matters is
 *      Tailscale CGNAT (100.64/10), which is NOT RFC-1918 and reads as a
 *      public cloud host to a naive check. Getting this wrong is silent: the
 *      teammate keeps the hosted ceiling and dies mid-answer.
 *   2. The local turn ceiling clears Hermes' own local numbers. If Hydo's
 *      ceiling sits under the machinery Hermes is still legally running, Hydo
 *      kills turns that were fine.
 *   3. The hosted ceiling does NOT move. A timeout that never fires is its own
 *      bug — this test exists partly to stop a future "just raise it".
 *   4. `reasoning_effort` is not sent to a transport that drops it, and a
 *      field that is dropped never costs a session rebuild.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const lp = require(path.join(ROOT, "electron/local-providers.cjs"));
const presence = fs.readFileSync(path.join(ROOT, "src/lib/presence.js"), "utf8");

// The measured rate. Everything below is quoted against it.
const TOK_PER_SEC = 16;
const tokens = (ms) => Math.round((ms / 1000) * TOK_PER_SEC);

// ---------------------------------------------------------------- 1. hosts
for (const host of [
  "100.74.135.83:8888", // the user's Unsloth box, over Tailscale
  "100.64.0.1",
  "100.127.255.254",
  "127.0.0.1:8888",
  "localhost:11434",
  "192.168.1.42:8888",
  "10.0.0.5",
  "172.16.4.1",
  "169.254.1.1",
  "host.docker.internal",
  "workstation", // unqualified name
]) {
  assert.equal(lp.isLocalHost(host), true, `${host} is the user's own hardware`);
}
for (const host of [
  "api.openai.com",
  "openrouter.ai",
  "100.128.0.1", // one past the top of CGNAT
  "100.63.255.255", // one below the bottom
  "8.8.8.8",
  "",
]) {
  assert.equal(lp.isLocalHost(host), false, `${host} is not local`);
}

// paceOf reads a provider record, not a URL, because that is the shape the
// config parser hands back.
assert.deepEqual(
  lp.paceOf({ id: "unsloth", host: "100.74.135.83:8888" }),
  { local: true, reasoningHonoured: false },
  "an Unsloth box: local, and the transport drops reasoning_effort"
);
// LM Studio is the exception Hermes actually implements — provider id, not URL
// (run_agent.py:7651). It is local AND it is one of the few routes that gets a
// top-level reasoning_effort.
assert.deepEqual(
  lp.paceOf({ id: "lmstudio", host: "localhost:1234" }),
  { local: true, reasoningHonoured: true },
  "LM Studio honours reasoning_effort"
);
assert.deepEqual(
  lp.paceOf({ id: "ollama-cloud", host: "ollama.com" }),
  { local: false, reasoningHonoured: true },
  "Ollama Cloud is hosted, and Hermes gates it on the /api/show capability"
);

// paceFor resolves a NAME the way a session carries it, and is total: an
// unknown name must degrade to hosted rather than throw mid-turn.
const tmp = path.join(os.tmpdir(), `hydo-slowmodel-${process.pid}.yaml`);
fs.writeFileSync(
  tmp,
  `providers:
  unsloth:
    api: http://100.74.135.83:8888/v1
    api_key: sk-secret
    default_model: unsloth/Qwen3.8-Flash-Next-GGUF
    transport: chat_completions
`
);
try {
  assert.deepEqual(lp.paceFor("unsloth", tmp), { local: true, reasoningHonoured: false });
  assert.deepEqual(lp.paceFor("xai-oauth", tmp), { local: false, reasoningHonoured: true });
  assert.deepEqual(lp.paceFor("", tmp), { local: false, reasoningHonoured: true });
} finally {
  fs.unlinkSync(tmp);
}

// ------------------------------------------------------------- 2/3. ceiling
const gateway = require(path.join(ROOT, "electron/hermes-gateway.cjs"));
const { TURN_TIMEOUT_MS, LOCAL_TURN_TIMEOUT_MS, REQUEST_TIMEOUT_MS } = gateway.TIMEOUTS;

// The hosted ceiling is not a knob to turn up. 900s buys 14,400 tokens at the
// measured rate; on a hosted provider anything approaching it is a wedged
// stream, and the user is better served by an error than by a spinner.
assert.equal(TURN_TIMEOUT_MS, 900_000, "the hosted turn ceiling did not move");
assert.equal(tokens(TURN_TIMEOUT_MS), 14_400);

// Hermes' own local numbers, read from ~/.hermes/hermes-agent:
//   agent/chat_completion_helpers.py — httpx read timeout 1800s for a local
//     endpoint, stale-stream detector 900s (HERMES_LOCAL_STREAM_STALE_TIMEOUT)
//   agent/auxiliary_client.py — a progress-hooked compaction stream is bounded
//     at max(600, 4 x 300) = 1200s
// The turn ceiling has to clear ALL of them: whichever fires first owns the
// error message, and Hydo's generic "turn timed out" is the least useful of
// the three.
const HERMES_LOCAL_STALE_MS = 900_000;
const HERMES_COMPACTION_CEILING_MS = 1_200_000;
assert.ok(
  LOCAL_TURN_TIMEOUT_MS > HERMES_COMPACTION_CEILING_MS,
  "one legal Hermes compaction (1200s) must not exhaust the whole turn ceiling"
);
assert.ok(
  LOCAL_TURN_TIMEOUT_MS > HERMES_LOCAL_STALE_MS,
  "Hermes' stale-stream detector owns retry and diagnostics — it must fire first"
);
// And it is still a ceiling, not infinity: something has to end a dead turn.
assert.ok(LOCAL_TURN_TIMEOUT_MS <= 4 * 60 * 60 * 1000, "still bounded");

assert.equal(gateway.turnCeilingFor("unsloth"), LOCAL_TURN_TIMEOUT_MS);
assert.equal(gateway.turnCeilingFor("xai-oauth"), TURN_TIMEOUT_MS);
assert.equal(gateway.turnCeilingFor(""), TURN_TIMEOUT_MS, "no provider named → hosted");

// The RPC timeout is deliberately NOT raised. Every RPC Hydo issues returns
// immediately server-side (session.create / prompt.submit / *.respond); the
// generation happens on the event stream, which the turn ceiling covers. The
// one long RPC, session.compress, is already issued at the turn ceiling.
assert.equal(REQUEST_TIMEOUT_MS, 120_000, "the RPC timeout is not a generation deadline");
const gatewaySrc = fs.readFileSync(path.join(ROOT, "electron/hermes-gateway.cjs"), "utf8");
assert.ok(
  /request\('session\.compress'|'session\.compress', params, TURN_TIMEOUT_MS/.test(gatewaySrc),
  "session.compress is the one RPC that waits on generation, and waits at the turn ceiling"
);

// ------------------------------------------------------- 4. inert knobs
// Hermes only puts reasoning_effort on the wire when
// _supports_reasoning_extra_body() says yes (run_agent.py:7629), and a plain
// OpenAI-compatible box is not on that list. Sending it anyway is not free:
// sessionFor treats a changed effort as a different session, so the landing
// turn ("minimal") followed by the first real turn ("low") tore the session
// down and rebuilt it — a cold agent init and a re-prefill at 16 tok/s, bought
// with a field the endpoint never saw.
assert.ok(
  /paceFor\(opts\.provider\)\.reasoningHonoured/.test(gatewaySrc),
  "createParams gates reasoning_effort on whether the transport sends it"
);
assert.ok(
  /const honoursEffort = paceFor\(opts\.provider\)\.reasoningHonoured;/.test(gatewaySrc),
  "and the session-reuse comparison uses the same rule, or the rebuild comes back"
);
assert.deepEqual(gateway.paceFor("xai-oauth"), { local: false, reasoningHonoured: true });

// ------------------------------------------------- legibility of a long turn
// presence.js is an ES module the renderer imports and this test is CJS, so
// evaluate its pure exports rather than adding a loader for three functions.
const { elapsedLabel, SLOW_TURN_MS, presenceOf } = evalPresence();

function evalPresence() {
  const src = presence
    .replace(/^export /gm, "")
    .replace(/^import .*$/gm, "");
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("module", "exports", `${src}\nmodule.exports = { elapsedLabel, SLOW_TURN_MS, presenceOf };`)(
    mod,
    mod.exports
  );
  return mod.exports;
}

// The threshold is a legibility choice, not a deadline: past every short local
// answer, well past anything a hosted model does routinely.
assert.equal(SLOW_TURN_MS, 20_000);
assert.equal(tokens(SLOW_TURN_MS), 320, "20s is ~320 tokens at the measured rate");

assert.equal(elapsedLabel(0, Date.now()), "", "a turn this window did not start gets no guessed clock");
assert.equal(elapsedLabel(1000, 1000 + SLOW_TURN_MS - 1), "", "nothing before the threshold");
assert.equal(elapsedLabel(1000, 1000 + SLOW_TURN_MS), "20s");
// A 2,000-token answer at 16 tok/s. This is the wait the clock exists for.
const twoThousandTokensMs = (2000 / TOK_PER_SEC) * 1000;
assert.equal(elapsedLabel(0 + 1, 1 + twoThousandTokensMs), "2m 5s");
assert.equal(elapsedLabel(1, 1 + 3_600_000), "60m 0s", "and it never stops being a number");
assert.equal(elapsedLabel(5000, 1000), "", "a clock that runs backwards says nothing");

// The presence machinery itself must never give up on a working turn — the
// clock would be pointless if the face vanished at some threshold.
for (const ageMs of [1000, 120_000, 1_800_000]) {
  const p = presenceOf({ working: true, now: 1_000_000 + ageMs, since: 1_000_000 });
  assert.equal(p.visible, true, `still visible after ${ageMs}ms of work`);
}

// ------------------------------------------------------------ wiring checks
// In this codebase a pure function nobody calls looks exactly like one that
// works, so check the renderer actually renders it and the class exists.
const transcript = fs.readFileSync(path.join(ROOT, "src/screens/Transcript.jsx"), "utf8");
assert.ok(/elapsedLabel/.test(transcript), "Transcript imports the clock");
assert.ok(/sand-inchat__elapsed/.test(transcript), "and renders it");
assert.ok(
  !/sand-inchat__busy">\{busy\}\s*\{/.test(transcript),
  "the clock is a sibling of the busy span, never its child — that span has a transparent text fill"
);
const css = fs.readFileSync(path.join(ROOT, "src/screens/transcript.css"), "utf8");
assert.ok(/\.sand-inchat__elapsed\s*\{/.test(css), "the class the mark uses exists");

// ------------------------------------------------- compaction is not silent
// Hermes' native compaction is on by default and Hydo must not fight it; what
// Hydo owns is SAYING it happened. Both paths (pre-turn and post-turn) post
// the same sentence, from one definition — a modest-context model compacts
// often, and the pre-turn path used to write only to the action log, so the
// visible effect was a teammate pausing, forgetting, and never saying why.
const store = fs.readFileSync(path.join(ROOT, "electron/store.cjs"), "utf8");
const notes = store.match(/compactedNote\(/g) || [];
assert.ok(notes.length >= 3, "one definition, called from both compaction paths");
assert.ok(
  /function compactedNote\(agent, convId\)/.test(store),
  "the note takes the conversation it happened in, not always the 1:1"
);
// The automatic sentence, exactly once. (`compact()` — the user asking for it
// by hand — keeps its own shorter wording: they already know what they did.)
const summarised = store.match(/still remembers what mattered/g) || [];
assert.equal(summarised.length, 1, "one sentence, in one place — two phrasings read as two events");

console.log("slow-model-test ok");
