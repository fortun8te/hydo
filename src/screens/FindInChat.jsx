import { useEffect, useMemo, useRef, useState } from "react";

const DEBOUNCE_MS = 150;

// Every case-insensitive occurrence of `query` inside each message's `text`,
// in thread order. `matchIndex` is the occurrence's position within its own
// message (0-based) — that's what a consumer needs to highlight the right
// hit when a message contains the query more than once.
function findMatches(thread, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const list = Array.isArray(thread) ? thread : [];
  const out = [];
  for (const m of list) {
    if (!m || typeof m.text !== "string" || !m.text) continue;
    const hay = m.text.toLowerCase();
    let from = 0;
    let occurrence = 0;
    for (;;) {
      const idx = hay.indexOf(q, from);
      if (idx === -1) break;
      out.push({ messageId: m.id, matchIndex: occurrence });
      occurrence += 1;
      from = idx + q.length;
    }
  }
  return out;
}

export default function FindInChat({ open, thread, onClose, onJump }) {
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const previouslyFocused = useRef(null);
  const debounceRef = useRef(null);

  // Open: remember focus, clear the box, focus the input. Close/unmount:
  // drop any pending debounce timer and give focus back.
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;
    setRawQuery("");
    setQuery("");
    setActiveIndex(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      const el = previouslyFocused.current;
      if (el && typeof el.focus === "function") el.focus();
    };
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setQuery(rawQuery), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [rawQuery]);

  const matches = useMemo(() => findMatches(thread, query), [thread, query]);

  useEffect(() => {
    setActiveIndex((i) => (matches.length ? Math.min(i, matches.length - 1) : 0));
  }, [matches]);

  // Report the active match any time it (or the match list) changes, so the
  // parent can scroll to it — including the first hit after each keystroke.
  useEffect(() => {
    if (!open) return;
    const m = matches[activeIndex];
    if (m) onJump?.(m.messageId, m.matchIndex);
  }, [open, matches, activeIndex, onJump]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (!matches.length) return;
        setActiveIndex((i) => (e.shiftKey ? (i - 1 + matches.length) % matches.length : (i + 1) % matches.length));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!matches.length) return;
        setActiveIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (!matches.length) return;
        setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, matches, onClose]);

  function step(dir) {
    if (!matches.length) return;
    setActiveIndex((i) => (i + dir + matches.length) % matches.length);
  }

  if (!open) return null;

  const counter = matches.length ? `${activeIndex + 1}/${matches.length}` : "0/0";

  return (
    <div className="hy-find" role="dialog" aria-modal="false" aria-label="Find in chat">
      <i className="gb-icon gb-icon-magnifying-glass hy-find__icon" />
      <input
        ref={inputRef}
        type="text"
        className="hy-find__input"
        value={rawQuery}
        onChange={(e) => setRawQuery(e.target.value)}
        placeholder="Find in chat"
        autoComplete="off"
        spellCheck={false}
        aria-label="Find in chat"
      />
      <span className="hy-find__count">{counter}</span>
      <button
        type="button"
        className="hy-find__btn"
        onClick={() => step(-1)}
        disabled={!matches.length}
        aria-label="Previous match"
        title="Previous match"
      >
        <i className="gb-icon gb-icon-chevron-up-small" />
      </button>
      <button
        type="button"
        className="hy-find__btn"
        onClick={() => step(1)}
        disabled={!matches.length}
        aria-label="Next match"
        title="Next match"
      >
        <i className="gb-icon gb-icon-chevron-down-small" />
      </button>
      <button type="button" className="hy-find__btn hy-find__close" onClick={onClose} aria-label="Close find" title="Close">
        <i className="gb-icon gb-icon-x-circle" />
      </button>
    </div>
  );
}
