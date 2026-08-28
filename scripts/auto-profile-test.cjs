#!/usr/bin/env node
"use strict";

/**
 * auto-profile-test.cjs — the rung a turn runs on.
 *
 * `chat` has no files, no web and no shell; only `builder` carries `web` and
 * `computer_use`. So the picker decides whether a teammate can actually do the
 * thing, and getting it wrong is invisible: the turn succeeds, the model just
 * explains why it cannot help.
 *
 * MEASURED, and the reason this file exists: "I need you to chase Revolut's
 * business support chat about a dispute I've been waiting on for over a
 * month..." picked `chat`. A plainly real job ran on the no-tools rung, and
 * the reply was a wall of markdown about which panel to change. Two gaps: the
 * task shape did not include "I need you to", and nothing in the ladder
 * recognised "act on a live service on my behalf" — NEEDS_BUILDER is about
 * code and shells, and chasing someone's support chat is neither.
 *
 * The other half matters just as much: small talk must STAY on `chat`.
 * Escalating "ikr" to builder pays 16.6k of tool schema to say "yeah".
 */

const assert = require("node:assert/strict");
const ap = require("../electron/auto-profile.cjs");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}

const pick = (msg, cur = "chat") => ap.pickProfile(msg, cur, {});

test("acting on a live service reaches the rung that can", () => {
  const jobs = [
    "I need you to chase Revolut's business support chat about a dispute I've been waiting on for over a month.",
    "reply to that email for me",
    "follow up with their support team",
    "can you cancel my subscription",
    "log in to the portal and check the invoice",
    "chase up the refund",
  ];
  for (const j of jobs) {
    assert.equal(pick(j), "builder", `"${j.slice(0, 40)}..." ran on a rung with no browser`);
  }
});

test('"I need you to X" is a task, not conversation', () => {
  assert.notEqual(pick("I need you to write that up"), "chat");
  assert.notEqual(pick("i want you to draft the reply"), "chat");
  assert.notEqual(pick("I'd like you to look through the folder"), "chat");
});

test("small talk stays cheap", () => {
  // Every one of these on `builder` would pay ~16.6k of tool schema to say
  // almost nothing. This is the half that pays for the feature.
  for (const chat of [
    "ikr",
    "hey how are you",
    "nate what do u wanna do",
    "damm",
    "yeah lol",
    "such a thunderstorm here rn",
  ]) {
    assert.equal(pick(chat), "chat", `"${chat}" escalated for no reason`);
  }
});

test("the ladder only ever climbs", () => {
  // A bot that reached `builder` must not silently drop back to `chat` on the
  // next small-talk turn and lose the tools mid-job.
  assert.equal(pick("ikr", "builder"), "builder");
  assert.equal(pick("thanks", "researcher"), "researcher");
});

test("a hand-picked profile is never overridden", () => {
  assert.equal(ap.pickProfile("ikr", "builder", { pinned: true }), "builder");
  assert.equal(ap.pickProfile("chase their support chat", "chat", { pinned: true }), "chat");
});

if (failed) {
  console.log(`auto-profile-test FAILED (${failed})`);
  process.exit(1);
}
console.log("auto-profile-test ok — real jobs get tools, small talk stays cheap");
