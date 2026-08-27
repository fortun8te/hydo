import UmbraFace from "../umbra/UmbraFace.jsx";

export const MAX_MEMBERS = 6;

export default function ChannelRail({ channel, agents, onChange, onClose, onToggleMember }) {
  const members = channel?.members || [];
  const full = members.length >= MAX_MEMBERS;

  return (
    <aside className="bot-rail" aria-label={channel?.name ? `${channel.name} channel settings` : "Channel settings"}>
      <header className="bot-rail__head">
        <button type="button" className="icon-btn" onClick={onClose} title="Back">
          <i className="gb-icon gb-icon-chevron-left" />
        </button>
        <span className="bot-rail__title">Channel</span>
        <button type="button" className="icon-btn" onClick={onClose} title="Close">
          <i className="gb-icon gb-icon-chevrons-right" />
        </button>
      </header>

      <label className="bot-rail__field">
        <span className="bot-rail__field-label">Name</span>
        <input
          value={channel?.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>

      <label className="bot-rail__field">
        <span className="bot-rail__field-label">Purpose</span>
        <textarea
          value={channel?.description ?? ""}
          placeholder="What this channel is for"
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </label>

      <div className="bot-rail__field">
        <span className="bot-rail__field-label">
          Members{" "}
          <span className="bot-rail__count mute">
            {members.length}/{MAX_MEMBERS}
          </span>
        </span>
        <p className="bot-rail__hint mute">
          Every message here goes to every member. Each one takes its own turn, with its own tools.
          They&apos;re told to stay quiet when they have nothing to add.
        </p>
        <div className="sand-members">
          {agents.length === 0 && <p className="mute">No bots yet. Make one first.</p>}
          {agents.map((a) => {
            const on = members.includes(a.id);
            const locked = !on && full;
            return (
              <button
                key={a.id}
                type="button"
                className={on ? "sand-member is-on" : "sand-member"}
                disabled={locked}
                aria-pressed={on}
                title={locked ? `A channel holds up to ${MAX_MEMBERS}` : a.name}
                onClick={() => onToggleMember(a.id)}
              >
                <UmbraFace tint={a.blob} shape={a.shape} size={28} />
                <span className="sand-member__body">
                  <span className="sand-member__name">{a.name}</span>
                  {a.label ? <span className="sand-member__label">{a.label}</span> : null}
                </span>
                <span className="sand-member__aff" aria-hidden="true">
                  <i className={`gb-icon ${on ? "gb-icon-check-circle" : "gb-icon-plus"}`} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
