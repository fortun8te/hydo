"use strict";

/**
 * The file preview is a POPOVER, not a rail.
 *
 * It used to be an `<aside>` docked into the bot rail's slot, so the one
 * surface you open in order to LOOK at something was the narrowest thing in
 * the window, and opening it squeezed the conversation you opened it from.
 * Every other surface in the app that asks for your attention — Settings, the
 * sheets, the confirm — is a centred card over a darkened room. This one is
 * now built the same way, and this test is what stops it drifting back.
 *
 * Also covers the two rails and the plan card: the states a pip may claim, and
 * the fact that the bot rail and the composer now normalise Hermes' todo
 * statuses through one function instead of two guesses.
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const art = read("src/screens/Artifact.jsx");
const rails = read("src/screens/rails.css");
const plan = read("src/screens/PlanCard.jsx");
const botRail = read("src/screens/BotRail.jsx");
const chanRail = read("src/screens/ChannelRail.jsx");
const routineRail = read("src/screens/RoutineRail.jsx");
const presence = read("src/lib/presence.js");

// ---- preview: modal, scrim, centred ---------------------------------------
assert.ok(!/<aside className="artifact"/.test(art), "the preview is no longer a docked aside");
assert.ok(art.includes('role="dialog"') && art.includes('aria-modal="true"'), "it announces itself as a dialog");
assert.ok(art.includes("artifact-modal__scrim"), "there is a scrim");
assert.ok(/artifact-modal__scrim" onClick=\{onClose\}/.test(art), "clicking the scrim closes it");
assert.ok(/e\.key !== "Escape"/.test(art), "Escape closes it");

assert.ok(/\.artifact-modal \{[^}]*position: fixed/s.test(rails), "the modal covers the window");
assert.ok(/\.artifact-modal \{[^}]*place-items: center/s.test(rails), "the card is centred");
// The room has to actually go dark, or it is a floating panel and not a
// preview. `--hy-scrim-heavy` is per-theme (rgba(0,0,0,x) dark / rgba(20,20,
// 20,x) light) so a fixed hex would be wrong in one theme — see rails.css's
// light-mode pass for why the literal became a token.
assert.ok(
  /\.artifact-modal__scrim \{[^}]*background: var\(--hy-scrim-heavy\)/s.test(rails),
  "the background is darkened"
);
assert.ok(/\.artifact \{[^}]*width: min\(1040px/s.test(rails), "wider than the 620px rail it replaced");
// Same band as .sheet (20). A preview under the sidebar would be a rail again.
assert.ok(/\.artifact-modal \{[^}]*z-index: 20/s.test(rails), "same z band as the sheets");
// A dialog header that drags the WINDOW is what you get by leaving the old
// titlebar affordance on a centred card.
{
  const head = rails.slice(rails.indexOf(".artifact__head {"), rails.indexOf(".artifact__title"));
  assert.ok(!/^\s+-webkit-app-region: drag;/m.test(head), "the header no longer drags the window");
}
assert.ok(!art.includes("gb-icon-chevrons-right"), "not a collapse glyph any more");

// ---- the plan: one normaliser, four spellings ------------------------------
// Hermes sends the same state as in_progress / in-progress / active / running.
// The bot rail used to interpolate that raw into `is-${status}`, so three of
// the four matched no rule at all and the running step looked pending.
assert.ok(/export function stateOf/.test(plan), "the normaliser is shared");
for (const spell of ["in_progress", "in-progress", "active", "running", "doing"]) {
  assert.ok(plan.includes(`"${spell}"`), `${spell} is a live spelling`);
}
// `liveStateOf`, not `stateOf`, as of the "only say active when it's
// actually active" fix: the rail now gates a live status on `botBusy(agent)`
// (the same source the roster pip reads) so a stale in_progress left by a
// finished turn can't still claim to be running.
assert.ok(botRail.includes("liveStateOf(t, botBusy(agent))"), "the rail gates live on actually being busy");
assert.ok(!/is-\$\{t\.status\}/.test(botRail), "the rail no longer prints the raw status as a class");
assert.ok(/\.bot-rail__plan-item\.is-live/.test(rails) && /\.bot-rail__plan-item\.is-done/.test(rails),
  "rails.css keys off the normalised names");

// A step still running must not print the same shape as one that started and
// finished inside a minute.
assert.ok(/`\$\{from\} →`/.test(plan), "a running step's time is open-ended");
assert.ok(plan.includes("hy-plan__box"), "steps are boxes you can read, not colour-coded dots");

// It must not slam shut mid-job. Collapsing is keyed to the OWNER changing,
// never to the todos, which are rewritten on every `todo` call.
assert.ok(/useEffect\(\(\) => \{\s*setOpen\(false\);\s*\}, \[name\]\)/s.test(plan),
  "collapses when the plan changes hands, not when it changes");

// ---- presence may not claim more than it knows -----------------------------
assert.ok(presence.includes("Working in another conversation"), "busy elsewhere is said, not implied");
{
  const label = /export function pipLabelOf[\s\S]*?\n\}/.exec(presence)[0];
  // Fails toward idle: no `workingIn`, no claim.
  assert.ok(/if \(!at\) return "";/.test(label), "no turn, no label");
  // "Online" is a claim about a warm process that nothing on this side can
  // see. The rail used to print it from a branch pipOf could never reach.
  assert.ok(!/Online/.test(label), "the label never says Online");
}
assert.ok(!/\? "Online"|: "Online"/.test(botRail), "and the rail no longer has that branch");
// The face and the dot used to read DIFFERENT facts, so one could be lit while
// the other idled on the same teammate. That was fixed by making them share a
// source — and then fixed properly by removing both from this panel.
//
// This rail is where you pick a colour and a shape. A face that spins cannot be
// judged for colour, and a live pip and an activity caption are answers to
// questions nobody asks while choosing one; the row and the thread already
// carry them. So the invariant is now stronger than "they agree": there is
// nothing here to disagree.
assert.ok(
  !/mood=\{botBusy\(agent\)/.test(botRail),
  "the customisation preview must not spin — you cannot judge a colour on a moving face"
);
assert.ok(
  !/bot-rail__online/.test(botRail),
  "and must not wear a live pip"
);
assert.ok(
  !/bot-rail__now/.test(botRail),
  "and must not caption itself with what the teammate is doing"
);
// The one motion that IS the change you are making stays.
assert.ok(/\bmorph\b/.test(botRail), "switching shape must still animate; that is the edit itself");

// ---- the channel rail says who is working ---------------------------------
assert.ok(chanRail.includes("botWorks(a, channel?.id)"), "scoped to THIS channel");
assert.ok(chanRail.includes("sand-member__dot"), "members carry a pip");

// ---- routines: the event triggers were unreachable ------------------------
// They were exported, labelled and given a card, and then never offered.
assert.ok(routineRail.includes("EVENT_TRIGGERS"), "event triggers can be added");
assert.ok(/const sched = next\.find/.test(routineRail), "the legacy `at` follows the schedule trigger");
assert.ok(!/at: next\.find\(\(t\) => t\.kind === "schedule"\)\?\.at \|\| item\.at/.test(routineRail),
  "removing the last trigger no longer leaves a stale date behind");

// ---- the workspace button reports ------------------------------------------
// `openWorkspace` answers {ok, path} or {ok:false, reason}; all of it used to
// be thrown away, so a failure was a button that did nothing silently.
assert.ok(/await window\.hydo\?\.openWorkspace/.test(botRail), "the answer is awaited");
assert.ok(botRail.includes("bot-rail__workspace-note"), "and shown");

console.log("preview-popover-test ok");
