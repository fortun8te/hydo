"use strict";

/**
 * Drives real drag events and real image messages in a real BrowserWindow,
 * and writes measurements for scripts/drop-media-test.cjs to assert on.
 *
 * Same safety choice as the other shot harnesses: `?mock=1` and NO preload,
 * so `window.hydo` is the devmock and the user's real roster is never opened.
 *
 *   npx electron scripts/drop-media-shot.cjs <built-outdir> <out.json>
 */

const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const OUTDIR = process.argv[2];
const OUT = process.argv[3];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SIGN_IN = `(async () => {
  const btn = [...document.querySelectorAll("button")].find((b) => /sign in/i.test(b.textContent || ""));
  if (btn) btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1000));
  return !!document.querySelector(".sand-sidebar, .sand-home");
})()`;

/** A real DragEvent carrying a real File, dispatched at a real element. */
const dragScript = (selector, type, mime) => `(async () => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { ok: false, why: "no element " + ${JSON.stringify(selector)} };
  const dt = new DataTransfer();
  const file = new File([new Uint8Array([1, 2, 3])], "thing." + ${JSON.stringify(mime)}.split("/")[1], { type: ${JSON.stringify(mime)} });
  dt.items.add(file);
  el.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { bubbles: true, cancelable: true, dataTransfer: dt }));
  await new Promise((r) => setTimeout(r, 260));
  const overlay = document.querySelector(".sand-drop");
  const note = document.querySelector(".sand-drop__note");
  return {
    ok: true,
    overlay: !!overlay,
    overlayText: overlay ? (overlay.textContent || "").trim() : "",
    note: note ? (note.textContent || "").trim() : "",
  };
})()`;

app.whenReady().then(async () => {
  let code = 0;
  const out = {};
  try {
    const win = new BrowserWindow({ width: 1100, height: 820, show: false });
    const js = (src) => win.webContents.executeJavaScript(src);
    await win.loadFile(path.join(OUTDIR, "index.html"), { query: { mock: "1" } });
    await sleep(1200);
    if (!(await js(SIGN_IN))) throw new Error("sign-in did not reach the shell");
    await sleep(600);

    // Open a bot thread so the composer and transcript both exist.
    await js(`(async () => {
      const row = document.querySelector(".sand-sidebar button, .sand-row");
      if (row) row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 700));
      return true;
    })()`);
    await sleep(400);

    // 1. Drag over the TRANSCRIPT, which is most of the window and the
    //    obvious place to aim. This is what used to do nothing.
    out.dragOverTranscript = await js(dragScript(".sand-transcript", "dragenter", "image/png"));
    // 2. Leaving must clear it.
    out.afterLeave = await js(`(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
      window.dispatchEvent(new DragEvent("dragleave", { bubbles: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 260));
      return { overlay: !!document.querySelector(".sand-drop") };
    })()`);
    // 3. A non-image must SAY it was refused rather than vanish silently.
    out.dropPdf = await js(`(async () => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([1])], "paper.pdf", { type: "application/pdf" }));
      window.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 400));
      const note = document.querySelector(".sand-drop__note");
      return { note: note ? (note.textContent || "").trim() : "", overlay: !!document.querySelector(".sand-drop") };
    })()`);

    // 4. An image sent WITH text: the picture must be its own block above the
    //    bubble, not boxed inside it.
    out.media = await js(`(async () => {
      const line = document.querySelector(".hy-msg__line--media");
      const img = line ? line.querySelector("img") : document.querySelector(".hy-shot, .hy-extras img");
      if (!img) return { found: false };
      const cs = getComputedStyle(img);
      const bubble = img.closest(".sand-bubble");
      const r = img.getBoundingClientRect();
      return {
        found: true,
        insideBubble: !!bubble,
        ownLine: !!img.closest(".hy-msg__line--media"),
        objectFit: cs.objectFit,
        radius: cs.borderTopLeftRadius,
        width: Math.round(r.width),
        height: Math.round(r.height),
        naturalWidth: img.naturalWidth,
        complete: img.complete,
        srcHead: String(img.getAttribute("src") || "").slice(0, 60),
        display: cs.display,
        parentWidth: Math.round((line || img.parentElement).getBoundingClientRect().width),
        // Walk up from the image and report where the width dies. Built with
        // concatenation, not a nested template literal: this string is already
        // inside one, and the inner backticks silently broke the whole file.
        chain: (() => {
          const out = [];
          let n = img;
          for (let i = 0; i < 6 && n; i += 1) {
            const b = n.getBoundingClientRect();
            const c = getComputedStyle(n);
            const cls = String(n.className || "").split(" ").filter(Boolean).join(".");
            out.push(n.tagName.toLowerCase() + "." + cls + " w=" + Math.round(b.width) + " disp=" + c.display + " maxW=" + c.maxWidth);
            n = n.parentElement;
          }
          return out;
        })(),
      };
    })()`);

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    code = 1;
    console.error(`drop-media-shot failed — ${err && err.message}`);
  }
  app.quit();
  process.exit(code);
});
