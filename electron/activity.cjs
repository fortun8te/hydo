'use strict';

/**
 * activity.cjs — tool event → the line the UI shows while a teammate works.
 *
 * This used to scrape ~/.hermes/logs/agent.log with regexes and guess. It no
 * longer guesses: hermes-gateway.cjs receives real `tool.start` events whose
 * payload carries the tool `name` (plus `args`, and `context`, an 80-char
 * preview built by `_tool_ctx` in tui_gateway/server.py:6432) and hands that
 * straight to `describeTool`.
 *
 * The line used to be one of eight generic words — "Working", "Browsing",
 * "On your computer" — which told you a turn was alive and nothing else. An
 * MCP tool is registered as `mcp__<server>__<tool>`
 * (tools/mcp_tool.py:6805 `mcp_prefixed_tool_name`), so the server name is
 * sitting right there in every event, and with it the real product the
 * teammate is touching. That is what this file turns into words.
 *
 * Honesty rules, because a wrong line here is worse than a vague one:
 *   - the phrase describes a call that STARTED, never one that finished
 *   - nothing is named that the event did not carry: no repo, no file, no
 *     document title unless it is literally in the args
 *   - an unrecognised tool degrades to a truthful generic line, never to a
 *     guess at intent
 *
 * Pure functions, no I/O, no state.
 */

/** Ordered matchers for built-in (non-MCP) Hermes tools — first hit wins. */
const RULES = [
  // Desktop: Hermes computer_use only (cua-driver inside the Hermes child).
  [/^computer_use$/, 'On your computer'],

  // Browsing: the built-in browser tool and every chrome-devtools MCP tool.
  [/^browser_exec$/, 'Browsing'],
  [/^mcp__chrome_devtools__/, 'Browsing'],
  [/^browser[_.]/, 'Browsing'],

  // Web search vs. web read.
  [/^web_search$/, 'Searching the web'],
  [/^web_extract$/, 'Reading a page'],

  // Files. These were all "On your computer", which is true of a dozen
  // different tools at once and so says nothing about which one is running.
  [/^read_file$/, 'Reading a file'],
  [/^write_file$/, 'Writing a file'],
  [/^patch$/, 'Editing a file'],
  [/^(glob|grep|search_files|list_dir)$/, 'Searching your files'],

  // Shell / processes. `terminal` gets a better line below when the args
  // carry a command; this is the floor for when they do not.
  [/^terminal$/, 'Running a command'],
  [/^process$/, 'Running a command'],

  // Delegation, memory, questions, plans.
  [/^delegate_task$/, 'Delegating'],
  [/^memory$/, 'Remembering'],
  [/^clarify$/, 'Asking'],
  [/^todo/, 'Planning'],
];

/**
 * Display names for MCP servers whose slug is not its own product name.
 *
 * Duplicated from `src/lib/plugin-icons.js` PLUGIN_PRETTY rather than
 * imported: that file is ESM for the renderer's bundler and this one is CJS
 * loaded by the Electron main process, and a build step to bridge two dozen
 * strings would cost more than it saves. Keyed by the SANITIZED slug, because
 * `mcp_prefixed_tool_name` replaces every non-alphanumeric character with an
 * underscore before it reaches us — "chrome-devtools" arrives as
 * "chrome_devtools".
 */
const SERVER_PRETTY = {
  github: 'GitHub',
  figma: 'Figma',
  slack: 'Slack',
  notion: 'Notion',
  linear: 'Linear',
  gmail: 'Gmail',
  gcal: 'Google Calendar',
  google_calendar: 'Google Calendar',
  gdrive: 'Google Drive',
  google_drive: 'Google Drive',
  chrome_devtools: 'Chrome',
  blender_mcp: 'Blender',
  blender: 'Blender',
  chatgpt_unlimited: 'ChatGPT',
  magnific_unlimited: 'Magnific',
  parallel_search: 'Parallel',
  z1_walkingpad: 'WalkingPad',
  searxng: 'SearXNG',
  shopify_dev_mcp: 'Shopify',
  wispr_flow: 'Wispr Flow',
  pencil: 'Pencil',
  sticky: 'Sticky',
  exa: 'Exa',
  filesystem: 'your files',
};

/**
 * Server-specific phrasings, tried before the generic verb table.
 *
 * Only tools whose name states the ACTION unambiguously get an entry. A
 * `github` tool called `get_file_contents` is left to the generic table
 * ("Reading from GitHub") rather than being dressed up, because the event
 * does not say which file and inventing one is the failure mode this whole
 * file exists to avoid.
 */
const SERVER_RULES = {
  github: [
    [/(create|open)_(draft_)?pull_request$|^create_pr$/, 'Opening a pull request on GitHub'],
    [/merge_pull_request/, 'Merging a pull request on GitHub'],
    [/pull_request_review|create_review/, 'Reviewing a pull request on GitHub'],
    [/pull_request/, 'Working on a pull request on GitHub'],
    [/^push|push_files|create_or_update_file/, 'Pushing to GitHub'],
    [/create_issue/, 'Opening an issue on GitHub'],
    [/add_issue_comment|create_comment/, 'Commenting on GitHub'],
    [/create_branch/, 'Making a branch on GitHub'],
    [/workflow|actions_/, 'Checking GitHub Actions'],
  ],
  figma: [
    [/screenshot|image/, 'Looking at a Figma frame'],
    [/design_context|variable_defs|metadata|code_connect|figjam|libraries/, 'Reading a Figma file'],
    [/create_new_file/, 'Creating a Figma file'],
    [/download_assets|export/, 'Exporting from Figma'],
    [/upload/, 'Uploading to Figma'],
  ],
  slack: [
    [/post_message|send_message|reply/, 'Sending a Slack message'],
    [/history|read|conversations_/, 'Reading Slack'],
  ],
  linear: [
    [/create_issue/, 'Filing a Linear issue'],
    [/update_issue|comment/, 'Updating a Linear issue'],
  ],
  notion: [
    [/create_page|create_database/, 'Creating a Notion page'],
    [/append|update_block|update_page/, 'Writing in Notion'],
  ],
  gmail: [
    [/send/, 'Sending an email'],
    [/draft/, 'Drafting an email'],
    [/list|search|read|get/, 'Reading email'],
  ],
};

/**
 * Generic verb table, applied to the TOOL half of `mcp__server__tool`.
 * Deliberately vague about the object — the verb is the part the tool name
 * actually tells us.
 */
const VERBS = [
  [/^(search|find|query|list|browse)/, (p) => `Searching ${p}`],
  [/^(get|read|fetch|describe|show|view|inspect|download|export|screenshot|status)/, (p) => `Reading from ${p}`],
  [/^(push|publish|deploy)/, (p) => `Pushing to ${p}`],
  [/^(send|post|comment|reply|share|upload|invite|notify)/, (p) => `Sending to ${p}`],
  [/^(create|add|new|make|generate|insert)/, (p) => `Creating in ${p}`],
  [/^(update|edit|set|patch|move|rename|resize|change|replace|apply)/, (p) => `Updating in ${p}`],
  [/^(delete|remove|trash|archive|clear)/, (p) => `Deleting in ${p}`],
  [/^(run|exec|execute|start|call|batch|wait)/, (p) => `Running in ${p}`],
];

/** `mcp__<server>__<tool>` → {server, tool}, or null for a built-in tool. */
function splitMcp(raw) {
  const name = String(raw || '');
  if (!name.startsWith('mcp__')) return null;
  const rest = name.slice(5);
  const at = rest.indexOf('__');
  // `mcp__read_file` (the Anthropic-OAuth wire form wraps bare Hermes tools
  // in the same prefix, anthropic_adapter.py:3017) has no server half.
  if (at <= 0) return null;
  return { server: rest.slice(0, at), tool: rest.slice(at + 2) };
}

/** Title-case a slug we have no pretty name for: "shopify_dev" → "Shopify Dev". */
function prettyServer(slug) {
  const key = String(slug || '').toLowerCase();
  if (SERVER_PRETTY[key]) return SERVER_PRETTY[key];
  const words = key.split(/[_\W]+/).filter(Boolean);
  if (!words.length) return '';
  return words
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

function blobOf(name, extra) {
  const bits = [name];
  if (extra && typeof extra === 'object') {
    bits.push(extra.command, extra.cmd, extra.bin);
    if (Array.isArray(extra.args)) bits.push(extra.args.join(' '));
    if (typeof extra.input === 'string') bits.push(extra.input);
  } else if (extra) bits.push(extra);
  return bits.filter(Boolean).join(' ').toLowerCase();
}

function harnessActivity(name, extra) {
  const blob = blobOf(name, extra);
  if (/\bgrok\b/.test(blob)) return 'Connecting to Grok Build';
  if (/\bopencode\b/.test(blob) || /\bopen-code\b/.test(blob)) return 'Connecting to OpenCode';
  if (/\bcursor\b/.test(blob)) return 'Connecting to Cursor';
  return '';
}

/**
 * The command a `terminal` call is about to run, when the args say so.
 *
 * Only the executable, never the whole command line: the rail is one short
 * row and a pasted `ffmpeg -i … -filter_complex …` would blow it apart. A
 * bare word only — anything with a slash, a quote or a shell operator in it
 * is not a program name we can safely print.
 */
function commandBin(extra) {
  if (!extra || typeof extra !== 'object') return '';
  let cmd = extra.command || extra.cmd || extra.bin || '';
  if (!cmd && Array.isArray(extra.args)) cmd = extra.args.join(' ');
  if (!cmd && extra.args && typeof extra.args === 'object') {
    cmd = extra.args.command || extra.args.cmd || '';
  }
  const first = String(cmd || '').trim().split(/\s+/)[0] || '';
  if (!/^[a-z][a-z0-9._-]{0,19}$/i.test(first)) return '';
  return first;
}

/**
 * Describe a `tool.start` payload.
 *
 * @param {string} name   the `name` field of the payload
 * @param {Object} [extra] the rest of the payload (`args`, `command`, …)
 * @returns {{label: string, plugin: string}}
 *   `label` is the line to show. `plugin` is the MCP server slug when there
 *   is one, for `pluginIconUrl()` to resolve into a brand mark — "" means
 *   there is no brand to show and the UI must draw nothing rather than an
 *   empty <img>, which is how this app has previously shipped 0x0 boxes.
 */
function describeTool(name, extra) {
  const raw = String(name == null ? '' : name).trim();

  // A harness shelling out to another agent is the most useful thing we can
  // say about that turn, and it is true whatever tool carried it — so it wins
  // over both the MCP and the built-in tables.
  const hooked = harnessActivity(raw, extra);
  if (hooked) return { label: hooked, plugin: '' };

  if (!raw) return { label: 'Working', plugin: '' };

  const mcp = splitMcp(raw);
  if (mcp) {
    const slug = mcp.server.toLowerCase();
    const tool = mcp.tool.toLowerCase();
    const pretty = prettyServer(slug);
    // chrome-devtools is a browser, not a product you "read from".
    if (/^chrome_devtools$/.test(slug)) return { label: 'Browsing', plugin: '' };

    const table = SERVER_RULES[slug] || SERVER_RULES[slug.replace(/_mcp$/, '')];
    if (table) {
      for (const [re, label] of table) if (re.test(tool)) return { label, plugin: slug };
    }
    for (const [re, make] of VERBS) {
      if (re.test(tool)) return { label: make(pretty), plugin: slug };
    }
    // Known server, unrecognised verb: name the product and stop. This is the
    // honest floor — it claims only what the event proves.
    return { label: pretty ? `Working in ${pretty}` : 'Working', plugin: slug };
  }

  if (/^(terminal|process)$/.test(raw)) {
    const bin = commandBin(extra);
    return { label: bin ? `Running ${bin}` : 'Running a command', plugin: '' };
  }

  for (const [re, label] of RULES) {
    if (re.test(raw)) return { label, plugin: '' };
  }
  return { label: 'Working', plugin: '' };
}

/**
 * Map a Hermes tool event to the label alone.
 *
 * Kept as the name the gateway and the store already call, and kept exactly
 * equal to `describeTool().label` — the store pairs the icon to the label by
 * comparing the two strings (see store.cjs `onActivity`), so these two must
 * never be allowed to drift apart.
 *
 * @param {string} name
 * @param {Object} [extra]
 * @returns {string} never empty; "Working" when nothing is known.
 */
function activityFromTool(name, extra) {
  return describeTool(name, extra).label;
}

/**
 * @deprecated Log scraping is gone. Kept only so a stale import cannot crash
 * the main process. Treats its argument as a tool name.
 * @param {string} line
 * @returns {string}
 */
function activityFromLine(line) {
  return activityFromTool(line);
}

module.exports = { activityFromTool, activityFromLine, describeTool, prettyServer };
