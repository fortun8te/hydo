// Hydo's keyboard-shortcut map, extracted from the real app
// (extracted-ui-kit/shortcuts.json + chat-channels.json's `commands` list).
//
// Pure data + pure helpers only — no React, no listeners, no DOM writes at
// import time. isMac() reads navigator (a read, not a mutation) so
// formatChord()/matchEvent() can render the right glyphs for the platform
// they're running on.

function isMac() {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform || navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

// chord string -> command id. Order within a chord is always
// mod, alt, shift, <key> — see buildChord() below, which emits the same
// order, so KEYMAP lookups are a plain object hit.
export const KEYMAP = {
  "mod+k": "sand.commandPalette",
  "mod+n": "sand.newAgent",
  "mod+f": "sand.findInChat",
  "mod+enter": "sand.send",
  "mod+comma": "sand.openSettings",
  "mod+b": "sand.toggleSidebar",
  "mod+i": "sand.toggleInfo",
  "mod+l": "sand.toggleInfo",
  "mod+alt+b": "sand.toggleInfo",
  "mod+shift+i": "sand.toggleInfo",
  "mod+bracketleft": "sand.navigateBack",
  "alt+up": "sand.previousAgent",
  "alt+down": "sand.nextAgent",
};

// Chords that must keep working even while the caret is sitting in an
// <input>/<textarea>/contenteditable (composer, search boxes, etc.).
const TYPING_ALLOWED = new Set(["mod+enter", "mod+k", "mod+f"]);

// Every command id chat-channels.json knows about, human-labelled and
// grouped for the palette. `keys` lists every chord bound to it (bound
// commands may have more than one, e.g. toggleInfo); unbound commands ship
// with an empty array and just show no chord in the UI.
const RAW_COMMANDS = [
  { id: "sand.commandPalette", label: "Command Palette", icon: "terminal-rectangle", group: "General", keys: ["mod+k"] },
  { id: "sand.newAgent", label: "New Bot", icon: "person-plus", group: "General", keys: ["mod+n"] },
  { id: "sand.findInChat", label: "Find in Chat", icon: "magnifying-glass", group: "General", keys: ["mod+f"] },
  { id: "sand.send", label: "Send Message", icon: "arrow-right", group: "General", keys: ["mod+enter"] },
  { id: "sand.focusInput", label: "Focus Message Input", icon: "keyboard-tab", group: "General", keys: [] },
  { id: "sand.focusSearch", label: "Focus Search", icon: "magnifying-glass", group: "General", keys: [] },

  { id: "sand.toggleSidebar", label: "Toggle Sidebar", icon: "layout-sidebar-left", group: "View", keys: ["mod+b"] },
  { id: "sand.toggleInfo", label: "Toggle Info Panel", icon: "layout-sidebar-right", group: "View", keys: ["mod+i", "mod+l", "mod+alt+b", "mod+shift+i"] },
  { id: "sand.openSettings", label: "Open Settings", icon: "settings-gear", group: "View", keys: ["mod+comma"] },
  { id: "sand.openTools", label: "Open Tools", icon: "puzzle-piece", group: "View", keys: [] },
  { id: "sand.openWorkflows", label: "Open Workflows", icon: "chart-pyramid", group: "View", keys: [] },
  { id: "sand.toggleAgentSettings", label: "Toggle Bot Settings", icon: "settings-gear", group: "View", keys: [] },

  // No "Go Forward" counterpart, and there never was one: navigateBack only
  // leaves the current sub-view (setDmPeerId(null); setRail(null)) — this app
  // keeps no history stack to go forward INTO. It shipped as a palette row
  // and a ⌘] binding that reached `default: break` and did nothing.
  { id: "sand.navigateBack", label: "Go Back", icon: "arrow-block-line-left", group: "Navigation", keys: ["mod+bracketleft"] },
  { id: "sand.previousAgent", label: "Previous Bot", icon: "chevron-up-small", group: "Navigation", keys: ["alt+up"] },
  { id: "sand.nextAgent", label: "Next Bot", icon: "chevron-down-small", group: "Navigation", keys: ["alt+down"] },
];

const SYMBOLS_MAC = {
  mod: "⌘",
  shift: "⇧",
  alt: "⌥",
  ctrl: "⌃",
  enter: "⏎",
  up: "↑",
  down: "↓",
  comma: ",",
  bracketleft: "[",
  bracketright: "]",
};

const WORDS_OTHER = {
  mod: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  ctrl: "Ctrl",
  enter: "Enter",
  up: "↑",
  down: "↓",
  comma: ",",
  bracketleft: "[",
  bracketright: "]",
};

// formatChord("mod+shift+i") -> "⌘⇧I" on mac, "Ctrl+Shift+I" elsewhere.
// Accepts a single chord string (tokens joined by "+"); unknown/empty
// input returns "" rather than throwing.
export function formatChord(chord, opts = {}) {
  if (!chord || typeof chord !== "string") return "";
  const mac = typeof opts.mac === "boolean" ? opts.mac : isMac();
  const table = mac ? SYMBOLS_MAC : WORDS_OTHER;
  const tokens = chord.split("+").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!tokens.length) return "";
  const parts = tokens.map((t) => {
    if (table[t]) return table[t];
    if (t.length === 1) return t.toUpperCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  });
  return mac ? parts.join("") : parts.join("+");
}

// The palette-ready command list: each row carries a precomputed `chord`
// (display string for its first/primary binding, "" if unbound) alongside
// the raw `keys` array for callers that want every binding.
export const COMMANDS = RAW_COMMANDS.map((cmd) => ({
  ...cmd,
  chord: cmd.keys.length ? formatChord(cmd.keys[0]) : "",
}));

// Exported so callers that handle a key this map does not own (Shell's
// Escape-closes-the-rail) apply exactly the same "is the caret in a field"
// test, rather than growing a second, subtly different copy of it.
export function isTypingTarget(target) {
  if (!target) return false;
  const tag = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea") return true;
  if (target.isContentEditable) return true;
  return false;
}

function keyToken(key) {
  if (typeof key !== "string" || !key) return null;
  if (key === "Enter") return "enter";
  if (key === ",") return "comma";
  if (key === "[") return "bracketleft";
  if (key === "]") return "bracketright";
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (/^[a-zA-Z]$/.test(key)) return key.toLowerCase();
  return null;
}

// Rebuilds the same "mod+alt+shift+key" ordering KEYMAP is written in, from
// a raw KeyboardEvent-shaped object. `mod` is metaKey on mac, ctrlKey
// elsewhere (never both).
function buildChord(e, mac) {
  const modActive = mac ? !!e.metaKey : !!e.ctrlKey;
  const tokens = [];
  if (modActive) tokens.push("mod");
  if (e.altKey) tokens.push("alt");
  if (e.shiftKey) tokens.push("shift");
  const key = keyToken(e.key);
  if (!key) return null;
  tokens.push(key);
  return tokens.join("+");
}

// matchEvent(e) -> the command id a KeyboardEvent matches, or null.
// Never throws on a malformed/partial event object.
export function matchEvent(e, opts = {}) {
  if (!e || typeof e !== "object") return null;
  const mac = typeof opts.mac === "boolean" ? opts.mac : isMac();
  const chord = buildChord(e, mac);
  if (!chord) return null;
  const id = KEYMAP[chord];
  if (!id) return null;
  if (isTypingTarget(e.target) && !TYPING_ALLOWED.has(chord)) return null;
  return id;
}
