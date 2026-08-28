"use strict";

/**
 * A reaction and a reply have to reach the MODEL, not just the screen.
 *
 * The failure this guards is the quiet one. Both features look finished the
 * moment the pill and the quote render: you tap 🔥 on what a teammate wrote,
 * a pill appears, and nothing about the teammate's next answer suggests it
 * ever saw it. Same for a reply — the quote sits above the bubble as pure
 * decoration while Hermes is handed the new sentence alone and answers as if
 * nothing was quoted.
 *
 * So this test walks the whole path in both directions:
 *   UI (Transcript.jsx) → bridge (preload.cjs) → store (store.cjs)
 *                       → Hermes (hermes-gateway.cjs)
 * and asserts the two places where meaning is actually attached: the queued
 * reaction note and the reply preamble.
 *
 * It also pins the rule that makes any of this safe to ship: a reaction is a
 * USER action. It may cause a teammate to speak, but only as the answer to
 * that action — nothing here may open a turn that no human started.
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

const transcript = read("src", "screens", "Transcript.jsx");
const css = read("src", "screens", "transcript.css");
const preload = read("electron", "preload.cjs");
const store = read("electron", "store.cjs");
const gateway = read("electron", "hermes-gateway.cjs");
const shell = read("src", "screens", "Shell.jsx");

// ===========================================================================
// 1. Reactions — the screen
// ===========================================================================

// The picker, the pills, and a quick set that does not make you hunt.
assert.ok(transcript.includes("QUICK_REACTIONS"), "there is a quick emoji row");
assert.ok(transcript.includes("MORE_REACTIONS"), "and a wider set behind it");
assert.ok(transcript.includes("function EmojiStrip"), "the picker is its own component");
assert.ok(transcript.includes("function ReactionPills"), "reactions render as pills");

// Grouping is what makes a pill a pill: five people on 👍 is one control that
// says 5, not five controls.
assert.ok(transcript.includes("function groupReactions"), "identical emoji collapse into one pill");
assert.ok(/g\.count \+= 1/.test(transcript), "with a count");
assert.ok(/r\.by === "user"/.test(transcript), "and the user's own is marked");

// Tapping a pill toggles, which means the pill is a control, so it has to say
// so to a screen reader.
assert.ok(/aria-pressed=\{g\.mine\}/.test(transcript), "a pill announces its own state");
assert.ok(/onClick=\{\(\) => onToggle\(g\.emoji\)\}/.test(transcript), "and toggles on click");
assert.ok(
  /onToggle=\{\(emoji\) => onReact\(msg\.id, emoji\)\}/.test(transcript),
  "the pill and the picker land on the same handler"
);

// The picker opens above the bar when below would be clipped by the scroller.
// Without this the newest message — the one you most want to react to — opens
// a strip you cannot see.
assert.ok(/b\.bottom \+ 62 > s\.bottom/.test(transcript), "the strip flips up near the bottom");
assert.ok(css.includes("hy-emoji--above"), "and the stylesheet has that variant");

// Escape closes it and focus goes back to the button that opened it.
assert.ok(/e\.key === "Escape"/.test(transcript), "Escape closes the picker");
assert.ok(/smileyRef\.current\?\.focus\(\)/.test(transcript), "and focus returns to the trigger");

// ===========================================================================
// 2. Reactions — the wire
// ===========================================================================

assert.ok(
  /function react\(messageId, emoji\)[\s\S]{0,140}window\.hydo\?\.react\?\.\(messageId, emoji\)/.test(
    transcript
  ),
  "the transcript's react() calls the bridge and nothing else"
);
assert.ok(
  /react: \(messageId, emoji\) => ipcRenderer\.invoke\("hydo:react", messageId, emoji\)/.test(preload),
  "the bridge forwards it to main"
);
assert.ok(/async react\(messageId, emoji\)/.test(store), "the store owns the toggle");
assert.ok(/toggleReaction\(hit\.msg, e, "user"\)/.test(store), "toggling the same emoji removes it");
assert.ok(/if \(outcome === "noop"\) return publicState\(\)/.test(store), "a no-op costs nothing");

// ===========================================================================
// 3. Reactions — the part that makes them MEAN something
// ===========================================================================
//
// Hermes has its own reaction channel (`message.react`), but its note-folding
// is gated behind a config flag Hydo does not write, so on a stock install the
// model never reads the tapback. The queued note is what closes that gap: a
// short line naming the emoji and quoting the message it landed on, delivered
// with the NEXT prompt.
assert.ok(store.includes("function oweNote"), "notes can be queued for a teammate");
assert.ok(store.includes("function drainNotes"), "and are drained once delivered");
assert.ok(/const notes = drainNotes\(agent\.id\)/.test(store), "the turn builder drains them");
// Trailing comma and newline allowed: the array gained a standing-rules entry
// and got reformatted across lines. What matters is that notes are still IN it.
assert.ok(/\.\.\.notes,?\s*\]/.test(store), "and folds them into the prompt");
assert.ok(store.includes("MAX_REACTION_NOTES"), "the queue is bounded");

// The note has to name the emoji AND quote the message, or "the user reacted"
// is a riddle.
const noteBlock = store.slice(store.indexOf("async react(messageId, emoji)"));
assert.ok(/The user \$\{verb\} \$\{e\}/.test(noteBlock), "the note names the emoji");
assert.ok(/const snippet = snippetOf\(hit\.msg\)/.test(noteBlock), "and quotes the message");
assert.ok(/removed their/.test(noteBlock), "removing a reaction is said, not silently dropped");
assert.ok(/whose = hit\.msg\.role === "user" \? "their own" : "your"/.test(noteBlock),
  "and whose message it was is not left ambiguous");

// Forwarding to Hermes is best-effort and correct-or-nothing. Hermes addresses
// a row by durable id or by "newest of this role"; Hydo holds neither for an
// older message, and a reaction landing on the WRONG message is worse than one
// that stays local.
assert.ok(store.includes("function newestRoleFor"), "addressability is checked before forwarding");
assert.ok(/if \(rowId != null \|\| role\)/.test(noteBlock), "and nothing is sent without an address");
assert.ok(/gateway\.available\(\) \|\| !gateway\.hasSession\(ownerId\)/.test(noteBlock),
  "a missing Hermes is not an error, it is a no-op");
assert.ok(/\.catch\(\(\) => \{/.test(noteBlock), "a failed forward never loses Hydo's own copy");
assert.ok(gateway.includes("'message.react'"), "the gateway speaks the real method");
assert.ok(
  /throw new Error\('react: rowId or newestRole required'\)/.test(gateway),
  "and refuses an unaddressed react"
);

// THE INVARIANT. A reaction is a user action. It may be carried into the next
// turn, and that turn is answered because the user did something — but nothing
// on this path may open a turn on a teammate's behalf.
assert.ok(
  !/submit|startTurn|runTurn|sendTo/.test(noteBlock.slice(0, noteBlock.indexOf("async usage"))),
  "reacting queues context; it never opens a bot-to-bot turn"
);

// ===========================================================================
// 4. Direct replies
// ===========================================================================

// The quote above the bubble, and the two ways it can be wrong.
assert.ok(transcript.includes("function QuotedReply"), "a reply renders its parent");
assert.ok(/Original message unavailable/.test(transcript), "a deleted parent says so");
assert.ok(
  /typeof replyTo\.text === "string"/.test(transcript),
  "only a real string is quotable — an object must not reach the DOM as [object Object]"
);
assert.ok(/known && id && !known\.has\(id\)/.test(transcript), "and a dangling id is detected");
assert.ok(/const known = new Set\(list\.map\(\(m\) => String\(m\.id\)\)\)/.test(transcript),
  "the transcript knows which originals it still holds");
// Clicking the quote takes you to the original — a quote you cannot follow is
// a screenshot of a link.
assert.ok(/onJumpTo\?\.\(id\)/.test(transcript), "the quote jumps to the original");
assert.ok(/disabled=\{dangling \|\| !id\}/.test(transcript), "unless there is nothing to jump to");
assert.ok(/id=\{`msg-\$\{msg\.id\}`\}/.test(transcript), "every row carries the id to jump to");
assert.ok(/getElementById\(`msg-\$\{id\}`\)/.test(shell), "and the shell scrolls to it");

// Composing: the reply button arms the composer, and the id rides with send().
assert.ok(/onReply\?\.\(msg\)/.test(transcript), "the action bar can start a reply");
assert.ok(/setReplyTo\(\{ id: msg\.id/.test(shell), "which arms the composer");
assert.ok(/replyTo: replying\.id/.test(shell), "and the id travels with the message");
assert.ok(/send: \(text, opts\)/.test(preload), "the bridge carries the options");

// And the part that is easy to forget: Hermes has to be told what was quoted.
assert.ok(store.includes("function replySnapshot"), "the original is snapshotted at send time");
assert.ok(
  /text: String\(msg\.text \|\| ""\)/.test(store),
  "text and not just an id, so the quote survives the original being deleted"
);
assert.ok(store.includes("function replyPreamble"), "and turned into a line the model reads");
assert.ok(/Replying to \$\{who\}: "\$\{quoted\}"/.test(store), "naming who wrote it and what it said");
const preambleUses = store.match(/replyTo \? `\$\{replyPreamble\(replyTo\)\}\\n\\n\$\{body\}` : body/g);
assert.ok(
  preambleUses && preambleUses.length >= 2,
  "the preamble is prepended in BOTH the 1:1 and the channel send paths"
);

// A teammate answering a reply should have its own bubble quote the same
// parent, or the thread reads as two unrelated halves.
assert.ok(store.includes("function applyBotReply"), "the answer inherits the quote");
assert.ok(/if \(b && !b\.replyTo\) b\.replyTo = snapshot/.test(store), "without overwriting an explicit one");

console.log("reaction-reply-test ok");
