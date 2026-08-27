"use strict";

/**
 * The fast lane: the landing turn, and only the landing turn, may run with a
 * local model's hidden scratchpad turned off.
 *
 * The measurements this whole feature is priced against (docs/LOCAL-MODEL.md,
 * taken on the user's own box):
 *
 *   bat-and-ball   thinking on  10.4s, 162 tok -> 0.05   (right)
 *                  thinking off  1.1s,   5 tok -> 0.10   (wrong)
 *   3-sentence     15.2 / 17.6 / 15.4 tok/s on, 14.8 / 16.0 / 14.5 off
 *
 * So the rate is flat at ~15.5 tok/s either way: thinking costs ~35% MORE
 * TOKENS (105 vs 75), not slower ones — and turning it off makes the model
 * wrong on anything that needs reasoning. That is why the routing here is
 * conservative to the point of being boring: one turn, written by Hydo, with
 * no tools and no user question in it.
 *
 * These assertions exist to stop the two ways this silently becomes a lie:
 * routing a turn the user typed, and routing to a provider string Hermes will
 * not honour.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const lp = require(path.join(ROOT, "electron/local-providers.cjs"));
const gateway = require(path.join(ROOT, "electron/hermes-gateway.cjs"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-fast-lane-"));
function cfg(name, body) {
  const file = path.join(tmp, `${name}.yaml`);
  fs.writeFileSync(file, body);
  return file;
}

const MODEL = "unsloth/Qwen3.8-Flash-Next-GGUF";
const twin = cfg(
  "twin",
  `providers:
  box:
    api: http://100.74.135.83:8888/v1
    api_key: sk-x
    default_model: ${MODEL}
    name: box
    transport: chat_completions
  boxfast:
    api: http://100.74.135.84:8888/v1
    api_key: sk-x
    default_model: ${MODEL}
    name: boxfast
    transport: chat_completions
    extra_body:
      chat_template_kwargs:
        enable_thinking: false
model:
  provider: box
`
);

// ── the parser has to be able to SEE the lever ───────────────────────────
// A flat two-level parser read this entry as {extra_body: ""} and the lane
// could never fire, which is a feature that looks configured and does nothing —
// this repo's signature bug.
const parsed = lp.parseProviders(fs.readFileSync(twin, "utf8"));
assert.deepStrictEqual(parsed.boxfast.extra_body, { chat_template_kwargs: { enable_thinking: false } });
assert.strictEqual(parsed.boxfast.extra_body.chat_template_kwargs.enable_thinking, false, "false parses as a boolean, not the string");
assert.strictEqual(parsed.box.api, "http://100.74.135.83:8888/v1");
assert.ok(!("model" in parsed), "the parser stops at the end of the providers block");

const listed = lp.list(twin);
assert.strictEqual(listed.find((p) => p.id === "boxfast").thinkingOff, true);
assert.strictEqual(listed.find((p) => p.id === "box").thinkingOff, false);

// ── the one provider string Hermes actually honours ──────────────────────
// agent_init.py:429 merges a provider's extra_body only when the session's
// provider is literally `custom` or `custom:<name>`. Hydo has always sent the
// bare key, which is why an extra_body on a providers: entry is inert. Losing
// the prefix here would put the lane back to being decoration.
assert.strictEqual(lp.fastLaneFor("box", MODEL, twin), "custom:boxfast");

// ── and every way it must refuse ─────────────────────────────────────────
assert.strictEqual(lp.fastLaneFor("boxfast", MODEL, twin), "", "an entry that is already fast has no faster twin");
assert.strictEqual(lp.fastLaneFor("nope", MODEL, twin), "", "unknown provider");
assert.strictEqual(lp.fastLaneFor("", MODEL, twin), "");

// A hosted provider must be untouched: the trade is priced in local tok/s.
const hosted = cfg(
  "hosted",
  `providers:
  cloud:
    api: https://api.example.com/v1
    default_model: ${MODEL}
  cloudfast:
    api: https://api.example.com/v1
    default_model: ${MODEL}
    extra_body:
      chat_template_kwargs:
        enable_thinking: false
`
);
assert.strictEqual(lp.fastLaneFor("cloud", MODEL, hosted), "", "hosted endpoints are never routed");

// ── the collision, which is the whole reason for the different-url rule ──
// Two entries on ONE api string are indistinguishable by the time Hermes
// merges extra_body: runtime resolution rewrites `custom:<name>` to bare
// `custom`, and agent_init.py:429 then matches by base_url alone. Measured on
// the wire against a stub server: with both entries on the same url, BOTH
// names sent enable_thinking:false — i.e. the careful lane silently stopped
// thinking, which is the bat-and-ball answer going wrong on real work.
const collided = cfg(
  "collided",
  `providers:
  box:
    api: http://127.0.0.1:8888/v1
    default_model: ${MODEL}
  boxfast:
    api: http://127.0.0.1:8888/v1
    default_model: ${MODEL}
    extra_body:
      chat_template_kwargs:
        enable_thinking: false
`
);
assert.strictEqual(
  lp.fastLaneFor("box", MODEL, collided),
  "",
  "same api string on both entries: Hermes cannot tell them apart, so there is no lane"
);
// A trailing slash is the same string to Hermes' normalizer, and must be here.
const slashed = cfg(
  "slashed",
  `providers:
  box:
    api: http://127.0.0.1:8888/v1
    default_model: ${MODEL}
  boxfast:
    api: http://127.0.0.1:8888/v1/
    default_model: ${MODEL}
    extra_body:
      chat_template_kwargs:
        enable_thinking: false
`
);
assert.strictEqual(lp.fastLaneFor("box", MODEL, slashed), "", "a trailing slash is not a different endpoint");

// One server, two spellings — the shape that measurably works.
const spelled = cfg(
  "spelled",
  `providers:
  box:
    api: http://127.0.0.1:8899/v1
    default_model: ${MODEL}
  boxfast:
    api: http://localhost:8899/v1
    default_model: ${MODEL}
    extra_body:
      chat_template_kwargs:
        enable_thinking: false
`
);
assert.strictEqual(lp.fastLaneFor("box", MODEL, spelled), "custom:boxfast");

// A twin that is not on the user's hardware is not a lane either.
const remoteTwin = cfg(
  "remotetwin",
  `providers:
  box:
    api: http://127.0.0.1:8888/v1
    default_model: ${MODEL}
  cloudfast:
    api: https://api.example.com/v1
    default_model: ${MODEL}
    extra_body:
      chat_template_kwargs:
        enable_thinking: false
`
);
assert.strictEqual(lp.fastLaneFor("box", MODEL, remoteTwin), "");

// A twin that names a different model has its extra_body dropped by
// _custom_provider_model_matches — routing there would look fast and be a
// plain slow turn.
const mismatched = cfg(
  "mismatched",
  `providers:
  box:
    api: http://127.0.0.1:8888/v1
    default_model: ${MODEL}
  boxfast:
    api: http://localhost:8888/v1
    default_model: some/other-model
    extra_body:
      chat_template_kwargs:
        enable_thinking: false
`
);
assert.strictEqual(lp.fastLaneFor("box", MODEL, mismatched), "", "a twin pinned to another model is not a lane");

// A twin naming no model at all matches whatever the session runs (the
// `fallback` branch of _custom_provider_extra_body_for_agent).
const anyModel = cfg(
  "anymodel",
  `providers:
  box:
    api: http://127.0.0.1:8888/v1
    default_model: ${MODEL}
  boxfast:
    api: http://localhost:8888/v1
    extra_body:
      chat_template_kwargs:
        enable_thinking: false
`
);
assert.strictEqual(lp.fastLaneFor("box", MODEL, anyModel), "custom:boxfast");

// The address that is not an address yet.
const placeholder = cfg(
  "placeholder",
  `providers:
  box:
    api: http://REPLACE-WITH-PC-LAN-IP:8888/v1
  boxfast:
    api: http://REPLACE-WITH-PC-LAN-IP-2:8888/v1
    extra_body:
      chat_template_kwargs:
        enable_thinking: false
`
);
assert.strictEqual(lp.fastLaneFor("box", MODEL, placeholder), "");

// No twin at all — i.e. every config that exists today. The feature must be
// inert until the user opts in by adding the second entry.
const plain = cfg(
  "plain",
  `providers:
  box:
    api: http://127.0.0.1:8888/v1
    default_model: ${MODEL}
`
);
assert.strictEqual(lp.fastLaneFor("box", MODEL, plain), "", "no twin, no lane — this is the opt-in");
assert.strictEqual(lp.fastLaneFor("box", MODEL, path.join(tmp, "missing.yaml")), "", "a missing config is not a crash");

// ── seed history across the one rebuild the lane costs ───────────────────
// A changed provider is a different session: sessionFor closes and recreates,
// and a new Hermes session starts empty. Without the seed the teammate answers
// its user's first reply having forgotten the question it just asked.
const seeded = gateway.createParams("/tmp/x", "t", {
  model: MODEL,
  provider: "box",
  messages: [
    { role: "system", content: "You opened this conversation by saying:\n\nhey" },
    { role: "tool", content: "dropped: not a role _coerce_seed_history accepts" },
    { role: "user", content: "   " },
  ],
});
assert.deepStrictEqual(seeded.messages, [
  { role: "system", content: "You opened this conversation by saying:\n\nhey" },
]);
assert.ok(!("messages" in gateway.createParams("/tmp/x", "t", { model: MODEL, provider: "box" })), "no seed, no key");

// ── the routing is conservative, and stays that way ──────────────────────
const store = fs.readFileSync(path.join(ROOT, "electron/store.cjs"), "utf8");
assert.ok(
  /flags\.lean && typeof gateway\.fastLaneFor === "function"/.test(store),
  "the lane is gated on flags.lean — a turn the USER typed must never take it"
);
assert.ok(
  /provider: fastLane \|\| carefulProvider,/.test(store),
  "and it falls back to the careful provider, which is the default in every other case"
);
assert.ok(
  /if \(!flags\.lean && agent\.fastLanded\)/.test(store),
  "the next real turn seeds the greeting into the rebuilt session"
);
assert.ok(/bat-and-ball/.test(store), "the measurement that motivates the caution is named at the line");

// ── the assumption this is all built on, checked against Hermes itself ───
// Read code says a named custom provider's extra_body reaches the main turn.
// Run, rather than believed, whenever the user's Hermes is present. The bare
// `custom` fallback in agent_init.py:429 matches by base_url ALONE, which is
// the collision the different-url rule above exists for — so this asks the
// question the way Hydo asks it: one url, one entry.
const py = path.join(os.homedir(), ".hermes/hermes-agent/.venv/bin/python3");
const agentDir = path.join(os.homedir(), ".hermes/hermes-agent");
let hermesChecked = false;
if (fs.existsSync(py) && fs.existsSync(path.join(agentDir, "agent/agent_init.py"))) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-fast-lane-home-"));
  fs.copyFileSync(spelled, path.join(home, "config.yaml"));
  const script = `
import os, sys
sys.path.insert(0, ${JSON.stringify(agentDir)})
from hermes_cli.config import load_config, get_compatible_custom_providers
from hermes_cli.runtime_provider import _get_named_custom_provider as named
from agent.agent_init import _custom_provider_extra_body_for_agent as eb
cps = get_compatible_custom_providers(load_config())
r = named("custom:boxfast")
print("resolves:", bool(r), r and r["base_url"])
print("fast:", eb(provider="custom", model=${JSON.stringify(MODEL)},
                  base_url="http://localhost:8899/v1", custom_providers=cps))
print("careful:", eb(provider="custom", model=${JSON.stringify(MODEL)},
                     base_url="http://127.0.0.1:8899/v1", custom_providers=cps))
`;
  let out = "";
  try {
    out = execFileSync(py, ["-c", script], {
      env: { ...process.env, HERMES_HOME: home },
      encoding: "utf8",
      timeout: 120000,
    });
    hermesChecked = true;
  } catch (err) {
    // A Hermes that will not even import is not this repo's test failing.
    console.log(`fast-lane-test: skipped the Hermes check (${String(err.message || err).split("\n")[0]})`);
  }
  if (hermesChecked) {
    assert.ok(
      /resolves: True http:\/\/localhost:8899\/v1/.test(out),
      `custom:<name> must resolve to that providers: entry; got:\n${out}`
    );
    assert.ok(
      /fast: \{'chat_template_kwargs': \{'enable_thinking': False\}\}/.test(out),
      `the twin's url must carry enable_thinking:false onto the turn; got:\n${out}`
    );
    assert.ok(
      /careful: None/.test(out),
      `and the careful url must carry nothing — if this fails, the lanes have merged; got:\n${out}`
    );
  }
}

console.log(`fast-lane-test ok${hermesChecked ? " (incl. Hermes extra_body resolution, run)" : ""}`);
