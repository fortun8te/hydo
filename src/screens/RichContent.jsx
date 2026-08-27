import { memo, useCallback, useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { createPortal } from "react-dom";
import {
  KIND_LABEL,
  MAX_PREVIEW_TEXT,
  extOf,
  isPropertyZip,
  isTextish,
  normKind,
  splitName,
} from "../lib/file-preview.js";

/* ===========================================================================
   RichContent — the things a teammate's message can contain.

   The governing rule: nothing in here may ever read as tool plumbing. No
   raw traces, no JSON, no "I called the read_file tool". A file arrives as
   a file chip. A link arrives as a link card. A long-running job arrives as
   a small "Computer" card with a status pill — never as a dump of output.
   The machinery stays in the logs; this is the messaging app.

   Hard constraints held by every export below:
     - zero npm dependencies (react only)
     - no dangerouslySetInnerHTML anywhere — every string reaches the DOM as
       a React text child, which React escapes for us
     - total: any input at all (undefined, null, a number, an object, an
       unclosed fence, a raw <script> tag, a lone `*`) renders *something*
       and never throws
     - colour comes only from design tokens, always with a fallback
   =========================================================================== */

/* --------------------------------------------------------------------------
   Shared primitives
   -------------------------------------------------------------------------- */

const MAX_INPUT = 200000; // hard cap so a runaway string can't wedge layout
const MAX_DEPTH = 6; // recursion guard for nested emphasis / quotes / lists

// Coerce literally anything into a string without throwing. Objects with a
// hostile toString/Symbol.toPrimitive fall through the catch to "".
/** A fence we should draw: tagged `svg`, or untagged markup that opens with <svg. */
function isSvgFence(lang, text) {
  const l = String(lang || "").toLowerCase();
  if (l && l !== "svg" && l !== "xml") return false;
  return /^\s*<svg[\s>]/i.test(String(text || ""));
}

/**
 * SVG source to a data: URI for <img>.
 *
 * Returns "" for anything that is not a single well-formed <svg> root, so a
 * half-streamed or malformed block falls back to being shown as code rather
 * than to a broken image icon.
 */
function svgDataUri(text) {
  const raw = String(text || "").trim();
  if (!/^<svg[\s>]/i.test(raw) || !/<\/svg>\s*$/i.test(raw)) return "";
  if (raw.length > 400_000) return "";
  try {
    // encodeURIComponent, not base64: keeps it readable in devtools and
    // avoids a needless 33% size increase on what is already text.
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raw)}`;
  } catch {
    return "";
  }
}

function toText(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (Array.isArray(v)) {
    try {
      return v.map(toText).join("\n");
    } catch {
      return "";
    }
  }
  try {
    const s = String(v);
    return typeof s === "string" ? s : "";
  } catch {
    return "";
  }
}

function normalize(raw) {
  let s = toText(raw);
  if (s.length > MAX_INPUT) s = `${s.slice(0, MAX_INPUT)}\n…`;
  return s.replace(/\r\n?/g, "\n");
}

// Run a render body; if anything at all goes wrong, fall back rather than
// taking the whole transcript down with an error boundary.
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return typeof fallback === "function" ? fallback() : fallback ?? null;
  }
}

// A src we're willing to hand to <img>. Anything else (javascript:, vbscript:,
// a bare word) gets a placeholder tile instead.
function safeSrc(v) {
  const s = toText(v).trim();
  if (!s) return "";
  if (/^(https?:\/\/|data:image\/|blob:|file:\/\/|\/)/i.test(s)) return s;
  return "";
}

/**
 * TeX to HTML, via KaTeX.
 *
 * `dangerouslySetInnerHTML` on model-authored input is normally the wrong
 * answer. It is correct here for one specific reason: KaTeX with `trust:false`
 * (the default, set explicitly below so nobody "simplifies" it away) is
 * documented safe for untrusted input — it escapes everything and refuses the
 * commands that can emit raw HTML or hrefs. `strict:false` and
 * `throwOnError:false` mean an unknown macro renders in red rather than
 * throwing and taking the bubble with it.
 *
 * Do not pass `trust:true`, and do not feed this anything but TeX.
 */
function texHtml(tex, displayMode) {
  try {
    return katex.renderToString(toText(tex), {
      displayMode: !!displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: "html",
    });
  } catch {
    return "";
  }
}

function Tex({ tex, block }) {
  const html = safe(() => texHtml(tex, block), "");
  // No KaTeX output at all: show the source rather than an empty gap, so a
  // formula is never silently lost.
  if (!html) {
    return <code className="hy-rc-code">{toText(tex)}</code>;
  }
  return (
    <span
      className={block ? "hy-rc-tex hy-rc-tex--block" : "hy-rc-tex"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

/* --------------------------------------------------------------------------
   Markdown — a total, dependency-free subset renderer.

   Supports: fenced code blocks, inline code, bold, italic, strikethrough,
   links (blue, inline, deliberately NOT clickable — this is a desktop app and
   we do not open arbitrary URLs), headings, bullet + numbered lists (nested),
   blockquotes, horizontal rules and pipe tables.

   Every parsing loop provably advances its cursor: each iteration either
   consumes a matched construct (moving past it) or falls through to a single
   literal character / line. So no input can hang the renderer, and an
   unclosed fence simply runs to the end of the text.
   -------------------------------------------------------------------------- */

const ESCAPABLE = "\\`*_~[]()#>-+.!|";

function indentOf(line) {
  let n = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === " ") n += 1;
    else if (line[i] === "\t") n += 2;
    else break;
  }
  return n;
}

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/;
const RE_HEADING = /^ {0,3}(#{1,6})(?:\s+(.*))?$/;
const RE_HR = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const RE_QUOTE = /^ {0,3}>\s?/;
const RE_UL = /^(\s*)([-*+])\s+(.*)$/;
const RE_OL = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const RE_TASK = /^\[([ xX])\]\s+/;
const RE_TABLE_DIV = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;

function isBlockStart(line) {
  return (
    RE_FENCE.test(line) ||
    RE_HEADING.test(line) ||
    RE_HR.test(line) ||
    RE_QUOTE.test(line) ||
    RE_UL.test(line) ||
    RE_OL.test(line)
  );
}

function trimTrailingPunct(url) {
  let end = url.length;
  while (end > 0 && ".,;:!?)]}'\"".includes(url[end - 1])) {
    if (url[end - 1] === ")") {
      // keep balanced parens: en.wikipedia.org/wiki/Foo_(bar)
      const opens = (url.slice(0, end).match(/\(/g) || []).length;
      const closes = (url.slice(0, end).match(/\)/g) || []).length;
      if (opens >= closes) break;
    }
    end -= 1;
  }
  return url.slice(0, end);
}

function isWordChar(ch) {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

// A URL we're willing to show in a tooltip. `javascript:` and friends never
// become an href here — nothing in Markdown is clickable — but there's no
// reason to surface them either.
/**
 * A URL we are willing to OPEN, as opposed to merely display.
 *
 * Only http(s). `shell.openExternal` hands anything else straight to the OS,
 * and the string arrives here from a model: `file://`, `smb://`, or a custom
 * scheme registered by some other app are all things you do not want one click
 * away. Main re-checks the scheme too — this is the first of two gates, not
 * the only one.
 */
function openableUrl(url) {
  const s = toText(url).trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

function titleUrl(url) {
  const s = toText(url).trim();
  if (!s) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^(https?|mailto|file|ftp):/i.test(s)) return undefined;
  return s;
}

/**
 * Inline spans. Returns an array of strings and React elements. Total: any
 * unmatched marker falls through as a literal character.
 */
function parseInline(raw, keyBase = "i", depth = 0) {
  const text = toText(raw);
  const base = toText(keyBase) || "i";
  const d = typeof depth === "number" && depth >= 0 ? depth : 0;
  const out = [];
  let buf = "";
  let i = 0;
  let key = 0;
  const n = text.length;

  const flush = () => {
    if (buf) {
      out.push(buf);
      buf = "";
    }
  };
  const push = (node) => {
    flush();
    out.push(node);
  };
  const inner = (s, kb) => (d >= MAX_DEPTH ? s : parseInline(s, kb, d + 1));

  while (i < n) {
    const ch = text[i];

    // math: \( inline \) and \[ display \].
    //
    // A bare `$` is NOT a delimiter here on purpose. "$5,000 to $8,000" is far
    // more common in these threads than inline TeX, and treating it as math
    // silently eats the text between two prices.
    if (ch === "\\" && (text[i + 1] === "(" || text[i + 1] === "[")) {
      const display = text[i + 1] === "[";
      const close = display ? "\\]" : "\\)";
      const end = text.indexOf(close, i + 2);
      if (end !== -1) {
        push(<Tex key={`${base}-m${key++}`} tex={text.slice(i + 2, end)} block={display} />);
        i = end + 2;
        continue;
      }
    }

    // backslash escape
    if (ch === "\\" && i + 1 < n && ESCAPABLE.includes(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }

    // $$ ... $$ inline. Doubled only; see the note above about single `$`.
    if (ch === "$" && text[i + 1] === "$") {
      const end = text.indexOf("$$", i + 2);
      if (end !== -1 && end > i + 2) {
        push(<Tex key={`${base}-M${key++}`} tex={text.slice(i + 2, end)} block={false} />);
        i = end + 2;
        continue;
      }
    }

    // inline code — a run of N backticks closed by the same run
    if (ch === "`") {
      let run = 1;
      while (text[i + run] === "`") run += 1;
      const fence = "`".repeat(run);
      const end = text.indexOf(fence, i + run);
      if (end !== -1) {
        let code = text.slice(i + run, end);
        if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ")) {
          code = code.slice(1, -1);
        }
        push(
          <code className="hy-rc-code" key={`${base}-c${key++}`}>
            {code}
          </code>
        );
        i = end + run;
        continue;
      }
    }

    // strikethrough
    if (ch === "~" && text[i + 1] === "~") {
      const end = text.indexOf("~~", i + 2);
      if (end > i + 2) {
        push(
          <s className="hy-rc-strike" key={`${base}-s${key++}`}>
            {inner(text.slice(i + 2, end), `${base}-s${key}`)}
          </s>
        );
        i = end + 2;
        continue;
      }
    }

    // bold / italic — ** __ for strong, * _ for emphasis. Underscores only
    // count at word boundaries so snake_case_names survive intact.
    if (ch === "*" || ch === "_") {
      const doubled = text[i + 1] === ch;
      const marker = doubled ? ch + ch : ch;
      const start = i + marker.length;
      const end = text.indexOf(marker, start);
      const boundaryOk =
        ch === "*" ||
        (!isWordChar(text[i - 1]) && end !== -1 && !isWordChar(text[end + marker.length]));
      if (end > start && boundaryOk && text[start] !== " ") {
        const body = text.slice(start, end);
        if (doubled) {
          push(
            <strong className="hy-rc-strong" key={`${base}-b${key++}`}>
              {inner(body, `${base}-b${key}`)}
            </strong>
          );
        } else {
          push(
            <em className="hy-rc-em" key={`${base}-e${key++}`}>
              {inner(body, `${base}-e${key}`)}
            </em>
          );
        }
        i = end + marker.length;
        continue;
      }
    }

    // [label](url) and ![alt](src). http(s) opens in the real browser; anything
    // else stays inert text, which is what this used to be for EVERY link —
    // so a teammate could hand you a URL and there was no way to follow it.
    if (ch === "[" || (ch === "!" && text[i + 1] === "[")) {
      const open = ch === "!" ? i + 1 : i;
      const closeBracket = text.indexOf("]", open + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === "(") {
        const closeParen = text.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket + 1) {
          const label = text.slice(open + 1, closeBracket);
          const url = text.slice(closeBracket + 2, closeParen).split(/\s+/)[0];
          const openable = openableUrl(url);
          push(
            openable ? (
              <a
                className="hy-rc-link hy-rc-link--open"
                key={`${base}-l${key++}`}
                href={openable}
                title={titleUrl(url)}
                rel="noreferrer noopener"
                onClick={(e) => {
                  // Never let the renderer itself navigate: that would replace
                  // the app with the page and there is no way back.
                  e.preventDefault();
                  window.hydo?.openExternal?.(openable);
                }}
              >
                {label ? inner(label, `${base}-l${key}`) : url}
              </a>
            ) : (
              <span
                className="hy-rc-link"
                key={`${base}-l${key++}`}
                title={titleUrl(url)}
              >
                {label ? inner(label, `${base}-l${key}`) : url}
              </span>
            )
          );
          i = closeParen + 1;
          continue;
        }
      }
    }

    // bare autolink
    if ((ch === "h" || ch === "w") && !isWordChar(text[i - 1])) {
      const m = /^(?:https?:\/\/|www\.)[^\s<>[\]()"'`]+[^\s<>[\]"'`]*/.exec(text.slice(i));
      if (m) {
        const url = trimTrailingPunct(m[0]);
        if (url.length > 4) {
          // `www.foo.com` has no scheme; give it https so it is openable.
          const href = openableUrl(/^www\./i.test(url) ? `https://${url}` : url);
          push(
            href ? (
              <a
                className="hy-rc-link hy-rc-link--open"
                key={`${base}-a${key++}`}
                href={href}
                title={url}
                rel="noreferrer noopener"
                onClick={(e) => {
                  e.preventDefault();
                  window.hydo?.openExternal?.(href);
                }}
              >
                {url}
              </a>
            ) : (
              <span className="hy-rc-link" key={`${base}-a${key++}`} title={url}>
                {url}
              </span>
            )
          );
          i += url.length;
          continue;
        }
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

/**
 * Block-level split. Returns a flat array of plain-object blocks.
 */
function parseBlocks(raw, depth = 0) {
  const text = normalize(raw);
  if (!text.trim()) return [];
  const d = typeof depth === "number" && depth >= 0 ? depth : 0;
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // A `$$` on its own line opens a DISPLAY math block, closed by the next
    // one. Centred and on its own row, the way an equation should sit.
    if (/^\s*\$\$\s*$/.test(line)) {
      const start = i + 1;
      let j = start;
      while (j < lines.length && !/^\s*\$\$\s*$/.test(lines[j])) j += 1;
      // No closing `$$`: not a math block, fall through and treat it as text.
      if (j < lines.length) {
        blocks.push({ type: "math", text: lines.slice(start, j).join("\n") });
        i = j + 1;
        continue;
      }
    }

    // fenced code — an unclosed fence just runs to EOF
    const fence = RE_FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = toText(fence[2]).trim().split(/\s+/)[0] || "";
      const code = [];
      i += 1;
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[i]);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) break;
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume the closing fence when there is one
      blocks.push({ type: "code", lang, text: code.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (RE_HR.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: Math.min(6, Math.max(1, heading[1].length)),
        text: toText(heading[2]).replace(/\s+#+\s*$/, ""),
      });
      i += 1;
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const quote = [];
      while (i < lines.length && (RE_QUOTE.test(lines[i]) || (quote.length && lines[i].trim() !== "" && !isBlockStart(lines[i])))) {
        quote.push(lines[i].replace(RE_QUOTE, ""));
        i += 1;
      }
      blocks.push({
        type: "quote",
        blocks: d >= MAX_DEPTH ? [{ type: "p", text: quote.join("\n") }] : parseBlocks(quote.join("\n"), d + 1),
      });
      continue;
    }

    // table: a header row plus a |---|---| divider
    if (line.includes("|") && i + 1 < lines.length && RE_TABLE_DIV.test(lines[i + 1])) {
      const cells = (row) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(cells(lines[i]));
        i += 1;
      }
      blocks.push({ type: "table", head, rows });
      continue;
    }

    const listMatch = RE_UL.exec(line) || RE_OL.exec(line);
    if (listMatch) {
      const ordered = !RE_UL.test(line);
      const baseIndent = indentOf(line);
      const items = [];
      let start = 1;
      let guard = 0;
      while (i < lines.length && guard < 5000) {
        guard += 1;
        const m = RE_UL.exec(lines[i]) || RE_OL.exec(lines[i]);
        const sameKind = m && !RE_UL.test(lines[i]) === ordered;
        if (!m || !sameKind || indentOf(lines[i]) > baseIndent + 1) break;
        if (ordered && items.length === 0) start = Number(m[2]) || 1;
        const own = [m[3]];
        i += 1;
        // continuation lines and nested lists belong to this item
        while (
          i < lines.length &&
          lines[i].trim() !== "" &&
          (indentOf(lines[i]) > baseIndent + 1 || !isBlockStart(lines[i]))
        ) {
          const cut = Math.min(indentOf(lines[i]), baseIndent + 2);
          own.push(lines[i].slice(cut));
          i += 1;
        }
        items.push(own.join("\n"));
      }
      // GFM task list: `- [ ] thing` / `- [x] thing`. Agents write checklists
      // constantly, and without this the brackets rendered as literal text.
      // A list counts as a task list only if EVERY item is one, so a stray
      // "[x] " inside prose does not turn a normal list into checkboxes.
      const tasks = items.map((it) => RE_TASK.exec(it));
      if (!ordered && items.length && tasks.every(Boolean)) {
        blocks.push({
          type: "tasks",
          items: tasks.map((m, k) => ({
            done: m[1].toLowerCase() === "x",
            text: items[k].slice(m[0].length),
          })),
        });
        continue;
      }
      if (!items.length) {
        // defensive: never leave the cursor parked
        blocks.push({ type: "p", text: line });
        i += 1;
        continue;
      }
      blocks.push({
        type: ordered ? "ol" : "ul",
        start,
        items: items.map((it) =>
          d >= MAX_DEPTH ? [{ type: "p", text: it }] : parseBlocks(it, d + 1)
        ),
      });
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    if (!para.length) {
      // the line matched nothing and consumed nothing — take it literally
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: "p", text: para.join("\n") });
  }

  return blocks;
}

function Caret() {
  // shares .hy-caret with the transcript's streaming caret
  return <span className="hy-caret hy-rc-caret" aria-hidden="true" />;
}

function InlineLines({ text, keyBase, caret }) {
  const lines = toText(text).split("\n");
  return lines.map((l, i) => (
    <span key={i}>
      {parseInline(l, `${keyBase}-${i}`)}
      {i < lines.length - 1 ? <br /> : null}
      {caret && i === lines.length - 1 ? <Caret /> : null}
    </span>
  ));
}

function MdBlock({ block, idx, caret }) {
  const b = block || { type: "p", text: "" };

  // ```svg — draw it, don't print it.
  //
  // Rendered through an <img> with a data: URI, NEVER by injecting the markup
  // into the document. SVG is a full document format: inline it and any
  // <script> or <foreignObject> inside runs in THIS renderer, which holds the
  // preload bridge. Loaded as an image, SVG scripting is disabled by the
  // browser and external references do not load. A chart still draws.
  if (b.type === "code" && isSvgFence(b.lang, b.text) && !caret) {
    const src = svgDataUri(b.text);
    if (src) {
      return (
        <figure className="hy-rc-svg">
          <img src={src} alt="Diagram" draggable="false" />
        </figure>
      );
    }
  }

  if (b.type === "code") {
    return (
      <div className="hy-rc-pre-wrap">
        {b.lang ? <span className="hy-rc-pre-lang">{b.lang}</span> : null}
        <pre className="hy-rc-pre" tabIndex={0} aria-label={b.lang ? `${b.lang} code block` : "code block"}>
          <code className="hy-rc-pre-code">
            {b.text}
            {caret ? <Caret /> : null}
          </code>
        </pre>
      </div>
    );
  }

  if (b.type === "tasks") {
    return (
      <ul className="hy-rc-tasks">
        {(b.items || []).map((it, k) => (
          <li key={k} className={it.done ? "hy-rc-task-item is-done" : "hy-rc-task-item"}>
            {/* Presentational, not an input: this is a record of what the bot
                said, not a control. Ticking it here would change nothing and
                imply it did. */}
            <span className="hy-rc-task-box" aria-hidden="true">
              {it.done ? "\u2713" : ""}
            </span>
            <span className="hy-rc-task-text">{parseInline(it.text, `t${k}`)}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (b.type === "math") {
    return (
      <div className="hy-rc-mathblock">
        <Tex tex={b.text} block />
      </div>
    );
  }

  if (b.type === "hr") return <hr className="hy-rc-hr" />;

  if (b.type === "heading") {
    const Tag = `h${b.level || 3}`;
    return (
      <Tag className={`hy-rc-h hy-rc-h${b.level || 3}`}>
        {parseInline(b.text, `h${idx}`)}
        {caret ? <Caret /> : null}
      </Tag>
    );
  }

  if (b.type === "quote") {
    const kids = Array.isArray(b.blocks) ? b.blocks : [];
    return (
      <blockquote className="hy-rc-quote">
        {kids.map((k, i) => (
          <MdBlock block={k} idx={`${idx}-${i}`} key={i} caret={caret && i === kids.length - 1} />
        ))}
      </blockquote>
    );
  }

  if (b.type === "ul" || b.type === "ol") {
    const Tag = b.type === "ul" ? "ul" : "ol";
    const items = Array.isArray(b.items) ? b.items : [];
    const extra = b.type === "ol" && b.start > 1 ? { start: b.start } : {};
    return (
      <Tag className={`hy-rc-list hy-rc-list--${b.type}`} {...extra}>
        {items.map((kids, i) => (
          <li className="hy-rc-li" key={i}>
            {(Array.isArray(kids) ? kids : []).map((k, j) => (
              <MdBlock
                block={k}
                idx={`${idx}-${i}-${j}`}
                key={j}
                caret={caret && i === items.length - 1 && j === kids.length - 1}
              />
            ))}
          </li>
        ))}
      </Tag>
    );
  }

  if (b.type === "table") {
    const head = Array.isArray(b.head) ? b.head : [];
    const rows = Array.isArray(b.rows) ? b.rows : [];
    return (
      <div className="hy-rc-table-wrap" tabIndex={0}>
        <table className="hy-rc-table">
          {head.length ? (
            <thead>
              <tr>
                {head.map((c, i) => (
                  <th key={i}>{parseInline(c, `th${idx}-${i}`)}</th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {(Array.isArray(r) ? r : []).map((c, j) => (
                  <td key={j}>{parseInline(c, `td${idx}-${i}-${j}`)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <p className="hy-rc-p">
      <InlineLines text={b.text} keyBase={`p${idx}`} caret={caret} />
    </p>
  );
}

/**
 * <Markdown text caret />
 *   text  — anything. Non-strings are coerced; null/undefined render nothing.
 *   caret — optional boolean; appends the blinking streaming caret to the
 *           last block (matches the transcript's existing `hy-caret`).
 */
export const Markdown = memo(function Markdown({ text, caret }) {
  let blocks;
  try {
    blocks = parseBlocks(text);
  } catch {
    blocks = [{ type: "p", text: toText(text) }];
  }
  if (!Array.isArray(blocks) || !blocks.length) {
    return caret ? <Caret /> : null;
  }
  return safe(
    () => (
      <div className="hy-rc hy-rc-md">
        {blocks.map((b, i) => (
          <MdBlock block={b} idx={i} key={i} caret={!!caret && i === blocks.length - 1} />
        ))}
      </div>
    ),
    () => (
      <div className="hy-rc hy-rc-md">
        <p className="hy-rc-p">{toText(text)}</p>
      </div>
    )
  );
});

/* --------------------------------------------------------------------------
   File chips
   -------------------------------------------------------------------------- */



/** Human size. Accepts bytes (number) or an already-formatted string. */
function humanSize(size) {
  if (typeof size === "string") {
    const s = size.trim();
    if (!s) return "";
    if (/^\d+(\.\d+)?$/.test(s)) return humanSize(Number(s));
    return s;
  }
  const n = typeof size === "number" && Number.isFinite(size) ? size : NaN;
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1000) return `${Math.round(n)}B`;
  if (n < 1000 * 1000) return `${Math.round(n / 1000)}kB`;
  if (n < 1000 * 1000 * 1000) {
    const mb = n / (1000 * 1000);
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
  }
  const gb = n / (1000 * 1000 * 1000);
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)}GB`;
}

function FileGlyph({ kind }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    focusable: "false",
    className: "hy-rc-file-glyph",
  };

  if (kind === "nd") {
    return (
      <svg {...common}>
        <rect x="2.6" y="5.2" width="18.8" height="13.6" rx="2.6" />
        <path d="M7 9.2h10M7 12.2h7.5M7 15.2h5" />
      </svg>
    );
  }
  if (kind === "markdown") {
    return (
      <svg {...common}>
        <rect x="2.6" y="5.2" width="18.8" height="13.6" rx="2.6" />
        <path d="M6.2 15.6V9.1l2.9 3.5 2.9-3.5v6.5" />
        <path d="M15.9 9.1v5.1m0 0 1.9-2m-1.9 2-1.9-2" />
      </svg>
    );
  }
  if (kind === "pdf") {
    return (
      <svg {...common}>
        <path d="M14 3H7.6A2.1 2.1 0 0 0 5.5 5.1v13.8A2.1 2.1 0 0 0 7.6 21h8.8a2.1 2.1 0 0 0 2.1-2.1V8z" />
        <path d="M14 3v5h4.5" />
        <rect x="7.9" y="13.4" width="8.2" height="4.8" rx="1.2" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "html") {
    return (
      <svg {...common}>
        <path d="M8.8 8.2 4.9 12l3.9 3.8" />
        <path d="M15.2 8.2 19.1 12l-3.9 3.8" />
        <path d="M13.4 5.9 10.6 18.1" />
      </svg>
    );
  }
  if (kind === "archive") {
    return (
      <svg {...common}>
        <rect x="4.2" y="4.4" width="15.6" height="15.2" rx="2.6" />
        <path d="M10.6 4.4v2.4M13.4 6.8v2.4M10.6 9.2v2.4M13.4 11.6V14" />
        <rect x="10.4" y="14" width="3.2" height="4.2" rx="1.3" />
      </svg>
    );
  }
  if (kind === "image") {
    return (
      <svg {...common}>
        <rect x="3.4" y="5" width="17.2" height="14" rx="2.6" />
        <circle cx="9" cy="10.2" r="1.5" />
        <path d="M4.2 17.2 9 12.6l3.4 3.3 3.1-2.9 4.3 4.2" />
      </svg>
    );
  }
  if (kind === "code") {
    return (
      <svg {...common}>
        <rect x="3" y="4.6" width="18" height="14.8" rx="2.6" />
        <path d="M7.6 10.4 10 12.6l-2.4 2.2" />
        <path d="M12.4 15.2h4" />
      </svg>
    );
  }
  if (kind === "doc") {
    return (
      <svg {...common}>
        <path d="M14 3H7.6A2.1 2.1 0 0 0 5.5 5.1v13.8A2.1 2.1 0 0 0 7.6 21h8.8a2.1 2.1 0 0 0 2.1-2.1V8z" />
        <path d="M14 3v5h4.5" />
        <path d="M8.6 12.8h6.8M8.6 16.1h4.6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M14 3H7.6A2.1 2.1 0 0 0 5.5 5.1v13.8A2.1 2.1 0 0 0 7.6 21h8.8a2.1 2.1 0 0 0 2.1-2.1V8z" />
      <path d="M14 3v5h4.5" />
    </svg>
  );
}

/**
 * <FileChip file onOpen />
 *   file   — { name, ext?, size?, kind?, text? }. `size` may be bytes or a
 *            string. Everything is optional; a bare {} still renders sanely.
 *   onOpen — optional (file) => void. Supplied, the caller owns the click.
 *            Omitted, the chip opens its own single-item MediaViewer.
 * Always a real <button>: Enter/Space reachable, focus-ringed.
 */
export function FileChip({ file, onOpen }) {
  const viewer = useSelfViewer(onOpen);
  const f = file && typeof file === "object" ? file : {};
  const chip = safe(
    () => {
      const raw = toText(f.name) || "Untitled";
      const name = raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
      const split = splitName(name);
      const ext = toText(f.ext) ? (toText(f.ext).startsWith(".") ? toText(f.ext) : `.${toText(f.ext)}`) : split.ext;
      const base = split.ext || !ext ? split.base : name;
      const kind = normKind(f.kind, ext || split.ext);
      const size = humanSize(f.size);
      const label = KIND_LABEL[kind] || KIND_LABEL.file;
      const full = `${base}${ext}`;

      return (
        <div className={cx("hy-rc", "hy-rc-file", `hy-rc-file--${kind}`)}>
          <button
            type="button"
            className="hy-rc-file-open"
            title={full}
            onClick={() => (viewer.controlled ? onOpen(f) : viewer.openAt(0))}
            aria-label={`${full}${size ? `, ${size}` : ""}`}
          >
            <span className={cx("hy-rc-file-tile", `hy-rc-file-tile--${kind}`)} aria-hidden="true">
              <FileGlyph kind={kind} />
            </span>
            <span className="hy-rc-file-body">
              <span className="hy-rc-file-name">
                <span className="hy-rc-file-name-base">{base}</span>
                {ext ? <span className="hy-rc-file-name-ext">{ext}</span> : null}
              </span>
              <span className="hy-rc-file-meta">{size || label}</span>
            </span>
          </button>
          {f.path || f.src ? (
            <button
              type="button"
              className="hy-rc-file-dl"
              title="Download"
              aria-label={`Download ${full}`}
              onClick={(e) => {
                e.stopPropagation();
                if (f.path && window.hydo?.saveFile) window.hydo.saveFile(f.path, full);
              }}
            >
              <i className="gb-icon gb-icon-arrow-down" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      );
    },
    () => <div className="hy-rc hy-rc-file hy-rc-file--file" />
  );

  return (
    <>
      {chip}
      {viewer.controlled ? null : (
        <MediaViewer
          items={[fileToViewerItem(f)]}
          index={0}
          open={viewer.state.open}
          onClose={viewer.close}
        />
      )}
    </>
  );
}

/**
 * <FileGroup files fromUser onOpen />
 *   files    — array of file objects (see FileChip). Non-arrays render nothing.
 *   fromUser — optional boolean; right-aligns the stack (alias: align="end").
 *   onOpen   — optional (file, index) => void. Supplied, the caller owns the
 *              click. Omitted, the group opens its own MediaViewer over the
 *              whole stack, positioned on the chip that was clicked.
 */
export function FileGroup({ files, fromUser, align, onOpen }) {
  const viewer = useSelfViewer(onOpen);
  const list = Array.isArray(files) ? files.filter((f) => f && typeof f === "object") : [];
  const stack = safe(
    () => {
      if (!list.length) return null;
      const end = fromUser || align === "end";
      return (
        <div className={cx("hy-rc", "hy-rc-files", end && "hy-rc-files--end")}>
          {list.map((f, i) => (
            <FileChip
              file={f}
              key={f.id ?? f.name ?? i}
              onOpen={viewer.controlled ? () => onOpen(f, i) : () => viewer.openAt(i)}
            />
          ))}
        </div>
      );
    },
    null
  );

  return (
    <>
      {stack}
      {viewer.controlled || !list.length ? null : (
        <MediaViewer
          items={list.map(fileToViewerItem)}
          index={viewer.state.index}
          open={viewer.state.open}
          onClose={viewer.close}
        />
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
   Link card
   -------------------------------------------------------------------------- */

function domainOf(url) {
  const s = toText(url).trim();
  if (!s) return "";
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/\s]*@)?([^/?#:\s]+)/i.exec(s);
  return m ? m[1].replace(/^www\./i, "") : "";
}

function GlobeGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className="hy-rc-link-glyph"
    >
      <circle cx="12" cy="12" r="8.4" />
      <path d="M3.6 12h16.8" />
      <path d="M12 3.6c2.2 2.4 3.3 5.3 3.3 8.4s-1.1 6-3.3 8.4c-2.2-2.4-3.3-5.3-3.3-8.4S9.8 6 12 3.6z" />
    </svg>
  );
}

/**
 * <LinkCard link onOpen />
 *   link   — { title, url, domain?, favicon? }. Missing title falls back to
 *            the domain; missing domain is derived from the url.
 *   onOpen — optional (link) => void. Supplied, the caller owns the click.
 *            Omitted, the card opens its own MediaViewer showing the link
 *            large with its full URL as selectable text. Clicking still never
 *            navigates anywhere on its own.
 */
export function LinkCard({ link, onOpen }) {
  const [broken, setBroken] = useState(false);
  const viewer = useSelfViewer(onOpen);
  const l = link && typeof link === "object" ? link : {};
  const card = safe(
    () => {
      const url = toText(l.url).trim();
      const domain = toText(l.domain).trim() || domainOf(url);
      const title = toText(l.title).trim() || domain || url || "Link";
      const favicon = safeSrc(l.favicon);

      return (
        <button
          type="button"
          className="hy-rc hy-rc-linkcard"
          title={url || title}
          onClick={() => (viewer.controlled ? onOpen(l) : viewer.openAt(0))}
          aria-label={`${title}${domain ? `, ${domain}` : ""}`}
        >
          <span className="hy-rc-linkcard-icon" aria-hidden="true">
            {favicon && !broken ? (
              <img
                className="hy-rc-linkcard-favicon"
                src={favicon}
                alt=""
                onError={() => setBroken(true)}
              />
            ) : (
              <GlobeGlyph />
            )}
          </span>
          <span className="hy-rc-linkcard-body">
            <span className="hy-rc-linkcard-title">{title}</span>
            <span className="hy-rc-linkcard-domain">{domain || url}</span>
          </span>
        </button>
      );
    },
    null
  );

  return (
    <>
      {card}
      {viewer.controlled ? null : (
        <MediaViewer
          items={[linkToViewerItem(l)]}
          index={0}
          open={viewer.state.open}
          onClose={viewer.close}
        />
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
   Image grid
   -------------------------------------------------------------------------- */

const GRID_MAX = 4;

function normImages(images) {
  const list = Array.isArray(images) ? images : [];
  const out = [];
  for (const item of list) {
    if (typeof item === "string") {
      const src = safeSrc(item);
      out.push({ src, alt: "" });
    } else if (item && typeof item === "object") {
      out.push({
        src: safeSrc(item.src || item.url || item.href),
        alt: toText(item.alt || item.caption),
      });
    }
  }
  return out;
}

/**
 * <ImageGrid images onOpen />
 *   images — array of { src, alt? } or of plain src strings. Sources that
 *            aren't http(s)/data:image/blob/file/root-relative are replaced
 *            with a neutral placeholder tile rather than handed to <img>.
 *   onOpen — optional (index) => void. Supplied, the caller owns the click.
 *            Omitted, the grid opens its own MediaViewer over ALL images.
 * Every tile is a <button>. The +N tile opens at the first HIDDEN image —
 * that is the entire point of clicking it.
 */
export function ImageGrid({ images, onOpen }) {
  const viewer = useSelfViewer(onOpen);
  const all = normImages(images);
  const grid = safe(
    () => {
      if (!all.length) return null;
      const single = all.length === 1;
      const shown = single ? all : all.slice(0, GRID_MAX);
      const overflow = all.length - shown.length;
      const fire = (i) => (viewer.controlled ? onOpen(i) : viewer.openAt(i));

      return (
        <div
          className={cx("hy-rc", "hy-rc-images", single ? "hy-rc-images--one" : `hy-rc-images--${shown.length}`)}
        >
          {shown.map((img, i) => {
            const last = i === shown.length - 1;
            const more = overflow > 0 && last;
            // the +N tile jumps to the first hidden image, not to image 1
            const target = more ? shown.length : i;
            return (
              <button
                type="button"
                className="hy-rc-image-tile"
                key={i}
                onClick={() => fire(target)}
                aria-label={
                  more
                    ? `Show ${overflow} more, starting at image ${shown.length + 1} of ${all.length}`
                    : img.alt || `Open image ${i + 1} of ${all.length}`
                }
              >
                {img.src ? (
                  <img className="hy-rc-image" src={img.src} alt={img.alt || ""} loading="lazy" draggable="false" />
                ) : (
                  <span className="hy-rc-image-missing" aria-label={img.alt || "Image unavailable"} role="img">
                    <GlobeGlyph />
                  </span>
                )}
                {more ? (
                  <span className="hy-rc-image-more" aria-hidden="true">
                    +{overflow}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      );
    },
    null
  );

  return (
    <>
      {grid}
      {viewer.controlled || !all.length ? null : (
        <MediaViewer
          items={all.map(imageToViewerItem)}
          index={viewer.state.index}
          open={viewer.state.open}
          onClose={viewer.close}
        />
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
   Task card — the "Computer" card
   -------------------------------------------------------------------------- */

const STATUS = {
  done: { label: "Done", cls: "done" },
  running: { label: "Running", cls: "running" },
  failed: { label: "Failed", cls: "failed" },
  error: { label: "Failed", cls: "failed" },
  waiting: { label: "Waiting", cls: "waiting" },
  queued: { label: "Waiting", cls: "waiting" },
  pending: { label: "Waiting", cls: "waiting" },
};

function MonitorGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="hy-rc-task-glyph"
    >
      <rect x="3.2" y="4.4" width="17.6" height="12" rx="2.2" />
      <path d="M9 19.6h6M12 16.4v3.2" />
    </svg>
  );
}

/**
 * <TaskCard title status statusLabel description actionLabel onAction />
 *   title       — defaults to "Computer".
 *   status      — "done" | "running" | "failed" | "waiting" (case-insensitive;
 *                 "error"/"queued"/"pending" are accepted aliases). Anything
 *                 unknown renders neutrally with the raw value as the label.
 *   statusLabel — optional override for the pill text.
 *   description — optional one-liner, e.g. "Sign in to Google Drive".
 *   actionLabel — defaults to "Open computer".
 *   onAction    — optional () => void. Without it the button is omitted.
 */
export function TaskCard({ title, status, statusLabel, description, actionLabel, onAction }) {
  return safe(
    () => {
      const heading = toText(title).trim() || "Computer";
      const key = toText(status).trim().toLowerCase();
      const known = STATUS[key];
      // Unknown non-string statuses get no pill at all — better a quiet card
      // than "[object Object]" leaking into the chat.
      const rawStatus = typeof status === "string" ? status.trim() : "";
      const pillLabel = toText(statusLabel).trim() || (known ? known.label : rawStatus);
      const pillCls = known ? known.cls : "waiting";
      const desc = toText(description).trim();
      const action = toText(actionLabel).trim() || "Open computer";
      const canAct = typeof onAction === "function";

      return (
        <section className="hy-rc hy-rc-task" aria-label={`${heading}${pillLabel ? `, ${pillLabel}` : ""}`}>
          <header className="hy-rc-task-head">
            <h4 className="hy-rc-task-title">{heading}</h4>
            {pillLabel ? (
              <span className={cx("hy-rc-task-pill", `hy-rc-task-pill--${pillCls}`)}>
                <span className="hy-rc-task-dot" aria-hidden="true" />
                {pillLabel}
              </span>
            ) : null}
          </header>
          {desc ? <p className="hy-rc-task-desc">{desc}</p> : null}
          {canAct ? (
            <button type="button" className="hy-rc-task-action" onClick={() => onAction()}>
              <MonitorGlyph />
              <span>{action}</span>
            </button>
          ) : null}
        </section>
      );
    },
    null
  );
}

/* --------------------------------------------------------------------------
   MediaViewer — where a click actually goes.

   A full-bleed overlay that browses a mixed list: one message's images AND
   its attachments AND its links, in the same strip. Portalled to <body> so it
   can never be clipped by a bubble's overflow.

   Deliberately conservative about content: an .html attachment is shown as
   SOURCE TEXT, never mounted as markup — rendering a message's HTML inside
   our own renderer would execute whatever a bot handed us.
   -------------------------------------------------------------------------- */

const VIEWER_KINDS = { image: 1, file: 1, link: 1 };

// Accepts both viewer-shaped items and the plain file/image/link objects the
// other components already carry, so callers never have to translate.
function normViewerItem(raw) {
  if (typeof raw === "string") {
    const src = safeSrc(raw);
    return { kind: "image", src, alt: "", name: "" };
  }
  if (!raw || typeof raw !== "object") return null;

  const declared = toText(raw.kind).trim().toLowerCase();
  let kind = VIEWER_KINDS[declared] ? declared : "";
  let fileKind = toText(raw.fileKind).trim().toLowerCase();
  if (!kind && declared) {
    // a file-type kind ("markdown", "pdf", …) rather than a viewer kind
    kind = "file";
    fileKind = fileKind || declared;
  }
  if (!kind) {
    if (safeSrc(raw.src || raw.url || raw.href) && !toText(raw.name).trim()) kind = "image";
    else if (toText(raw.name).trim()) kind = "file";
    else if (toText(raw.url).trim()) kind = "link";
    else kind = "file";
  }

  return {
    kind,
    fileKind,
    src: safeSrc(raw.src || raw.href),
    alt: toText(raw.alt || raw.caption),
    name: toText(raw.name),
    ext: toText(raw.ext),
    size: raw.size,
    url: toText(raw.url || raw.href),
    title: toText(raw.title),
    text: typeof raw.text === "string" ? raw.text.slice(0, MAX_PREVIEW_TEXT) : "",
    entries: Array.isArray(raw.entries) ? raw.entries : null,
    path: toText(raw.path),
  };
}

function normViewerItems(items) {
  const list = Array.isArray(items) ? items : [];
  const out = [];
  for (const raw of list) {
    const item = normViewerItem(raw);
    if (item) out.push(item);
  }
  return out;
}

function itemLabel(item) {
  if (!item) return "";
  if (item.kind === "link") {
    return item.title.trim() || domainOf(item.url) || item.url.trim() || "Link";
  }
  return item.name.trim() || item.alt.trim() || (item.kind === "image" ? "Image" : "File");
}

// Resolve a window.hydo hook without ever assuming it exists. Returns null
// when the backend hasn't wired it up yet, which is what disables the button.
function hydoHook(name) {
  try {
    if (typeof window === "undefined" || !window.hydo) return null;
    const fn = window.hydo[name];
    return typeof fn === "function" ? fn : null;
  } catch {
    return null;
  }
}

function ChevronGlyph({ dir }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="hy-rc-mv-chevron"
    >
      {dir === "prev" ? <path d="M14.5 5.5 8 12l6.5 6.5" /> : <path d="M9.5 5.5 16 12l-6.5 6.5" />}
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      className="hy-rc-mv-closeglyph"
    >
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
    </svg>
  );
}

function ViewerFileCard({ item, note }) {
  const ext = extOf(item);
  const kind = normKind(item.fileKind, ext);
  const split = splitName(item.name);
  const size = humanSize(item.size);
  const meta = [KIND_LABEL[kind] || KIND_LABEL.file, size].filter(Boolean).join(" · ");
  return (
    <div className="hy-rc-mv-card">
      <span className={cx("hy-rc-file-tile", "hy-rc-mv-card-tile", `hy-rc-file-tile--${kind}`)} aria-hidden="true">
        <FileGlyph kind={kind} />
      </span>
      <span className="hy-rc-mv-card-name">
        {split.base || itemLabel(item)}
        {split.ext ? <span className="hy-rc-mv-card-ext">{split.ext}</span> : null}
      </span>
      <span className="hy-rc-mv-card-meta">{meta}</span>
      {note ? <span className="hy-rc-mv-card-note">{note}</span> : null}
    </div>
  );
}

function ZipListing({ item }) {
  const [entries, setEntries] = useState(item.entries);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (entries || !item.path || typeof window === "undefined" || !window.hydo?.previewZip) return undefined;
    let gone = false;
    window.hydo
      .previewZip(item.path)
      .then((res) => {
        if (gone) return;
        if (res && res.ok) setEntries(res.entries || []);
        else setErr((res && res.reason) || "Could not list archive");
      })
      .catch(() => {
        if (!gone) setErr("Could not list archive");
      });
    return () => {
      gone = true;
    };
  }, [item.path, entries]);
  const rows = Array.isArray(entries) ? entries : null;
  return (
    <div className="hy-rc-mv-zip">
      <ViewerFileCard item={item} note={isPropertyZip(item) ? "property.zip — listing only, not extracted" : "Archive listing"} />
      {err ? <p className="hy-rc-mv-zip-err">{err}</p> : null}
      {rows ? (
        <ul className="hy-rc-mv-zip-list">
          {rows.map((e) => (
            <li key={e.name}>
              <span>{e.name}</span>
              {e.size != null ? <span className="hy-rc-mv-zip-size">{humanSize(e.size)}</span> : null}
            </li>
          ))}
        </ul>
      ) : !err ? (
        <p className="hy-rc-mv-zip-hint">No listing yet.</p>
      ) : null}
    </div>
  );
}

function HtmlStage({ item }) {
  const [render, setRender] = useState(false);
  const src =
    item.src ||
    (item.path && (item.path.startsWith("file:") || item.path.startsWith("/"))
      ? item.path.startsWith("file:")
        ? item.path
        : `file://${item.path}`
      : "") ||
    (item.text ? `data:text/html;charset=utf-8,${encodeURIComponent(item.text)}` : "");
  return (
    <div className="hy-rc-mv-html">
      <div className="hy-rc-mv-html-bar">
        <button type="button" className={!render ? "is-on" : ""} onClick={() => setRender(false)}>
          Source
        </button>
        <button type="button" className={render ? "is-on" : ""} onClick={() => setRender(true)} disabled={!src}>
          Render
        </button>
      </div>
      {render && src ? (
        <iframe className="hy-rc-mv-frame" title={itemLabel(item)} src={src} sandbox="" />
      ) : item.text ? (
        <pre className="hy-rc-mv-text" tabIndex={0} aria-label={`${itemLabel(item)} source`}>
          {item.text}
        </pre>
      ) : (
        <ViewerFileCard item={item} note="No HTML source" />
      )}
    </div>
  );
}

function ViewerStage({ item }) {
  if (!item) return null;

  if (item.kind === "image") {
    if (!item.src) return <ViewerFileCard item={item} note="No preview available" />;
    return <img className="hy-rc-mv-image" src={item.src} alt={item.alt || itemLabel(item)} draggable="false" />;
  }

  if (item.kind === "link") {
    const domain = domainOf(item.url);
    return (
      <div className="hy-rc-mv-linkbig">
        <span className="hy-rc-mv-linkbig-icon" aria-hidden="true">
          <GlobeGlyph />
        </span>
        <span className="hy-rc-mv-linkbig-title">{itemLabel(item)}</span>
        {domain ? <span className="hy-rc-mv-linkbig-domain">{domain}</span> : null}
        {item.url ? <span className="hy-rc-mv-url">{item.url}</span> : null}
      </div>
    );
  }

  const kind = normKind(item.fileKind, extOf(item));
  if (kind === "pdf") {
    return <PdfStage item={item} />;
  }
  if (kind === "html") {
    return <HtmlStage item={item} />;
  }
  if (kind === "archive") {
    return <ZipListing item={item} />;
  }
  // .nd and other textish: source only, never executed.
  if (isTextish(item)) {
    return <TextStage item={item} />;
  }
  return <ViewerFileCard item={item} note="No preview available" />;
}

function PdfStage({ item }) {
  const [src, setSrc] = useState(item.src && String(item.src).startsWith("data:") ? item.src : "");
  const [err, setErr] = useState("");
  useEffect(() => {
    if (src || !item.path || typeof window === "undefined" || !window.hydo?.previewFile) return undefined;
    let gone = false;
    window.hydo
      .previewFile(item.path)
      .then((res) => {
        if (gone) return;
        if (res && res.ok && res.src) setSrc(res.src);
        else setErr((res && res.reason) || "Could not load PDF");
      })
      .catch(() => {
        if (!gone) setErr("Could not load PDF");
      });
    return () => {
      gone = true;
    };
  }, [item.path, src]);
  if (err) return <ViewerFileCard item={item} note={err} />;
  if (!src) return <ViewerFileCard item={item} note="Loading preview…" />;
  return <iframe className="hy-rc-mv-frame" title={itemLabel(item)} src={src} sandbox="" />;
}

function TextStage({ item }) {
  const [text, setText] = useState(item.text || "");
  useEffect(() => {
    if (text || !item.path || typeof window === "undefined" || !window.hydo?.previewFile) return undefined;
    let gone = false;
    window.hydo
      .previewFile(item.path)
      .then((res) => {
        if (gone) return;
        if (res && res.ok && res.text) setText(res.text.slice(0, MAX_PREVIEW_TEXT));
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [item.path, text]);
  if (!text) return <ViewerFileCard item={item} note="No preview available" />;
  return (
    <pre className="hy-rc-mv-text" tabIndex={0} aria-label={`${itemLabel(item)} contents`}>
      {text}
    </pre>
  );
}

function ViewerThumb({ item, on, onPick, position, total }) {
  const label = itemLabel(item);
  if (item.kind === "image" && item.src) {
    return (
      <button
        type="button"
        className={cx("hy-rc-mv-thumb", on && "hy-rc-mv-thumb--on")}
        onClick={onPick}
        aria-current={on ? "true" : undefined}
        aria-label={`${label}, ${position} of ${total}`}
        title={label}
      >
        <img className="hy-rc-mv-thumb-img" src={item.src} alt="" draggable="false" />
      </button>
    );
  }
  const kind = item.kind === "link" ? "link" : normKind(item.fileKind, extOf(item));
  return (
    <button
      type="button"
      className={cx("hy-rc-mv-thumb", "hy-rc-mv-thumb--glyph", on && "hy-rc-mv-thumb--on")}
      onClick={onPick}
      aria-current={on ? "true" : undefined}
      aria-label={`${label}, ${position} of ${total}`}
      title={label}
    >
      <span
        className={cx("hy-rc-file-tile", "hy-rc-mv-thumb-tile", item.kind !== "link" && `hy-rc-file-tile--${kind}`)}
        aria-hidden="true"
      >
        {item.kind === "link" ? <GlobeGlyph /> : <FileGlyph kind={kind} />}
      </span>
    </button>
  );
}

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// The dialog fills the overlay, so "click the backdrop to close" really means
// "click any dead space": the scrim itself, or the empty room around the
// media inside the stage. Never the media, the cards, or the controls.
const DISMISS_SURFACES = ["hy-rc-mv", "hy-rc-mv-stage", "hy-rc-mv-content"];

function isDismissSurface(el) {
  try {
    return !!el && !!el.classList && DISMISS_SURFACES.some((c) => el.classList.contains(c));
  } catch {
    return false;
  }
}

/**
 * <MediaViewer items index open onClose onIndexChange />
 * See the export notes at the bottom of this file for the full contract.
 */
export function MediaViewer({ items, index, open, onClose, onIndexChange }) {
  const list = normViewerItems(items);
  const count = list.length;
  const dialogRef = useRef(null);
  const downOnBackdrop = useRef(false);
  const [cur, setCur] = useState(0);

  // Semi-controlled: `index` seeds the position on open (and whenever the
  // caller changes it), `onIndexChange` reports every move back out.
  useEffect(() => {
    if (!open || !count) return;
    const want = typeof index === "number" && Number.isFinite(index) ? Math.floor(index) : 0;
    setCur(Math.min(Math.max(want, 0), count - 1));
  }, [open, index, count]);

  const close = useCallback(() => {
    if (typeof onClose === "function") {
      try {
        onClose();
      } catch {
        /* a caller's onClose must never take the viewer down with it */
      }
    }
  }, [onClose]);

  // Arrows wrap: from the last item, next lands on the first.
  const go = useCallback(
    (next) => {
      if (count < 1) return;
      const n = ((next % count) + count) % count;
      setCur(n);
      if (typeof onIndexChange === "function") {
        try {
          onIndexChange(n);
        } catch {
          /* ignore */
        }
      }
    },
    [count, onIndexChange]
  );

  // Focus in on open, focus back to wherever it was on close.
  useEffect(() => {
    if (!open) return undefined;
    let restore = null;
    try {
      restore = document.activeElement;
    } catch {
      restore = null;
    }
    const node = dialogRef.current;
    if (node && typeof node.focus === "function") node.focus();
    return () => {
      try {
        if (restore && typeof restore.focus === "function" && document.contains(restore)) {
          restore.focus();
        }
      } catch {
        /* the trigger may have unmounted; nothing to restore to */
      }
    };
  }, [open]);

  // Keys. Every listener is removed on close/unmount.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "Tab") {
        const node = dialogRef.current;
        if (!node) return;
        let stops = [];
        try {
          stops = Array.from(node.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        } catch {
          stops = [];
        }
        if (!stops.length) {
          e.preventDefault();
          node.focus();
          return;
        }
        const first = stops[0];
        const last = stops[stops.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === node)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // don't hijack arrows away from a real text field
      const t = e.target;
      const tag = t && t.tagName ? String(t.tagName).toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
      e.preventDefault();
      go(cur + (e.key === "ArrowLeft" ? -1 : 1));
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, cur, close, go]);

  // Don't let the page behind scroll while the viewer owns the screen.
  useEffect(() => {
    if (!open) return undefined;
    let prev = "";
    try {
      prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    } catch {
      return undefined;
    }
    return () => {
      try {
        document.body.style.overflow = prev;
      } catch {
        /* ignore */
      }
    };
  }, [open]);

  if (!open || !count) return null;
  if (typeof document === "undefined" || !document.body) return null;

  return safe(() => {
    const at = Math.min(Math.max(cur, 0), count - 1);
    const item = list[at];
    const label = itemLabel(item);
    const size = humanSize(item.size);
    const many = count > 1;

    const openFn = hydoHook("openAttachment");
    const revealFn = hydoHook("revealAttachment");
    const run = (name) => {
      try {
        window.hydo?.[name]?.(item);
      } catch {
        /* a missing or throwing bridge must never break the viewer */
      }
    };

    const body = (
      <div
        className="hy-rc hy-rc-mv"
        onMouseDown={(e) => {
          downOnBackdrop.current = isDismissSurface(e.target);
        }}
        onClick={(e) => {
          // Empty space only. A click that STARTED on the content — a text
          // selection dragged outward, say — must not close the viewer, so
          // both the press and the release have to land on dead space.
          if (isDismissSurface(e.target) && downOnBackdrop.current) close();
          downOnBackdrop.current = false;
        }}
      >
        <div
          className="hy-rc-mv-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={`${label}, ${at + 1} of ${count}`}
          tabIndex={-1}
          ref={dialogRef}
        >
          <div className="hy-rc-mv-bar">
            <span className="hy-rc-mv-count">
              {at + 1} / {count}
            </span>
            <span className="hy-rc-mv-name" title={label}>
              {label}
            </span>
            {size ? <span className="hy-rc-mv-size">{size}</span> : null}
            <button type="button" className="hy-rc-mv-close" onClick={close} aria-label="Close viewer">
              <CloseGlyph />
            </button>
          </div>

          <div className="hy-rc-mv-stage">
            {many ? (
              <button
                type="button"
                className="hy-rc-mv-nav hy-rc-mv-nav--prev"
                onClick={() => go(at - 1)}
                aria-label="Previous item"
              >
                <ChevronGlyph dir="prev" />
              </button>
            ) : null}
            <div className="hy-rc-mv-content">
              <ViewerStage item={item} />
            </div>
            {many ? (
              <button
                type="button"
                className="hy-rc-mv-nav hy-rc-mv-nav--next"
                onClick={() => go(at + 1)}
                aria-label="Next item"
              >
                <ChevronGlyph dir="next" />
              </button>
            ) : null}
          </div>

          <div className="hy-rc-mv-actions">
            <button
              type="button"
              className="hy-rc-mv-action"
              onClick={() => run("openAttachment")}
              disabled={!openFn}
              title={openFn ? `Open ${label}` : "Opening attachments isn't wired up in this build yet"}
            >
              Open
            </button>
            <button
              type="button"
              className="hy-rc-mv-action"
              onClick={() => run("revealAttachment")}
              disabled={!revealFn}
              title={revealFn ? `Reveal ${label} in Finder` : "Revealing in Finder isn't wired up in this build yet"}
            >
              Reveal in Finder
            </button>
          </div>

          {many ? (
            <div className="hy-rc-mv-strip" role="tablist" aria-label="All items in this message">
              {list.map((it, i) => (
                <ViewerThumb
                  item={it}
                  key={i}
                  on={i === at}
                  position={i + 1}
                  total={count}
                  onPick={() => go(i)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );

    return createPortal(body, document.body);
  }, null);
}

// Shared by ImageGrid / FileGroup / FileChip / LinkCard: each is self-
// sufficient (opens its own viewer) unless the caller supplies onOpen, in
// which case the caller wins and no viewer is mounted.
function useSelfViewer(onOpen) {
  const [state, setState] = useState({ open: false, index: 0 });
  const controlled = typeof onOpen === "function";
  const openAt = useCallback(
    (i) => {
      const n = typeof i === "number" && Number.isFinite(i) ? Math.max(0, Math.floor(i)) : 0;
      setState({ open: true, index: n });
    },
    []
  );
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);
  return { controlled, state, openAt, close };
}

// Mappers: the shapes the chips/grids already speak, translated into viewer
// items so callers never have to build a second array by hand.
function fileToViewerItem(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const ext = toText(o.ext) || splitName(toText(o.name)).ext;
  const kind = normKind(o.kind, ext);
  const src = safeSrc(o.src || o.href);
  return {
    kind: kind === "image" && src ? "image" : "file",
    fileKind: kind,
    name: toText(o.name),
    ext: toText(o.ext),
    size: o.size,
    src,
    alt: toText(o.alt),
    url: toText(o.url),
    text: typeof o.text === "string" ? o.text : "",
    path: toText(o.path),
    entries: Array.isArray(o.entries) ? o.entries : null,
  };
}

function imageToViewerItem(img) {
  const o = img && typeof img === "object" ? img : {};
  return { kind: "image", src: safeSrc(o.src), alt: toText(o.alt), name: toText(o.name) };
}

function linkToViewerItem(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  return { kind: "link", title: toText(o.title), url: toText(o.url) };
}

/* --------------------------------------------------------------------------
   Exports
   -------------------------------------------------------------------------- */

export { parseInline, parseBlocks, humanSize, splitName, normKind, toText };

export default {
  Markdown,
  FileChip,
  FileGroup,
  LinkCard,
  ImageGrid,
  TaskCard,
  MediaViewer,
};
