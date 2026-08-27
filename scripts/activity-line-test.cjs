'use strict';

/**
 * activity-line-test — the activity line says what the teammate is doing.
 *
 * The line used to be one of eight generic words, so the whole risk in
 * `electron/activity.cjs` is the opposite one: a phrase that sounds specific
 * and is wrong. These assertions are mostly about the FLOOR — what the mapper
 * refuses to claim — not about the pretty cases.
 *
 * Also checks the wiring, because in this codebase a mapper that is never
 * called looks exactly like one that works: the store must set both halves of
 * the pair, the renderer must import the mark, and the CSS class the mark
 * uses must actually exist.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { describeTool, activityFromTool, prettyServer } = require(path.join(root, 'electron/activity.cjs'));

// ---------------------------------------------------------------- MCP tools
// `mcp__<server>__<tool>` is Hermes' registration form
// (tools/mcp_tool.py `mcp_prefixed_tool_name`), sanitized so every
// non-alphanumeric character in the server name becomes an underscore.
const named = [
  ['mcp__github__create_pull_request', 'Opening a pull request on GitHub', 'github'],
  ['mcp__github__merge_pull_request', 'Merging a pull request on GitHub', 'github'],
  ['mcp__github__push_files', 'Pushing to GitHub', 'github'],
  ['mcp__github__create_issue', 'Opening an issue on GitHub', 'github'],
  ['mcp__figma__get_design_context', 'Reading a Figma file', 'figma'],
  ['mcp__figma__get_screenshot', 'Looking at a Figma frame', 'figma'],
  ['mcp__figma__create_new_file', 'Creating a Figma file', 'figma'],
  ['mcp__slack__post_message', 'Sending a Slack message', 'slack'],
  ['mcp__linear__create_issue', 'Filing a Linear issue', 'linear'],
  ['mcp__gmail__send_email', 'Sending an email', 'gmail'],
];
for (const [name, label, plugin] of named) {
  assert.deepEqual(describeTool(name), { label, plugin }, name);
}

// A server with no hand-written table still gets its product named, from the
// verb in the tool half alone.
assert.deepEqual(describeTool('mcp__notion__search'), { label: 'Searching Notion', plugin: 'notion' });
assert.deepEqual(describeTool('mcp__pencil__get_editor_state'), { label: 'Reading from Pencil', plugin: 'pencil' });
assert.deepEqual(describeTool('mcp__blender_mcp__execute_code'), { label: 'Running in Blender', plugin: 'blender_mcp' });

// A server nobody has ever heard of: title-case the slug, and NOTHING else.
assert.deepEqual(describeTool('mcp__acme_widgets__list_things'), {
  label: 'Searching Acme Widgets',
  plugin: 'acme_widgets',
});
// Unknown server AND unknown verb — the honest floor. It names the product
// (which the event proves) and stops.
assert.deepEqual(describeTool('mcp__acme_widgets__frobnicate'), {
  label: 'Working in Acme Widgets',
  plugin: 'acme_widgets',
});

// The server name is the half before the FIRST `__`, even when the tool half
// contains more of them.
assert.equal(describeTool('mcp__figma__weave_run_tool').plugin, 'figma');

// chrome-devtools is a browser, not a product. It says so, and offers no
// brand mark — there is no chrome asset in plugin-icons.js and an icon slug
// that resolves to nothing is how a 0x0 box gets shipped.
assert.deepEqual(describeTool('mcp__chrome_devtools__navigate_page'), { label: 'Browsing', plugin: '' });

// ------------------------------------------------------------ built-in tools
assert.deepEqual(describeTool('computer_use'), { label: 'On your computer', plugin: '' });
assert.deepEqual(describeTool('web_search'), { label: 'Searching the web', plugin: '' });
assert.deepEqual(describeTool('read_file'), { label: 'Reading a file', plugin: '' });
assert.deepEqual(describeTool('write_file'), { label: 'Writing a file', plugin: '' });
assert.deepEqual(describeTool('grep'), { label: 'Searching your files', plugin: '' });
assert.deepEqual(describeTool('browser_exec'), { label: 'Browsing', plugin: '' });
assert.deepEqual(describeTool('delegate_task'), { label: 'Delegating', plugin: '' });

// The terminal names the program, and ONLY when the args carry one. It never
// prints the whole command line: the rail is one short row.
assert.equal(activityFromTool('terminal', { command: 'npm test -- --watch' }), 'Running npm');
assert.equal(activityFromTool('terminal', {}), 'Running a command');
assert.equal(activityFromTool('terminal', { command: './scripts/weird thing' }), 'Running a command');
assert.equal(activityFromTool('terminal', { command: '$(evil)' }), 'Running a command');
assert.equal(activityFromTool('terminal', { args: { command: 'git status' } }), 'Running git');

// The harness hooks still win over everything, including over the MCP split.
assert.equal(activityFromTool('terminal', { command: 'grok --no-auto-update -p fix it' }), 'Connecting to Grok Build');
assert.equal(activityFromTool('bash', { args: ['opencode', 'run'] }), 'Connecting to OpenCode');
assert.equal(activityFromTool('terminal', { command: 'cursor agent -p' }), 'Connecting to Cursor');

// Never a guess. An unknown tool, a missing name, junk — all "Working".
for (const junk of ['', null, undefined, 'frobnicate', '   ', 'mcp__', 'mcp____x']) {
  assert.deepEqual(describeTool(junk), { label: 'Working', plugin: '' }, JSON.stringify(junk));
}
// The Anthropic-OAuth wire form wraps bare Hermes tools in the same prefix
// with no server half (anthropic_adapter.py) — that must not be read as a
// server called "read".
assert.deepEqual(describeTool('mcp__read_file'), { label: 'Working', plugin: '' });

// Nothing may ever claim a call FINISHED. Everything here is present-tense.
for (const [name] of named) {
  const { label } = describeTool(name);
  assert.ok(/^[A-Z]/.test(label), `${name}: ${label}`);
  assert.ok(!/\b(ed|Done|Finished|Completed)\b/.test(label), `past tense: ${label}`);
  assert.ok(label.length <= 40, `too long for the rail: ${label}`);
}

// activityFromTool is the label half of describeTool, exactly. store.cjs pairs
// the icon to the line by comparing these two strings, so drift here silently
// strips every brand mark.
for (const [name] of named.concat([['terminal'], ['computer_use'], ['nope']])) {
  assert.equal(activityFromTool(name), describeTool(name).label, name);
}

assert.equal(prettyServer('github'), 'GitHub');
assert.equal(prettyServer('shopify_dev_mcp'), 'Shopify');
assert.equal(prettyServer(''), '');

// --------------------------------------------------------------- the wiring
const store = fs.readFileSync(path.join(root, 'electron/store.cjs'), 'utf8');
assert.ok(store.includes('describeTool'), 'store must call describeTool, not just import a name');
assert.ok(/agent\.activityIcon = said\.plugin/.test(store), 'store must set activityIcon from the mapper');
assert.ok(
  /if \(label && label !== agent\.activityDetail\) agent\.activityIcon = "";/.test(store),
  'a label from a non-tool source must drop the stale brand mark'
);

const mark = fs.readFileSync(path.join(root, 'src/screens/ActivityMark.jsx'), 'utf8');
assert.ok(/if \(!src\) return null;/.test(mark), 'an unresolved slug must render nothing, not an empty <img>');

// Every surface that shows the line must actually import the mark — a
// component nobody renders is this codebase's signature failure.
for (const file of ['src/screens/Home.jsx', 'src/screens/Sidebar.jsx', 'src/screens/Transcript.jsx']) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  assert.ok(src.includes('import ActivityMark from "./ActivityMark.jsx"'), `${file} must import ActivityMark`);
  assert.ok(/<ActivityMark\b/.test(src), `${file} must render ActivityMark`);
}

// The classes the mark uses must have real rules. An icon class with no
// matching CSS rule rendered a 0x0 box here once already.
const css = fs.readFileSync(path.join(root, 'src/screens/production.css'), 'utf8');
for (const cls of ['.hy-act-mark', '.hy-act-mark img', '.hy-act-mark--chip', '.hy-act', '.hy-act__text']) {
  assert.ok(css.includes(`${cls} {`), `production.css is missing a rule for ${cls}`);
}
assert.ok(/\.hy-act-mark \{[^}]*width: var\(--hy-act-mark-size/.test(css), '.hy-act-mark must take a real size');

console.log('activity-line-test ok');
