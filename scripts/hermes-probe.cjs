#!/usr/bin/env node
'use strict';

/**
 * hermes-probe.cjs — proves the newly wired capabilities against the REAL
 * gateway and prints what came back. Evidence, not a unit test.
 *
 * Usage: node scripts/hermes-probe.cjs
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const gateway = require('../electron/hermes-gateway.cjs');
const plugins = require('../electron/hermes-plugins.cjs');

const BOT = 'probe-bot';
const WORKSPACE = path.join(os.tmpdir(), 'hydo-hermes-probe');
const rule = (t) => console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`);
const hardStop = setTimeout(() => {
  console.error('!! probe hard timeout');
  gateway.shutdown().finally(() => process.exit(2));
}, 8 * 60 * 1000);

async function main() {
  rule('0. AVAILABILITY');
  console.log('available():', gateway.available());
  if (!gateway.available()) throw new Error('hermes not installed');
  await gateway.ensure();
  fs.mkdirSync(WORKSPACE, { recursive: true });
  const s = await gateway.sessionFor(BOT, { cwd: WORKSPACE, title: 'Hydo probe' });
  console.log('session:', s.sessionId, s.storedSessionId);

  rule('1. MODEL PICKER — model.options');
  const models = await gateway.modelOptions(BOT);
  if (!models) console.log('(null)');
  else {
    console.log('top-level keys:', Object.keys(models).join(', '));
    const providers = models.providers || [];
    console.log(`providers: ${providers.length}`);
    for (const p of providers.slice(0, 6)) {
      const names = (p.models || []).slice(0, 4).map((m) => m.id || m.name || m);
      console.log(
        `  ${String(p.slug || p.name).padEnd(16)} current=${!!p.is_current} auth=${p.authenticated} ` +
          `models=${p.total_models ?? (p.models || []).length}  e.g. ${names.join(', ')}`
      );
    }
    if (models.current) console.log('current:', JSON.stringify(models.current).slice(0, 200));
  }

  rule('2. USAGE — one real turn, then session.usage / usage.bars / context_breakdown');
  const out = await gateway.submit(BOT, 'Reply with exactly: probe-ok. Use no tools.', {});
  console.log('turn text:', JSON.stringify(out.text));
  console.log('turn usage:', JSON.stringify(out.usage));
  console.log('session.usage      :', JSON.stringify(await gateway.usage(BOT)));
  console.log('usage.bars         :', JSON.stringify(await gateway.usageBars()).slice(0, 600));
  const bd = await gateway.contextBreakdown(BOT);
  console.log(
    'context_breakdown  :',
    bd
      ? `model=${bd.model} used=${bd.context_used}/${bd.context_max} (${bd.context_percent}%) categories=${(bd.categories || []).length}`
      : '(null)'
  );
  if (bd && bd.categories) {
    for (const c of bd.categories.slice(0, 8)) console.log(`    ${JSON.stringify(c)}`);
  }

  rule('3. HISTORY — session.history (durable row ids)');
  const h = await gateway.history(BOT);
  console.log(`count=${h.count}`);
  for (const m of (h.messages || []).slice(-4)) {
    console.log(
      `  row_id=${m.row_id ?? '-'} role=${m.role} reactions=${JSON.stringify(m.reactions || null)} ` +
        `text=${JSON.stringify(String(m.text || m.content || '').slice(0, 60))}`
    );
  }

  rule('4. REACTIONS — message.react on the newest assistant row');
  try {
    const r = await gateway.react(BOT, { emoji: '\u{1F44D}', newestRole: 'assistant', author: 'user' });
    console.log('react →', JSON.stringify(r));
    const r2 = await gateway.react(BOT, { emoji: '\u{1F44D}', newestRole: 'assistant', author: 'user' });
    console.log('same emoji again (retract) →', JSON.stringify(r2));
  } catch (err) {
    console.log('react FAILED:', err.message);
  }

  rule('5. STEER — session.steer with no turn in flight');
  try {
    console.log(JSON.stringify(await gateway.steer(BOT, 'also mention the date')));
  } catch (err) {
    console.log('steer rejected (expected with no live turn):', err.message);
  }

  rule('6. PLUGINS — the frozen contract, against live mcp.* RPCs');
  const p = await plugins.listPlugins();
  console.log(`servers: ${p.servers.length}   catalog: ${p.catalog.length}`);
  for (const srv of p.servers) console.log('  server', JSON.stringify(srv));
  for (const c of p.catalog.slice(0, 8)) console.log('  catalog', JSON.stringify(c));

  rule('7. CRON — cron.manage list');
  console.log(JSON.stringify(await gateway.cron('list', { includeDisabled: true })).slice(0, 800));

  rule('8. LEARNING + INSIGHTS');
  console.log('insights.get:', JSON.stringify(await gateway.insights(30)));
  const lf = await gateway.learningFrames({ cols: 60, rows: 12, frames: 2 });
  console.log('learning.frames keys:', lf ? Object.keys(lf).join(', ') : '(null)');
  if (lf && Array.isArray(lf.frames)) console.log('frames:', lf.frames.length);

  rule('9. ATTACHMENTS — file.attach');
  const probeFile = path.join(WORKSPACE, 'probe.txt');
  fs.writeFileSync(probeFile, 'hydo probe attachment\n');
  try {
    console.log(JSON.stringify(await gateway.attachFile(BOT, probeFile)));
  } catch (err) {
    console.log('attachFile FAILED:', err.message);
  }

  rule('10. SESSION LIST');
  const list = await gateway.listSessions({ limit: 5 });
  const rows = list.sessions || list.items || [];
  console.log(`sessions: ${Array.isArray(rows) ? rows.length : JSON.stringify(list).slice(0, 200)}`);
  for (const r of (Array.isArray(rows) ? rows : []).slice(0, 5)) {
    console.log(`  ${r.id} ${JSON.stringify(r.title || '')} msgs=${r.message_count ?? '?'}`);
  }
}

main()
  .then(async () => {
    clearTimeout(hardStop);
    await gateway.shutdown();
    console.log('\nPROBE DONE');
    process.exit(0);
  })
  .catch(async (err) => {
    clearTimeout(hardStop);
    console.error('\nPROBE ERROR:', err && err.stack ? err.stack : err);
    console.error(gateway.logTail(20));
    await gateway.shutdown().catch(() => {});
    process.exit(1);
  });
