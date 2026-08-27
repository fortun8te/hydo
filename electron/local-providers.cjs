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

/** Parse the top-level `providers:` map. Values are scalars, two levels deep. */
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
  let current = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.match(/^[ ]*/)[0].length;
    if (indent === 0) break;
    const t = line.trim();
    if (indent === 2 && /:\s*$/.test(t) && !t.startsWith("-")) {
      current = t.replace(/:$/, "");
      out[current] = {};
      continue;
    }
    if (!current || indent < 4) continue;
    const colon = t.indexOf(":");
    if (colon <= 0) continue;
    const key = t.slice(0, colon).trim();
    let val = t.slice(colon + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[current][key] = val;
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
    });
  }
  return out;
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
    return { state: "ok", detail: `Answering at ${provider.host}.` };
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

module.exports = { CONFIG, parseProviders, list, keyFor, probe, probeUrl, isPlaceholder, hostOf, status };
