"use strict";

/**
 * SVG icon -> PNG, using Electron.
 *
 * This machine has no rasteriser: no rsvg-convert, no resvg, no ImageMagick,
 * no sharp, and cairo has no dylib here. But Electron is already a dependency,
 * and Electron is Chromium . the same engine that draws the icon in the app.
 * So the shipped PNG is by construction what a browser actually renders,
 * rather than what a second, differently-buggy SVG library thinks it should.
 *
 *   npx electron scripts/rasterize-icon.cjs [size]
 *
 * Writes build/icon.png (and icon-512, icon-256 …).
 */

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SIZES = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const WANT = SIZES.length ? SIZES : [1024, 512, 256, 128, 64, 32];
const SVG = path.join(__dirname, "..", "src", "kit", "images", "hydo-icon.svg");
// Build assets, NOT src/: these are packaging inputs, nothing imports them,
// and a 1.6MB png sitting in src/kit/images invites someone to import it.
const OUT_DIR = path.join(__dirname, "..", "build");

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const svg = fs.readFileSync(SVG, "utf8");
  const biggest = Math.max(...WANT);
  const win = new BrowserWindow({
    width: biggest,
    height: biggest,
    show: false,
    // Transparent so the rounded corners come out as alpha rather than as
    // whatever colour the window happened to be painted.
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true },
  });

  const page = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;background:transparent}
    svg{display:block;width:${biggest}px;height:${biggest}px}</style>${svg}`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`);
  // One frame for the filters (the two blur passes) to actually resolve.
  await new Promise((r) => setTimeout(r, 400));

  for (const size of WANT.sort((a, b) => b - a)) {
    const img = await win.capturePage();
    const scaled = size === biggest ? img : img.resize({ width: size, height: size, quality: "best" });
    const out = path.join(OUT_DIR, size === 1024 ? "icon.png" : `icon-${size}.png`);
    fs.writeFileSync(out, scaled.toPNG());
    console.log(`${size}\t${(fs.statSync(out).size / 1024).toFixed(1)}KB\t${path.basename(out)}`);
  }
  win.destroy();
  app.exit(0);
});
