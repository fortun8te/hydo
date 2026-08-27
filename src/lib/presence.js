/**
 * In-chat blob presence. Pure: tests call this without mounting React.
 *
 * Moods:
 *   fidget  — waiting while the user types (look around / blink)
 *   looking — reading the last message
 *   typing  — writing (three dots)
 *   spin    — working (yaw)
 *
 * Timing is hysteresis, not a light switch: a short join delay, a read hold
 * after send, a longer idle before leave, then a brief fade window.
 */

// He should show up while you are still typing, not after you have stopped.
// 1400ms was long enough that on a short message he arrived as you hit send.
// The jitter is the point: a fixed delay reads as a UI animation, a varying
// one reads as someone noticing you at their own pace.
export const USER_JOIN_MS = 620;
export const USER_JOIN_JITTER_MS = 520;

/** A stable per-face join delay in [JOIN, JOIN+JITTER). `seed` is the bot id. */
export function joinDelayOf(seed) {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return USER_JOIN_MS + (Math.abs(h) % USER_JOIN_JITTER_MS);
}
// A teammate that vanishes the instant you stop typing reads as a glitch, not
// as presence. These three are the whole "does he stick around" feel:
//   IDLE  — how long a paused draft still counts as you being at the keyboard
//   LEAVE — the fade once that runs out
//   LINGER— how long he stays after HIS turn ends, before drifting off
// They were 7.2s / 1.1s / 2.2s, which is why he left the moment you paused.
export const USER_IDLE_MS = 45000;
export const USER_LEAVE_MS = 4200;
export const READ_HOLD_MS = 1100;
// The read hold used to be that flat 1100ms whatever you sent, so "hi" and a
// four-hundred-word brief were absorbed in exactly the same beat. Nothing
// about the face said one of them was more to take in, which is the tell that
// there is a constant behind it rather than someone reading.
//
// Square root, not linear: attention does not scale with length, and a linear
// term would make a pasted stack trace take half a minute to look at. This
// grows quickly over the first sentence and then flattens . "hi" 1.3s, a
// paragraph 2.9s, anything longer saturates. It is a beat, not real reading.
export const READ_HOLD_MAX_MS = 3400;
export function readHoldFor(chars) {
  const n = Math.max(0, Number(chars) || 0);
  const ms = READ_HOLD_MS + Math.sqrt(n) * 90;
  return Math.min(READ_HOLD_MAX_MS, Math.round(ms));
}
// How long he stays after HIS OWN message. He was going the moment the last
// token landed, which is the exact moment you are reading it and most likely
// to reply. Staying is the cheap part of feeling present.
export const LINGER_MS = 22000;
// The tail of the linger, where he actually starts to go. Matches the
// `sand-inchat-out` duration in production.css so the fade finishes exactly as
// the row stops being rendered, instead of snapping away mid-animation.
export const LEAVE_FADE_MS = 300;

// ---------------------------------------------------------------- online pip
//
// The roster pip is a CLAIM: "this teammate is up". It was rendered
// unconditionally, so it claimed that for a bot that had never taken a turn
// and had no Hermes child at all.
//
// The only thing that makes it true is a turn that is HAPPENING: reading you,
// thinking, calling a tool, writing back. `workingIn` is exactly that, and it
// is set for the life of the turn and cleared the moment it ends.
//
// There used to be a 15 minute "warm" window here too, on the reasoning that a
// warm gateway child is a kind of online. Wrong twice over: it claimed a bot
// was online while it sat doing nothing, and because it expired on a TIMER
// rather than on an event, the pip vanished at an arbitrary unrelated moment.
// From the outside that reads as a bug, because it is one. Online means
// working, and nothing here may depend on the clock.
export function pipOf(agent) {
  if (!agent) return null;
  return agent.workingIn ? "work" : null;
}

/**
 * What the pip MEANS, for a caller that has a conversation to compare against.
 *
 * `pipOf` answers "is a turn of this teammate's running", which is the right
 * question for the sidebar because the sidebar lists every conversation at
 * once. It is not the whole answer in a channel or on a rail, where a lit dot
 * reads as "working on THIS" — and a bot busy in its own 1:1 would be wearing
 * that claim without it being true.
 *
 * So the pip keeps one shape and one colour, and this supplies the sentence.
 * The word is never "Online": `workingIn` is set for the life of a turn and
 * cleared the moment it ends, so the only thing it can honestly report is work
 * happening right now. "Online" would be a claim about a warm process that
 * nothing on this side can see.
 *
 * @param {Object} agent
 * @param {string} [conversationId]  the thread being looked at; defaults to
 *                                   the teammate's own 1:1
 * @returns {string} "" when there is no turn to describe
 */
export function pipLabelOf(agent, conversationId) {
  const at = agent && agent.workingIn;
  if (!at) return "";
  const conv = conversationId ?? (agent && agent.id);
  return String(at) === String(conv) ? "Working here" : "Working in another conversation";
}

/**
 * Is there anything in the composer?
 *
 * `draft` arrives here either as the composer's text (from the composer
 * itself) or as a bare boolean (from the transcript). Only its emptiness has
 * ever mattered to presence — nothing below reads a character of it — and
 * threading the *string* through the transcript meant every keystroke changed
 * a Transcript prop and re-rendered the entire message list to move one
 * presence dot. The boolean form is what lets Transcript memo through a
 * keystroke.
 *
 * The boolean has to be handled before the coercion: `String(false)` is
 * "false", which is very much truthy, so a false draft would otherwise read as
 * a full one.
 */
function draftIsFilled(draft) {
  if (typeof draft === "boolean") return draft;
  return String(draft || "").trim().length > 0;
}

export function userTypingOf(draft, lastKeyAt, now, idleMs = USER_IDLE_MS) {
  if (!draftIsFilled(draft)) return false;
  const t = Number(lastKeyAt) || 0;
  const n = Number(now) || 0;
  const windowMs = Number(idleMs) > 0 ? Number(idleMs) : USER_IDLE_MS;
  return n - t < windowMs;
}

export function moodFromActivity(activity) {
  const s = String(activity || "").toLowerCase();
  if (!s) return null;
  // Writing becomes DOTS. This used to return "looking" on the reasoning that
  // a face is warmer than an indicator, but the face gives you nothing while a
  // reply is being written, and three dots is the one gesture everybody
  // already reads as "words are coming". UmbraFace morphs into them.
  if (/(writ|typ|compos|draft)/.test(s)) return "typing";
  if (/(read|look|think|listen)/.test(s)) return "looking";
  return "spin";
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function presenceOf(input = {}) {
  const working = !!input.working;
  const sending = !!input.sending;
  const linger = !!input.linger;
  const activity = input.activity || "";
  const now = num(input.now) > 0 ? num(input.now) : Date.now();
  const lastKeyAt = num(input.lastKeyAt);
  const composeAt = num(input.composeAt) || lastKeyAt;
  const since = num(input.since);
  const idleMs = num(input.idleMs) > 0 ? num(input.idleMs) : USER_IDLE_MS;
  const joinMs = num(input.joinMs) > 0 ? num(input.joinMs) : USER_JOIN_MS;
  const leaveMs = num(input.leaveMs) > 0 ? num(input.leaveMs) : USER_LEAVE_MS;
  const readMs = num(input.readMs) > 0 ? num(input.readMs) : READ_HOLD_MS;

  const draftOn = draftIsFilled(input.draft);
  const typing = userTypingOf(input.draft, lastKeyAt, now, idleMs);
  const joined = typing && now - composeAt >= joinMs;
  const leaving = draftOn && !typing && now - lastKeyAt < idleMs + leaveMs;
  const inFlight = working || sending;
  const holdRead = inFlight && since > 0 && now - since < readMs;

  if (!inFlight && !linger && joined) {
    return { visible: true, mood: "fidget", kind: "wait", phase: "in" };
  }
  if (!inFlight && !linger && leaving) {
    return { visible: true, mood: "fidget", kind: "wait", phase: "out" };
  }

  const visible = inFlight || linger || joined;
  if (!visible) return { visible: false, mood: "looking", kind: "idle", phase: "out" };

  if (holdRead || (sending && !working && !moodFromActivity(activity))) {
    return { visible: true, mood: "looking", kind: "read", phase: "in" };
  }

  const fromActivity = moodFromActivity(activity);
  if (fromActivity) {
    const kind = fromActivity === "looking" ? "read" : "work";
    return { visible: true, mood: fromActivity, kind, phase: "in" };
  }
  if (working) return { visible: true, mood: "spin", kind: "work", phase: "in" };
  if (linger) {
    // NOT phase "out". The CSS for that is a 0.3s fade with `forwards`, so
    // marking the whole linger as "leaving" made him vanish a third of a
    // second after his own message and stay gone for the remaining 21.7
    // seconds the linger was still nominally running. The linger worked the
    // entire time; it was being rendered invisible.
    //
    // He is here, and only starts drifting off in the last moment of it.
    const started = Number(input.lingerSince) || 0;
    const going = started > 0 && now - started > LINGER_MS - LEAVE_FADE_MS;
    return { visible: true, mood: "looking", kind: "linger", phase: going ? "out" : "in" };
  }
  return { visible: true, mood: "looking", kind: "read", phase: "in" };
}

/**
 * Channel threads have many faces. Composer join/leave belongs to one wait
 * face (first member). Other members only show when they themselves work.
 */
export function composerExtrasForMember(agentId, waitId, extras = {}) {
  const isWait = waitId != null && String(agentId) === String(waitId);
  return {
    sending: isWait ? !!extras.sending : false,
    linger: isWait ? !!extras.linger : false,
    draft: isWait ? extras.draft : false,
    lastKeyAt: extras.lastKeyAt,
    composeAt: extras.composeAt,
    since: extras.since,
    now: extras.now,
  };
}

// ------------------------------------------------------------ slow backends
//
// How long a turn has to run before the working row starts saying how long.
//
// A teammate on hosted Grok answers a short question in a few seconds, and a
// counter on that is noise — it turns an ordinary wait into something to watch.
// A teammate on the user's own hardware is a different animal: MEASURED on the
// endpoint in docs/LOCAL-MODEL.md, ~16 tokens/second, so a 2,000-token answer
// is a little over two minutes during which the row says "Working" and nothing
// changes. Two minutes of a frozen word is indistinguishable from a hang, and
// the only thing the user can do about a hang is give up on a turn that was
// fine.
//
// 20s is chosen against those two facts: at 16 tok/s it is ~320 tokens, so it
// is past every short local answer and still well past anything a hosted model
// does routinely. It is a legibility threshold, not a deadline — nothing gives
// up when it passes.
export const SLOW_TURN_MS = 20000;

/**
 * "1m 40s" once a turn has been running long enough to be worth saying.
 *
 * Returns "" below the threshold, and "" when `since` is 0 — which is the
 * honest answer for a turn this window did not start (a routine, a job wake,
 * a channel turn begun elsewhere). A guessed start time would put a confident
 * wrong number next to a face, which is worse than no number.
 *
 * @param {number} since  epoch ms the turn started, 0 when unknown
 * @param {number} now
 * @param {number} [thresholdMs]
 * @returns {string}
 */
export function elapsedLabel(since, now, thresholdMs = SLOW_TURN_MS) {
  const start = num(since);
  const at = num(now);
  if (start <= 0 || at <= start) return "";
  const ms = at - start;
  const gate = num(thresholdMs) > 0 ? num(thresholdMs) : SLOW_TURN_MS;
  if (ms < gate) return "";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}
