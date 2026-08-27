import { useEffect, useRef, useState } from "react";
import { initialOf } from "../lib/marks.js";
import { fileToAvatar } from "../lib/avatar.js";
import { Dialog, DialogNav, SectionLabel, RowGroup, Row, Select, Button } from "../kit/ui.jsx";

const PANES = [
  { id: "general", label: "General", icon: "settings-gear" },
  { id: "usage", label: "Usage", icon: "chart-bars" },
  { id: "updates", label: "Updates", icon: "cloud-arrow-down" },
];

const MUSE_CHAT = "muse-spark-1.2-contributor";
const DEFAULT_CHAT = "grok-4.6";
const DEFAULT_PROVIDER = "xai-oauth";
const BANNED_CHAT = /ox-alpha|stealth/i;
const MODEL_LABELS = {
  "muse-spark-1.2-contributor": "Muse Spark 1.2 contributor",
  "grok-4.6": "grok-4.6",
  "grok-4.5": "grok-4.5",
};

// Light was missing, not unsupported: `src/kit/tokens.css` has shipped a full
// `cursor-light` palette from the start. Dark stays the default.
const THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "Follow System" },
];

const ACCENT_OPTIONS = ["Black", "Blue", "Purple"];
const LANGUAGE_OPTIONS = ["Follow System", "English"];

function detectedZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Two overlapping rounded rects. The icon font has no copy glyph, and an
// emoji would sit at the wrong weight next to 13px secondary text.
function CopyGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <rect x="5.6" y="2.6" width="7.8" height="9.3" rx="2.1" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10.4 13.4H5.1a2.5 2.5 0 0 1-2.5-2.5V5.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// The account row: photo (letter tile only as the fallback), name over the
// address with a copy button beside it, and the Sign Out pill hard right —
// one row, the way Grok Bot does it, not three stacked ones.
function UsageMeter({ usage }) {
  const session = usage && usage.session;
  const breakdown = usage && usage.breakdown;
  const pct =
    typeof (usage && usage.contextPercent) === "number"
      ? usage.contextPercent
      : typeof (session && session.context_percent) === "number"
        ? session.context_percent
        : null;
  const used = session && session.context_used;
  const max = session && session.context_max;
  const model = (session && session.model) || (breakdown && breakdown.model) || "";
  const compressions = session && session.compressions;
  const width = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const desc =
    pct == null
      ? usage && usage.available === false
        ? usage.reason || "Hermes is not measuring this yet."
        : "Take a turn and Hermes will report the window."
      : [
          used != null && max != null ? `${used} / ${max} tokens` : null,
          model,
          compressions ? `${compressions} compressions` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <>
      <RowGroup>
        <Row strong label="Context window" description={desc}>
          <span className="settings__pct">{pct == null ? "—" : `${Math.round(pct)}%`}</span>
        </Row>
      </RowGroup>
      <div className="settings__meter">
        <div className="settings__meter-fill" style={{ width: `${width}%` }} />
      </div>
      <p className="settings__note">
        Hermes compacts history automatically in a turn, and Hydo asks it to compress between turns at 70%. This is the
        model window, not a Hydo plan meter.
      </p>
    </>
  );
}

function AccountRow({ name, email, avatarUrl, onSignOut, onAvatar }) {
  const [copied, setCopied] = useState(false);
  const [avatarErr, setAvatarErr] = useState("");
  const fileRef = useRef(null);

  function copy() {
    if (!email) return;
    navigator.clipboard?.writeText(email);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function choose(file) {
    if (!file) return;
    setAvatarErr("");
    try {
      onAvatar(await fileToAvatar(file));
    } catch (err) {
      // Say which picture and why. "Something went wrong" sends someone back
      // to try the same file again.
      setAvatarErr(err.message || "could not read that image");
    }
  }

  // The avatar IS the control. A separate "Change picture" row would be a
  // second thing to find for something everyone already knows how to do.
  const avatar = (
    <>
      <button
        type="button"
        className="settings__avatar settings__avatar--edit"
        title={avatarUrl ? "Change picture" : "Add a picture"}
        aria-label={avatarUrl ? "Change picture" : "Add a picture"}
        onClick={() => fileRef.current?.click()}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="settings__avatar-img" />
        ) : (
          <span className="settings__avatar-initial">{initialOf(name)}</span>
        )}
        <span className="settings__avatar-hint" aria-hidden="true">
          <i className="gb-icon gb-icon-camera" />
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        hidden
        onChange={(e) => {
          choose(e.target.files && e.target.files[0]);
          e.target.value = "";
        }}
      />
    </>
  );

  return (
    <Row
      strong
      leading={avatar}
      label={name || "Michael"}
      description={avatarErr || email || "Local Hydo sign-in (not a hosted account)"}
      descriptionAction={
        email ? (
          <button
            type="button"
            className="settings__copy"
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy email address"}
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? <i className="gb-icon gb-icon-check" aria-hidden="true" /> : <CopyGlyph />}
          </button>
        ) : null
      }
    >
      <Button variant="secondary" shape="pill" onClick={onSignOut}>
        Sign Out
      </Button>
    </Row>
  );
}

function chatModelOf(settings) {
  const m = String((settings && settings.model) || "").trim();
  if (!m || BANNED_CHAT.test(m)) return DEFAULT_CHAT;
  return m;
}

function modelSelectOptions(current, ids) {
  const out = [];
  const seen = new Set();
  function add(id) {
    const v = String(id || "").trim();
    if (!v || BANNED_CHAT.test(v) || seen.has(v)) return;
    seen.add(v);
    out.push({ value: v, label: MODEL_LABELS[v] || v });
  }
  add(DEFAULT_CHAT);
  add(MUSE_CHAT);
  add(current);
  for (const id of Array.isArray(ids) ? ids : []) add(id);
  return out;
}

// `accountName` is resolved by Shell, which owns the one definition of the
// account holder's full name — the sidebar's account row and this dialog's
// account row must not disagree about who is signed in. Falls back to the
// stored `userName` so Settings rendered on its own still shows something.
export default function Settings({
  settings,
  accountName,
  selectedId,
  selectedKind,
  members,
  onClose,
  onChange,
  onSignOut,
}) {
  const pane = settings._pane || "general";
  const appearance = settings.appearance || "dark";
  const accent = settings.accent || "Black";
  const language = settings.language || "Follow System";
  const timezone = settings.timezone || "auto";
  const zone = detectedZone();
  const [usage, setUsage] = useState(null);
  const [modelOpts, setModelOpts] = useState([]);
  const title = PANES.find((item) => item.id === pane)?.label || "General";
  const chatModel = chatModelOf(settings);

  useEffect(() => {
    const raw = String(settings.model || "").trim();
    if (raw === DEFAULT_CHAT) return undefined;
    if (raw && !BANNED_CHAT.test(raw)) return undefined;
    onChange?.({ model: DEFAULT_CHAT, provider: DEFAULT_PROVIDER });
    return undefined;
  }, [settings.model]);

  useEffect(() => {
    if (pane !== "usage") return undefined;
    let gone = false;
    const load = window.hydo?.usage;
    if (typeof load !== "function") return undefined;
    // session.usage is per-bot. A selected channel id is not a Hermes session.
    const agentId = selectedKind === "channel" ? (Array.isArray(members) && members[0]) || undefined : selectedId;
    Promise.resolve(load(agentId))
      .then((res) => {
        if (!gone) setUsage(res);
      })
      .catch(() => {
        if (!gone) setUsage({ available: false, reason: "Could not read Hermes usage" });
      });
    return () => {
      gone = true;
    };
  }, [pane, selectedId, selectedKind, members]);

  useEffect(() => {
    const load = window.hydo?.listModels;
    if (typeof load !== "function") return undefined;
    let gone = false;
    Promise.resolve(load(selectedId))
      .then((res) => {
        if (gone) return;
        const payload = res && res.ok === false ? null : res && res.providers ? res : res && res.result;
        const providers = (payload && payload.providers) || (res && res.providers) || [];
        const ids = [];
        for (const p of providers) {
          for (const m of p.models || []) {
            const id = typeof m === "string" ? m : m.id || m.name;
            if (id) ids.push(id);
          }
        }
        setModelOpts([...new Set(ids)]);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [selectedId]);

  return (
    <Dialog label="Settings" onClose={onClose}>
      <DialogNav
        items={PANES}
        activeId={pane}
        onSelect={(id) => onChange({ _pane: id })}
        ariaLabel="Settings sections"
      />

      <section className="settings__panel">
        <button type="button" className="settings__close" onClick={onClose} aria-label="Close settings">
          <i className="gb-icon gb-icon-remove-close" aria-hidden="true" />
        </button>

        <header className="settings__head">
          <h2>{title}</h2>
        </header>

        <div className="settings__scroll">
          <div className="settings__body">
            {/* One card, not five.
                General used to be a stack of labelled RowGroups — Account,
                Appearance, Models, Bot — each its own rounded fill with a
                heading above it, so the pane read as a pile of separate
                objects you had to re-orient inside of every time. The
                reference is a single container: every setting is one row, and
                a 1px hairline inset from the container's edges is all that
                separates them. The rows are still in the same order, so the
                grouping survives as adjacency instead of as chrome. */}
            {pane === "general" && (
              <section className="settings__section">
                <RowGroup>
                  <AccountRow
                    name={accountName || settings.userName}
                    email={settings.userEmail}
                    avatarUrl={settings.userAvatar}
                    onSignOut={onSignOut}
                    onAvatar={(userAvatar) => onChange({ userAvatar })}
                  />
                  <Row divided label="Theme">
                    <Select
                      ariaLabel="Theme"
                      value={appearance}
                      options={THEME_OPTIONS}
                      onChange={(v) => onChange({ appearance: v })}
                    />
                  </Row>
                  <Row divided label="Accent">
                    <Select
                      ariaLabel="Accent"
                      value={accent}
                      options={ACCENT_OPTIONS}
                      onChange={(v) => onChange({ accent: v })}
                    />
                  </Row>
                  <Row divided label="Language">
                    <Select
                      ariaLabel="Language"
                      value={language}
                      options={LANGUAGE_OPTIONS}
                      onChange={(v) => onChange({ language: v })}
                    />
                  </Row>
                  <Row divided label="Chat model" description="Hermes uses this for turns. Default is grok-4.6.">
                    <Select
                      ariaLabel="Chat model"
                      value={chatModel}
                      options={modelSelectOptions(chatModel, modelOpts)}
                      onChange={(v) => {
                        const patch = { model: v };
                        if (/muse/i.test(v)) patch.provider = "meta-ai";
                        else if (/grok/i.test(v)) patch.provider = "xai-oauth";
                        onChange(patch);
                      }}
                    />
                  </Row>
                  <Row
                    divided
                    label="Coding harness"
                    description="Heavy coding goes here. The working row says Connecting to this when it runs."
                  >
                    <Select
                      ariaLabel="Coding harness"
                      value={settings.codingHarness || "grok-build"}
                      options={[
                        { value: "grok-build", label: "Grok Build" },
                        { value: "opencode", label: "OpenCode" },
                        { value: "cursor", label: "Cursor" },
                        { value: "shell", label: "Workspace shell" },
                      ]}
                      onChange={(v) => onChange({ codingHarness: v })}
                    />
                  </Row>
                  <Row
                    divided
                    label="Coding / Grok Build"
                    description="Model flag for grok -p when the harness is Grok Build."
                  >
                    <Select
                      ariaLabel="Coding model"
                      value={settings.codingModel || ""}
                      options={[
                        { value: "", label: "Same as chat" },
                        { value: "grok-4.6", label: "grok-4.6" },
                        { value: "grok-4.5", label: "grok-4.5" },
                        ...modelSelectOptions(settings.codingModel, modelOpts).filter(
                          (o) => o.value && o.value !== "grok-4.6" && o.value !== "grok-4.5",
                        ),
                      ]}
                      onChange={(v) => onChange({ codingModel: v })}
                    />
                  </Row>
                  <Row divided label="Timezone" description="Bots use this timezone for routines and scheduled work.">
                    <Select
                      ariaLabel="Timezone"
                      value={timezone}
                      options={[{ value: "auto", label: `Auto-detect (${zone})` }]}
                      onChange={(v) => onChange({ timezone: v })}
                    />
                  </Row>
                </RowGroup>
              </section>
            )}

            {pane === "usage" && (
              <>
                <section className="settings__section">
                  <SectionLabel>This teammate</SectionLabel>
                  <UsageMeter usage={usage} />
                  <p className="settings__note">
                    Hydo does not bill. There is no plan meter — only this Hermes context window.
                  </p>
                </section>
              </>
            )}

            {pane === "updates" && (
              <section className="settings__section">
                <SectionLabel>Version</SectionLabel>
                <RowGroup>
                  <Row
                    strong
                    label="Build 2026.08.26.2"
                    description="Hydo is current. There is no auto-updater — builds ship by hand."
                  >
                    <span className="settings__pct">Up to date</span>
                  </Row>
                </RowGroup>
              </section>
            )}
          </div>
        </div>
      </section>
    </Dialog>
  );
}
