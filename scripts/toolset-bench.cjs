#!/usr/bin/env node
'use strict';

/**
 * toolset-bench.cjs — measures what a tool profile actually costs, against the
 * REAL gateway, and proves per-bot profiles work end to end.
 *
 * Prints prompt-token cost per profile from `session.context_breakdown`, so the
 * numbers in docs/HERMES-GATEWAY.md and hermes-gateway.cjs can be re-derived
 * rather than trusted.
 *
 * Usage: node scripts/toolset-bench.cjs
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const gateway = require('../electron/hermes-gateway.cjs');

const PROFILES = ['chat', 'writer', 'researcher', 'builder', 'full'];
const rule = (t) => console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`);

const hardStop = setTimeout(() => {
  console.error('!! bench hard timeout');
  gateway.shutdown().finally(() => process.exit(2));
}, 15 * 60 * 1000);

function cat(bd, id) {
  const hit = (bd.categories || []).find((c) => c.id === id);
  return hit ? hit.tokens : 0;
}

async function measure(profile) {
  const botId = `bench-${profile}`;
  const cwd = path.join(os.tmpdir(), `hydo-bench-${profile}`);
  fs.mkdirSync(cwd, { recursive: true });
  const s = await gateway.sessionFor(botId, { cwd, title: `bench ${profile}`, profile });
  await gateway.submit(botId, 'Say ok. Use no tools.', {});
  const bd = await gateway.contextBreakdown(botId);
  return {
    profile,
    pin: s.pin || '(hermes default)',
    used: bd.context_used,
    system: cat(bd, 'system_prompt'),
    tools: cat(bd, 'tool_definitions'),
    mcp: cat(bd, 'mcp'),
    subagents: cat(bd, 'subagent_definitions'),
  };
}

async function main() {
  if (!gateway.available()) throw new Error('hermes not installed');

  rule('PER-PROFILE CONTEXT COST (prompt tokens, one-line turn)');
  const rows = [];
  for (const profile of PROFILES) {
    rows.push(await measure(profile));
    const r = rows[rows.length - 1];
    console.log(
      `${r.profile.padEnd(11)} used=${String(r.used).padStart(6)}  ` +
        `system=${String(r.system).padStart(5)}  tools=${String(r.tools).padStart(6)}  ` +
        `mcp=${String(r.mcp).padStart(5)}  subagents=${String(r.subagents).padStart(5)}`
    );
  }

  const full = rows.find((r) => r.profile === 'full');
  rule('SAVING vs the profile Hermes would pick on its own');
  for (const r of rows) {
    if (r.profile === 'full') continue;
    const saved = full.used - r.used;
    const pct = full.used ? Math.round((saved / full.used) * 100) : 0;
    console.log(
      `${r.profile.padEnd(11)} ${String(r.used).padStart(6)} vs ${full.used}  ` +
        `→ saves ${String(saved).padStart(6)} tokens/turn (${pct}%)`
    );
  }

  rule('PROCESS TOPOLOGY — one child per distinct profile');
  for (const rt of gateway.runtimeStatus()) {
    console.log(
      `pid=${String(rt.pid).padEnd(7)} ready=${rt.ready}  bots=[${rt.bots.join(', ')}]\n` +
        `   toolsets: ${rt.pin || '(hermes default)'}`
    );
  }

  rule('PROFILE CHANGE ON A LIVE BOT');
  const botId = 'bench-switch';
  const cwd = path.join(os.tmpdir(), 'hydo-bench-switch');
  fs.mkdirSync(cwd, { recursive: true });
  const a = await gateway.sessionFor(botId, { cwd, title: 'switch', profile: 'chat' });
  console.log(`chat       → session=${a.sessionId} pin=${a.pin}`);
  const b = await gateway.sessionFor(botId, { cwd, title: 'switch', profile: 'researcher' });
  console.log(`researcher → session=${b.sessionId} pin=${b.pin}`);
  console.log(
    b.sessionId !== a.sessionId && b.pin !== a.pin
      ? '  [PASS] widening the profile moved the bot to a new child + session'
      : '  [FAIL] profile change did not take'
  );
}

main()
  .then(async () => {
    clearTimeout(hardStop);
    await gateway.shutdown();
    console.log('\nBENCH DONE');
    process.exit(0);
  })
  .catch(async (err) => {
    clearTimeout(hardStop);
    console.error('\nBENCH ERROR:', err && err.stack ? err.stack : err);
    console.error(gateway.logTail(25));
    await gateway.shutdown().catch(() => {});
    process.exit(1);
  });
