#!/usr/bin/env node
'use strict';

/**
 * first-run-test.cjs — what someone actually meets on a clean machine.
 *
 * Almost every other test here runs against `?mock=1` and a populated fixture,
 * so the genuine first launch — empty store, nothing configured, Hermes not
 * installed — was the one path nobody asserted on. Driving it in a real
 * BrowserWindow turned up two things worth pinning:
 *
 *   1. a brand new profile opens on the SIGN IN gate with an empty roster; it
 *      must never come up pre-populated with anyone.
 *   2. with no Hermes and no fallback key, the first thing a teammate said was
 *      "Local mode — no OpenRouter key — drop OPENROUTER_API_KEY in the env".
 *      That names an env var for a cause that is not the real one, to someone
 *      who has an app and not a shell. Hermes is the product; the key is the
 *      fallback. Whichever is actually missing is what the bubble must name.
 *
 * Usage: node scripts/first-run-test.cjs   (exit 0 on success)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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

test('a clean profile opens signed out, with nobody in it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydo-firstrun-'));
  const state = createStore({ dir }).getState();
  assert.equal(state.signedIn, false, 'a first launch must show the sign-in gate');
  assert.deepEqual(state.agents, [], 'a first launch must not invent teammates');
  assert.deepEqual(state.channels, [], 'a first launch must not invent channels');
  assert.equal(state.selectedId, null);
});

test('signing in and making one teammate is all it takes to get a thread', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydo-firstrun2-'));
  // An injected `complete` so this never reaches Hermes or the network.
  const store = createStore({ dir, complete: async () => 'ready' });
  store.signIn();
  const state = store.createAgent({ name: 'Nova' });
  assert.equal(state.agents.length, 1);
  assert.ok(state.selectedId, 'the new teammate must be selected, not left unfocused');
  assert.equal(state.agents[0].name, 'Nova');
  assert.ok(Array.isArray(state.messages[state.selectedId]), 'it needs a thread to talk in');
});

/**
 * Send one message from a store whose HOME is a temp dir, so
 * hermes-gateway's HERMES_ROOT (os.homedir()/.hermes/hermes-agent) is empty
 * and `available()` is genuinely false. Returns the teammate's reply text.
 */
function replyWithNoHermes() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hydo-nohermes-'));
  const probe = path.join(home, 'probe.js');
  fs.writeFileSync(
    probe,
    `
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { createStore } = require(${JSON.stringify(path.join(__dirname, '..', 'electron', 'store.cjs'))});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-nohermes-store-"));
const store = createStore({ dir });
store.signIn();
store.createAgent({ name: "Nova" });
store.send("hello there").then((state) => {
  const list = state.messages[state.selectedId] || [];
  const last = list.filter((m) => m.role === "bot").pop();
  process.stdout.write("RESULT " + JSON.stringify({ text: (last && last.text) || "" }) + "\\n");
  process.exit(0);
});
`
  );
  const out = execFileSync(process.execPath, [probe], {
    // No OPENROUTER_API_KEY either: this is the bare machine.
    env: { ...process.env, HOME: home, OPENROUTER_API_KEY: '' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  const line = out.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, `probe printed no result:\n${out}`);
  return JSON.parse(line.slice('RESULT '.length)).text;
}

test('with no Hermes, the teammate names Hermes rather than an env var', () => {
  const text = replyWithNoHermes();
  assert.ok(text, 'the teammate said nothing at all');
  assert.ok(
    /hermes/i.test(text),
    `the reply must name the thing that is actually missing, got: ${text}`
  );
  assert.ok(
    !/OPENROUTER_API_KEY/.test(text),
    `an env var is not an instruction a user of the app can follow, got: ${text}`
  );
  // Actionable, not just accurate: it has to say where to put it.
  assert.ok(
    text.includes('.hermes'),
    `the reply must say where Hermes goes, got: ${text}`
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error(`FAILED: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log('ok');
