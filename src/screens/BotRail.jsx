import { useEffect, useMemo, useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";
import ColorWheel from "./ColorWheel.jsx";
import { COLORS, SHAPES, isCustomHex } from "../lib/marks.js";
import { botWorks } from "../lib/working.js";
import { pipOf } from "../lib/presence.js";
import { pluginPrettyName } from "../lib/plugin-icons.js";

const FALLBACK_PROFILES = [
  { name: "chat", tokens: 5100 },
  { name: "writer", tokens: 9800 },
  { name: "researcher", tokens: 11800 },
  { name: "builder", isDefault: true, tokens: 16600 },
  { name: "full", tokens: 24700 },
];

function tokenLabel(n) {
  if (!n) return "";
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

const REASON_OPTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

function profileLabel(name) {
  const n = String(name || "");
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : n;
}

function isBlockedComputerUseMcp(name) {
  const n = String(name || "").trim().toLowerCase();
  if (n === "cua" || n.startsWith("cua-") || n.endsWith("-cua")) return true;
  if (n.includes("open-computer") || n.includes("open_computer")) return true;
  if (n === "computer-use" || n === "computer_use") return true;
  return false;
}

function connectionRows(listed) {
  const rows = [];
  const seen = new Set();
  function add(id, name) {
    const key = String(id || "").trim();
    if (!key || seen.has(key) || isBlockedComputerUseMcp(key)) return;
    seen.add(key);
    rows.push({ id: key, name: name || key });
  }
  for (const s of listed.servers || []) add(s.id || s.name, s.name || s.id);
  for (const c of listed.catalog || []) {
    const installed = c.installed || c.enabled;
    const harvested = String(c.description || "").startsWith("Imported from");
    if (installed || harvested) add(c.id || c.name, c.name || c.id);
  }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return rows;
}

export default function BotRail({ agent, onChange, onClose, onOpenRoutines, onCreateRoutine, onOpenUndo }) {
  const name = agent?.name ?? "";
  const label = agent?.label ?? "";
  const description = agent?.description ?? "";
  const notifications = !!agent?.notifications;
  const [wheelOpen, setWheelOpen] = useState(false);
  const [profiles, setProfiles] = useState(FALLBACK_PROFILES);
  const [connections, setConnections] = useState([]);
  const [toolsets, setToolsets] = useState([]);
  const [abilitiesOpen, setAbilitiesOpen] = useState(false);
  const customOn = isCustomHex(agent?.blob);
  const pip = botWorks(agent, agent?.id) ? "work" : pipOf(agent);
  const todos = Array.isArray(agent?.todos) ? agent.todos : [];
  const profileTokens = profiles.find((p) => p.name === toolProfile)?.tokens || 0;
  const toolProfile = agent?.toolProfile || "builder";
  const reasoningEffort = agent?.reasoningEffort || "low";
  const pinnedMcp = useMemo(
    () => (Array.isArray(agent?.mcp) ? agent.mcp.map(String) : []),
    [agent?.mcp]
  );
  const extraToolsets = useMemo(
    () => (Array.isArray(agent?.toolsets) ? agent.toolsets.map(String) : []),
    [agent?.toolsets]
  );
  // What the chosen profile already covers, so the list can show those as
  // "on, and not yours to turn off here" rather than as unchecked.
  const inProfile = useMemo(() => {
    const hit = profiles.find((p) => p.name === toolProfile);
    return new Set(Array.isArray(hit?.toolsets) ? hit.toolsets.map(String) : []);
  }, [profiles, toolProfile]);

  useEffect(() => {
    let gone = false;
    Promise.resolve(window.hydo?.toolProfiles?.())
      .then((res) => {
        const list = Array.isArray(res?.profiles) ? res.profiles : [];
        if (!gone && list.length) setProfiles(list);
      })
      .catch(() => {});
    Promise.resolve(window.hydo?.listPlugins?.())
      .then((res) => {
        if (!gone) setConnections(connectionRows(res || {}));
      })
      .catch(() => {});
    Promise.resolve(window.hydo?.toolsets?.())
      .then((res) => {
        const list = Array.isArray(res?.toolsets) ? res.toolsets : [];
        if (!gone) setToolsets(list);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [agent?.id]);

  function toggleToolset(name, on) {
    const next = on
      ? [...new Set([...extraToolsets, name])]
      : extraToolsets.filter((x) => x !== name);
    onChange({ toolsets: next });
  }

  function toggleMcp(id, on) {
    const next = on
      ? [...new Set([...pinnedMcp, id].filter((x) => !isBlockedComputerUseMcp(x)))]
      : pinnedMcp.filter((x) => x !== id);
    onChange({ mcp: next });
  }

  return (
    <aside className="bot-rail" aria-label={agent?.name ? `${agent.name}` : "Bot"}>
      <header className="bot-rail__head">
        <button type="button" className="icon-btn" onClick={onClose} title="Back">
          <i className="gb-icon gb-icon-chevron-left" />
        </button>
        <span className="bot-rail__title">{name.trim() || "Bot"}</span>
        <button type="button" className="icon-btn" onClick={onClose} title="Close">
          <i className="gb-icon gb-icon-chevrons-right" />
        </button>
      </header>
      <span className="bot-rail__blob-wrap">
        <UmbraFace
          className="bot-rail__blob"
          tint={agent?.blob}
          shape={agent?.shape}
          size={72}
          morph
          live
          mood={botWorks(agent, agent?.id) ? "spin" : "fidget"}
          poke
        />
        {pip ? (
          <span
            className={`sand-row__dot bot-rail__online is-${pip}`}
            title={pip === "work" ? "Working" : "Online"}
            aria-label={pip === "work" ? "Working" : "Online"}
          />
        ) : null}
      </span>
      <label className="bot-rail__field">
        <span className="bot-rail__field-label">Name</span>
        <input value={name} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      <div className="bot-rail__field">
        <span className="bot-rail__field-label">Color</span>
        <div className="bot-rail__swatches" role="group" aria-label="Color">
          {COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={agent?.blob === c.id ? "swatch is-on" : "swatch"}
              title={c.label}
              aria-label={c.label}
              aria-pressed={agent?.blob === c.id}
              style={{ background: c.value }}
              onClick={() => {
                setWheelOpen(false);
                onChange({ blob: c.id });
              }}
            />
          ))}
          <button
            type="button"
            className={customOn || wheelOpen ? "swatch swatch--custom is-on" : "swatch swatch--custom"}
            title="Custom colour"
            aria-label="Custom colour"
            aria-pressed={customOn}
            aria-expanded={wheelOpen}
            onClick={() => setWheelOpen((open) => !open)}
          >
            <span
              className="swatch--custom-face"
              style={{
                background: customOn
                  ? agent.blob
                  : "conic-gradient(#e02d3c, #e4a11b, #2bb673, #3b82f0, #8b5cf0, #e0479b, #e02d3c)",
              }}
            />
          </button>
        </div>
        {wheelOpen ? (
          <ColorWheel
            value={customOn ? agent.blob : "#8B5CF0"}
            onChange={(hex) => onChange({ blob: hex })}
            onClose={() => setWheelOpen(false)}
          />
        ) : null}
      </div>
      <div className="bot-rail__field">
        <span className="bot-rail__field-label">Shape</span>
        <div className="bot-rail__swatches bot-rail__shapes" role="group" aria-label="Shape">
          {SHAPES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={agent?.shape === s.id ? "shape-pick is-on" : "shape-pick"}
              title={s.label}
              aria-label={s.label}
              aria-pressed={agent?.shape === s.id}
              onClick={() => onChange({ shape: s.id })}
            >
              <UmbraFace tint={agent?.blob || "gray"} shape={s.id} size={26} mood="idle" fit />
            </button>
          ))}
        </div>
      </div>
      <label className="bot-rail__field">
        <span className="bot-rail__field-label">Label (optional)</span>
        <input
          value={label}
          placeholder="Research, marketing, admin"
          onChange={(e) => onChange({ label: e.target.value })}
        />
      </label>
      <label className="bot-rail__field">
        <span className="bot-rail__field-label">Description</span>
        <textarea
          value={description}
          placeholder="What this Bot is for"
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </label>
      <label className="bot-rail__field">
        <span className="bot-rail__field-label">Tools</span>
        <select
          value={toolProfile}
          aria-label="Tools"
          onChange={(e) => onChange({ toolProfile: e.target.value })}
        >
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {profileLabel(p.name)}
              {p.tokens ? ` — ${tokenLabel(p.tokens)}/turn` : ""}
            </option>
          ))}
        </select>
        {/* The recurring cost of this choice, made visible. It was invisible,
            so every bot sat on the default forever. The second line is the one
            that matters on a job that fans out: workers inherit this. */}
        {profileTokens ? (
          <p className="bot-rail__cost">
            ~{tokenLabel(profileTokens)} tokens every turn
            {extraToolsets.length ? `, plus ${extraToolsets.length} extra` : ""}.
            {profileTokens > 12000
              ? " Each delegated worker inherits it too."
              : ""}
          </p>
        ) : null}
      </label>
      <label className="bot-rail__field">
        <span className="bot-rail__field-label">Reason</span>
        <select
          value={REASON_OPTS.some((o) => o.value === reasoningEffort) ? reasoningEffort : "low"}
          aria-label="Reason"
          onChange={(e) => onChange({ reasoningEffort: e.target.value })}
        >
          {REASON_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {todos.length ? (
        <div className="bot-rail__field">
          <span className="bot-rail__field-label">Plan</span>
          {/* The bot's own todo list, mirrored off the tool stream. Read only:
              it is the model's working plan, and editing it here would put a
              second author on a list it re-reads as its own. */}
          <ul className="bot-rail__plan">
            {todos.map((t, i) => (
              <li key={t.id || i} className={`bot-rail__plan-item is-${t.status}`}>
                <span className="bot-rail__plan-dot" aria-hidden="true" />
                <span>{t.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="bot-rail__field">
        <button
          type="button"
          className="bot-rail__disclose"
          aria-expanded={abilitiesOpen}
          onClick={() => setAbilitiesOpen((v) => !v)}
        >
          <span className="bot-rail__field-label">Abilities</span>
          <span className="bot-rail__disclose-meta">
            {extraToolsets.length ? `+${extraToolsets.length}` : "Profile only"}
          </span>
          <i className={`gb-icon gb-icon-chevron-${abilitiesOpen ? "down" : "right"}`} />
        </button>
        {abilitiesOpen ? (
          toolsets.length === 0 ? (
            <p className="bot-rail__hint mute">
              Hermes is not answering, so its toolsets cannot be listed.
            </p>
          ) : (
            <>
              <p className="bot-rail__hint mute">
                Extra Hermes toolsets on top of {profileLabel(toolProfile)}. Each one costs
                context on every turn.
              </p>
              <div className="bot-rail__checks" role="group" aria-label="Abilities">
                {toolsets.map((t) => {
                  const covered = inProfile.has(t.name);
                  const on = covered || extraToolsets.includes(t.name);
                  return (
                    <label
                      key={t.name}
                      className={on ? "bot-rail__check is-on" : "bot-rail__check"}
                      title={t.description || t.name}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={covered}
                        onChange={(e) => toggleToolset(t.name, e.target.checked)}
                      />
                      <span>{t.name}</span>
                      <span className="bot-rail__check-meta">
                        {covered ? profileLabel(toolProfile) : t.toolCount || ""}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )
        ) : null}
      </div>
      <div className="bot-rail__field">
        <span className="bot-rail__field-label">Connections</span>
        {connections.length === 0 ? (
          <p className="bot-rail__hint mute">Add apps in Plugins.</p>
        ) : (
          <div className="bot-rail__checks" role="group" aria-label="Connections">
            {connections.map((c) => {
              const on = pinnedMcp.includes(c.id);
              return (
                <label key={c.id} className={on ? "bot-rail__check is-on" : "bot-rail__check"}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggleMcp(c.id, e.target.checked)}
                  />
                  <span>{pluginPrettyName(c)}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
      <div className="bot-rail__notify">
        <div>
          <span className="bot-rail__notify-title">Notifications</span>
          <p>Get notified when this Bot finishes or needs input</p>
        </div>
        <button
          type="button"
          className={notifications ? "bot-rail__toggle is-on" : "bot-rail__toggle"}
          role="switch"
          aria-checked={notifications}
          aria-label="Notifications"
          onClick={() => onChange({ notifications: !notifications })}
        />
      </div>
      <div className="bot-rail__routines">
        <button type="button" className="bot-rail__routines-open" onClick={onOpenUndo}>
          <span className="bot-rail__notify-title">Undo</span>
          <i className="gb-icon gb-icon-chevron-right" />
        </button>
        <p>Put back files this Bot changed on your disk.</p>
      </div>
      <div className="bot-rail__workspace">
        <button
          type="button"
          className="ghost ghost--solid"
          onClick={() => window.hydo?.openWorkspace?.(agent?.id)}
        >
          Open workspace
        </button>
      </div>
      <div className="bot-rail__routines">
        <button type="button" className="bot-rail__routines-open" onClick={onOpenRoutines}>
          <span className="bot-rail__notify-title">Routines</span>
          <i className="gb-icon gb-icon-chevron-right" />
        </button>
        <p>Routines are recurring tasks this Bot runs on a schedule.</p>
        <button type="button" className="ghost ghost--solid" onClick={onCreateRoutine}>
          Create Routine
        </button>
      </div>
    </aside>
  );
}
