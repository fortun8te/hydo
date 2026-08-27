import { useEffect, useRef } from "react";

/**
 * The destructive-action confirm.
 *
 * Deleting a teammate used to happen the instant you released the mouse on a
 * context-menu item, taking the whole transcript with it and with no undo
 * anywhere in the store. The reference app puts a modal in the way, and the
 * modal's shape is the point: the safe choice is on top and neutral, the
 * destructive one is below it and red, both full width.
 *
 * Escape and the backdrop both cancel. Focus lands on Cancel, not Delete, so a
 * stray Return does nothing.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <>
      <div className="confirm__backdrop" onClick={onCancel} />
      <div className="confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2 className="confirm__title">{title}</h2>
        {body ? <p className="confirm__body">{body}</p> : null}
        <button type="button" className="confirm__btn" ref={cancelRef} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? "confirm__btn confirm__btn--danger" : "confirm__btn"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </>
  );
}
