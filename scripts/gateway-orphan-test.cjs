#!/usr/bin/env node
"use strict";

/**
 * gateway-orphan-test.cjs — what happens to the PYTHON side when this process
 * gives up, or changes its mind.
 *
 * Two defects, both invisible from inside Hydo because both leave the app
 * looking fine:
 *
 *   1. A timed-out request rejected locally while the child kept working on
 *      it. For `session.create` the late reply carried a session id nothing in
 *      this process had ever seen, so that session was never closed -- one
 *      leaked live session per timed-out create, accumulating for as long as
 *      the app ran.
 *
 *   2. `sessionFor` closed the session it was replacing with
 *      `close(botId).catch(() => {})` -- fired and dropped -- then issued
 *      `session.create` immediately behind it. The create raced the close over
 *      the same child. And on a MODEL change (as opposed to a profile change)
 *      control fell through a missing `else` and called `close` a second time,
 *      logging `moving profile "x" -> "x"` for a profile that had not moved.
 *
 * This runs against a REAL child process over REAL stdio -- scripts/fixtures/
 * fake-gateway.cjs speaks the same newline-delimited JSON-RPC -- because both
 * bugs are about ordering between two processes, which a mocked transport
 * cannot demonstrate. It needs no Hermes install.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FIXTURES = path.join(__dirname, "fixtures");
const RUN = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-orphan-"));
const TRACE = path.join(RUN, "trace.jsonl");
const CWD = path.join(RUN, "workspace");
fs.mkdirSync(CWD, { recursive: true });

process.env.HERMES_PYTHON = path.join(FIXTURES, "fake-python");
process.env.FAKE_TRACE = TRACE;
const RESUME_FAIL_FLAG = path.join(RUN, "resume-fails");
process.env.FAKE_RESUME_FAIL_FLAG = RESUME_FAIL_FLAG;
// Short enough that the abandoned-reply path runs in a test, long enough that
// the fixture's fast replies are never accidentally late.
process.env.HYDO_GATEWAY_RPC_TIMEOUT_MS = "600";
process.env.FAKE_SLOW_CREATE_MS = "1500";
// The close is answered slowly so "did the create wait for it?" is a real
// question with an observable answer.
process.env.FAKE_SLOW_CLOSE_MS = "400";

const gateway = require("../electron/hermes-gateway.cjs");

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = () =>
  fs.existsSync(TRACE)
    ? fs
        .readFileSync(TRACE, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

(async () => {
  console.log("gateway-orphan-test");

  // ── 1. a create that times out must not leak its session ────────────────
  await test("a timed-out session.create is reaped when its late reply lands", async () => {
    await assert.rejects(
      gateway.sessionFor("orphan-bot", { cwd: CWD, model: "m1", provider: "p1" }),
      /timeout/,
      "the slow create should have timed out locally"
    );
    // The child answers at 1500ms; the reaper closes it when that reply lands.
    await sleep(2500);
    const created = rows().filter((r) => r.method === "session.create");
    const closed = rows().filter((r) => r.method === "session.close");
    assert.ok(created.length >= 1, "the child never received a create");
    const leaked = created[0].session_id;
    assert.ok(
      closed.some((c) => c.session_id === leaked),
      `session ${leaked} was created and never closed — it is orphaned on the child`
    );
  });

  fs.writeFileSync(TRACE, "");
  process.env.FAKE_SLOW_CREATE_MS = "0";

  // ── 2. the replacement must not race the close ──────────────────────────
  await test("changing model closes the old session BEFORE creating the new one", async () => {
    const a = await gateway.sessionFor("swap-bot", { cwd: CWD, model: "m1", provider: "p1" });
    assert.ok(a && a.sessionId, "no first session");
    fs.writeFileSync(TRACE, "");
    const b = await gateway.sessionFor("swap-bot", { cwd: CWD, model: "m2", provider: "p1" });
    assert.ok(b && b.sessionId, "no second session");
    assert.notEqual(b.sessionId, a.sessionId, "the session was reused across a model change");

    // The close is answered SLOWLY on purpose. Asserting only that the close
    // was ISSUED before the create would pass against the broken code too --
    // the old code issued the close and then immediately issued the create
    // without waiting for it. What matters is that the create lands after the
    // close has been ANSWERED, which is what `session.close.done` marks.
    const seen = rows();
    const doneAt = seen.findIndex((r) => r.method === "session.close.done");
    const createAt = seen.findIndex((r) => r.method === "session.create");
    assert.ok(seen.some((r) => r.method === "session.close"), "the old session was never closed");
    assert.ok(createAt >= 0, "no replacement session was created");
    assert.ok(doneAt >= 0, "the close was never answered");
    assert.ok(
      doneAt < createAt,
      "session.create was issued while the close of the session it replaces was still in flight"
    );
  });

  await test("a model change closes the old session exactly once", async () => {
    await gateway.sessionFor("once-bot", { cwd: CWD, model: "m1", provider: "p1" });
    fs.writeFileSync(TRACE, "");
    await gateway.sessionFor("once-bot", { cwd: CWD, model: "m2", provider: "p1" });
    const closes = rows().filter((r) => r.method === "session.close");
    assert.equal(
      closes.length,
      1,
      `close was issued ${closes.length} times for one model change (the missing else)`
    );
  });

  await test("an unchanged model reuses the session and closes nothing", async () => {
    const a = await gateway.sessionFor("stay-bot", { cwd: CWD, model: "m1", provider: "p1" });
    fs.writeFileSync(TRACE, "");
    const b = await gateway.sessionFor("stay-bot", { cwd: CWD, model: "m1", provider: "p1" });
    assert.equal(b.sessionId, a.sessionId, "an identical request rebuilt the session");
    assert.equal(rows().length, 0, "an identical request talked to the child at all");
  });

  // ── 3. a tool upgrade must not erase the conversation ───────────────────
  await test("changing TOOLS resumes the stored session instead of starting fresh", async () => {
    const a = await gateway.sessionFor("tools-bot", {
      cwd: CWD,
      model: "m1",
      provider: "p1",
      profile: "builder",
    });
    assert.ok(a.storedSessionId, "no stored session id to resume from");
    fs.writeFileSync(TRACE, "");
    const b = await gateway.sessionFor("tools-bot", {
      cwd: CWD,
      model: "m1",
      provider: "p1",
      profile: "full",
    });
    const seen = rows();
    const resumed = seen.find((r) => r.method === "session.resume");
    assert.ok(resumed, "a tool change started a brand-new session, erasing the transcript");
    assert.equal(resumed.session_id, a.storedSessionId, "resumed the wrong session");
    assert.ok(
      !seen.some((r) => r.method === "session.create"),
      "a session was created as well as resumed"
    );
    assert.equal(b.storedSessionId, a.storedSessionId, "the stored id did not survive the move");
  });

  await test("a failed resume falls back to a fresh session rather than no session", async () => {
    fs.writeFileSync(RESUME_FAIL_FLAG, "1");
    try {
      const a = await gateway.sessionFor("badresume-bot", {
        cwd: CWD,
        model: "m1",
        provider: "p1",
        profile: "builder",
      });
      fs.writeFileSync(TRACE, "");
      const b = await gateway.sessionFor("badresume-bot", {
        cwd: CWD,
        model: "m1",
        provider: "p1",
        profile: "full",
      });
      assert.ok(b && b.sessionId, "a failed resume left the teammate with no session at all");
      assert.notEqual(b.sessionId, a.sessionId);
      const seen = rows();
      assert.ok(seen.some((r) => r.method === "session.resume"), "resume was never attempted");
      assert.ok(seen.some((r) => r.method === "session.create"), "no fresh session was built");
    } finally {
      fs.rmSync(RESUME_FAIL_FLAG, { force: true });
    }
  });

  await test("a MODEL change still creates fresh — Hermes binds model at create", async () => {
    // Not a shortcoming of this code: `session.resume`, `session.branch` and
    // `prompt.submit` all take no model, so history genuinely cannot follow a
    // model change. Asserted so nobody "fixes" it into a resume that would
    // silently keep running the OLD model.
    await gateway.sessionFor("modelswap-bot", { cwd: CWD, model: "m1", provider: "p1" });
    fs.writeFileSync(TRACE, "");
    await gateway.sessionFor("modelswap-bot", { cwd: CWD, model: "m2", provider: "p1" });
    const seen = rows();
    assert.ok(seen.some((r) => r.method === "session.create"), "no new session for the new model");
    assert.ok(
      !seen.some((r) => r.method === "session.resume"),
      "a model change resumed a session pinned to the previous model"
    );
  });

  // ── 4. background jobs must not overwrite each other ────────────────────
  await test("a second background job is refused rather than orphaning the first", async () => {
    const bot = "bg-bot";
    await gateway.sessionFor(bot, { cwd: CWD, model: "m1", provider: "p1" });
    let firstDone = null;
    const first = gateway
      .submit(bot, "job one", { onComplete: (o) => (firstDone = o) }, { background: true })
      .catch((e) => ({ error: e.message }));
    // Let the yield happen so `bot.bg` is actually occupied.
    await sleep(120);
    await assert.rejects(
      gateway.submit(bot, "job two", {}, { background: true }),
      /already has a background job/,
      "a second background job was accepted, overwriting the first"
    );
    const out = await first;
    assert.ok(!out.error, `the first job did not finish cleanly: ${out.error}`);
    assert.match(out.text, /job one/, "the first job resolved with someone else's result");
    assert.ok(firstDone, "the first job's own completion handler never ran");
  });

  await test("a foreground turn is still allowed while a background job runs", async () => {
    const bot = "bg-fg-bot";
    await gateway.sessionFor(bot, { cwd: CWD, model: "m1", provider: "p1" });
    const bg = gateway.submit(bot, "slow job", {}, { background: true }).catch((e) => ({ error: e.message }));
    await sleep(120);
    const fg = await gateway.submit(bot, "quick question", {});
    assert.match(fg.text, /quick question/, "the foreground turn got the wrong answer");
    const done = await bg;
    assert.ok(!done.error, `the background job was disturbed: ${done.error}`);
  });

  await gateway.shutdown().catch(() => {});

  if (failed) {
    console.log(`gateway-orphan-test FAILED (${failed})`);
    process.exit(1);
  }
  console.log("gateway-orphan-test ok — no orphaned sessions, no create/close race");
  process.exit(0);
})();
