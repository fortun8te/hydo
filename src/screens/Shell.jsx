import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";
import Sidebar from "./Sidebar.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Composer from "./Composer.jsx";
import BotRail from "./BotRail.jsx";
import ChannelRail from "./ChannelRail.jsx";
import ChannelCreate from "./ChannelCreate.jsx";
import BotCreate from "./BotCreate.jsx";
import Home from "./Home.jsx";
import ComputerRail from "./ComputerRail.jsx";
import Sheet from "./Sheet.jsx";
import Transcript from "./Transcript.jsx";
import RoutineRail from "./RoutineRail.jsx";
import ContextMenu from "./ContextMenu.jsx";
import CommandPalette from "./CommandPalette.jsx";
import FindInChat from "./FindInChat.jsx";
import { matchEvent, isTypingTarget } from "../lib/shortcuts.js";
import { botBusy, botWorks, channelWorks } from "../lib/working.js";
import { LINGER_MS } from "../lib/presence.js";

/* --------------------------------------------------------------------------
   Overlays that are rare, and therefore not in the launch chunk.

   Every one of these is already mounted conditionally below (`settingsOpen`,
   `pluginsOpen`, `rail === "undo"`, `artifactId`, `sheet === "about"`), so a
   session that never opens them never paid for their code — except that a
   static import put them in the one chunk anyway. Together they were ~64 kB of
   source parsed before the first message could paint.

   The transcript, composer, sidebar and rails are deliberately NOT here: you
   hit those within a frame of launch, and trading their bytes for a chunk
   fetch would make the app worse, not better.

   `prefetchOverlays()` below warms them once the app is idle, so the first
   click on Settings is still instant — the load moved off the critical path
   rather than onto the click.
   -------------------------------------------------------------------------- */
const Settings = lazy(() => import("./Settings.jsx"));
const About = lazy(() => import("./About.jsx"));
const Plugins = lazy(() => import("./Plugins.jsx"));
const Rollback = lazy(() => import("./Rollback.jsx"));
const Artifact = lazy(() => import("./Artifact.jsx"));

// Kept in one place so the prefetch can never drift out of sync with the list
// of lazy overlays above.
const OVERLAY_LOADERS = [
  () => import("./Settings.jsx"),
  () => import("./About.jsx"),
  () => import("./Plugins.jsx"),
  () => import("./Rollback.jsx"),
  () => import("./Artifact.jsx"),
];

let overlaysPrefetched = false;
function prefetchOverlays() {
  if (overlaysPrefetched) return;
  overlaysPrefetched = true;
  for (const load of OVERLAY_LOADERS) load().catch(() => {});
}

function pairKey(a, b) {
  return [a, b].sort().join(":");
}

// Home is switched off, not removed. The dashboard is a second front door and
// right now it competes with the roster for the same job — you land on it,
// look at cards about your teammates, and then click through to the teammate
// you were going to open anyway. Home.jsx stays whole (its empty state is
// still the landing when you have nobody yet), the CSS stays, and flipping
// this one constant back to `true` restores the row and the destination.
const HOME_ENABLED = false;

// The account row in the sidebar wants the person's full name. The store still
// seeds `settings.userName` with a bare first name from an early default, and
// a first name alone reads like a nickname sitting under "Plugins". Until
// settings grows a real full-name field, resolve it here: an explicit
// `userFullName` wins, then a `userName` that already carries a surname, then
// the account holder.
const ACCOUNT_FULL_NAME = "Michael Knaap";

// "When did they last touch a key", rounded to the second.
//
// The only readers are presence.js, which compares it against a 45s idle
// window and a 49.2s leave window, and the clock that evaluates those
// comparisons only ticks every 240ms. So sub-second precision was never
// visible — but an exact `Date.now()` changed the `lastKeyAt` prop on every
// single keystroke, which defeated the memo on Transcript and re-rendered the
// whole message list per character. Rounded, it changes at most once a second
// while you type, and the blob's fade moves by under a second in a
// forty-five-second hysteresis, which is not a thing anyone can see.
function keyStamp() {
  return Math.floor(Date.now() / 1000) * 1000;
}
function accountName(settings) {
  const full = String(settings?.userFullName || "").trim();
  if (full) return full;
  const named = String(settings?.userName || "").trim();
  if (named.includes(" ")) return named;
  return ACCOUNT_FULL_NAME;
}

export default function Shell({ state }) {
  if (typeof window !== "undefined") { window.__rc = window.__rc || {}; window.__rc.Shell = (window.__rc.Shell || 0) + 1; }

  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [lastKeyAt, setLastKeyAt] = useState(0);
  const [composeAt, setComposeAt] = useState(0);
  const [since, setSince] = useState(0);
  const [clock, setClock] = useState(0);
  const [sending, setSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [rail, setRail] = useState(null);
  const [routineId, setRoutineId] = useState(null);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [menu, setMenu] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  // Below this the roster cannot show a name, a time and a preview line
  // without all three being useless, so it becomes the icon rail it already
  // has styles for. Measured against the layout, not picked as a round number:
  // the sidebar is 260px and the transcript's bubbles stop being readable
  // under about 620.
  const [tooNarrow, setTooNarrow] = useState(false);
  const [dmPeerId, setDmPeerId] = useState(null);
  const [linger, setLinger] = useState(false);
  // When the current linger began, so presence can fade at the end of it
  // rather than marking the whole thing as "leaving" from the first frame.
  const [lingerSince, setLingerSince] = useState(0);
  const [composerMenu, setComposerMenu] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  // The entry a Delete is waiting on. Deleting takes the whole transcript with
  // it and the store has no undo, so it goes through a modal.
  const [confirmDelete, setConfirmDelete] = useState(null);
  // The artifact currently open in the right-hand pane.
  const [artifactId, setArtifactId] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [channelCreate, setChannelCreate] = useState(false);
  const [botCreate, setBotCreate] = useState(false);
  const [titleEdit, setTitleEdit] = useState(false);
  const [titleName, setTitleName] = useState("");

  const agents = state.agents || [];
  const channels = state.channels || [];

  // Bots and channels share one roster and one selection.
  // Pinned entries group above the rest; within a group it is most-recent
  // first. Hidden entries stay in state (and stay reachable) but leave the list.
  const entries = useMemo(
    () =>
      agents
        .map((a) => ({ ...a, kind: "bot" }))
        .concat(channels.map((c) => ({ ...c, kind: "channel" })))
        .filter((e) => !e.hidden)
        .sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
        }),
    [agents, channels]
  );

  // Home is chosen, not fallen back to. `entries[0]` is still the default on a
  // fresh launch; "home" is the one value that means "show me the dashboard
  // even though I have teammates". With HOME_ENABLED off that choice cannot be
  // made — a persisted `selectedId: "home"` from before the flag flipped falls
  // through to the first conversation instead of stranding you on a screen
  // there is no longer a row for.
  const atHome = HOME_ENABLED && state.selectedId === "home";
  const selected = atHome
    ? null
    : entries.find((e) => e.id === state.selectedId) || entries[0] || null;
  const isChannel = selected?.kind === "channel";
  const peer = dmPeerId ? agents.find((a) => a.id === dmPeerId) || null : null;

  const thread = useMemo(() => {
    if (!selected) return [];
    if (peer) return state.dms?.[pairKey(selected.id, peer.id)] || [];
    return state.messages?.[selected.id] || [];
  }, [selected, peer, state.dms, state.messages]);

  const routines = selected && !isChannel ? state.routines?.[selected.id] || [] : [];

  const roster = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.label || "").toLowerCase().includes(q) ||
        (e.last || "").toLowerCase().includes(q) ||
        (e.draft || "").toLowerCase().includes(q)
    );
  }, [query, entries]);

  /* ------------------------------------------------------------------------
     Transcript is memoised (see Transcript.jsx). These seven handlers were
     inline arrows, so every Shell render minted seven new functions and the
     memo would never have held. All of them close over nothing but setState
     setters and `window.hydo`, both of which are stable for the life of the
     component, so `[]` is the honest dependency list.
     ---------------------------------------------------------------------- */
  const onChoose = useCallback((messageId, choiceId) => window.hydo.choose(messageId, choiceId), []);
  const onCustomChoice = useCallback(
    (messageId, text) => window.hydo.chooseCustom?.(messageId, text),
    []
  );
  const onOpenDm = useCallback((id) => setDmPeerId(id), []);
  const onReply = useCallback(
    (msg) => setReplyTo({ id: msg.id, text: String(msg.text || ""), fromId: msg.fromId || null }),
    []
  );
  const onOpenArtifact = useCallback((id) => {
    setArtifactId(id);
    setRail(null);
  }, []);
  const onOpenRoutine = useCallback((id) => {
    setRoutineId(id);
    setRail("routines");
  }, []);
  const onJumpTo = useCallback((id) => {
    const el = document.getElementById(`msg-${id}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.classList.add("is-flash");
    setTimeout(() => el?.classList.remove("is-flash"), 1200);
  }, []);

  // Warm the lazy overlay chunks once the app has settled. requestIdleCallback
  // so this never competes with first paint or the first frames of the blob
  // faces; the timeout fallback covers engines without it.
  useEffect(() => {
    const idle =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(prefetchOverlays, { timeout: 3000 })
        : setTimeout(prefetchOverlays, 1500);
    return () => {
      if (typeof cancelIdleCallback === "function" && typeof requestIdleCallback === "function") {
        cancelIdleCallback(idle);
      } else {
        clearTimeout(idle);
      }
    };
  }, []);

  useEffect(() => {
    setDraft(selected?.draft || "");
    setRoutineId(null);
    setDmPeerId(null);
    setArtifactId(null);
    setComposerMenu(false);
    setReplyTo(null);
    setTitleEdit(false);
  }, [selected?.id]);

  // The transcript only ever asked "is the composer empty?" — presence.js reads
  // no character of the draft (see draftIsFilled there). Handing it the string
  // meant a new prop value on every keystroke; the boolean changes once per
  // message, which is what lets the memo on Transcript actually hold.
  const draftFilled = String(draft || "").trim().length > 0;

  // The window is a window: it gets dragged narrow, and half-screened next to
  // a browser. The rail is not a fallback, it IS the narrow layout . which is
  // why the manual toggle still works above the breakpoint and is simply
  // overruled below it.
  useEffect(() => {
    if (typeof matchMedia !== "function") return undefined;
    const mq = matchMedia("(max-width: 880px)");
    const on = () => setTooNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    // AND resize. `change` is the right API and fires on a real window drag,
    // but it is one signal and this has to be right while somebody is
    // dragging the corner. `resize` fires constantly and setState with an
    // unchanged boolean is a no-op, so the redundancy is free.
    window.addEventListener("resize", on);
    return () => {
      mq.removeEventListener("change", on);
      window.removeEventListener("resize", on);
    };
  }, []);

  useEffect(() => {
    document.getElementById("transcript-end")?.scrollIntoView({ block: "end" });
  }, [thread.length, sending, linger]);

  // Linger only for work in *this* conversation — never `status === "working"`,
  // which would keep the 1:1 row spinning while the bot is busy in a channel.
  //
  // This also drives the composer's STOP button. `sending` alone is not enough:
  // it is true only while the send IPC is in flight, and a bot that yields its
  // first job to the background resolves that call immediately and keeps
  // working. Bound to `sending`, stop vanished at the exact moment you wanted
  // it and the only way to reach the bot was to type "stop" and hope.
  const workingHere = selected
    ? isChannel
      ? channelWorks(selected, agents)
      : botWorks(selected, selected.id)
    : false;
  useEffect(() => {
    if (sending || workingHere) {
      setLinger(true);
      setLingerSince(0);
      return undefined;
    }
    setLingerSince(Date.now());
    const t = setTimeout(() => setLinger(false), LINGER_MS);
    return () => clearTimeout(t);
  }, [sending, workingHere]);

  // `draftFilled`, not `draft`. Keyed on the string, this effect tore down and
  // rebuilt a 240ms interval on EVERY keystroke and fired an extra
  // `setClock` render with it — 40 interval churns and 40 surplus renders in a
  // forty-character message, to arrive at exactly the same ticking clock. The
  // only thing it wants to know is whether the composer has anything in it.
  useEffect(() => {
    const needTick = draftFilled || sending || workingHere || linger;
    if (!needTick) return undefined;
    setClock(Date.now());
    const id = setInterval(() => setClock(Date.now()), 240);
    return () => clearInterval(id);
  }, [draftFilled, sending, workingHere, linger]);

  // Is the shared machine awake? Read on mount and after the sheet closes,
  // not on a timer: this is a CLI round-trip, and a header icon is not worth
  // polling a paid service for.
  const [boxUp, setBoxUp] = useState(false);
  useEffect(() => {
    let gone = false;
    Promise.resolve(window.hydo?.boxStatus?.())
      .then((s) => {
        if (!gone) setBoxUp(!!(s && s.state === "running"));
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [sheet, rail]);

  // Whose plan the composer shows. In a channel it is whoever is actually
  // working, because two open plans is two things to read and the one that
  // matters is the one being executed.
  const planOwner = (() => {
    if (!selected) return null;
    if (!isChannel) return (selected.todos || []).length ? selected : null;
    const members = agents.filter((a) => (selected.members || []).map(String).includes(String(a.id)));
    return (
      members.find((a) => botWorks(a, selected.id) && (a.todos || []).length) ||
      members.find((a) => (a.todos || []).length) ||
      null
    );
  })();
  // The strip's own honesty check. `planOwner` above can fall back to a
  // teammate that merely HAS a plan (last resort, so the strip still shows
  // something) — that fallback must not silently make PlanCard say a step is
  // live. `botWorks` against the open conversation is the same test the face
  // and pip use, so "active" here can never disagree with "spinning" there.
  const planRunning = !!(planOwner && selected && botWorks(planOwner, selected.id));

  /**
   * Hand files to the selected teammate through the native picker.
   *
   * The IPC for this (`pickFiles` + `attachAny`) was written and then never
   * called from anywhere. The only way to attach was to RIGHT-CLICK the plus
   * button, which opened a hidden `<input accept="image/*">` . so it was both
   * undiscoverable and images-only, while Hydo can preview around 222 types
   * and Hermes takes pdfs and documents as first-class turn content.
   */
  async function attachFiles() {
    if (!selected) return;
    setComposerMenu(false);
    const picked = await window.hydo?.pickFiles?.();
    const files = (picked && picked.files) || [];
    if (!files.length) return;
    const failed = [];
    for (const f of files) {
      const res = await window.hydo?.attachAny?.(selected.id, f.path);
      if (!res || !res.ok) failed.push(f.name);
    }
    // Say so in the composer rather than failing silently: an attachment that
    // did not arrive is invisible, and the user would go on to ask about a
    // file the teammate never received.
    if (failed.length) {
      setDraft((d) => `${d ? `${d} ` : ""}(couldn't attach ${failed.join(", ")})`);
      return;
    }
    const names = files.map((f) => f.name).join(", ");
    setDraft((d) => (d ? `${d} ${names}` : names));
  }

  // One command table drives both the keyboard and the palette, so a chord and
  // a palette row can never drift apart.
  function runCommand(id, payload) {
    const idx = entries.findIndex((e) => e.id === selected?.id);
    const step = (d) => {
      if (!entries.length) return;
      const next = entries[(idx + d + entries.length) % entries.length];
      if (next) window.hydo.select(next.id);
    };
    switch (id) {
      case "sand.commandPalette": setPaletteOpen((v) => !v); break;
      case "sand.findInChat": setFindOpen((v) => !v); break;
      case "sand.newAgent": window.hydo.createAgent(); break;
      case "sand.openSettings": setSettingsOpen(true); break;
      // Same reason as Sidebar's hidden toggle button: below the breakpoint
      // the rail is forced, so flipping `collapsed` here changes nothing on
      // screen and only springs out later when the window is widened again.
      case "sand.toggleSidebar": if (!tooNarrow) setCollapsed((v) => !v); break;
      case "sand.toggleInfo":
      case "sand.toggleAgentSettings":
        setRail((r) => (r ? null : isChannel ? "channel" : "bot"));
        break;
      // These two shipped in the palette (and in shortcuts.js's command list)
      // with no case here at all, so they fell through `default: break` and
      // did nothing — invisible while ⌘K was broken, three dead rows the
      // moment it worked again. Tools live in the bot rail and routines have
      // their own rail; both are simply "open that panel".
      case "sand.openTools":
        if (selected && !isChannel) setRail("bot");
        break;
      case "sand.openWorkflows":
        if (selected && !isChannel) setRail("routines");
        break;
      case "sand.nextAgent": step(1); break;
      case "sand.previousAgent": step(-1); break;
      case "sand.focusSearch":
        document.querySelector(".sand-search input")?.focus();
        break;
      case "sand.focusInput":
        document.querySelector(".sand-composer__input")?.focus();
        break;
      case "sand.goToAgent":
        if (payload?.agentId) window.hydo.select(payload.agentId);
        break;
      case "sand.navigateBack": setDmPeerId(null); setRail(null); break;
      default: break;
    }
    // Everything else closes the palette after running (that is the point of
    // picking a row). The palette's OWN command must be exempt: this line ran
    // unconditionally, so `sand.commandPalette` toggled `paletteOpen` on and
    // then this set it straight back to false in the same batch — ⌘K, and the
    // "Command Palette" row itself, could never open it. Fully wired end to
    // end (KEYMAP -> matchEvent -> runCommand -> <CommandPalette open=…/>)
    // and silently dead.
    if (id !== "sand.commandPalette") setPaletteOpen(false);
  }

  useEffect(() => {
    function onKey(e) {
      // Escape closed every modal surface (palette, find, sheets, dialogs)
      // but NOT the right-hand rails or the artifact viewer, which are the two
      // things that cover the transcript for the longest — the only way out
      // was to find the small chevron in their header. `defaultPrevented`
      // keeps the composer's own Escape (slash menu, cancel-reply) first, and
      // the DOM check keeps a stacked modal's Escape from also collapsing the
      // rail behind it: state names can drift, "is a dialog on screen" cannot.
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        if (isTypingTarget(e.target)) return;
        if (document.querySelector(".hy-dialog, .hy-palette, .hy-find, .hy-sheet, [role='dialog']")) return;
        if (artifactId) {
          e.preventDefault();
          setArtifactId(null);
          return;
        }
        if (rail) {
          e.preventDefault();
          setRail(null);
        }
        return;
      }
      const id = matchEvent(e);
      if (!id || id === "sand.send") return;
      e.preventDefault();
      runCommand(id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function send(extra = {}) {
    const text = draft.trim();
    const images = Array.isArray(extra.images) ? extra.images : [];
    if ((!text && !images.length) || sending) return;
    setDraft("");
    setComposeAt(0);
    setSince(Date.now());
    setComposerMenu(false);
    const replying = replyTo;
    setReplyTo(null);
    setSending(true);
    try {
      await window.hydo.send(text, {
        ...(replying ? { replyTo: replying.id } : {}),
        ...(images.length ? { images } : {}),
      });
    } finally {
      setSending(false);
    }
  }

  function onDraft(value) {
    const wasEmpty = !String(draft || "").trim();
    const nextEmpty = !String(value || "").trim();
    setDraft(value);
    setLastKeyAt(keyStamp());
    if (wasEmpty && !nextEmpty) setComposeAt(Date.now());
    if (nextEmpty) setComposeAt(0);
    if (value.startsWith("/")) setComposerMenu(false);
    else if (/(?:^|\s)@[^\s]*$/.test(value)) setComposerMenu(false);
    else if (composerMenu && !value) setComposerMenu(false);
    if (selected) window.hydo.setDraft(selected.id, value);
  }

  function pickMention(agent) {
    const next = `@${agent.name} `;
    const wasEmpty = !String(draft || "").trim();
    setDraft(next);
    setLastKeyAt(keyStamp());
    if (wasEmpty) setComposeAt(Date.now());
    setComposerMenu(false);
    if (selected) window.hydo.setDraft(selected.id, next);
  }

  // Every bot, including the one whose thread this is. Excluding it meant
  // that in a 1:1 with your only teammate, `@` offered nothing but
  // "everyone" — you could not tag Finn in Finn's own chat.
  const mentionables = agents;
  const members = isChannel
    ? (selected.members || []).map((id) => agents.find((a) => a.id === id)).filter(Boolean)
    : [];

  return (
    <div className="sand-shell">
      <Sidebar
        entries={roster}
        agents={agents}
        sections={state.sections || []}
        selectedId={atHome ? "home" : selected?.id}
        query={query}
        onQuery={setQuery}
        collapsed={collapsed || tooNarrow}
        canToggle={!tooNarrow}
        onToggle={() => setCollapsed((v) => !v)}
        onCreate={() => setBotCreate(true)}
        onCreateBot={() => setBotCreate(true)}
        onCreateChannel={() => setChannelCreate(true)}
        onSelect={(id) => window.hydo.select(id)}
        onMenu={setMenu}
        onDelete={(list) => setConfirmDelete(Array.isArray(list) ? list : [list])}
        onPin={(entry) => window.hydo.setPinned?.(entry.id, !entry.pinned)}
        onMarkUnread={(entry) => window.hydo.setUnread?.(entry.id, true)}
        onHide={(entry) => window.hydo.setHidden?.(entry.id, true)}
        onDuplicate={(entry) => window.hydo.duplicateAgent?.(entry.id)}
        onEditProfile={(entry) => {
          window.hydo.select(entry.id);
          setRail(entry.kind === "channel" ? "channel" : "bot");
        }}
        onCopyId={(entry) => navigator.clipboard?.writeText(entry.id)}
        onPlugins={() => setPluginsOpen(true)}
        showHome={HOME_ENABLED}
        userName={accountName(state.settings)}
        userAvatar={state.settings.userAvatar}
        accountOpen={accountOpen}
        onAccountToggle={setAccountOpen}
        onSettings={() => setSettingsOpen(true)}
        onAbout={() => setSheet("about")}
        onHelp={() => setSheet("help")}
        onFeedback={() => setSheet("feedback")}
        onSignOut={() => window.hydo.signOut()}
        sendingId={sending ? selected?.id : null}
      />

      <main className="sand-main">
        {botCreate && (
          <BotCreate
            agents={agents}
            onClose={() => setBotCreate(false)}
            onCreate={(patch) => {
              window.hydo.createAgent(patch);
              setBotCreate(false);
            }}
            onOpen={(id) => {
              window.hydo.select(id);
              setBotCreate(false);
            }}
          />
        )}
        <header className="sand-titlebar">
          {selected && !botCreate && (
            <div className="sand-header-bot">
              {peer ? (
                <>
                  <UmbraFace tint={selected.blob} shape={selected.shape} size={22} />
                  {selected.name}
                  <span className="mute"> ↔ </span>
                  <UmbraFace tint={peer.blob} shape={peer.shape} size={22} />
                  {peer.name}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="sand-header-bot__mark"
                    title={isChannel ? "Channel" : "Bot"}
                    onClick={() => setRail(isChannel ? "channel" : "bot")}
                  >
                    {isChannel ? (
                      <i className="gb-icon gb-icon-hash" />
                    ) : (
                      <span className="sand-header-bot__face">
                        <UmbraFace
                          tint={selected.blob}
                          shape={selected.shape}
                          size={22}
                          live={sending || botBusy(selected) || botWorks(selected, selected.id)}
                          mood={sending || botBusy(selected) || botWorks(selected, selected.id) ? "spin" : "idle"}
                          poke
                        />
                        {/* Same rule as the roster: a pip is a claim about a
                            turn that is actually running. This one was
                            hardcoded and said "Online" forever. */}
                        {botWorks(selected, selected.id) || sending ? (
                          <span className="sand-row__dot is-work" title="Working" aria-label="Working" />
                        ) : null}
                      </span>
                    )}
                  </button>
                  {titleEdit ? (
                    <form
                      className="sand-header-bot__form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const value = titleName.trim() || selected.name;
                        if (isChannel) window.hydo.setChannel?.(selected.id, { name: value });
                        else window.hydo.setAgent(selected.id, { name: value });
                        setTitleEdit(false);
                      }}
                    >
                      <input
                        className="sand-header-bot__input"
                        autoFocus
                        value={titleName}
                        onChange={(e) => setTitleName(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onBlur={() => {
                          const value = titleName.trim() || selected.name;
                          if (isChannel) window.hydo.setChannel?.(selected.id, { name: value });
                          else window.hydo.setAgent(selected.id, { name: value });
                          setTitleEdit(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setTitleEdit(false);
                          }
                        }}
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="sand-header-bot__name"
                      title="Rename"
                      onClick={() => {
                        setTitleName(selected.name);
                        setTitleEdit(true);
                      }}
                    >
                      {selected.name}
                    </button>
                  )}
                  {isChannel ? (
                    <span className="mute sand-header-bot__count">
                      {members.length} {members.length === 1 ? "member" : "members"}
                    </span>
                  ) : null}
                </>
              )}
            </div>
          )}
          <span className="grow" />
          {/* The computer, and nothing beside it.
              This is the single top-right affordance now. A gear used to sit
              here too, and two icons in a corner is one icon too many: the
              gear was a duplicate of a door you already have in two places
              (the account menu at the foot of the sidebar, and the command
              palette), while the computer has no other entrance at all.

              The computer, in the header.
              It was in the sidebar footer next to Plugins, which reads as a
              settings page you go and configure. It is not . it is the machine
              your teammates are working on, so it belongs where you already
              are when you wonder what one of them is doing. Always present:
              the screen it opens explains the machine whether or not it
              happens to be awake, and an icon that appears and disappears is
              one you never learn the position of. */}
          <button
            type="button"
            className={boxUp ? "icon-btn is-live" : "icon-btn"}
            title={boxUp ? "The computer is awake" : "Computer"}
            aria-label="Computer"
            onClick={() => setRail((r) => (r === "computer" ? null : "computer"))}
          >
            {/* `device-desktop`, not `desktop`. The icon kit ships 523 named
                glyphs and `gb-icon-desktop` is not one of them, so this
                button has been rendering an empty 0x0 box in the corner for
                as long as it has existed — the class matched no ::before
                rule at all. `gb-icon-device-desktop` is the real monitor. */}
            <i className="gb-icon gb-icon-device-desktop" />
          </button>
        </header>

        {selected ? (
          <Transcript
            thread={thread}
            agents={agents}
            selected={selected}
            channel={isChannel ? selected : null}
            sending={sending && !peer}
            linger={(linger || workingHere) && !peer}
            lingerSince={lingerSince}
            draft={draftFilled}
            lastKeyAt={lastKeyAt}
            composeAt={composeAt}
            since={since}
            clock={clock}
            dm={!!peer}
            onChoose={onChoose}
            onReply={onReply}
            onOpenArtifact={onOpenArtifact}
            onJumpTo={onJumpTo}
            onCustomChoice={onCustomChoice}
            onOpenDm={onOpenDm}
            onOpenRoutine={onOpenRoutine}
          />
        ) : (
          <Home
            agents={agents}
            channels={state.channels || []}
            routines={state.routines || {}}
            artifacts={state.artifacts || []}
            userName={state.settings?.userName}
            onOpen={(id) => window.hydo?.select?.(id)}
            onNewBot={() => setBotCreate(true)}
            onNewChannel={() => setChannelCreate(true)}
            onOpenRoutine={(botId, routineId) => {
              window.hydo?.select?.(botId);
              setRoutineId(routineId);
              setRail("routines");
            }}
            onOpenArtifact={(id) => setArtifactId(id)}
          />
        )}

        {/* No teammate, nothing to message. A composer on the home screen is a
            box that cannot send, sitting under a screen whose whole job is to
            get you to make the thing it would send to. */}
        {!selected ? null : peer ? (
          <div className="sand-viewonly">
            <span className="mute">This chat is view-only</span>
            <button type="button" className="ghost" onClick={() => setDmPeerId(null)}>
              Close Chat
            </button>
          </div>
        ) : (
          <Composer
            key={selected?.id || "none"}
            draft={draft}
            onDraft={onDraft}
            onSend={send}
            onStop={() => selected && window.hydo.interrupt?.(selected.id)}
            placeholder={selected ? `Message ${selected.name}` : "Message"}
            mentionables={mentionables}
            menuOpen={composerMenu}
            onMenuToggle={setComposerMenu}
            onPickMention={pickMention}
            onNewBot={() => {
              setComposerMenu(false);
              setBotCreate(true);
            }}
            onNewChannel={() => {
              setComposerMenu(false);
              setChannelCreate(true);
            }}
            onAttach={attachFiles}
            todos={planOwner?.todos}
            planOwner={planOwner?.name}
            planRunning={planRunning}
            onSlashAction={(id) => runCommand(id)}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            busy={sending || workingHere}
          />
        )}
      </main>

      {rail === "bot" && selected && !isChannel && (
        <BotRail
          agent={selected}
          onClose={() => setRail(null)}
          onChange={(patch) => window.hydo.setAgent(selected.id, patch)}
          onOpenRoutines={() => {
            setRoutineId(null);
            setRail("routines");
          }}
          onOpenUndo={() => setRail("undo")}
          onCreateRoutine={async () => {
            const next = await window.hydo.createRoutine({
              name: "",
              instruction: "",
              triggers: [{ kind: "schedule", cadence: "once" }],
            });
            const list = next.routines?.[selected.id] || [];
            setRail("routines");
            if (list[0]) setRoutineId(list[0].id);
          }}
        />
      )}

      {artifactId ? (
        <Suspense fallback={null}>
          <Artifact artifactId={artifactId} onClose={() => setArtifactId(null)} />
        </Suspense>
      ) : null}

      {rail === "computer" && (
        <ComputerRail
          agent={selected && !isChannel ? selected : null}
          onClose={() => setRail(null)}
          onOpenRoutines={() => {
            setRoutineId(null);
            setRail("routines");
          }}
          onCreateRoutine={async () => {
            if (!selected || isChannel) return;
            const next = await window.hydo.createRoutine({
              name: "",
              instruction: "",
              triggers: [{ kind: "schedule", cadence: "once" }],
            });
            const list = next.routines?.[selected.id] || [];
            setRail("routines");
            if (list[0]) setRoutineId(list[0].id);
          }}
        />
      )}

      {rail === "undo" && selected && !isChannel && (
        <Suspense fallback={null}>
          <Rollback agent={selected} onClose={() => setRail("bot")} />
        </Suspense>
      )}

      {rail === "channel" && selected && isChannel && (
        <ChannelRail
          channel={selected}
          agents={agents}
          onClose={() => setRail(null)}
          onChange={(patch) => window.hydo.setChannel?.(selected.id, patch)}
          onToggleMember={(id) => window.hydo.toggleChannelMember?.(selected.id, id)}
        />
      )}

      {rail === "routines" && selected && !isChannel && (
        <RoutineRail
          agent={selected}
          routines={routines}
          selectedId={routineId}
          onSelect={setRoutineId}
          onClose={() => setRail(null)}
          onChange={(id, patch) => window.hydo.setRoutine(id, patch)}
          onCreate={async () => {
            const next = await window.hydo.createRoutine({
              name: "",
              instruction: "",
              triggers: [{ kind: "schedule", cadence: "once" }],
            });
            const list = next.routines?.[selected.id] || [];
            if (list[0]) setRoutineId(list[0].id);
          }}
          onDelete={(id) => {
            window.hydo.deleteRoutine(id);
            setRoutineId(null);
          }}
          onRun={(id) => window.hydo.runRoutine(id)}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        agents={agents}
        onRun={runCommand}
        onClose={() => setPaletteOpen(false)}
      />
      <FindInChat
        open={findOpen}
        thread={thread}
        onClose={() => setFindOpen(false)}
        onJump={(id) => {
          const el = document.getElementById(`msg-${id}`);
          el?.scrollIntoView({ block: "center", behavior: "smooth" });
        }}
      />
      {settingsOpen && (
        <Suspense fallback={null}>
        <Settings
          settings={state.settings}
          accountName={accountName(state.settings)}
          selectedId={selected?.id}
          selectedKind={selected?.kind}
          members={isChannel ? selected?.members : null}
          onClose={() => setSettingsOpen(false)}
          onChange={(patch) => window.hydo.setSettings(patch)}
          onSignOut={() => window.hydo.signOut()}
        />
        </Suspense>
      )}
      {pluginsOpen && (
        <Suspense fallback={null}>
          <Plugins onClose={() => setPluginsOpen(false)} />
        </Suspense>
      )}
      {channelCreate && (
        <ChannelCreate
          agents={agents}
          onClose={() => setChannelCreate(false)}
          onCreate={(patch) => {
            window.hydo.createChannel?.(patch);
            setChannelCreate(false);
          }}
        />
      )}
      {sheet === "about" && (
        <Sheet title="About" onClose={() => setSheet(null)}>
          <Suspense fallback={null}>
            <About />
          </Suspense>
        </Sheet>
      )}
      {sheet === "help" && (
        <Sheet title="Help Center" onClose={() => setSheet(null)}>
          <p className="mute">Local help. No Cursor docs loaded.</p>
          <ul className="sheet__list">
            <li>Chat with a Bot from the roster</li>
            <li>Ping another Bot with @Name</li>
            <li>A Channel fans your message out to every member</li>
          </ul>
        </Sheet>
      )}
      {sheet === "feedback" && (
        <Sheet title="Send Feedback" onClose={() => setSheet(null)}>
          <p className="mute">This is a label. Nothing is billed or mailed.</p>
        </Sheet>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}

      {confirmDelete && confirmDelete.length ? (
        <ConfirmDialog
          title={
            confirmDelete.length === 1
              ? `Delete \u201C${confirmDelete[0].name}\u201D`
              : `Delete ${confirmDelete.length} conversations`
          }
          body={
            confirmDelete.length === 1
              ? `This permanently deletes the ${
                  confirmDelete[0].kind === "channel" ? "Channel" : "Bot"
                } and its chat history. This can't be undone.`
              : "This permanently deletes them and their chat history. This can't be undone."
          }
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const list = confirmDelete;
            setConfirmDelete(null);
            const ids = list.map((e) => e.id);
            if (typeof window.hydo.deleteEntries === "function") {
              window.hydo.deleteEntries(ids);
              return;
            }
            for (const entry of list) {
              if (entry.kind === "channel") window.hydo.deleteChannel?.(entry.id);
              else window.hydo.deleteAgent?.(entry.id);
            }
          }}
        />
      ) : null}
    </div>
  );
}
