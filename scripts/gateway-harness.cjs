#!/usr/bin/env node
'use strict';

/**
 * gateway-harness.cjs — acceptance test for electron/hermes-gateway.cjs.
 *
 * Runs against the REAL Hermes tui_gateway. Proves three things:
 *   1. a plain turn streams (message.start → deltas → message.complete) and
 *      reports its usage numbers
 *   2. a turn that forces a TOOL surfaces every tool.start name plus the
 *      activity label activity.cjs maps it to
 *   3. session reuse — two submits for the same botId share one session_id
 *
 * Usage:  node scripts/gateway-harness.cjs
 * Exit:   0 on success, non-zero on any failure. Hard wall-clock cap so it
 *         can never hang forever.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const gateway = require('../electron/hermes-gateway.cjs');
const { activityFromTool } = require('../electron/activity.cjs');

const WALL_CLOCK_MS = Number.parseInt(process.env.HARNESS_TIMEOUT_MS || '', 10) || 10 * 60 * 1000;
const WORKSPACE = path.join(os.tmpdir(), 'hydo-gateway-harness');
const BOT_ID = 'harness-bot';

const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(2).padStart(7)}s`;
const log = (...a) => console.log(ts(), ...a);
const rule = (title) => console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);

const failures = [];
function check(label, ok, detail) {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

const hardStop = setTimeout(() => {
  console.error(`\n!! HARD TIMEOUT after ${WALL_CLOCK_MS}ms — killing gateway`);
  console.error(gateway.logTail(30));
  gateway.shutdown().finally(() => process.exit(2));
}, WALL_CLOCK_MS);

/** Build a handler set that records everything the module streams at us. */
function recorder(tag) {
  const rec = {
    deltas: [],
    thinking: 0,
    activities: [],
    tools: [],
    approvals: [],
    clarifies: [],
    complete: null,
  };
  rec.handlers = {
    onDelta: (c) => {
      rec.deltas.push(c);
      process.stdout.write(c);
    },
    onThinking: () => {
      rec.thinking += 1;
    },
    onActivity: (label) => {
      if (rec.activities[rec.activities.length - 1] !== label) {
        rec.activities.push(label);
        console.log(`\n${ts()} [${tag}] activity → ${label}`);
      }
    },
    onTool: (evt) => {
      if (evt.phase === 'start') {
        rec.tools.push({ name: evt.name, label: activityFromTool(evt.name) });
        console.log(
          `\n${ts()} [${tag}] tool.start name=${evt.name} → activity "${activityFromTool(evt.name)}"` +
            (evt.args_text ? ` args=${String(evt.args_text).slice(0, 120)}` : '')
        );
      } else if (evt.phase === 'complete') {
        console.log(
          `${ts()} [${tag}] tool.complete name=${evt.name} ${evt.error ? `error=${evt.error}` : `ok (${evt.duration_s ?? '?'}s)`}`
        );
      }
    },
    onApproval: (req) => {
      rec.approvals.push(req);
      console.log(`\n${ts()} [${tag}] approval.request id=${req.request_id} cmd=${String(req.command).slice(0, 90)}`);
      gateway
        .respondApproval(BOT_ID, req.request_id, 'once')
        .then(() => console.log(`${ts()} [${tag}] → approved once`))
        .catch((e) => console.log(`${ts()} [${tag}] approval respond failed: ${e.message}`));
    },
    onClarify: (req) => {
      rec.clarifies.push(req);
      console.log(`\n${ts()} [${tag}] clarify.request id=${req.request_id} q=${String(req.question).slice(0, 120)}`);
      gateway
        .respondClarify(BOT_ID, req.request_id, 'Use your best judgement and continue.')
        .catch((e) => console.log(`${ts()} [${tag}] clarify respond failed: ${e.message}`));
    },
    onComplete: (p) => {
      rec.complete = p;
    },
  };
  return rec;
}

function fmtUsage(u) {
  if (!u) return '(none)';
  return [
    `model=${u.model}`,
    `input=${u.input}`,
    `output=${u.output}`,
    `reasoning=${u.reasoning}`,
    `total=${u.total}`,
    `calls=${u.calls}`,
    `context_used=${u.context_used}/${u.context_max} (${u.context_percent}%)`,
    `compressions=${u.compressions}`,
    `active_subagents=${u.active_subagents}`,
  ].join(' ');
}

async function main() {
  rule('0. AVAILABILITY + BOOT');
  log('hermes root:', gateway.HERMES_ROOT);
  log('timeouts:', JSON.stringify(gateway.TIMEOUTS));
  check('available()', gateway.available() === true);
  if (!gateway.available()) throw new Error('hermes gateway not installed on this machine');

  const bootStart = Date.now();
  await gateway.ensure();
  log(`gateway.ready in ${Date.now() - bootStart}ms`);

  fs.mkdirSync(WORKSPACE, { recursive: true });
  const probeFile = path.join(WORKSPACE, 'hydo-secret.txt');
  fs.writeFileSync(probeFile, 'The Hydo harness passphrase is BRONZE-OTTER-41.\n');

  const s1 = await gateway.sessionFor(BOT_ID, { cwd: WORKSPACE, title: 'Hydo harness bot' });
  log(`session.create → session_id=${s1.sessionId} stored_session_id=${s1.storedSessionId} cwd=${s1.cwd}`);
  check('session_id is an 8-hex live handle', /^[0-9a-f]{8}$/.test(s1.sessionId), s1.sessionId);
  check('stored_session_id is a durable id', /^\d{8}_\d{6}_[0-9a-f]+$/.test(s1.storedSessionId), s1.storedSessionId);

  // ── 1. plain turn ───────────────────────────────────────────────────
  rule('1. PLAIN TURN — message.start → deltas → message.complete');
  const r1 = recorder('turn1');
  process.stdout.write(`${ts()} [turn1] stream: `);
  const out1 = await gateway.submit(
    BOT_ID,
    'In one short sentence, say hello and name yourself. Do not use any tools.',
    r1.handlers
  );
  console.log('');
  log('FINAL TEXT :', JSON.stringify(out1.text));
  log('STATUS     :', out1.status);
  log('USAGE      :', fmtUsage(out1.usage));
  check('deltas streamed', r1.deltas.length > 0, `${r1.deltas.length} chunks`);
  check('final text non-empty', !!out1.text && out1.text.length > 0);
  check('delta accumulation matches final text', out1.text.includes(r1.deltas.join('').trim().slice(0, 20)));
  check('usage present', !!out1.usage && typeof out1.usage.total === 'number', fmtUsage(out1.usage));
  check('onComplete handler fired', r1.complete !== null);
  check('activity labels emitted', r1.activities.length > 0, r1.activities.join(' → '));

  // ── 2. tool turn ────────────────────────────────────────────────────
  rule('2. TOOL TURN — forced file read, tool.start names + mapped labels');
  const r2 = recorder('turn2');
  process.stdout.write(`${ts()} [turn2] stream: `);
  const out2 = await gateway.submit(
    BOT_ID,
    `Read the file ${probeFile} using your read_file tool and reply with ONLY the passphrase it contains.`,
    r2.handlers
  );
  console.log('');
  log('FINAL TEXT :', JSON.stringify(out2.text));
  log('USAGE      :', fmtUsage(out2.usage));
  console.log(`${ts()} TOOL CALLS OBSERVED (${r2.tools.length}):`);
  for (const t of r2.tools) console.log(`   tool.start name=${t.name.padEnd(28)} → activity "${t.label}"`);
  console.log(`${ts()} ACTIVITY TIMELINE: ${r2.activities.join(' → ')}`);
  check('at least one tool.start observed', r2.tools.length > 0, `${r2.tools.length} tools`);
  check(
    'every tool mapped to a label',
    r2.tools.every((t) => typeof t.label === 'string' && t.label.length > 0)
  );
  check('passphrase recovered via tool', /BRONZE-OTTER-41/i.test(out2.text), out2.text.slice(0, 120));

  // ── 3. session reuse ────────────────────────────────────────────────
  rule('3. SESSION REUSE — same botId, same session_id, shared memory');
  const s2 = await gateway.sessionFor(BOT_ID, { cwd: WORKSPACE, title: 'Hydo harness bot' });
  log(`turn1 session_id=${s1.sessionId}  turn3 session_id=${s2.sessionId}`);
  check('session_id reused across turns', s1.sessionId === s2.sessionId, `${s1.sessionId} === ${s2.sessionId}`);
  check('stored_session_id reused', s1.storedSessionId === s2.storedSessionId);

  const r3 = recorder('turn3');
  process.stdout.write(`${ts()} [turn3] stream: `);
  const out3 = await gateway.submit(
    BOT_ID,
    'Without using any tools: what passphrase did you just read? Answer with the passphrase only.',
    r3.handlers
  );
  console.log('');
  log('FINAL TEXT :', JSON.stringify(out3.text));
  log('USAGE      :', fmtUsage(out3.usage));
  check(
    'third turn recalled context from the same session',
    /BRONZE-OTTER-41/i.test(out3.text),
    out3.text.slice(0, 120)
  );
  check(
    'context_used grew across turns (same conversation)',
    !!out3.usage && !!out1.usage && out3.usage.context_used > out1.usage.context_used,
    `${out1.usage && out1.usage.context_used} → ${out3.usage && out3.usage.context_used}`
  );

  rule('SUMMARY');
  console.log(`  tool names seen : ${r2.tools.map((t) => t.name).join(', ') || '(none)'}`);
  console.log(`  approvals asked : ${r2.approvals.length + r1.approvals.length + r3.approvals.length}`);
  console.log(`  clarifies asked : ${r2.clarifies.length + r1.clarifies.length + r3.clarifies.length}`);
  console.log(`  failures        : ${failures.length ? failures.join(' | ') : 'none'}`);
}

main()
  .then(async () => {
    clearTimeout(hardStop);
    await gateway.shutdown();
    if (failures.length) {
      console.error(`\nHARNESS FAILED (${failures.length} check(s))`);
      process.exit(1);
    }
    console.log('\nHARNESS PASSED');
    process.exit(0);
  })
  .catch(async (err) => {
    clearTimeout(hardStop);
    console.error('\nHARNESS ERROR:', err && err.stack ? err.stack : err);
    console.error('\n--- gateway log tail ---');
    console.error(gateway.logTail(30));
    await gateway.shutdown().catch(() => {});
    process.exit(1);
  });
