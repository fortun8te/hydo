"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const { stripComments } = require("./lib/source-scan.cjs");

const ROOT = path.join(__dirname, "..");

async function main() {
  const mod = await import(pathToFileURL(path.join(ROOT, "src/lib/presence.js")).href);
  const {
    presenceOf,
    USER_IDLE_MS,
    USER_JOIN_MS,
    USER_LEAVE_MS,
    READ_HOLD_MS,
    composerExtrasForMember,
  } = mod;

  const idle = presenceOf({});
  assert.equal(idle.visible, false);
  assert.notEqual(idle.mood, "typing");

  const reading = presenceOf({ sending: true, now: 1000, since: 1000 });
  assert.equal(reading.visible, true);
  assert.equal(reading.mood, "looking", "first presence is reading, not dots");
  assert.equal(reading.kind, "read");
  assert.notEqual(reading.mood, "typing");

  const hold = presenceOf({
    sending: true,
    working: true,
    activity: "Searching",
    since: 1000,
    now: 1000 + READ_HOLD_MS - 20,
  });
  assert.equal(hold.mood, "looking", "hold looking while the message is being read");
  assert.equal(hold.kind, "read");

  const afterHold = presenceOf({
    sending: true,
    working: true,
    activity: "Searching",
    since: 1000,
    now: 1000 + READ_HOLD_MS + 20,
  });
  assert.equal(afterHold.mood, "spin");

  const lookingAct = presenceOf({ working: true, activity: "Reading", now: 5000, since: 1 });
  assert.equal(lookingAct.mood, "looking");

  // Writing IS dots now. The face tells you nothing while a reply is being
  // composed; three dots is the one gesture everyone already reads as "words
  // are coming", and UmbraFace morphs the body into them.
  const writing = presenceOf({ working: true, activity: "Writing", now: 5000, since: 1 });
  assert.equal(writing.mood, "typing", "writing becomes dots");

  const spin = presenceOf({ working: true, activity: "Searching", now: 5000, since: 1 });
  assert.equal(spin.mood, "spin");

  const workingBare = presenceOf({ working: true, now: 5000, since: 1 });
  assert.equal(workingBare.mood, "spin");

  const now = 10_000;
  const tooSoon = presenceOf({
    draft: "h",
    lastKeyAt: now - 40,
    composeAt: now - 40,
    now,
  });
  assert.equal(tooSoon.visible, false, "join waits a beat so a stray key does not flash");

  const join = presenceOf({
    draft: "hello",
    lastKeyAt: now - USER_JOIN_MS - 40,
    composeAt: now - USER_JOIN_MS - 40,
    now,
  });
  assert.equal(join.visible, true);
  assert.equal(join.mood, "fidget", "waiting companion looks around, not typing dots");
  assert.equal(join.kind, "wait");

  const fading = presenceOf({
    draft: "hello",
    lastKeyAt: now - USER_IDLE_MS - 40,
    composeAt: now - 8000,
    now,
  });
  assert.equal(fading.visible, true, "leave fades instead of snapping off");
  assert.equal(fading.phase, "out");

  const leave = presenceOf({
    draft: "hello",
    lastKeyAt: now - USER_IDLE_MS - USER_LEAVE_MS - 50,
    composeAt: now - 9000,
    now,
  });
  assert.equal(leave.visible, false, "gone after idle + fade");

  const emptyDraft = presenceOf({ draft: "   ", lastKeyAt: now, now });
  assert.equal(emptyDraft.visible, false);

  const wait = composerExtrasForMember("a1", "a1", {
    draft: "hello channel",
    lastKeyAt: now - USER_JOIN_MS - 80,
    composeAt: now - USER_JOIN_MS - 80,
    now,
    sending: false,
    linger: false,
  });
  const waitP = presenceOf(wait);
  assert.equal(waitP.visible, true, "channel wait face joins on composer draft");
  assert.equal(waitP.mood, "fidget");

  const teammate = composerExtrasForMember("a2", "a1", {
    draft: "hello channel",
    lastKeyAt: now - 400,
    composeAt: now - 400,
    now,
    sending: false,
    linger: false,
  });
  assert.equal(presenceOf(teammate).visible, false, "other members do not join the wait");

  const waitLeave = composerExtrasForMember("a1", "a1", {
    draft: "hello channel",
    lastKeyAt: now - USER_IDLE_MS - USER_LEAVE_MS - 50,
    composeAt: now - 9000,
    now,
  });
  assert.equal(presenceOf(waitLeave).visible, false, "channel wait leaves after idle");

  // ---- the online pip is a claim, and it has to be earned ----------------
  const { pipOf, LINGER_MS } = mod;
  const T = 1_000_000;
  assert.equal(pipOf(null), null);
  assert.equal(pipOf({}), null, "a bot that never took a turn is not online");
  assert.equal(pipOf({ workingIn: "b1" }), "work", "a running turn is working");
  // Online means WORKING. Not "recently worked", not "has a warm child": a
  // time-based window expires at a moment unrelated to anything the user did,
  // so the pip appeared to vanish at random.
  assert.equal(
    pipOf({ activeAt: new Date(T - 1000).toISOString() }),
    null,
    "idle is idle, however recently it finished"
  );
  assert.equal(pipOf({ status: "working" }), null, "global status is not per-conversation truth");
  assert.equal(pipOf({ workingIn: "c1", activeAt: new Date(0).toISOString() }), "work");
  // Nothing about it may depend on the clock, or it changes under a user who
  // did not do anything.
  assert.equal(pipOf({ workingIn: "b1" }), pipOf({ workingIn: "b1" }));

  // The sidebar must not draw a pip unconditionally, which is what it did.
  const sb = fs.readFileSync(path.join(ROOT, "src/screens/Sidebar.jsx"), "utf8");
  assert.ok(sb.includes("pipOf"), "roster asks pipOf");
  assert.ok(/\{!isChannel && pip \?/.test(sb), "pip is conditional on pipOf");
  assert.ok(sb.includes("sand-row__unread"), "unread badge is rendered");
  const rail = stripComments(fs.readFileSync(path.join(ROOT, "src/screens/BotRail.jsx"), "utf8"));
  assert.ok(rail.includes("pipOf"), "the rail's pip is honest too");
  assert.ok(!/className="sand-row__dot bot-rail__online"/.test(rail), "no unconditional rail pip");

  // He must not leave the second you stop typing.
  assert.ok(USER_IDLE_MS >= 20000, `a paused draft holds him: ${USER_IDLE_MS}ms`);
  assert.ok(LINGER_MS >= 6000, `he lingers after his own turn: ${LINGER_MS}ms`);

  const tx = stripComments(fs.readFileSync(path.join(ROOT, "src/screens/Transcript.jsx"), "utf8"));
  assert.ok(tx.includes("presenceOf"));
  assert.ok(tx.includes("composerExtrasForMember"));
  assert.ok(tx.includes("mood={presence.mood}"));
  assert.ok(tx.includes("data-phase"));
  assert.ok(!tx.includes('mood="typing"'));
  assert.ok(!tx.includes("Typing..."));
  assert.ok(tx.includes("live"));
  assert.ok(tx.includes("morph"));
  assert.ok(
    !/workingRow\([^)]*draft:\s*""/.test(tx),
    "channel rows must not hard-zero the composer draft"
  );

  const uf = fs.readFileSync(path.join(ROOT, "src/umbra/UmbraFace.jsx"), "utf8");
  assert.ok(uf.includes("looking:"));
  assert.ok(uf.includes("fidget:"));
  assert.ok(uf.includes('"scan"'));

  // ---- the read hold scales with what there is to read -------------------
  // Flat, this was the most mechanical thing left: "hi" and a four-hundred
  // word brief were absorbed in exactly the same beat.
  const { readHoldFor, READ_HOLD_MAX_MS } = mod;
  assert.equal(readHoldFor(0), READ_HOLD_MS, "nothing to read is the floor");
  assert.ok(readHoldFor(3) > READ_HOLD_MS, '"hi" still takes a beat');
  assert.ok(readHoldFor(400) > readHoldFor(40), "more text, longer look");
  assert.ok(readHoldFor(40) > readHoldFor(4));
  // Sub-linear, or a pasted stack trace would be stared at for half a minute.
  assert.ok(readHoldFor(4000) < readHoldFor(40) * 10, "attention does not scale with length");
  assert.ok(readHoldFor(10_000) <= READ_HOLD_MAX_MS, "and it saturates");
  for (const junk of [null, undefined, -5, NaN, "abc", {}]) {
    const v = readHoldFor(junk);
    assert.ok(v >= READ_HOLD_MS && v <= READ_HOLD_MAX_MS, `junk gives a sane hold: ${v}`);
  }
  // A longer message really does hold the reading face past where a short one
  // would have moved on.
  const long = presenceOf({
    sending: true, working: true, activity: "Searching",
    since: 1000, now: 1000 + READ_HOLD_MS + 200, readMs: readHoldFor(600),
  });
  assert.equal(long.mood, "looking", "still reading the long one");
  assert.equal(long.kind, "read");

  const tx2 = fs.readFileSync(path.join(ROOT, "src/screens/Transcript.jsx"), "utf8");
  assert.ok(tx2.includes("readHoldFor(lastUserChars)"), "the transcript actually measures it");

  console.log("presence-test ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
