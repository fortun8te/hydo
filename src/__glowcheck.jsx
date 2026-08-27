import React from "react";
import { createRoot } from "react-dom/client";
import UmbraFace from "./umbra/UmbraFace.jsx";
export function grid(n, glow) {
  let host = document.getElementById("glowhost");
  if (host) host.remove();
  host = document.createElement("div");
  host.id = "glowhost";
  host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0D0D11;padding:16px";
  document.body.appendChild(host);
  const ids = ["red","orange","yellow","green","cyan","blue","purple","magenta","gray","brown","black","blue"];
  const h = React.createElement;
  createRoot(host).render(
    h("div", { style: { display: "flex", flexWrap: "wrap", gap: "14px" } },
      Array.from({ length: n }, (_, i) =>
        h(UmbraFace, { key: i, tint: ids[i % ids.length], shape: "blob", size: 72, mood: "spin", live: true, glow })))
  );
  return "ok";
}
window.__glowcheck = { grid };
