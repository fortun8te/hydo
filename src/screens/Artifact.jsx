import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The artifact pane: the thing a teammate made, shown properly.
 *
 * THE SANDBOX IS THE WHOLE DESIGN. READ THIS BEFORE CHANGING THE IFRAME.
 *
 * The HTML below was written by a language model. This renderer holds
 * `window.hydo` — the full preload bridge: filesystem reads, shell, rollback,
 * every IPC channel Hydo has. Rendering model-authored HTML anywhere that can
 * reach that object is a complete escape, not a theoretical one.
 *
 * So the frame is `srcdoc` (never a src= path, which would give it a real
 * origin) with `sandbox="allow-scripts"` and DELIBERATELY NO
 * `allow-same-origin`. Those two together are what produce an OPAQUE origin:
 * scripts run, so charts and interaction work, but the document cannot reach
 * `window.parent`, cannot read cookies or storage, cannot fetch same-origin,
 * and cannot touch the disk.
 *
 * Adding `allow-same-origin` NEXT TO `allow-scripts` un-sandboxes it
 * completely — the frame could then reach straight into this renderer and call
 * `window.hydo` itself. Never add it. If a chart needs something it cannot get
 * inside the sandbox, the answer is to bake the data into the file, not to
 * widen the sandbox.
 */

const SANDBOX = "allow-scripts";

/** A `text/html` document ready for srcdoc, with a dark default so charts don't flash white. */
function pageFor(art) {
  const body = String(art.text || "");
  if (art.kind === "html") return isDocument(body) ? body : shell(body);
  if (art.kind === "svg") return shell(body);
  if (art.kind === "json") {
    let pretty = body;
    try {
      pretty = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* show it raw */
    }
    return shell(`<pre>${escapeHtml(pretty)}</pre>`);
  }
  if (art.kind === "csv") return shell(tableFor(body));
  if (art.kind === "markdown") return shell(`<pre>${escapeHtml(body)}</pre>`);
  return shell(`<pre>${escapeHtml(body)}</pre>`);
}

/**
 * Is this already a whole page?
 *
 * Testing for `<html>` alone is not enough: `<!doctype html><meta …><style>…`
 * is a complete, valid document that never writes the tag, and wrapping one of
 * those in `shell()` nests a doctype inside <body>, which browsers refuse to
 * render — a blank pane for a file that was perfectly fine.
 */
function isDocument(body) {
  const head = String(body || "").slice(0, 400).toLowerCase();
  return /<!doctype/.test(head) || /<html[\s>]/.test(head) || /<head[\s>]/.test(head);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/** CSV to a table. Handles quoted fields, which a naive split does not. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const src = String(text || "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "," || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim()));
}

function tableFor(text) {
  const rows = parseCsv(text).slice(0, 500);
  if (!rows.length) return "<p>Empty.</p>";
  const [head, ...body] = rows;
  return [
    "<table><thead><tr>",
    head.map((h) => `<th>${escapeHtml(h)}</th>`).join(""),
    "</tr></thead><tbody>",
    body.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join(""),
    "</tbody></table>",
  ].join("");
}

function shell(inner) {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  html,body { margin:0; background:#0d0d0d; color:#fcfcfc;
    font:14px/1.55 ui-sans-serif,-apple-system,system-ui,sans-serif; }
  body { padding:18px; }
  pre { margin:0; white-space:pre-wrap; word-break:break-word;
    font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; color:#dcdcdc; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  th,td { text-align:left; padding:6px 10px; border-bottom:1px solid #ffffff14; }
  th { position:sticky; top:0; background:#161616; font-weight:600; }
  tr:hover td { background:#ffffff08; }
  svg { max-width:100%; height:auto; }
  a { color:#5aa8ff; }
</style></head><body>${inner}</body></html>`;
}

/**
 * The popover the preview lives in.
 *
 * It used to be an aside docked to the right edge, sharing the slot with the
 * bot rail — so opening a file squeezed the conversation you opened it from,
 * and a chart got `min(46vw, 620px)` to be a chart in. Worse, it was the only
 * surface in the app that showed you something WITHOUT taking the foreground:
 * everything else that demands a look (Settings, the sheets, the confirm) is a
 * centred card over a darkened room, and the one thing you open in order to
 * actually LOOK at something was the one thing shoved into a column.
 *
 * So it is a modal now, built on the same three parts as `Sheet`: a scrim that
 * closes on click, a centred card, and Escape. The scrim is what makes it a
 * preview rather than a panel — the room goes dark and the file is the only
 * thing lit.
 *
 * Escape is handled here rather than by reusing `Sheet` because the body is an
 * iframe: `Sheet`'s focus trap would fight a sandboxed document for focus on
 * every Tab, and there is nothing in here to tab through anyway.
 */
function ArtifactFrame({ label, onClose, children }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose?.();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="artifact-modal" role="dialog" aria-modal="true" aria-label={label || "File preview"}>
      <div className="artifact-modal__scrim" onClick={onClose} />
      <div className="artifact">{children}</div>
    </div>
  );
}

export default function Artifact({ artifactId, onClose }) {
  const [art, setArt] = useState({ state: "loading" });
  const frameRef = useRef(null);

  useEffect(() => {
    let gone = false;
    if (!artifactId) return undefined;
    setArt({ state: "loading" });
    Promise.resolve(window.hydo?.readArtifact?.(artifactId))
      .then((res) => {
        if (gone) return;
        if (!res || !res.ok) setArt({ state: "error", ...(res || {}) });
        else setArt({ state: "ready", ...res });
      })
      .catch((err) => !gone && setArt({ state: "error", reason: err.message }));
    return () => {
      gone = true;
    };
  }, [artifactId]);

  const doc = useMemo(() => (art.state === "ready" && art.text != null ? pageFor(art) : ""), [art]);

  if (art.state === "loading") {
    return (
      <ArtifactFrame label="Artifact" onClose={onClose}>
        <ArtifactHead title="Opening…" onClose={onClose} />
        <p className="artifact__note mute">Reading…</p>
      </ArtifactFrame>
    );
  }

  if (art.state === "error") {
    return (
      <ArtifactFrame label="Artifact" onClose={onClose}>
        <ArtifactHead title={art.name || "Artifact"} onClose={onClose} />
        <p className="artifact__note mute">{reasonText(art)}</p>
      </ArtifactFrame>
    );
  }

  // Pictures, video, audio and PDFs are the file itself, not a document to
  // frame. No sandbox needed: none of them execute anything.
  if (art.kind === "image" || art.kind === "vector") {
    return (
      <ArtifactFrame label={art.title || "Artifact"} onClose={onClose}>
        <ArtifactHead title={art.title || art.name} versions={art.versions} onClose={onClose} />
        <div className="artifact__media">
          <img src={art.src} alt={art.name || ""} draggable="false" />
        </div>
        <ArtifactFoot art={art} />
      </ArtifactFrame>
    );
  }

  if (art.kind === "video" || art.kind === "audio") {
    const Tag = art.kind === "video" ? "video" : "audio";
    return (
      <ArtifactFrame label={art.title || "Artifact"} onClose={onClose}>
        <ArtifactHead title={art.title || art.name} versions={art.versions} onClose={onClose} />
        <div className="artifact__media">
          <Tag src={art.src} controls preload="metadata" />
        </div>
        <ArtifactFoot art={art} />
      </ArtifactFrame>
    );
  }

  if (art.kind === "pdf") {
    return (
      <ArtifactFrame label={art.title || "Artifact"} onClose={onClose}>
        <ArtifactHead title={art.title || art.name} versions={art.versions} onClose={onClose} />
        {/* Chromium's own PDF viewer. Sandboxed like everything else here. */}
        <iframe className="artifact__frame" title={art.name || "PDF"} sandbox={SANDBOX} src={art.src} />
        <ArtifactFoot art={art} />
      </ArtifactFrame>
    );
  }

  // A remote page is NOT framed. An https artifact is a link the bot wants you
  // to look at, and quietly embedding someone else's site inside the app is
  // both a worse experience and a bigger surface than opening the browser.
  if (art.kind === "url" || art.kind === "server") {
    return (
      <ArtifactFrame label="Artifact" onClose={onClose}>
        <ArtifactHead title={art.title || art.url} onClose={onClose} />
        <div className="artifact__link">
          <p className="mute">{art.kind === "server" ? "A local dev server." : "A web page."}</p>
          <code>{art.url}</code>
          <button
            type="button"
            className="ghost ghost--solid"
            onClick={() => window.hydo?.openExternal?.(art.url)}
          >
            Open in browser
          </button>
        </div>
      </ArtifactFrame>
    );
  }

  return (
    <ArtifactFrame label={art.title || "Artifact"} onClose={onClose}>
      <ArtifactHead
        title={art.title || art.name}
        versions={art.versions}
        onClose={onClose}
        onReload={() =>
          Promise.resolve(window.hydo?.readArtifact?.(artifactId)).then(
            (r) => r && r.ok && setArt({ state: "ready", ...r })
          )
        }
      />
      {/* sandbox="allow-scripts" with NO allow-same-origin — opaque origin.
          See the file header before touching this line. */}
      <iframe
        ref={frameRef}
        className="artifact__frame"
        title={art.title || art.name || "Artifact"}
        sandbox={SANDBOX}
        srcDoc={doc}
        referrerPolicy="no-referrer"
      />
      <ArtifactFoot art={art} />
    </ArtifactFrame>
  );
}

function ArtifactFoot({ art }) {
  const bits = [art.name, art.lang || null, art.converted ? `via ${art.converted}` : null]
    .filter(Boolean)
    .join("  ·  ");
  return (
    <footer className="artifact__foot">
      <span className="mute">{bits}</span>
    </footer>
  );
}

function reasonText(a) {
  switch (a.reason) {
    case "outside-workspace":
      return "That file is outside the bot's workspace, so it was not opened.";
    case "missing":
      return "That file is gone.";
    case "too-big":
      return "Too big to show here.";
    case "unsupported":
      if (a.fileKind === "model3d") return `3D files (.${a.ext}) can't be shown here yet.`;
      if (a.fileKind === "archive") return `Archives (.${a.ext}) open as a file list, not here.`;
      if (a.fileKind === "font") return `Fonts (.${a.ext}) can't be previewed yet.`;
      return `Nothing to render for .${a.ext || "that"} files.`;
    case "no-converter":
      return `Could not convert .${a.ext}. textutil handles Word files; spreadsheets need uv.`;
    default:
      return "Could not open this.";
  }
}

function ArtifactHead({ title, versions, onClose, onReload }) {
  return (
    <header className="artifact__head">
      <span className="artifact__title">{title}</span>
      {versions > 1 ? <span className="artifact__ver">v{versions}</span> : null}
      {onReload ? (
        <button type="button" className="icon-btn" title="Reload" onClick={onReload}>
          <i className="gb-icon gb-icon-arrow-u-up-left" />
        </button>
      ) : null}
      {/* Not `chevrons-right`: that glyph means "push this rail back to the
          edge", and there is no edge any more. */}
      <button type="button" className="icon-btn" title="Close" onClick={onClose}>
        <i className="gb-icon gb-icon-remove-close" />
      </button>
    </header>
  );
}

export { pageFor, parseCsv, escapeHtml, isDocument, SANDBOX };
