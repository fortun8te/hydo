import { useEffect, useMemo, useRef, useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";
import { BOT_PRESETS, presetPatch } from "../lib/bot-presets.js";

function Chord({ n }) {
  return (
    <span className="hy-botcreate__chord" aria-hidden="true">
      <kbd>⌘</kbd>
      <kbd>{n}</kbd>
    </span>
  );
}

export default function BotCreate({ agents = [], onClose, onCreate, onOpen }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  const roster = Array.isArray(agents) ? agents : [];
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return roster;
    return roster.filter((a) => String(a.name || "").toLowerCase().includes(s));
  }, [roster, q]);
  const typed = q.trim();
  const exact = roster.some((a) => String(a.name || "").toLowerCase() === typed.toLowerCase());
  const createLabel = typed && !exact ? `Create “${typed}”` : "Create new Bot";
  const rows = [{ id: "__new", kind: "new" }, ...filtered.map((a) => ({ id: a.id, kind: "bot", agent: a }))];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(rows.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        setActive(0);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const n = Number(e.key) - 1;
        pick(n);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        pick(active);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [rows, active, typed, exact]);

  function pick(index) {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "new") onCreate?.({ name: typed || "New Bot" });
    else onOpen?.(row.id);
  }

  return (
    <div className="hy-botcreate" role="dialog" aria-label="Search or create Bots">
      <div className="hy-botcreate__scrim" onClick={onClose} />
      <label className="hy-botcreate__to">
        <span>To:</span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          placeholder="Search or create Bots"
        />
      </label>
      <div className="hy-botcreate__card">
        <button
          type="button"
          className={active === 0 ? "hy-botcreate__new is-on" : "hy-botcreate__new"}
          onMouseEnter={() => setActive(0)}
          onClick={() => pick(0)}
        >
          <span className="hy-botcreate__plus">+</span>
          <span className="hy-botcreate__label">{createLabel}</span>
          <Chord n={1} />
        </button>
        {/* Starting points. Only when you have not typed a name . once you
            have, you have already decided what this one is, and a row of
            suggestions is just something in the way. */}
        {!typed ? (
          <div className="hy-botcreate__presets">
            <span className="hy-botcreate__presets-label">Start from</span>
            {BOT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="hy-botcreate__preset"
                title={p.blurb}
                onClick={() => {
                  onCreate?.(presetPatch(p));
                  onClose?.();
                }}
              >
                <UmbraFace tint={p.tint} shape="pebble" size={22} poke={false} />
                <span className="hy-botcreate__preset-copy">
                  <span className="hy-botcreate__preset-name">{p.name}</span>
                  {/* What it will actually be, said here rather than in a
                      tooltip. A row of six names is a guess; the point of a
                      starting point is knowing where it starts. */}
                  <span className="hy-botcreate__preset-blurb">{p.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="hy-botcreate__list">
          {filtered.map((a, i) => (
            <button
              key={a.id}
              type="button"
              className={active === i + 1 ? "hy-botcreate__row is-on" : "hy-botcreate__row"}
              onMouseEnter={() => setActive(i + 1)}
              onClick={() => pick(i + 1)}
            >
              <UmbraFace tint={a.blob} shape={a.shape} size={28} glow={!!a.glow} />
              <span className="hy-botcreate__label">{a.name}</span>
              {i + 2 <= 9 ? <Chord n={i + 2} /> : null}
            </button>
          ))}
        </div>
        <div className="hy-botcreate__foot">
          <span>
            <kbd>Tab</kbd> add
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
        </div>
      </div>
    </div>
  );
}
