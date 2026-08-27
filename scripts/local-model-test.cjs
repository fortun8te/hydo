"use strict";

// local-model-test.cjs — switching between a hosted model (Grok) and a local
// one (an Unsloth server on the user's own PC) from Settings.
//
// Two bugs this pins:
//   1. The placeholder host shipped in ~/.hermes/config.yaml reported as a
//      network failure. It is not one — nothing was ever dialled. Someone
//      would go debug a Windows firewall over a string that is not an address.
//   2. Picking a self-hosted model out of the flat model list left
//      `provider: xai-oauth` behind it, so the turn went to xAI with a model
//      it has never heard of.
// Plus: the api_key must never leave the main process.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const lp = require("../electron/local-providers.cjs");

// -- 1. parsing the real config shape ------------------------------------
const YAML = `model:
  api_key: sk-should-not-appear
  default: deepseek-v4-pro
providers:
  # a comment inside the block
  unsloth:
    api: http://REPLACE-WITH-PC-LAN-IP:8888/v1
    api_key: sk-unsloth-secret
    default_model: unsloth/Qwen3.8-Flash-Next-GGUF
    name: unsloth
    transport: chat_completions
  ollama:
    api: http://localhost:11434/v1
    api_key: sk-ollama-secret
    default_model: gemma4:12B
    name: ollama
    transport: chat_completions
fallback_providers: []
toolsets:
  - hermes-cli
`;
const tmp = path.join(os.tmpdir(), `hydo-localmodel-${process.pid}.yaml`);
fs.writeFileSync(tmp, YAML);

const list = lp.list(tmp);
assert.equal(list.length, 2, "both providers parsed, and the block stops at fallback_providers");
const [unsloth, ollama] = list;
assert.equal(unsloth.id, "unsloth");
assert.equal(unsloth.host, "REPLACE-WITH-PC-LAN-IP:8888");
assert.equal(unsloth.model, "unsloth/Qwen3.8-Flash-Next-GGUF");
assert.equal(unsloth.placeholder, true, "the shipped host is a template, not an address");
assert.equal(ollama.placeholder, false);
assert.equal(ollama.host, "localhost:11434");

// The key is readable in the main process...
assert.equal(lp.keyFor("unsloth", tmp), "sk-unsloth-secret");
// ...and is absent from everything that crosses IPC.
const serialized = JSON.stringify(list);
assert.ok(!serialized.includes("sk-"), "no api_key may appear in the listed records");
assert.ok(!("api_key" in unsloth), "records carry hasKey, never the key");
assert.equal(unsloth.hasKey, true);

assert.equal(lp.probeUrl("http://host:1/v1"), "http://host:1/v1/models");
assert.equal(lp.probeUrl("http://host:1/v1/"), "http://host:1/v1/models");

// -- 2. probe states -----------------------------------------------------
(async () => {
  // Placeholder: answered without touching the network at all.
  let called = false;
  const never = async () => {
    called = true;
    return { ok: true, status: 200 };
  };
  const ph = await lp.probe(unsloth, { fetch: never, key: "sk-unsloth-secret" });
  assert.equal(ph.state, "unconfigured");
  assert.equal(called, false, "a placeholder host must not be dialled");
  assert.match(ph.detail, /LOCAL-MODEL\.md/);
  assert.ok(!/sk-/.test(ph.detail));

  // Reachable.
  let seen = null;
  const okFetch = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200 };
  };
  const up = await lp.probe(ollama, { fetch: okFetch, key: "sk-ollama-secret" });
  assert.equal(up.state, "ok");
  assert.equal(seen.url, "http://localhost:11434/v1/models");
  assert.equal(seen.init.headers.Authorization, "Bearer sk-ollama-secret");
  assert.ok(!/sk-/.test(up.detail), "the rendered detail never carries the key");

  // Rejected key vs. a dead server vs. an odd reply — three different fixes.
  //
  // "Rejected the key" is only true if a key was SENT. This case used to assert
  // `unauthorized` while passing NO key, which is the exact confusion the
  // product hit: a caller that forgets opts.key gets a 401, and reporting that
  // as the server rejecting a key it never received sent a real debugging
  // session chasing an endpoint that was fine.
  assert.equal(
    (await lp.probe(ollama, { key: "sk-x", fetch: async () => ({ ok: false, status: 401 }) })).state,
    "unauthorized"
  );
  assert.equal(
    (await lp.probe(ollama, { fetch: async () => ({ ok: false, status: 401 }) })).state,
    "unknown",
    "a 401 with no key sent is a CALLER bug, and must not be blamed on the server"
  );
  assert.equal((await lp.probe(ollama, { fetch: async () => ({ ok: false, status: 500 }) })).state, "http");
  const down = await lp.probe(ollama, {
    fetch: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    },
    key: "sk-ollama-secret",
  });
  assert.equal(down.state, "offline");
  assert.match(down.detail, /loopback/);
  assert.ok(!/sk-/.test(down.detail));

  const timedOut = await lp.probe(ollama, {
    fetch: async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    },
  });
  assert.equal(timedOut.state, "offline");
  assert.match(timedOut.detail, /firewall/);

  fs.unlinkSync(tmp);

  // -- 3. the wiring, end to end ----------------------------------------
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  const preload = read("electron/preload.cjs");
  const main = read("electron/main.cjs");
  const settings = read("src/screens/Settings.jsx");
  const css = read("src/screens/settings.css");

  for (const ch of ["hydo:localProviders", "hydo:probeLocalProvider"]) {
    assert.ok(preload.includes(`"${ch}"`), `preload missing ${ch}`);
    assert.ok(main.includes(`ipcMain.handle("${ch}"`), `main missing handler ${ch}`);
  }
  // The key is read on the main side of that boundary, nowhere else.
  assert.ok(main.includes("localProviders.keyFor("), "main must fetch the key itself");
  // Strip comments before checking: the renderer explains WHY it has no key.
  const settingsCode = settings.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/api_key|keyFor|Authorization/.test(settingsCode),
    "no key handling in the renderer"
  );

  // The switch, and the two things that make it honest.
  assert.ok(settings.includes("<LocalSwitch"), "Settings must render the hosted/local switch");
  assert.ok(/probeLocalProvider/.test(settings), "Settings must probe before the user sends a message");
  assert.ok(/STATE_WORD/.test(settings) && /unconfigured: "Not set up"/.test(settings),
    '"Not set up" must not be the same word as "Offline"');
  // Two states answer "you cannot run a turn here", for different reasons, and
  // both must block the switch: a placeholder address was never dialled, and an
  // `empty` server answered 200 with no model loaded (ollama does exactly this
  // when nothing is pulled). Reporting the second as Reachable was true and
  // useless — the flip succeeded and the first turn failed.
  assert.ok(
    /activeStatus\.state === "unconfigured"/.test(settings) &&
      /activeStatus\.state === "empty"/.test(settings),
    "neither a placeholder address nor a server with no model can be switched to"
  );
  assert.ok(/empty: "No model loaded"/.test(settings), '"No model loaded" is its own word');
  // Bug 2: the stale provider.
  assert.ok(
    /const local = localByModel\.get\(v\);\s*\n\s*if \(local\) patch\.provider = local\.id;/.test(settings),
    "picking a local model from the flat list must carry its provider with it"
  );
  // Per-teammate override still comes from the agent first (model-pick.cjs).
  const mp = require("../electron/model-pick.cjs");
  assert.equal(mp.sessionModel({ model: "gemma4:12B" }, { model: "grok-4.6" }), "gemma4:12B");
  assert.equal(mp.sessionProvider({ provider: "ollama" }, { provider: "unsloth", model: "x" }), "ollama");

  // The CSS actually exists for every class the JSX names, and the row's two
  // controls are laid out side by side — `.hy-row__control` is a column.
  for (const cls of ["settings__local-ctl", "settings__health", "settings__dot", "settings__seg", "settings__seg-btn"]) {
    assert.ok(css.includes(`.${cls}`), `settings.css missing .${cls}`);
    assert.ok(settings.includes(cls), `Settings.jsx never uses .${cls}`);
  }
  assert.ok(/\.settings__local-ctl \{[^}]*flex-direction|\.settings__local-ctl \{[^}]*display: flex/.test(css));

  console.log("local-model-test ok");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
