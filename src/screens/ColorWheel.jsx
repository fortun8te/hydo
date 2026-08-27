import { useEffect, useRef, useState } from "react";
import { isCustomHex } from "../lib/marks.js";

function clamp(n, a, b) {
  return n < a ? a : n > b ? b : n;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return { r: 139, g: 92, b: 240 };
  return {
    r: parseInt(m[1].slice(0, 2), 16),
    g: parseInt(m[1].slice(2, 4), 16),
    b: parseInt(m[1].slice(4, 6), 16),
  };
}

function rgbToHsv({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: max ? d / max : 0, v: max };
}

function hsvToRgb(h, s, v) {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) {
    r = c;
    g = x;
  } else if (hh < 2) {
    r = x;
    g = c;
  } else if (hh < 3) {
    g = c;
    b = x;
  } else if (hh < 4) {
    g = x;
    b = c;
  } else if (hh < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHex({ r, g, b }) {
  return (
    "#" +
    [r, g, b]
      .map((n) => clamp(n, 0, 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function hsvToHex(h, s, v) {
  return rgbToHex(hsvToRgb(h, s, v));
}

function hueCss(h) {
  return hsvToHex(h, 1, 1);
}

export default function ColorWheel({ value, onChange, onClose }) {
  const rootRef = useRef(null);
  const start = rgbToHsv(hexToRgb(isCustomHex(value) ? value : "#8B5CF0"));
  const [h, setH] = useState(start.h);
  const [s, setS] = useState(start.s);
  const [v, setV] = useState(start.v);
  const [hexText, setHexText] = useState(hsvToHex(start.h, start.s, start.v));
  const hsvRef = useRef({ h, s, v });
  hsvRef.current = { h, s, v };

  useEffect(() => {
    function onDoc(e) {
      if (rootRef.current?.contains(e.target)) return;
      if (e.target.closest?.(".swatch--custom")) return;
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
  }, [onClose]);

  function emit(nh, ns, nv) {
    const hex = hsvToHex(nh, ns, nv);
    setHexText(hex);
    onChange?.(hex);
  }

  function setFromPad(e, el) {
    const box = el.getBoundingClientRect();
    const ns = clamp((e.clientX - box.left) / box.width, 0, 1);
    const nv = clamp(1 - (e.clientY - box.top) / box.height, 0, 1);
    const nh = hsvRef.current.h;
    setS(ns);
    setV(nv);
    hsvRef.current = { h: nh, s: ns, v: nv };
    emit(nh, ns, nv);
  }

  function setFromHue(e, el) {
    const box = el.getBoundingClientRect();
    const nh = clamp((e.clientX - box.left) / box.width, 0, 1) * 360;
    const { s: ns, v: nv } = hsvRef.current;
    setH(nh);
    hsvRef.current = { h: nh, s: ns, v: nv };
    emit(nh, ns, nv);
  }

  function applyHex(raw) {
    let t = String(raw || "").trim().toUpperCase();
    if (t && t[0] !== "#") t = "#" + t;
    if (!isCustomHex(t)) return;
    const next = rgbToHsv(hexToRgb(t));
    setH(next.h);
    setS(next.s);
    setV(next.v);
    setHexText(t);
    onChange?.(t);
  }

  const hex = hsvToHex(h, s, v);
  const hue = hueCss(h);

  return (
    <div className="color-wheel" ref={rootRef} role="dialog" aria-label="Custom colour">
      <div
        className="color-wheel__pad"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromPad(e, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPad(e, e.currentTarget);
        }}
      >
        <span
          className="color-wheel__knob color-wheel__knob--pad"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: hex }}
        />
      </div>
      <div
        className="color-wheel__hue"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromHue(e, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromHue(e, e.currentTarget);
        }}
      >
        <span className="color-wheel__knob color-wheel__knob--hue" style={{ left: `${(h / 360) * 100}%` }} />
      </div>
      <div className="color-wheel__meta">
        <span className="color-wheel__chip" style={{ background: hex }} />
        <input
          className="color-wheel__hex"
          value={hexText}
          spellCheck={false}
          aria-label="Hex colour"
          onChange={(e) => setHexText(e.target.value)}
          onBlur={() => applyHex(hexText)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyHex(hexText);
          }}
        />
      </div>
    </div>
  );
}
