import { useEffect, useState } from "react";

/**
 * The teammate's own plan, attached to the top of the prompt box.
 *
 * It already existed in the settings rail, behind a panel you have to open —
 * so the one thing that says what a teammate is doing during a long job was
 * the one thing you could not see while watching it work.
 *
 * It hangs off the composer rather than sitting in the thread. A plan is
 * current state, not history: in the transcript it scrolled away with the turn
 * that produced it, and it landed somewhere different every time depending on
 * where the thread ended. Here it is always in the same place, and it extends
 * upward so opening it never moves what you are typing into.
 *
 * The plan is Hermes'. `captureTodos` mirrors the `todo` tool off the tool
 * stream and this renders it read only: editing here would put a second author
 * on a list the model re-reads as its own.
 */

const DONE = new Set(["completed", "complete", "done", "finished"]);
const LIVE = new Set(["in_progress", "in-progress", "active", "running", "doing"]);
// Hermes can also retire a step without doing it. That is not "still to do"
// and it is certainly not "done", and folding it into either was the reason a
// plan could read 4/5 forever with nothing left that would ever move.
const DROPPED = new Set(["cancelled", "canceled", "skipped", "dropped", "abandoned"]);

/**
 * Hermes' status vocabulary is not fixed — the same state arrives as
 * `in_progress`, `in-progress`, `active` or `running` depending on the model
 * and the day. Everything that draws a plan goes through here so that all four
 * spellings land on one class name; the bot rail used to interpolate the raw
 * status straight into `is-${status}`, which meant half of them matched no CSS
 * at all and the running step simply looked pending.
 *
 * @param {{status?:string}} t
 * @returns {"done"|"live"|"dropped"|"todo"}
 */
export function stateOf(t) {
  const s = String((t && t.status) || "pending").toLowerCase();
  if (DONE.has(s)) return "done";
  if (LIVE.has(s)) return "live";
  if (DROPPED.has(s)) return "dropped";
  return "todo";
}

/**
 * `stateOf` reads what Hermes last said about a step, not whether anyone is
 * still turning it. Nothing rewrites the todo array when a run ends or the
 * owner switches conversations, so a step left `in_progress` by a finished or
 * abandoned turn keeps reading "live" forever — the strip would go on
 * claiming a step is happening after the model has gone quiet.
 *
 * `running` is the one honest answer to "is a turn of the owner's actually
 * happening right now" (`botBusy`/`botWorks` in src/lib/working.js, the same
 * source the roster pip uses) — never inferred from the todos themselves.
 * A live status downgrades to plain "todo" when it isn't backed by that,
 * which is also why it never falls back to lighting the first pending row:
 * NEXT is not the same claim as ACTIVE.
 *
 * @param {{status?:string}} t
 * @param {boolean} running
 * @returns {"done"|"live"|"dropped"|"todo"}
 */
export function liveStateOf(t, running) {
  const s = stateOf(t);
  return s === "live" && !running ? "todo" : s;
}

const clock = (v) => {
  const d = new Date(v);
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
};

/**
 * When a step ran: "9:04 - 9:11" once it is finished, "9:04 →" while it is
 * still going.
 *
 * The open-ended form matters. The running step used to print a bare "9:04",
 * which is the same shape as a finished step that happened to start and end
 * inside one minute — so the one row you most want to identify was the one row
 * whose time told you nothing about whether it was over.
 */
function spanOf(t) {
  const from = clock(t && t.startedAt);
  if (!from) return "";
  const to = clock(t && t.doneAt);
  if (!to) return `${from} →`;
  // A step that started and finished inside the same minute reads as
  // "9:04 - 9:04", which looks broken. One time is the honest answer.
  return to !== from ? `${from} - ${to}` : from;
}

export default function PlanCard({ todos, name, running }) {
  const [open, setOpen] = useState(false);
  const list = (Array.isArray(todos) ? todos : []).filter((t) => t && t.text);

  // Collapse when the plan changes hands.
  //
  // The card is mounted for the life of the composer, not of a plan, so `open`
  // used to survive switching conversations: you opened one teammate's steps,
  // clicked to another, and were shown a stranger's list already expanded over
  // the prompt box. Keying off the owner rather than off the todos is
  // deliberate — the list itself is rewritten on every `todo` call, and
  // collapsing on that would slam the panel shut mid-job, which is exactly the
  // "I have to keep reopening it" behaviour.
  useEffect(() => {
    setOpen(false);
  }, [name]);

  if (!list.length) return null;

  // `running` — is the owner actually mid-turn — comes from the caller via
  // `botBusy`/`botWorks`, not from the todos. `liveStateOf` downgrades a stale
  // "live" status to "todo" whenever it isn't, so a plan left over from a
  // finished or abandoned turn never keeps narrating itself as in progress.
  const states = list.map((t) => liveStateOf(t, running));
  const settled = states.filter((s) => s === "done" || s === "dropped").length;
  const done = states.filter((s) => s === "done").length;
  const live = states.includes("live") ? list[states.indexOf("live")] : null;
  const allDone = settled === list.length;

  // The headline says what is ACTUALLY happening, never what is merely next.
  // Falling back to the first unfinished step used to fill the strip's
  // silence, but that silence was the truth: nobody was running that step,
  // and the fallback said otherwise. When nothing is running, say so.
  const current = live;
  const headline = allDone ? "Plan finished" : current ? current.text : running ? "Working" : "Not running right now";
  const who = name ? `${name}'s plan` : "Plan";
  // Open, the strip stops repeating the row directly above it and says the one
  // thing the list does not: how much of it is left.
  const bar = open ? (allDone ? "Plan finished" : who) : headline;

  return (
    <div className={`hy-plan${allDone ? " hy-plan--done" : ""}`}>
      {/* The list is FIRST in the DOM on purpose: it stacks above the strip, so
          the strip stays welded to the composer and the steps grow up and away
          from it rather than shoving it around. */}
      {open ? (
        <ol className="hy-plan__list">
          {list.map((t, i) => (
            <li
              key={t.id || i}
              className={`hy-plan__step is-${states[i]}`}
              aria-current={states[i] === "live" ? "step" : undefined}
            >
              {/* A box you can see the state of, not a dot whose colour you
                  have to remember: empty for a step still to do, ticked once
                  it is done, ringed while it is running. It is not clickable
                  and never pretends to be — the plan has one author. */}
              {states[i] === "done" ? (
                <svg className="hy-plan__box hy-plan__box--done" viewBox="0 0 14 14" aria-hidden="true">
                  <rect x="0.7" y="0.7" width="12.6" height="12.6" rx="3.6" fill="currentColor" />
                  <path
                    d="M3.9 7.2 6.1 9.4 10.2 4.9"
                    fill="none"
                    stroke="var(--hy-menu, #1c1c1c)"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : states[i] === "dropped" ? (
                <svg className="hy-plan__box hy-plan__box--dropped" viewBox="0 0 14 14" aria-hidden="true">
                  <rect
                    x="0.9"
                    y="0.9"
                    width="12.2"
                    height="12.2"
                    rx="3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path d="M4.4 7h5.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg
                  className={`hy-plan__box hy-plan__box--${states[i]}`}
                  viewBox="0 0 14 14"
                  aria-hidden="true"
                >
                  <rect
                    x="0.9"
                    y="0.9"
                    width="12.2"
                    height="12.2"
                    rx="3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  {states[i] === "live" ? (
                    <circle className="hy-plan__pip" cx="7" cy="7" r="2.6" fill="currentColor" />
                  ) : null}
                </svg>
              )}
              <span className="hy-plan__text">{t.text}</span>
              {spanOf(t) ? <span className="hy-plan__span">{spanOf(t)}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}

      <button
        type="button"
        className="hy-plan__bar"
        aria-expanded={open}
        aria-label={`${who}, ${done} of ${list.length} done`}
        title={open ? "Hide the steps" : `${who} — show the steps`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hy-plan__meter" aria-hidden="true">
          {list.map((t, i) => (
            <i key={t.id || i} className={`hy-plan__tick is-${states[i]}`} />
          ))}
        </span>
        <span className="hy-plan__now">{bar}</span>
        <span className="hy-plan__count">
          {done}/{list.length}
        </span>
        <i
          className={`gb-icon gb-icon-chevron-${open ? "down" : "up"} hy-plan__chev`}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
