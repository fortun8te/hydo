'use strict';

/**
 * activity.cjs — tool name → human label for the UI's "working" row.
 *
 * This used to scrape ~/.hermes/logs/agent.log with regexes and guess. It no
 * longer guesses: hermes-gateway.cjs receives real `tool.start` events whose
 * payload carries the tool `name`, and hands that name straight to
 * `activityFromTool`.
 *
 * Pure function, no I/O, no state.
 */

/** Ordered matchers — first hit wins. */
const RULES = [
  // Desktop: Hermes computer_use only (cua-driver inside the Hermes child).
  [/^computer_use$/, 'On your computer'],

  // Browsing: the built-in browser tool and every chrome-devtools MCP tool.
  [/^browser_exec$/, 'Browsing'],
  [/^mcp__chrome_devtools__/, 'Browsing'],
  [/^browser[_.]/, 'Browsing'],

  // Web search vs. web read.
  [/^web_search$/, 'Searching the web'],
  [/^web_extract$/, 'Reading'],
  [/^read_file$/, 'On your computer'],
  [/^search_files$/, 'On your computer'],
  [/^write_file$/, 'On your computer'],
  [/^patch$/, 'On your computer'],
  [/^(glob|grep|list_dir)$/, 'On your computer'],

  // Shell / processes.
  [/^terminal$/, 'On your computer'],
  [/^process$/, 'On your computer'],

  // Delegation, memory, questions.
  [/^delegate_task$/, 'Delegating'],
  [/^memory$/, 'Remembering'],
  [/^clarify$/, 'Asking'],
];

/**
 * Map a Hermes tool name to the label shown in Hydo's working row.
 *
 * @param {string} name  the `name` field of a `tool.start` payload
 * @returns {string} one of: Browsing, Searching the web, Reading, Writing,
 *                  Running, Delegating, Remembering, Asking, Working.
 *                  Unknown or missing names fall back to "Working".
 */
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

function activityFromTool(name, extra) {
  const hooked = harnessActivity(name, extra);
  if (hooked) return hooked;
  const raw = String(name == null ? '' : name).trim();
  if (!raw) return 'Working';
  for (const [re, label] of RULES) {
    if (re.test(raw)) return label;
  }
  return 'Working';
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

module.exports = { activityFromTool, activityFromLine };
