"use strict";

/**
 * Photograph every mark, for the README.
 *
 * Same rules as scripts/shot.cjs: the Vite dev server, no preload, never
 * main.cjs, so the user's real state.json is never opened. The faces are the
 * one part of this app that a static mockup cannot honestly represent — they
 * are drawn live and they move — so the picture has to come from the real
 * component rather than from a design file.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow } = require("electron");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.HYDO_SHOT_PORT || 5211);
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "docs/screenshots/faces.png"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<style>html,body{margin:0;background:#0a0a0a}</style></head>
<body><div id="root"></div>
<script type="module">
  import React from "react";
  import { createRoot } from "react-dom/client";
  import Showcase from "/src/faces-showcase.jsx";
  createRoot(document.getElementById("root")).render(React.createElement(Showcase));
</script></body></html>`;

(async () => {
  const page = path.join(ROOT, "faces-shot.html");
  fs.writeFileSync(page, HTML);
  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env },
  });
  const done = (code) => {
    try { fs.rmSync(page, { force: true }); } catch {}
    try { vite.kill("SIGTERM"); } catch {}
    process.exit(code);
  };
  try {
    await app.whenReady();
    // Give vite a moment to bind, then poll rather than guess.
    for (let i = 0; i < 40; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/faces-shot.html`);
        if (res.ok) break;
      } catch { /* not up yet */ }
      await sleep(500);
    }
    const win = new BrowserWindow({ width: 1180, height: 720, show: false, backgroundColor: "#0a0a0a" });
    await win.loadURL(`http://127.0.0.1:${PORT}/faces-shot.html`);
    // Long enough for the faces to have blinked and settled into motion.
    await sleep(3200);
    // REFUSE to photograph a broken page.
    //
    // The first run of this script printed "ok" and wrote a 266kB PNG of
    // Vite's red error overlay: the shot succeeded, the page had not. That is
    // the bug this whole repo keeps re-finding in a new costume — a step that
    // reports success while producing the wrong pixels — and a screenshot
    // tool is the last place it should be allowed to happen silently.
    const broken = await win.webContents.executeJavaScript(
      `(() => {
         if (document.querySelector("vite-error-overlay")) return "vite error overlay";
         const root = document.getElementById("root");
         if (!root || !root.firstChild) return "nothing rendered";
         if (!document.querySelector("svg")) return "no faces drawn";
         return "";
       })()`
    );
    if (broken) throw new Error(`the page did not render (${broken})`);

    const size = await win.webContents.executeJavaScript(
      `(() => { const r = document.body.getBoundingClientRect(); return { w: Math.ceil(r.width), h: Math.ceil(r.height) }; })()`
    );
    win.setContentSize(Math.min(size.w, 1500), Math.min(size.h, 2600));
    await sleep(900);
    const img = await win.capturePage();
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, img.toPNG());
    console.log(`faces-shot ok — ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)}kB)`);
    done(0);
  } catch (err) {
    console.error(`faces-shot failed — ${err && err.message}`);
    done(1);
  }
})();
