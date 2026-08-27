import { useEffect, useState } from "react";
import UmbraFace from "../umbra/UmbraFace.jsx";
import { COLORS, SHAPES } from "../lib/marks.js";
import { al } from "../umbra/blob-kernel.js";

// The tuning bench for the bot faces.
//
// The old face-lab was a static contact sheet: every shape, every colour, four
// moods, look at it and hope. That answers "did it throw", not "does the jump
// read as a jump", which is the only question anyone actually has when they
// open this. So the top half is a single big face with live controls, and the
// contact sheet moved below it as a regression check.
//
// Reached at `?lab=1` (see App.jsx). It needs no store and no Electron.

const MOODS = ["idle", "fidget", "looking", "spin", "typing"];
const PICKER = SHAPES.map((s) => s.id);
const LEGACY = Object.keys(al).filter((id) => !PICKER.includes(id));
const SIZES = [16, 22, 28, 36, 72];

const C = {
  wrap: { padding: "24px 28px 64px", color: "#e6e6e6", font: "13px system-ui, sans-serif", background: "#0b0b0b", minHeight: "100vh" },
  h1: { font: "600 17px system-ui, sans-serif", margin: "0 0 2px" },
  sub: { color: "#7a7a7a", margin: "0 0 22px", fontSize: 12.5 },
  head: { margin: "34px 0 12px", font: "600 11px system-ui, sans-serif", letterSpacing: ".09em", textTransform: "uppercase", color: "#7a7a7a" },
  row: { display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-end" },
  cell: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 92 },
  cap: { font: "11px system-ui, sans-serif", color: "#7a7a7a", textAlign: "center" },
  bench: { display: "flex", gap: 30, alignItems: "flex-start", flexWrap: "wrap", padding: 20, borderRadius: 16, background: "#131313", border: "1px solid #ffffff12" },
  stage: { width: 260, height: 260, display: "grid", placeItems: "center", borderRadius: 14, background: "#080808", flex: "none" },
  panel: { display: "grid", gap: 14, minWidth: 300, flex: 1 },
  field: { display: "grid", gap: 6 },
  label: { fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "#7a7a7a" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6 },
  hint: { fontSize: 12, color: "#6f6f6f", lineHeight: 1.5, margin: 0 },
};

function chip(on) {
  return {
    padding: "5px 11px",
    borderRadius: 999,
    border: "1px solid " + (on ? "#ffffff40" : "#ffffff18"),
    background: on ? "#2e2e2e" : "transparent",
    color: on ? "#fff" : "#a8a8a8",
    font: "12px system-ui, sans-serif",
    cursor: "pointer",
  };
}

function Chips({ value, options, onChange, labels }) {
  return (
    <div style={C.chips}>
      {options.map((o) => (
        <button key={o} type="button" style={chip(value === o)} onClick={() => onChange(o)}>
          {labels ? labels[o] || o : o}
        </button>
      ))}
    </div>
  );
}

function Cell({ children, label, size = 72 }) {
  return (
    <div style={C.cell}>
      <div style={{ width: size, height: size, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
      <span style={C.cap}>{label}</span>
    </div>
  );
}

export default function FaceLab() {
  const [mood, setMood] = useState("fidget");
  const [shape, setShape] = useState("squircle");
  const [tint, setTint] = useState("cyan");
  const [size, setSize] = useState(160);
  const [morph, setMorph] = useState(true);
  const [pokes, setPokes] = useState(0);

  // Cycling the shape with `morph` on is what exercises the morph path, which
  // is otherwise only reachable by editing a bot in the real app.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "]") setShape((s) => PICKER[(PICKER.indexOf(s) + 1) % PICKER.length]);
      if (e.key === "[") setShape((s) => PICKER[(PICKER.indexOf(s) - 1 + PICKER.length) % PICKER.length]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="face-lab" style={C.wrap}>
      {/* styles.css pins .umbra-face to 36px for the app's own rows; inside the
          lab the size prop must be what you see. */}
      <style>{".face-lab .umbra-face{width:auto;height:auto}"}</style>
      <h1 style={C.h1}>Face lab</h1>
      <p style={C.sub}>Click the big face to poke it. [ and ] cycle the shape (morph on).</p>

      <div style={C.bench}>
        <div style={C.stage} onClick={() => setPokes((n) => n + 1)}>
          <UmbraFace
            mood={mood}
            tint={tint}
            shape={shape}
            size={size}
            live={mood !== "idle"}
            morph={morph}
            poke
          />
        </div>
        <div style={C.panel}>
          <div style={C.field}>
            <span style={C.label}>Mood</span>
            <Chips value={mood} options={MOODS} onChange={setMood} />
          </div>
          <div style={C.field}>
            <span style={C.label}>Shape</span>
            <Chips value={shape} options={PICKER} onChange={setShape} />
          </div>
          <div style={C.field}>
            <span style={C.label}>Colour</span>
            <div style={C.chips}>
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  onClick={() => setTint(c.id)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    background: c.value,
                    border: tint === c.id ? "2px solid #fff" : "2px solid transparent",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
              ))}
            </div>
          </div>
          <div style={C.field}>
            <span style={C.label}>Size · {size}px</span>
            <input
              type="range"
              min="16"
              max="220"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          </div>
          <div style={C.field}>
            <span style={C.label}>Morph on shape change</span>
            <Chips
              value={morph ? "on" : "off"}
              options={["on", "off"]}
              onChange={(v) => setMorph(v === "on")}
            />
          </div>
          <p style={C.hint}>
            Pokes this session: {pokes}. Spam the face: every click should restart a clean jump,
            never freeze it mid-air. The body must not stretch tall, it must leave the ground.
            Spin always turns the same way (the bot's left).
          </p>
        </div>
      </div>

      <h2 style={C.head}>Moods at roster size (36px, as the sidebar draws them)</h2>
      <div style={C.row}>
        {MOODS.map((m) => (
          <Cell key={m} label={m} size={36}>
            <UmbraFace mood={m} tint={tint} shape={shape} size={36} live={m !== "idle"} fit />
          </Cell>
        ))}
      </div>

      <h2 style={C.head}>The 8 bodies the picker offers</h2>
      <div style={C.row}>
        {PICKER.map((id) => (
          <Cell key={id} label={id}>
            <UmbraFace tint={tint} shape={id} size={72} />
          </Cell>
        ))}
      </div>

      <h2 style={C.head}>The 10 kernel silhouettes a saved bot may still wear</h2>
      <div style={C.row}>
        {LEGACY.map((id) => (
          <Cell key={id} label={id}>
            <UmbraFace tint="cyan" shape={id} size={72} />
          </Cell>
        ))}
      </div>

      <h2 style={C.head}>All 11 colours</h2>
      <div style={C.row}>
        {COLORS.map((c) => (
          <Cell key={c.id} label={c.label}>
            <UmbraFace tint={c.id} shape="blob" size={72} />
          </Cell>
        ))}
      </div>

      <h2 style={C.head}>Sizes in use</h2>
      <div style={C.row}>
        {SIZES.map((n) => (
          <Cell key={n} label={`${n}px`} size={72}>
            <UmbraFace tint="blue" shape="hex" size={n} />
          </Cell>
        ))}
      </div>

      <h2 style={C.head}>Spin, every shape (it must stay solid all the way round)</h2>
      <div style={C.row}>
        {PICKER.map((id) => (
          <Cell key={id} label={id}>
            <UmbraFace mood="spin" tint="green" shape={id} size={72} live />
          </Cell>
        ))}
      </div>

      <h2 style={C.head}>Bad input must never throw</h2>
      <div style={C.row}>
        <Cell label="unknown tint"><UmbraFace tint="chartreuse-ish" shape="hex" size={72} /></Cell>
        <Cell label='legacy "violet"'><UmbraFace tint="violet" shape="hex" size={72} /></Cell>
        <Cell label="unknown shape"><UmbraFace tint="teal" shape="dodecahedron" size={72} /></Cell>
        <Cell label="no props"><UmbraFace /></Cell>
      </div>
    </div>
  );
}

export { FaceLab };
