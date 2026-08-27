"use strict";

/**
 * Hydo's side of Hermes context management.
 *
 * Hermes already compact *inside* a turn (ContextCompressor / context engine:
 * token threshold ~50–75% of the model window, idle compact, tail keep).
 * Hydo must not reimplement that. We:
 *   1. Let auto-compact run (status.update already hits the working row).
 *   2. Call session.compress BETWEEN turns when Hermes reports ≥70% full
 *      (history-only shrink — system+tools stay).
 *   3. Keep AGENTS.md small: workspace rules + soul, not a growing memory dump
 *      (the memory tool + SHARED.md own facts).
 *   4. After compress, refresh the durable session id (compress can fork).
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function contextPercent(usage, breakdown) {
  const a = usage && typeof usage === "object" ? num(usage.context_percent) : 0;
  const b = breakdown && typeof breakdown === "object" ? num(breakdown.context_percent) : 0;
  return Math.max(a, b);
}

function shouldCompact(percent, threshold = 70) {
  const p = num(percent);
  const t = num(threshold);
  return p >= t && t > 0;
}

function applyUsageToAgent(agent, usage) {
  if (!agent || !usage || typeof usage !== "object") return agent;
  if (typeof usage.context_percent === "number") agent.contextPercent = usage.context_percent;
  if (usage.context_used != null) agent.contextUsed = usage.context_used;
  if (usage.context_max != null) agent.contextMax = usage.context_max;
  if (usage.compressions != null) agent.compressions = usage.compressions;
  return agent;
}

// ── Tokens per second on your own hardware ───────────────────────────────
//
// Hermes' `session.usage` counters are CUMULATIVE for the session
// ({calls,input,output,total,…}), and the `usage` payload that rides on
// `message.complete` is the same shape. Nothing on the wire reports a single
// turn's output token count, so the only honest per-turn number is the DELTA
// between two consecutive completions, divided by the wall time of the second
// one. Measured against the user's own endpoint, a turn of 280 completion
// tokens took 20.45s (13.7 tok/s) and one of 67 took 5.69s (11.8 tok/s), so
// this is a low-double-digit figure, not a headline number.
const OUTPUT_KEYS = ["output", "output_tokens", "completion_tokens"];

/** Cumulative output tokens out of a usage payload, or null if it has none. */
function outputTokensOf(usage) {
  if (!usage || typeof usage !== "object") return null;
  for (const k of OUTPUT_KEYS) {
    const n = Number(usage[k]);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

// Floors, because the alternative is a confident lie. Below ~1.5s the elapsed
// time is mostly connect + prefill + first-token latency, and a two-token
// acknowledgement returned in 40ms would compute as "50 tok/s" for a box that
// measurably does 12-14. Under either floor this returns null and the UI shows
// nothing rather than a number.
const MIN_MS = 1500;
const MIN_TOKENS = 24;

/**
 * One turn's generation rate, or null when it cannot be measured honestly.
 * @param {number|null} prevOutput cumulative output at the previous completion
 * @param {Object|null} usage      this completion's usage payload
 * @param {number} elapsedMs       wall time of this turn
 * @returns {{rate:number, tokens:number, seconds:number}|null}
 */
function measureRate(prevOutput, usage, elapsedMs) {
  const now = outputTokensOf(usage);
  const prev = Number(prevOutput);
  if (now == null || !Number.isFinite(prev)) return null;
  const tokens = now - prev;
  const ms = Number(elapsedMs);
  if (!Number.isFinite(ms) || ms < MIN_MS) return null;
  if (!(tokens >= MIN_TOKENS)) return null;
  const seconds = ms / 1000;
  return { rate: tokens / seconds, tokens, seconds };
}

function agentsMarkdown(stamp, soul) {
  const s = String(stamp || "").trim();
  const v = String(soul || "").trim();
  if (s && v) return `${s}\n\n${v}\n`;
  return `${s || v}\n`;
}

module.exports = {
  contextPercent,
  shouldCompact,
  applyUsageToAgent,
  outputTokensOf,
  measureRate,
  agentsMarkdown,
};
