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

export const USER_JOIN_MS = 1400;
// A teammate that vanishes the instant you stop typing reads as a glitch, not
// as presence. These three are the whole "does he stick around" feel:
//   IDLE  — how long a paused draft still counts as you being at the keyboard
//   LEAVE — the fade once that runs out
//   LINGER— how long he stays after HIS turn ends, before drifting off
// They were 7.2s / 1.1s / 2.2s, which is why he left the moment you paused.
export const USER_IDLE_MS = 26000;
export const USER_LEAVE_MS = 2600;
export const READ_HOLD_MS = 1100;
export const LINGER_MS = 9000;

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

export function userTypingOf(draft, lastKeyAt, now, idleMs = USER_IDLE_MS) {
  if (!String(draft || "").trim()) return false;
  const t = Number(lastKeyAt) || 0;
  const n = Number(now) || 0;
  const windowMs = Number(idleMs) > 0 ? Number(idleMs) : USER_IDLE_MS;
  return n - t < windowMs;
}

export function moodFromActivity(activity) {
  const s = String(activity || "").toLowerCase();
  if (!s) return null;
  if (/(writ|typ|compos|draft)/.test(s)) return "looking";
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

  const draftOn = String(input.draft || "").trim().length > 0;
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
  if (linger) return { visible: true, mood: "looking", kind: "linger", phase: "out" };
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
    draft: isWait ? extras.draft : "",
    lastKeyAt: extras.lastKeyAt,
    composeAt: extras.composeAt,
    since: extras.since,
    now: extras.now,
  };
}
