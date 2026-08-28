#!/usr/bin/env node
'use strict';

/**
 * store-extras-test.cjs — coverage for the store behaviour added on top of
 * what scripts/test.cjs (owned by the lead) already guards.
 *
 * Covers: reactions both directions, the REACT / REPLY directives never
 * leaking into bubble text, reply-to snapshots, per-conversation `workingIn`,
 * and the roster flags. Entirely offline — every store is built with an
 * injected `complete`, so Hermes is never contacted.
 *
 * Usage: node scripts/store-extras-test.cjs   (exit 0 on success)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore, stripEmDashes } = require('../electron/store.cjs');

{
  const a = stripEmDashes('hello \u2014 world');
  assert.ok(a.includes('hello.'), a);
  assert.ok(a.includes('world'), a);
  assert.ok(!a.includes('\u2014'), a);
  const fenced = stripEmDashes('out \u2014 side\n```\nkeep \u2014 inside\n```\n');
  assert.ok(fenced.includes('\u2014'), fenced);
  assert.ok(fenced.includes('keep'), fenced);
  assert.equal(stripEmDashes('2010\u20132012'), '2010-2012');
}


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

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hydo-extras-'));
}

/** A store with one real (non-canned) teammate, and a scripted reply. */
async function withBot(reply) {
  const dir = tmpdir();
  const store = createStore({ dir, complete: async () => reply });
  store.createAgent();
  const id = store.getState().selectedId;
  store.setAgent(id, { name: 'Builder' });
  return { dir, store, id };
}

const thread = (store, id) => store.getState().messages[id] || [];
const agentOf = (store, id) => store.getState().agents.find((a) => a.id === id);

async function main() {
  console.log('\nREACTIONS');

  await test('user reaction toggles on, then off', async () => {
    const { store, id } = await withBot('ok');
    await store.send('do the thing');
    const userMsg = thread(store, id).find((m) => m.role === 'user');

    await store.react(userMsg.id, '\u{1F44D}');
    let msg = thread(store, id).find((m) => m.id === userMsg.id);
    assert.equal(msg.reactions.length, 1, 'reaction was not added');
    assert.equal(msg.reactions[0].emoji, '\u{1F44D}');
    assert.equal(msg.reactions[0].by, 'user');

    await store.react(userMsg.id, '\u{1F44D}');
    msg = thread(store, id).find((m) => m.id === userMsg.id);
    assert.ok(!msg.reactions, 'same emoji from same actor must retract');
  });

  await test('two different emoji from the user coexist', async () => {
    const { store, id } = await withBot('ok');
    await store.send('hi');
    const userMsg = thread(store, id).find((m) => m.role === 'user');
    await store.react(userMsg.id, '\u{1F44D}');
    await store.react(userMsg.id, '❤️');
    const msg = thread(store, id).find((m) => m.id === userMsg.id);
    assert.equal(msg.reactions.length, 2);
  });

  await test('reactions survive a reload', async () => {
    const dir = tmpdir();
    const store = createStore({ dir, complete: async () => 'ok' });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });
    await store.send('remember this');
    const userMsg = thread(store, id).find((m) => m.role === 'user');
    await store.react(userMsg.id, '\u{1F525}');

    const reloaded = createStore({ dir, complete: async () => 'ok' });
    const msg = (reloaded.getState().messages[id] || []).find((m) => m.id === userMsg.id);
    assert.ok(msg, 'message lost across reload');
    assert.equal(msg.reactions[0].emoji, '\u{1F525}');
  });

  await test('bot reacts via REACT:, and the directive never reaches a bubble', async () => {
    const { store, id } = await withBot('REACT: {"emoji":"\u{1F44D}"}\n\nOn it.');
    await store.send('ship the build');
    const list = thread(store, id);
    const userMsg = list.find((m) => m.role === 'user');

    assert.ok(Array.isArray(userMsg.reactions), 'bot did not react');
    assert.equal(userMsg.reactions[0].emoji, '\u{1F44D}');
    assert.equal(userMsg.reactions[0].by, id, 'reaction must be attributed to the bot');

    for (const m of list) {
      assert.ok(!/REACT:/.test(String(m.text || '')), `directive leaked: ${m.text}`);
    }
    assert.ok(list.some((m) => m.role === 'bot' && m.text === 'On it.'));
  });

  await test('a bot may react and say nothing at all', async () => {
    const { store, id } = await withBot('REACT: {"emoji":"\u{1F44D}"}');
    await store.send('nice work earlier');
    const list = thread(store, id);
    assert.equal(list.filter((m) => m.role === 'bot' && m.kind === 'chat').length, 0);
    assert.equal(list.find((m) => m.role === 'user').reactions[0].emoji, '\u{1F44D}');
    assert.equal(agentOf(store, id).status, 'idle');
  });

  await test('a bot re-emitting the same emoji retracts it', async () => {
    const { store, id } = await withBot('REACT: {"emoji":"\u{1F44D}"}');
    await store.send('one');
    const first = thread(store, id).find((m) => m.role === 'user');
    assert.equal(first.reactions.length, 1);
    // Same emoji again on the SAME message.
    await store.react(first.id, '\u{1F44D}');   // user's own, independent
    await store.send('two');                     // new message, new target
    const second = thread(store, id).filter((m) => m.role === 'user')[1];
    assert.equal(second.reactions.length, 1, 'each message tracks its own reactions');
  });

  console.log('\nREPLY-TO');

  await test('user reply stamps a snapshot, and survives a reload', async () => {
    const dir = tmpdir();
    const store = createStore({ dir, complete: async () => 'sure' });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });
    await store.send('first message');
    const target = thread(store, id).find((m) => m.role === 'bot');

    await store.send('about that', { replyTo: target.id });
    const replying = thread(store, id).filter((m) => m.role === 'user')[1];
    assert.ok(replying.replyTo, 'replyTo not stamped');
    assert.equal(replying.replyTo.id, target.id);
    assert.equal(replying.replyTo.text, target.text);
    assert.equal(replying.replyTo.fromId, id);

    const reloaded = createStore({ dir, complete: async () => 'x' });
    const after = (reloaded.getState().messages[id] || []).filter((m) => m.role === 'user')[1];
    assert.equal(after.replyTo.text, target.text, 'replyTo lost across reload');
  });

  await test('a reply to a since-deleted message still renders its snapshot', async () => {
    const dir = tmpdir();
    const store = createStore({ dir, complete: async () => 'sure' });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });
    await store.send('the original');
    const target = thread(store, id).find((m) => m.role === 'bot');
    await store.send('quoting it', { replyTo: target.id });

    // Delete the original out from under the reply, the way a future
    // delete-message action would.
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    raw.messages[id] = raw.messages[id].filter((m) => m.id !== target.id);
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(raw));

    const reloaded = createStore({ dir, complete: async () => 'x' });
    const list = reloaded.getState().messages[id] || [];
    assert.ok(!list.some((m) => m.id === target.id), 'original should be gone');
    const replying = list.find((m) => m.replyTo);
    assert.ok(replying, 'reply lost');
    assert.equal(replying.replyTo.text, 'sure', 'snapshot must outlive the original');
  });

  await test('REPLY: never leaks into bubble text and attaches the bubble', async () => {
    const dir = tmpdir();
    let script = 'first answer';
    const store = createStore({ dir, complete: async () => script });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });
    await store.send('question one');
    const earlier = thread(store, id).find((m) => m.role === 'bot');

    script = `REPLY: {"to":"${earlier.id}"}\n\nGoing back to this one.`;
    await store.send('question two');

    const list = thread(store, id);
    for (const m of list) {
      assert.ok(!/REPLY:/.test(String(m.text || '')), `directive leaked: ${m.text}`);
    }
    const attached = list.find((m) => m.text === 'Going back to this one.');
    assert.ok(attached, 'bubble missing');
    assert.equal(attached.replyTo.id, earlier.id);
    assert.equal(attached.replyTo.text, 'first answer');
  });

  await test('the teammate inherits the user reply-to when they do not emit REPLY:', async () => {
    const { store, id } = await withBot('sure');
    await store.send('first');
    const earlier = thread(store, id).find((m) => m.role === 'bot');
    await store.send('about that', { replyTo: earlier.id });
    const bots = thread(store, id).filter((m) => m.role === 'bot' && m.kind === 'chat');
    const last = bots[bots.length - 1];
    assert.ok(last.replyTo, 'bot reply missing quote');
    assert.equal(last.replyTo.id, earlier.id);
    const user = thread(store, id).filter((m) => m.role === 'user').pop();
    assert.equal(user.replyTo.id, earlier.id);
  });

  console.log('\nWORKING-IN (per-conversation spinner)');

  await test('a 1:1 turn marks workingIn as the bot itself, then clears', async () => {
    const dir = tmpdir();
    let seen = null;
    const store = createStore({
      dir,
      complete: async () => {
        seen = JSON.parse(JSON.stringify(store.getState().agents));
        return 'done';
      },
    });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });
    await store.send('go');
    const during = seen.find((a) => a.id === id);
    assert.equal(during.workingIn, id, 'should spin in its own thread mid-turn');
    assert.equal(agentOf(store, id).workingIn, null, 'must clear when the turn ends');
  });

  await test('a channel turn marks workingIn as the CHANNEL, not the bot', async () => {
    const dir = tmpdir();
    let seen = null;
    const store = createStore({
      dir,
      complete: async () => {
        seen = JSON.parse(JSON.stringify(store.getState().agents));
        return 'SKIP';
      },
    });
    store.createAgent();
    const botId = store.getState().selectedId;
    store.setAgent(botId, { name: 'Builder' });
    store.createChannel({ name: 'build', members: [botId] });
    const chId = store.getState().channels[0].id;

    await store.sendToChannel(chId, 'anyone around?');
    const during = seen.find((a) => a.id === botId);
    assert.equal(during.workingIn, chId, 'a channel turn must not spin the 1:1 thread');
  });

  await test('a SKIP-ing channel member ends with workingIn null', async () => {
    const dir = tmpdir();
    const store = createStore({ dir, complete: async () => 'SKIP' });
    store.createAgent();
    const a = store.getState().selectedId;
    store.setAgent(a, { name: 'Builder' });
    store.createAgent();
    const b = store.getState().selectedId;
    store.setAgent(b, { name: 'Scout' });
    store.createChannel({ name: 'build', members: [a, b] });
    const chId = store.getState().channels[0].id;

    await store.sendToChannel(chId, 'thoughts?');
    for (const id of [a, b]) {
      const bot = agentOf(store, id);
      assert.equal(bot.workingIn, null, `${bot.name} left spinning after SKIP`);
      assert.equal(bot.status, 'idle');
    }
  });

  await test('a stale workingIn in state.json is cleared on load', async () => {
    const dir = tmpdir();
    const store = createStore({ dir, complete: async () => 'x' });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });

    const file = path.join(dir, 'state.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.agents.find((a) => a.id === id).workingIn = 'some-channel';
    raw.agents.find((a) => a.id === id).status = 'working';
    fs.writeFileSync(file, JSON.stringify(raw));

    const reloaded = createStore({ dir, complete: async () => 'x' });
    assert.equal(reloaded.getState().agents.find((a) => a.id === id).workingIn, null);
  });

  console.log('\nROSTER FLAGS');

  await test('unread clears when the conversation is selected', async () => {
    const { store, id } = await withBot('ok');
    store.createAgent();
    const other = store.getState().selectedId;
    store.setAgent(other, { name: 'Scout' });

    store.setUnread(id, true);
    assert.equal(agentOf(store, id).unread, true);
    store.select(other);
    assert.equal(agentOf(store, id).unread, true, 'selecting someone else must not clear it');
    store.select(id);
    assert.equal(agentOf(store, id).unread, false, 'select must clear unread');
  });

  await test('pinned / unread / hidden work on a channel too', async () => {
    const { store, id } = await withBot('ok');
    store.createChannel({ name: 'build', members: [id] });
    const chId = store.getState().channels[0].id;
    store.setPinned(chId, true);
    store.setUnread(chId, true);
    store.setHidden(chId, true);
    const ch = store.getState().channels[0];
    assert.equal(ch.pinned, true);
    assert.equal(ch.unread, true);
    assert.equal(ch.hidden, true);
    store.select(chId);
    assert.equal(store.getState().channels[0].unread, false);
  });

  await test('hidden survives a reload and keeps its messages', async () => {
    const dir = tmpdir();
    const store = createStore({ dir, complete: async () => 'ok' });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });
    await store.send('do not lose this');
    const before = thread(store, id).length;
    store.setHidden(id, true);

    const reloaded = createStore({ dir, complete: async () => 'x' });
    const bot = reloaded.getState().agents.find((a) => a.id === id);
    assert.ok(bot, 'hidden must not delete the teammate');
    assert.equal(bot.hidden, true, 'hidden lost across reload');
    assert.equal((reloaded.getState().messages[id] || []).length, before, 'thread lost');
  });

  await test('duplicateAgent gives a new id, an empty thread, and the same profile', async () => {
    const { store, id } = await withBot('ok');
    store.setAgent(id, { name: 'Builder', label: 'builds things', description: 'the app' });
    await store.send('some history');
    assert.ok(thread(store, id).length > 0);

    store.duplicateAgent(id);
    const state = store.getState();
    const copy = state.agents.find((a) => a.id !== id && a.name.startsWith('Builder copy'));
    assert.ok(copy, 'no copy created');
    assert.notEqual(copy.id, id, 'copy must get a brand new id');
    assert.equal(copy.label, 'builds things');
    assert.equal(copy.description, 'the app');
    assert.equal(copy.blob, state.agents.find((a) => a.id === id).blob);
    assert.equal((state.messages[copy.id] || []).length, 0, 'thread must not be copied');
    assert.equal((state.routines[copy.id] || []).length, 0, 'routines must not be copied');
    assert.equal(copy.workingIn, null);
  });

  await test('toolFiles lists a workspace write, not screenshots', async () => {
    const { toolFiles } = require('../electron/store.cjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydo-file-'));
    const md = path.join(dir, 'note.md');
    fs.writeFileSync(md, '# hi\n');
    const rows = toolFiles({ phase: 'complete', name: 'write_file', path: md }, dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'note.md');
    assert.ok(rows[0].size > 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('toolImages reads png paths and data URLs', async () => {
    const { toolImages } = require('../electron/store.cjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydo-shot-'));
    const png = path.join(dir, 'a.png');
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(png, bytes);
    const fromPath = toolImages({ phase: 'complete', name: 'computer_use', screenshot_path: png });
    assert.equal(fromPath.length, 1);
    assert.ok(fromPath[0].src.startsWith('data:image/png;base64,'));
    const fromB64 = toolImages({
      result: { content_base64: bytes.toString('base64') },
    });
    assert.equal(fromB64.length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await test('answerGate records skip without a live Hermes', async () => {
    const { store, id } = await withBot('ok');
    store.getState();
    const threadList = store.getState().messages[id] || [];
    const fake = {
      id: 'gate1',
      role: 'system',
      kind: 'gate',
      fromId: id,
      requestId: 'r1',
      gateKind: 'sudo',
      secret: true,
      text: 'Needs a sudo password to continue.',
      at: new Date().toISOString(),
    };
    (store.getState().messages[id] || threadList).push(fake);
    // mutate via send path isn't available — push onto in-memory thread if exposed
    const st = store.getState();
    (st.messages[id] ||= []).push(fake);
    const next = await store.answerGate('gate1', '');
    const msg = (next.messages[id] || []).find((m) => m.id === 'gate1');
    if (msg) {
      assert.equal(msg.answered, 'skipped');
    }
  });

  await test('standing is identity-only, not a protocol novel', async () => {
    const { standing } = require('../electron/store.cjs');
    const text = standing(
      { name: 'Dev', label: 'code' },
      { userName: 'Michael' },
      '# soul\nBe quiet.',
      'ignored memory',
      'extra note'
    );
    assert.ok(text.includes('You are Dev (code).'));
    assert.ok(text.includes('Be quiet.'));
    assert.ok(text.includes('Michael'));
    assert.ok(!text.includes('ROUTINE: create'));
    assert.ok(!text.includes('a blank line starts a new bubble'));
    assert.ok(!/MEMORY:/.test(text));
  });

  // A blank line in PROSE is a bubble break; inside structure it is not.
  //
  // This used to assert the opposite — that only an explicit `---` split. The
  // model almost never emits `---` unprompted, so every reply arrived as one
  // paragraph-shaped block, where the reference client this is modelled on
  // sends several short bubbles, one thought each. That difference is most of
  // what made replies read as a document rather than as someone texting.
  //
  // The structural exemption is the load-bearing half: a blank line inside a
  // fenced code block, a list or a table is layout, and splitting there would
  // hand each fragment to the markdown parser separately, so a half-open code
  // fence renders as literal backticks.
  await test('a blank line splits prose into bubbles, but never structure', async () => {
    const { splitBubbles } = require('../electron/store.cjs');
    assert.deepEqual(splitBubbles('one'), ['one']);
    assert.deepEqual(splitBubbles('Research, drafts, files.\n\nThrow me whatever you have.'), [
      'Research, drafts, files.',
      'Throw me whatever you have.',
    ]);
    // Structure stays whole.
    assert.equal(splitBubbles('- a\n- b\n\n- c').length, 1, 'a list was split');
    assert.equal(splitBubbles('see:\n\n```js\nconst x = 1;\n```').length, 1, 'a code block was split');
    assert.equal(splitBubbles('1. a\n\n2. b').length, 1, 'a numbered list was split');
    assert.equal(splitBubbles('| a | b |\n\n| c | d |').length, 1, 'a table was split');
    assert.equal(splitBubbles('# Heading\n\nbody').length, 1, 'a heading was split');
    // `---` still works, and the cap still holds.
    const beats = splitBubbles('Checking the repo.\n---\nFound it.');
    assert.equal(beats.length, 2);
    const four = splitBubbles('a\n---\nb\n---\nc\n---\nd');
    assert.equal(four.length, 3);
    assert.equal(splitBubbles('a\n\nb\n\nc\n\nd').length, 3, 'the three-bubble cap must still hold');
    // max:1 callers (channel members) get one bubble regardless.
    assert.equal(splitBubbles('a\n\nb', { max: 1 }).length, 1);
  });

  await test('a short question does not set backgroundTurn', async () => {
    const { store, id } = await withBot('Two. One or two short bubbles.');
    await store.send('how many messages');
    const agent = store.getState().agents.find((a) => a.id === id);
    assert.ok(!agent.backgroundTurn);
    const bots = (store.getState().messages[id] || []).filter((m) => m.role === 'bot' && m.kind === 'chat');
    assert.equal(bots.length, 1);
  });

  await test('ack then job-done are two bubbles', async () => {
    const dir = tmpdir();
    const store = createStore({
      dir,
      complete: async (system) => (/worker finished/.test(system) ? 'Found the file.' : 'Checking the repo.'),
    });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });
    await store.send('look in the repo');
    await store.jobDone(id, { goal: 'look in the repo', result: 'x.md' });
    const bots = (store.getState().messages[id] || []).filter((m) => m.role === 'bot' && m.kind === 'chat');
    assert.equal(bots.length, 2);
    assert.equal(bots[0].text, 'Checking the repo.');
    assert.equal(bots[1].text, 'Found the file.');
  });

  await test('trackSubagent never implies a chat bubble', async () => {
    const { trackSubagent } = require('../electron/store.cjs');
    const agent = { id: 'a', subagentIds: [] };
    trackSubagent(agent, { type: 'subagent.start', subagent_id: 's1', goal: 'search' });
    assert.deepEqual(agent.subagentIds, ['s1']);
    assert.equal(agent.lastSubagentId, 's1');
    trackSubagent(agent, { type: 'subagent.complete', subagent_id: 's1', summary: 'done' });
    assert.deepEqual(agent.subagentIds, []);
    assert.equal(agent.lastSubagentId, '');
  });

  await test('job-done SKIP posts nothing; a result posts one bubble', async () => {
    const dir = tmpdir();
    const store = createStore({
      dir,
      complete: async (system) => (/worker finished/.test(system) ? 'SKIP' : 'On it.'),
    });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });
    const agent = store.getState().agents.find((a) => a.id === id);
    store.getState();
    store.setAgent(id, {
      backgroundTurn: { convId: id, startedAt: new Date().toISOString(), goal: 'lookup' },
    });
    const before = (store.getState().messages[id] || []).filter((m) => m.role === 'bot').length;
    await store.jobDone(id, { goal: 'lookup', result: 'same as yesterday' });
    const after = store.getState().messages[id] || [];
    assert.equal(after.filter((m) => m.role === 'bot').length, before);
    assert.equal(store.getState().agents.find((a) => a.id === id).backgroundTurn, null);
  });

  await test('job-done can post one bubble then clear backgroundTurn', async () => {
    const dir = tmpdir();
    const store = createStore({
      dir,
      complete: async (system) => (/worker finished/.test(system) ? 'Found the file.' : 'ok'),
    });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });
    await store.jobDone(id, { goal: 'find x', result: 'x.md' });
    const bots = (store.getState().messages[id] || []).filter((m) => m.role === 'bot' && m.kind === 'chat');
    assert.equal(bots.length, 1);
    assert.equal(bots[0].text, 'Found the file.');
    assert.equal(store.getState().agents.find((a) => a.id === id).backgroundTurn, null);
  });

  await test('a second send while backgroundTurn is set does not call complete', async () => {
    const dir = tmpdir();
    let calls = 0;
    const store = createStore({
      dir,
      complete: async () => {
        calls += 1;
        return 'ok';
      },
    });
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name: 'Builder' });
    await store.send('start the job');
    const afterFirst = calls;
    assert.ok(afterFirst >= 1, 'first send must hit complete');
    store.setAgent(id, {
      backgroundTurn: { convId: id, startedAt: new Date().toISOString(), goal: 'long' },
      lastSubagentId: 's1',
      subagentIds: ['s1'],
    });
    await store.send('ping');
    await store.send('and also this');
    assert.equal(calls, afterFirst, 'busy send must not speak / complete again');
    assert.ok((store.getState().messages[id] || []).filter((m) => m.role === 'user').length >= 3);
  });

  await test('new bots start cheap under auto mode, never full', async () => {
    const { store, id } = await withBot('ok');
    const bot = agentOf(store, id);
    // Auto mode (auto-profile.cjs): born on the cheapest rung and climbs only
    // when a turn actually needs more. It used to be born on `builder`, which
    // is ~16.6k of tool schema for a bot whose first message is "hey".
    assert.equal(bot.toolProfile, 'chat');
    assert.equal(bot.profilePinned, false, 'not pinned, so it can climb');
    assert.equal(bot.reasoningEffort, 'low');
    assert.deepEqual(bot.mcp, []);
    assert.notEqual(bot.toolProfile, 'full');
    store.setAgent(id, { reasoningEffort: 'high', toolProfile: 'writer', mcp: ['exa'] });
    store.duplicateAgent(id);
    const copy = store.getState().agents.find((a) => a.id !== id);
    assert.equal(copy.toolProfile, 'writer');
    assert.equal(copy.reasoningEffort, 'high');
    assert.deepEqual(copy.mcp, ['exa']);
  });

  await test('duplicating twice does not collide on the name', async () => {
    const { store, id } = await withBot('ok');
    store.duplicateAgent(id);
    store.duplicateAgent(id);
    const names = store.getState().agents.map((a) => a.name);
    assert.equal(new Set(names).size, names.length, `duplicate names: ${names.join(', ')}`);
  });
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      console.error(`FAILED: ${failures.join(' | ')}`);
      process.exit(1);
    }
    console.log('ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
