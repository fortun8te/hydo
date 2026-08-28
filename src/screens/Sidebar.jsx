import { memo, useEffect, useRef, useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";
import AccountMenu from "./AccountMenu.jsx";
import { when } from "../lib/blobs.js";
import { initialOf } from "../lib/marks.js";
import { botBusy, botWorks, channelWorks, moodForWorking } from "../lib/working.js";
import { pipOf } from "../lib/presence.js";
import ActivityMark from "./ActivityMark.jsx";

function moodFor(live) {
  return moodForWorking(live);
}

// The kit's icon font draws `plus` inside a ring and has no plug at all (only
// a slashed one, which would read as "plugins are off"). Both are bare in the
// real app, so draw them here.
function PlusGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M12 5v14M5 12h14"
      />
    </svg>
  );
}

function HashGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M10 4 8 20M17 4 15 20M5 9h15M4 15h15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

// The disclosure triangle on a section heading. Rotated in CSS rather than
// swapped for a second path, so the fold reads as one movement.
function Chevron({ open }) {
  return (
    <span className="sand-section__chev" data-open={open ? "true" : "false"} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="12" height="12">
        <path
          d="M9.2 6.4 15.6 12 9.2 17.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function BotGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="5.5" y="7.5" width="13" height="12" rx="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9.4" cy="13.4" r="1.15" fill="currentColor" />
      <circle cx="14.6" cy="13.4" r="1.15" fill="currentColor" />
      <path d="M12 7.5V5.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="4.2" r="1.05" fill="currentColor" />
    </svg>
  );
}

function PlugGlyph() {
  return (
    <svg className="sand-plug" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.35"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 2.2v5M15 2.2v5M6.2 7.2h11.6v3.6a5.8 5.8 0 0 1-11.6 0V7.2ZM12 16.4v5.4"
      />
    </svg>
  );
}

// A channel wears its members' faces stacked instead of one body: the first
// member sits behind at the top-left, the second in front at the bottom-right,
// overlapping it by about a third. The front face is cut out of the one behind
// by a ring in the row's own background colour (`--sand-row-bg`), the same
// trick the status pip uses, so the two read as two shapes and not a smudge.
// Both faces are drawn smaller than a normal avatar so the composed mark still
// fills the same box a single bot face would — rows stay aligned.
// Written out rather than built with `--${i}` so the class names stay
// greppable from the CSS side.
const FACE_CLASS = [
  "sand-channel-mark__face sand-channel-mark__face--0",
  "sand-channel-mark__face sand-channel-mark__face--1",
  "sand-channel-mark__face sand-channel-mark__face--2",
];

function ChannelMark({ channel, agents }) {
  const members = (channel.members || [])
    .map((id) => agents.find((a) => a.id === id))
    .filter(Boolean)
    .slice(0, 2);

  if (!members.length) {
    return (
      <span className="sand-channel-mark sand-channel-mark--empty" aria-hidden="true">
        <span className="sand-channel-mark__hash">#</span>
      </span>
    );
  }

  return (
    <span className="sand-channel-mark">
      {members.map((m, i) => {
        // Per member, never per channel: one face can be spinning inside a
        // channel mark while the other sits perfectly still.
        const memberLive = botWorks(m, channel.id);
        // No glow here even for a member with it on: FACE_CLASS absolutely
        // positions these three faces overlapping each other (see
        // sand-channel-mark__face--0/1/2 in styles.css). Glow's halo bleeds
        // ~0.31x the face's own size past its silhouette (glow.js GLOW_GEOM,
        // haloR 1.62), which on a 24px face would smear directly into the
        // neighbour it overlaps rather than reading as light.
        return (
          <UmbraFace
            key={m.id}
            className={FACE_CLASS[i]}
            tint={m.blob}
            shape={m.shape}
            size={24}
            live={memberLive}
            mood={moodFor(memberLive)}
            poke
          />
        );
      })}
    </span>
  );
}

function NewMenu({ open, onClose, onBot, onChannel, anchorRef }) {
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (menuRef.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return;
      onClose?.();
    }
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);
  if (!open) return null;
  return (
    <div className="sand-newmenu" role="menu" aria-label="New" ref={menuRef}>
      <button
        type="button"
        role="menuitem"
        className="sand-newmenu__item"
        onClick={() => {
          onBot?.();
          onClose?.();
        }}
      >
        <span className="sand-newmenu__icon" aria-hidden="true">
          <BotGlyph />
        </span>
        New Bot
      </button>
      <button
        type="button"
        role="menuitem"
        className="sand-newmenu__item"
        onClick={() => {
          onChannel?.();
          onClose?.();
        }}
      >
        <span className="sand-newmenu__icon" aria-hidden="true">
          <HashGlyph />
        </span>
        New Channel
      </button>
    </div>
  );
}

// Was this teammate created just now, in this session?
//
// Deliberately a wall-clock window rather than a flag the store clears: the
// roster re-renders constantly, and a flag would need someone to own turning
// it off. A timestamp answers "is this new" without anybody having to
// remember. Six seconds covers the mount plus the opening turn; after that a
// reload must NOT replay the arrival, which is the failure this guards.
// The Unassigned group has no section record, so it needs a stable key of its
// own to remember being folded. A uuid can never collide with it.
const UNASSIGNED_KEY = "unassigned";

const BORN_MS = 6000;
function bornNow(entry) {
  if (!entry || !entry.bornAt) return false;
  const t = new Date(entry.bornAt).getTime();
  return Number.isFinite(t) && Date.now() - t < BORN_MS;
}

function Sidebar({
  entries,
  agents,
  selectedId,
  query,
  onQuery,
  collapsed,
  onToggle,
  // False while the window is narrow enough that the rail is not a choice.
  // Below the breakpoint Shell renders `collapsed || tooNarrow`, so the
  // collapse/expand buttons still painted but could not change anything —
  // a button labelled "Expand sidebar" that did nothing at all when clicked.
  // Hiding it is the honest answer: there is nothing to expand into.
  canToggle = true,
  onCreate,
  onCreateBot,
  onCreateChannel,
  onSelect,
  onMenu,
  onDelete,
  onPin,
  onMarkUnread,
  onHide,
  onDuplicate,
  onEditProfile,
  onCopyId,
  sections = [],
  collapsedSections = [],
  onToggleSection,
  userName,
  userAvatar,
  accountOpen,
  onAccountToggle,
  onPlugins,
  showHome = true,
  onSettings,
  // Both come from Shell, which asks the main process ONCE on mount. A
  // primitive number and a useCallback, so the memo() at the bottom of this
  // file survives them — an inline arrow here would turn it back into a no-op
  // on every keystroke in the composer.
  onUpdate,
  updateBehind = 0,
  onAbout,
  onHelp,
  onFeedback,
  onSignOut,
  sendingId,
}) {

  // Shell resolves the account holder's full name and passes it down; the
  // fallback matches, so a Sidebar rendered without the prop (tests, stories)
  // shows the same row rather than a first name.
  const name = userName || "Michael Knaap";
  const [newOpen, setNewOpen] = useState(null);
  const [picked, setPicked] = useState([]);
  const [naming, setNaming] = useState(null);
  const [renameId, setRenameId] = useState(null);
  const [renameText, setRenameText] = useState("");
  const [rowRenameId, setRowRenameId] = useState(null);
  const [rowRenameText, setRowRenameText] = useState("");
  const topPlus = useRef(null);
  const railPlus = useRef(null);
  const makeBot = onCreateBot || onCreate;
  const makeChannel = onCreateChannel;
  const sectionList = Array.isArray(sections) ? sections : [];
  const foldedKeys = Array.isArray(collapsedSections) ? collapsedSections : [];

  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = String(e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      if (picked.length < 2) return;
      e.preventDefault();
      removeMany(picked);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picked, entries]);

  function groupOf(entry) {
    if (picked.includes(entry.id) && picked.length > 1) {
      return entries.filter((e) => picked.includes(e.id));
    }
    return [entry];
  }

  function crowdLabel(group) {
    const n = group.length;
    if (n === 1) return group[0].kind === "channel" ? "Channel" : "Bot";
    return `${n} Bots`;
  }

  async function makeSection(ids) {
    const next = await window.hydo.createSection?.({ name: "New section", ids });
    const created = (next?.sections || [])[0];
    if (created) {
      setRenameId(created.id);
      setRenameText(created.name);
    }
    setNaming(null);
    setPicked(ids);
  }

  function rowMenu(entry, idsOverride) {
    const group =
      idsOverride && idsOverride.length
        ? entries.filter((e) => idsOverride.includes(e.id))
        : groupOf(entry);
    const ids = group.map((e) => e.id);
    const multi = group.length > 1;
    const one = group[0];
    const isChannel = !multi && one.kind === "channel";
    const currentSection = group.every((e) => e.sectionId === group[0].sectionId)
      ? group[0].sectionId || null
      : undefined;
    const items = [];
    if (!multi) {
      items.push({
        id: "rename-bot",
        label: "Rename",
        icon: "pencil-square",
        onClick: () => {
          setRowRenameId(one.id);
          setRowRenameText(one.name || "");
        },
      });
    }
    items.push({
      id: "pin",
      label: one.pinned ? "Unpin" : "Pin",
      icon: one.pinned ? "pin-slash" : "map-pin",
      onClick: () => group.forEach((e) => onPin?.(e)),
    });
    if (sectionList.length) {
      items.push({
        id: "section-move",
        label: `Move ${crowdLabel(group)} to`,
        icon: "folder",
        submenu: [
          ...sectionList.map((s) => ({
            id: `section-${s.id}`,
            label: s.name,
            icon: "folder",
            checked: currentSection === s.id,
            onClick: () => {
              window.hydo.moveToSection?.(ids, s.id);
              setPicked(ids);
            },
          })),
          {
            id: "section-out",
            label: "Unassigned",
            icon: "folder",
            checked: currentSection === null,
            onClick: () => {
              window.hydo.moveToSection?.(ids, null);
              setPicked(ids);
            },
          },
          {
            id: "section-new",
            label: "New section",
            icon: "folder-plus",
            separatorBefore: true,
            onClick: () => makeSection(ids),
          },
        ],
      });
    } else {
      items.push({
        id: "section-new",
        label: `Move ${crowdLabel(group)} to new section`,
        icon: "folder-plus",
        onClick: () => makeSection(ids),
      });
    }
    items.push({
      id: "unread",
      label: "Mark as Unread",
      icon: "bell-dot",
      onClick: () => group.forEach((e) => onMarkUnread?.(e)),
    });
    items.push({
      id: "edit",
      label: isChannel ? "Edit Channel" : "Edit Profile",
      icon: "pencil-square",
      separatorBefore: true,
      onClick: () => onEditProfile?.(one),
    });
    items.push({
      id: "duplicate",
      label: "Duplicate",
      icon: "squares-plus",
      onClick: () => group.forEach((e) => e.kind !== "channel" && onDuplicate?.(e)),
    });
    items.push({
      id: "copy-id",
      label: "Copy conversation ID",
      icon: "brackets-square",
      onClick: () => onCopyId?.(one),
    });
    items.push({
      id: "hide",
      label: "Hide from sidebar",
      icon: "eye-slash",
      onClick: () => group.forEach((e) => onHide?.(e)),
    });
    items.push({
      id: "delete",
      label: multi ? `Delete ${crowdLabel(group)}` : "Delete",
      icon: "trash",
      danger: true,
      // Two dividers, not four: the reference menu groups the destructive
      // row on its own and keeps Edit/Duplicate/Copy/Hide together. A rule
      // per item turned the menu into a stack of one-item boxes.
      separatorBefore: true,
      onClick: () => {
        removeMany(ids);
      },
    });
    return items;
  }

  /**
   * Ask to delete. This used to call `window.hydo.deleteAgent` straight from
   * the menu item, so a mis-click on a context menu destroyed a teammate and
   * its entire transcript with no confirm and no undo anywhere in the store.
   * The rail no longer deletes anything itself: it hands the entries up and
   * Shell puts a modal in the way.
   */
  function removeMany(ids) {
    const list = (ids || [])
      .map((id) => entries.find((e) => e.id === id))
      .filter(Boolean);
    if (!list.length) return;
    onDelete?.(list);
    setPicked([]);
  }

  function onRowClick(e, entry, visible) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      setPicked((ids) => {
        if (ids.includes(entry.id)) {
          const next = ids.filter((id) => id !== entry.id);
          return next.length ? next : [];
        }
        return ids.concat(entry.id);
      });
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      const anchorId = picked[picked.length - 1] || selectedId;
      const a = visible.findIndex((x) => x.id === anchorId);
      const b = visible.findIndex((x) => x.id === entry.id);
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        setPicked(visible.slice(lo, hi + 1).map((x) => x.id));
      } else {
        setPicked([entry.id]);
      }
      return;
    }
    setPicked([]);
    onSelect(entry.id);
  }

  // Pinned teammates are TILES, not rows.
  //
  // The reference app lifts them out of the list entirely and shows them as a
  // strip of big marks with the name underneath, above everything else. A
  // pinned row with a small pin glyph on it (what this was) reads as "row with
  // a badge", not as "these are my people". Pinned entries are therefore
  // removed from the list blocks below so they appear exactly once.
  const pinnedTiles = entries.filter((e) => e.pinned);
  const unpinned = entries.filter((e) => !e.pinned);
  const ungrouped = unpinned.filter((e) => !e.sectionId);
  const blocks = [];
  for (const s of sectionList) {
    blocks.push({
      key: s.id,
      id: s.id,
      name: s.name,
      items: unpinned.filter((e) => e.sectionId === s.id),
    });
  }
  if (sectionList.length) {
    // The catch-all is always drawn, and is the only block a conversation
    // with no `sectionId` can land in — deleting a section drops its members
    // here rather than hiding them. It has no record of its own, so its
    // folded state is keyed by this literal.
    blocks.push({ key: UNASSIGNED_KEY, id: null, name: "Unassigned", items: ungrouped });
  } else {
    blocks.push({ key: UNASSIGNED_KEY, id: null, name: null, items: ungrouped });
  }
  for (const b of blocks) b.folded = !!b.name && foldedKeys.includes(b.key);
  // Shift-range selection walks what is on screen, tiles included, in order.
  // A folded section's rows are not on screen, so they are not in range
  // either — shift-clicking across a fold must not silently pick them up.
  const visible = pinnedTiles.concat(blocks.flatMap((b) => (b.folded ? [] : b.items)));

  return (
    <aside className="sand-sidebar" data-collapsed={collapsed ? "true" : "false"}>
      <div className="sand-titlebar sand-titlebar--side">
        {canToggle ? (
          <button
            type="button"
            className="icon-btn"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={onToggle}
          >
            <i className="gb-icon gb-icon-layout-sidebar-left" />
          </button>
        ) : null}
        <span className="sand-newwrap" ref={topPlus}>
          <button
            type="button"
            className="icon-btn"
            title="New"
            aria-label="New"
            aria-haspopup="menu"
            aria-expanded={newOpen === "top"}
            onClick={() => setNewOpen((v) => (v === "top" ? null : "top"))}
          >
            <PlusGlyph />
          </button>
          <NewMenu
            open={newOpen === "top"}
            anchorRef={topPlus}
            onClose={() => setNewOpen(null)}
            onBot={makeBot}
            onChannel={makeChannel}
          />
        </span>
      </div>

      {/* Home. A row, not a button in a corner: it is a destination like any
          conversation, so it lives where the destinations live and shows the
          same selected state they do.

          Off by default right now — Shell owns the switch (HOME_ENABLED) and
          passes it down as `showHome`. The row is gated rather than deleted so
          turning the dashboard back on is one constant, not a rewrite. */}
      {showHome ? (
      <button
        type="button"
        className={`sand-row sand-row--home${selectedId === "home" ? " is-on" : ""}`}
        onClick={() => window.hydo?.select?.("home")}
        data-tip="Home"
      >
        <span className="sand-row__mark sand-home-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15">
            <path
              d="M3.6 10.4 12 4l8.4 6.4V19a1.4 1.4 0 0 1-1.4 1.4h-3.6v-5.2H8.6v5.2H5A1.4 1.4 0 0 1 3.6 19z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="sand-row__copy">
          <span className="sand-row__name">Home</span>
        </span>
      </button>
      ) : null}

      <div className="sand-search">
        <i className="gb-icon gb-icon-magnifying-glass" />
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search" />
      </div>

      {naming ? (
        <form
          className="sand-section-name"
          onSubmit={(e) => {
            e.preventDefault();
            window.hydo.createSection?.({ name: naming.name, ids: naming.ids });
            setNaming(null);
            setPicked([]);
          }}
        >
          <input
            autoFocus
            value={naming.name}
            placeholder="Section name"
            onChange={(e) => setNaming({ ...naming, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") setNaming(null);
            }}
          />
        </form>
      ) : null}

      <div className="sand-roster">
        {pinnedTiles.length > 0 ? (
          <div className="sand-pinned" role="list" aria-label="Pinned">
            {pinnedTiles.map((entry) => {
              const isChannel = entry.kind === "channel";
              const live =
                entry.id === sendingId ||
                (isChannel ? channelWorks(entry, agents) : botBusy(entry) || botWorks(entry, entry.id));
              const pip = isChannel ? null : live || pipOf(entry) ? "work" : null;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="listitem"
                  data-tip={entry.name}
                  className={`sand-pin${entry.id === selectedId ? " is-on" : ""}${
                    !entry.unread || entry.id === selectedId ? "" : " is-unread"
                  }`}
                  onClick={(e) => onRowClick(e, entry, visible)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setPicked([entry.id]);
                    onMenu({ x: e.clientX, y: e.clientY, items: rowMenu(entry, [entry.id]) });
                  }}
                >
                  <span className="sand-pin__face-wrap">
                    {isChannel ? (
                      <ChannelMark channel={entry} agents={agents} />
                    ) : (
                      <UmbraFace
                        className="sand-pin__face"
                        tint={entry.blob}
                        shape={entry.shape}
                        size={48}
                        glow={!!entry.glow}
                        fit
                        live={live}
                        mood={moodFor(live)}
                        poke
                      />
                    )}
                    {!isChannel && pip ? (
                      <span className={`sand-row__dot is-${pip}`} aria-hidden="true" />
                    ) : null}
                  </span>
                  <span className="sand-pin__name">{entry.name}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {blocks.map((block) => (
          <div
            key={block.key}
            className="sand-section"
            data-section={block.key}
            data-folded={block.folded ? "true" : "false"}
          >
            {block.name ? (
              <div className="sand-section__head">
                {block.id && renameId === block.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      window.hydo.renameSection?.(block.id, renameText);
                      setRenameId(null);
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <input
                      className="sand-section__rename"
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => {
                        window.hydo.renameSection?.(block.id, renameText);
                        setRenameId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setRenameId(null);
                      }}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="sand-section__label"
                    aria-expanded={!block.folded}
                    onClick={() => onToggleSection?.(block.key)}
                    // Double-click still renames. The two clicks underneath it
                    // toggle the fold twice, which lands back where it started,
                    // so the heading does not flap while you rename it.
                    onDoubleClick={() => {
                      if (!block.id) return;
                      setRenameId(block.id);
                      setRenameText(block.name);
                    }}
                    onContextMenu={(e) => {
                      if (!block.id) return;
                      e.preventDefault();
                      onMenu({
                        x: e.clientX,
                        y: e.clientY,
                        items: [
                          {
                            id: "rename",
                            label: "Rename section",
                            icon: "pencil-square",
                            onClick: () => {
                              setRenameId(block.id);
                              setRenameText(block.name);
                            },
                          },
                          {
                            id: "del-sec",
                            label: "Delete section",
                            icon: "trash",
                            danger: true,
                            onClick: () => window.hydo.deleteSection?.(block.id),
                          },
                        ],
                      });
                    }}
                  >
                    <Chevron open={!block.folded} />
                    <span className="sand-section__text">{block.name}</span>
                  </button>
                )}
                {/* The count is the folded section's only remaining evidence
                    that anything is inside it, so it appears exactly then —
                    open, the rows themselves say it. */}
                {block.folded ? (
                  <span className="sand-section__count">{block.items.length}</span>
                ) : null}
              </div>
            ) : null}
            {(block.folded ? [] : block.items).map((entry) => {
          const isChannel = entry.kind === "channel";
          const busy = entry.id === sendingId;
          const live =
            busy ||
            (isChannel ? channelWorks(entry, agents) : botBusy(entry) || botWorks(entry, entry.id));
          const on = entry.id === selectedId;
          const pip = isChannel ? null : live || pipOf(entry) ? "work" : null;
          const unread = !on && !!entry.unread;
          const pick = picked.includes(entry.id);
          const renaming = rowRenameId === entry.id;
          // A channel's "activity" belongs to its members, not to the row, so
          // only a bot row gets a live line here.
          const activityLine = isChannel
            ? ""
            : String(entry.activityDetail || entry.activity || "").trim();
          const RowTag = renaming ? "div" : "button";
          return (
            <RowTag
              key={entry.id}
              type={renaming ? undefined : "button"}
              data-tip={entry.name}
              className={`sand-row${on ? " is-on" : ""}${pick ? " is-pick" : ""}${unread ? " is-unread" : ""}${bornNow(entry) ? " is-born" : ""}`}
              onClick={renaming ? undefined : (e) => onRowClick(e, entry, visible)}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setRowRenameId(entry.id);
                setRowRenameText(entry.name || "");
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                const nextIds =
                  picked.includes(entry.id) && picked.length > 1 ? picked : [entry.id];
                if (nextIds.length === 1) setPicked(nextIds);
                onMenu({ x: e.clientX, y: e.clientY, items: rowMenu(entry, nextIds) });
              }}
            >
              <span className="sand-row__face-wrap">
                {isChannel ? (
                  <ChannelMark channel={entry} agents={agents} />
                ) : (
                  <UmbraFace
                    className="sand-row__face"
                    tint={entry.blob}
                    shape={entry.shape}
                    size={36}
                    glow={!!entry.glow}
                    fit
                    live={live}
                    mood={moodFor(live)}
                    poke
                  />
                )}
                {/* The pip is a claim about a real Hermes child, so it is
                    drawn from `pipOf`, not from "this row exists". `work`
                    pulses, `warm` sits steady, and a bot that has never taken
                    a turn gets nothing at all. */}
                {!isChannel && pip ? (
                  <span
                    className={`sand-row__dot is-${pip}`}
                    title={pip === "work" ? "Working" : "Online"}
                    aria-label={pip === "work" ? "Working" : "Online"}
                  />
                ) : null}
              </span>
              <span className="sand-row__copy">
                <span className="sand-row__top">
                  {renaming ? (
                    <input
                      className="sand-row__rename"
                      autoFocus
                      value={rowRenameText}
                      onChange={(e) => setRowRenameText(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={() => {
                        const value = rowRenameText.trim() || entry.name;
                        if (isChannel) window.hydo.setChannel?.(entry.id, { name: value });
                        else window.hydo.setAgent(entry.id, { name: value });
                        setRowRenameId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setRowRenameId(null);
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  ) : (
                    <span className="sand-row__name">{entry.name}</span>
                  )}
                  {entry.label ? <span className="sand-row__tag">{entry.label}</span> : null}
                  <span className="sand-row__time">{when(entry.updatedAt)}</span>
                </span>
                <span className="sand-row__last">
                  {/* While a turn is running, the subtitle says what the
                      teammate is DOING rather than repeating the last message
                      — which is stale by definition at that moment. Draft
                      still wins: that is the user's own unsent text. */}
                  {!entry.draft && live && activityLine ? (
                    <span className="sand-row__last-text hy-act">
                      <ActivityMark plugin={entry.activityIcon} size={13} />
                      <span className="hy-act__text">{activityLine}</span>
                    </span>
                  ) : (
                    <span className="sand-row__last-text">
                      {entry.draft ? `Draft: ${entry.draft}` : entry.last || " "}
                    </span>
                  )}
                  {unread ? <span className="sand-row__unread" aria-label="Unread" /> : null}
                </span>
              </span>
            </RowTag>
          );
            })}
          </div>
        ))}
      </div>

      <div className="sand-foot">
        {/* Collapsed, the rail's controls live at the bottom: toggle, +, then
            the account avatar. Expanded, these are hidden and the titlebar
            pair above does the job — the titlebar element stays mounted either
            way so the top of the sidebar keeps its window-drag region. */}
        <div className="sand-rail-controls">
          {canToggle ? (
            <button
              type="button"
              className="icon-btn"
              data-tip="Expand sidebar"
              title="Expand sidebar"
              aria-label="Expand sidebar"
              onClick={onToggle}
            >
              <i className="gb-icon gb-icon-layout-sidebar-left" />
            </button>
          ) : null}
          <span className="sand-newwrap" ref={railPlus}>
            <button
              type="button"
              className="icon-btn"
              data-tip="New"
              title="New"
              aria-label="New"
              aria-haspopup="menu"
              aria-expanded={newOpen === "rail"}
              onClick={() => setNewOpen((v) => (v === "rail" ? null : "rail"))}
            >
              <PlusGlyph />
            </button>
            <NewMenu
              open={newOpen === "rail"}
              anchorRef={railPlus}
              onClose={() => setNewOpen(null)}
              onBot={makeBot}
              onChannel={makeChannel}
            />
          </span>
        </div>

        {/* The ticker. Mounted ONLY when the main process counted commits this
            build does not have (see statusFrom in electron/main.cjs); an
            "unknown" answer arrives here as 0 and draws nothing at all, which
            is the correct output for "cannot tell". It is a real button, not
            an ornament — it opens the Updates pane, where the install lives. */}
        {updateBehind > 0 ? (
          <button
            type="button"
            className="sand-update"
            data-tip="An update is ready to install"
            title="An update is ready to install"
            onClick={() => onUpdate?.()}
          >
            <span className="sand-update__dot" aria-hidden="true" />
            <span className="sand-update__label">
              Update ready
              {" · "}
              {updateBehind} new
            </span>
          </button>
        ) : null}

        <button
          type="button"
          className="sand-plugins"
          data-tip="Plugins"
          title="Plugins"
          onClick={() => onPlugins?.()}
        >
          <span className="sand-foot__mark">
            <PlugGlyph />
          </span>
          <span className="sand-foot__label">Plugins</span>
        </button>

        <div className="sand-account-wrap">
          {accountOpen && (
            <AccountMenu
              userName={name}
              onSettings={onSettings}
              onUpdate={onUpdate}
              updateBehind={updateBehind}
              onAbout={onAbout}
              onHelp={onHelp}
              onFeedback={onFeedback}
              onSignOut={onSignOut}
              onClose={() => onAccountToggle(false)}
            />
          )}
          <button
            type="button"
            className="sand-account"
            data-tip={name}
            onClick={() => onAccountToggle(!accountOpen)}
          >
            <span className="sand-foot__mark sand-initial">
              {userAvatar ? (
                <img src={userAvatar} alt="" className="sand-foot__avatar" />
              ) : (
                initialOf(name)
              )}
            </span>
            <span className="sand-foot__label">{name}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * memo, for the same reason Transcript is memoised: the roster renders a row
 * (and a live blob face) per conversation, and it was re-rendering on every
 * keystroke in the composer purely because Shell owns the draft. Measured, on
 * a 40-character message: 3.3ms -> 2.1ms median and 4.7ms -> 2.7ms p95 of
 * synchronous React work per key.
 *
 * Every prop it takes is a primitive, a memoised array, or a useCallback in
 * Shell. Adding an inline arrow to <Sidebar> there silently turns this back
 * into a no-op.
 */
export default memo(Sidebar);
