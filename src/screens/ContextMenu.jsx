import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

function strokeIcon(d, extra) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {extra}
    </svg>
  );
}

const CTX_ICONS = {
  "map-pin": () =>
    strokeIcon(
      "M12 21s7-5.4 7-11.2A7 7 0 0 0 5 9.8C5 15.6 12 21 12 21Z",
      <circle cx="12" cy="9.6" r="1.7" fill="currentColor" stroke="none" />
    ),
  "pin-slash": () =>
    strokeIcon("M12 21s7-5.4 7-11.2A7 7 0 0 0 5 9.8C5 15.6 12 21 12 21ZM5 5l14 14"),
  folder: () => strokeIcon("M4 7.5h5.2l1.6 1.8H20v9.2H4V7.5Z"),
  "folder-plus": () =>
    strokeIcon("M4 7.5h5.2l1.6 1.8H20v9.2H4V7.5Z M16.2 13.6h-4.4M14 11.4v4.4"),
  check: () =>
    strokeIcon("M5.2 12.2 9.6 16.4 18.8 7.4"),
  "chevron-right": () =>
    strokeIcon("M9.2 6.4 15.6 12 9.2 17.6"),
  "bell-dot": () =>
    strokeIcon("M6.8 9.4a5.2 5.2 0 0 1 10.4 0c0 4 1.3 5.2 1.3 5.2H5.5s1.3-1.2 1.3-5.2ZM10 17.8a2 2 0 0 0 4 0"),
  "pencil-square": () =>
    strokeIcon("M5 7.2h9.2A1.8 1.8 0 0 1 16 9v10.2H5V7.2Z M9.2 16.4 19 6.6l1.6 1.6-9.8 9.8H9.2v-1.6Z"),
  "squares-plus": () =>
    strokeIcon("M8 9.2h10.2V19.5H8V9.2Z M5.8 15.2V6.2H15 M12.4 12.6v3.8M10.5 14.5h3.8"),
  "brackets-square": () =>
    strokeIcon("M8.2 5.5H6.2v13h2M15.8 5.5h2v13h-2"),
  "eye-slash": () =>
    strokeIcon("M4 12s3.2-5.4 8-5.4 8 5.4 8 5.4-3.2 5.4-8 5.4S4 12 4 12Z M9.2 9.2 14.8 14.8 M4.5 4.5l15 15"),
  "x-circle": () =>
    strokeIcon("M12 4.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15Z M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"),
  trash: () => strokeIcon("M6 8h12M9.5 8V6.5h5V8M8 8l.6 11h6.8L16 8M10 11v5M14 11v5"),
};

function CtxIcon({ name }) {
  const Draw = CTX_ICONS[name];
  if (Draw) {
    return (
      <span className="ctx__icon" aria-hidden="true">
        <Draw />
      </span>
    );
  }
  return <i className={`gb-icon gb-icon-${name} ctx__icon`} aria-hidden="true" />;
}

// items: [{ id, label, onClick, icon?, danger?, separatorBefore? }]
// `icon` is a named glyph (custom SVG) or a gb-icon-* suffix.
// `danger` colours the row (label + icon) with the danger token.
// `separatorBefore` draws a hairline above that row.
export default function ContextMenu({ x, y, items, onClose }) {
  const safeItems = Array.isArray(items) ? items : null;
  const hasItems = !!safeItems && safeItems.length > 0;

  const cardRef = useRef(null);
  const [pos, setPos] = useState({ left: x ?? 0, top: y ?? 0, ready: false });
  const [activeIndex, setActiveIndex] = useState(-1);

  // Measure the rendered card, then flip/clamp so it always stays fully
  // on screen instead of overflowing past the window edge.
  useLayoutEffect(() => {
    if (!hasItems) return;
    const el = cardRef.current;
    if (!el) return;
    const margin = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x ?? 0;
    let top = y ?? 0;
    if (left + w + margin > vw) left = (x ?? 0) - w;
    if (top + h + margin > vh) top = (y ?? 0) - h;
    left = Math.min(Math.max(margin, left), Math.max(margin, vw - w - margin));
    top = Math.min(Math.max(margin, top), Math.max(margin, vh - h - margin));

    setPos({ left, top, ready: true });
    el.focus();
  }, [x, y, hasItems]);

  // Close on scroll (capture, since scroll doesn't bubble) and on window blur.
  useEffect(() => {
    if (!hasItems) return;
    function handleScroll() {
      onClose?.();
    }
    function handleBlur() {
      onClose?.();
    }
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, [hasItems, onClose]);

  if (!hasItems) return null;

  function runItem(item) {
    if (item?.submenu?.length) return;
    item?.onClick?.();
    onClose?.();
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % safeItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? safeItems.length - 1 : i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) runItem(safeItems[activeIndex]);
    }
  }

  return (
    <div className="ctx">
      <button type="button" className="ctx__scrim" aria-label="Close" onClick={onClose} />
      <div
        ref={cardRef}
        className="ctx__card"
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
        role="menu"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        aria-activedescendant={
          activeIndex >= 0 ? `ctx-item-${safeItems[activeIndex]?.id}` : undefined
        }
      >
        {safeItems.map((item, i) => (
          <Fragment key={item?.id ?? i}>
            {item?.separatorBefore && <div className="ctx__sep" role="separator" />}
            <div
              className="ctx__wrap"
              onMouseEnter={() => setActiveIndex(i)}
            >
              <button
                id={`ctx-item-${item?.id}`}
                type="button"
                className={
                  "ctx__item" +
                  (item?.danger ? " ctx__item--danger" : "") +
                  (i === activeIndex ? " is-active" : "")
                }
                role="menuitem"
                aria-haspopup={item?.submenu?.length ? "menu" : undefined}
                tabIndex={-1}
                onClick={() => runItem(item)}
              >
                {item?.icon ? <CtxIcon name={item.icon} /> : null}
                <span className="ctx__label">{item?.label}</span>
                {item?.submenu?.length ? <CtxIcon name="chevron-right" /> : null}
              </button>
              {item?.submenu?.length && i === activeIndex ? (
                <div className="ctx__flyout" role="menu">
                  {item.submenu.map((sub, si) => (
                    <Fragment key={sub?.id ?? si}>
                      {sub?.separatorBefore && <div className="ctx__sep" role="separator" />}
                      <button
                        type="button"
                        className={"ctx__item" + (sub?.danger ? " ctx__item--danger" : "")}
                        role="menuitem"
                        onClick={() => {
                          sub?.onClick?.();
                          onClose?.();
                        }}
                      >
                        {sub?.checked ? <CtxIcon name="check" /> : sub?.icon ? <CtxIcon name={sub.icon} /> : null}
                        <span className="ctx__label">{sub?.label}</span>
                      </button>
                    </Fragment>
                  ))}
                </div>
              ) : null}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
