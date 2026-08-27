#!/usr/bin/env node
'use strict';

/**
 * quit-safety-test.cjs — the two things that go wrong between "it works on my
 * machine" and "someone else has been using it for a week".
 *
 * 1. STATE SURVIVES A CRASH. `fs.writeFileSync` onto state.json is not atomic:
 *    killing the app inside it leaves a truncated file, `JSON.parse` throws,
 *    and the loader used to answer that by seeding an EMPTY roster and saving
 *    it over the top — every teammate gone, no message, no evidence.
 *    Measured before the fix: a state.json cut to 60% came back with zero
 *    agents and the damaged bytes overwritten.
 *
 * 2. QUIT ACTUALLY QUITS. `shutdown()` awaited every `session.close` at the
 *    full RPC timeout, so a child that had stopped answering — which is what
 *    mid-turn looks like — held the quit for 120,004ms (measured, with the
 *    python SIGSTOPped) while `will-quit` had already called preventDefault.
 *    And SIGTERM alone is a request a wedged interpreter can decline, after
 *    which `app.exit()` orphans it.
 *
 * The gateway half runs a FAKE gateway child (a node script that announces
 * gateway.ready and then ignores both stdin and SIGTERM) inside a temp HOME,
 * so it never touches the real Hermes and costs nothing.
 *
 * Usage: node scripts/quit-safety-test.cjs   (exit 0 on success)
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

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `hydo-${tag}-`));
}

/** A store with two teammates on disk, plus the paths around it. */
function seeded() {
  const dir = tmpDir('quit');
  const store = createStore({ dir });
  store.signIn();
  store.createAgent({ name: 'Ada' });
  store.createAgent({ name: 'Bo' });
  store.flush();
  return { dir, file: path.join(dir, 'state.json') };
}

// ── 1. crash safety ──────────────────────────────────────────────────────

test('a save leaves no half-written state.json behind', () => {
  const { dir, file } = seeded();
  // The tmp file is renamed into place, so it must not survive the write.
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'state.json.tmp was left on disk');
  // Whatever is at the real path always parses.
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(
    parsed.agents.map((a) => a.name).sort(),
    ['Ada', 'Bo'],
    'both teammates should be on disk'
  );
  assert.ok(fs.existsSync(path.join(dir, 'state.json.bak')), 'no backup beside state.json');
});

test('a truncated state.json does not wipe the roster', () => {
  const { dir, file } = seeded();
  const full = fs.readFileSync(file, 'utf8');
  // Exactly what a kill inside writeFileSync produces.
  fs.writeFileSync(file, full.slice(0, Math.floor(full.length * 0.6)));

  const names = createStore({ dir }).getState().agents.map((a) => a.name);
  assert.ok(names.length > 0, 'a truncated write emptied the roster');
  assert.ok(names.includes('Ada'), `expected the recovered roster to hold Ada, got ${names}`);
  // And the recovered copy is back at the real path, not only in memory.
  assert.ok(
    JSON.parse(fs.readFileSync(file, 'utf8')).agents.length > 0,
    'the recovered state was never written back'
  );
});

test('an unreadable state.json with no backup is kept, not clobbered', () => {
  const dir = tmpDir('quit-corrupt');
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{"agents":[{"name":"Ada"'); // no .bak exists yet

  const store = createStore({ dir });
  assert.deepEqual(store.getState().agents, [], 'a corrupt file should seed empty');
  const kept = fs.readdirSync(dir).filter((f) => f.startsWith('state.json.corrupt-'));
  assert.equal(kept.length, 1, `expected the damaged file to be preserved, saw ${fs.readdirSync(dir)}`);
  assert.ok(
    fs.readFileSync(path.join(dir, kept[0]), 'utf8').includes('Ada'),
    'the preserved copy is not the original bytes'
  );
});

// ── 2. quit safety ───────────────────────────────────────────────────────

/**
 * Drive hermes-gateway in a child node process whose HOME is a temp dir, so
 * HERMES_ROOT (os.homedir()/.hermes/hermes-agent) is ours and the interpreter
 * it spawns is our fake. Prints one JSON line of results.
 */
function runGatewayShutdownProbe() {
  const home = tmpDir('quit-home');
  const root = path.join(home, '.hermes', 'hermes-agent');
  fs.mkdirSync(root, { recursive: true });

  // The "python": a shell wrapper, NOT a NODE_OPTIONS preload — the probe is
  // itself a node process, so a preload would keep IT alive too. Announces
  // ready, then declines to co-operate with anything: no stdin replies, and
  // SIGTERM ignored. Only SIGKILL ends it.
  const fakeJs = path.join(home, 'fake-gateway.js');
  fs.writeFileSync(
    fakeJs,
    [
      'process.on("SIGTERM", () => {});',
      // The ready frame is a JSON-RPC *event*, not a bare object — the client
      // reads the name off params.type and ignores anything else.
      'process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready" } }) + "\\n");',
      'setInterval(() => {}, 1000);',
    ].join('\n')
  );
  const fake = path.join(home, 'fake-gateway.sh');
  fs.writeFileSync(fake, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeJs)}\n`);
  fs.chmodSync(fake, 0o755);

  const probe = path.join(home, 'probe.js');
  fs.writeFileSync(
    probe,
    `
const gw = require(${JSON.stringify(path.join(__dirname, '..', 'electron', 'hermes-gateway.cjs'))});
const { execSync } = require("node:child_process");
gw.ensure("").then(() => {
  const kids = execSync("pgrep -P " + process.pid + " || true").toString().trim().split("\\n").filter(Boolean);
  const t0 = Date.now();
  return gw.shutdown().then(() => {
    // A SIGKILLed child is a ZOMBIE until node reaps it, and kill(pid, 0)
    // still succeeds on one — so ask ps for the state instead.
    const alive = kids.filter((p) => {
      const stat = execSync("ps -p " + p + " -o stat= || true").toString().trim();
      return stat && !stat.startsWith("Z");
    });
    process.stdout.write("RESULT " + JSON.stringify({ ms: Date.now() - t0, kids, alive }) + "\\n");
  });
}).catch((err) => {
  process.stdout.write("RESULT " + JSON.stringify({ error: String(err && err.message) }) + "\\n");
});
`
  );

  const out = execFileSync(process.execPath, [probe], {
    env: {
      ...process.env,
      HOME: home,
      // The wrapper ignores the `-m tui_gateway.entry` argv it is handed.
      HERMES_PYTHON: fake,
      HYDO_GATEWAY_STARTUP_TIMEOUT_MS: '8000',
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const line = out.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, `probe printed no result:\n${out}`);
  return JSON.parse(line.slice('RESULT '.length));
}

test('shutdown is bounded and SIGKILLs a child that ignores SIGTERM', () => {
  const res = runGatewayShutdownProbe();
  assert.ok(!res.error, `probe failed: ${res.error}`);
  assert.ok(res.kids.length > 0, 'the probe never started a gateway child');
  // Generous next to the 120s it used to take, tight enough that a quit can
  // never feel like a hang.
  assert.ok(res.ms < 15_000, `shutdown took ${res.ms}ms — quit is hanging again`);
  assert.deepEqual(res.alive, [], `gateway children survived shutdown: ${res.alive}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error(`FAILED: ${failures.join(' | ')}`);
  process.exit(1);
}
console.log('ok');
