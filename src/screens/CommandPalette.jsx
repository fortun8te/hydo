import { useEffect, useMemo, useRef, useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";
import { COMMANDS as DEFAULT_COMMANDS, formatChord } from "../lib/shortcuts.js";

function hit(haystack, q) {
  return typeof haystack === "string" && haystack.toLowerCase().includes(q);
}

// The reference screenshot's tab row was All / Messages / Bots / Channels /
// Files / Links / Routines / Actions. This palette only ever has two kinds
// of row — commands (General/Navigation/View, all real keyboard shortcuts)
// and one "Go to {bot}" per agent — so Messages/Channels/Files/Links/
// Routines have no rows to filter and are left out: a tab with nothing
// behind it is the dead-control bug this app's own test suite pins
// (scripts/dead-control-test.cjs). "Actions" covers every non-bot group.
const TABS = [
  { id: "all", label: "All" },
  { id: "bots", label: "Bots" },
  { id: "actions", label: "Actions" },
];

// Builds the flat, keyboard-navigable row list (static commands + one "Go to
// {bot}" row per agent) and the same rows regrouped by section for display.
// Substring-only filtering on purpose — the app ships just react + react-dom,
// no fuzzy-match dependency.
function buildRows(commands, agents, query, tab, onRun) {
  const q = query.trim().toLowerCase();

  const cmdRows =
    tab === "bots"
      ? []
      : (Array.isArray(commands) ? commands : [])
          .filter((cmd) => cmd && typeof cmd.id === "string" && typeof cmd.label === "string")
          .filter((cmd) => !q || hit(cmd.label, q) || hit(cmd.id, q))
          .map((cmd) => ({
            key: `cmd:${cmd.id}`,
            group: cmd.group || "Commands",
            icon: cmd.icon || "circle",
            face: null,
            label: cmd.label,
            chord: cmd.chord || (Array.isArray(cmd.keys) && cmd.keys.length ? formatChord(cmd.keys[0]) : ""),
            run: () => onRun?.(cmd.id),
          }));

  const botRows =
    tab === "actions"
      ? []
      : (Array.isArray(agents) ? agents : [])
          .filter((a) => a && typeof a.id === "string" && typeof a.name === "string" && a.name)
          .filter((a) => !q || hit(a.name, q) || hit(`go to ${a.name}`, q))
          .map((a) => ({
            key: `bot:${a.id}`,
            group: "Bots",
            icon: "agent-circle",
            face: a,
            label: `Go to ${a.name}`,
            chord: "",
            run: () => onRun?.("sand.goToAgent", { agentId: a.id }),
          }));

  const flat = [...cmdRows, ...botRows];
  const groups = [];
  const byName = new Map();
  for (const row of flat) {
    let g = byName.get(row.group);
    if (!g) {
      g = { name: row.group, rows: [] };
      byName.set(row.group, g);
      groups.push(g);
    }
    g.rows.push(row);
  }
  return { flat, groups };
}

export default function CommandPalette({ open, commands, agents, onRun, onClose }) {
  const list = Array.isArray(commands) ? commands : DEFAULT_COMMANDS;
  const roster = Array.isArray(agents) ? agents : [];

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const itemRefs = useRef([]);
  const previouslyFocused = useRef(null);

  const { flat: flatRows, groups } = useMemo(
    () => buildRows(list, roster, query, tab, onRun),
    [list, roster, query, tab, onRun]
  );

  // Open: remember what had focus, reset the search, move focus into the
  // input. Close (or unmount): give focus back to whatever had it before.
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;
    setQuery("");
    setTab("all");
    setActive(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      const el = previouslyFocused.current;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, [open]);

  useEffect(() => {
    setActive((i) => (flatRows.length ? Math.min(i, flatRows.length - 1) : 0));
  }, [flatRows.length]);

  useEffect(() => {
    const el = itemRefs.current[active];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!flatRows.length) return;
        setActive((i) => (i + 1) % flatRows.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!flatRows.length) return;
        setActive((i) => (i - 1 + flatRows.length) % flatRows.length);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        pick(active);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flatRows, active, onClose]);

  function pick(index) {
    const row = flatRows[index];
    if (!row) return;
    row.run();
    onClose?.();
  }

  if (!open) return null;

  let rowIndex = -1;

  return (
    <div className="hy-palette" role="dialog" aria-modal="true" aria-label="Commands">
      <div className="hy-palette__scrim" onClick={onClose} />
      <div className="hy-palette__card">
        <div className="hy-palette__search">
          <i className="gb-icon gb-icon-magnifying-glass" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Type a command or search bots…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search commands"
          />
        </div>
        <div className="hy-palette__tabs" role="tablist" aria-label="Filter results">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "hy-palette__tab is-on" : "hy-palette__tab"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setTab(t.id);
                setActive(0);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="hy-palette__list" role="listbox" aria-label="Results">
          {flatRows.length === 0 && <div className="hy-palette__empty">No matches</div>}
          {groups.map((group) => (
            <div className="hy-palette__group" key={group.name}>
              <div className="hy-palette__group-label">{group.name}</div>
              {group.rows.map((row) => {
                rowIndex += 1;
                const i = rowIndex;
                return (
                  <button
                    key={row.key}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    className={i === active ? "hy-palette__item is-on" : "hy-palette__item"}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(i)}
                  >
                    <span className="hy-palette__item-icon">
                      {/* No glow at 18px — below the app's 20px floor
                          (see the channel-mark comment in Sidebar.jsx). */}
                      {row.face ? (
                        <UmbraFace tint={row.face.blob} shape={row.face.shape} size={18} />
                      ) : (
                        <i className={`gb-icon gb-icon-${row.icon}`} />
                      )}
                    </span>
                    <span className="hy-palette__item-label">{row.label}</span>
                    {row.chord ? <span className="hy-palette__item-chord">{row.chord}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Exported for scripts/palette-tabs-test.cjs: a tab that filters nothing is
// the dead-control bug this app's test suite pins (dead-control-test.cjs),
// so the test drives the real row-building logic rather than grepping JSX.
export { buildRows, TABS };
