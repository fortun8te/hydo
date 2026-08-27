import { useEffect, useMemo, useRef, useState } from "react";
import { MediaViewer } from "./RichContent.jsx";
import { pluginIconUrl, pluginPrettyName } from "../lib/plugin-icons.js";
import UmbraFace from "../umbra/UmbraFace.jsx";

// The kit's icon font has no microphone, and its `plus` / `arrow-up` glyphs are
// drawn inside a ring — the real composer's are bare. Draw those three here.
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

function SendGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 19V6M6 12l6-6 6 6"
      />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.6" fill="currentColor" />
    </svg>
  );
}

function CubeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Zm0 18V12m8-4.5L12 12 4 7.5"
      />
    </svg>
  );
}

function CommandGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        d="M9 8.5A2.5 2.5 0 1 1 11.5 6H14.5A2.5 2.5 0 1 1 12 8.5v7A2.5 2.5 0 1 1 9.5 18H6.5A2.5 2.5 0 1 1 9 15.5v-7Zm6 0v7A2.5 2.5 0 1 0 17.5 18H14.5"
      />
    </svg>
  );
}

const SLASH_ACTIONS = [
  { id: "sand.toggleAgentSettings", label: "Chat Settings", note: "Current chat" },
  { id: "sand.openSettings", label: "Settings: General", note: "Settings" },
  { id: "sand.openSettings", label: "Settings: Usage", note: "Settings", key: "usage" },
];

function menuMode(draft, plusOpen) {
  if (String(draft || "").startsWith("/")) return "slash";
  if (/(?:^|\s)@([^\s@]*)$/.test(String(draft || ""))) return "at";
  if (plusOpen) return "plus";
  return null;
}

function filterOf(draft, mode) {
  if (mode === "slash") return String(draft || "").slice(1).split(/\s/)[0].toLowerCase();
  if (mode === "at") {
    const at = /(?:^|\s)@([^\s@]*)$/.exec(String(draft || ""));
    return at ? at[1].toLowerCase() : "";
  }
  return "";
}

// Matches the `max-height` in composer.css. Both are needed: the cap here
// stops the inline height growing past it, the CSS one turns on the scrollbar.
const MAX_INPUT_H = 132;

export default function Composer({
  draft,
  onDraft,
  onSend,
  placeholder,
  mentionables = [],
  menuOpen,
  onMenuToggle,
  onPickMention,
  onNewBot,
  onNewChannel,
  onSlashAction,
  busy,
  onStop,
  // Optional, and absent until the backends land: the composer degrades to
  // bots-only and to its plain single-line pill without them.
  plugins = [],
  replyTo = null,
  onCancelReply,
}) {
  const inputRef = useRef(null);
  const formRef = useRef(null);
  const fileRef = useRef(null);
  const [active, setActive] = useState(0);
  const [images, setImages] = useState([]);
  const [skills, setSkills] = useState([]);
  // Index of the attachment being previewed full screen, or -1.
  const [shot, setShot] = useState(-1);

  const mode = menuMode(draft, menuOpen);
  const query = filterOf(draft, mode);

  // Autosize.
  //
  // This used to run in onChange and set an inline height, while the
  // stylesheet ALSO asked for `field-sizing: content`. Two sizing mechanisms
  // on one box, and the inline one only ever ran on a keystroke: sending
  // cleared the text but not the height, so the pill stayed five lines tall
  // and empty, and a draft restored from state.json (or set by pickMention)
  // arrived at the wrong size. That is the "sometimes doing weird stuff".
  //
  // One mechanism now, driven by the VALUE, so every path that changes the
  // draft resizes: typing, sending, switching bots, restoring a draft.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_H)}px`;
  }, [draft]);

  useEffect(() => {
    let live = true;
    window.hydo
      ?.listSkills?.()
      .then((res) => {
        if (!live) return;
        const list = (res && res.skills) || (res && res.ok && res.skills) || [];
        const seen = new Set();
        const rows = [];
        for (const s of list) {
          const name = String(s.name || s.id || "").trim();
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          rows.push({
            id: s.id || name,
            name,
            description: String(s.description || "").replace(/\s+/g, " ").trim(),
          });
        }
        setSkills(rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(() => {
    const hit = (s) => !query || String(s).toLowerCase().includes(query);
    const out = [];
    if (mode === "slash") {
      for (const s of skills) {
        if (!hit(s.name) && !hit(s.description)) continue;
        out.push({
          key: `skill:${s.id}`,
          kind: "skill",
          label: s.name,
          note: s.description,
          type: "Skill",
          skill: s,
        });
      }
      SLASH_ACTIONS.forEach((a, i) => {
        if (!hit(a.label) && !hit(a.note)) return;
        out.push({
          key: `action:${a.key || a.id}:${i}`,
          kind: "action",
          label: a.label,
          note: a.note,
          type: "Action",
          actionId: a.id,
          sep: i === 0 && out.length > 0,
        });
      });
      return out;
    }
    if (mode === "at") {
      // Teammates first, then connected apps, then `everyone`. Bots are what
      // `@` is for; the other two are the tail. `mentionables` is every bot in
      // the roster, not just this thread's members, so a teammate that has
      // never been in this chat is still one keystroke away.
      for (const a of mentionables) {
        if (hit(a.name)) out.push({ key: `bot:${a.id}`, kind: "bot", agent: a, label: a.name, type: "Bot" });
      }
      let first = true;
      for (const pl of plugins) {
        const label = pluginPrettyName(pl);
        if (!hit(label)) continue;
        const state = pl.needsAuth ? "needs auth" : pl.connected || pl.installed ? "connected" : "";
        out.push({
          key: `plugin:${pl.id || label}`,
          kind: "plugin",
          label,
          note: state,
          type: "Plugin",
          plugin: pl,
          sep: first && out.length > 0,
        });
        first = false;
      }
      if (hit("everyone")) {
        out.push({ key: "everyone", kind: "everyone", label: "everyone", type: "Bot", sep: out.length > 0 });
      }
      return out;
    }
    if (mode === "plus") {
      for (const a of mentionables) {
        if (hit(a.name)) out.push({ key: `bot:${a.id}`, kind: "bot", agent: a, label: a.name, type: "Bot" });
      }
      out.push({ key: "new-bot", kind: "new-bot", label: "New Bot", type: "Create", sep: true });
      out.push({ key: "new-channel", kind: "new-channel", label: "New Channel", type: "Create", icon: "people-3" });
      return out;
    }
    return out;
  }, [mentionables, skills, plugins, query, mode]);

  useEffect(() => {
    setActive(0);
  }, [mode, query]);

  function pick(row) {
    if (!row) return;
    if (row.kind === "skill") {
      onDraft(`/${row.skill.name} `);
      onMenuToggle(false);
      return;
    }
    if (row.kind === "action") {
      onDraft("");
      onMenuToggle(false);
      onSlashAction?.(row.actionId);
      return;
    }
    if (row.kind === "new-bot") return onNewBot?.();
    if (row.kind === "new-channel") return onNewChannel?.();
    if (row.kind === "everyone") {
      onDraft(String(draft || "").replace(/@([^\s@]*)$/, "@everyone "));
      onMenuToggle(false);
      return;
    }
    if (row.kind === "plugin") {
      onDraft(String(draft || "").replace(/@([^\s@]*)$/, `@${row.label} `));
      onMenuToggle(false);
      return;
    }
    if (row.kind === "bot") {
      if (mode === "at") {
        onDraft(String(draft || "").replace(/@([^\s@]*)$/, `@${row.agent.name} `));
        onMenuToggle(false);
        return;
      }
      return onPickMention?.(row.agent);
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (mode) {
        if (e.key === "Escape") {
          e.preventDefault();
          onMenuToggle(false);
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          // Beat the form's implicit submit — Enter picks the highlighted row.
          e.preventDefault();
          pick(rows[active]);
          return;
        }
      }
      if (e.key === "Escape" && replyTo) {
        e.preventDefault();
        onCancelReply?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const replying = !!replyTo;
  const hasImages = images.length > 0;
  const canSend = !busy && (!!draft.trim() || hasImages);

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && f.type && f.type.startsWith("image/"));
    files.slice(0, 8 - images.length).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result || "");
        if (!src.startsWith("data:image/")) return;
        setImages((rows) => {
          if (rows.length >= 8) return rows;
          return [...rows, { id: `${Date.now()}-${file.name}`, src, name: file.name || "image.png" }];
        });
      };
      reader.readAsDataURL(file);
    });
  }

  function onPaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const pics = items.filter((it) => it.type && it.type.startsWith("image/"));
    if (!pics.length) return;
    e.preventDefault();
    addFiles(pics.map((it) => it.getAsFile()).filter(Boolean));
  }

  function onDrop(e) {
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    if (![...files].some((f) => f.type.startsWith("image/"))) return;
    e.preventDefault();
    addFiles(files);
  }

  return (
    <form
      ref={formRef}
      className="sand-composer"
      data-reply={replying ? "true" : "false"}
      data-attach={hasImages ? "true" : "false"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSend) return;
        const payload = images.map((im) => ({ src: im.src, name: im.name }));
        setImages([]);
        onSend({ images: payload });
      }}
      onPaste={onPaste}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((it) => it.type.startsWith("image/"))) e.preventDefault();
      }}
      onDrop={onDrop}
    >
      {mode && (
        <div className={`sand-slash sand-slash--${mode}`} role="menu">
          {rows.map((row, i) => (
            <div key={row.key} className="sand-slash__wrap">
              {row.sep && <div className="sand-slash__sep" />}
              <button
                type="button"
                role="menuitem"
                className={i === active ? "sand-slash__item is-active" : "sand-slash__item"}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(row)}
              >
                <span className="sand-slash__mark">
                  {row.kind === "skill" ? (
                    <CubeGlyph />
                  ) : row.kind === "action" ? (
                    <CommandGlyph />
                  ) : row.kind === "bot" ? (
                    <UmbraFace tint={row.agent.blob} shape={row.agent.shape} size={18} />
                  ) : row.kind === "plugin" ? (
                    <img src={pluginIconUrl(row.plugin)} alt="" />
                  ) : row.kind === "everyone" ? (
                    <span className="sand-slash__at">@</span>
                  ) : row.kind === "new-bot" ? (
                    <PlusGlyph />
                  ) : (
                    <i className={`gb-icon gb-icon-${row.icon || "plus"}`} />
                  )}
                </span>
                <span className="sand-slash__label">{row.label}</span>
                {row.note ? <span className="sand-slash__note">{row.note}</span> : null}
                <span className="sand-slash__type">{row.type}</span>
              </button>
            </div>
          ))}
          {rows.length === 0 && <div className="sand-slash__empty">No matches</div>}
        </div>
      )}

      {hasImages && (
        <div className="sand-thumbs">
          {images.map((im, i) => (
            <div className="sand-thumb" key={im.id}>
              {/* Attachments open the same full-bleed MediaViewer a sent image
                  does, so you can actually check what you are about to send
                  instead of squinting at a 44px chip. */}
              <button
                type="button"
                className="sand-thumb__open"
                aria-label={im.name ? `Preview ${im.name}` : `Preview image ${i + 1}`}
                onClick={() => setShot(i)}
              >
                <img src={im.src} alt="" />
              </button>
              <button
                type="button"
                className="sand-thumb__x"
                aria-label="Remove image"
                onClick={() => setImages((rows) => rows.filter((r) => r.id !== im.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {replying && (
        <div className="sand-reply">
          <i className="gb-icon gb-icon-arrow-u-up-left" />
          <span className="sand-reply__text">{replyTo.text}</span>
          <button
            type="button"
            className="sand-reply__x"
            title="Cancel reply"
            aria-label="Cancel reply"
            onClick={() => onCancelReply?.()}
          >
            <i className="gb-icon gb-icon-remove-close" />
          </button>
        </div>
      )}

      <button
        type="button"
        className="sand-composer__plus"
        title="Add"
        aria-label="Add"
        aria-expanded={!!menuOpen}
        onClick={() => onMenuToggle(!menuOpen)}
        onContextMenu={(e) => {
          e.preventDefault();
          fileRef.current?.click();
        }}
      >
        <PlusGlyph />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <textarea
        ref={inputRef}
        className="sand-composer__input"
        rows={1}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          if (mode) return;
          e.preventDefault();
          if (canSend) formRef.current?.requestSubmit();
        }}
        placeholder={hasImages ? "Add a message, or hit send." : replying ? "Reply..." : placeholder}
      />

      <div className="sand-composer__actions">
        {busy ? (
          <button
            type="button"
            className="send send--stop"
            title="Stop"
            aria-label="Stop"
            onClick={() => onStop?.()}
          >
            <StopGlyph />
          </button>
        ) : canSend ? (
          <button type="submit" className="send" title="Send" aria-label="Send">
            <SendGlyph />
          </button>
        ) : null}
      </div>
      <MediaViewer
        items={images.map((im) => ({ kind: "image", src: im.src, alt: im.name || "" }))}
        index={shot < 0 ? 0 : shot}
        open={shot >= 0}
        onClose={() => setShot(-1)}
        onIndexChange={setShot}
      />
    </form>
  );
}
