import { useEffect, useMemo, useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";
import ColorWheel from "./ColorWheel.jsx";
import { COLORS, SHAPES, isCustomHex } from "../lib/marks.js";
import { botBusy } from "../lib/working.js";
import { pipLabelOf, pipOf } from "../lib/presence.js";
import { pluginPrettyName } from "../lib/plugin-icons.js";
import { liveStateOf } from "./PlanCard.jsx";
import ActivityMark from "./ActivityMark.jsx";

// `coldSeconds` is the wait a LOCAL model spends reading this profile's tool
// schema before its first word on a cold session — measured, see
// PROFILE_TOOL_CHARS in electron/hermes-gateway.cjs. It is the real number
// behind "pick builder and wait 9 seconds", and it is only shown when the bot
// is actually running on the user's own hardware.
const FALLBACK_PROFILES = [
  { name: "chat", tokens: 5100, toolTokens: 399, coldSeconds: 1.1 },
  { name: "writer", tokens: 9800, toolTokens: 1066, coldSeconds: 3 },
  { name: "researcher", tokens: 11800, toolTokens: 2211, coldSeconds: 6.2 },
  { name: "builder", isDefault: true, tokens: 16600, toolTokens: 3338, coldSeconds: 9.4 },
  { name: "full", tokens: 24700, toolTokens: 4293, coldSeconds: 12.1 },
];

/** "9.4s" / "3s". Empty when the number is not known, so nothing invents one. */
function coldLabel(sec) {
  return sec ? `${Math.round(sec * 10) / 10}s` : "";
}

// One action instead of two dropdowns and the knowledge of what they cost.
//
// The number is SCHEMA: input tokens spent describing the tools, every turn,
// before the bot has said anything. Reasoning is output, it is variable, and
// adding the two would be inventing a figure . so Deep carries a word instead
// of a second number. Work and Deep share a profile, and the row used to print
// "16.6k" under both of them, which made the two chips look like the same
// button twice.
// The hosted pick, mirrored from electron/model-pick.cjs (DEFAULT_PROVIDER /
// DEFAULT_CHAT). The renderer cannot require a .cjs out of electron/, and a
// wrong literal here would pin a teammate to a provider Hermes has no auth
// for — so scripts/local-consent-test.cjs asserts these two strings against
// model-pick.cjs itself rather than trusting the copy.
const CLOUD_PROVIDER = "xai-oauth";
const CLOUD_MODEL = "grok-4.6";

const PRESETS = [
  { id: "cheap", label: "Cheap", profile: "chat", effort: "minimal",
    hint: "Talks, remembers, keeps a todo. No files, no shell, no web." },
  { id: "lean", label: "Lean", profile: "writer", effort: "low",
    hint: "Adds its workspace and skills. Good default for a bot that writes." },
  { id: "work", label: "Work", profile: "builder", effort: "low",
    hint: "Shell, delegation, web, artifacts. What real jobs need." },
  { id: "deep", label: "Deep", profile: "builder", effort: "high",
    hint: "Same tools, thinks harder. Costs the most per turn." },
];

function presetOf(profile, effort) {
  return PRESETS.find((p) => p.profile === profile && p.effort === effort)?.id || null;
}

function tokenLabel(n) {
  if (!n) return "";
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

// Hermes accepts eight levels (hermes_constants.py:1185); Hydo offered three,
// so the two cheapest — the ones most dispatcher turns actually want — were
// unreachable. Labelled by what the bot is doing, not by the word, because
// "minimal" tells you nothing about whether your bot should be on it.
const REASON_OPTS = [
  { value: "none", label: "None — no thinking, cheapest" },
  { value: "minimal", label: "Minimal — routing and short replies" },
  { value: "low", label: "Low — the default" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Max — slow and expensive" },
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
  const boxEnabled = !!agent?.boxEnabled;
  const [wheelOpen, setWheelOpen] = useState(false);
  const [profiles, setProfiles] = useState(FALLBACK_PROFILES);
  // Is THIS teammate answering from the user's own hardware? Only then does
  // the cold-start second count mean anything: on a hosted model prefill is
  // not the wait, and a seconds figure next to every profile would be noise.
  const [onLocal, setOnLocal] = useState(false);
  // The endpoints in ~/.hermes/config.yaml plus what the app default resolves
  // to, so the rail can say "inherits the app default (Cloud)" as a fact
  // rather than a guess.
  const [locals, setLocals] = useState([]);
  const [appDefault, setAppDefault] = useState({ provider: "", model: "" });
  const [connections, setConnections] = useState([]);
  const [toolsets, setToolsets] = useState([]);
  const [abilitiesOpen, setAbilitiesOpen] = useState(false);
  // What this teammate left running. Polled only while the rail is open . a
  // background process is a rare thing and this is an RPC, so a permanent
  // timer would cost far more than the answer is worth.
  const [procs, setProcs] = useState([]);
  // Why the last Stop did not work. Empty when there is nothing to say.
  const [procError, setProcError] = useState("");
  // The last answer from `openWorkspace`, so the button can report instead of
  // swallowing it: {} | {busy} | {path} | {error}.
  const [workspace, setWorkspace] = useState({});
  // What the LIVE session reports as enabled, which is a different question
  // from what Hydo configured. Read only while Advanced is open.
  const [live, setLive] = useState(null);
  // Hermes' approvals.mode for THIS bot's own profile, and the permanent
  // "always" allowlist it has accumulated — docs/SAFETY.md gaps #1/#2. Read
  // only while Advanced is open, same reasoning as `live` above: it is an
  // extra RPC per bot, not something worth polling permanently.
  const [approvals, setApprovals] = useState(null);
  const customOn = isCustomHex(agent?.blob);
  // The rail is opened ON a teammate, not on a conversation, so the pip means
  // "a turn of theirs is running" and the label says where. It used to say
  // "Online" whenever the value was not exactly "work" — an unreachable branch
  // that could only ever have printed a claim nothing here can check.
  const pip = pipOf(agent);
  const pipLabel = pipLabelOf(agent, agent?.id);
  const todos = Array.isArray(agent?.todos) ? agent.todos : [];
  // `activityDetail` is the tool line; `activity` is whatever last spoke,
  // including Hermes' own status.update text. Either is a real sentence about
  // this turn, so the more specific one wins and the other is the fallback.
  const activityNow = String(agent?.activityDetail || agent?.activity || "").trim();
  const toolProfile = agent?.toolProfile || "chat";
  const reasoningEffort = agent?.reasoningEffort || "low";
  // After the two above, not before: reading them earlier is a temporal dead
  // zone that throws at render and blanks the whole app. `vite build` cannot
  // see it, and no test renders this component, so it reached the browser.
  const profileTokens = profiles.find((p) => p.name === toolProfile)?.tokens || 0;
  const profileCold = profiles.find((p) => p.name === toolProfile)?.coldSeconds || 0;
  const activePreset = presetOf(toolProfile, reasoningEffort);
  const pinned = !!agent?.profilePinned;
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
    // Same test Settings uses (`runningLocal`): the PROVIDER decides, with the
    // model string as the fallback, because two providers can serve the same
    // model id and only one of them is the box in the next room. Read once
    // while the rail is open — an endpoint does not move mid-panel.
    Promise.all([
      Promise.resolve(window.hydo?.localProviders?.()).catch(() => null),
      Promise.resolve(window.hydo?.getState?.()).catch(() => null),
    ])
      .then(([local, state]) => {
        if (gone) return;
        const list = Array.isArray(local?.providers) ? local.providers : [];
        setLocals(list);
        setAppDefault({
          provider: String(state?.settings?.provider || ""),
          model: String(state?.settings?.model || ""),
        });
        if (!list.length) return setOnLocal(false);
        const settings = state?.settings || {};
        const provider = String(agent?.provider || settings.provider || "");
        const model = String(agent?.model || settings.model || "");
        setOnLocal(
          list.some((p) => (provider && p.id === provider) || (model && p.model === model))
        );
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [agent?.id]);

  // What is folded away, said in the header so opening it is a choice rather
  // than a search. Hand-picking anything in there desyncs it from the preset
  // row, and the row says "Custom" . that is the honest state, not a bug.
  // Named in Hydo, absent from the live session. Only meaningful once the
  // session has actually answered . before that `live` is null and there is
  // nothing to compare, which is different from "nothing missing".
  const liveMissing =
    live && live.length
      ? extraToolsets.filter((t) => !live.some((x) => x.name === t && x.enabled))
      : [];

  // Which of the three states this teammate is in. The PROVIDER decides and
  // the model string is only the fallback, for the same reason the cold-start
  // hint above uses that order: two providers can serve the same model id and
  // only one of them is the box in the next room.
  const pinnedProvider = String(agent?.provider || "");
  const pinnedModel = String(agent?.model || "");
  const localPin =
    locals.find(
      (p) =>
        (pinnedProvider && p.id === pinnedProvider) ||
        (!pinnedProvider && pinnedModel && p.model === pinnedModel)
    ) || null;
  const runsOn = !pinnedProvider && !pinnedModel ? "inherit" : localPin ? "local" : "cloud";
  const defaultLocal =
    locals.find(
      (p) =>
        (appDefault.provider && p.id === appDefault.provider) ||
        (!appDefault.provider && appDefault.model && p.model === appDefault.model)
    ) || null;
  const appDefaultLabel = defaultLocal ? defaultLocal.name || defaultLocal.id : "Cloud";

  const advancedMeta = [
    profileLabel(toolProfile),
    reasoningEffort !== "low" ? reasoningEffort : "",
    extraToolsets.length ? `+${extraToolsets.length}` : "",
    pinnedMcp.length ? `${pinnedMcp.length} app${pinnedMcp.length > 1 ? "s" : ""}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // A path or an error belongs to ONE teammate. Carrying it across a switch
  // would print another bot's folder under this bot's button.
  useEffect(() => {
    setWorkspace({});
  }, [agent?.id]);

  useEffect(() => {
    if (!agent?.id) return undefined;
    let gone = false;
    const read = () =>
      Promise.resolve(window.hydo?.processes?.(agent.id))
        .then((res) => {
          if (!gone && res && res.ok) setProcs(res.processes || []);
        })
        .catch(() => {});
    read();
    const t = setInterval(read, 5000);
    return () => {
      gone = true;
      clearInterval(t);
    };
  }, [agent?.id]);

  useEffect(() => {
    if (!agent?.id || !abilitiesOpen) return undefined;
    let gone = false;
    Promise.resolve(window.hydo?.sessionToolsets?.(agent.id))
      .then((res) => {
        if (!gone && res && res.ok) setLive(res.toolsets || []);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [agent?.id, abilitiesOpen]);

  function loadApprovals() {
    if (!agent?.id) return;
    Promise.resolve(window.hydo?.approvalSettings?.(agent.id))
      .then((res) => {
        if (res && res.ok) setApprovals(res);
      })
      .catch(() => {});
  }

  useEffect(() => {
    setApprovals(null);
    if (!agent?.id || !abilitiesOpen) return undefined;
    let gone = false;
    Promise.resolve(window.hydo?.approvalSettings?.(agent.id))
      .then((res) => {
        if (!gone && res && res.ok) setApprovals(res);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [agent?.id, abilitiesOpen]);

  function setApprovalMode(mode) {
    if (!agent?.id) return;
    // Optimistic: this rewrites the bot's own config.yaml, not the toggle in
    // React state, so nothing here is "the real state" until the RPC
    // answers — but a mode picker that only updates after a disk write feels
    // broken on a fast click.
    setApprovals((cur) => (cur ? { ...cur, mode, isDefault: false } : cur));
    Promise.resolve(window.hydo?.setApprovalMode?.(agent.id, mode))
      .then((res) => {
        if (res && res.ok) setApprovals((cur) => (cur ? { ...cur, mode: res.mode, isDefault: res.isDefault } : cur));
        else loadApprovals();
      })
      .catch(() => loadApprovals());
  }

  function revokeApproval(pattern) {
    if (!agent?.id) return;
    setApprovals((cur) => (cur ? { ...cur, allowlist: cur.allowlist.filter((p) => p !== pattern) } : cur));
    Promise.resolve(window.hydo?.revokeApproval?.(agent.id, pattern))
      .then((res) => {
        if (res && res.ok) setApprovals((cur) => (cur ? { ...cur, allowlist: res.allowlist } : cur));
        else loadApprovals();
      })
      .catch(() => loadApprovals());
  }

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
          glow={!!agent?.glow}
          morph
          /* A PREVIEW, not a status readout.
             
             This panel is where you pick a colour and a shape, and it was
             spinning, wearing a live pip and captioning itself with whatever
             the teammate happened to be doing. You cannot judge a colour on a
             face that is turning, and none of that state is what you came to
             this panel to look at — it is all already on the row and in the
             thread. The one motion that belongs here is the morph between
             shapes, which is the change you are actually making: `morph` stays,
             and `still` yields to it, so switching shape animates and nothing
             else does. `poke` stays too, because that is you asking for it. */
          mood="idle"
          poke
        />
      </span>
      {/* What it is doing RIGHT NOW, under the face that is spinning about it.
          The pip next to the face already says a turn is running; this says
          which tool that turn is in, from the real `tool.start` name (see
          electron/activity.cjs). It renders only while there is a turn —
          `botBusy` is the same source the pip reads, so the two can never
          disagree — and disappears the moment one ends rather than leaving a
          stale claim on screen. */}
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
      {/* Glow is APPEARANCE — the same tier as Color and Shape, so it is
          rendered in their idiom: a `bot-rail__field` with a label and a
          `bot-rail__swatches` group of pressable faces, exactly like Shape.
          It has been a full title+description notification-style row (which
          gave a cosmetic option the weight of something that changes what a
          bot can DO), then a labelled checkbox, which still read as a
          settings line rather than an appearance pick. Two faces, off and on,
          are also the only honest preview: the choice IS what the face looks
          like. */}
      <div className="bot-rail__field">
        <span className="bot-rail__field-label">Glow</span>
        <div className="bot-rail__swatches bot-rail__shapes" role="group" aria-label="Glow">
          {[false, true].map((on) => (
            <button
              key={on ? "on" : "off"}
              type="button"
              className={!!agent?.glow === on ? "shape-pick is-on" : "shape-pick"}
              title={on ? "Glow" : "No glow"}
              aria-label={on ? "Glow" : "No glow"}
              aria-pressed={!!agent?.glow === on}
              onClick={() => onChange({ glow: on })}
            >
              <UmbraFace
                tint={agent?.blob || "gray"}
                shape={agent?.shape}
                size={26}
                mood="idle"
                glow={on}
                fit
              />
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
      {/* ── where this teammate runs ─────────────────────────────────────
          Per-teammate cloud/local. The model layer already honoured
          `agent.provider` / `agent.model` ahead of the app default
          (electron/model-pick.cjs) — what was missing was any way to SAY so
          without opening Settings and changing it for everybody.

          Three states, and they must not look alike: following the app
          default is not the same fact as being pinned to the cloud, even when
          the app default IS the cloud, because only the pinned one keeps
          running there after someone changes Settings. The line under the row
          spells the state out and is styled differently for an override (see
          `.bot-rail__runs-state.is-override` in rails.css). */}
      <div className="bot-rail__field">
        <span className="bot-rail__field-label">Runs on</span>
        <div className="bot-rail__runs" role="group" aria-label="Runs on">
          <button
            type="button"
            className={runsOn === "inherit" ? "bot-rail__preset is-on" : "bot-rail__preset"}
            aria-pressed={runsOn === "inherit"}
            title="Follow whatever Settings is set to."
            onClick={() => onChange({ provider: "", model: "" })}
          >
            <span>Default</span>
            <span className="bot-rail__preset-cost">{appDefaultLabel}</span>
          </button>
          <button
            type="button"
            className={runsOn === "cloud" ? "bot-rail__preset is-on" : "bot-rail__preset"}
            aria-pressed={runsOn === "cloud"}
            title="Always the hosted model, whatever Settings says."
            onClick={() => onChange({ provider: CLOUD_PROVIDER, model: CLOUD_MODEL })}
          >
            <span>Cloud</span>
            <span className="bot-rail__preset-cost">{CLOUD_MODEL}</span>
          </button>
          {locals.map((p) => (
            <button
              key={p.id}
              type="button"
              className={localPin?.id === p.id ? "bot-rail__preset is-on" : "bot-rail__preset"}
              aria-pressed={localPin?.id === p.id}
              title={`Your own machine: ${p.host}`}
              onClick={() => onChange({ provider: p.id, model: p.model || "" })}
            >
              <span>{p.name || p.id}</span>
              <span className="bot-rail__preset-cost">{p.host}</span>
            </button>
          ))}
        </div>
        <p
          className={
            runsOn === "inherit"
              ? "bot-rail__cost bot-rail__runs-state"
              : "bot-rail__cost bot-rail__runs-state is-override"
          }
        >
          {runsOn === "inherit"
            ? `Inherits the app default (${appDefaultLabel}).`
            : runsOn === "local"
            ? `Local · ${localPin?.name || localPin?.id}. If it isn’t answering, this Bot asks before anything runs on the cloud.`
            : `Cloud · ${agent?.model || CLOUD_MODEL}. Overrides Settings for this Bot only.`}
        </p>
      </div>
      <div className="bot-rail__field">
        <span className="bot-rail__field-label">Mode</span>
        <div className="bot-rail__presets" role="group" aria-label="Mode">
          <button
            type="button"
            className={pinned ? "bot-rail__preset" : "bot-rail__preset is-on"}
            aria-pressed={!pinned}
            title="Start cheap and climb only when a turn needs more."
            onClick={() => onChange({ profilePinned: false, toolProfile: "chat" })}
          >
            <span>Auto</span>
            {/* The RUNG, not just a number. "Auto 16.6k" reads as "auto costs
                16.6k always", when it means "auto has climbed to Work". */}
            <span className="bot-rail__preset-cost">
              {pinned
                ? "off"
                : `${profileLabel(toolProfile)} ${
                    (onLocal && coldLabel(profileCold)) || tokenLabel(profileTokens)
                  }`}
            </span>
          </button>
          {PRESETS.map((p) => {
            const on = pinned && activePreset === p.id;
            const cost = profiles.find((x) => x.name === p.profile)?.tokens;
            const cold = profiles.find((x) => x.name === p.profile)?.coldSeconds;
            return (
              <button
                key={p.id}
                type="button"
                className={on ? "bot-rail__preset is-on" : "bot-rail__preset"}
                aria-pressed={on}
                title={p.hint}
                onClick={() =>
                  onChange({
                    toolProfile: p.profile,
                    reasoningEffort: p.effort,
                    // Choosing by hand is a decision. Auto stops overriding it
                    // until you hand it back with the Auto button.
                    profilePinned: true,
                  })
                }
              >
                <span>{p.label}</span>
                {/* The arrow is the whole distinction between Work and Deep,
                    which share a profile and so share a number. A word does
                    not fit in a fifth of the rail; a caret does. */}
                {/* On your own hardware the honest unit is seconds, not
                    tokens: 3.3k of schema is 9.4s of silence before the first
                    word of a cold turn (docs/LOCAL-MODEL.md). */}
                <span className="bot-rail__preset-cost">
                  {onLocal ? coldLabel(cold) || tokenLabel(cost) : tokenLabel(cost)}
                  {p.effort === "high" || p.effort === "medium" ? "\u2191" : ""}
                </span>
              </button>
            );
          })}
        </div>
        <p className="bot-rail__cost">
          {!pinned
            ? `Auto: on ${profileLabel(toolProfile)} now, climbs when a turn needs more.`
            : activePreset
            ? PRESETS.find((p) => p.id === activePreset).hint
            : "Custom. Tools and Reason are set individually below."}
          {/* Naming the trade where it is made. Auto is the no-loss answer:
              every tool is still reachable, they are just not all loaded up
              front. Pinning a big profile is a choice to pay for them on every
              cold turn, and the user should be told the price in seconds. */}
          {onLocal && profileCold
            ? ` On your hardware that is ~${coldLabel(profileCold)} of tool schema before the first word of a cold turn.`
            : ""}
        </p>
      </div>
      {todos.length ? (
        <div className="bot-rail__field">
          <span className="bot-rail__field-label">Plan</span>
          {/* The bot's own todo list, mirrored off the tool stream. Read only:
              it is the model's working plan, and editing it here would put a
              second author on a list it re-reads as its own. */}
          <ul className="bot-rail__plan">
            {todos.map((t, i) => (
              /* `liveStateOf`, not `t.status`. Hermes sends the same state as
                 `in_progress`, `in-progress`, `active` or `running` depending
                 on the model, and interpolating it raw meant three of those
                 four matched no rule in rails.css at all — the running step
                 just looked pending.
                 It also does not trust a stale "in_progress" on its own:
                 `botBusy(agent)` is the same source the roster pip reads, so
                 a step this teammate is no longer actually turning (turn
                 ended, or the rail was opened after the fact) cannot still
                 claim to be live here. */
              <li key={t.id || i} className={`bot-rail__plan-item is-${liveStateOf(t, botBusy(agent))}`}>
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
          <span className="bot-rail__field-label">Advanced</span>
          <span className="bot-rail__disclose-meta">{advancedMeta}</span>
          <i className={`gb-icon gb-icon-chevron-${abilitiesOpen ? "down" : "right"}`} />
        </button>
        {abilitiesOpen ? (
          <>
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
            {onLocal && profileCold ? ` ~${coldLabel(profileCold)} of it is read before a cold turn answers.` : ""}
          </p>
        ) : null}
      </label>
      <label className="bot-rail__field">
        <span className="bot-rail__field-label">Thinking</span>
        <select
          value={REASON_OPTS.some((o) => o.value === reasoningEffort) ? reasoningEffort : "low"}
          aria-label="Thinking"
          onChange={(e) => onChange({ reasoningEffort: e.target.value })}
        >
          {REASON_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="bot-rail__cost">
          Thinking tokens, on top of the profile above. A bot that answers or
          delegates rarely needs more than Low.
        </p>
      </label>
          {toolsets.length === 0 ? (
            <p className="bot-rail__hint mute">
              Hermes is not answering, so its toolsets cannot be listed.
            </p>
          ) : (
            <>
              <p className="bot-rail__hint mute">
                Extra Hermes toolsets on top of {profileLabel(toolProfile)}. Each one costs
                context on every turn.
              </p>
              {/* What the teammate ACTUALLY has, asked of its own session
                  rather than inferred from what we set. Hydo sends a pin and
                  Hermes resolves it, and the two can disagree silently . a
                  server named in a pin but missing from the profile's config
                  is dropped without a word. Naming the drift is the only way
                  that stops being a bug found months later. */}
              {liveMissing.length ? (
                <p className="bot-rail__drift">
                  Asked for but not active in its session: {liveMissing.join(", ")}. It will pick
                  them up on its next session.
                </p>
              ) : null}
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
          )}
      <div className="bot-rail__field">
        <span className="bot-rail__field-label">Approvals</span>
        {!approvals ? (
          <p className="bot-rail__hint mute">Reading this teammate's own config…</p>
        ) : (
          <>
            <select
              value={approvals.mode}
              aria-label="Approval mode"
              onChange={(e) => setApprovalMode(e.target.value)}
            >
              <option value="smart">Smart — auto-approve what a guard model judges low-risk</option>
              <option value="manual">Manual — ask every time</option>
            </select>
            {/* The honest label docs/SAFETY.md's gap #1 asked for: a value
                nobody chose looks identical to a value someone did, unless
                the UI says which. */}
            <p className="bot-rail__cost">
              {approvals.isDefault
                ? "Inherited from Hermes' own default — nobody has set this for this teammate."
                : "Set for this teammate. Hermes' own default is Smart."}
            </p>
            {approvals.allowlist.length ? (
              <ul className="bot-rail__procs" role="group" aria-label="Always-approved commands">
                {approvals.allowlist.map((pattern) => (
                  <li key={pattern} className="bot-rail__proc">
                    <span className="bot-rail__proc-cmd" title={pattern}>
                      {pattern}
                    </span>
                    <button
                      type="button"
                      className="ghost bot-rail__proc-stop"
                      onClick={() => revokeApproval(pattern)}
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="bot-rail__hint mute">
                Nothing on this teammate's permanent allowlist. Answering "Always" on an approval adds a pattern
                here, forever, until revoked.
              </p>
            )}
          </>
        )}
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
          </>
        ) : null}
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
      {/* Only when there is something. A section that says "nothing running"
          every time is a row you learn to skip. */}
      {procs.length ? (
        <div className="bot-rail__routines">
          <span className="bot-rail__notify-title">Still running</span>
          <ul className="bot-rail__procs">
            {procs.map((p) => (
              <li key={p.session_id || p.id} className="bot-rail__proc">
                <span className="bot-rail__proc-cmd" title={p.command || ""}>
                  {p.command || p.session_id}
                </span>
                <button
                  type="button"
                  className="ghost bot-rail__proc-stop"
                  onClick={async () => {
                    // The row used to disappear the moment you clicked,
                    // whatever `killProcess` answered — so with Hermes down
                    // the process kept running and the rail said it was gone.
                    // Same shape as the `openWorkspace` bug below: a real
                    // {ok:false, reason} thrown away. Drop the row only when
                    // the kill actually landed.
                    const key = p.session_id || p.id;
                    setProcError("");
                    try {
                      const res = await window.hydo?.killProcess?.(agent.id, key);
                      if (res && res.ok) {
                        setProcs((list) => list.filter((x) => (x.session_id || x.id) !== key));
                      } else {
                        setProcError(
                          (res && res.reason) || "Could not stop it — Hermes did not answer."
                        );
                      }
                    } catch (err) {
                      setProcError(err?.message || "Could not stop it.");
                    }
                  }}
                >
                  Stop
                </button>
              </li>
            ))}
          </ul>
          {procError ? (
            <p className="bot-rail__workspace-note is-bad">{procError}</p>
          ) : null}
          <p>
            Started by this Bot and still going after its turn ended. Stopping
            one here only touches this Bot&apos;s.
          </p>
        </div>
      ) : null}
      {/* Permission, not provisioning. Turning this on creates no machine and
          turning it off deletes none: there is exactly one workspace for the
          whole desk, and this says whether this teammate may use it. */}
      <div className="bot-rail__notify">
        <div>
          <span className="bot-rail__notify-title">Linux workspace</span>
          <p>
            Let this Bot use the shared Ubuntu machine. All Bots use the same
            one, so logins it makes stay signed in for the others. It stops
            itself when nobody is working.
          </p>
        </div>
        <button
          type="button"
          className={boxEnabled ? "bot-rail__toggle is-on" : "bot-rail__toggle"}
          role="switch"
          aria-checked={boxEnabled}
          aria-label="Linux workspace"
          onClick={() => onChange({ boxEnabled: !boxEnabled })}
        />
      </div>
      {/* Two different undos, and conflating them would be the worst outcome:
          one puts FILES back, the other makes the model forget. Named for what
          each actually does rather than both being "Undo". */}
      <div className="bot-rail__routines">
        <button
          type="button"
          className="bot-rail__routines-open"
          onClick={() => window.hydo?.undoLast?.(agent?.id)}
        >
          <span className="bot-rail__notify-title">Forget the last message</span>
        </button>
        <p>Rewinds the last exchange out of its memory. Nothing on your disk changes.</p>
      </div>
      <div className="bot-rail__routines">
        <button type="button" className="bot-rail__routines-open" onClick={onOpenUndo}>
          <span className="bot-rail__notify-title">Undo</span>
          <i className="gb-icon gb-icon-chevron-right" />
        </button>
        <p>Put back files this Bot changed on your disk.</p>
      </div>
      {/* THIS IS NOT THE TOGGLE ABOVE, and the two wearing the same word was
          most of the problem: the switch is permission to use a shared Ubuntu
          machine, this opens the folder ON YOUR DISK that this one teammate
          reads and writes. One bare button said neither of those things.

          It also used to be fire-and-forget: `openWorkspace` answers
          {ok, path} or {ok:false, reason}, and every one of those answers was
          thrown away — so a bot with no workspace yet, or a folder the shell
          refused to open, produced a button that did nothing at all and said
          nothing about it. The path is worth showing on success too: "its
          files" is abstract until you can see where they are. */}
      <div className="bot-rail__workspace">
        <span className="bot-rail__notify-title">Workspace on this Mac</span>
        <button
          type="button"
          className="ghost ghost--solid"
          onClick={async () => {
            setWorkspace({ busy: true });
            try {
              const res = await window.hydo?.openWorkspace?.(agent?.id);
              if (!res) setWorkspace({ error: "This build cannot open folders." });
              else if (res.ok) setWorkspace({ path: res.path });
              else setWorkspace({ error: res.reason || "Could not open it." });
            } catch (err) {
              setWorkspace({ error: err?.message || "Could not open it." });
            }
          }}
        >
          {workspace.busy ? "Opening…" : "Open workspace"}
        </button>
        {workspace.error ? (
          <p className="bot-rail__workspace-note is-bad">{workspace.error}</p>
        ) : workspace.path ? (
          <p className="bot-rail__workspace-note">{workspace.path}</p>
        ) : (
          <p className="bot-rail__workspace-note">
            The folder on your disk this Bot reads and writes — not the shared
            Linux machine above. Everything it makes lands here.
          </p>
        )}
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
