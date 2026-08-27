// The Hydo Bot mark catalog: body colours and body shapes.
//
// This is deliberately the SHORT list. The kernel can draw 18 silhouettes and
// the kit defines more colours, but the real picker offers exactly 8 shapes
// (the kit's own `pickShapeFromId`) and 11 colours — 2 rows of 4, then rows of
// 5. Matching that is the point; a wall of 20 swatches is not the product.
//
// Pure data + pure functions. No React, no imports.

// The app is dark-only, so `value` is the colour the body actually RENDERS in
// dark mode, and `from`/`to` are the kit's dark gradient stops. That is why
// "black" is a near-white body: the kit maps black to #FFFFFF→#C2C2C2 in dark
// mode, which is what makes Grok's white-bodied bots white.
// `ink` is the eye colour that reads on that body.
export const COLORS = [
  { id: "black",   label: "Chalk",   value: "#E9EAE7", from: "#FFFFFF", to: "#C2C2C2", ink: "#141414" },
  { id: "brown",   label: "Brown",   value: "#8C6440", from: "#A27952", to: "#604227", ink: "#141414" },
  { id: "red",     label: "Red",     value: "#E02D3C", from: "#FF3E51", to: "#A21826", ink: "#141414" },
  { id: "orange",  label: "Orange",  value: "#E86A1C", from: "#FF781C", to: "#C24E00", ink: "#141414" },
  { id: "yellow",  label: "Amber",   value: "#E4A11B", from: "#FFA31C", to: "#C27400", ink: "#141414" },
  { id: "green",   label: "Green",   value: "#2BB673", from: "#00C972", to: "#008048", ink: "#141414" },
  { id: "cyan",    label: "Teal",    value: "#2AAFA0", from: "#1CC3B0", to: "#007769", ink: "#141414" },
  { id: "blue",    label: "Blue",    value: "#3B82F0", from: "#2A92FE", to: "#0C64C1", ink: "#141414" },
  { id: "purple",  label: "Violet",  value: "#8B5CF0", from: "#9159FE", to: "#5C39A1", ink: "#141414" },
  { id: "magenta", label: "Pink",    value: "#E0479B", from: "#FF47A6", to: "#A21E62", ink: "#141414" },
  { id: "gray",    label: "Grey",    value: "#9A9A9A", from: "#B7B7B7", to: "#777777", ink: "#141414" },
  // Chrome is not a colour, it is a REFLECTION, so `value` here is only the
  // fallback for places that draw a flat swatch. UmbraFace paints it with a
  // banded vertical ramp instead (see CHROME_RAMP): polished metal shows you
  // the room, not itself.
  { id: "chrome",  label: "Chrome",  value: "#C6CBD2", from: "#FFFFFF", to: "#5A6068", ink: "#0E1013", metal: true },
];

// `iris` is the old field name for the same value. Kept so anything still
// reading `.iris` keeps working.
for (const c of COLORS) c.iris = c.ink;

// All 18 bodies the kernel can draw.
//
// The picker used to offer 8 of these to match the reference app's own list.
// The other ten were never missing, only hidden: they render through the same
// `rim` path, they are in the face lab, and saved bots could already be
// wearing them. Ordered soft-to-hard so the grid reads as a family rather
// than a dump.
export const SHAPES = [
  { id: "blob",     label: "Blob" },
  { id: "pebble",   label: "Pebble" },
  { id: "bean",     label: "Bean" },
  { id: "egg",      label: "Egg" },
  { id: "teardrop", label: "Teardrop" },
  { id: "cloud",    label: "Cloud" },
  { id: "leaf",     label: "Leaf" },
  { id: "dome",     label: "Dome" },
  { id: "arch",     label: "Arch" },
  { id: "squircle", label: "Squircle" },
  { id: "tablet",   label: "Tablet" },
  { id: "capsule",  label: "Capsule" },
  { id: "cylinder", label: "Cylinder" },
  { id: "shield",   label: "Shield" },
  { id: "hex",      label: "Hex" },
  { id: "wedge",    label: "Wedge" },
  { id: "gem",      label: "Gem" },
  { id: "crystal",  label: "Crystal" },
];

export const PICK_SHAPES = SHAPES.map((s) => s.id);
export const COLOR_IDS = COLORS.map((c) => c.id);
export const SHAPE_IDS = PICK_SHAPES;

// Older saved state, and the kit's own naming, use some other spellings.
// "white" resolves to black because a black body renders white in dark mode.
const COLOR_ALIAS = { violet: "purple", white: "black", amber: "yellow", teal: "cyan", pink: "magenta" };

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function isCustomHex(id) {
  return typeof id === "string" && HEX.test(id);
}

export function colorOf(id) {
  if (isCustomHex(id)) {
    const value = id.toUpperCase();
    return { id: value, label: "Custom", value, from: value, to: value, ink: inkFor(value), iris: inkFor(value) };
  }
  const key = COLOR_ALIAS[id] || id;
  return COLORS.find((c) => c.id === key) || COLORS.find((c) => c.id === "gray");
}

// A bot saved with one of the kernel's other 10 silhouettes still resolves to
// something sensible rather than snapping to hex.
const SHAPE_ALIAS = {
  bean: "pebble",
  egg: "blob",
  capsule: "tablet",
  cylinder: "tablet",
  gem: "hex",
  crystal: "hex",
  shield: "wedge",
  dome: "cloud",
  arch: "tablet",
  leaf: "teardrop",
};

export function shapeOf(id) {
  const key = SHAPE_ALIAS[id] || id;
  return SHAPES.find((s) => s.id === key) || SHAPES.find((s) => s.id === "blob");
}

// Relative luminance. Grok puts dark eyes on every body it ships, so the cut
// sits low — only a genuinely near-black body would earn light eyes.
export function inkFor(hex) {
  const m = String(hex || "").replace("#", "");
  if (m.length !== 6) return "#141414";
  const lin = (v) => {
    const s = parseInt(v, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const l =
    0.2126 * lin(m.slice(0, 2)) + 0.7152 * lin(m.slice(2, 4)) + 0.0722 * lin(m.slice(4, 6));
  return l < 0.06 ? "#F5F6F4" : "#141414";
}

export function initialOf(name) {
  const ch = String(name || "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "M";
}

export function pickColor(n) {
  const i = Number.isFinite(n) ? Math.abs(Math.trunc(n)) : 0;
  return COLORS[i % COLORS.length].id;
}

export function pickShape(n) {
  const i = Number.isFinite(n) ? Math.abs(Math.trunc(n)) : 0;
  return PICK_SHAPES[i % PICK_SHAPES.length];
}
