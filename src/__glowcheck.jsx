import React from "react";
import { createRoot } from "react-dom/client";
import UmbraFace from "./umbra/UmbraFace.jsx";
import { COLORS } from "./lib/marks.js";

export function mount(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  let host = document.getElementById("glowhost");
  if (host) host.remove();
  host = document.createElement("div");
  host.id = "glowhost";
  host.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:" + (theme === "cursor-light" ? "#FFFFFF" : "#0D0D11") + ";padding:16px;overflow:auto;font:12px system-ui;color:#888";
  document.body.appendChild(host);
  const h = React.createElement;
  const rows = COLORS.map((c) =>
    h(
      "div",
      { key: c.id, style: { display: "flex", alignItems: "center", gap: "16px", marginBottom: "2px" } },
      h("span", { style: { width: "60px" } }, c.label),
      h(UmbraFace, { tint: c.id, shape: "pebble", size: 72, mood: "idle" }),
      h(UmbraFace, { tint: c.id, shape: "pebble", size: 72, mood: "idle", glow: true }),
      h(UmbraFace, { tint: c.id, shape: "blob", size: 72, mood: "spin", live: true, glow: true }),
      h(UmbraFace, { tint: c.id, shape: "hex", size: 36, mood: "idle", glow: true }),
      h(UmbraFace, { tint: c.id, shape: "hex", size: 22, mood: "idle", glow: true })
    )
  );
  createRoot(host).render(h("div", null, rows));
  return "ok";
}

export function grid(n, glow) {
  let host = document.getElementById("glowhost");
  if (host) host.remove();
  host = document.createElement("div");
  host.id = "glowhost";
  host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#111;padding:16px;display:flex;flex-wrap:wrap;gap:10px";
  document.body.appendChild(host);
  const h = React.createElement;
  const ids = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta", "gray", "brown", "black", "blue"];
  const faces = Array.from({ length: n }, (_, i) =>
    h(UmbraFace, { key: i, tint: ids[i % ids.length], shape: "blob", size: 72, mood: "spin", live: true, glow })
  );
  createRoot(host).render(h("div", { style: { display: "flex", flexWrap: "wrap", gap: "10px" } }, faces));
  return "ok";
}
window.__glowcheck = { mount, grid };
