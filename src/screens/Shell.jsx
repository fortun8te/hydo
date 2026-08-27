import { useEffect, useMemo, useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";
import Settings from "./Settings.jsx";
import Sidebar from "./Sidebar.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Composer from "./Composer.jsx";
import BotRail from "./BotRail.jsx";
import ChannelRail from "./ChannelRail.jsx";
import ChannelCreate from "./ChannelCreate.jsx";
import BotCreate from "./BotCreate.jsx";
import Plugins from "./Plugins.jsx";
import Sheet from "./Sheet.jsx";
import Transcript from "./Transcript.jsx";
import RoutineRail from "./RoutineRail.jsx";
import Rollback from "./Rollback.jsx";
import Artifact from "./Artifact.jsx";
import ContextMenu from "./ContextMenu.jsx";
import CommandPalette from "./CommandPalette.jsx";
import FindInChat from "./FindInChat.jsx";
import { matchEvent } from "../lib/shortcuts.js";
import { botBusy, botWorks, channelWorks } from "../lib/working.js";
import { LINGER_MS } from "../lib/presence.js";

function pairKey(a, b) {
  return [a, b].sort().join(":");
}

export default function Shell({ state }) {
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

  const selected = entries.find((e) => e.id === state.selectedId) || entries[0] || null;
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

  useEffect(() => {
    setDraft(selected?.draft || "");
    setRoutineId(null);
    setDmPeerId(null);
    setArtifactId(null);
    setComposerMenu(false);
    setReplyTo(null);
    setTitleEdit(false);
  }, [selected?.id]);

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

  useEffect(() => {
    const needTick = String(draft || "").trim() || sending || workingHere || linger;
    if (!needTick) return undefined;
    setClock(Date.now());
    const id = setInterval(() => setClock(Date.now()), 240);
    return () => clearInterval(id);
  }, [draft, sending, workingHere, linger]);

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
      case "sand.toggleSidebar": setCollapsed((v) => !v); break;
      case "sand.toggleInfo":
      case "sand.toggleAgentSettings":
        setRail((r) => (r ? null : isChannel ? "channel" : "bot"));
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
    setPaletteOpen(false);
  }

  useEffect(() => {
    function onKey(e) {
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
    setLastKeyAt(Date.now());
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
    setLastKeyAt(Date.now());
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
        selectedId={selected?.id}
        query={query}
        onQuery={setQuery}
        collapsed={collapsed}
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
        userName={state.settings.userName}
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
          <button
            type="button"
            className="icon-btn"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <i className="gb-icon gb-icon-settings-gear" />
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
            draft={draft}
            lastKeyAt={lastKeyAt}
            composeAt={composeAt}
            since={since}
            clock={clock}
            dm={!!peer}
            onChoose={(messageId, choiceId) => window.hydo.choose(messageId, choiceId)}
            onReply={(msg) =>
              setReplyTo({ id: msg.id, text: String(msg.text || ""), fromId: msg.fromId || null })
            }
            onOpenArtifact={(id) => {
              setArtifactId(id);
              setRail(null);
            }}
            onJumpTo={(id) => {
              const el = document.getElementById(`msg-${id}`);
              el?.scrollIntoView({ block: "center", behavior: "smooth" });
              el?.classList.add("is-flash");
              setTimeout(() => el?.classList.remove("is-flash"), 1200);
            }}
            onCustomChoice={(messageId, text) => window.hydo.chooseCustom?.(messageId, text)}
            onOpenDm={(id) => setDmPeerId(id)}
            onOpenRoutine={(id) => {
              setRoutineId(id);
              setRail("routines");
            }}
          />
        ) : (
          <div
            className="sand-home"
            /* The glow follows the pointer. A fixed pool is wallpaper; one
               that leans toward you is the only cheap way a static screen
               feels like it noticed you arrive. Written as CSS vars so the
               move handler never triggers a React render. */
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
              const y = (e.clientY - r.top) / r.height;
              e.currentTarget.style.setProperty("--glow-x", `${x * 46}px`);
              e.currentTarget.style.setProperty("--glow-lift", `${(1 - y) * 26}px`);
              e.currentTarget.style.setProperty("--glow-boost", String(1 + (1 - y) * 0.5));
            }}
            onPointerLeave={(e) => {
              e.currentTarget.style.setProperty("--glow-x", "0px");
              e.currentTarget.style.setProperty("--glow-lift", "0px");
              e.currentTarget.style.setProperty("--glow-boost", "1");
            }}
          >
            {/* An empty app should show you the thing it makes, not a sentence
                pointing at a button in the corner. */}
            <div className="sand-home__marks" aria-hidden="true">
              {["cyan", "purple", "orange"].map((tint, i) => (
                <UmbraFace
                  key={tint}
                  className={`sand-home__mark sand-home__mark--${i}`}
                  tint={tint}
                  shape={["squircle", "blob", "hex"][i]}
                  size={i === 0 ? 92 : 62}
                  live
                  mood="fidget"
                  poke
                />
              ))}
            </div>
            <h1 className="sand-home__title">No teammates yet</h1>
            <p className="sand-home__sub">
              A teammate is a person-shaped thing with its own memory, its own
              workspace and its own tools. Make one and tell it what it is for.
            </p>
            <div className="sand-home__actions">
              <button type="button" className="ghost ghost--solid" onClick={() => setBotCreate(true)}>
                New teammate
              </button>
              <button type="button" className="ghost" onClick={() => setChannelCreate(true)}>
                New channel
              </button>
            </div>
          </div>
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
        <Artifact artifactId={artifactId} onClose={() => setArtifactId(null)} />
      ) : null}

      {rail === "undo" && selected && !isChannel && (
        <Rollback agent={selected} onClose={() => setRail("bot")} />
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
        <Settings
          settings={state.settings}
          selectedId={selected?.id}
          selectedKind={selected?.kind}
          members={isChannel ? selected?.members : null}
          onClose={() => setSettingsOpen(false)}
          onChange={(patch) => window.hydo.setSettings(patch)}
          onSignOut={() => window.hydo.signOut()}
        />
      )}
      {pluginsOpen && <Plugins onClose={() => setPluginsOpen(false)} />}
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
          <p>Hydo 0.1.0</p>
          <p className="mute">Hydo Bot. Hermes Agent underneath.</p>
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
