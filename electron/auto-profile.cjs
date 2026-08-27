"use strict";

/**
 * Pick the cheapest tool profile a turn can actually be answered with.
 *
 * The manual Cheap/Work switch was a workaround for a design problem: the
 * right profile is knowable from the message, and asking a person to predict
 * it means every bot sits on whatever it was created with forever. Measured,
 * that default costs ~16.6k of tool schema on every turn, including "yes" and
 * "what time is it".
 *
 * Two rules make this safe enough to be the default:
 *
 * 1. ESCALATE ONLY, never downgrade inside a conversation. Once a bot has
 *    used the shell, the transcript is full of shell output it may need to
 *    reason about, and taking the tool away mid-thread makes it unable to
 *    follow up on its own work. Cheap-then-rich is a small win each turn;
 *    rich-then-cheap is a broken assistant.
 *
 * 2. WHEN UNSURE, ESCALATE. A wrong cheap guess costs a whole wasted turn and
 *    a confused reply, which is more expensive than the schema it saved. A
 *    wrong rich guess only costs tokens. The asymmetry is the whole design.
 *
 * Pure and dependency-free so it can be tested without a store or a gateway.
 */

// Cheapest first. `pickProfile` never returns an index lower than the one the
// bot is already on.
const LADDER = ["chat", "writer", "researcher", "builder"];

function rank(name) {
  const i = LADDER.indexOf(String(name || ""));
  return i < 0 ? LADDER.length - 1 : i;
}

// Anything that is a shell, a repo, a machine, a schedule, another agent, or
// showing you something. All of these need `builder`.
const NEEDS_BUILDER =
  /\b(run|exec|execute|install|npm|yarn|pnpm|pip|uv|brew|git|commit|branch|merge|rebase|deploy|build|compile|test|lint|docker|ssh|curl|chmod|kill|process|port|localhost|server|repo|repository|codebase|terminal|shell|command|script|migrat\w*|rollback|delegate|worker|teammate|parallel|screenshot|browser|click|desktop|chart|graph|plot|dashboard|visuali[sz]\w*|diagram|render|open_preview|artifact)\b/i;

// Reading, writing or naming a file, or anything that lives on disk.
const NEEDS_FILE =
  /\b(file|folder|directory|path|read|open|write|save|edit|rename|move|copy|delete|attach|upload|download|docx|xlsx|pptx|pdf|csv|json|yaml|markdown|\.md|workspace|document|report|invoice|contract|spreadsheet|export)\b|[~./][\w./-]*\/[\w.-]+|\b[\w-]+\.(md|txt|json|csv|ts|tsx|js|jsx|py|go|rs|html|css|ya?ml|toml|docx|xlsx|pptx|pdf|png|jpe?g)\b/i;

// The open web, or anything current.
const NEEDS_WEB =
  /\b(search|google|look ?up|find out|research|news|price|pricing|compare|competitor|latest|current|today'?s|documentation|docs|article|website|url|http|source|cite|who is|what is the)\b|https?:\/\//i;

// Asking for work, as opposed to talking. Imperatives and polite requests.
// Deliberately does NOT include bare questions ("what time is it", "how are
// you") — those are answerable from conversation and are the common case.
const TASK_SHAPE =
  /\b(can you|could you|would you|please|go ahead|sort (?:it|this|that)|deal with|handle|figure out|work out|look (?:at|into|through)|check|fix|make|build|set up|clean up|sort out|take care of|get (?:it|this|that) (?:done|working)|help me)\b/i;

/**
 * @param {string} text        the user's message
 * @param {string} current     the bot's current profile
 * @param {object} [opts]
 * @param {boolean} [opts.hasAttachments]  images/files came with the message
 * @param {boolean} [opts.pinned]          the user chose a profile by hand
 * @returns {string} the profile to run this turn on
 */
function pickProfile(text, current, opts = {}) {
  // A hand-picked profile is a decision, not a default. Never override it.
  if (opts.pinned) return current || "builder";

  const floor = rank(current);
  const s = String(text || "");

  let want = 0; // chat
  if (NEEDS_WEB.test(s)) want = Math.max(want, rank("researcher"));
  if (NEEDS_FILE.test(s) || opts.hasAttachments) want = Math.max(want, rank("writer"));
  if (NEEDS_BUILDER.test(s)) want = Math.max(want, rank("builder"));

  // A long message is usually a real brief, and a real brief usually needs
  // more than conversation. Cheap on a 400-word ask is a false economy.
  if (s.length > 400) want = Math.max(want, rank("writer"));

  // Rule 2, made real: a request to DO something, with no clue what it needs.
  // "can you look at this and sort it out" names no file, no site and no
  // command, but it is plainly not small talk, and answering it from `chat`
  // costs a wasted turn and a confused reply. Escalate on the SHAPE of the
  // ask rather than on nouns we happened to list.
  if (want === 0 && s.trim().length > 8 && TASK_SHAPE.test(s)) {
    want = rank("writer");
  }

  // Escalate only.
  return LADDER[Math.max(floor, want)];
}

/** Did this turn move the bot up a rung? Used for the activity log. */
function escalated(from, to) {
  return rank(to) > rank(from);
}

module.exports = { pickProfile, escalated, LADDER, rank };
