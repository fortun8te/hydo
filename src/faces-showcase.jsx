/**
 * A grid of every mark Hydo can wear. Rendered only by scripts/faces-shot.cjs
 * for the README — it is not reachable from the app.
 *
 * The point it has to make is that these are not 288 recoloured PNGs: each
 * silhouette is drawn live through one shared frame (see UmbraFace), so a
 * teardrop and a hex keep their relative sizes, and every one of them blinks,
 * breathes and reacts on its own clock.
 */
// The app's real stylesheet. Without it `.umbra-face { overflow: visible }`
// never loads, the SVG falls back to the UA default of overflow:hidden, and
// the glow halo -- a circle deliberately wider than the box -- gets clipped
// into a square. That is a bug in the HARNESS, not in the app, and it nearly
// got reported as the opposite.
import "./styles.css";
import UmbraFace from "./umbra/UmbraFace.jsx";
import { COLORS, SHAPES } from "./lib/marks.js";

const MOODS = ["idle", "spin", "looking", "fidget", "happy", "dots"];

export default function FacesShowcase() {
  return (
    <div style={{ background: "#0a0a0a", color: "#e9eae7", padding: "30px 34px", fontFamily: "Inter, system-ui, sans-serif" }}>
      <div style={{ fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.5, marginBottom: 18 }}>
        24 shapes × 12 colours — 288 marks, every one drawn live
      </div>

      {/* Two blocks side by side rather than one 24-row column: a
          BrowserWindow cannot be taller than the display, so a single tall
          grid was silently cropped by the capture. */}
      <div style={{ display: "flex", gap: 30, marginBottom: 30 }}>
        {[SHAPES.slice(0, 12), SHAPES.slice(12)].map((half, block) => (
          <div
            key={block}
            style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 9 }}
          >
            {half.map((s) =>
              COLORS.map((c, j) => (
                <UmbraFace
                  key={`${s.id}-${c.id}`}
                  shape={s.id}
                  tint={c.id}
                  size={34}
                  live
                  mood={MOODS[(SHAPES.indexOf(s) + j) % MOODS.length]}
                />
              ))
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 26, alignItems: "center", flexWrap: "wrap" }}>
        {MOODS.map((m) => (
          <div key={m} style={{ textAlign: "center" }}>
            <UmbraFace shape="pebble" tint="cyan" size={62} mood={m} live glow />
            <div style={{ fontSize: 11, opacity: 0.45, marginTop: 8 }}>{m}</div>
          </div>
        ))}
        <div style={{ textAlign: "center" }}>
          <UmbraFace shape="star" tint="yellow" size={62} mood="happy" live glow />
          <div style={{ fontSize: 11, opacity: 0.45, marginTop: 8 }}>glow</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <UmbraFace shape="crystal" tint="magenta" size={62} mood="spin" live />
          <div style={{ fontSize: 11, opacity: 0.45, marginTop: 8 }}>working</div>
        </div>
      </div>
    </div>
  );
}
