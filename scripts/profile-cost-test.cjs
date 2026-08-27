#!/usr/bin/env node
'use strict';

/**
 * profile-cost-test.cjs — the tool-profile cost table, and the one mechanism
 * that makes a small profile safe: auto-climb.
 *
 * Why this file exists. On a local model the tool schema is not a line item,
 * it is the wait: `builder` ships 29 tool schemas = 3,338 prompt tokens, and
 * reading them cost 9.4s before a single output token against the user's own
 * endpoint (docs/LOCAL-MODEL.md). Everything asserted here is either that
 * measurement, or a byte count taken from Hermes' own
 * `model_tools.get_tool_definitions()` and scaled through it.
 *
 * The invariant the user actually asked for is NO LOST CAPABILITY. That is not
 * "the profiles are small" — it is:
 *
 *   1. the ladder only ever adds tools going up, so climbing can never be a
 *      sideways trade, and
 *   2. the climb REALLY FIRES on a real turn — asserted by driving the store's
 *      Hermes path against a stub gateway and reading the profile the store
 *      actually handed to `session.create`, not by grepping the source for a
 *      function name. A capability that looks wired and silently does nothing
 *      is this codebase's signature bug.
 *
 * Usage: node scripts/profile-cost-test.cjs   (exit 0 on success)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const gateway = require('../electron/hermes-gateway.cjs');
const { LADDER, pickProfile } = require('../electron/auto-profile.cjs');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  [FAIL] ${name}\n         ${err.message}`);
  }
}

async function main() {
  // ── the measured table ────────────────────────────────────────────────
  await test('every profile carries a measured tool-schema size', () => {
    for (const name of Object.keys(gateway.TOOL_PROFILES)) {
      assert.ok(
        gateway.PROFILE_TOOL_CHARS[name] > 0,
        `${name} has no measured schema size — measure it before shipping it`
      );
      assert.ok(gateway.profileToolTokens(name) > 0, `${name} has no token figure`);
      assert.ok(gateway.profileColdSeconds(name) > 0, `${name} has no cold-start figure`);
    }
  });

  await test('the anchor is the real endpoint measurement: builder = 3,338 tokens / 9.4s', () => {
    // These two numbers are the ONLY ones measured against the model itself
    // (docs/LOCAL-MODEL.md, "What actually costs the time: prefill"). Every
    // other row is derived from them, so if this drifts the whole table is
    // reasoning rather than measurement and the comment above it is a lie.
    assert.equal(gateway.profileToolTokens('builder'), 3338);
    assert.equal(gateway.profileColdSeconds('builder'), 9.4);
  });

  await test('the cheap rung really is cheap: chat is under 1.5s of cold start', () => {
    // 399 tokens vs builder's 3,338. This is the whole point of defaulting a
    // local teammate to `chat`: 1.1s of silence instead of 9.4s.
    assert.ok(
      gateway.profileColdSeconds('chat') <= 1.5,
      `chat costs ${gateway.profileColdSeconds('chat')}s`
    );
    assert.ok(gateway.profileToolTokens('chat') < 500);
  });

  await test('cost rises monotonically along the auto ladder', () => {
    // A rung that costs less than the one below it means the ladder is not a
    // ladder, and "escalate only" stops being a cost story.
    for (let i = 1; i < LADDER.length; i++) {
      const lo = gateway.profileToolTokens(LADDER[i - 1]);
      const hi = gateway.profileToolTokens(LADDER[i]);
      assert.ok(hi > lo, `${LADDER[i]} (${hi}) must cost more than ${LADDER[i - 1]} (${lo})`);
    }
  });

  // ── no lost capability ────────────────────────────────────────────────
  await test('climbing only ADDS toolsets — every rung is a superset of the one below', () => {
    // This is the no-lost-capability invariant in its literal form. If a
    // higher rung ever dropped a toolset, an escalating bot would silently
    // lose a tool mid-conversation, which is exactly what auto-profile.cjs's
    // rule 1 exists to prevent.
    for (let i = 1; i < LADDER.length; i++) {
      const lower = new Set(gateway.TOOL_PROFILES[LADDER[i - 1]]);
      const upper = new Set(gateway.TOOL_PROFILES[LADDER[i]]);
      for (const t of lower) {
        assert.ok(upper.has(t), `${LADDER[i]} drops "${t}" that ${LADDER[i - 1]} had`);
      }
    }
  });

  await test('the ladder tops out at the richest named profile, so nothing is unreachable by climbing', () => {
    const top = LADDER[LADDER.length - 1];
    const builder = new Set(gateway.TOOL_PROFILES[top]);
    for (const [name, list] of Object.entries(gateway.TOOL_PROFILES)) {
      if (name === 'full' || !Array.isArray(list)) continue; // `full` is Hermes' own resolution
      for (const t of list) {
        assert.ok(builder.has(t), `"${t}" (in ${name}) is not reachable by climbing to ${top}`);
      }
    }
  });

  await test('pinFor turns the cheap profile into a genuinely small pin', () => {
    // A real call, not a shape check: the pin string is what becomes
    // HERMES_TUI_TOOLSETS, and it is the only thing that decides how many
    // schemas the model reads.
    const cheap = gateway.pinFor({ profile: 'chat' });
    const rich = gateway.pinFor({ profile: 'builder' });
    assert.equal(cheap, 'clarify,memory,todo');
    assert.ok(rich.split(',').length > cheap.split(',').length);
    // And extras still ADD, so a pinned cheap bot with an extra toolset is not
    // capped by the profile.
    assert.ok(gateway.pinFor({ profile: 'chat', extraToolsets: ['web'] }).includes('web'));
  });

  // ── auto-climb, for real ──────────────────────────────────────────────
  await test('a real turn climbs, and the store hands the climbed profile to session.create', async () => {
    // Drive the actual store path (streamThroughHermes), with the gateway
    // module replaced in require.cache. Nothing is grepped: the assertion is
    // on the `profile` the store passed to `sessionFor`.
    const gwPath = require.resolve('../electron/hermes-gateway.cjs');
    const realGw = require.cache[gwPath];
    const seen = [];
    const stub = {
      exports: {
        available: () => true,
        hasSession: () => false,
        paceFor: () => ({ local: false, reasoningHonoured: true }),
        fastLaneFor: () => '',
        pinFor: gateway.pinFor,
        TOOL_PROFILES: gateway.TOOL_PROFILES,
        // BOTH, because the second turn of a bot with a stored session id
        // goes through `resume`, not `sessionFor` — and the profile rides on
        // the same opts either way. Watching only one of them would have made
        // this test pass while asserting nothing about the climbed turn.
        sessionFor: async (id, opts) => {
          seen.push(opts.profile);
          return { id: 'sess-1' };
        },
        resume: async (id, sid, opts) => {
          seen.push(opts.profile);
          return { id: 'sess-1' };
        },
        storedSessionIdOf: () => 'sess-1',
        history: async () => ({ messages: [] }),
        compressIfNeeded: async () => ({ compressed: false }),
        submit: async () => ({ text: 'done' }),
        usage: async () => ({}),
        setTitle: () => {},
        close: () => {},
      },
      loaded: true,
      id: gwPath,
      filename: gwPath,
      paths: [],
    };
    require.cache[gwPath] = stub;
    try {
      const { createStore } = require('../electron/store.cjs');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydo-profile-cost-'));
      const store = createStore({ dir });
      store.createAgent();
      const id = store.getState().selectedId;
      store.setAgent(id, { name: 'Local' });

      const born = store.getState().agents.find((a) => a.id === id);
      assert.equal(born.toolProfile, 'chat', 'a new teammate starts on the cheap rung');

      await store.send('hey');
      assert.equal(seen[seen.length - 1], 'chat', 'small talk must stay on chat');
      assert.equal(
        store.getState().agents.find((a) => a.id === id).toolProfile,
        'chat'
      );

      await store.send('run the tests and commit the result');
      assert.equal(
        seen[seen.length - 1],
        'builder',
        `a shell turn must climb; the store sent "${seen[seen.length - 1]}"`
      );
      assert.equal(
        store.getState().agents.find((a) => a.id === id).toolProfile,
        'builder',
        'and the climb is persisted, so the next turn does not re-discover it'
      );
    } finally {
      if (realGw) require.cache[gwPath] = realGw;
      else delete require.cache[gwPath];
      delete require.cache[require.resolve('../electron/store.cjs')];
    }
  });

  await test('a hand-pinned teammate is never overridden by the climb', () => {
    // The user's choice is the one thing auto may not touch — the constraint
    // is that a speed/capability trade is the USER's, never a silent default.
    assert.equal(pickProfile('run the tests', 'chat', { pinned: true }), 'chat');
  });

  // ── the price is visible ──────────────────────────────────────────────
  await test('toolProfiles() ships the cold-start seconds to the picker', () => {
    const rows = gateway.toolProfiles();
    const builder = rows.find((r) => r.name === 'builder');
    assert.equal(builder.coldSeconds, 9.4);
    assert.equal(builder.toolTokens, 3338);
    for (const r of rows) assert.ok(r.coldSeconds > 0, `${r.name} has no coldSeconds`);
  });

  await test('BotRail shows seconds only when the teammate is on local hardware', () => {
    const rail = fs.readFileSync(path.join(ROOT, 'src', 'screens', 'BotRail.jsx'), 'utf8');
    assert.ok(rail.includes('coldSeconds'), 'the rail reads coldSeconds');
    assert.ok(rail.includes('coldLabel'), 'and renders it as seconds');
    assert.ok(rail.includes('setOnLocal'), 'and decides whether the bot is local');
    assert.ok(rail.includes('localProviders'), 'from the same source Settings uses');
    // Guarded, not unconditional: a hosted bot must keep the token figure,
    // because prefill is not what a hosted user waits on.
    assert.ok(/onLocal &&/.test(rail), 'the seconds are gated on onLocal');
    // The fallback table (used before the IPC answers) must not invent
    // numbers that disagree with the measured ones.
    assert.ok(rail.includes('coldSeconds: 9.4'), 'the fallback carries the measured builder figure');
    assert.ok(rail.includes('coldSeconds: 1.1'), 'and the measured chat figure');
  });
}

main().then(() => {
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.error(`FAILED: ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('profile-cost-test ok');
});
