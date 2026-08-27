import { useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";

// The card a teammate drops into a thread when it wants you to pick instead of
// guessing — Grok Bot's "What do I tell her?" card. A title, a quiet
// reassurance line, the options as one hairline-divided list, and a free-text
// escape hatch below.
//
// The same card serves `kind:'clarify'`, where the teammate is asking a
// question mid-turn: pass `sub`, `speaker`, `requireCustom` and the resolved
// `answer`. It is a question from the bot, so it sits on the bot's side of the
// conversation — left-aligned, flush with a bot bubble — never centred.
export default function ChoiceCard({
  title,
  choices,
  picked,
  sub,
  speaker,
  answer,
  resolved: resolvedProp,
  requireCustom,
  onPick,
  onCustom,
  onDismiss,
}) {
  const [draft, setDraft] = useState("");
  const list = Array.isArray(choices) ? choices.filter((c) => c && c.id != null) : [];
  const resolved = resolvedProp != null ? !!resolvedProp : picked != null;
  const heading = title || "Send that?";
  const explainer =
    sub || "I won’t send anything until you pick. Type your own reply if none of these is right.";

  function submitCustom() {
    const text = draft.trim();
    if (!text) return;
    onCustom?.(text);
    setDraft("");
  }

  function onInputKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitCustom();
    } else if (e.key === "Escape" && onDismiss) {
      e.preventDefault();
      onDismiss();
    }
  }

  return (
    <div className={resolved ? "hy-choice hy-choice--resolved" : "hy-choice"}>
      <div className="hy-choice__head">
        <div className="hy-choice__title">
          {speaker ? (
            <UmbraFace
              tint={speaker.blob}
              shape={speaker.shape}
              size={18}
              className="hy-choice__face"
            />
          ) : null}
          {heading}
        </div>
        {onDismiss ? (
          <button
            type="button"
            className="hy-choice__close"
            onClick={onDismiss}
            title="Dismiss"
            aria-label="Dismiss"
          >
            <i className="gb-icon gb-icon-remove-close" />
          </button>
        ) : null}
      </div>

      <p className="hy-choice__sub">{explainer}</p>

      {list.length ? (
        <div className="hy-choice__list" role="radiogroup" aria-label={heading}>
          {list.map((c) => {
            const on = picked === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={on ? "hy-choice__row is-on" : "hy-choice__row"}
                disabled={resolved}
                onClick={() => {
                  if (!resolved) onPick?.(c.id);
                }}
              >
                <span className="hy-choice__badge">{c.id}</span>
                <span className="hy-choice__text">{c.text}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {resolved && answer ? (
        <div className="hy-choice__answer" role="status">
          {answer}
        </div>
      ) : (
        <input
          type="text"
          className="hy-choice__input"
          placeholder={requireCustom && !list.length ? "Type your answer" : "Type your own answer"}
          value={draft}
          disabled={resolved}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onInputKeyDown}
        />
      )}
    </div>
  );
}
