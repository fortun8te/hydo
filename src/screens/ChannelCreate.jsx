import { useEffect, useMemo, useRef, useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";
import { MAX_MEMBERS } from "./ChannelRail.jsx";

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.4 15.4 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChipX() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export default function ChannelCreate({ agents = [], onClose, onCreate }) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState([]);
  const nameRef = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => nameRef.current?.focus());
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const roster = Array.isArray(agents) ? agents : [];
  const selected = useMemo(
    () => picked.map((id) => roster.find((a) => a.id === id)).filter(Boolean),
    [picked, roster]
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((a) => String(a.name || "").toLowerCase().includes(q));
  }, [roster, query]);

  function toggle(id) {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_MEMBERS) return prev;
      return [...prev, id];
    });
  }

  function create() {
    if (!picked.length) return;
    onCreate?.({ name: name.trim() || "New Channel", members: picked });
  }

  return (
    <div className="hy-chcreate" role="dialog" aria-modal="true" aria-label="New channel">
      <div className="hy-chcreate__scrim" onClick={onClose} />
      <div className="hy-chcreate__card">
        <header className="hy-chcreate__head">
          <h2>New channel</h2>
          <button type="button" className="hy-chcreate__x" onClick={onClose} title="Close">
            <CloseGlyph />
          </button>
        </header>

        <label className="hy-chcreate__field">
          <span>Name</span>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Project Falcon"
          />
        </label>

        <div className="hy-chcreate__field">
          <span>Add Bots</span>
          <div className="hy-chcreate__search">
            <SearchGlyph />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search bots"
            />
          </div>
          {selected.length > 0 && (
            <div className="hy-chcreate__chips">
              {selected.map((a) => (
                <span key={a.id} className="hy-chcreate__chip">
                  <UmbraFace tint={a.blob} shape={a.shape} size={20} />
                  <span>{a.name}</span>
                  <button type="button" aria-label={`Remove ${a.name}`} onClick={() => toggle(a.id)}>
                    <ChipX />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="hy-chcreate__list" role="listbox" aria-multiselectable="true">
            {filtered.map((a) => {
              const on = picked.includes(a.id);
              const locked = !on && picked.length >= MAX_MEMBERS;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={on ? "hy-chcreate__row is-on" : "hy-chcreate__row"}
                  disabled={locked}
                  onClick={() => toggle(a.id)}
                >
                  <span className={on ? "hy-chcreate__box is-on" : "hy-chcreate__box"} aria-hidden="true">
                    {on ? (
                      <svg viewBox="0 0 16 16" width="11" height="11">
                        <path
                          d="M3.2 8.2 6.4 11.2 12.8 4.6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <UmbraFace tint={a.blob} shape={a.shape} size={28} />
                  <span className="hy-chcreate__name">{a.name}</span>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="hy-chcreate__empty">No bots match.</p>}
          </div>
        </div>

        <footer className="hy-chcreate__foot">
          <button
            type="button"
            className="hy-chcreate__create"
            disabled={!picked.length}
            onClick={create}
          >
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}
