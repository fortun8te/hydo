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
  agentsMarkdown,
};
