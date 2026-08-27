"use strict";

/**
 * What a turn does when the local endpoint is not there.
 *
 * MEASURED, before any of this existed, against the real dead port in the
 * user's own ~/.hermes/config.yaml (`lmstudio` → http://localhost:1234/v1,
 * nothing listening): a real `store.send()` sat for 28.1s and then posted one
 * bot bubble reading "API call failed after 3 retries: Connection error." No
 * endpoint named, no answer, and nothing to do but retype the message on a
 * different provider by hand. The desk PC that serves these endpoints slept
 * twice in one session — this is a recurring failure, not a corner case.
 *
 * The fix is a FALLBACK, not a queue. The user's own words: "for now we're
 * mainly just gonna be using grok anyways". A queued message is a message that
 * sits invisible for however long the PC stays asleep, which is its own way of
 * losing it; answering now on the model they use every day is the smaller,
 * truer thing. Two hard rules come with it:
 *
 *   1. The user's message is already in the transcript before this module is
 *      ever consulted (store.send pushes it first). Nothing here can lose it.
 *   2. A substitution is NEVER silent. Every non-local outcome carries a
 *      one-sentence `note` the caller must post into the transcript. A model
 *      swapped without saying so is a lie, and this codebase treats it as one
 *      (scripts/silent-failure-test.cjs, scripts/dead-control-test.cjs).
 *
 * Reachability is local-providers.cjs's `probe` and nothing else — it already
 * tells five honest states apart, and a second reachability check would be a
 * second opinion to keep in sync.
 *
 * There is NO polling loop here. A probe happens only when a turn is being
 * submitted, i.e. on a real signal from the user. The cache below exists to
 * stop a burst of turns re-probing a port that just answered, not to poll.
 */

const localProviders = require("./local-providers.cjs");
const grokOauth = require("./grok-oauth.cjs");
const modelPick = require("./model-pick.cjs");

// A good answer is worth reusing for a moment; a bad one is NOT cached long,
// because the interesting event is the PC waking up and the next turn should
// see that within seconds rather than being told the stale bad news.
const OK_TTL_MS = 30_000;
const BAD_TTL_MS = 4_000;

// providerId → { at, state, detail, host }
const cache = new Map();

function clearCache() {
  cache.clear();
}

/** The five states that mean "this turn cannot run here". */
function isDown(state) {
  return state === "offline" || state === "empty" || state === "unauthorized" || state === "unconfigured" || state === "http";
}

function why(state, host, detail) {
  const at = host ? ` (${host})` : "";
  if (state === "empty") return `your local endpoint${at} is up but has no model loaded`;
  if (state === "unauthorized") return `your local endpoint${at} rejected its key`;
  if (state === "unconfigured") return `your local endpoint${at} still has the placeholder address`;
  if (state === "http") return `your local endpoint${at} answered with something that is not a model listing`;
  return detail && /firewall/i.test(detail)
    ? `your local endpoint${at} did not answer`
    : `your local endpoint${at} is not answering`;
}

/**
 * Is there a hosted model to fall back TO?
 *
 * Hermes chat on Grok needs `providers.xai-oauth` in ~/.hermes/auth.json.
 * Without it, "falling back" would just be a second, differently-worded
 * failure 28 seconds later — so the caller is told to run nothing and say so.
 */
function hostedReady() {
  // Test seam, and only that: scripts/local-fallback-test.cjs has to drive BOTH
  // branches — hosted available and not — without writing the user's real
  // ~/.grok or ~/.hermes. The app never sets this.
  const forced = process.env.HYDO_HOSTED_AUTH;
  if (forced === "0") return false;
  if (forced === "1") return true;
  try {
    // Read-only on purpose: this runs on a turn, and the setup path
    // (`ensureHermesXaiOauth`) WRITES ~/.hermes/auth.json.
    return grokOauth.hostedAuthReady();
  } catch {
    return false;
  }
}

/**
 * Decide where this turn runs.
 *
 * @returns {Promise<{run:'local'}|{run:'hosted',provider:string,model:string,note:string,state:string}|{run:'none',note:string,state:string}>}
 */
async function check(providerId, opts = {}) {
  const id = String(providerId || "").trim();
  if (!id) return { run: "local" };
  const file = opts.file || process.env.HYDO_HERMES_CONFIG || localProviders.CONFIG;
  const list = opts.list || localProviders.list;
  const probe = opts.probe || localProviders.probe;
  const keyFor = opts.keyFor || localProviders.keyFor;
  const ready = opts.hostedReady || hostedReady;
  const now = opts.now || Date.now;

  const rec = list(file).find((p) => String(p.id).toLowerCase() === id.toLowerCase());
  // Not one of the user's own boxes — a hosted provider is not this module's
  // business, and pretending to know its health would be the confident lie
  // local-providers.cjs exists to avoid.
  if (!rec || !localProviders.isLocalHost(rec.host)) return { run: "local" };

  const hit = cache.get(rec.id);
  let state;
  let detail = "";
  if (hit && now() - hit.at < (isDown(hit.state) ? BAD_TTL_MS : OK_TTL_MS)) {
    state = hit.state;
    detail = hit.detail;
  } else {
    const res = await probe(rec, { key: keyFor(rec.id, file), timeout: opts.timeout });
    state = (res && res.state) || "unknown";
    detail = (res && res.detail) || "";
    cache.set(rec.id, { at: now(), state, detail, host: rec.host });
  }

  // `unknown` is not "down". It means the probe itself could not form an
  // opinion, and rerouting on it would move turns off a working box.
  if (!isDown(state)) return { run: "local" };

  const reason = why(state, rec.host, detail);
  if (!ready()) {
    return {
      run: "none",
      state,
      note: `Didn't run this: ${reason}, and there's no hosted model signed in to fall back to. Your message is saved — send it again once the endpoint is back, or sign in to Grok in Settings.`,
    };
  }
  const model = opts.hostedModel || modelPick.DEFAULT_CHAT;
  return {
    run: "hosted",
    state,
    provider: modelPick.DEFAULT_PROVIDER,
    model,
    note: `Answered on ${model} instead of ${rec.name || rec.id}: ${reason}.`,
  };
}

/**
 * The same decision for a turn that ALREADY failed on a local provider.
 *
 * The preflight above can be right and the turn still die: the PC can sleep
 * mid-stream, which is exactly what happened twice in one session. One retry,
 * on the hosted model, with the same honest sentence. Bounded to one — a retry
 * loop against a machine that is off is the polling loop this must not be.
 */
function afterFailure(providerId, err, opts = {}) {
  const id = String(providerId || "").trim();
  if (!id) return null;
  const file = opts.file || process.env.HYDO_HERMES_CONFIG || localProviders.CONFIG;
  const list = opts.list || localProviders.list;
  const ready = opts.hostedReady || hostedReady;
  const rec = list(file).find((p) => String(p.id).toLowerCase() === id.toLowerCase());
  if (!rec || !localProviders.isLocalHost(rec.host)) return null;
  // A failed local turn is evidence the cached "ok" is stale. Drop it so the
  // NEXT turn probes for real instead of trusting a 30s-old success.
  cache.delete(rec.id);
  if (!ready()) return null;
  const model = opts.hostedModel || modelPick.DEFAULT_CHAT;
  const cause = String((err && err.message) || err || "").trim().slice(0, 160);
  return {
    provider: modelPick.DEFAULT_PROVIDER,
    model,
    note: `Retried on ${model}: the turn on ${rec.name || rec.id} (${rec.host}) failed${cause ? ` — ${cause}` : ""}.`,
  };
}

module.exports = { check, afterFailure, hostedReady, isDown, clearCache, OK_TTL_MS, BAD_TTL_MS };
