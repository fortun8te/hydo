import { useEffect, useId, useRef, useState } from "react";

// Dialog: modal shell — scrim + centred card. Closes on scrim click or Escape.
// Renders whatever you give it, typically a DialogNav plus a scrolling body.
export function Dialog({ label, onClose, children }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="hy-dialog" role="dialog" aria-modal="true" aria-label={label}>
      <div className="hy-dialog__scrim" onClick={onClose} />
      <div className="hy-dialog__card">{children}</div>
    </div>
  );
}

// DialogNav: left-rail navigation list for a Dialog. items: [{ id, label, icon }].
// The rail sits on its own ground (a shade off the dialog body) and the active
// item is a rounded fill behind icon + label.
export function DialogNav({ items, activeId, onSelect, ariaLabel = "Sections" }) {
  return (
    <nav className="hy-dialog__nav" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={item.id === activeId ? "page" : undefined}
          className={item.id === activeId ? "hy-dialog__nav-btn is-on" : "hy-dialog__nav-btn"}
          /* The label is hidden on a narrow window (ui.css), where the icon is
             all that is left of the row — so the name has to survive
             somewhere a pointer can still find it. */
          title={item.label}
          onClick={() => onSelect?.(item.id)}
        >
          {item.icon && <i className={`gb-icon gb-icon-${item.icon}`} aria-hidden="true" />}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

// SectionLabel: the quiet heading that sits above a RowGroup, outside its fill.
// Sentence case, normal weight, secondary colour — never micro-caps. It is
// slightly outdented from the rows so the group reads as the louder object.
export function SectionLabel({ children }) {
  return <h3 className="hy-section-label">{children}</h3>;
}

// RowGroup: the rounded fill that holds one or more Rows. No outer border —
// the fill alone separates it from the dialog ground, and rows are divided by
// inset hairlines drawn by the Row itself.
export function RowGroup({ children }) {
  return <div className="hy-row-group">{children}</div>;
}

// Row: one label(+description) / control line inside a RowGroup.
//   leading            node before the copy (an avatar, say)
//   descriptionAction  node inline after the description (a copy button)
//   divided            draw the inset hairline above this row
//   strong             label carries the weight (used by the account row)
export function Row({
  label,
  description,
  descriptionAction,
  leading,
  children,
  divided = false,
  strong = false,
}) {
  return (
    <div className="hy-row">
      {divided && <div className="hy-row__divider" aria-hidden="true" />}
      {leading && <div className="hy-row__leading">{leading}</div>}
      <div className="hy-row__copy">
        <span className={strong ? "hy-row__label is-strong" : "hy-row__label"}>{label}</span>
        {description && (
          <span className="hy-row__desc">
            <span className="hy-row__desc-text">{description}</span>
            {descriptionAction}
          </span>
        )}
      </div>
      {children && <div className="hy-row__control">{children}</div>}
    </div>
  );
}

// Field: label stacked above its control — for a control that wants its own
// caption (e.g. inside a Row's control slot, or standalone for a wide input).
export function Field({ label, children }) {
  return (
    <label className="hy-field">
      <span className="hy-field__label">{label}</span>
      {children}
    </label>
  );
}

// Select: a compact filled pill (label + chevron) that opens a listbox popover.
// Replaces the native <select>, which macOS renders as a white OS widget that
// clashes with a dark dialog. options: array of strings, or [{ value, label }].
// Keyboard: Enter/Space opens; ArrowUp/ArrowDown move; Enter picks; Escape
// closes and refocuses the button; clicking outside closes. Focus never leaves
// the button, so there is nothing to trap — and the only document listener is
// torn down with the open state.
// The box a popover has to live inside: the nearest scrolling ancestor, or the
// viewport when there is none.
function scrollParentRect(el) {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node.getBoundingClientRect();
  }
  return { top: 0, bottom: window.innerHeight };
}

export function Select({ value, options, onChange, ariaLabel }) {
  const normalized = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const btnRef = useRef(null);
  const rootRef = useRef(null);
  const uid = useId();
  const listboxId = `${uid}-listbox`;

  useEffect(() => {
    if (!open) return undefined;
    function onDocPointer(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    return () => document.removeEventListener("mousedown", onDocPointer);
  }, [open]);

  function openList() {
    const idx = Math.max(
      0,
      normalized.findIndex((o) => o.value === value)
    );
    // A row near the foot of a scrolling pane would have its list cropped by
    // the scroller, so measure once on open — against the scroller, not the
    // window — and flip upward when that is the roomier side.
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const clip = scrollParentRect(btnRef.current);
      const wanted = Math.min(260, normalized.length * 30 + 8) + 12;
      const below = clip.bottom - rect.bottom;
      setAbove(below < wanted && rect.top - clip.top > below);
    }
    setActiveIndex(idx);
    setOpen(true);
  }

  function commit(idx) {
    const opt = normalized[idx];
    if (opt) onChange?.(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  }

  function onButtonKeyDown(e) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(normalized.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(activeIndex);
    } else if (e.key === "Escape") {
      // Stop here: an open list is what Escape dismisses. Without this the
      // event reached the Dialog and shut the whole sheet in one keystroke.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const current = normalized.find((o) => o.value === value);

  return (
    <div className="hy-select" ref={rootRef}>
      <button
        type="button"
        ref={btnRef}
        className="hy-select__btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${uid}-opt-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        data-open={open || undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onButtonKeyDown}
      >
        <span className="hy-select__value">{current?.label ?? ""}</span>
        <i className="gb-icon gb-icon-chevron-down" aria-hidden="true" />
      </button>
      {open && (
        <ul
          id={listboxId}
          className={above ? "hy-select__listbox is-above" : "hy-select__listbox"}
          role="listbox"
        >
          {normalized.map((opt, i) => (
            <li
              key={opt.value}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={opt.value === value}
              className={i === activeIndex ? "hy-select__option is-active" : "hy-select__option"}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(i)}
            >
              <span className="hy-select__option-label">{opt.label}</span>
              {opt.value === value && (
                <i className="gb-icon gb-icon-check" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Toggle: iOS-style on/off switch (role="switch") — wide track, big white knob.
export function Toggle({ checked, onChange, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={checked ? "hy-toggle is-on" : "hy-toggle"}
      onClick={() => onChange?.(!checked)}
    >
      <span className="hy-toggle__thumb" />
    </button>
  );
}

// TextInput: single-line themed text field.
export function TextInput({ value, onChange, placeholder, ariaLabel, type = "text" }) {
  return (
    <input
      className="hy-input"
      type={type}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

// TextArea: multi-line themed text field.
export function TextArea({ value, onChange, placeholder, ariaLabel, rows = 3 }) {
  return (
    <textarea
      className="hy-textarea"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={rows}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

// Button: themed button. `variant` picks the weight (secondary/ghost/primary/
// danger), `shape` picks rounded (default) or pill.
export function Button({
  children,
  onClick,
  variant = "ghost",
  shape = "rounded",
  type = "button",
  disabled,
  ariaLabel,
}) {
  return (
    <button
      type={type}
      className={`hy-btn hy-btn--${variant} hy-btn--${shape}`}
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
