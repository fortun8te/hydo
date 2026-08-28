export default function AccountMenu({
  userName,
  onSettings,
  onUpdate,
  // Commits the running build does not have, as the MAIN process counted them
  // (electron/build-info.cjs, `git rev-list --count sha..HEAD`). 0 or absent
  // means the row is plain: no badge, no colour, no claim. There is no third
  // state to render here — "unknown" reaches this component as 0 on purpose,
  // because a menu row that hints at an update it cannot prove is exactly the
  // confident-wrong-status bug the Updates pane was built to avoid.
  updateBehind,
  onAbout,
  onHelp,
  onFeedback,
  onSignOut,
  onClose,
}) {
  const behind = Number(updateBehind) || 0;
  function pick(fn) {
    fn?.();
    onClose?.();
  }

  return (
    <>
      <div className="account-menu__backdrop" onClick={onClose} />
      <div className="account-menu" role="menu" aria-label={userName || "Account"}>
        <button
          type="button"
          className="account-menu__item"
          role="menuitem"
          onClick={() => pick(onSettings)}
        >
          <i className="gb-icon gb-icon-settings-gear" />
          Settings
        </button>
        {/* Updating without opening Settings first. Same shape as every other
            row here — <button className="account-menu__item">, an icon, a
            label — because a row that renders differently from its neighbours
            reads as a different kind of thing. The only addition is the meta
            slot on the right, which is the existing .account-menu__meta the
            sidebar already styles. */}
        <button
          type="button"
          className="account-menu__item"
          role="menuitem"
          onClick={() => pick(onUpdate)}
        >
          <i className="gb-icon gb-icon-arrow-circle-down" />
          Software Update
          {behind > 0 ? (
            <span className="account-menu__meta account-menu__meta--update">
              {behind} new
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className="account-menu__item"
          role="menuitem"
          onClick={() => pick(onAbout)}
        >
          <i className="gb-icon gb-icon-i-circle" />
          About
        </button>
        <button
          type="button"
          className="account-menu__item"
          role="menuitem"
          onClick={() => pick(onHelp)}
        >
          <i className="gb-icon gb-icon-question-circle" />
          Help Center
        </button>
        <button
          type="button"
          className="account-menu__item"
          role="menuitem"
          onClick={() => pick(onFeedback)}
        >
          <i className="gb-icon gb-icon-chat-bubble" />
          Send Feedback
        </button>
        <div className="account-menu__sep" />
        <button
          type="button"
          className="account-menu__item"
          role="menuitem"
          onClick={() => pick(onSignOut)}
        >
          {/* REASONED (not measured): the kit has no literal "sign-out" or
              "door" glyph (checked src/kit/icons.css). arrow-bracket-from-right
              is an arrow leaving a bracket frame — the standard exit mark —
              rather than gb-icon-arrow-right, a plain forward arrow that reads
              as "go forward" and was the reference complaint. VERIFIED the
              class has a matching rule (icons.css:19, content \F359) so this
              isn't the empty-glyph bug. */}
          <i className="gb-icon gb-icon-arrow-bracket-from-right" />
          Log out
        </button>
      </div>
    </>
  );
}
