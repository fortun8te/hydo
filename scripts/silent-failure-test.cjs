#!/usr/bin/env node
'use strict';

/**
 * silent-failure-test.cjs — the house bug, pinned.
 *
 * Several bridge calls answer `{ok:false, reason}` and several renderers threw
 * that answer away, which produces the exact thing this codebase keeps having
 * to re-find: a control that looks finished, never errors, and does nothing.
 * Known instances, all real:
 *
 *   openWorkspace   a bot with no workspace gave you a button that did
 *                   nothing and said nothing        (fixed earlier)
 *   killProcess     Stop removed the row whatever the answer, so with Hermes
 *                   down the process kept running and the rail said it was
 *                   gone                            (fixed here)
 *   saveFile        Download on a file the teammate had since deleted was a
 *                   click with no dialog and no message   (fixed here)
 *
 * There is no jsdom render step in this repo (see computer-rail-test.cjs), so
 * this is a source-shape check like wiring-check.cjs: for each call the answer
 * must be awaited AND branched on, and the failure branch must put something
 * on screen. It is a guard against the shape coming back, not a claim that the
 * code exists.
 *
 * Usage: node scripts/silent-failure-test.cjs   (exit 0 on success)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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

/**
 * The window of source starting at a bridge call, big enough to hold the
 * handler that consumes it.
 */
function around(src, needle, span = 900) {
  const at = src.indexOf(needle);
  assert.notEqual(at, -1, `no call site for ${needle}`);
  return src.slice(Math.max(0, at - 400), at + span);
}

/** A call whose answer is awaited, inspected for `ok`, and reported on. */
function consumesResult(chunk, label, sinkPattern) {
  assert.ok(/await\s+window\.hydo/.test(chunk), `${label}: the answer is never awaited`);
  assert.ok(/\.ok\b/.test(chunk), `${label}: nothing ever looks at res.ok`);
  assert.ok(/reason/.test(chunk), `${label}: the {ok:false} reason is dropped on the floor`);
  assert.ok(sinkPattern.test(chunk), `${label}: the failure is never put on screen`);
}

test('openWorkspace reports instead of swallowing', () => {
  const src = read('src/screens/BotRail.jsx');
  consumesResult(around(src, 'window.hydo?.openWorkspace'), 'openWorkspace', /setWorkspace/);
  // And there is somewhere for it to land.
  assert.ok(src.includes('workspace.error'), 'the rail never renders the workspace error');
});

test('Stop only removes a process row when the kill landed', () => {
  const src = read('src/screens/BotRail.jsx');
  const chunk = around(src, 'window.hydo?.killProcess');
  consumesResult(chunk, 'killProcess', /setProcError/);
  // The row must be dropped INSIDE the success branch, never unconditionally:
  // an optimistic removal is the lie this test exists to stop.
  const drop = chunk.indexOf('setProcs((list) => list.filter');
  const okBranch = chunk.indexOf('res && res.ok');
  assert.notEqual(drop, -1, 'the row is never removed at all');
  assert.notEqual(okBranch, -1, 'there is no success branch');
  assert.ok(okBranch < drop, 'the row is removed before anyone checks whether the kill worked');
  assert.ok(src.includes('{procError}'), 'the rail never renders the stop failure');
});

test('Download says why it could not save', () => {
  const src = read('src/screens/RichContent.jsx');
  const chunk = around(src, 'window.hydo.saveFile');
  consumesResult(chunk, 'saveFile', /setSaveError/);
  // Cancelling the save panel is a normal outcome, not an error to shout.
  assert.ok(/canceled/.test(chunk), 'cancelling the picker would be reported as a failure');
  assert.ok(
    /\{saveError \|\| size \|\| label\}/.test(src),
    'the reason has nowhere to appear in the chip'
  );
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error(`FAILED: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log('ok');
