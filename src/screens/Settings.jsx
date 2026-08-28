import { useEffect, useRef, useState } from "react";
import { initialOf } from "../lib/marks.js";
import { fileToAvatar } from "../lib/avatar.js";
import { Dialog, DialogNav, SectionLabel, RowGroup, Row, Select, Button, TextInput } from "../kit/ui.jsx";
// Reused rather than a third viewer: MediaViewer already knows how to show a
// single image at its natural size ("never blown up past its natural size"
// in richcontent.css), which is exactly right for a 256px avatar data URI —
// blowing it up to fill the screen would just show the JPEG blur bigger.
import { MediaViewer } from "./RichContent.jsx";

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

// The version, spelled out from what the main process measured. Every branch
// here exists because the field it reads can legitimately be null: a bundle
// built on a machine without git has no commit count, and a dev run has no
// build timestamp at all. None of them may render an empty "( )".
function buildLabel(info) {
  if (!info) return "Reading build…";
  const bits = [];
  if (info.build != null) bits.push(`build ${info.build}`);
  if (info.shortSha) bits.push(info.shortSha);
  if (!bits.length) bits.push("build unknown");
  if (info.dirty) bits.push("uncommitted changes");
  return `${info.version} (${bits.join(" · ")})`;
}

// One sentence, and it must be true of THIS process. `channel === "dev"` comes
// from app.isPackaged in the main process, so a vite run can never claim to be
// a release just because a stamp from last week's pack sits beside it.
function buildDesc(info, check) {
  if (!info) return "Asking the main process what this build is.";
  if (info.channel === "dev") {
    return "Running from source with vite — this is not a release build. Rebuild and install writes a packaged Hydo.app to /Applications.";
  }
  const when = info.builtAt ? new Date(info.builtAt).toLocaleString() : null;
  const built = when ? `Packaged ${when}.` : "Packaged build.";
  if (!check) return built;
  if (check.state === "behind") {
    return `${built} The working copy at ${info.repo} is ${check.behind} commit${check.behind === 1 ? "" : "s"} ahead of it.`;
  }
  if (check.state === "dirty") return `${built} It matches the working copy's HEAD, which has uncommitted changes.`;
  if (check.state === "current") return `${built} It matches the working copy's HEAD exactly.`;
  return `${built} ${check.reason || "The working copy could not be compared."}`;
}

// The pill on the right. "Up to date" was hardcoded and therefore always said
// that; this one can say four other things.
function buildPill(info, check) {
  if (!info) return "…";
  if (info.channel === "dev") return "Dev";
  if (!check) return "…";
  if (check.state === "behind") return `${check.behind} behind`;
  if (check.state === "current") return "Up to date";
  if (check.state === "dirty") return "HEAD + edits";
  return "Unknown";
}

// The one button's label. Only "behind" may say "Update" — everything else
// ("current", "dirty", "dev", "unknown", or no check back yet) would be
// claiming an update exists when it might not, which is the one thing this
// pane is not allowed to get wrong. Computed once so the Row label and the
// Button label (shown in different branches of `rebuild`) can't drift apart.
function updateActionLabel(check, rebuild) {
  if (check?.state === "behind") return "Update";
  return rebuild === "done" ? "Rebuild again" : "Rebuild…";
}

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
  const [preview, setPreview] = useState(false);
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

  // One click cannot both preview and change the same picture, so the two
  // gestures are split: the avatar itself opens it bigger (MediaViewer, same
  // as any other image in the app), and the small camera badge — already
  // sitting on top of it, previously the only affordance — changes it. That
  // keeps "change" a single click too, just on the badge instead of the
  // whole circle. An initials-only avatar has nothing to preview, so its
  // click still goes straight to the file picker.
  const avatar = (
    <div className="settings__avatar-wrap">
      <button
        type="button"
        className="settings__avatar settings__avatar--edit"
        title={avatarUrl ? "View picture" : "Add a picture"}
        aria-label={avatarUrl ? "View picture" : "Add a picture"}
        onClick={() => (avatarUrl ? setPreview(true) : fileRef.current?.click())}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="settings__avatar-img" />
        ) : (
          <span className="settings__avatar-initial">{initialOf(name)}</span>
        )}
      </button>
      <button
        type="button"
        className="settings__avatar-hint"
        title={avatarUrl ? "Change picture" : "Add a picture"}
        aria-label={avatarUrl ? "Change picture" : "Add a picture"}
        onClick={(e) => {
          // Must not also trigger the preview button underneath it.
          e.stopPropagation();
          fileRef.current?.click();
        }}
      >
        {/* `gb-icon-camera` is not a name icons.css defines — the class
            applied, ::before resolved to `content: none`, and the badge
            painted as an empty 0x0 grey circle on hover. The font's real
            name for this glyph is device-camera. */}
        <i className="gb-icon gb-icon-device-camera" />
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
      <MediaViewer
        items={avatarUrl ? [avatarUrl] : []}
        index={0}
        open={preview && !!avatarUrl}
        onClose={() => setPreview(false)}
      />
    </div>
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

// Local endpoints (~/.hermes/config.yaml `providers:`) get their own row
// rather than forty more entries in one flat Select: "easy to switch" is not
// a longer list. STATE_WORD is the honest short label beside the choice —
// "Not set up" is deliberately NOT the same word as "Offline", because the
// placeholder host in the shipped config is not a network failure.
const STATE_WORD = {
  ok: "Reachable",
  offline: "Offline",
  unauthorized: "Key rejected",
  http: "Odd reply",
  unconfigured: "Not set up",
  // Answering, and unable to serve. Ollama returns 200 with `data: null` when
  // nothing is pulled, so "Reachable" was true and useless — you flip to it and
  // the first turn fails looking like a broken app. Its own word, because its
  // own fix: load a model, not debug a firewall.
  empty: "No model loaded",
  checking: "Checking…",
  unknown: "Unknown",
};

function shortModelLabel(id) {
  const s = String(id || "").trim();
  if (!s) return "None";
  if (MODEL_LABELS[s]) return MODEL_LABELS[s];
  if (/grok/i.test(s)) return "Grok";
  return s.split("/").pop() || s;
}

// A two-segment switch, not a Select: with one local endpoint the whole
// decision is "hosted or mine", and that should be one click either way.
//
// The segments used to read as a MODEL name next to a PROVIDER name
// ("Qwen3.8-Flash-Next-GGUF | unsloth") — both of which are local right now,
// so nothing on the control said "cloud" or "local" at all. The primary word
// on each pill is now literally Cloud / Local; the model or machine name is
// still here, just demoted to a smaller line under it, per the rule that the
// specific choice belongs below the mode, not instead of it.
function LocalSwitch({ cloudLabel, localLabel, onLocal, running, disabled }) {
  return (
    <div className="settings__seg" role="group" aria-label="Local or cloud">
      <button
        type="button"
        className="settings__seg-btn"
        aria-pressed={running === "cloud"}
        data-on={running === "cloud" || undefined}
        onClick={() => onLocal(false)}
      >
        <span className="settings__seg-btn-main">Cloud</span>
        <span className="settings__seg-btn-sub">{cloudLabel}</span>
      </button>
      <button
        type="button"
        className="settings__seg-btn"
        aria-pressed={running === "local"}
        data-on={running === "local" || undefined}
        disabled={disabled}
        onClick={() => onLocal(true)}
      >
        <span className="settings__seg-btn-main">Local</span>
        <span className="settings__seg-btn-sub">{localLabel}</span>
      </button>
    </div>
  );
}

function chatModelOf(settings) {
  const m = String((settings && settings.model) || "").trim();
  if (!m || BANNED_CHAT.test(m)) return DEFAULT_CHAT;
  return m;
}

function modelSelectOptions(current, ids, localByModel) {
  const out = [];
  const seen = new Set();
  function add(id) {
    const v = String(id || "").trim();
    if (!v || BANNED_CHAT.test(v) || seen.has(v)) return;
    seen.add(v);
    // A self-hosted entry is indistinguishable from a hosted one by its id
    // alone — "gemma4:12B" says nothing about whose machine it runs on.
    const local = localByModel && localByModel.get(v);
    out.push({ value: v, label: local ? `${MODEL_LABELS[v] || v} — Local · ${local.name}` : MODEL_LABELS[v] || v });
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
  const [localList, setLocalList] = useState([]);
  const [localState, setLocalState] = useState({});
  const [localPick, setLocalPick] = useState("");
  // Updates pane. `build` is the running build as the MAIN process reports it
  // (electron/build-info.cjs); nothing about it is typed into this file.
  const [build, setBuild] = useState(null);
  const [buildCheck, setBuildCheck] = useState(null);
  // "" | "confirm" | "running" | "done" | "failed" — a two-step control,
  // because the first click starts a 90-second build that swaps the app in
  // /Applications and the user is told that before it happens, not after.
  const [rebuild, setRebuild] = useState("");
  const [rebuildNote, setRebuildNote] = useState("");
  // Why the reopen did NOT happen. Only ever set on a refusal — a successful
  // relaunch takes the renderer with it.
  const [relaunchNote, setRelaunchNote] = useState("");
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

  // Read the build once the pane is opened. Not on mount: it shells out to git
  // and the overwhelmingly common case is that nobody opens Updates at all.
  useEffect(() => {
    if (pane !== "updates") return undefined;
    let gone = false;
    const load = window.hydo?.checkBuild;
    if (typeof load !== "function") return undefined;
    Promise.resolve(load())
      .then((res) => {
        if (gone || !res) return;
        setBuild(res.info || null);
        setBuildCheck(res.check || null);
      })
      .catch(() => {
        if (!gone) setBuildCheck({ state: "unknown", reason: "Could not read the build." });
      });
    return () => {
      gone = true;
    };
  }, [pane]);

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

  // The self-hosted endpoints, and whether they are actually answering. Both
  // come from the main process: the api_key stays there (see
  // electron/local-providers.cjs) and only a state word crosses back.
  const statesRef = useRef({});
  useEffect(() => {
    const load = window.hydo?.localProviders;
    const check = window.hydo?.probeLocalProvider;
    if (typeof load !== "function") return undefined;
    let gone = false;
    Promise.resolve(load())
      .then((res) => {
        if (gone) return;
        const list = (res && res.providers) || [];
        setLocalList(list);
        // Start on whatever is actually running, else the first entry — which
        // is the user's own PC in the shipped config. Landing on it says "not
        // set up yet" out loud instead of hiding it behind a second control.
        const running = list.find((p) => p.id === String(settings.provider || ""));
        setLocalPick((prev) => prev || (running || list[0] || {}).id || "");
        if (typeof check !== "function") return;
        statesRef.current = {};
        setLocalState(Object.fromEntries(list.map((p) => [p.id, { state: "checking", detail: "" }])));
        for (const p of list) {
          Promise.resolve(check(p.id))
            .then((r) => {
              if (gone) return;
              const st = (r && r.status) || { state: "unknown", detail: "" };
              statesRef.current[p.id] = st;
              setLocalState((prev) => ({ ...prev, [p.id]: st }));
              // Promote a machine that IS answering over one that is not, but
              // never over the endpoint the user is already running on.
              setLocalPick((prev) => {
                if (prev === String(settings.provider || "")) return prev;
                if (st.state !== "ok") return prev;  // `empty` answers but cannot run a turn
                const cur = statesRef.current[prev];
                return cur && cur.state === "ok" ? prev : p.id;
              });
            })
            .catch(() => {
              if (gone) return;
              setLocalState((prev) => ({ ...prev, [p.id]: { state: "unknown", detail: "" } }));
            });
        }
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, []);

  const localByModel = new Map();
  for (const p of localList) if (p.model) localByModel.set(p.model, p);
  const localIds = new Set(localList.map((p) => p.id));
  const activeLocal = localList.find((p) => p.id === localPick) || localList[0] || null;
  // "Running local" is decided by the provider, not the model string: two
  // endpoints can serve the same model id.
  const runningLocal = localIds.has(String(settings.provider || "")) || localByModel.has(chatModel);
  // Remember the hosted pick so the switch back is the same one click. Written
  // during render only while NOT local, so flipping to local cannot overwrite it.
  //
  // Gated on the provider list having LOADED. `localList` starts empty and is
  // filled by an async IPC call, so on the first render every model looks
  // hosted — including a local one. The Cloud pill then captured
  // `Qwen3.8-Flash-Next-GGUF` and offered it as the way back to the cloud,
  // which is both wrong and the single most confusing thing the control could
  // say. Nothing is remembered until we can actually tell the two apart.
  const cloudRef = useRef({ model: DEFAULT_CHAT, provider: DEFAULT_PROVIDER });
  if (localList.length && !runningLocal && chatModel) {
    cloudRef.current = { model: chatModel, provider: settings.provider || DEFAULT_PROVIDER };
  }
  const activeStatus = (activeLocal && localState[activeLocal.id]) || { state: "unknown", detail: "" };

  // What the endpoint can actually serve.
  //
  // The model list Hermes reports for a custom provider is the ONE line from
  // config.yaml, so picking any other model your own server holds meant editing
  // YAML by hand. This box answers with six; asking it directly is the only way
  // to know. Only asked when a local provider is the live one, so a hosted user
  // never pays a network call for a row they cannot see.
  const [localModels, setLocalModels] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!activeLocal || !runningLocal || activeStatus.state !== "ok") {
      setLocalModels([]);
      return () => {
        alive = false;
      };
    }
    Promise.resolve(window.hydo?.localModels?.(activeLocal.id))
      .then((res) => {
        if (!alive) return;
        setLocalModels(res && res.ok && Array.isArray(res.models) ? res.models : []);
      })
      .catch(() => alive && setLocalModels([]));
    return () => {
      alive = false;
    };
  }, [activeLocal && activeLocal.id, runningLocal, activeStatus.state]);

  // Tokens/sec. Measured by electron/store.cjs on a COMPLETED turn (a delta of
  // Hermes' cumulative output counters over the turn's wall time) — there is no
  // live rate to show mid-turn, so the label says "last turn" and means it.
  // Three gates, all of which must hold, because a stale or borrowed number
  // here would be worse than no number: we must be running local, the sample
  // must have been taken on the endpoint that is showing, and it must exist.
  // Nothing has run yet → nothing is rendered.
  const sample = settings.localRate;
  const rateText =
    runningLocal &&
    sample &&
    typeof sample.rate === "number" &&
    sample.rate > 0 &&
    activeLocal &&
    sample.provider === activeLocal.id
      ? ` · ${sample.rate.toFixed(1)} tok/s last turn`
      : "";

  const harness = settings.codingHarness || "grok-build";
  const HARNESS_NAME = { "grok-build": "Grok Build", opencode: "OpenCode", cursor: "Cursor", shell: "Workspace shell" };
  const chatIsGrok = /grok-/i.test(chatModel);
  const harnessDesc =
    harness === "shell"
      ? "Heavy coding stays in this workspace's shell, not an outside CLI."
      : harness === "grok-build"
        ? runningLocal
          ? "Heavy coding still shells out to `grok -p`, which signs in to xAI — not your hardware. Pick Workspace shell to keep it local too."
          : "Heavy coding shells out to `grok -p`, which signs in to xAI."
        : `Heavy coding shells out to the ${HARNESS_NAME[harness] || harness} CLI, on its own account — not your hardware.`;

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
            {/* Groups, not one long list — and not one card per row either.
                This pane has been both. It started as a card PER ROW, which
                read as a pile of separate objects; that was collapsed into a
                single card, which fixed the noise and lost the map: fifteen
                rows in one fill, findable only by reading all of them. What is
                here now is the middle the reference asks for — four groups,
                each holding several related rows, with a quiet label OUTSIDE
                the fill. The gap between groups (.settings__body, 28px) is
                deliberately much larger than the gap between rows inside one
                (0, they share an edge and are split by an inset hairline), so
                the grouping is legible as space rather than as chrome.

                The first row of a group never carries `divided`: a hairline
                above the top row draws a line across the card's own rounded
                edge. Where the first row is conditional the flag is COMPUTED
                from the same condition rather than hardcoded. */}
            {pane === "general" && (
              <section className="settings__section">
                <SectionLabel>Account</SectionLabel>
                <RowGroup>
                  <AccountRow
                    name={accountName || settings.userName}
                    email={settings.userEmail}
                    avatarUrl={settings.userAvatar}
                    onSignOut={onSignOut}
                    onAvatar={(userAvatar) => onChange({ userAvatar })}
                  />
                  {/* There was no way to set your own name ANYWHERE in the
                      app: the store seeded the developer's, and every prompt a
                      teammate used to address you read from it. */}
                  <Row divided label="Your name" description="What teammates call you.">
                    <TextInput
                      ariaLabel="Your name"
                      value={settings.userName || ""}
                      placeholder="Your name"
                      onChange={(userName) => onChange({ userName })}
                    />
                  </Row>
                </RowGroup>
              </section>
            )}

            {pane === "general" && (
              <section className="settings__section">
                <SectionLabel>Appearance</SectionLabel>
                <RowGroup>
                  <Row label="Theme">
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
                </RowGroup>
              </section>
            )}

            {pane === "general" && (
              <section className="settings__section">
                <SectionLabel>Where turns run</SectionLabel>
                <RowGroup>
                  {/* Order, and why it is this one.
                      It used to read: Chat model → Own hardware → Local
                      endpoint → harness. So you picked a model before you had
                      said whose machine it runs on, and the switch that
                      decides the whole thing sat UNDER the thing it decides.
                      Now it is the same order as the decision: local or not →
                      which machine → which model → what does the heavy coding. */}
                  {activeLocal && (
                    <Row
                      label="Local or cloud"
                      description={
                        <>
                          {activeStatus.detail ||
                            `${activeLocal.name} · ${activeLocal.host}${activeLocal.model ? ` · ${activeLocal.model}` : ""}`}
                          {rateText && <span className="settings__rate">{rateText}</span>}
                        </>
                      }
                    >
                      <div className="settings__local-ctl">
                      <span className="settings__health" data-state={activeStatus.state}>
                        <span className="settings__dot" aria-hidden="true" />
                        {STATE_WORD[activeStatus.state] || "Unknown"}
                      </span>
                      <LocalSwitch
                        running={runningLocal ? "local" : "cloud"}
                        cloudLabel={shortModelLabel(cloudRef.current.model)}
                        localLabel={activeLocal.name}
                        disabled={
                          activeStatus.state === "unconfigured" || activeStatus.state === "empty"
                        }
                        onLocal={(wantLocal) => {
                          if (wantLocal) {
                            if (!activeLocal.model) return;
                            onChange({ model: activeLocal.model, provider: activeLocal.id });
                          } else {
                            onChange({
                              model: cloudRef.current.model || DEFAULT_CHAT,
                              provider: cloudRef.current.provider || DEFAULT_PROVIDER,
                            });
                          }
                        }}
                      />
                      </div>
                    </Row>
                  )}
                  {/* Kept visible on hosted, unlike the harness model row below.
                      It is not a dead control there: it aims the Local half of
                      the switch, so you have to be able to set it BEFORE you
                      flip. The description says which of the two it is doing. */}
                  {localList.length > 1 && (
                    <Row
                      divided={!!activeLocal}
                      label="Local endpoint"
                      // One sentence, true in both modes: "Local or cloud" above
                      // already says which mode is live, so this row does not
                      // need to repeat it — it only has one job, aiming Local.
                      description="Which machine the Local side of the switch uses."
                    >
                      <Select
                        ariaLabel="Local endpoint"
                        value={activeLocal ? activeLocal.id : ""}
                        options={localList.map((p) => ({
                          value: p.id,
                          label: `${p.name} · ${p.host}`,
                        }))}
                        onChange={(v) => {
                          setLocalPick(v);
                          // Only re-point the switch. Changing the live model as
                          // a side effect of browsing endpoints is exactly the
                          // surprise this row exists to avoid — unless a local
                          // endpoint is already what is running.
                          const next = localList.find((p) => p.id === v);
                          if (runningLocal && next && next.model) {
                            onChange({ model: next.model, provider: next.id });
                          }
                        }}
                      />
                    </Row>
                  )}
                  <Row
                    divided={!!activeLocal || localList.length > 1}
                    label="Chat model"
                    description="Model for chat turns — default grok-4.6."
                  >
                    <Select
                      ariaLabel="Chat model"
                      value={chatModel}
                      options={
                        runningLocal && localModels.length
                          ? localModels.map((m) => ({
                              value: m.id,
                              // An unloaded model is a real choice that pays a
                              // load before its first token. Hiding that makes
                              // the slow one look broken.
                              label: m.loaded ? m.id : `${m.id} — not loaded`,
                            }))
                          : modelSelectOptions(chatModel, modelOpts, localByModel)
                      }
                      onChange={(v) => {
                        const patch = { model: v };
                        // Picking a self-hosted model out of the flat list used
                        // to leave `provider: xai-oauth` behind it, so the turn
                        // went to xAI with a model it has never heard of.
                        const local = localByModel.get(v);
                        if (local) patch.provider = local.id;
                        // A model taken off the endpoint's own shelf has no
                        // entry in localByModel (that map is built from
                        // config.yaml), so carry the provider we asked.
                        else if (runningLocal && activeLocal && localModels.some((m) => m.id === v))
                          patch.provider = activeLocal.id;
                        else if (/muse/i.test(v)) patch.provider = "meta-ai";
                        else if (/grok/i.test(v)) patch.provider = "xai-oauth";
                        onChange(patch);
                      }}
                    />
                  </Row>
                  {/* The harness is NOT a router. `agentsModelBlock` in
                      electron/model-pick.cjs writes it into AGENTS.md as an
                      instruction to shell out to a CLI — so with Grok Build
                      selected, heavy coding runs `grok -p`, which signs in to
                      xAI, no matter what the chat model is. Saying "Grok Build"
                      under a local chat model without saying that is the app
                      quietly sending half the work off the user's machine.
                      Workspace shell is the one option that keeps it here. */}
                  <Row divided label="Coding harness" description={harnessDesc}>
                    <Select
                      ariaLabel="Coding harness"
                      value={harness}
                      options={[
                        { value: "grok-build", label: "Grok Build" },
                        { value: "opencode", label: "OpenCode" },
                        { value: "cursor", label: "Cursor" },
                        { value: "shell", label: "Workspace shell — local" },
                      ]}
                      onChange={(v) => onChange({ codingHarness: v })}
                    />
                  </Row>
                  {/* Hidden, not disabled, when the harness is not Grok Build.
                      Its own description already said "when the harness is Grok
                      Build" — a row that admits it does nothing is a row that
                      should not be drawn. This is the one row in the card that
                      really is inert in the other modes, so it is the one that
                      goes; the endpoint row above stays because it is not. */}
                  {harness === "grok-build" && (
                    <Row
                      divided
                      label="Coding / Grok Build"
                      description="Model flag for grok -p when the harness is Grok Build."
                    >
                      <Select
                        ariaLabel="Coding model"
                        value={settings.codingModel || ""}
                        options={[
                          // grokCliModel() (electron/model-pick.cjs) emits -m only
                          // for a grok-* id. With a local chat model "Same as chat"
                          // therefore sends NO flag and Grok picks its own default,
                          // so the old label was a promise the code does not keep.
                          {
                            value: "",
                            label: chatIsGrok ? "Same as chat" : "Grok's own default (chat model is not a Grok id)",
                          },
                          { value: "grok-4.6", label: "grok-4.6" },
                          { value: "grok-4.5", label: "grok-4.5" },
                          ...modelSelectOptions(settings.codingModel, modelOpts, localByModel).filter(
                            (o) => o.value && o.value !== "grok-4.6" && o.value !== "grok-4.5",
                          ),
                        ]}
                        onChange={(v) => onChange({ codingModel: v })}
                      />
                    </Row>
                  )}
                </RowGroup>
              </section>
            )}

            {pane === "general" && (
              <section className="settings__section">
                <SectionLabel>System</SectionLabel>
                <RowGroup>
                  <Row label="Timezone" description="Bots use this timezone for routines and scheduled work.">
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
              <>
                {/* One question — "am I current, and if not, update me" — one
                    section. This used to be a Version group, a separate
                    "Check the working copy" button, and an Install group: four
                    controls and five explanations for what the user actually
                    asked for ("just make this a simpler update thing"). The
                    check itself is not a control anymore: the useEffect above
                    (keyed on `pane`) already re-reads the build every time
                    this pane opens, so there is nothing left for a "Check now"
                    button to do that opening the pane didn't already do. */}
                <section className="settings__section">
                  <SectionLabel>Update</SectionLabel>
                  <RowGroup>
                    {/* Not a literal. `buildLabel`/`buildDesc` format what
                        electron/build-info.cjs measured — package.json's
                        version, the commit COUNT as the build number, the
                        short sha — stamped into the bundle at build time by
                        scripts/stamp-build.cjs because a packaged app has no
                        .git of its own. buildDesc is also the ONLY place
                        allowed to claim a state ("behind"/"dirty"/"current"/
                        "dev"/"unknown"); a confident wrong status here is
                        treated as a bug, not a UI nit. */}
                    <Row strong label={buildLabel(build)} description={buildDesc(build, buildCheck)}>
                      <span className="settings__pct">{buildPill(build, buildCheck)}</span>
                    </Row>
                    {/* The whole flow — check, confirm, build, install — lives
                        behind this one row now. Two clicks survive on
                        purpose: the second one is a ~90 second build that
                        swaps the bundle in /Applications, and a control that
                        takes the machine away for that long on one click is a
                        trap. But the confirm text is one sentence, not the
                        old four-sentence wall with an absolute repo path
                        nobody was going to read before clicking anyway. */}
                    <Row
                      divided
                      label={updateActionLabel(buildCheck, rebuild)}
                      description={
                        rebuild === "running"
                          ? "Building… a minute or two."
                          : rebuild === "confirm"
                            ? "Runs npm run pack, then swaps the app in /Applications. You choose whether to reopen."
                            : rebuildNote ||
                              // Only "behind" may say an update exists —
                              // update-flow-test.cjs's statusFrom cases are
                              // the same rule enforced on the main-process
                              // side; this is its renderer-side twin.
                              (buildCheck?.state === "behind"
                                ? `${buildCheck.behind} commit${buildCheck.behind === 1 ? "" : "s"} ahead — rebuilds and installs from source.`
                                : "Builds this machine's copy of the source and installs it, even though nothing changed.")
                      }
                    >
                      {rebuild === "running" ? (
                        <span className="settings__pct">Building…</span>
                      ) : rebuild === "confirm" ? (
                        <div className="settings__local-ctl">
                          <Button onClick={() => setRebuild("")}>Cancel</Button>
                          <Button
                            variant="primary"
                            onClick={() => {
                              const run = window.hydo?.rebuildAndInstall;
                              if (typeof run !== "function") return;
                              setRebuild("running");
                              setRebuildNote("");
                              Promise.resolve(run())
                                .then((res) => {
                                  if (res && res.ok) {
                                    setRebuild("done");
                                    setRebuildNote(
                                      `Installed to ${res.installed}${res.seconds ? ` in ${res.seconds}s` : ""}. The running app is still the old one until you reopen.`,
                                    );
                                    const again = window.hydo?.checkBuild;
                                    if (typeof again === "function") {
                                      Promise.resolve(again())
                                        .then((r) => {
                                          if (!r) return;
                                          setBuild(r.info || null);
                                          setBuildCheck(r.check || null);
                                        })
                                        .catch(() => {});
                                    }
                                  } else {
                                    setRebuild("failed");
                                    // "The build failed. /Applications was not
                                    // touched." — kept verbatim in spirit: the
                                    // failure state must stay visible and say
                                    // plainly that nothing was swapped.
                                    setRebuildNote(
                                      res && res.reason === "busy"
                                        ? `${res.detail || "A teammate is mid-turn."} Nothing was built.`
                                        : `${(res && res.reason) || "The build failed."} /Applications was not touched.`,
                                    );
                                  }
                                })
                                .catch((err) => {
                                  setRebuild("failed");
                                  setRebuildNote(`${err?.message || "The build failed."} /Applications was not touched.`);
                                });
                            }}
                          >
                            Build and install
                          </Button>
                        </div>
                      ) : (
                        <Button variant="primary" onClick={() => setRebuild("confirm")}>
                          {updateActionLabel(buildCheck, rebuild)}
                        </Button>
                      )}
                    </Row>
                    {/* Only after a successful install, and never automatic.
                        Relaunching an app the user did not ask to lose is a
                        crash with a nicer name. */}
                    {rebuild === "done" && (
                      <Row
                        divided
                        label="Relaunch into the new build"
                        description={
                          relaunchNote ||
                          // What the main process actually does now, in order:
                          // it refuses outright if anyone is working, flushes
                          // the store, stops the box and shuts the Hermes
                          // gateway down through will-quit, then re-execs
                          // /Applications/Hydo.app. Said here because "quits
                          // and reopens" on its own does not tell you that
                          // your teammates are handled.
                          "Stops your teammates cleanly, then quits and reopens the installed build. Refused while anyone is mid-turn."
                        }
                      >
                        <Button
                          variant="primary"
                          onClick={() => {
                            const go = window.hydo?.relaunch;
                            if (typeof go !== "function") return;
                            setRelaunchNote("");
                            Promise.resolve(go())
                              .then((res) => {
                                // On success the process is already on its way
                                // out and nothing here will ever render. The
                                // only reachable branch is the refusal.
                                if (res && res.ok === false) {
                                  setRelaunchNote(
                                    res.reason === "busy"
                                      ? `${res.detail || "A teammate is mid-turn."} Nothing was restarted.`
                                      : `${res.detail || "Hydo could not reopen itself."} Nothing was restarted.`,
                                  );
                                }
                              })
                              .catch(() => setRelaunchNote("Hydo could not reopen itself. Nothing was restarted."));
                          }}
                        >
                          Reopen now
                        </Button>
                      </Row>
                    )}
                  </RowGroup>
                  {/* The one thing this pane cannot do, said plainly instead of
                      drawn as a button that would always fail: there is no git
                      remote, no release feed and no electron-updater here. */}
                  <p className="settings__note">
                    No auto-updater — there is no release server, so updating means rebuilding from source.
                  </p>
                </section>
              </>
            )}
          </div>
        </div>
      </section>
    </Dialog>
  );
}
