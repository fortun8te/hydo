import { useEffect, useRef, useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";
import ChoiceCard from "./ChoiceCard.jsx";
import * as RC from "./RichContent.jsx";
import { botWorks } from "../lib/working.js";
import { composerExtrasForMember, presenceOf, joinDelayOf } from "../lib/presence.js";

function dayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const same =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (same) return `Today ${time}`;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Markdown — a small, safe, total subset renderer. No npm dependency, no
// dangerouslySetInnerHTML: every character that isn't recognized markup
// flows out as a plain React text child, which React escapes on its own.
// Supports: fenced code blocks, inline code, **bold**, *italic*, links
// (rendered blue and inline, never clickable), bullet/numbered lists,
// and blockquotes. Anything else — an unclosed fence, a lone asterisk, a
// raw `<script>` tag — just falls through as literal text. Every parsing
// loop provably advances its cursor, so it cannot hang, and every branch
// is wrapped so a bad input renders *something* rather than throwing.
// ---------------------------------------------------------------------------

function toText(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  try {
    return String(v);
  } catch {
    return "";
  }
}

// Bare URLs get the same blue treatment as [label](url). Sticky so it can only
// match at the cursor, and it always consumes at least "http:/" worth of
// characters, so the caller's loop still advances.
const BARE_URL = /https?:\/\/[^\s<>()[\]{}"'`]+/y;

// Inline spans: `code`, **bold**, *italic*, [text](url), bare URLs. Recurses
// into bold/italic bodies so **a *b* c** nests correctly. Every branch either
// consumes a matched span (advancing past it) or falls through to a single
// literal character, so `i` always increases and the loop always ends.
function parseInline(raw, keyBase) {
  const text = toText(raw);
  const nodes = [];
  let buf = "";
  let i = 0;
  let key = 0;
  const n = text.length;

  const flush = () => {
    if (buf) {
      nodes.push(buf);
      buf = "";
    }
  };

  while (i < n) {
    const ch = text[i];

    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        flush();
        nodes.push(
          <code className="hy-md-code-inline" key={`${keyBase}-c${key++}`}>
            {text.slice(i + 1, end)}
          </code>
        );
        i = end + 1;
        continue;
      }
    }

    if (ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1 && end > i + 2) {
        flush();
        nodes.push(
          <strong key={`${keyBase}-b${key++}`}>
            {parseInline(text.slice(i + 2, end), `${keyBase}-b${key}`)}
          </strong>
        );
        i = end + 2;
        continue;
      }
    }

    if (ch === "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1 && end > i + 1) {
        flush();
        nodes.push(
          <em key={`${keyBase}-i${key++}`}>
            {parseInline(text.slice(i + 1, end), `${keyBase}-i${key}`)}
          </em>
        );
        i = end + 1;
        continue;
      }
    }

    if (ch === "[") {
      const closeBracket = text.indexOf("]", i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen !== -1 && closeParen > closeBracket + 2) {
          flush();
          const label = text.slice(i + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen);
          // Deliberately a <span>, not an <a>: the transcript never hands a
          // model-authored URL a click target. The URL rides along in `title`.
          nodes.push(
            <span className="hy-md-link" title={url} key={`${keyBase}-l${key++}`}>
              {label}
            </span>
          );
          i = closeParen + 1;
          continue;
        }
      }
    }

    if (ch === "h") {
      BARE_URL.lastIndex = i;
      const m = BARE_URL.exec(text);
      if (m && m.index === i) {
        flush();
        nodes.push(
          <span className="hy-md-link" key={`${keyBase}-u${key++}`}>
            {m[0]}
          </span>
        );
        i += m[0].length;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
  return nodes;
}

// Block-level split: fenced code, blockquotes, bullet/numbered lists,
// paragraphs. Every while-loop below only continues while it is consuming
// `lines[i]`, so each iteration of the outer loop is guaranteed to advance
// `i` by at least one line — an unclosed fence just runs to EOF instead of
// looping forever.
function parseBlocks(raw) {
  const text = toText(raw);
  if (!text) return [];
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      const lang = fence[1].trim();
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume closing fence, if any
      blocks.push({ type: "code", lang, text: code.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }

  return blocks;
}

function Caret() {
  return <span className="hy-caret" aria-hidden="true" />;
}

function MarkdownBlock({ block, idx, trailingCaret }) {
  if (block.type === "code") {
    return (
      <pre className="hy-md-pre" key={idx}>
        <code className="hy-md-code">
          {block.text}
          {trailingCaret ? <Caret /> : null}
        </code>
      </pre>
    );
  }

  if (block.type === "quote") {
    const lines = block.text.split("\n");
    return (
      <blockquote className="hy-md-quote" key={idx}>
        {lines.map((l, i) => (
          <p key={i}>
            {parseInline(l, `q${idx}-${i}`)}
            {trailingCaret && i === lines.length - 1 ? <Caret /> : null}
          </p>
        ))}
      </blockquote>
    );
  }

  if (block.type === "ul" || block.type === "ol") {
    const Tag = block.type === "ul" ? "ul" : "ol";
    return (
      <Tag className="hy-md-list" key={idx}>
        {block.items.map((it, i) => (
          <li key={i}>
            {parseInline(it, `${block.type}${idx}-${i}`)}
            {trailingCaret && i === block.items.length - 1 ? <Caret /> : null}
          </li>
        ))}
      </Tag>
    );
  }

  // paragraph — soft line breaks preserved
  const lines = block.text.split("\n");
  return (
    <p className="hy-md-p" key={idx}>
      {lines.map((l, i) => (
        <span key={i}>
          {parseInline(l, `p${idx}-${i}`)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
      {trailingCaret ? <Caret /> : null}
    </p>
  );
}

// Pure and total: any input renders *something*, nothing throws. A parse
// failure of any kind falls back to the raw text as one plain paragraph.
export function Markdown({ text, caret }) {
  let blocks;
  try {
    blocks = parseBlocks(text);
  } catch {
    blocks = [{ type: "p", text: toText(text) }];
  }
  if (!blocks.length) {
    return caret ? <Caret /> : null;
  }
  try {
    return (
      <div className="hy-md">
        {blocks.map((b, i) => (
          <MarkdownBlock block={b} idx={i} key={i} trailingCaret={caret && i === blocks.length - 1} />
        ))}
      </div>
    );
  } catch {
    return <p className="hy-md-p">{toText(text)}</p>;
  }
}

export { parseInline, parseBlocks };

// Prefer the shared rich-text renderer once it exists; ours is the fallback.
const Body = typeof RC.Markdown === "function" ? RC.Markdown : Markdown;

// ---------------------------------------------------------------------------
// "It has to be like messaging a teammate and only in logs can we see all the
// bs." Activity labels arrive straight off the gateway and can be raw tool
// names (`web_search`, `read_file`). Those are plumbing: they never reach the
// transcript. Anything that doesn't read like something a person would say is
// dropped rather than shown.
// ---------------------------------------------------------------------------
const ACTIVITY_WORDS = {
  web_search: "Searching the web",
  websearch: "Searching the web",
  search: "Searching the web",
  browse: "Browsing",
  browser: "Browsing",
  browser_use: "Browsing",
  open_url: "Browsing",
  fetch: "Browsing",
  read: "On your computer",
  read_file: "On your computer",
  view: "On your computer",
  grep: "On your computer",
  glob: "On your computer",
  write: "On your computer",
  write_file: "On your computer",
  edit: "On your computer",
  edit_file: "On your computer",
  bash: "On your computer",
  shell: "On your computer",
  run_command: "On your computer",
  terminal: "On your computer",
  computer_use: "On your computer",
  computer: "On your computer",
  grok: "Connecting to Grok Build",
  opencode: "Connecting to OpenCode",
  cursor: "Connecting to Cursor",
};

function humanActivity(raw) {
  const s = toText(raw).trim();
  if (!s) return "";
  const hit = ACTIVITY_WORDS[s.toLowerCase()];
  if (hit) return hit;
  // Identifier-shaped (snake_case, dotted, camelCase, no spaces) or anything
  // carrying punctuation from a serialized payload is tool detail, not speech.
  if (!/\s/.test(s) && (/[_.:/\\]/.test(s) || /[a-z][A-Z]/.test(s))) return "";
  if (/[{}[\]<>"]/.test(s)) return "";
  if (s.length > 48) return "";
  return s;
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------
const QUICK_REACTIONS = ["👍", "👎", "❤️", "😂", "🎉", "😮"];
const MORE_REACTIONS = [
  "👍", "👎", "❤️", "😂", "🎉", "😮", "🔥", "👀",
  "💯", "🙏", "✅", "❌", "🤔", "😢", "😍", "🚀",
];

function groupReactions(list) {
  const order = [];
  const byEmoji = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    const emoji = r && typeof r.emoji === "string" ? r.emoji : "";
    if (!emoji) continue;
    let g = byEmoji.get(emoji);
    if (!g) {
      g = { emoji, count: 0, mine: false, bots: [] };
      byEmoji.set(emoji, g);
      order.push(g);
    }
    g.count += 1;
    if (r.by === "user") g.mine = true;
    else if (r.by) g.bots.push(String(r.by));
  }
  return order;
}

function reactorNames(group, byId, userName) {
  const names = [];
  if (group.mine) names.push(userName || "You");
  for (const id of group.bots) names.push(byId[id]?.name || "A teammate");
  return names.join(", ");
}

function ReactionPills({ groups, byId, userName, showFaces, onToggle }) {
  if (!groups.length) return null;
  return (
    <div className="hy-reactions">
      {groups.map((g) => {
        const who = reactorNames(g, byId, userName);
        const firstBot = g.bots.length ? byId[g.bots[0]] : null;
        return (
          <button
            key={g.emoji}
            type="button"
            className={g.mine ? "hy-reaction is-mine" : "hy-reaction"}
            title={who ? `${g.emoji} — ${who}` : g.emoji}
            aria-label={`${g.emoji} reaction, ${g.count}, react`}
            aria-pressed={g.mine}
            onClick={() => onToggle(g.emoji)}
          >
            {showFaces && firstBot ? (
              <UmbraFace tint={firstBot.blob} shape={firstBot.shape} size={14} className="hy-reaction__face" />
            ) : null}
            <span className="hy-reaction__emoji">{g.emoji}</span>
            {g.count > 1 ? <span className="hy-reaction__count">{g.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function EmojiStrip({ open, above, more, popRef, onPick, onMore }) {
  if (!open) return null;
  const set = more ? MORE_REACTIONS : QUICK_REACTIONS;
  return (
    <div
      className={
        (above ? "hy-emoji hy-emoji--above" : "hy-emoji") + (more ? " hy-emoji--more" : "")
      }
      role="menu"
      aria-label="Add a reaction"
      ref={popRef}
    >
      {set.map((e) => (
        <button
          key={e}
          type="button"
          role="menuitem"
          className="hy-emoji__btn"
          aria-label={`React with ${e}`}
          onPointerDown={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onPick(e);
          }}
        >
          {e}
        </button>
      ))}
      {!more ? (
        <button
          type="button"
          role="menuitem"
          className="hy-emoji__btn hy-emoji__more"
          aria-label="More emoji"
          title="More emoji"
          onPointerDown={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onMore?.();
          }}
        >
          <i className="gb-icon gb-icon-smiley-plus" />
        </button>
      ) : null}
    </div>
  );
}

// The quoted line a reply carries. `replyTo` may be missing entirely, or may
// point at a message that has since been deleted — both render as a calm
// one-liner rather than throwing.
function QuotedReply({ replyTo, byId, known, onJumpTo }) {
  if (!replyTo || typeof replyTo !== "object") return null;
  const id = replyTo.id == null ? "" : String(replyTo.id);
  // Only a real string is quotable; anything else reads as a dangling original
  // rather than "[object Object]".
  const body = typeof replyTo.text === "string" ? replyTo.text.replace(/\s+/g, " ").trim() : "";
  const dangling = !body || (known && id && !known.has(id));
  const who = replyTo.fromId && replyTo.fromId !== "user" ? byId[replyTo.fromId]?.name : null;
  const label = dangling ? "Original message unavailable" : body;
  return (
    <button
      type="button"
      className={dangling ? "hy-quote hy-quote--gone" : "hy-quote"}
      disabled={dangling || !id}
      title={dangling ? undefined : label}
      aria-label={dangling ? "Original message unavailable" : `Jump to replied message: ${label}`}
      onClick={() => {
        if (!dangling && id) onJumpTo?.(id);
      }}
    >
      <i className="gb-icon gb-icon-arrow-u-up-left" aria-hidden="true" />
      {who ? <span className="hy-quote__who">{who}</span> : null}
      <span className="hy-quote__text">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Images — the transcript renders a screenshot as a rounded block at its
// natural width, capped, never stretched. RichContent's grid takes over when
// it exists.
// ---------------------------------------------------------------------------
function imageList(msg) {
  const raw = Array.isArray(msg.images) ? msg.images : [];
  return raw
    .map((im) => {
      if (typeof im === "string") return { src: im, alt: "" };
      if (im && typeof im === "object") {
        const src = toText(im.url || im.src);
        return src ? { src, alt: toText(im.alt) } : null;
      }
      return null;
    })
    .filter(Boolean);
}

function ImageBlock({ images }) {
  if (!images.length) return null;
  if (typeof RC.ImageGrid === "function") return <RC.ImageGrid images={images} />;
  return (
    <div className="hy-shots">
      {images.map((im, i) => (
        <img className="hy-shot" key={i} src={im.src} alt={im.alt} loading="lazy" draggable="false" />
      ))}
    </div>
  );
}

// Everything a message can carry beyond its text. Each piece is owned by
// RichContent; when it isn't loaded the transcript simply stays quiet rather
// than inventing a placeholder. No branch here can print a tool name.
function Extras({ msg, kind = "files" }) {
  const images = imageList(msg);
  const files = Array.isArray(msg.attachments) ? msg.attachments : [];
  const links = Array.isArray(msg.links) ? msg.links : [];
  const task = msg.task && typeof msg.task === "object" ? msg.task : null;
  if (kind === "images") {
    if (!images.length) return null;
    return (
      <div className="hy-extras hy-extras--in">
        <ImageBlock images={images} />
      </div>
    );
  }
  if (!files.length && !links.length && !task) return null;
  return (
    <div className="hy-extras">
      {files.length && typeof RC.FileGroup === "function" ? <RC.FileGroup files={files} /> : null}
      {links.length && typeof RC.LinkCard === "function"
        ? links.map((l, i) => <RC.LinkCard key={i} link={l} />)
        : null}
      {task && typeof RC.TaskCard === "function" ? <RC.TaskCard task={task} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One bubble, plus its hover action bar, emoji strip and reaction pills.
// ---------------------------------------------------------------------------
function Bubble({
  msg,
  user,
  groupTop,
  groupBottom,
  byId,
  known,
  userName,
  showFaces,
  onReact,
  onReply,
  onJumpTo,
  onMessageMenu,
}) {
  const [picker, setPicker] = useState(false);
  const [more, setMore] = useState(false);
  const [above, setAbove] = useState(false);
  const popRef = useRef(null);
  const smileyRef = useRef(null);

  useEffect(() => {
    if (!picker) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPicker(false);
        smileyRef.current?.focus();
      }
    };
    const onDown = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (smileyRef.current?.contains(e.target)) return;
      setPicker(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [picker]);

  // Opens below the action bar, as designed — unless the newest message is
  // close enough to the bottom that below would be clipped by the scroller.
  function togglePicker() {
    const btn = smileyRef.current;
    const scroller = btn?.closest(".sand-transcript");
    const b = btn?.getBoundingClientRect();
    const s = scroller?.getBoundingClientRect();
    setAbove(!!(b && s && b.bottom + 62 > s.bottom));
    setMore(false);
    setPicker((v) => !v);
  }

  const streaming = !user && !!msg.streaming;
  const bubbleClass = [
    "sand-bubble",
    msg.kind === "sending" ? "sand-bubble--sending" : "",
    streaming ? "hy-streaming" : "",
    groupTop ? "hy-b--cont" : "",
    groupBottom ? "hy-b--lead" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const groups = groupReactions(msg.reactions);
  const text = toText(msg.text);

  return (
    <div className="hy-msg">
      <QuotedReply replyTo={msg.replyTo} byId={byId} known={known} onJumpTo={onJumpTo} />
      <div className="hy-msg__line">
        {text || imageList(msg).length ? (
          <div className={bubbleClass}>
            {text ? <Body text={text} caret={false} /> : null}
            <Extras msg={msg} kind="images" />
          </div>
        ) : null}

        <div className={picker ? "hy-actions is-open" : "hy-actions"}>
          <button
            type="button"
            className="hy-actions__btn"
            ref={smileyRef}
            aria-haspopup="menu"
            aria-expanded={picker}
            aria-label="Add a reaction"
            title="Add a reaction"
            onClick={togglePicker}
          >
            <i className="gb-icon gb-icon-smiley-happy" />
          </button>
          <button
            type="button"
            className="hy-actions__btn"
            aria-label="Reply"
            title="Reply"
            disabled={!onReply}
            onClick={() => onReply?.(msg)}
          >
            <i className="gb-icon gb-icon-arrow-u-up-left" />
          </button>
          <button
            type="button"
            className="hy-actions__btn"
            aria-label="More actions"
            title="More"
            aria-haspopup={onMessageMenu ? "menu" : undefined}
            disabled={!onMessageMenu}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onMessageMenu?.(msg, { x: Math.round(r.left), y: Math.round(r.bottom + 4) });
            }}
          >
            <i className="gb-icon gb-icon-dots-3-horizontal" />
          </button>
          <EmojiStrip
            open={picker}
            above={above}
            more={more}
            popRef={popRef}
            onMore={() => setMore(true)}
            onPick={(emoji) => {
              setPicker(false);
              setMore(false);
              if (emoji) onReact?.(msg.id, emoji);
              smileyRef.current?.focus();
            }}
          />
        </div>
      </div>
      <Extras msg={msg} kind="files" />
      <ReactionPills
        groups={groups}
        byId={byId}
        userName={userName}
        showFaces={showFaces}
        onToggle={(emoji) => onReact(msg.id, emoji)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approval — a teammate asking before it acts. The one place a command may be
// shown, because that is exactly what is being consented to.
// ---------------------------------------------------------------------------
const APPROVAL_CHOICES = [
  { id: "once", label: "Allow once" },
  { id: "session", label: "Allow for this chat" },
  { id: "always", label: "Always allow" },
  { id: "deny", label: "Deny", tone: "deny" },
];

const APPROVAL_RESOLVED = {
  once: "Allowed once",
  session: "Allowed for this chat",
  always: "Always allowed",
  deny: "Denied",
};

function GateCard({ msg, from }) {
  const answered = msg.answered ? String(msg.answered) : "";
  const who = from?.name || "Your teammate";
  const [draft, setDraft] = useState("");
  const secret = !!msg.secret || msg.gateKind === "sudo" || msg.gateKind === "secret";
  const kind = String(msg.gateKind || "");
  const needsBody = !secret;

  function send(value) {
    if (answered) return;
    window.hydo?.answerGate?.(msg.id, value);
  }

  function sendBody() {
    if (secret && !draft) return;
    send(draft);
  }

  const placeholder =
    kind === "mcp.setup"
      ? '{"status":"ok"}'
      : kind === "sudo"
        ? "Password"
        : kind === "secret"
          ? "Secret"
          : "Reply (text or JSON)";

  return (
    <div className={answered ? "hy-ask hy-ask--done" : "hy-ask"}>
      <div className="hy-ask__head">
        {from ? <UmbraFace tint={from.blob} shape={from.shape} size={20} /> : null}
        <span className="hy-ask__who">{who} needs a reply</span>
      </div>
      <p className="hy-ask__text">{toText(msg.text)}</p>
      {answered ? (
        <div className="hy-ask__done" role="status">
          <i className="gb-icon gb-icon-check-circle" aria-hidden="true" />{" "}
          {answered === "skipped" ? "Skipped" : "Sent"}
        </div>
      ) : (
        <div className="hy-ask__btns">
          {secret ? (
            <input
              className="hy-ask__secret"
              type="password"
              autoComplete="off"
              placeholder={placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : needsBody ? (
            <textarea
              className="hy-ask__secret hy-ask__body"
              rows={3}
              placeholder={placeholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : null}
          <button type="button" className="hy-ask__btn" onClick={sendBody} disabled={!draft}>
            Send
          </button>
          <button type="button" className="hy-ask__btn hy-ask__btn--deny" onClick={() => send("")}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ msg, from }) {
  const answered = msg.answered ? String(msg.answered) : "";
  const command = toText(msg.command).trim();
  const who = from?.name || "Your teammate";

  function answer(choice) {
    if (answered) return;
    window.hydo?.answerApproval?.(msg.id, choice);
  }

  return (
    <div className={answered ? "hy-ask hy-ask--done" : "hy-ask"}>
      <div className="hy-ask__head">
        {from ? <UmbraFace tint={from.blob} shape={from.shape} size={20} /> : null}
        <span className="hy-ask__who">{who} wants your OK</span>
      </div>
      <p className="hy-ask__text">{toText(msg.text) || "Run this?"}</p>
      {command ? <pre className="hy-ask__cmd">{command}</pre> : null}
      {answered ? (
        <div className="hy-ask__done" role="status">
          <i className="gb-icon gb-icon-check-circle" aria-hidden="true" />{" "}
          {APPROVAL_RESOLVED[answered] || "Answered"}
        </div>
      ) : (
        <div className="hy-ask__btns">
          {APPROVAL_CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={c.tone === "deny" ? "hy-ask__btn hy-ask__btn--deny" : "hy-ask__btn"}
              onClick={() => answer(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------
const BUBBLE_KINDS = new Set(["chat", "sending", "", "message"]);

function isBubble(msg) {
  return BUBBLE_KINDS.has(msg.kind == null ? "" : String(msg.kind));
}

function speakerKey(msg) {
  if (msg.role === "user") return "user";
  return `bot:${msg.fromId || ""}`;
}

// A teammate busy in a channel is not busy in its own 1:1 thread.
function busyHere(agent, convId) {
  return botWorks(agent, convId);
}

const ARTIFACT_ICONS = {
  html: "layout-sidebar-left",
  svg: "layout-sidebar-left",
  markdown: "file-text",
  json: "file-text",
  csv: "file-text",
  text: "file-text",
  url: "globe",
  server: "globe",
};

function artifactIcon(kind) {
  return ARTIFACT_ICONS[String(kind || "")] || "file-text";
}

function artifactLabel(kind) {
  switch (String(kind || "")) {
    case "html":
      return "Interactive";
    case "svg":
      return "Graphic";
    case "markdown":
      return "Document";
    case "json":
      return "Data";
    case "csv":
      return "Table";
    case "server":
      return "Dev server";
    case "url":
      return "Web page";
    default:
      return "File";
  }
}

export default function Transcript({
  thread,
  agents,
  selected,
  channel,
  sending,
  linger,
  draft,
  lastKeyAt,
  composeAt,
  since,
  clock,
  dm,
  onChoose,
  onCustomChoice,
  onOpenDm,
  onOpenArtifact,
  onOpenRoutine,
  onReply,
  onJumpTo,
  onMessageMenu,
}) {
  const list = Array.isArray(thread) ? thread.filter((m) => m && typeof m === "object") : [];
  // Which originals are still in the thread — a reply to a deleted message
  // has to say so rather than pretending.
  const known = new Set(list.map((m) => String(m.id)));
  const roster = Array.isArray(agents) ? agents : [];
  const byId = Object.fromEntries(roster.map((a) => [a.id, a]));
  const memberIds = new Set((channel?.members || []).map(String));
  const showFaces = !!channel;
  // The conversation on screen. A bot-to-bot thread is view-only, so nothing
  // in it ever animates.
  const convId = dm ? null : channel?.id || selected?.id || null;
  let lastDay = "";

  function react(messageId, emoji) {
    window.hydo?.react?.(messageId, emoji);
  }

  function stamp(at) {
    const day = dayKey(at);
    if (!day || day === lastDay) return null;
    lastDay = day;
    return <div className="sand-day">{dayLabel(at)}</div>;
  }

  function workingRow(agent, key, extra = {}) {
    if (!agent) return null;
    const busy = humanActivity(agent.activity) || humanActivity(agent.activityDetail) || "Working";
    const presence = presenceOf({
      // Per-bot join delay, so two faces in a channel do not appear in
      // lockstep like a UI animation.
      joinMs: joinDelayOf(agent.id),
      working: busyHere(agent, convId),
      sending: !!sending,
      linger: !!linger,
      activity: agent.activity || agent.activityDetail || "",
      draft,
      lastKeyAt,
      composeAt,
      since,
      now: clock,
      ...extra,
    });
    if (!presence.visible) return null;
    return (
      <div
        className="sand-inchat"
        key={key}
        data-mood={presence.mood}
        data-kind={presence.kind}
        data-phase={presence.phase}
      >
        <UmbraFace
          tint={agent.blob}
          shape={agent.shape}
          size={28}
          live
          morph
          mood={presence.mood}
        />
        <span className="sand-inchat__idle" />
        <span className="sand-inchat__busy">{busy}</span>
      </div>
    );
  }

  const members = channel ? roster.filter((a) => memberIds.has(String(a.id))) : [];
  const waitId = members[0] ? members[0].id : null;
  const workingRows = channel
    ? members
        .map((a) =>
          workingRow(
            a,
            a.id,
            composerExtrasForMember(a.id, waitId, {
              sending,
              linger,
              draft,
              lastKeyAt,
              composeAt,
              since,
              now: clock,
            })
          )
        )
        .filter(Boolean)
    : !dm && selected
    ? [workingRow(selected, "self")].filter(Boolean)
    : [];

  let burstI = 0;
  const nowMs = Date.now();

  return (
    <div className="sand-transcript">
      {list.map((msg, index) => {
        const day = stamp(msg.at);
        const from = msg.fromId ? byId[msg.fromId] : null;
        const user = msg.role === "user";
        const bubble = isBubble(msg);
        const prev = list[index - 1];
        const next = list[index + 1];
        const key = speakerKey(msg);

        // iMessage grouping: consecutive bubbles from the same speaker sit
        // close together with their facing corners squared off; a change of
        // speaker (or any card) opens a bigger gap.
        const contAbove = bubble && !!prev && isBubble(prev) && speakerKey(prev) === key;
        const contBelow = bubble && !!next && isBubble(next) && speakerKey(next) === key;
        const sep = index > 0 && !contAbove ? " hy-sep" : "";
        const atMs = new Date(msg.at).getTime();
        const prevMs = prev ? new Date(prev.at).getTime() : 0;
        if (contAbove && Number.isFinite(atMs) && Number.isFinite(prevMs) && atMs - prevMs < 2500) {
          burstI += 1;
        } else {
          burstI = 0;
        }
        const fresh = (Number.isFinite(atMs) && nowMs - atMs < 5000) || (!user && msg.streaming);
        const enter = fresh ? " hy-item--in" : "";
        const enterStyle = fresh && burstI ? { animationDelay: `${burstI * 90}ms` } : undefined;

        if (msg.kind === "event") {
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`hy-item${sep}${enter}`} style={enterStyle}>
              {day}
              <div className="hy-event">{toText(msg.text)}</div>
            </div>
          );
        }

        if (msg.kind === "routine") {
          const gone = msg.action === "deleted";
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`hy-item${sep}${enter}`} style={enterStyle}>
              {day}
              <button
                type="button"
                className={gone ? "sand-routine-chip sand-routine-chip--gone" : "sand-routine-chip"}
                onClick={() => {
                  if (!gone) onOpenRoutine?.(msg.routineId);
                }}
              >
                {gone ? "Deleted routine" : "Created routine"}{" "}
                <i className={`gb-icon ${gone ? "gb-icon-x-circle" : "gb-icon-alarm-clock"}`} />{" "}
                {toText(msg.text)}
              </button>
            </div>
          );
        }

        // Something the bot MADE. A card at the point in the conversation
        // where it appeared, opening the pane rather than dumping a wall of
        // HTML into the thread.
        if (msg.kind === "artifact") {
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`hy-item${sep}${enter}`} style={enterStyle}>
              <button
                type="button"
                className="hy-artifact"
                onClick={() => onOpenArtifact?.(msg.artifactId)}
              >
                <span className="hy-artifact__icon" aria-hidden="true">
                  <i className={`gb-icon gb-icon-${artifactIcon(msg.artifactKind)}`} />
                </span>
                <span className="hy-artifact__copy">
                  <span className="hy-artifact__name">{msg.text || "Artifact"}</span>
                  <span className="hy-artifact__meta">
                    {artifactLabel(msg.artifactKind)}
                    {msg.versions > 1 ? ` · v${msg.versions}` : ""}
                  </span>
                </span>
                <i className="gb-icon gb-icon-chevron-right" aria-hidden="true" />
              </button>
            </div>
          );
        }

        if (msg.kind === "tally") {
          const who = from || byId[msg.peerId];
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`hy-item${sep}${enter}`} style={enterStyle}>
              {day}
              <button type="button" className="sand-tally" onClick={() => who && onOpenDm?.(who.id)}>
                {toText(msg.text)} {who ? <UmbraFace tint={who.blob} shape={who.shape} size={16} /> : null}{" "}
                {who?.name}
              </button>
            </div>
          );
        }

        if (msg.kind === "choice") {
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`hy-item${sep}${enter}`} style={enterStyle}>
              {day}
              <ChoiceCard
                title={toText(msg.text)}
                choices={msg.choices}
                picked={msg.picked ?? null}
                onPick={(choiceId) => onChoose?.(msg.id, choiceId)}
                onCustom={(text) => onCustomChoice?.(msg.id, text)}
              />
            </div>
          );
        }

        if (msg.kind === "approval") {
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`hy-item${sep}${enter}`} style={enterStyle}>
              {day}
              <ApprovalCard msg={msg} from={from} />
            </div>
          );
        }

        if (msg.kind === "gate") {
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`hy-item${sep}${enter}`} style={enterStyle}>
              {day}
              <GateCard msg={msg} from={from} />
            </div>
          );
        }

        if (msg.kind === "clarify") {
          const answered = msg.answered ? String(msg.answered) : "";
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`hy-item${sep}${enter}`} style={enterStyle}>
              {day}
              <ChoiceCard
                title={toText(msg.text) || "Quick question."}
                sub={
                  answered
                    ? "Answered — carrying on."
                    : "I've paused until you answer. Pick one or type your own."
                }
                choices={msg.choices}
                picked={answered || null}
                resolved={!!answered}
                answer={answered}
                speaker={from}
                requireCustom
                onPick={(choiceId) => {
                  const hit = (msg.choices || []).find((c) => c.id === choiceId);
                  window.hydo?.answerClarify?.(msg.id, hit ? hit.text : choiceId);
                }}
                onCustom={(text) => window.hydo?.answerClarify?.(msg.id, text)}
              />
            </div>
          );
        }

        if (!bubble) {
          // An unrecognised kind is never dumped into a bubble — that is how
          // tool traces leak. A plain sentence becomes a quiet system line;
          // anything else renders nothing at all.
          const raw = toText(msg.text).trim();
          const speakable = raw && raw.length <= 200 && !/[{}[\]]|^\s*</.test(raw);
          if (!speakable) return null;
          return (
            <div key={msg.id} id={`msg-${msg.id}`} className={`hy-item${sep}${enter}`} style={enterStyle}>
              {day}
              <div className="hy-event">{raw}</div>
            </div>
          );
        }

        // A channel (or a bot-to-bot thread) shows who is speaking, but only
        // once per run of messages — a 1:1 thread never does.
        const named = !!(!user && from && (dm || !!channel));
        const showHeader = named && !contAbove;
        const rowClass = [
          "sand-transcript-row",
          user ? "sand-transcript-row--user" : "",
          named ? "sand-transcript-row--named" : "",
          named && !showHeader ? "hy-row--tucked" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div key={msg.id} id={`msg-${msg.id}`} className={`hy-item${sep}${enter}`} style={enterStyle}>
            {day}
            <div className={rowClass}>
              {showHeader ? (
                <UmbraFace
                  tint={from.blob}
                  shape={from.shape}
                  size={28}
                  live={busyHere(from, convId)}
                  mood={busyHere(from, convId) ? "thinking" : "idle"}
                />
              ) : null}
              <div className="hy-msg__col">
                {showHeader ? <div className="sand-bubble-name">{from.name}</div> : null}
                <Bubble
                  msg={msg}
                  user={user}
                  groupTop={contAbove}
                  groupBottom={contBelow}
                  byId={byId}
                  known={known}
                  userName="You"
                  showFaces={showFaces}
                  onReact={react}
                  onReply={onReply}
                  onJumpTo={onJumpTo}
                  onMessageMenu={onMessageMenu}
                />
              </div>
            </div>
          </div>
        );
      })}
      {workingRows}
      <div id="transcript-end" />
    </div>
  );
}
