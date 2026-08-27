#!/usr/bin/env node
'use strict';

/**
 * store-durability-test.cjs — a teammate must never be lost.
 *
 * quit-safety-test.cjs covers the ORIGINAL bug: a kill inside `writeFileSync`
 * left a truncated state.json, `JSON.parse` threw, and the loader answered by
 * seeding an empty roster and saving it over the damaged bytes. This file is
 * the rest of that family, all of it measured against the real store rather
 * than reasoned about:
 *
 *  - truncation at 10/50/90/99%, a zeroed middle, invalid UTF-8, empty file;
 *  - VALID JSON of the wrong shape — `null`, `[]`, agents as an object,
 *    agents missing, agents null. Measured before the fix: every one of these
 *    parsed, fell through `normalizeState` as a fresh seed, and was WRITTEN
 *    BACK over a full roster. Same total wipe as the truncation bug, reached
 *    without a single crash. It is also what a downgrade looks like.
 *  - schema drift in both directions: an old file meeting new code, and a
 *    file from the future meeting this code.
 *
 * The two invariants every case is held to:
 *   1. the roster comes back;
 *   2. a file this code could not read is NEVER overwritten — it is moved to
 *      `state.json.corrupt-<ts>` so a person can still get their bots back.
 *
 * Everything runs in a fresh mkdtemp dir. Nothing here goes near
 * ~/Library/Application Support/hydo.
 *
 * Usage: node scripts/store-durability-test.cjs   (exit 0 on success)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../electron/store.cjs');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  [FAIL] ${name}\n         ${err.message}`);
  }
}

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `hydo-${tag}-`));
}

/** Three teammates on disk, then whatever damage the case wants. */
function seeded(tag) {
  const dir = tmpDir(tag);
  const store = createStore({ dir });
  store.signIn();
  store.createAgent({ name: 'Ada' });
  store.createAgent({ name: 'Bo' });
  store.createAgent({ name: 'Cy' });
  store.flush();
  return { dir, file: path.join(dir, 'state.json') };
}

const ROSTER = ['Ada', 'Bo', 'Cy'];

/**
 * Damage state.json, reopen, and hold the result to both invariants.
 *
 * `expect` is how much of the roster must come back: 'all' when a complete
 * copy still exists somewhere, 'some' when the case deliberately removes the
 * newest backup too.
 */
function survives(name, damage, { expect = 'all', dropBackups = [] } = {}) {
  test(name, () => {
    const { dir, file } = seeded('dur');
    for (const suffix of dropBackups) {
      try {
        fs.unlinkSync(`${file}${suffix}`);
      } catch {
        /* not there is fine */
      }
    }
    damage(file);
    const damaged = fs.readFileSync(file);

    const names = createStore({ dir }).getState().agents.map((a) => a.name).sort();

    if (expect === 'all') {
      assert.deepEqual(names, ROSTER, `roster did not come back intact: ${JSON.stringify(names)}`);
    } else {
      assert.ok(names.length > 0, 'the roster came back EMPTY — this is the data-loss bug');
    }

    // Invariant 2: the damaged bytes are still on disk somewhere.
    const kept = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('state.json.corrupt-'))
      .map((f) => fs.readFileSync(path.join(dir, f)));
    assert.ok(
      kept.some((b) => b.equals(damaged)),
      'the damaged file was overwritten instead of being preserved'
    );

    // And the recovery is on disk, not only in memory.
    const back = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(back.agents.length > 0, 'the recovered roster was never written back');
  });
}

// ── 1. torn and corrupted bytes ──────────────────────────────────────────

const truncate = (frac) => (file) => {
  const b = fs.readFileSync(file);
  fs.writeFileSync(file, b.slice(0, Math.floor(b.length * frac)));
};

for (const frac of [0.1, 0.5, 0.9, 0.99]) {
  survives(`truncated to ${frac * 100}% recovers the roster`, truncate(frac));
}

survives('an empty state.json recovers the roster', (file) => fs.writeFileSync(file, ''));

survives('invalid UTF-8 recovers the roster', (file) =>
  fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x80]))
);

survives('a zeroed block in the middle recovers the roster', (file) => {
  const b = fs.readFileSync(file);
  b.fill(0x00, Math.floor(b.length / 2), Math.floor(b.length / 2) + 400);
  fs.writeFileSync(file, b);
});

// Two bad writes in a row is what a crash loop on launch looks like. One
// `.bak` cannot survive it; this is why `.bak2` exists.
survives(
  'a second bad write in a row still recovers a roster',
  (file) => fs.writeFileSync(file, '{"agents":[{"nam'),
  { expect: 'some', dropBackups: ['.bak'] }
);

// ── 2. valid JSON, wrong shape ───────────────────────────────────────────
//
// Every one of these used to come back with ZERO teammates AND overwrite the
// file. They parse, so the old `JSON.parse`-only gate let them through.

survives('a file holding `null` recovers the roster', (file) => fs.writeFileSync(file, 'null'));

survives('a file holding `[]` recovers the roster', (file) => fs.writeFileSync(file, '[]'));

const reshape = (mutate) => (file) => {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(raw);
  fs.writeFileSync(file, JSON.stringify(raw));
};

survives(
  'agents stored as an OBJECT recovers the roster',
  reshape((raw) => {
    raw.agents = Object.fromEntries(raw.agents.map((a) => [a.id, a]));
  })
);

survives(
  'a missing `agents` key recovers the roster',
  reshape((raw) => {
    delete raw.agents;
  })
);

survives(
  'a null `agents` key recovers the roster',
  reshape((raw) => {
    raw.agents = null;
  })
);

// ── 3. schema drift, both directions ─────────────────────────────────────

test('a file from a NEWER build loads without losing siblings', () => {
  const { dir, file } = seeded('dur-fwd');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // What an "update agents" release looks like from an older build's side:
  // fields it has never heard of, on the state and on every teammate.
  raw.schemaVersion = 99;
  raw.somethingFromTheFuture = { deep: [1, 2, 3] };
  for (const a of raw.agents) a.futureField = { mode: 'unknown' };
  fs.writeFileSync(file, JSON.stringify(raw));

  const state = createStore({ dir }).getState();
  assert.deepEqual(state.agents.map((a) => a.name).sort(), ROSTER, 'unknown fields cost a teammate');
  // A field this build cannot interpret must still be on disk for the build
  // that can — a downgrade is not allowed to be a data-loss event.
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.somethingFromTheFuture.deep.length, 3, 'an unknown state field was dropped');
  assert.ok(
    after.agents.every((a) => a.futureField && a.futureField.mode === 'unknown'),
    'an unknown per-teammate field was dropped'
  );
});

test('a file from an OLDER build loads without wiping siblings', () => {
  const { dir, file } = seeded('dur-back');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Strip everything this build added since. An old record is little more
  // than an id and a name.
  raw.agents = raw.agents.map((a) => ({ id: a.id, name: a.name }));
  delete raw.settings;
  delete raw.routines;
  delete raw.sections;
  delete raw.artifacts;
  delete raw.log;
  fs.writeFileSync(file, JSON.stringify(raw));

  const state = createStore({ dir }).getState();
  assert.deepEqual(state.agents.map((a) => a.name).sort(), ROSTER, 'an old file lost a teammate');
  // Missing keys are filled in, not treated as a reason to start over.
  assert.ok(state.settings && typeof state.settings === 'object', 'settings were not rebuilt');
  assert.ok(state.agents.every((a) => a.status === 'idle'), 'defaults were not applied to old records');
  assert.ok(
    state.agents.every((a) => Array.isArray(state.routines[a.id])),
    'routines were not rebuilt per teammate'
  );
});

test('a null agent entry does not take the rest of the roster with it', () => {
  const { dir, file } = seeded('dur-null');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.agents.splice(1, 0, null);
  raw.settings = null;
  fs.writeFileSync(file, JSON.stringify(raw));

  const names = createStore({ dir }).getState().agents.map((a) => a.name).sort();
  assert.deepEqual(names, ROSTER, `one bad row emptied the roster: ${JSON.stringify(names)}`);
});

// ── 4. the write itself ──────────────────────────────────────────────────

test('every write leaves a COMPLETE backup, not the previous generation', () => {
  // The backup used to be a copy of the OUTGOING state.json, so recovering
  // from a crash lost whichever teammate had just been created — and if
  // state.json was already damaged, that copy wrote the damage over the last
  // good backup. It is taken from the tmp file now.
  const { dir, file } = seeded('dur-bak');
  const bak = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
  assert.deepEqual(bak.agents.map((a) => a.name).sort(), ROSTER, '.bak is behind the real file');
  assert.ok(fs.existsSync(`${file}.bak2`), 'no second backup generation');
  // No scratch files left lying around for the next load to trip over.
  const strays = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(strays, [], `scratch files left on disk: ${strays}`);
});

test('a crash between the backup and the rename still loads', () => {
  // The window writeNow deliberately leaves open: .bak already holds the NEW
  // state, state.json still holds the old one. Both are complete.
  const { dir, file } = seeded('dur-window');
  const store = createStore({ dir });
  store.createAgent({ name: 'Dee' });
  store.flush();
  // Simulate dying immediately after the .bak rename: state.json never
  // received the new bytes, so it is one generation behind.
  fs.copyFileSync(`${file}.bak2`, file);
  const names = createStore({ dir }).getState().agents.map((a) => a.name);
  assert.ok(names.includes('Ada'), 'the older-but-complete file did not load');
});

test('reopening a healthy store never quarantines anything', () => {
  const { dir } = seeded('dur-clean');
  for (let i = 0; i < 3; i += 1) createStore({ dir }).flush();
  const noise = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.deepEqual(noise, [], `a healthy file was treated as damaged: ${noise}`);
});

// ── report ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
