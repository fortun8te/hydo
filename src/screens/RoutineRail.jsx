import { useEffect, useState } from "react";
import { CADENCES, labelRoutine, labelTrigger, newTrigger } from "../lib/routine-ui.js";

function fmtWhen(at) {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return String(at);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function toLocalInput(at) {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AddMenu({ onPick, onClose }) {
  return (
    <div className="routine-rail__menu" role="menu">
      {CADENCES.map((c) => (
        <button
          key={c.id}
          type="button"
          role="menuitem"
          onClick={() => onPick(newTrigger("schedule", c.id))}
        >
          {c.label}
        </button>
      ))}
      <button type="button" className="routine-rail__menu-cancel" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

function TriggerCard({ tr, onPatch, onRemove }) {
  const [cadenceOpen, setCadenceOpen] = useState(false);
  const schedule = tr.kind === "schedule";
  return (
    <div className="routine-rail__trig">
      <div className="routine-rail__trig-top">
        <span className="routine-rail__trig-kind">{schedule ? "Schedule" : labelTrigger(tr)}</span>
        <button type="button" className="routine-rail__trig-x" aria-label="Remove trigger" onClick={onRemove}>
          <i className="gb-icon gb-icon-x-circle" />
        </button>
      </div>
      {schedule ? (
        <>
          <button type="button" className="routine-rail__trig-cadence" onClick={() => setCadenceOpen((v) => !v)}>
            {labelTrigger(tr)}
            <i className="gb-icon gb-icon-chevron-down" />
          </button>
          {cadenceOpen ? (
            <div className="routine-rail__menu routine-rail__menu--inset" role="menu">
              {CADENCES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onPatch({ cadence: c.id });
                    setCadenceOpen(false);
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          ) : null}
          {tr.cadence === "once" ? (
            <label className="routine-rail__slot">
              <i className="gb-icon gb-icon-alarm-clock" />
              <span>{tr.at ? fmtWhen(tr.at) : "Pick a date and time"}</span>
              <input
                type="datetime-local"
                className="routine-rail__slot-input"
                value={toLocalInput(tr.at)}
                aria-label="When to run"
                onChange={(e) => onPatch({ at: e.target.value ? new Date(e.target.value).toISOString() : null })}
              />
            </label>
          ) : null}
        </>
      ) : (
        <p className="routine-rail__trig-note">Runs when this event fires for this bot.</p>
      )}
    </div>
  );
}

export default function RoutineRail({
  agent,
  routines,
  selectedId,
  onSelect,
  onClose,
  onChange,
  onCreate,
  onDelete,
  onRun,
}) {
  const list = Array.isArray(routines) ? routines : [];
  const item = selectedId ? list.find((r) => r.id === selectedId) : null;
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    setAddOpen(false);
  }, [selectedId]);

  const triggers = item?.triggers?.length ? item.triggers : item?.at ? [{ ...newTrigger("schedule", "once"), at: item.at }] : [];

  function setTriggers(next) {
    if (!item) return;
    onChange(item.id, { triggers: next, at: next.find((t) => t.kind === "schedule")?.at || item.at });
  }

  if (!item) {
    return (
      <aside className="bot-rail routine-rail" aria-label={agent?.name ? `${agent.name} routines` : "Routines"}>
        <header className="bot-rail__head">
          <button type="button" className="icon-btn" title="Back" onClick={onClose}>
            <i className="gb-icon gb-icon-chevron-left" />
          </button>
          <span className="bot-rail__title">Routines</span>
          <button type="button" className="icon-btn" title="New routine" onClick={onCreate}>
            <i className="gb-icon gb-icon-plus" />
          </button>
        </header>
        <div className="bot-rail__body">
          {list.length === 0 ? (
            <div className="routine-rail__empty">
              <div className="routine-rail__empty-mark">
                <i className="gb-icon gb-icon-alarm-clock" />
              </div>
              <h2>No routines yet</h2>
              <p>Have this bot do a job on a schedule, or when something happens.</p>
              <button type="button" className="ghost ghost--solid" onClick={onCreate}>
                Create routine
              </button>
            </div>
          ) : (
            <>
              <p className="mute routine-rail__lede">Jobs this bot runs on its own.</p>
              <div className="routine-rail__list">
                {list.map((r) => (
                  <button key={r.id} type="button" className="routine-rail__row" onClick={() => onSelect(r.id)}>
                    <span className="routine-rail__row-copy">
                      <span className="routine-rail__row-name">{r.name?.trim() || "Untitled"}</span>
                      <span className="routine-rail__row-when">{labelRoutine(r)}</span>
                    </span>
                    <span className={r.active ? "routine-rail__status is-on" : "routine-rail__status"}>
                      {r.active ? "On" : "Off"}
                    </span>
                  </button>
                ))}
              </div>
              <button type="button" className="routine-rail__add" onClick={onCreate}>
                <i className="gb-icon gb-icon-plus" /> New routine
              </button>
            </>
          )}
        </div>
      </aside>
    );
  }

  const runs = item.runs || [];

  return (
    <aside className="bot-rail routine-rail" aria-label="Routine">
      <header className="bot-rail__head">
        <button type="button" className="icon-btn" title="Back" onClick={() => onSelect(null)}>
          <i className="gb-icon gb-icon-chevron-left" />
        </button>
        <span className="bot-rail__title">{item.name?.trim() || "New routine"}</span>
        <button type="button" className="icon-btn" title="Close" onClick={onClose}>
          <i className="gb-icon gb-icon-chevrons-right" />
        </button>
      </header>
      <div className="routine-rail__toolbar">
        <label className="routine-rail__active">
          <button
            type="button"
            className={item.active ? "bot-rail__toggle is-on" : "bot-rail__toggle"}
            role="switch"
            aria-checked={!!item.active}
            onClick={() => onChange(item.id, { active: !item.active })}
          />
          Active
        </label>
        <button type="button" className="ghost ghost--solid" onClick={() => onRun(item.id)}>
          Test run
        </button>
        <button type="button" className="ghost" onClick={() => onDelete(item.id)}>
          Delete
        </button>
      </div>
      <div className="bot-rail__body">
        <label className="bot-rail__field">
          <span className="bot-rail__field-label">Name</span>
          <input
            value={item.name || ""}
            placeholder="Name this routine"
            onChange={(e) => onChange(item.id, { name: e.target.value })}
          />
        </label>
        <label className="bot-rail__field">
          <span className="bot-rail__field-label">Instruction</span>
          <textarea
            rows={7}
            value={item.instruction || ""}
            placeholder="What should this bot do when it runs?"
            onChange={(e) => onChange(item.id, { instruction: e.target.value })}
          />
        </label>
        <div className="bot-rail__field">
          <span className="bot-rail__field-label">When to run</span>
          <div className="routine-rail__when">
            {triggers.map((tr) => (
              <TriggerCard
                key={tr.id}
                tr={tr}
                onPatch={(patch) => setTriggers(triggers.map((t) => (t.id === tr.id ? { ...t, ...patch } : t)))}
                onRemove={() => setTriggers(triggers.filter((t) => t.id !== tr.id))}
              />
            ))}
            {addOpen ? (
              <AddMenu
                onPick={(tr) => {
                  setTriggers([...triggers, tr]);
                  setAddOpen(false);
                }}
                onClose={() => setAddOpen(false)}
              />
            ) : (
              <button type="button" className="routine-rail__add" onClick={() => setAddOpen(true)}>
                <i className="gb-icon gb-icon-plus" /> Add trigger
              </button>
            )}
          </div>
        </div>
        <div className="bot-rail__field">
          <span className="bot-rail__field-label">Run history</span>
          {runs.length === 0 ? (
            <p className="mute">No runs yet. Test run to try it now.</p>
          ) : (
            <div className="routine-rail__runs">
              {runs.slice(0, 8).map((run) => (
                <p key={run.id} className="mute">
                  {fmtWhen(run.at)} — {run.text}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
