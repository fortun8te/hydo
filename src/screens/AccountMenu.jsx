export default function AccountMenu({
  userName,
  onSettings,
  onAbout,
  onHelp,
  onFeedback,
  onSignOut,
  onClose,
}) {
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
          <i className="gb-icon gb-icon-arrow-right" />
          Log out
        </button>
      </div>
    </>
  );
}
