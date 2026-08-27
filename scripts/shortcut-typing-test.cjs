"use strict";

/**
 * Command chords must survive a caret sitting in a text field.
 *
 * `TYPING_ALLOWED` was an explicit list of three chords, so Cmd-, did nothing
 * while focus was in ANY input — including the "Search or create Bots" box that
 * the + menu focuses the instant it opens. The sequence "start making a
 * teammate, then open Settings" therefore left the picker on screen and
 * Settings never arrived. Reported as "the bot doesn't disappear, which is
 * odd", which is exactly what it looks like from the outside.
 *
 * A Command-modified chord is not something anyone types into a field. On macOS
 * Cmd-, opens preferences from inside a text box in every app there is.
 * Alt-only chords are the real exception and stay suppressed, because macOS
 * text fields bind Option-Up/Down to paragraph movement.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const out = path.join(require("node:os").tmpdir(), `shortcuts-${process.pid}.mjs`);
execFileSync("npx", ["esbuild", path.join(ROOT, "src/lib/shortcuts.js"), "--format=esm", `--outfile=${out}`], {
  cwd: ROOT, stdio: "ignore",
});

(async () => {
  const m = await import(`file://${out}`);
  const ev = (key, mods = {}, tag = "input") => ({
    key,
    metaKey: !!mods.meta,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    target: { tagName: tag, isContentEditable: false },
  });

  // The bug, in one line.
  assert.strictEqual(
    m.matchEvent(ev(",", { meta: true }), { mac: true }),
    "sand.openSettings",
    "Cmd-, must open Settings even with the caret in a search box"
  );

  // The whole class, not just the one that was reported.
  for (const [key, id] of [["k", "sand.commandPalette"], ["n", "sand.newAgent"], ["b", "sand.toggleSidebar"]]) {
    assert.strictEqual(
      m.matchEvent(ev(key, { meta: true }), { mac: true }),
      id,
      `Cmd-${key} must survive typing — a modified chord is not typed text`
    );
  }

  // The genuine exception: macOS binds these inside text fields.
  assert.strictEqual(
    m.matchEvent(ev("ArrowUp", { alt: true }), { mac: true }),
    null,
    "Alt-Up moves by paragraph in a text field and must NOT be stolen"
  );
  // ...but it still works when the caret is not in one.
  assert.strictEqual(
    m.matchEvent(ev("ArrowUp", { alt: true }, "div"), { mac: true }),
    "sand.previousAgent",
    "outside a field, Alt-Up is ours again"
  );

  fs.unlinkSync(out);
  console.log("shortcut-typing-test ok");
})().catch((e) => {
  try { fs.unlinkSync(out); } catch {}
  console.error(e);
  process.exit(1);
});
