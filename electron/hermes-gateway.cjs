'use strict';

/**
 * hermes-gateway.cjs — Hydo's real backend harness for Hermes Agent.
 *
 * Drives `tui_gateway` (Hermes v0.20.x), a line-delimited JSON-RPC 2.0 agent
 * protocol over stdio, replacing the old oneshot `hermes chat -q ...` shell-out.
 *
 * WIRE CONTRACT (verified against ~/.hermes/hermes-agent on 2026-08-26):
 *   - requests   : {"jsonrpc":"2.0","id":"h1","method":"...","params":{...}}\n  → stdin
 *   - responses  : {"jsonrpc":"2.0","id":"h1","result"|"error":...}\n          ← stdout
 *   - events     : {"jsonrpc":"2.0","method":"event",
 *                   "params":{"type":"<EVENT NAME>","session_id":"...","payload":{...}}}\n
 *     The event name lives in `params.type`. The JSON-RPC `method` is the
 *     literal string "event" for every server push (tui_gateway/server.py
 *     `_event_frame`). Session-less events carry `session_id: ""`.
 *
 * ARCHITECTURE
 *   - ONE python child shared by every bot, started lazily on first use.
 *   - ONE Hermes session per bot, created with that bot's workspace as `cwd`.
 *   - botId → { sessionId (short 8-hex live handle), storedSessionId (durable
 *     id, e.g. 20260826_162052_4d1c3d), info } .
 *
 * Main-process only: CommonJS, no imports from src/.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const { activityFromTool } = require('./activity.cjs');

// ── Tunables ─────────────────────────────────────────────────────────────
//
// Reference values come from Hermes' own client, ui-tui/src/gatewayClient.ts:
//   STARTUP_TIMEOUT_MS = 15_000   (env HERMES_TUI_STARTUP_TIMEOUT_MS)
//   REQUEST_TIMEOUT_MS = 120_000  (env HERMES_TUI_RPC_TIMEOUT_MS)
// and from tui_gateway/server.py:
//   _agent_build_wait_cap() = 600s (config `agent.build_wait_timeout`)
//
// Chosen here:
//   START  60s — gatewayClient's 15s is only a *warning* deadline (it publishes
//          a `gateway.start_timeout` event and keeps waiting). Ours is a hard
//          reject, so it is 4x more generous. Cold python import on this
//          machine measured ~0.3s; 60s is pure headroom.
//   RPC    120s — matches REQUEST_TIMEOUT_MS exactly. Every RPC we issue
//          (session.create / prompt.submit / *.respond / interrupt / close)
//          returns immediately server-side; none of them stream.
//   TURN   900s — deliberately ABOVE the server's 600s `_agent_build_wait_cap`.
//          `prompt.submit` returns {status:"streaming"} before the agent is
//          necessarily built; the first message of a cold session can legally
//          sit silent for up to 600s while MCP discovery / model metadata /
//          skills scanning finish. 600s build + 300s streaming = 900s, so this
//          ceiling can never eat a message the server would still have
//          delivered.
const num = (name, fallback) => {
  const raw = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

const STARTUP_TIMEOUT_MS = num('HYDO_GATEWAY_STARTUP_TIMEOUT_MS', 60_000);
const REQUEST_TIMEOUT_MS = num('HYDO_GATEWAY_RPC_TIMEOUT_MS', 120_000);
const TURN_TIMEOUT_MS = num('HYDO_GATEWAY_TURN_TIMEOUT_MS', 900_000);

// Bounded diagnostics ring — mirrors gatewayClient's MAX_GATEWAY_LOG_LINES /
// MAX_LOG_LINE_BYTES so a chatty child can never grow memory without bound.
const MAX_LOG_LINES = 200;
const MAX_LOG_LINE_BYTES = 4096;

const HERMES_ROOT = path.join(os.homedir(), '.hermes', 'hermes-agent');

/** Approval choices tui_gateway understands (tools/approval.py `_ApprovalEntry.result`). */
const APPROVAL_CHOICES = ['once', 'session', 'always', 'deny'];

// ── Module state ─────────────────────────────────────────────────────────
//
// ONE CHILD PER TOOL PROFILE.
//
// Hermes resolves a session's toolset from the env var HERMES_TUI_TOOLSETS,
// read inside `_make_agent` at agent-build time (server.py:7799 →
// `_load_enabled_toolsets`, server.py:5255). It is process environment, not an
// RPC parameter, and the only RPC that changes it — `tools.configure`
// (methods_tools.py:1565) — calls `save_config`, i.e. it rewrites
// ~/.hermes/config.yaml globally. Hydo does not write that file, and a global
// write would be wrong anyway: it would move every teammate at once.
//
// So a per-bot toolset means a per-profile CHILD. Bots that share a profile
// share a python process; a new profile costs one more. This is the whole
// mechanism behind the context saving — measured at 24,711 → 10,318 prompt
// tokens per turn for a writing teammate. See docs/HERMES-GATEWAY.md §10.
//
// Everything that used to be one child's state is now per-runtime.

let disposed = false;

/**
 * @typedef {Object} Runtime
 * @property {string} pin              the HERMES_TUI_TOOLSETS value ('' = Hermes' own default)
 * @property {import('node:child_process').ChildProcess|null} child
 * @property {Promise<void>|null} bootPromise  shared by concurrent ensure() callers
 * @property {boolean} ready
 * @property {number} reqCounter
 * @property {Map<string, Object>} pending      request id → {method, resolve, reject, timer}
 * @property {Map<string, string>} sessionIndex sessionId → botId, scoped to this child
 * @property {string[]} logRing
 */

/** @type {Map<string, Runtime>} pin → Runtime */
const runtimes = new Map();

/** botId → BotSession. Global; each bot names its runtime via `bot.pin`. */
const bots = new Map();

/** Get (or create the record for) the runtime that serves one tool profile. */
function getRuntime(pin) {
  const key = String(pin || '');
  let rt = runtimes.get(key);
  if (!rt) {
    rt = {
      pin: key,
      child: null,
      bootPromise: null,
      ready: false,
      reqCounter: 0,
      pending: new Map(),
      sessionIndex: new Map(),
      // Highest event seq seen per session, and the gateway's replay epoch.
      // Both are the CLIENT half of Hermes' reconnect contract. `lastSeq` was
      // being written to without ever being created, so the first event frame
      // carrying a seq threw `Cannot read properties of undefined (reading
      // 'set')` . uncaught, inside a readline handler, which takes the whole
      // event stream down with it.
      lastSeq: new Map(),
      replayEpoch: '',
      logRing: [],
      // A pin naming any tool that touches disk gets file checkpoints.
      checkpoints: !key || /(^|,)(file|terminal)(,|$)/.test(key),
    };
    runtimes.set(key, rt);
  }
  return rt;
}

/** The runtime a bot's session lives on. */
function runtimeOf(botId) {
  const bot = bots.get(botId);
  return getRuntime(bot ? bot.pin : '');
}

/**
 * @typedef {Object} Turn
 * @property {string} botId
 * @property {string} sessionId
 * @property {Object} handlers
 * @property {string} text        accumulated message.delta text
 * @property {boolean} settled
 * @property {(v:any)=>void} resolve
 * @property {(e:Error)=>void} reject
 * @property {NodeJS.Timeout} timer
 */

/**
 * @typedef {Object} BotSession
 * @property {string} botId
 * @property {string} sessionId
 * @property {string} storedSessionId
 * @property {string} cwd
 * @property {string} title
 * @property {Object} info          latest session.info payload
 * @property {boolean} stale        true once the child died under it
 * @property {Turn|null} turn       in-flight turn, if any
 * @property {Promise<any>|null} creating
 */

// ── Small helpers ────────────────────────────────────────────────────────

function pushLog(rt, line) {
  const ring = rt && rt.logRing ? rt.logRing : getRuntime('').logRing;
  const tag = rt && rt.pin ? `[${rt.pin}] ` : '';
  const s = String(line == null ? '' : line);
  if (!s.trim()) return;
  const body = `${tag}${s}`;
  ring.push(
    body.length > MAX_LOG_LINE_BYTES ? `${body.slice(0, MAX_LOG_LINE_BYTES)}… [truncated]` : body
  );
  while (ring.length > MAX_LOG_LINES) ring.shift();
}

/** Invoke a consumer callback without ever letting it kill the run. */
function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return;
  try {
    fn(...args);
  } catch (err) {
    pushLog(null, `[handler] consumer callback threw: ${err && err.message}`);
  }
}

function pythonPath() {
  const configured = (process.env.HERMES_PYTHON || '').trim();
  if (configured) return configured;
  const candidates = [
    path.join(HERMES_ROOT, 'venv', 'bin', 'python'),
    path.join(HERMES_ROOT, 'venv', 'bin', 'python3'),
    path.join(HERMES_ROOT, '.venv', 'bin', 'python'),
    path.join(HERMES_ROOT, '.venv', 'bin', 'python3'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || '';
}

// ── Public: availability ─────────────────────────────────────────────────

/**
 * Is a usable Hermes gateway installed on this machine?
 *
 * Checks for both halves of the launch line: a python interpreter inside the
 * Hermes checkout's venv, and the `tui_gateway` package it will be asked to
 * run as `python -m tui_gateway.entry`.
 *
 * @returns {boolean} true when `ensure()` has a chance of succeeding.
 */
function available() {
  const py = pythonPath();
  if (!py || !fs.existsSync(py)) return false;
  return fs.existsSync(path.join(HERMES_ROOT, 'tui_gateway', 'entry.py'));
}

// ── Child lifecycle ──────────────────────────────────────────────────────

function handleLine(rt, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    pushLog(rt, `[protocol] malformed stdout: ${String(raw).trim().slice(0, 240)}`);
    return;
  }
  if (!msg || typeof msg !== 'object') return;

  // Response to one of our requests?
  if (msg.id != null && rt.pending.has(msg.id)) {
    const p = rt.pending.get(msg.id);
    rt.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) {
      const e = msg.error;
      const err = new Error(
        typeof e === 'object' && e && typeof e.message === 'string' ? e.message : `${p.method} failed`
      );
      err.code = e && e.code;
      err.method = p.method;
      p.reject(err);
    } else {
      p.resolve(msg.result);
    }
    return;
  }

  // Server-pushed event. The NAME is params.type, never msg.method.
  if (msg.method === 'event' && msg.params && typeof msg.params.type === 'string') {
    // The gateway's replay epoch. Seq counters live in the gateway PROCESS, so
    // a restart resets them to 1 while we still hold a high watermark . and
    // `events.since(sid, 97)` would then return nothing forever, with
    // `truncated: false`, so we would believe we had missed nothing. Comparing
    // the epoch is the only way to notice, so a change wipes every watermark.
    const epoch = String(msg.params.epoch || msg.params.replay_epoch || '');
    if (epoch && rt.replayEpoch && rt.replayEpoch !== epoch) {
      rt.lastSeq.clear();
    }
    if (epoch) rt.replayEpoch = epoch;
    // Every frame carries `seq`. Remembering the last one is the entire
    // client half of Hermes' documented reconnect contract: without it, a
    // resume cannot tell whether it missed anything, so mid-stream output
    // emitted while the link was down is dropped in silence . which reads as
    // a teammate that stopped mid-sentence.
    const seq = Number(msg.params.seq);
    if (Number.isFinite(seq)) {
      const sid = String(msg.params.session_id || msg.params.sessionId || '');
      if (sid) rt.lastSeq.set(sid, Math.max(rt.lastSeq.get(sid) || 0, seq));
    }
    routeEvent(rt, msg.params);
  }
}

/**
 * Attribute an event to a bot, or return null when it cannot be placed.
 *
 * Scoped to ONE runtime: session ids are short 8-hex handles minted per child,
 * so two children can legally mint the same one. Searching every bot would let
 * one profile's event surface under a bot on another profile.
 */
function ownerFor(rt, sessionId) {
  const mine = (b) => b.pin === rt.pin;
  if (sessionId) {
    const botId = rt.sessionIndex.get(sessionId);
    if (botId) {
      const bot = bots.get(botId);
      return bot && mine(bot) ? bot : null;
    }
    // Some events (session.title) carry the DURABLE id instead of the live one.
    for (const bot of bots.values()) {
      if (mine(bot) && bot.storedSessionId === sessionId) return bot;
    }
    return null;
  }
  // Session-less event (session_id is "" for e.g. sessions.changed). Attribute
  // it to the single in-flight turn ON THIS CHILD; drop it when that is
  // ambiguous rather than risk showing one bot's activity under another's name.
  const live = [...bots.values()].filter(
    (b) => mine(b) && ((b.turn && !b.turn.settled) || (b.bg && !b.bg.settled))
  );
  return live.length === 1 ? live[0] : null;
}

function routeEvent(rt, params) {
  const { type, payload } = params;
  const body = payload || {};

  if (type === 'gateway.ready') {
    rt.ready = true;
    return;
  }

  const bot = ownerFor(rt, params.session_id);
  if (!bot) return; // unattributable — drop, never misattribute
  const turn = turnForEvent(bot, type);

  switch (type) {
    case 'session.info':
      bot.info = body;
      return;

    case 'message.start':
      if (turn) safeCall(turn.handlers.onActivity, 'Thinking');
      return;

    case 'message.delta': {
      if (!turn || turn.muteDelta) return;
      const chunk = typeof body.text === 'string' ? body.text : '';
      if (!chunk) return;
      turn.text += chunk;
      safeCall(turn.handlers.onDelta, chunk);
      return;
    }

    case 'thinking.delta':
    case 'reasoning.delta':
      if (turn && typeof body.text === 'string' && body.text) {
        safeCall(turn.handlers.onThinking, body.text);
      }
      return;

    case 'status.update':
      if (turn && typeof body.text === 'string' && body.text) {
        safeCall(turn.handlers.onActivity, body.text);
      }
      return;

    case 'tool.start':
      if (turn) {
        safeCall(turn.handlers.onTool, { phase: 'start', ...body });
        safeCall(turn.handlers.onActivity, activityFromTool(body.name, body));
      }
      return;

    case 'tool.progress':
    case 'tool.generating':
      if (turn) safeCall(turn.handlers.onTool, { phase: 'progress', ...body });
      return;

    case 'tool.complete':
      if (turn) safeCall(turn.handlers.onTool, { phase: 'complete', ...body });
      return;

    case 'subagent.start':
    case 'subagent.progress':
    case 'subagent.tool':
    case 'subagent.complete':
    case 'subagent.thinking':
    case 'subagent.spawn_requested':
      // SubagentEventPayload (ui-tui/src/gatewayTypes.ts:536) — goal,
      // task_index, task_count, subagent_id, status, summary, model, cost_usd…
      if (turn) {
        if (type === 'subagent.start' || type === 'subagent.spawn_requested') {
          turn.muteDelta = true;
          safeCall(turn.handlers.onActivity, 'Delegating');
        }
        safeCall(turn.handlers.onTool, { phase: type, ...body });
        safeCall(turn.handlers.onSubagent, { type, ...body });
      }
      return;

    // Hermes wants to tell the user something out-of-band — most commonly
    // "still starting the agent (tool discovery / model setup)" during a slow
    // cold build (server.py:2634). Keyed and replace-in-place: a later
    // notification.clear with the same key retracts it.
    case 'notification.show':
      if (turn) {
        safeCall(turn.handlers.onNotice, {
          key: body.key || body.id || '',
          text: body.text || '',
          level: body.level || 'info',
          ttlMs: body.ttl_ms == null ? null : body.ttl_ms,
        });
      }
      return;

    case 'notification.clear':
      if (turn) safeCall(turn.handlers.onNoticeClear, body.key || '');
      return;

    // Affection reaction (core-detected "ily" / "<3" / "good bot" → hearts).
    // NOT the tapback reaction set by `message.react` — different mechanism,
    // confusingly the same event name. server.py:6937.
    case 'reaction':
      if (turn) safeCall(turn.handlers.onAffection, body.kind || '');
      return;

    case 'approval.request':
      // payload carries request_id (tools/approval.py `_ApprovalEntry` seeds
      // one), command, description, choices, allow_permanent, smart_denied.
      if (turn) {
        safeCall(turn.handlers.onActivity, 'Waiting for approval');
        safeCall(turn.handlers.onApproval, { botId: bot.botId, ...body });
      }
      return;

    case 'clarify.request':
      if (turn) {
        safeCall(turn.handlers.onActivity, 'Asking');
        safeCall(turn.handlers.onClarify, { botId: bot.botId, ...body });
      }
      return;

    // ── Artifacts ────────────────────────────────────────────────────────
    //
    // `open_preview` / `close_preview` in the `desktop_ui` toolset emit these.
    // They are NOT gates: nothing is waiting on a reply, the bot is telling
    // the app to show something. Until now there was no case for them here at
    // all, so every artifact a teammate produced was dropped on the floor and
    // the tool looked broken from the model's side.
    //
    // `url` is whatever the tool normalised: an https URL, a localhost dev
    // server, or an absolute FILE PATH. The file case is the interesting one —
    // that is a chart the bot just wrote into its own workspace.
    case 'preview.open':
      if (bot) {
        safeCall(
          turn ? turn.handlers.onArtifact : rt.onArtifact,
          { botId: bot.botId, url: body.url || body.path || '', label: body.label || '' }
        );
      }
      return;

    case 'preview.close':
      if (bot) safeCall(turn ? turn.handlers.onArtifactClose : rt.onArtifactClose, { botId: bot.botId });
      return;

    case 'sudo.request':
    case 'secret.request':
    case 'terminal.request':
    case 'terminal.read.request':
    case 'preview.request':
    case 'preview.read.request':
    case 'preview.act.request':
    case 'window.request':
    case 'window.read.request':
    case 'tour.request':
    case 'mcp.setup.request':
      if (turn) {
        const gateKind = type.replace(/\.request$/, '');
        safeCall(turn.handlers.onActivity, 'Waiting for you');
        safeCall(turn.handlers.onGate, { botId: bot.botId, gateKind, ...body });
      }
      return;

    case 'message.complete':
    case 'background.complete': {
      if (!turn) return;
      const text = typeof body.text === 'string' && body.text ? body.text : turn.text;
      const out = { text, usage: body.usage || null, status: body.status || 'complete', rendered: body.rendered };
      safeCall(turn.handlers.onComplete, out);
      settleTurn(turn, null, out);
      return;
    }

    case 'error': {
      const message = (body && body.message) || 'hermes error';
      if (turn) settleTurn(turn, new Error(message));
      else pushLog(rt, `[gateway] error event for ${bot.botId}: ${message}`);
      return;
    }

    default:
      return; // everything else is informational for our purposes
  }
}

function turnForEvent(bot, type) {
  const fg = bot.turn && !bot.turn.settled ? bot.turn : null;
  const bg = bot.bg && !bot.bg.settled ? bot.bg : null;
  const t = String(type || '');
  if (t === 'background.complete' || t.startsWith('subagent.')) return bg || fg;
  return fg || bg;
}

function settleTurn(turn, err, value) {
  if (!turn || turn.settled) return;
  turn.settled = true;
  clearTimeout(turn.timer);
  const bot = bots.get(turn.botId);
  if (bot && bot.turn === turn) bot.turn = null;
  if (bot && bot.bg === turn) bot.bg = null;
  if (err) turn.reject(err);
  else turn.resolve(value);
}

/** One child died or was killed: fail everything that depended on IT only. */
function teardown(rt, reason) {
  rt.ready = false;
  rt.bootPromise = null;
  const err = new Error(reason);
  for (const p of rt.pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error(`${reason} (pending ${p.method})`));
  }
  rt.pending.clear();
  // Only this profile's bots are affected — a sibling child is still healthy.
  for (const bot of bots.values()) {
    if (bot.pin !== rt.pin) continue;
    bot.stale = true;
    if (bot.turn) settleTurn(bot.turn, err);
    if (bot.bg) settleTurn(bot.bg, err);
  }
  rt.sessionIndex.clear();
  rt.child = null;
}

function startChild(rt) {
  const py = pythonPath();
  if (!py) throw new Error(`hermes gateway not available: no python under ${HERMES_ROOT}`);

  const env = { ...process.env };
  env.PYTHONPATH = env.PYTHONPATH ? `${HERMES_ROOT}${path.delimiter}${env.PYTHONPATH}` : HERMES_ROOT;
  env.HERMES_PYTHON_SRC_ROOT = HERMES_ROOT;
  // THE lever. An empty pin means "leave it alone" — Hermes then resolves its
  // own default (config.yaml, or the coding posture when the cwd is a repo),
  // which is what a bot on the `full` profile deliberately gets.
  if (rt.pin) env.HERMES_TUI_TOOLSETS = rt.pin;
  else delete env.HERMES_TUI_TOOLSETS;
  // Checkpointing is the same shape of lever: `_make_agent` reads
  // HERMES_TUI_CHECKPOINTS from the process env (server.py:7812), and without
  // it `rollback.list` answers `{enabled:false}`. A teammate that can edit
  // files with no way to undo it is the genuinely risky configuration, so this
  // is on for every profile that can write — and pointless for one that can't.
  if (rt.checkpoints) env.HERMES_TUI_CHECKPOINTS = '1';
  else delete env.HERMES_TUI_CHECKPOINTS;

  const proc = spawn(py, ['-m', 'tui_gateway.entry'], {
    cwd: HERMES_ROOT,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  rt.child = proc;
  pushLog(rt, `[lifecycle] spawned gateway pid=${proc.pid} toolsets=${rt.pin || '(hermes default)'}`);

  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    if (rt.child !== proc) return; // stale child
    // Guarded. A throw in here is an uncaught exception inside a readline
    // handler, and it does not fail just this frame . it ends the stream, so
    // the teammate stops mid-sentence and nothing says why. No single frame
    // is worth that.
    try {
      handleLine(rt, line);
    } catch (err) {
      pushLog(rt, `[protocol] frame handler threw: ${err && err.message}`);
    }
  });
  readline.createInterface({ input: proc.stderr }).on('line', (line) => {
    pushLog(rt, `[stderr] ${String(line).trim()}`);
  });

  proc.on('error', (err) => {
    if (rt.child !== proc) return;
    pushLog(rt, `[lifecycle] child error: ${err.message}`);
    teardown(rt, `gateway spawn error: ${err.message}`);
  });
  proc.on('exit', (code, signal) => {
    if (rt.child !== proc) return;
    pushLog(rt, `[lifecycle] child exit code=${code} signal=${signal}`);
    teardown(rt, `gateway exited (code=${code} signal=${signal})`);
  });

  return proc;
}

/**
 * Start the shared gateway child (if needed) and resolve once it has pushed
 * `gateway.ready`. Concurrent callers share one boot. Safe to call on every
 * operation — it is a no-op once the child is up.
 *
 * @returns {Promise<void>}
 * @throws when the interpreter is missing, the child dies during boot, or
 *         `gateway.ready` does not arrive within STARTUP_TIMEOUT_MS.
 */
function ensure(pin) {
  try {
    require('./grok-oauth.cjs').ensureHermesXaiOauth();
  } catch {
    /* SuperGrok import is best-effort */
  }
  if (disposed) return Promise.reject(new Error('hermes gateway was shut down'));
  // Omitted pin is builder, not Hermes' fat default. Explicit '' is `full`.
  const rt = getRuntime(pin === undefined ? pinFor({ profile: DEFAULT_PROFILE }) : pin);
  if (rt.ready && rt.child && rt.child.exitCode === null && !rt.child.killed) {
    return Promise.resolve();
  }
  if (rt.bootPromise) return rt.bootPromise;

  rt.bootPromise = new Promise((resolve, reject) => {
    let proc;
    try {
      proc = startChild(rt);
    } catch (err) {
      rt.bootPromise = null;
      reject(err);
      return;
    }

    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      if (err) {
        rt.bootPromise = null;
        reject(err);
      } else {
        resolve();
      }
    };
    const poll = setInterval(() => {
      if (rt.ready) finish(null);
      else if (rt.child !== proc) finish(new Error('gateway restarted during startup'));
      else if (proc.exitCode !== null) {
        finish(new Error(`gateway exited during startup (${proc.exitCode})`));
      }
    }, 25);
    const timer = setTimeout(() => {
      finish(
        new Error(
          `gateway.ready not received within ${STARTUP_TIMEOUT_MS}ms ` +
            `(toolsets=${rt.pin || 'default'})\n${logTail(15)}`
        )
      );
    }, STARTUP_TIMEOUT_MS);
    timer.unref?.();
    poll.unref?.();
  });

  return rt.bootPromise;
}

// ── RPC ──────────────────────────────────────────────────────────────────

/**
 * Issue one JSON-RPC request and resolve with its `result`.
 * @param {string} method
 * @param {Object} [params]
 * @param {number} [timeoutMs]
 * @returns {Promise<any>}
 */
function request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS, pin) {
  const resolved = pin === undefined ? pinFor({ profile: DEFAULT_PROFILE }) : pin;
  const rt = getRuntime(resolved);
  return ensure(resolved).then(
    () =>
      new Promise((resolve, reject) => {
        const proc = rt.child;
        if (!proc || !proc.stdin || proc.exitCode !== null) {
          reject(new Error(`gateway not running: ${method}`));
          return;
        }
        const id = `h${++rt.reqCounter}`;
        const timer = setTimeout(() => {
          rt.pending.delete(id);
          reject(new Error(`timeout after ${timeoutMs}ms: ${method}`));
        }, timeoutMs);
        timer.unref?.();
        rt.pending.set(id, { method, resolve, reject, timer });
        try {
          proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        } catch (err) {
          clearTimeout(timer);
          rt.pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      })
  );
}

/**
 * Issue a session-scoped RPC on the child that actually owns that bot.
 *
 * Getting this wrong is silent: the request would land on a sibling child that
 * has never heard of the session id and answer "unknown session", so every
 * session-scoped wrapper below goes through here rather than `request()`.
 */
function requestFor(botId, method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  return request(method, params, timeoutMs, runtimeOf(botId).pin);
}

// ── Tool profiles ────────────────────────────────────────────────────────
//
// Every number below is MEASURED on this machine (`scripts/toolset-bench.cjs`),
// as prompt tokens reported by `session.context_breakdown` on a one-line turn.
//
//   profile      toolsets                                                used   tool defs
//   (default)    Hermes' own resolution, MCP connected                 24,711      12,609 + 6,408 MCP
//   builder      + terminal, delegation, session_search                14,634       8,883
//   researcher   + web                                                 10,318       5,812
//   writer       clarify, memory, todo, skills, file                    9,835       5,335
//   chat         clarify, memory, todo                                  5,082       2,200
//
// A teammate that writes ad copy was paying 12,609 tokens of tool definitions
// (plus 6,408 of MCP schema) on EVERY turn, to read a 45-token conversation.
// `builder` is the default (see DEFAULT_PROFILE). `writer` is the leanest
// profile that can still hold a conversation, remember, plan, load a skill
// and touch its own workspace. The bot rail can narrow to it.
//
// `skills` is deliberately in every profile: skills are Hermes' own answer to
// "make this bot good at X" WITHOUT permanent context cost — the toolset is 3
// tools and the skill body loads only when the agent opens it.

const TOOL_PROFILES = {
  // Pure conversation. No file access, no web, no shell.
  chat: ['clarify', 'memory', 'todo'],
  // Lean: skills + workspace. Not the Hydo default (builder is).
  writer: ['clarify', 'memory', 'todo', 'skills', 'file'],
  // Adds web research and extraction, and the ability to SHOW what it found:
  // `desktop_ui` is where `open_preview` lives, which is what turns a pile of
  // numbers into an artifact in the pane. A researcher that cannot show its
  // work is half a researcher.
  researcher: ['clarify', 'memory', 'todo', 'skills', 'file', 'web', 'desktop_ui'],
  // Adds shell, sub-agent delegation, recall, and Hermes' own computer_use
  // (cua-driver inside the Hermes child). Hydo does not ship a VLM or a
  // second computer-use stack — that comes later. Do not add `vision`.
  builder: [
    'clarify',
    'memory',
    'todo',
    'skills',
    'file',
    'web',
    'terminal',
    'delegation',
    'session_search',
    'computer_use',
    // Artifacts (`open_preview`), the in-app terminal/window readers, and the
    // mid-turn sheets. ~12 tools of schema; the price of a teammate that can
    // show you a chart instead of reading numbers at you.
    'desktop_ui',
  ],
  // Everything Hermes would give a session on its own, MCP servers included.
  // The empty pin is what expresses "do not set HERMES_TUI_TOOLSETS".
  full: null,
};

const DEFAULT_PROFILE = 'builder';

/**
 * Resolve a bot's tool profile + per-bot MCP servers into one pin string.
 *
 * MCP servers are addressable by NAME inside the same list: an entry that is
 * not a built-in toolset is looked up against `mcp_servers` in config.yaml
 * (server.py:5322-5343). That is what makes requirement #2 fall out of the
 * same mechanism — a bot only loads the MCP schema for servers it was actually
 * given, instead of every enabled server globally.
 *
 * @param {{profile?:string, toolsets?:string[], mcp?:string[]}} opts
 * @returns {string} the HERMES_TUI_TOOLSETS value ('' = Hermes' own default)
 */
function pinFor(opts = {}) {
  const name = String(opts.profile || '').trim();
  let base;
  // `toolsets` REPLACES the profile (an explicit hand-built pin).
  if (Array.isArray(opts.toolsets) && opts.toolsets.length) base = opts.toolsets.slice();
  else if (name && Object.prototype.hasOwnProperty.call(TOOL_PROFILES, name)) {
    base = TOOL_PROFILES[name];
  } else base = TOOL_PROFILES[DEFAULT_PROFILE];

  // `extraToolsets` ADDS to it. This is the difference that stops the UI being
  // the ceiling: Hermes ships 34 core toolsets and the five profiles above
  // name ten of them, so `browser`, `vision`, `image_gen`, `desktop_ui`,
  // `cronjob`, `search`, `x_search` and the rest were unreachable from Hydo at
  // any setting. The bot rail writes this list; a profile stays the sane base.
  const extra = (Array.isArray(opts.extraToolsets) ? opts.extraToolsets : [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .filter((x) => !isBlockedComputerUseMcp(x));

  // `full` means "Hermes' own resolution", which cannot be expressed as a list.
  // Asking for extras on top of it therefore has to become an explicit pin, or
  // the extras would be silently dropped.
  if (base === null) {
    if (!extra.length) return '';
    base = TOOL_PROFILES[DEFAULT_PROFILE];
  }

  const mcp = (Array.isArray(opts.mcp) ? opts.mcp : [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .filter((x) => !isBlockedComputerUseMcp(x));
  // Sorted + de-duped so two bots asking for the same set in a different order
  // share ONE child instead of spawning two identical pythons.
  const all = [
    ...new Set([...base, ...extra, ...mcp].map((x) => String(x).trim()).filter(Boolean)),
  ];
  return all.sort().join(',');
}

/**
 * The toolsets THIS Hermes actually has, straight from `toolsets.list`
 * (methods_tools.py:1634). Never a hardcoded copy: Hermes gains toolsets
 * between versions and a stale list in the renderer would quietly hide them.
 *
 * Falls back to the profile names when Hermes is not running, so the rail
 * degrades to what it can still honestly offer.
 */
async function listToolsets() {
  try {
    const res = await request('toolsets.list', {}, REQUEST_TIMEOUT_MS);
    const rows = Array.isArray(res?.toolsets) ? res.toolsets : [];
    return rows
      .filter((t) => t && t.name)
      .filter((t) => !String(t.name).startsWith('hermes-'))
      .filter((t) => !isBlockedComputerUseMcp(t.name))
      .map((t) => ({
        name: String(t.name),
        description: String(t.description || ''),
        toolCount: Number(t.tool_count) || 0,
      }));
  } catch {
    return [];
  }
}

/** MCP servers that are a second computer-use stack. Desktop control is Hermes `computer_use` only. */
const BLOCKED_COMPUTER_USE_MCP = new Set([
  'cua',
  'open-computer',
  'open_computer',
  'opencomputer',
  'computer-use',
  'computer_use',
]);

function isBlockedComputerUseMcp(name) {
  const n = String(name || '').trim().toLowerCase();
  if (BLOCKED_COMPUTER_USE_MCP.has(n)) return true;
  if (n.includes('open-computer') || n.includes('open_computer')) return true;
  if (n === 'cua' || n.startsWith('cua-') || n.endsWith('-cua')) return true;
  return false;
}

/**
 * Measured prompt tokens per turn, per profile (`scripts/toolset-bench.cjs`,
 * `session.context_breakdown` on a one-line turn). Approximate and drifting —
 * `desktop_ui` was added to builder and researcher after these were taken —
 * but the RATIO is the decision, and the ratio holds.
 *
 * This number is not just the turn's cost. Hermes spawns subagents with
 * `toolsets=None`, meaning every `delegate_task` worker INHERITS the parent's
 * toolsets and cannot narrow them (delegate_tool.py:3884, 4286). So a bot that
 * fans out ten workers pays this ten more times. On the kind of job that fans
 * out, choosing the profile is choosing the bill.
 */
const PROFILE_COST = {
  chat: 5100,
  writer: 9800,
  researcher: 11800,
  builder: 16600,
  full: 24700,
};

/** The profile names a UI may offer. */
function toolProfiles() {
  return Object.keys(TOOL_PROFILES).map((name) => ({
    name,
    toolsets: TOOL_PROFILES[name],
    isDefault: name === DEFAULT_PROFILE,
    tokens: PROFILE_COST[name] ?? null,
  }));
}

// ── Public: sessions ─────────────────────────────────────────────────────

/** Build `session.create` params, forwarding only the overrides actually set. */
function createParams(cwd, title, opts) {
  const p = { cwd, title, source: 'hydo' };
  const model = String(opts.model || '').trim();
  if (model) {
    p.model = model;
    const provider = String(opts.provider || '').trim();
    if (provider) p.provider = provider;
  }
  const effort = String(opts.reasoningEffort || '').trim();
  if (effort) p.reasoning_effort = effort;
  // Presence is part of the contract — see methods_session.py:70-74.
  if (typeof opts.fast === 'boolean') p.fast = opts.fast;
  // Hermes *identity* profile (per-bot HERMES_HOME). Not the tool-pin name.
  const hermesProfile = String(opts.hermesProfile || '').trim();
  if (hermesProfile) p.profile = hermesProfile;
  return p;
}


/**
 * Get (creating on first use) the Hermes session that belongs to one bot.
 *
 * Each bot gets its OWN session rooted at its OWN workspace directory, so
 * teammates never share files, memory or history. The directory is created if
 * it does not exist — `session.create` only records an explicit workspace when
 * the path resolves to a real directory.
 *
 * Note: `session.create` deliberately persists no DB row; the durable row is
 * created lazily on the first prompt. `storedSessionId` is nonetheless valid
 * from creation and is the id to persist on Hydo's side.
 *
 * Per-session model pinning (methods_session.py:47-73): `model` + optional
 * `provider` become a PER-SESSION override — Hermes explicitly does NOT write
 * them to config.yaml — and `reasoning_effort` / `fast` are honoured the same
 * way. `fast` is presence-sensitive: omitted inherits the profile, true pins
 * priority tier, false pins normal. We therefore only forward it when the
 * caller actually passed a boolean.
 *
 * @param {string} botId                    stable Hydo id for the teammate
 * @param {Object} opts
 * @param {string} opts.cwd
 * @param {string} [opts.title]
 * @param {string} [opts.model]             e.g. "anthropic/claude-sonnet-4"
 * @param {string} [opts.provider]          optional, resolved at build when omitted
 * @param {string} [opts.reasoningEffort]   low | medium | high (parsed server-side)
 * @param {boolean} [opts.fast]             true → priority tier, false → normal
 * @returns {Promise<{botId:string, sessionId:string, storedSessionId:string, cwd:string, title:string, info:Object}>}
 */
function sessionFor(botId, opts = {}) {
  if (!botId) return Promise.reject(new Error('sessionFor: botId required'));
  const pin = pinFor(opts);
  const existing = bots.get(botId);
  if (existing && !existing.stale) {
    // A tool profile change is a different CHILD, so the old session cannot be
    // reused — close it and build a fresh one on the right runtime. Doing this
    // lazily here is what lets the bot rail widen a teammate's tools without
    // the caller having to know a process boundary was crossed.
    if (existing.pin === pin) {
      const wantModel = String(opts.model || '').trim();
      const wantProv = String(opts.provider || '').trim();
      const wantEffort = String(opts.reasoningEffort || '').trim();
      const haveModel = String((existing.opts && existing.opts.model) || '').trim();
      const haveProv = String((existing.opts && existing.opts.provider) || '').trim();
      const haveEffort = String((existing.opts && existing.opts.reasoningEffort) || '').trim();
      if (wantModel === haveModel && wantProv === haveProv && wantEffort === haveEffort) {
        if (existing.creating) return existing.creating;
        return Promise.resolve(publicSession(existing));
      }
      pushLog(null, `[session] ${botId} moving model "${haveProv}/${haveModel}" → "${wantProv}/${wantModel}"`);
      close(botId).catch(() => {});
    }
    pushLog(null, `[session] ${botId} moving profile "${existing.pin}" → "${pin}"`);
    close(botId).catch(() => {});
  } else if (existing && existing.stale) {
    forget(botId);
  }

  if (!opts.cwd) {
    return Promise.reject(new Error(`sessionFor: cwd required for bot ${botId} (refusing homedir)`));
  }
  const cwd = path.resolve(opts.cwd);
  if (cwd === os.homedir() || cwd === path.resolve(os.homedir())) {
    return Promise.reject(new Error(`sessionFor: refusing to use the user homedir as cwd`));
  }
  const title = opts.title || botId;

  const creating = ensure(pin)
    .then(() => {
      try {
        fs.mkdirSync(cwd, { recursive: true });
      } catch (err) {
        pushLog(null, `[session] could not create workspace ${cwd}: ${err.message}`);
      }
      return request('session.create', createParams(cwd, title, opts), REQUEST_TIMEOUT_MS, pin);
    })
    .then((result) => {
      const bot = {
        botId,
        pin,
        sessionId: result.session_id,
        storedSessionId: result.stored_session_id || '',
        cwd,
        title,
        info: result.info || {},
        stale: false,
        turn: null,
        creating: null,
        opts,
      };
      bots.set(botId, bot);
      getRuntime(pin).sessionIndex.set(bot.sessionId, botId);
      return publicSession(bot);
    })
    .catch((err) => {
      bots.delete(botId);
      throw err;
    });

  // Placeholder so a second concurrent sessionFor() shares this create.
  bots.set(botId, {
    botId,
    pin,
    sessionId: '',
    storedSessionId: '',
    cwd,
    title,
    info: {},
    stale: false,
    turn: null,
    creating,
    opts,
  });
  return creating;
}

function publicSession(bot) {
  return {
    botId: bot.botId,
    // Which child, i.e. which tool profile, this session actually runs on.
    pin: bot.pin || '',
    sessionId: bot.sessionId,
    storedSessionId: bot.storedSessionId,
    cwd: bot.cwd,
    title: bot.title,
    info: bot.info,
  };
}

function requireBot(botId) {
  const bot = bots.get(botId);
  if (!bot || !bot.sessionId) throw new Error(`no hermes session for bot ${botId} (call sessionFor first)`);
  if (bot.stale) throw new Error(`hermes session for bot ${botId} is stale (gateway restarted)`);
  return bot;
}

function forget(botId) {
  const bot = bots.get(botId);
  if (!bot) return;
  if (bot.sessionId) getRuntime(bot.pin).sessionIndex.delete(bot.sessionId);
  if (bot.turn) settleTurn(bot.turn, new Error('session closed'));
  bots.delete(botId);
}

// ── Public: turns ────────────────────────────────────────────────────────

/**
 * Send one user message to a bot and stream the turn back through handlers.
 *
 * `prompt.submit` returns `{status:"streaming"}` immediately — often BEFORE the
 * agent has finished building — so this promise is settled by the
 * `message.complete` event, not by the RPC. Its ceiling (TURN_TIMEOUT_MS,
 * 900s) sits above the server's own 600s `agent.build_wait_timeout` so a slow
 * cold start can never lose the user's first message.
 *
 * @param {string} botId
 * @param {string} text
 * @param {Object} [handlers]
 * @param {(chunk:string)=>void}  [handlers.onDelta]     assistant text chunk
 * @param {(text:string)=>void}   [handlers.onThinking]  thinking/reasoning chunk
 * @param {(label:string)=>void}  [handlers.onActivity]  human label for the working row
 * @param {(evt:Object)=>void}    [handlers.onTool]      {phase:'start'|'progress'|'complete'|subagent.*, ...payload}
 * @param {(req:Object)=>void}    [handlers.onApproval]  {request_id, command, description, choices, ...}
 * @param {(req:Object)=>void}    [handlers.onClarify]   {request_id, question|questions, choices}
 * @param {(evt:Object)=>void}    [handlers.onSubagent]  {type:'subagent.*', goal, task_index, …}
 * @param {(kind:string)=>void}   [handlers.onAffection] core-detected hearts reaction
 * @param {(n:Object)=>void}      [handlers.onNotice]    {key, text, level, ttlMs} out-of-band notice
 * @param {(key:string)=>void}    [handlers.onNoticeClear] retracts a notice by key
 * @param {(payload:Object)=>void}[handlers.onComplete]  {text, usage, status}
 * @param {Object} [opts]
 * @param {string[]} [opts.notes]  bracketed note lines prepended to the prompt.
 *   Hermes has its own note channel (`_prepend_note` → model input only,
 *   server.py:11670) but it is not reachable over `prompt.submit`, so these
 *   ride on the prompt text. Consequence: they DO land in Hermes' persisted
 *   transcript. They never land in Hydo's own transcript.
 * @returns {Promise<{text:string, usage:Object|null, status:string}>}
 *          rejects on an `error` event, on interrupt, on child death, or on timeout.
 */
function submit(botId, text, handlers = {}, opts = {}) {
  return ensure(runtimeOf(botId).pin)
    .then(() => {
      const bot = requireBot(botId);
      if (bot.turn && !bot.turn.settled) {
        throw new Error(`bot ${botId} already has a turn in flight`);
      }
      return new Promise((resolve, reject) => {
        const turn = {
          botId,
          sessionId: bot.sessionId,
          handlers: handlers || {},
          text: '',
          settled: false,
          resolve,
          reject,
          timer: setTimeout(() => {
            settleTurn(turn, new Error(`turn timed out after ${TURN_TIMEOUT_MS}ms`));
          }, TURN_TIMEOUT_MS),
        };
        turn.timer.unref?.();
        bot.turn = turn;

        const notes = Array.isArray(opts.notes) ? opts.notes.filter(Boolean) : [];
        const body = String(text == null ? '' : text);
        const prompt = notes.length ? `${notes.join('\n')}\n${body}` : body;

        const method = opts.background ? 'prompt.background' : 'prompt.submit';
        requestFor(botId, method, { session_id: bot.sessionId, text: prompt }).then(
          () => {
            if (!opts.background || turn.settled) return;
            if (turn.timer) {
              clearTimeout(turn.timer);
              turn.timer = null;
            }
            bot.bg = turn;
            if (bot.turn === turn) bot.turn = null;
            safeCall(turn.handlers.onYielded, { background: true });
          },
          (err) => settleTurn(turn, err)
        );
      });
    });
}

/**
 * Answer an `approval.request` raised mid-turn.
 *
 * The default approval mode is "smart", which is exactly what makes a teammate
 * stop and ask before doing something consequential — do not force yolo.
 *
 * @param {string} botId
 * @param {string} requestId  `request_id` from the approval.request payload
 * @param {'once'|'session'|'always'|'deny'} choice
 * @param {{all?:boolean}} [opts]  all:true resolves every pending approval
 * @returns {Promise<any>}
 */
function respondApproval(botId, requestId, choice, opts = {}) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const pick = APPROVAL_CHOICES.includes(choice) ? choice : 'deny';
    return requestFor(botId, 'approval.respond', {
      session_id: bot.sessionId,
      request_id: requestId || undefined,
      choice: pick,
      all: !!opts.all,
    });
  });
}

/**
 * Answer a `clarify.request` (the agent's clarifying question).
 *
 * @param {string} botId
 * @param {string} requestId  `request_id` from the clarify.request payload
 * @param {string} answer
 * @param {{questionId?:string}} [opts]  for multi-question clarify batches
 * @returns {Promise<any>}
 */
function respondClarify(botId, requestId, answer, opts = {}) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    return requestFor(botId, 'clarify.respond', {
      session_id: bot.sessionId,
      request_id: requestId,
      answer: String(answer == null ? '' : answer),
      ...(opts.questionId ? { question_id: opts.questionId } : {}),
    });
  });
}

const GATE_RPC = {
  sudo: { method: 'sudo.respond', field: 'password' },
  secret: { method: 'secret.respond', field: 'value' },
  terminal: { method: 'terminal.read.respond', field: 'text' },
  'terminal.read': { method: 'terminal.read.respond', field: 'text' },
  preview: { method: 'preview.read.respond', field: 'text' },
  'preview.read': { method: 'preview.read.respond', field: 'text' },
  'preview.act': { method: 'preview.act.respond', field: 'text' },
  window: { method: 'window.read.respond', field: 'text' },
  'window.read': { method: 'window.read.respond', field: 'text' },
  tour: { method: 'tour.respond', field: 'text' },
  'mcp.setup': { method: 'mcp.setup.respond', field: 'result' },
};

/**
 * Answer a mid-turn sudo/secret/preview/terminal/window/tour/mcp.setup gate.
 * Hydo has no hosted preview pane — empty JSON unblocks the turn honestly.
 */
function respondGate(botId, gateKind, requestId, value) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const spec = GATE_RPC[gateKind] || GATE_RPC[String(gateKind || '').replace(/\.request$/, '')];
    if (!spec) throw new Error(`unknown gate ${gateKind}`);
    const params = {
      session_id: bot.sessionId,
      request_id: requestId,
    };
    params[spec.field] = value == null ? '' : String(value);
    return requestFor(botId, spec.method, params);
  });
}

/**
 * Stop the bot's in-flight turn. The pending `submit()` promise rejects with
 * an error whose `.interrupted` is true.
 *
 * @param {string} botId
 * @returns {Promise<any>}
 */
function interruptSubagent(botId, subagentId) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const sid = String(subagentId || '').trim();
    if (!sid) throw new Error('interruptSubagent: subagentId required');
    return requestFor(botId, 'subagent.interrupt', {
      session_id: bot.sessionId,
      subagent_id: sid,
    });
  });
}

function steerSubagent(botId, subagentId, text) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const sid = String(subagentId || '').trim();
    const body = String(text == null ? '' : text).trim();
    if (!sid) throw new Error('steerSubagent: subagentId required');
    if (!body) throw new Error('steerSubagent: text is required');
    return requestFor(botId, 'subagent.steer', {
      session_id: bot.sessionId,
      subagent_id: sid,
      text: body,
    });
  });
}

function interrupt(botId) {
  return Promise.resolve()
    .then(() => {
      const bot = requireBot(botId);
      return requestFor(botId, 'session.interrupt', { session_id: bot.sessionId }).then((res) => {
        const err = new Error('turn interrupted');
        err.interrupted = true;
        settleTurn(bot.turn, err);
        settleTurn(bot.bg, err);
        return res;
      });
    });
}

/** True while a foreground or background Hermes turn is unsettled. */
function isBusy(botId) {
  const bot = bots.get(botId);
  if (!bot) return false;
  return !!(bot.turn && !bot.turn.settled) || !!(bot.bg && !bot.bg.settled);
}

/**
 * Close one bot's Hermes session and forget it. The next `sessionFor(botId)`
 * creates a fresh one.
 * @param {string} botId
 * @returns {Promise<void>}
 */
function close(botId) {
  const bot = bots.get(botId);
  if (!bot || !bot.sessionId) {
    forget(botId);
    return Promise.resolve();
  }
  const sessionId = bot.sessionId;
  const pin = bot.pin || '';
  forget(botId);
  return request('session.close', { session_id: sessionId }, REQUEST_TIMEOUT_MS, pin)
    .then(() => undefined)
    .catch((err) => {
      pushLog(null, `[session] close failed for ${botId}: ${err.message}`);
    });
}

/**
 * Close every session and kill the shared child. After this the module refuses
 * further work (call from Electron's `will-quit`).
 * @returns {Promise<void>}
 */
function shutdown() {
  // NOTE: `disposed` is set only AFTER the closes. Setting it first would make
  // every `session.close` bounce off `ensure()`'s disposed guard, so the
  // sessions would be abandoned rather than closed cleanly.
  const closes = [...bots.keys()]
    .filter((id) => {
      const rt = runtimeOf(id);
      return rt.child && rt.child.exitCode === null;
    })
    .map((id) => close(id).catch(() => {}));

  return Promise.all(closes)
    .catch(() => {})
    .then(() => {
      disposed = true;
      for (const rt of runtimes.values()) {
        const proc = rt.child;
        teardown(rt, 'gateway shut down');
        if (proc && proc.exitCode === null) {
          try {
            proc.kill('SIGTERM');
          } catch {
            /* already gone */
          }
        }
      }
    });
}

// ── Public: capabilities on top of the live session ──────────────────────
//
// Every wrapper below resolves the bot's session id itself so callers never
// touch raw `request()`. Read-only wrappers that a UI polls are FAIL-SOFT
// (they resolve to a null-ish shape instead of rejecting) so a missing or
// half-booted Hermes degrades into an empty pane rather than an error dialog.

/** True when this bot already has a live Hermes session (no boot side-effect). */
function hasSession(botId) {
  const bot = bots.get(botId);
  return !!(bot && bot.sessionId && !bot.stale);
}

/** Resolve a bot's live session id, or '' when it has none. */
function sessionIdOf(botId) {
  const bot = bots.get(botId);
  return bot && !bot.stale ? bot.sessionId || '' : '';
}

function storedSessionIdOf(botId) {
  const bot = bots.get(botId);
  return bot && !bot.stale ? bot.storedSessionId || '' : '';
}

/** Wrap a read-only RPC so an unavailable gateway yields `fallback`, not a throw. */
function soft(promiseFactory, fallback, label) {
  if (!available()) return Promise.resolve(fallback);
  return promiseFactory().catch((err) => {
    pushLog(null, `[soft] ${label} failed: ${err && err.message}`);
    return fallback;
  });
}

// ── Steering ─────────────────────────────────────────────────────────────

/**
 * Talk to a teammate MID-TURN without cancelling it (methods_session.py:3552).
 *
 * The text lands on the last tool result of the next tool batch, so the model
 * sees it on its next iteration. No interrupt, no new user turn. Hermes also
 * records it as a user correction on the live turn so a reload does not lose
 * the steer.
 *
 * @param {string} botId
 * @param {string} text
 * @returns {Promise<{status:'queued'|'rejected', text:string}>}
 *   Rejects with a 4010 error when the agent is still building (no `steer`).
 */
function steer(botId, text) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const body = String(text == null ? '' : text).trim();
    if (!body) throw new Error('steer: text is required');
    return requestFor(botId, 'session.steer', { session_id: bot.sessionId, text: body });
  });
}

// ── Usage ────────────────────────────────────────────────────────────────

/**
 * Per-session token/context usage (methods_session.py:1681).
 * @returns {Promise<Object|null>} {calls,input,output,total,context_used,
 *   context_max,context_percent,model,compressions,active_subagents,…}
 */
function usage(botId) {
  const sid = sessionIdOf(botId);
  if (!sid) return Promise.resolve(null);
  return soft(() => requestFor(botId, 'session.usage', { session_id: sid }), null, 'session.usage');
}

/**
 * What actually filled the context window (methods_session.py:1705).
 * @returns {Promise<Object|null>} {categories,context_used,context_max,context_percent,model}
 */
function contextBreakdown(botId) {
  const sid = sessionIdOf(botId);
  if (!sid) return Promise.resolve(null);
  return soft(
    () => requestFor(botId, 'session.context_breakdown', { session_id: sid }),
    null,
    'session.context_breakdown'
  );
}

/**
 * Account-level dollar usage — the two-bar model behind Hermes' own /usage
 * (methods_session.py:2447). Fail-open server-side: a logged-out portal
 * returns `{ok:true, available:false}` rather than an error.
 * @returns {Promise<Object>}
 */
function addMcpServer(name, config) {
  return ensure().then(() =>
    request("mcp.servers.add", { name: String(name || "").trim(), config: config || {} })
  );
}

function usageBars() {
  return soft(() => request('usage.bars', {}), { ok: false, available: false }, 'usage.bars');
}

/** Serialized BillingState (methods_session.py:2431). Fail-open server-side. */
function billingState() {
  return soft(() => request('billing.state', {}), { ok: false, logged_in: false }, 'billing.state');
}

// ── Models ───────────────────────────────────────────────────────────────

/**
 * The model picker payload (methods_complete.py:469) — providers, their
 * models, which one is current. When `botId` names a live session the
 * payload is layered on THAT agent's live provider/model.
 *
 * @param {string} [botId]
 * @param {{refresh?:boolean, includeUnconfigured?:boolean, explicitOnly?:boolean}} [opts]
 * @returns {Promise<Object|null>}
 */
function modelOptions(botId, opts = {}) {
  const params = {};
  const sid = botId ? sessionIdOf(botId) : '';
  if (sid) params.session_id = sid;
  if (opts.refresh) params.refresh = true;
  if (opts.includeUnconfigured) params.include_unconfigured = true;
  if (opts.explicitOnly) params.explicit_only = true;
  return soft(() => request('model.options', params, REQUEST_TIMEOUT_MS, runtimeOf(botId).pin), null, 'model.options');
}

// ── History / other sessions ─────────────────────────────────────────────

/**
 * The REAL transcript Hermes holds for this bot (methods_session.py:2776).
 * Messages carry durable `row_id`s when the rows have been persisted — that
 * id is the only stable address for `message.react`.
 * @returns {Promise<{count:number, messages:Array}>}
 */
function history(botId) {
  const sid = sessionIdOf(botId);
  if (!sid) return Promise.resolve({ count: 0, messages: [] });
  return soft(
    () => requestFor(botId, 'session.history', { session_id: sid }),
    { count: 0, messages: [] },
    'session.history'
  );
}

/** Recent Hermes sessions across surfaces (methods_session.py:163). */
function listSessions(opts = {}) {
  const params = {};
  if (opts.limit) params.limit = opts.limit;
  if (opts.title) params.title = opts.title;
  return soft(() => request('session.list', params), { sessions: [] }, 'session.list');
}

/**
 * Adopt an EXISTING Hermes session as this bot's session (methods_session.py:372).
 * Used on cold start so Hydo shows the real transcript rather than only what
 * survived in its own state.json.
 *
 * @param {string} botId
 * @param {string} sessionId  durable id (or exact title) to resume
 * @returns {Promise<Object>} the public session record now bound to botId
 */
function resume(botId, sessionId, opts = {}) {
  if (!botId) return Promise.reject(new Error('resume: botId required'));
  const target = String(sessionId || '').trim();
  if (!target) return Promise.reject(new Error('resume: sessionId required'));
  const pin = pinFor(opts);
  return ensure(pin)
    .then(() =>
      request(
        'session.resume',
        { session_id: target, omit_messages: true },
        REQUEST_TIMEOUT_MS,
        pin
      )
    )
    .then((result) => {
      forget(botId);
      const bot = {
        botId,
        pin,
        sessionId: result.session_id,
        storedSessionId: result.stored_session_id || target,
        cwd: result.cwd || opts.cwd || '',
        title: result.title || opts.title || botId,
        info: result.info || {},
        stale: false,
        turn: null,
        creating: null,
        opts,
      };
      bots.set(botId, bot);
      const rt = getRuntime(pin);
      rt.sessionIndex.set(bot.sessionId, botId);
      // Replay whatever happened while we were not listening. Without this the
      // seq we track is bookkeeping nobody reads, and any blip in the link
      // silently swallows mid-stream output . which reads as a teammate that
      // stopped mid-sentence for no reason.
      replayMissed(rt, bot.sessionId).catch(() => {});
      return publicSession(bot);
    });
}

/**
 * Ask for the frames we missed, and feed them through the normal path.
 *
 * Hermes returns bare event objects (the frame's `params`), not envelopes,
 * precisely so a client can hand them straight to its existing dispatch . so
 * that is what this does rather than reimplementing a second one.
 *
 * `truncated` means the ring evicted frames between our watermark and its
 * oldest retained seq. There is no way to recover those from here, so it is
 * logged rather than papered over: a gap you know about is worth more than a
 * replay that quietly pretends to be complete.
 */
function replayMissed(rt, sessionId) {
  const sid = String(sessionId || '');
  if (!sid) return Promise.resolve();
  const since = rt.lastSeq.get(sid) || 0;
  return request('session.events.since', { session_id: sid, last_seen: since }, REQUEST_TIMEOUT_MS, rt.pin)
    .then((res) => {
      if (!res) return;
      // A restart resets the gateway's counters, so our watermark is
      // meaningless against the new epoch. Drop it rather than replay against
      // numbers that no longer refer to the same events.
      if (res.epoch && rt.replayEpoch && res.epoch !== rt.replayEpoch) {
        rt.lastSeq.delete(sid);
      }
      if (res.epoch) rt.replayEpoch = res.epoch;
      if (res.truncated) {
        pushLog(rt, `[replay] gap on ${sid}: frames older than the ring were lost`);
      }
      const frames = Array.isArray(res.events) ? res.events : [];
      for (const ev of frames) {
        if (!ev || typeof ev.type !== 'string') continue;
        const seq = Number(ev.seq);
        if (Number.isFinite(seq)) {
          rt.lastSeq.set(sid, Math.max(rt.lastSeq.get(sid) || 0, seq));
        }
        routeEvent(rt, ev);
      }
      if (frames.length) pushLog(rt, `[replay] ${frames.length} missed frame(s) on ${sid}`);
    })
    .catch((err) => {
      // An older gateway will not know the method. That is not an error worth
      // surfacing; it just means no replay is available.
      pushLog(rt, `[replay] unavailable: ${err && err.message}`);
    });
}

// ── Reactions (iOS Tapback semantics) ────────────────────────────────────

/**
 * Set or clear one author's emoji reaction on a persisted Hermes message
 * (methods_session.py:1430).
 *
 * Semantics enforced in Hermes' DB layer: ONE reaction per author per
 * message; re-sending the same emoji retracts it; `emoji: null` clears.
 *
 * ADDRESSING. Hermes addresses a message by its durable `messages.id` row id,
 * which only exists once the row has been persisted. Hydo's message ids are
 * its own uuids and mean nothing to Hermes, so callers pass EITHER:
 *   - `rowId`      — a durable id recovered from `history()`, or
 *   - `newestRole` — 'user' | 'assistant', meaning "the newest row of that
 *                    role", which is exactly the message a user tapbacks on
 *                    the live screen (methods_session.py:1447-1450).
 *
 * @param {string} botId
 * @param {Object} opts
 * @param {string|null} opts.emoji       null clears unconditionally
 * @param {number} [opts.rowId]
 * @param {'user'|'assistant'} [opts.newestRole]
 * @param {'user'|'agent'} [opts.author='user']
 * @returns {Promise<{row_id:number, reactions:Object}>}
 */
function react(botId, opts = {}) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const params = {
      session_id: bot.sessionId,
      emoji: opts.emoji === null ? null : String(opts.emoji || '').trim(),
      author: opts.author === 'agent' ? 'agent' : 'user',
    };
    if (opts.rowId != null) params.row_id = Number(opts.rowId);
    else if (opts.newestRole) params.newest_role = opts.newestRole;
    else throw new Error('react: rowId or newestRole required');
    return requestFor(botId, 'message.react', params);
  });
}

// ── Attachments ──────────────────────────────────────────────────────────
//
// All five stage into the session and are consumed by the NEXT prompt.submit.
// Hermes accepts a gateway-visible `path` OR uploaded bytes; Hydo runs the
// gateway locally, so the path form is the normal one here.

/** Non-image file → workspace artifact + an `@file:` ref (methods_prompt.py:1207). */
function attachFile(botId, filePath, opts = {}) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const params = { session_id: bot.sessionId };
    if (filePath) params.path = String(filePath);
    if (opts.dataUrl) params.data_url = String(opts.dataUrl);
    if (opts.name) params.name = String(opts.name);
    if (!params.path && !params.data_url) throw new Error('attachFile: path or dataUrl required');
    return requestFor(botId, 'file.attach', params);
  });
}

/** Image by path → vision tile (methods_prompt.py:977). */
function attachImage(botId, imagePath) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const raw = String(imagePath || '').trim();
    if (!raw) throw new Error('attachImage: path required');
    return requestFor(botId, 'image.attach', { session_id: bot.sessionId, path: raw });
  });
}

/** Image from base64 bytes, for a client that has no gateway-visible path
 *  (methods_prompt.py:1020). Hermes caps the upload size and sniffs the type. */
function attachImageBytes(botId, base64, opts = {}) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const data = String(base64 || '').trim();
    if (!data) throw new Error('attachImageBytes: content required');
    const params = { session_id: bot.sessionId, content_base64: data };
    if (opts.filename) params.filename = String(opts.filename);
    if (opts.ext) params.ext = String(opts.ext);
    return requestFor(botId, 'image.attach_bytes', params);
  });
}

/** PDF → one vision tile per page (methods_prompt.py:1081). Page rendering is
 *  slow, so this gets the full RPC ceiling. */
function attachPdf(botId, pdfPath, opts = {}) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const params = { session_id: bot.sessionId };
    if (pdfPath) params.path = String(pdfPath);
    if (opts.dataUrl) params.data_url = String(opts.dataUrl);
    if (opts.pages) params.pages = opts.pages;
    if (!params.path && !params.data_url) throw new Error('attachPdf: path or dataUrl required');
    return requestFor(botId, 'pdf.attach', params);
  });
}

/** Attach whatever image is on the OS clipboard (methods_prompt.py:937).
 *  Resolves `{attached:false, message}` when the clipboard holds no image —
 *  that is a normal answer, not an error. */
function pasteClipboard(botId) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    return requestFor(botId, 'clipboard.paste', { session_id: bot.sessionId });
  });
}

/** Drop a staged image before it is sent (methods_prompt.py:1254). */
function detachImage(botId, imagePath) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    return requestFor(botId, 'image.detach', {
      session_id: bot.sessionId,
      path: String(imagePath || ''),
    });
  });
}

// ── Learning store (Hermes' own memory / self-improvement) ────────────────

/**
 * The learning graph, pre-rendered as terminal frames (methods_tools.py:1775).
 *
 * CAVEAT, and it matters: this returns ANSI frames sized for an Ink terminal,
 * not structured nodes. It is a picture of the journey, not a queryable store.
 * Node ids for detail/edit/delete are carried inside that render.
 */
function learningFrames(opts = {}) {
  const params = {
    cols: Number(opts.cols) || 80,
    rows: Number(opts.rows) || 24,
    frames: Number(opts.frames) || 48,
  };
  return soft(() => request('learning.frames', params), null, 'learning.frames');
}

/** One journey node's current content, for an edit prefill (methods_tools.py:1799). */
function learningDetail(id) {
  return soft(() => request('learning.detail', { id: String(id || '') }), null, 'learning.detail');
}

/** Rewrite a journey node — SKILL.md or a memory chunk (methods_tools.py:1821). */
function learningEdit(id, content) {
  return request('learning.edit', { id: String(id || ''), content: String(content == null ? '' : content) });
}

/** Delete a journey node — skills archive, memories are removed (methods_tools.py:1810). */
function learningDelete(id) {
  return request('learning.delete', { id: String(id || '') });
}

/** Session/message counts over the last N days (methods_tools.py:1275). */
function insights(days = 30) {
  return soft(
    () => request('insights.get', { days: Number(days) || 30 }),
    { days, sessions: 0, messages: 0 },
    'insights.get'
  );
}

// ── Compaction ───────────────────────────────────────────────────────────

/**
 * Compress a session's history in place (`session.compress`,
 * methods_session.py:2855).
 *
 * Hermes summarises the old turns and rebuilds the system prompt, so a long
 * teammate thread stops growing toward the context ceiling instead of
 * eventually blowing it. Refuses while a turn is running — Hermes returns 4009
 * and says to interrupt first — so callers must only compress between turns.
 *
 * @param {string} botId
 * @param {{focusTopic?:string}} [opts]  what the summary should preserve detail on
 * @returns {Promise<{status:string, messages?:Array, usage?:Object, removed?:number}>}
 */
function compress(botId, opts = {}) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    const params = { session_id: bot.sessionId };
    const focus = String(opts.focusTopic || '').trim();
    if (focus) params.focus_topic = focus;
    // Summarising a long history is a model call of its own — it needs the
    // turn ceiling, not the ordinary RPC one.
    return requestFor(botId, 'session.compress', params, TURN_TIMEOUT_MS);
  });
}

/**
 * Compress only if the window is actually filling up.
 *
 * Returns `{compressed:false}` when there is nothing to do, so a caller can run
 * this after every turn without thinking about it. The threshold is a percent
 * of `context_max` as Hermes itself reports it.
 *
 * @param {string} botId
 * @param {number} [threshold=70]
 */
function compressIfNeeded(botId, threshold = 70) {
  if (!hasSession(botId)) return Promise.resolve({ compressed: false, reason: 'no session' });
  const { contextPercent, shouldCompact } = require('./context-mgmt.cjs');
  return Promise.all([usage(botId), contextBreakdown(botId)]).then(([u, bd]) => {
    const pct = contextPercent(u, bd);
    if (!shouldCompact(pct, threshold)) return { compressed: false, percent: pct };
    return compress(botId)
      .then((res) => {
        const bot = bots.get(botId);
        const next =
          res && (res.stored_session_id || (res.info && res.info.stored_session_id));
        if (bot && next) bot.storedSessionId = next;
        return { compressed: true, percent: pct, result: res };
      })
      .catch((err) => ({ compressed: false, percent: pct, error: err.message }));
  });
}

// ── Rollback (undo what a teammate did to your files) ────────────────────
//
// Gated on checkpoints being enabled for the bot's runtime — see startChild.
// With them off every call answers `{enabled:false}` rather than erroring.

/**
 * File checkpoints taken during this session (`rollback.list`,
 * methods_tools.py:1300).
 * @returns {Promise<{enabled:boolean, checkpoints:Array<{hash,timestamp,message}>}>}
 */
function rollbackList(botId) {
  if (!hasSession(botId)) return Promise.resolve({ enabled: false, checkpoints: [] });
  return soft(
    () => requestFor(botId, 'rollback.list', { session_id: sessionIdOf(botId) }),
    { enabled: false, checkpoints: [] },
    'rollback.list'
  );
}

/** What one checkpoint changed (`rollback.diff`, methods_tools.py:1388). */
function rollbackDiff(botId, hash) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    if (!hash) throw new Error('rollbackDiff: hash required');
    return requestFor(botId, 'rollback.diff', {
      session_id: bot.sessionId,
      hash: String(hash),
    });
  });
}

/**
 * Restore a checkpoint (`rollback.restore`, methods_tools.py:1330).
 *
 * Two very different operations behind one method, and the difference matters:
 *   - with `filePath` — disk only, allowed mid-turn;
 *   - without it — a FULL rollback that also rewinds the session history, and
 *     Hermes refuses it while a turn is running.
 *
 * @param {string} botId
 * @param {string} hash
 * @param {{filePath?:string}} [opts]
 */
function rollbackRestore(botId, hash, opts = {}) {
  return Promise.resolve().then(() => {
    const bot = requireBot(botId);
    if (!hash) throw new Error('rollbackRestore: hash required');
    const params = { session_id: bot.sessionId, hash: String(hash) };
    if (opts.filePath) params.file_path = String(opts.filePath);
    return requestFor(botId, 'rollback.restore', params);
  });
}

// ── Session title ────────────────────────────────────────────────────────

/**
 * Retitle the bot's Hermes session (`session.title`, methods_session.py:1294)
 * so Hermes' own session list matches Hydo's roster after a rename. Purely
 * cosmetic — failing it must never block a rename.
 */
function setTitle(botId, title) {
  if (!hasSession(botId)) return Promise.resolve(null);
  return soft(
    () =>
      requestFor(botId, 'session.title', {
        session_id: sessionIdOf(botId),
        title: String(title || ''),
      }),
    null,
    'session.title'
  );
}

// ── Cron (Hermes' real scheduler) ────────────────────────────────────────

/**
 * Drive Hermes' cron store (methods_tools.py:1688).
 *
 * @param {'list'|'add'|'remove'|'pause'|'resume'} action
 * @param {Object} [params]  add: {name, schedule, prompt, repeat?, continuity?, deliver?, profile?}
 *                           remove/pause/resume: {name: <job id>, profile?}
 *                           list: {includeDisabled?, profile?}
 * @returns {Promise<Object>}
 */
function cron(action, params = {}) {
  const p = { action: String(action || 'list') };
  if (params.name != null) p.name = String(params.name);
  if (params.schedule != null) p.schedule = String(params.schedule);
  if (params.prompt != null) p.prompt = String(params.prompt);
  if (params.repeat != null) p.repeat = params.repeat;
  if (params.continuity != null) p.continuity = params.continuity;
  if (params.deliver != null) p.deliver = String(params.deliver);
  if (params.profile != null) p.profile = String(params.profile);
  if (p.action === 'list') {
    p.include_disabled = !!params.includeDisabled;
    return soft(() => request('cron.manage', p), { jobs: [] }, 'cron.manage');
  }
  return request('cron.manage', p);
}

/**
 * Last N lines of diagnostics, merged across every child.
 *
 * Each line is already tagged with the profile that produced it (`pushLog`),
 * so a merged tail stays readable when several children are up.
 *
 * @param {number} [n=40]
 * @param {string} [pin]  restrict to one profile's ring
 * @returns {string}
 */
function logTail(n = 40, pin) {
  if (pin != null) return getRuntime(pin).logRing.slice(-n).join('\n');
  const all = [];
  for (const rt of runtimes.values()) all.push(...rt.logRing);
  return all.slice(-n).join('\n');
}

/**
 * What is actually running right now: one row per live child.
 * @returns {Array<{pin:string, running:boolean, ready:boolean, pid:number|null, bots:string[]}>}
 */
function runtimeStatus() {
  const rows = [];
  for (const rt of runtimes.values()) {
    rows.push({
      pin: rt.pin,
      running: !!(rt.child && rt.child.exitCode === null),
      ready: rt.ready,
      pid: rt.child ? rt.child.pid : null,
      bots: [...bots.values()].filter((b) => b.pin === rt.pin).map((b) => b.botId),
    });
  }
  return rows;
}

function addMcpServer(name, config) {
  return ensure().then(() =>
    request("mcp.servers.add", { name: String(name || "").trim(), config: config || {} })
  );
}

module.exports = {
  available,
  ensure,
  // tool profiles — the context-cost lever
  TOOL_PROFILES,
  PROFILE_COST,
  listToolsets,
  DEFAULT_PROFILE,
  toolProfiles,
  pinFor,
  addMcpServer,
  isBlockedComputerUseMcp,
  runtimeStatus,
  sessionFor,
  hasSession,
  sessionIdOf,
  storedSessionIdOf,
  submit,
  respondApproval,
  respondClarify,
  respondGate,
  interrupt,
  isBusy,
  interruptSubagent,
  steerSubagent,
  steer,
  close,
  shutdown,
  logTail,
  // usage + billing
  usage,
  contextBreakdown,
  usageBars,
  billingState,
  // models
  modelOptions,
  // history / other sessions
  history,
  listSessions,
  resume,
  // reactions
  react,
  // attachments
  attachFile,
  attachImage,
  attachImageBytes,
  attachPdf,
  pasteClipboard,
  detachImage,
  // learning store
  learningFrames,
  learningDetail,
  learningEdit,
  learningDelete,
  insights,
  // compaction
  compress,
  compressIfNeeded,
  // rollback
  rollbackList,
  rollbackDiff,
  rollbackRestore,
  // misc
  setTitle,
  // scheduler
  cron,
  // escape hatch for methods this module does not wrap (mcp.* lives in
  // hermes-plugins.cjs, which uses this). NEVER exposed to the renderer.
  request,
  HERMES_ROOT,
  TIMEOUTS: { STARTUP_TIMEOUT_MS, REQUEST_TIMEOUT_MS, TURN_TIMEOUT_MS },
};
