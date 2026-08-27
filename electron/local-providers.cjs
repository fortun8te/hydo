"use strict";

/**
 * The `providers:` block of ~/.hermes/config.yaml — the endpoints that run on
 * hardware the user owns (an Unsloth server on their PC, Ollama, LM Studio),
 * as opposed to the ~40 hosted providers Hermes' `model.options` returns.
 *
 * Two jobs, and only these two:
 *   1. Say WHICH providers are self-hosted, so Settings can show them apart
 *      from a flat forty-item list nobody can switch inside of.
 *   2. Say whether one is actually ANSWERING right now. A local server that
 *      is off, bound to loopback, or firewalled looks exactly like a broken
 *      model once a turn fails — see docs/LOCAL-MODEL.md.
 *
 * The api_key never leaves this module: it is read here, sent as a bearer on
 * the probe, and dropped. `list()` returns no key, and nothing here logs one.
 *
 * Node stdlib only. Total: missing/unreadable/malformed → empty, never throw.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CONFIG = path.join(os.homedir(), ".hermes", "config.yaml");

// The literal the shipped config carries until the user fills in their PC's
// LAN address. Reporting it as a network failure would send someone to debug
// a firewall when the address is not an address yet.
const PLACEHOLDER = /REPLACE-WITH|YOUR-PC|<[^>]+>|x\.x\.x\.x/i;

const PROBE_TIMEOUT_MS = 2500;

/**
 * Parse the top-level `providers:` map.
 *
 * Nested maps are kept, not flattened. That matters for exactly one key:
 * `extra_body.chat_template_kwargs.enable_thinking`, which is the ONLY lever
 * that turns a Qwen3-class server's hidden scratchpad off (docs/LOCAL-MODEL.md)
 * — a flat parser reported such an entry as `{extra_body: ""}` and the fast
 * lane below could never see it.
 *
 * Scalars are strings except `true`/`false`, which come back as booleans so a
 * caller can compare against `false` rather than the string "false".
 */
function parseProviders(text) {
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "providers:" && /^providers:/.test(lines[i])) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return {};
  const out = {};
  // Stack of open maps, innermost last, each with the indent its KEYS sit at.
  let stack = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.match(/^[ ]*/)[0].length;
    if (indent === 0) break;
    const t = line.trim();
    if (t.startsWith("-")) continue; // sequences are not part of this shape
    const colon = t.indexOf(":");
    if (colon <= 0) continue;
    const key = t.slice(0, colon).trim();
    let val = t.slice(colon + 1).trim();
    if (indent === 2) {
      stack = [{ indent: 4, node: (out[key] = {}) }];
      continue;
    }
    while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
    if (!stack.length) continue;
    const node = stack[stack.length - 1].node;
    if (!val) {
      // `key:` with nothing after it opens a nested map.
      const child = {};
      node[key] = child;
      stack.push({ indent: indent + 2, node: child });
      continue;
    }
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      node[key] = val.slice(1, -1);
      continue;
    }
    if (val === "true" || val === "false") {
      node[key] = val === "true";
      continue;
    }
    node[key] = val;
  }
  return out;
}

function hostOf(api) {
  const s = String(api || "");
  const m = s.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  return m ? m[1] : "";
}

/** True when the endpoint is a template, not an address. */
function isPlaceholder(api) {
  const s = String(api || "").trim();
  if (!s) return true;
  return PLACEHOLDER.test(s);
}

/** `${api}/models` — the OpenAI-compatible listing every one of these serves. */
function probeUrl(api) {
  return String(api || "").replace(/\/+$/, "") + "/models";
}

/**
 * Read the providers block. The returned records carry NO api_key — callers
 * are the renderer, and a key in renderer state is a key in a devtools heap
 * snapshot. `hasKey` is all the UI ever needs to know.
 */
function list(file = CONFIG) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const parsed = parseProviders(text);
  const out = [];
  for (const [id, cfg] of Object.entries(parsed)) {
    const api = String(cfg.api || cfg.base_url || "").trim();
    if (!api) continue;
    out.push({
      id,
      name: String(cfg.name || id).trim() || id,
      api,
      host: hostOf(api),
      model: String(cfg.default_model || "").trim(),
      transport: String(cfg.transport || "").trim(),
      hasKey: Boolean(String(cfg.api_key || "").trim()),
      placeholder: isPlaceholder(api),
      // Whether this entry hands the server `enable_thinking: false`. See
      // `fastLaneFor` — it is what makes an entry the fast twin of another.
      thinkingOff: thinkingOff(cfg),
    });
  }
  return out;
}

/**
 * Does this entry tell the server to skip the hidden scratchpad?
 *
 * `chat_template_kwargs.enable_thinking` is applied by the SERVER when it
 * renders the chat template, so it is the one thinking control that exists for
 * a plain OpenAI-compatible box. Measured on the user's endpoint
 * (docs/LOCAL-MODEL.md): with it false, `reasoning_content` came back empty and
 * the same prompt finished in 3.82s instead of 13.42s.
 */
function thinkingOff(cfg) {
  const eb = cfg && cfg.extra_body;
  const kw = eb && eb.chat_template_kwargs;
  return !!kw && kw.enable_thinking === false;
}

/** api urls compare without a trailing slash, the way Hermes normalizes them. */
function sameApi(a, b) {
  const norm = (x) => String(x || "").trim().replace(/\/+$/, "").toLowerCase();
  const s = norm(a);
  return !!s && s === norm(b);
}

/**
 * The no-thinking twin of a provider: the entry a trivially easy turn may run
 * on, or "" when the config has no safe one.
 *
 * MEASURED, against the user's own Hermes and a stub OpenAI server on
 * 127.0.0.1:8899 that logged every request body. Two `providers:` entries, one
 * carrying `extra_body.chat_template_kwargs.enable_thinking: false`:
 *
 *   same `api` string on both entries
 *     custom:box -> enable_thinking False   <-- the CAREFUL lane, silently fast
 *     custom:boxfast -> enable_thinking False
 *   and with an explicit `true` on the careful entry, both went True instead:
 *   whichever entry comes FIRST in the file wins for every name on that url.
 *
 *   different `api` strings (`http://127.0.0.1:8899/v1` vs
 *   `http://localhost:8899/v1` — one server, two spellings)
 *     custom:box     -> no chat_template_kwargs at all
 *     custom:boxfast -> enable_thinking False
 *
 * The reason is in Hermes: runtime resolution rewrites `custom:<name>` to a
 * plain `custom` (`runtime_provider.py` `_resolve_named_custom_runtime`), and
 * `agent_init.py:429` then matches a provider's extra_body **by base_url
 * alone** when the provider is bare `custom`. Two entries on one url are
 * indistinguishable by the time the merge happens.
 *
 * So the twin must have a DIFFERENT api string. That is not a limitation to
 * work around, it is the only shape in which the lane is real: on the same
 * string, routing a greeting to the fast entry would have turned thinking off
 * for every turn the teammate ever takes, which is the bat-and-ball answer
 * being wrong (0.10 instead of 0.05) on work the user cares about. One server
 * reached two ways — `100.74.135.83` and the same PC's LAN address, or
 * `127.0.0.1` and `localhost` — satisfies it; see docs/LOCAL-MODEL.md.
 *
 * A twin also has to be local, non-placeholder, and either name no model or
 * name the one this turn runs (`_custom_provider_model_matches` drops the
 * extra_body of an entry whose model disagrees, which would look like a fast
 * lane and be a plain slow turn).
 *
 * Returns "" for anything hosted, anything missing, and every config that does
 * not have such a twin — i.e. all of them until the user adds one. That is the
 * opt-in; deleting the entry is the opt-out.
 */
function fastLaneFor(id, model, file = CONFIG) {
  const want = String(id || "").trim().toLowerCase();
  if (!want) return "";
  let parsed;
  try {
    parsed = parseProviders(fs.readFileSync(file, "utf8"));
  } catch {
    return "";
  }
  const entries = Object.entries(parsed);
  const self = entries.find(([key]) => String(key).toLowerCase() === want);
  if (!self) return "";
  const [, selfCfg] = self;
  const api = String(selfCfg.api || selfCfg.base_url || "").trim();
  // Only ever on the user's own hardware. A hosted provider must be untouched:
  // the whole trade below is priced in local tokens per second.
  if (!api || isPlaceholder(api) || !isLocalHost(hostOf(api))) return "";
  // An entry that already has thinking off is not the careful lane, and giving
  // it a "faster" twin would be a lie.
  if (thinkingOff(selfCfg)) return "";
  const selfModel = String(model || selfCfg.default_model || "").trim().toLowerCase();
  for (const [key, cfg] of entries) {
    if (String(key).toLowerCase() === want) continue;
    if (!thinkingOff(cfg)) continue;
    const twinApi = String(cfg.api || cfg.base_url || "").trim();
    if (!twinApi || isPlaceholder(twinApi) || !isLocalHost(hostOf(twinApi))) continue;
    // The measured rule. Same string, no lane — see above.
    if (sameApi(twinApi, api)) continue;
    const twinModel = String(cfg.default_model || "").trim().toLowerCase();
    if (twinModel && selfModel && twinModel !== selfModel) continue;
    return `custom:${String(key).trim().toLowerCase().replace(/ /g, "-")}`;
  }
  return "";
}

/**
 * Is this host a machine the user owns?
 *
 * Deliberately the SAME set Hermes uses (`agent/model_metadata.py`
 * `is_local_endpoint`): loopback, container DNS names, unqualified hostnames,
 * RFC-1918, link-local, and Tailscale CGNAT 100.64/10. Tailscale is in there
 * because that is how the PC next to you is actually reached — the endpoint in
 * docs/LOCAL-MODEL.md is `100.74.135.83`, which is not private by RFC-1918 and
 * would read as a public cloud host to a naive check.
 *
 * Matching Hermes matters more than being right in the abstract: Hermes raises
 * its own stream read timeout to 1800s and its stale-stream detector to 900s
 * for exactly these hosts. If Hydo drew the line somewhere else, Hydo's turn
 * ceiling would fire on a stream Hermes was still happily waiting for.
 */
function isLocalHost(host) {
  const h = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "").split(":")[0];
  if (!h) return false;
  if (h === "localhost" || h === "::1" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (!h.includes(".")) return true; // docker-compose service name, /etc/hosts entry
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // Tailscale CGNAT
  return false;
}

/**
 * How a turn on this provider behaves, for callers that have to choose a
 * deadline or decide whether a knob is real.
 *
 * `reasoningHonoured` is the one that surprises people. Hermes only puts
 * `reasoning_effort` (or `extra_body.reasoning`) on the wire when
 * `AIAgent._supports_reasoning_extra_body()` says yes, and for the
 * `chat_completions` transport that method returns True for exactly four
 * things: nousresearch.com, ai-gateway.vercel.sh, GitHub Models/Copilot,
 * provider id `lmstudio`, ollama.com, and OpenRouter URLs. Everything else —
 * an Unsloth server, llama.cpp, vLLM, any plain OpenAI-compatible box — falls
 * through `if not self._is_openrouter_url(): return False`.
 *
 * So on your own Unsloth endpoint the effort field is not "weakly honoured",
 * it is never sent. Read from `~/.hermes/hermes-agent/run_agent.py:7629` and
 * `agent/transports/chat_completions.py:664`, not guessed.
 */
function paceOf(provider) {
  const id = String((provider && provider.id) || "").trim().toLowerCase();
  const host = String((provider && provider.host) || "").trim().toLowerCase();
  const local = isLocalHost(host);
  const reasoningHonoured = id === "lmstudio" || host.endsWith("ollama.com");
  return { local, reasoningHonoured };
}

/** paceOf() for a provider NAME, as a session carries it. Unknown → hosted. */
function paceFor(id, file = CONFIG) {
  const want = String(id || "").trim().toLowerCase();
  if (!want) return { local: false, reasoningHonoured: true };
  const found = list(file).find((p) => String(p.id).toLowerCase() === want);
  if (!found) return { local: false, reasoningHonoured: true };
  return paceOf(found);
}

/** The api_key for one provider. Main process only; never returned over IPC. */
function keyFor(id, file = CONFIG) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
  const cfg = parseProviders(text)[id];
  return cfg ? String(cfg.api_key || "").trim() : "";
}

/**
 * Ask the endpoint whether it is there. Distinguishes the four failures that
 * mean different things to the person fixing them:
 *   unconfigured — the address is still the template (docs/LOCAL-MODEL.md)
 *   offline      — nothing answered (server down, loopback bind, firewall)
 *   unauthorized — it answered and rejected the key
 *   http         — it answered with something that is not a model listing
 * `detail` is safe to render: host and status only, never the key.
 */
async function probe(provider, opts = {}) {
  const doFetch = opts.fetch || globalThis.fetch;
  if (!provider || !provider.api) return { state: "unknown", detail: "No endpoint configured." };
  if (provider.placeholder) {
    return {
      state: "unconfigured",
      detail: "Address is still the placeholder — see docs/LOCAL-MODEL.md.",
    };
  }
  if (typeof doFetch !== "function") return { state: "unknown", detail: "No network client." };
  const url = probeUrl(provider.api);
  const key = opts.key || "";
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeout || PROBE_TIMEOUT_MS) : null;
  try {
    const res = await doFetch(url, {
      method: "GET",
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: ctl ? ctl.signal : undefined,
    });
    if (res.status === 401 || res.status === 403) {
      // "Rejected the key" is only true if a key was SENT.
      //
      // The key arrives via opts, and a caller that forgets it gets a 401 —
      // which this used to report as the server rejecting a key it never
      // received. That is a confident lie about someone else's server, and it
      // sent a real debugging session chasing an endpoint that was fine.
      if (!key) {
        return {
          state: "unknown",
          detail: `${provider.host} needs a key and none was sent — call status(), or pass opts.key.`,
        };
      }
      return { state: "unauthorized", detail: `${provider.host} answered but rejected the key.` };
    }
    if (!res.ok) return { state: "http", detail: `${provider.host} answered ${res.status}.` };
    // Answering is not the same as being able to serve.
    //
    // Ollama on this Mac returns 200 with `{"object":"list","data":null}` when
    // no model is pulled. "Reachable" is true and useless: you flip to it and
    // the first turn fails, which looks like a broken app rather than an empty
    // server. A model listing with nothing in it is its own state, and its own
    // fix — load a model, not debug a firewall.
    let names = [];
    try {
      const body = await res.json();
      const rows = Array.isArray(body) ? body : (body && body.data) || [];
      names = rows.map((m) => (m && (m.id || m.name)) || "").filter(Boolean);
    } catch {
      // A 200 we cannot parse is still a live server; say the true, smaller
      // thing rather than inventing a diagnosis.
      return { state: "ok", detail: `Answering at ${provider.host}.` };
    }
    if (!names.length) {
      return {
        state: "empty",
        detail: `${provider.host} is up but has no model loaded.`,
        models: [],
      };
    }
    return { state: "ok", detail: `Answering at ${provider.host}.`, models: names };
  } catch (err) {
    // The message can carry the request URL but never a header, so no key can
    // reach it. Still: only the host and a plain cause are surfaced.
    const aborted = err && (err.name === "AbortError" || /abort/i.test(String(err.message || "")));
    return {
      state: "offline",
      detail: aborted
        ? `No answer from ${provider.host} — server off, or the firewall is dropping it.`
        : `Could not reach ${provider.host} — server off, or bound to loopback.`,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * What this endpoint can actually serve.
 *
 * Settings only ever offered the ONE model named as `default_model` in
 * config.yaml, because that is all Hermes' `model.options` reports for a custom
 * provider. But a local server holds a shelf: this user's box answers with
 * seven — a 27B alongside the flash one, a couple of gemmas, and UI-TARS, which
 * is a GUI-vision model and a far better choice for driving the shared desktop.
 * Picking between them meant hand-editing YAML.
 *
 * `loaded` matters and is carried through. An unloaded model is a real choice,
 * but it is one that pays a load before the first token, and a picker that hides
 * that difference makes the slow one look broken.
 *
 * Entries whose id is a raw shard filename are dropped: `…-00001-of-00003` is
 * the weights on disk, not something to select.
 */
async function models(provider, opts = {}) {
  const doFetch = opts.fetch || globalThis.fetch;
  if (!provider || !provider.api) return { ok: false, reason: "no endpoint" };
  if (provider.placeholder) return { ok: false, reason: "placeholder" };
  if (typeof doFetch !== "function") return { ok: false, reason: "no network client" };
  const key = opts.key || "";
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), opts.timeout || PROBE_TIMEOUT_MS) : null;
  try {
    const res = await doFetch(probeUrl(provider.api), {
      method: "GET",
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: ctl ? ctl.signal : undefined,
    });
    if (!res.ok) return { ok: false, reason: `answered ${res.status}` };
    const body = await res.json();
    const rows = Array.isArray(body && body.data) ? body.data : [];
    const out = [];
    for (const m of rows) {
      const id = String((m && m.id) || "").trim();
      if (!id) continue;
      if (/-\d{5}-of-\d{5}$/.test(id)) continue;
      out.push({ id, loaded: m.loaded !== false, context: m.context_length || null });
    }
    // Loaded first — the ones that answer without paying a load.
    out.sort((a, b) => Number(b.loaded) - Number(a.loaded) || a.id.localeCompare(b.id));
    return { ok: true, models: out };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** list() + a probe for each, in parallel. */
async function status(file = CONFIG, opts = {}) {
  const providers = list(file);
  const probed = await Promise.all(
    providers.map(async (p) => ({
      ...p,
      status: await probe(p, { ...opts, key: opts.key != null ? opts.key : keyFor(p.id, file) }),
    }))
  );
  return probed;
}

module.exports = { CONFIG, parseProviders, thinkingOff, fastLaneFor, list, keyFor, probe, probeUrl, isPlaceholder, hostOf, status, isLocalHost, paceOf, paceFor, models };
