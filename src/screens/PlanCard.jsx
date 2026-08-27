import { useState } from "react";

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

function stateOf(t) {
  const s = String((t && t.status) || "pending").toLowerCase();
  if (DONE.has(s)) return "done";
  if (LIVE.has(s)) return "live";
  return "todo";
}

/** "9:04" for a step still running, "9:04 - 9:11" once it is finished. */
function spanOf(t) {
  const at = (v) => {
    const d = new Date(v);
    return Number.isFinite(d.getTime())
      ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "";
  };
  const from = at(t && t.startedAt);
  if (!from) return "";
  const to = at(t && t.doneAt);
  // A step that started and finished inside the same minute reads as
  // "9:04 - 9:04", which looks broken. One time is the honest answer.
  return to && to !== from ? `${from} - ${to}` : from;
}

export default function PlanCard({ todos, name }) {
  const [open, setOpen] = useState(false);
  const list = (Array.isArray(todos) ? todos : []).filter((t) => t && t.text);
  if (!list.length) return null;

  const states = list.map(stateOf);
  const done = states.filter((s) => s === "done").length;
  const live = list[states.indexOf("live")];
  const allDone = done === list.length;

  // The headline is the step actually happening. Falling back to the first
  // unfinished one matters: a model that forgets to mark something in_progress
  // would otherwise leave the strip saying nothing at all.
  const current = live || list[states.findIndex((s) => s !== "done")] || null;
  const headline = allDone ? "Plan finished" : (current && current.text) || "Working";
  const who = name ? `${name}'s plan` : "Plan";

  return (
    <div className={`hy-plan${allDone ? " hy-plan--done" : ""}`}>
      {/* The list is FIRST in the DOM on purpose: it stacks above the strip, so
          the strip stays welded to the composer and the steps grow up and away
          from it rather than shoving it around. */}
      {open ? (
        <ol className="hy-plan__list">
          {list.map((t, i) => (
            <li key={t.id || i} className={`hy-plan__step is-${states[i]}`}>
              {/* A tick, not a dot, once it is done. A dot that only changes
                  colour asks you to remember which colour meant finished. */}
              {states[i] === "done" ? (
                <svg className="hy-plan__tickmark" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M2.5 6.4 4.8 8.7 9.5 3.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span className="hy-plan__dot" aria-hidden="true" />
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
        <span className="hy-plan__now">{headline}</span>
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
