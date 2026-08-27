const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { soulSnapshot, memorySnapshot } = require("./soul.cjs");
const botHome = require("./bot-home.cjs");
const artifactLib = require("./artifacts.cjs");
const autoProfile = require("./auto-profile.cjs");
const contextMgmt = require("./context-mgmt.cjs");
const modelPick = require("./model-pick.cjs");
const routinesLib = require("./routines.cjs");

const BLOBS = [
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "magenta",
  "gray",
  "white",
];
// Every body the kernel can draw. Kept in step with src/lib/marks.js SHAPES;
// mcp-import-test's sibling `marks` check would be the place to enforce that
// if they ever drift.
const SHAPES = [
  "blob", "pebble", "bean", "egg", "teardrop", "cloud", "leaf", "dome", "arch",
  "squircle", "tablet", "capsule", "cylinder", "shield", "hex", "wedge", "gem", "crystal",
];
const PICK_SHAPES = SHAPES;
const COLOR_IDS = BLOBS;
const SHAPE_IDS = SHAPES;

function pickRandomMark(agents) {
  const list = agents || [];
  const used = new Set(list.map((a) => `${a.blob}|${a.shape}`));
  const last = list[0];
  const colors = BLOBS.filter((id) => id !== "white");
  const shapes = PICK_SHAPES;
  for (let i = 0; i < 40; i++) {
    const blob = colors[Math.floor(Math.random() * colors.length)];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    if (used.has(`${blob}|${shape}`)) continue;
    if (last && blob === last.blob) continue;
    if (last && shape === last.shape) continue;
    return { blob, shape };
  }
  for (let i = 0; i < 24; i++) {
    const blob = colors[Math.floor(Math.random() * colors.length)];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    if (!used.has(`${blob}|${shape}`)) return { blob, shape };
  }
  return {
    blob: colors[Math.floor(Math.random() * colors.length)],
    shape: shapes[Math.floor(Math.random() * shapes.length)],
  };
}
const CANNED = new Set(["Sauce", "Dev", "NanoX", "Finance Guy", "Dev's Nephew"]);
const SEED = 4;
// A channel fans every message out to every member, and each member pays for
// its own Hermes turn. Six is the ceiling so one message can't cost ten turns.
const MAX_MEMBERS = 6;
// Members reply in turn so they can answer each other. Hard stop so a chatty
// pair cannot run up turns forever — each round costs one Hermes turn per member.
const CHANNEL_ROUNDS = 3;

function landingLines() {
  return [];
}

function cannedLandingTexts(user) {
  const name = String(user || "Michael").trim() || "Michael";
  return new Set([
    `${name}. I'm here.`,
    "Point me at something.",
    "Online.",
    "What's first?",
    `Hey ${name}.`,
    "Give me a job and I'll start.",
    "Ready when you are.",
    `${name} — what are we doing?`,
    "New thread. I'm listening.",
    "Say the thing. I'll go.",
    "Hey. Don't overthink the brief.",
  ]);
}

function nowIso() {
  return new Date().toISOString();
}

function seedState() {
  return {
    hydoSeed: SEED,
    signedIn: false,
    selectedId: null,
    settings: {
      appearance: "dark",
      userName: "Michael",
      model: "grok-4.6",
      provider: "xai-oauth",
      codingModel: "",
      codingHarness: "grok-build",
      _pane: "general",
    },
    agents: [],
    channels: [],
    messages: {},
    dms: {},
    routines: {},
    sections: [],
  };
}

function normalizeChannel(ch) {
  if (!ch || typeof ch !== "object") return null;
  const members = Array.isArray(ch.members) ? ch.members.slice(0, MAX_MEMBERS) : [];
  return {
    description: "",
    last: "",
    draft: "",
    pinned: false,
    unread: false,
    hidden: false,
    sectionId: null,
    ...ch,
    kind: "channel",
    name: String(ch.name || "New Channel"),
    members,
    sectionId: ch.sectionId || null,
  };
}

function pairKey(a, b) {
  return [a, b].sort().join(":");
}

function isBlobTint(id) {
  if (typeof id !== "string") return false;
  if (BLOBS.includes(id)) return true;
  return /^#[0-9A-Fa-f]{6}$/.test(id);
}

function normalizeAgent(agent) {
  if (!agent || typeof agent !== "object") return agent;
  const blob = isBlobTint(agent.blob) ? agent.blob : "gray";
  const shape = SHAPES.includes(agent.shape) ? agent.shape : "hex";
  return {
    label: "",
    description: "",
    notifications: false,
    status: "idle",
    draft: "",
    activity: "",
    // Builder by default: files + skills + web + shell + sub-agents, still
    // sandboxed to this bot's workspace. Sits before the spread so a stored
    // choice wins. 1:1 reasoning defaults to low unless the bot is pinned higher.
    toolProfile: "builder",
    reasoningEffort: "low",
    mcp: [],
    // Roster flags. Defaults sit before the spread so an older state.json that
    // predates them still loads, and a stored value always wins.
    pinned: false,
    unread: false,
    hidden: false,
    sectionId: null,
    blob,
    shape,
    ...agent,
    blob: isBlobTint(agent.blob) ? agent.blob : blob,
    shape: SHAPES.includes(agent.shape) ? agent.shape : shape,
    status: agent.status === "working" ? "working" : "idle",
    // A crashed run can leave a stale `workingIn` in state.json. Nothing is in
    // flight after a reload, so a bot must never come back looking busy in a
    // conversation — the id is always cleared on load.
    workingIn: null,
    sectionId: agent.sectionId || null,
  };
}

function isPlaceholderRoster(agents) {
  if (!Array.isArray(agents) || agents.length === 0) return true;
  return agents.every((a) => CANNED.has(a.name));
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return seedState();
  if (isPlaceholderRoster(raw.agents)) {
    return { ...seedState(), signedIn: !!raw.signedIn, settings: { ...seedState().settings, ...(raw.settings || {}) } };
  }
  const agents = (Array.isArray(raw.agents) ? raw.agents : [])
    .filter((a) => a && !CANNED.has(a.name))
    .map(normalizeAgent);
  const routines = raw.routines && typeof raw.routines === "object" ? raw.routines : {};
  for (const a of agents) if (!Array.isArray(routines[a.id])) routines[a.id] = [];
  const live = new Set(agents.map((a) => a.id));
  // A deleted bot must not linger as a ghost member of a channel.
  const channels = (Array.isArray(raw.channels) ? raw.channels : [])
    .map(normalizeChannel)
    .filter(Boolean)
    .map((c) => ({ ...c, members: c.members.filter((id) => live.has(id)) }));
  const ids = new Set(agents.map((a) => a.id).concat(channels.map((c) => c.id)));
  const settings = {
    appearance: "dark",
    userName: "Michael",
    model: "grok-4.6",
    provider: "xai-oauth",
    codingModel: "",
    codingHarness: "grok-build",
    ...(raw.settings || {}),
  };
  settings.codingHarness = modelPick.normalizeHarness(settings.codingHarness);
  settings.model = modelPick.normalizeChatModel(settings.model);
  if (!settings.model || /muse/i.test(settings.model) || modelPick.isBannedChatModel(settings.model)) {
    settings.model = modelPick.DEFAULT_CHAT;
  }
  if (/grok/i.test(settings.model)) settings.provider = modelPick.DEFAULT_PROVIDER;
  else if (/muse/i.test(settings.model)) settings.provider = modelPick.MUSE_PROVIDER;
  const landing = cannedLandingTexts(settings.userName);
  const messages = raw.messages && typeof raw.messages === "object" ? raw.messages : {};
  for (const a of agents) {
    // One-time migration into auto mode.
    //
    // Auto is ESCALATE-ONLY on purpose, which is right inside a conversation
    // and wrong for bots that existed before auto did: they were all born on
    // `builder`, so they would sit at ~16.6k forever and auto could never
    // bring them down. Anything not hand-pinned drops to the cheapest rung
    // once, and climbs back from there as turns actually need it.
    if (a && a.profilePinned === undefined) {
      a.profilePinned = false;
      if (a.toolProfile === "builder") a.toolProfile = "chat";
    }
    if (a && a.model) a.model = modelPick.normalizeChatModel(a.model);
    if (a && (!a.model || /muse/i.test(a.model))) {
      a.model = "";
      a.provider = "";
      a.hermesSessionId = "";
    }
    const list = messages[a.id];
    if (Array.isArray(list) && list.length && list.every((m) => m && m.role === "bot" && landing.has(String(m.text || "").trim()))) {
      messages[a.id] = [];
    }
  }
  return {
    ...raw,
    hydoSeed: SEED,
    channels,
    settings,
    agents,
    messages,
    dms: raw.dms && typeof raw.dms === "object" ? raw.dms : {},
    // Artifacts a teammate produced, newest first, versioned by path.
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    // What teammates actually did, newest first. See `logAction`.
    log: Array.isArray(raw.log) ? raw.log.slice(0, 400) : [],
    routines,
    sections: Array.isArray(raw.sections)
      ? raw.sections
          .filter((s) => s && s.id && String(s.name || "").trim())
          .map((s) => ({ id: String(s.id), name: String(s.name).trim() }))
      : [],
    selectedId: ids.has(raw.selectedId) ? raw.selectedId : agents[0]?.id || channels[0]?.id || null,
  };
}

async function defaultComplete(system, user, model) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return "Got it. Local mode — no OpenRouter key — so I can't hit the model. Drop OPENROUTER_API_KEY in the env and I'll actually work.";
  }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "grok-4.6",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) return `Model HTTP ${res.status}.`;
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "Empty reply.";
}

function mentionTarget(text, agents, currentId) {
  const raw = String(text || "");
  const others = agents.filter((a) => a.id !== currentId && a.name && a.name !== "New Bot");
  const at = raw.match(/@([A-Za-z][\w'-]*)/);
  if (at) {
    const hit = others.find((a) => a.name.toLowerCase() === at[1].toLowerCase());
    if (hit) return hit;
  }
  for (const a of others) {
    const n = a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?:\\bping\\s+${n}\\b|\\bask\\s+${n}\\b|\\btell\\s+${n}\\s+to\\b|\\bhave\\s+${n}\\s+to\\b)`,
      "i"
    );
    if (re.test(raw)) return a;
  }
  return null;
}

function asDataUrl(raw, mime) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("data:image/")) return s;
  const b64 = s.replace(/^data:image\/[^;]+;base64,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64) || b64.length < 80) return "";
  return `data:${mime || "image/png"};base64,${b64.replace(/\s/g, "")}`;
}

function fileToShot(p) {
  try {
    const abs = path.resolve(String(p));
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size < 32 || st.size > 6 * 1024 * 1024) return "";
    const ext = path.extname(abs).toLowerCase();
    if (!/\.(png|jpe?g|webp|gif)$/.test(ext)) return "";
    const mime =
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/png";
    return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
  } catch {
    return "";
  }
}

/** Pull screenshot/image extras off a Hermes tool event (computer_use). */
function toolImages(evt) {
  if (!evt || typeof evt !== "object") return [];
  const bags = [evt, evt.result, evt.output, evt.content, evt.data, evt.args].filter(
    (x) => x && typeof x === "object" && !Array.isArray(x)
  );
  const found = [];
  const seen = new Set();
  const push = (src) => {
    if (!src || seen.has(src)) return;
    seen.add(src);
    found.push({ src, alt: "screenshot" });
  };
  for (const bag of bags) {
    for (const key of [
      "screenshot",
      "screenshot_path",
      "image",
      "image_path",
      "imagePath",
      "png",
      "content_base64",
      "data_url",
      "dataUrl",
    ]) {
      const v = bag[key];
      if (typeof v !== "string") continue;
      if (v.startsWith("/") || /^[A-Za-z]:\\/.test(v) || v.startsWith("file:")) push(fileToShot(v.replace(/^file:\/\//, "")));
      else push(asDataUrl(v));
    }
    if (typeof bag.path === "string" && /\.(png|jpe?g|webp|gif)$/i.test(bag.path)) {
      push(fileToShot(bag.path));
    }
  }
  return found.filter((im) => im.src);
}

const SKIP_ATTACH = new Set(["AGENTS.md", "SHARED.md", "SOUL.md", "USER.md", "MEMORY.md"]);

function describeFile(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size < 1 || st.size > 40 * 1024 * 1024) return null;
    const name = path.basename(abs);
    if (SKIP_ATTACH.has(name) || name.startsWith(".")) return null;
    const ext = path.extname(name);
    return { name, path: abs, size: st.size, ext, kind: ext.replace(".", "").toLowerCase() };
  } catch {
    return null;
  }
}

function toolFiles(evt, cwd) {
  if (!evt || typeof evt !== "object") return [];
  const root = path.resolve(String(cwd || ""));
  const bags = [evt, evt.result, evt.output, evt.args, evt.input, evt.data].filter(
    (x) => x && typeof x === "object" && !Array.isArray(x)
  );
  const found = [];
  const seen = new Set();
  const consider = (raw) => {
    const p = String(raw || "").replace(/^file:\/\//, "");
    if (!p || p.startsWith("data:")) return;
    const abs = path.resolve(root, p);
    if (root && !abs.startsWith(root)) return;
    if (seen.has(abs)) return;
    if (/\.(png|jpe?g|webp|gif)$/i.test(abs)) return;
    const row = describeFile(abs);
    if (!row) return;
    seen.add(abs);
    found.push(row);
  };
  for (const bag of bags) {
    for (const key of ["path", "file", "file_path", "filePath", "filename", "dest", "written"]) {
      if (typeof bag[key] === "string") consider(bag[key]);
    }
  }
  return found;
}

function extractDirectives(text) {
  const lines = String(text || "").split("\n");
  const keep = [];
  const dirs = { memory: [], ping: [], routine: [], react: [], reply: [], teammate: [], self: [] };
  for (const line of lines) {
    const ping = line.match(/^\s*PING:\s*(\{.*\})\s*$/i);
    // TEAMMATE: {"name":"...","description":"...","brief":"..."} — hire a NEW
    // permanent teammate, not a throwaway `delegate_task` worker. A worker
    // dies with the job and has no thread; a teammate gets a row in the
    // roster, its own Hermes home and its own history. Same strip rules as
    // every other directive: it must never reach a bubble.
    const teammate = line.match(/^\s*TEAMMATE:\s*(?:create\s*)?(\{.*\})\s*$/i);
    // SELF: {"name":"Finn","notifications":true} — a teammate changing its OWN
    // profile. "Your name is Finn" used to get "ok, I'm Finn" and a row that
    // still said New Bot forever, because nothing the model can say reaches
    // `setAgent`. Whitelisted fields only (see `applySelf`).
    const self = line.match(/^\s*SELF:\s*(?:set\s*)?(\{.*\})\s*$/i);
    const routine = line.match(/^\s*ROUTINE:\s*create\s*(\{.*\})\s*$/i);
    // REACT: {"emoji":"..."} — tapback the message being replied to. Same
    // family as the directives above, and stripped just as hard: a teammate
    // must never be able to leak the protocol into a bubble.
    const react = line.match(/^\s*REACT:\s*(\{.*\})\s*$/i);
    // REPLY: {"to":"<messageId>"} — attach this turn's bubbles to a specific
    // earlier message instead of just appending them.
    const reply = line.match(/^\s*REPLY:\s*(\{.*\})\s*$/i);
    try {
      if (ping) {
        dirs.ping.push(JSON.parse(ping[1]));
        continue;
      }
      if (teammate) {
        dirs.teammate.push(JSON.parse(teammate[1]));
        continue;
      }
      if (self) {
        dirs.self.push(JSON.parse(self[1]));
        continue;
      }
      if (routine) {
        dirs.routine.push(JSON.parse(routine[1]));
        continue;
      }
      if (react) {
        dirs.react.push(JSON.parse(react[1]));
        continue;
      }
      if (reply) {
        dirs.reply.push(JSON.parse(reply[1]));
        continue;
      }
    } catch {
      /* keep the line */
    }
    keep.push(line);
  }
  return { text: keep.join("\n").trim(), dirs };
}

function gatePrompt(kind, req) {
  if (kind === "sudo") return "Needs a sudo password to continue.";
  if (kind === "secret") {
    return req.prompt || req.env_var
      ? `Needs a secret${req.env_var ? ` (${req.env_var})` : ""}.`
      : "Needs a secret to continue.";
  }
  if (kind === "mcp.setup") return req.prompt || req.text || "MCP setup needs a reply (JSON or skip).";
  if (kind === "tour") return req.prompt || req.text || "Hermes tour step — reply or skip.";
  if (kind === "terminal.read") return req.prompt || req.text || "Paste terminal text Hermes should read, or skip.";
  if (kind === "preview.read" || kind === "preview.act") {
    return req.prompt || req.text || "Reply with preview text/JSON, or skip.";
  }
  if (kind === "window.read" || kind === "window") {
    return req.prompt || req.text || "Reply with window text, or skip.";
  }
  return req.prompt || req.text || `Hermes asked for ${kind}. Reply or skip to unblock.`;
}

function gateRespondBody(kind, body, skipped) {
  const k = String(kind || "");
  if (k === "sudo" || k === "secret") return skipped ? "" : String(body || "");
  if (k === "mcp.setup") {
    if (skipped) return JSON.stringify({ status: "skipped" });
    const raw = String(body || "").trim();
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      return JSON.stringify({ status: "ok", text: raw });
    }
  }
  if (skipped) return "";
  return String(body || "");
}

// ── Reactions ────────────────────────────────────────────────────────────
//
// Shape on a message: `reactions: [{ emoji, by, at }]` where `by` is "user" or
// a bot id. iOS Tapback semantics, matching what Hermes enforces in its own DB
// layer (methods_session.py:1430): one actor re-sending the same emoji retracts
// it. Unlike Hermes we let one actor hold several DIFFERENT emoji on a message
// — Hermes keeps one per author, so only the newest survives a round-trip
// through its store. Hydo's copy in state.json is what the UI renders, and it
// is what survives a reload.

/**
 * Toggle one emoji from one actor on a message, in place.
 * @param {Object} msg     a message object from state.messages / state.dms
 * @param {string} emoji
 * @param {string} by      "user" or a bot id
 * @returns {'added'|'removed'|'noop'}
 */
function toggleReaction(msg, emoji, by) {
  const e = String(emoji || "").trim();
  const who = String(by || "").trim();
  if (!msg || !e || !who) return "noop";
  if (!Array.isArray(msg.reactions)) msg.reactions = [];
  const i = msg.reactions.findIndex((r) => r && r.emoji === e && r.by === who);
  if (i >= 0) {
    msg.reactions.splice(i, 1);
    if (!msg.reactions.length) delete msg.reactions;
    return "removed";
  }
  msg.reactions.push({ emoji: e, by: who, at: new Date().toISOString() });
  return "added";
}

function stripEmDashes(text) {
  const s = String(text == null ? "" : text);
  return s.split(/(```[\s\S]*?```)/).map((part, i) => {
    if (i % 2 === 1) return part;
    return part
      .replace(/\s*[\u2014\u2015]\s*/g, ". ")
      .replace(/(\d)\u2013(\d)/g, "$1-$2")
      .replace(/\s*\u2013\s*/g, ", ");
  }).join("");
}

function splitBubbles(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const max = Math.max(1, Math.min(3, Number(opts.max) || 3));
  if (max === 1) return [raw];
  const parts = raw
    .split(/^\s*---\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [raw];
  if (parts.length <= max) return parts;
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join("\n")];
}

function jobDoneExtra(goal, result) {
  return `[job] worker finished. goal: ${String(goal || "").slice(0, 200)}. result: ${String(result || "").slice(0, 2000)}. User is not in this message. Decide: one short bubble if they are waiting or the result is new; otherwise SKIP.`;
}

function trackSubagent(agent, evt) {
  if (!agent || !evt) return { live: 0 };
  if (!Array.isArray(agent.subagentIds)) agent.subagentIds = [];
  const sid = String(evt.subagent_id || evt.subagentId || "").trim();
  const type = String(evt.type || "");
  if (sid && (type === "subagent.start" || type === "subagent.spawn_requested")) {
    if (!agent.subagentIds.includes(sid)) agent.subagentIds.push(sid);
    agent.lastSubagentId = sid;
  }
  if (sid && type === "subagent.complete") {
    agent.subagentIds = agent.subagentIds.filter((id) => id !== sid);
    if (agent.lastSubagentId === sid) {
      agent.lastSubagentId = agent.subagentIds[agent.subagentIds.length - 1] || "";
    }
  }
  return { live: agent.subagentIds.length, sid };
}

function standing(agent, settings, soul, memory, extra) {
  const user = settings.userName || "Michael";
  void memory;
  const parts = [
    `You are ${agent.name}${agent.label ? ` (${agent.label})` : ""}.`,
    agent.description ? String(agent.description) : "",
    soul || "",
    `The user's name is ${user}.`,
    extra || "",
  ];
  return parts.filter(Boolean).join("\n");
}

// The "don't all pile on" rule is prompt, not harness. Every member is woken
// for every message; this is what stops six teammates acking the same thing.
function channelBrief(channel, members, me, history, transcript, round) {
  const others = members.filter((m) => m.id !== me.id).map((m) => m.name);
  const lines = [
    `You are in the "${channel.name}" channel.`,
    channel.description ? `The channel is for: ${channel.description}` : "",
    others.length ? `Also here: ${others.join(", ")}.` : "You are the only one in here right now.",
    "Only speak if you have something the others would not have. Otherwise exactly SKIP.",
    round > 0
      ? "Follow-up round: SKIP unless a teammate asked you by name or you are correcting a factual error."
      : "",
    history ? `Earlier in this channel:\n${history}` : "",
    transcript ? `This exchange so far:\n${transcript}` : "",
    "Reply as yourself, in one or two short lines. Do not prefix your name.",
  ];
  return lines.filter(Boolean).join("\n");
}

function recentHistory(list, limit = 12) {
  return (list || [])
    .filter((m) => m.kind === "chat" && String(m.text || "").trim())
    .slice(-limit)
    .map((m) => `${m.role === "user" ? "User" : m.fromName || "Teammate"}: ${m.text}`)
    .join("\n");
}

function createStore(opts = {}) {
  // Must live at the top of createStore: streamThroughHermes reads it, and a
  // later `const` would TDZ.
  const COMPACT_AT_PERCENT = 70;
  const dir = opts.dir;
  if (!dir) throw new Error("createStore requires opts.dir");
  const file = path.join(dir, "state.json");
  const uuid = opts.uuid || randomUUID;
  const now = opts.now || nowIso;
  const complete = opts.complete || defaultComplete;
  const onChange = typeof opts.onChange === "function" ? opts.onChange : null;
  // Fired when a teammate says something the user is not currently looking at
  // and has notifications turned on. The store decides WHETHER to notify; the
  // main process decides HOW (see main.cjs).
  const onNotify = typeof opts.onNotify === "function" ? opts.onNotify : null;

  let state;

  // agentId → note lines owed to that teammate's NEXT turn.
  //
  // Hermes has its own channel for exactly this — `_pending_reaction_notes`
  // (methods_prompt.py:237) folds unseen reactions into the model input for the
  // next turn — but it is gated behind config `display.message_reactions`,
  // which is OFF by default and lives in ~/.hermes/config.yaml. Hydo does not
  // write that file. So `message.react` is still called (the durable record is
  // Hermes', and it lights up the moment the flag is turned on) AND the note is
  // additionally carried on the next prompt from here, so the teammate actually
  // reads the reaction today. Bounded, and drained once delivered.
  const reactionNotes = new Map();
  const MAX_REACTION_NOTES = 5;

  function oweNote(agentId, line) {
    if (!agentId || !line) return;
    const list = reactionNotes.get(agentId) || [];
    list.push(line);
    while (list.length > MAX_REACTION_NOTES) list.shift();
    reactionNotes.set(agentId, list);
  }

  function drainNotes(agentId) {
    const list = reactionNotes.get(agentId) || [];
    reactionNotes.delete(agentId);
    return list;
  }

  function load() {
    try {
      state = normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      state = seedState(uuid, now);
      save();
    }
  }

  // ── persistence ────────────────────────────────────────────────────────
  //
  // `save()` is called from 69 places, including once per streaming flush, and
  // it used to do three expensive things every time on a state that is ~470KB
  // for a real roster:
  //
  //   JSON.stringify(state, null, 2)   0.62ms, and 18% more bytes than needed
  //   writeFileSync                    a synchronous 470KB disk write
  //   publicState()                    1.07ms, a full deep clone
  //
  // The streaming path already throttles pushes to one per 100ms, so the clone
  // is ~10/sec — real, but bounded. The disk write was the actual problem: a
  // blocking 470KB `writeFileSync` ten times a second while the user watches a
  // reply stream in, when nothing reads that file until the next restart.
  //
  // So: push now, write later. Disk is coalesced onto a trailing timer and
  // forced at the points where losing it would actually matter.
  const SAVE_DEBOUNCE_MS = 900;
  let saveTimer = null;
  let saveDirty = false;

  function writeNow() {
    saveDirty = false;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Compact, not pretty. It is a machine file: 18% fewer bytes and 26%
      // less CPU per write, and `jq .` exists for the rare time anyone looks.
      fs.writeFileSync(file, JSON.stringify(state));
    } catch {
      /* disk full or permissions: the app keeps working from memory */
    }
  }

  /**
   * Persist and push. Writes to disk IMMEDIATELY.
   *
   * This is deliberately not debounced. `save()` is the end of a real change,
   * and reloading the store from disk has to see it — a test, a second store
   * over the same dir, or a crash a moment later. Debouncing this cost an
   * afternoon: `createStore()` on the same dir came back without the channel
   * that had just been created.
   *
   * The hot path uses `saveSoon()` below instead.
   */
  function save() {
    writeNow();
    if (onChange) {
      try {
        // This MUST stay a snapshot. Passing `state` directly is tempting —
        // Electron structured-clones on IPC anyway — but `onChange` is also
        // called in-process (tests, and any main-side consumer), and those
        // hold the reference while the store keeps mutating underneath them.
        // Measured: structuredClone is only 10% faster than the JSON
        // round-trip here, so there is no cheap version. The saving came from
        // doing the DISK write less often, not from cloning faster.
        onChange(publicState());
      } catch {
        /* renderer push is best-effort */
      }
    }
  }

  /**
   * Persist and push, coalescing the DISK write.
   *
   * Only for the streaming path, which fires ten times a second while a reply
   * comes in. The push still happens immediately, so the user sees every
   * token; the 470KB blocking write does not need to, because nothing reads
   * that file until the next restart. Any real change still calls `save()`.
   */
  function saveSoon() {
    saveDirty = true;
    if (!saveTimer) {
      saveTimer = setTimeout(() => {
        saveTimer = null;
        if (saveDirty) writeNow();
      }, SAVE_DEBOUNCE_MS);
    }
    if (onChange) {
      try {
        onChange(publicState());
      } catch {
        /* renderer push is best-effort */
      }
    }
  }

  /** Force the pending write out. Called on every exit path (main.cjs). */
  function flushSave() {
    if (saveDirty) writeNow();
  }

  function publicState() {
    return JSON.parse(JSON.stringify(state));
  }

  function selected() {
    return state.agents.find((a) => a.id === state.selectedId) || state.agents[0] || null;
  }

  function channelById(id) {
    return (state.channels || []).find((c) => c.id === id) || null;
  }

  // Bots and channels share one selection, so resolve whichever the id names.
  function selectedEntry() {
    const ch = channelById(state.selectedId);
    if (ch) return ch;
    return selected();
  }

  /** Resolve an id against bots first, then channels. */
  function entryById(id) {
    return state.agents.find((a) => a.id === id) || channelById(id) || null;
  }

  /** Set one boolean roster flag on a bot or a channel. */
  function setFlag(id, key, value) {
    const entry = entryById(id);
    if (!entry) return publicState();
    entry[key] = !!value;
    save();
    return publicState();
  }

  function membersOf(channel) {
    return (channel.members || [])
      .map((id) => state.agents.find((a) => a.id === id))
      .filter(Boolean);
  }

  function threadOf(id) {
    state.messages[id] ??= [];
    return state.messages[id];
  }

  function pushMsg(agentId, msg) {
    if (msg.role === "bot" && msg.kind === "chat" && msg.text) {
      msg.text = stripEmDashes(msg.text);
    }
    threadOf(agentId).push(msg);
    maybeNotify(agentId, msg);
    const agent = state.agents.find((a) => a.id === agentId) || channelById(agentId);
    if (agent && msg.kind !== "choice") {
      const head = String(msg.text || "").split("\n")[0];
      // In a channel the preview says who spoke — "Dev: yo" — because the row
      // is a room, not one teammate.
      const speaker =
        agent.kind === "channel" && msg.role === "bot" && msg.fromId
          ? state.agents.find((a) => a.id === msg.fromId)?.name
          : null;
      agent.last =
        msg.kind === "routine"
          ? `${msg.action === "deleted" ? "Deleted" : "Created"} routine ${msg.text}`
          : msg.kind === "sending"
            ? "Sending it."
            : msg.kind === "event"
              ? String(msg.text || "")
              : speaker
                ? `${speaker}: ${head}`
                : head;
      agent.updatedAt = msg.at || now();
    }
  }

  function pushRoutineNote(agentId, { action, name, routineId }) {
    const label = String(name || "").trim() || "Routine";
    pushMsg(agentId, {
      id: uuid(),
      role: "system",
      kind: "routine",
      action: action === "deleted" ? "deleted" : "created",
      fromId: agentId,
      text: label,
      routineId: routineId || null,
      at: now(),
    });
  }

  /**
   * Find a message anywhere in state by its Hydo id.
   * @returns {{msg:Object, list:Array, threadId:string, isDm:boolean}|null}
   */
  function findMessage(messageId) {
    const id = String(messageId || "");
    if (!id) return null;
    for (const [threadId, list] of Object.entries(state.messages || {})) {
      const msg = (list || []).find((m) => m && m.id === id);
      if (msg) return { msg, list, threadId, isDm: false };
    }
    for (const [key, list] of Object.entries(state.dms || {})) {
      const msg = (list || []).find((m) => m && m.id === id);
      if (msg) return { msg, list, threadId: key, isDm: true };
    }
    return null;
  }

  /**
   * Which teammate owns the Hermes session this message lives in.
   *
   * For a 1:1 thread that is the thread id itself. For a channel every member
   * has their OWN Hermes session, so a bot bubble belongs to its speaker and a
   * user bubble belongs to no single session — reactions on those stay local.
   */
  function sessionOwner(hit) {
    if (!hit) return null;
    const agent = state.agents.find((a) => a.id === hit.threadId);
    if (agent) return agent.id;
    if (hit.msg.role === "bot" && hit.msg.fromId) return hit.msg.fromId;
    return null;
  }

  /**
   * Can Hermes be told about this reaction, and how?
   *
   * Hermes addresses a reaction either by a durable `messages.id` row id — which
   * Hydo never holds, its ids are its own uuids — or by `newest_role`, meaning
   * "the newest row of that role" (methods_session.py:1447). So a reaction can
   * be forwarded truthfully ONLY when the reacted message is in fact the newest
   * of its role in that thread. Anything older would silently land on the wrong
   * message, so it is kept local instead. Returns 'user' | 'assistant' | null.
   */
  function newestRoleFor(hit, ownerId) {
    if (!hit || !ownerId) return null;
    const role = hit.msg.role === "user" ? "user" : hit.msg.role === "bot" ? "assistant" : null;
    if (!role) return null;
    const chat = (hit.list || []).filter(
      (m) => m && m.kind === "chat" && (m.role === "user" || m.role === "bot")
    );
    const sameRole = chat.filter((m) => m.role === hit.msg.role);
    const newest = sameRole[sameRole.length - 1];
    return newest && newest.id === hit.msg.id ? role : null;
  }

  /** Human name for whoever wrote a message. */
  function authorName(msg) {
    if (!msg) return "someone";
    if (msg.role === "user") return state.settings.userName || "Michael";
    const bot = state.agents.find((a) => a.id === msg.fromId);
    return bot ? bot.name : "a teammate";
  }

  /**
   * Snapshot the message being replied to.
   *
   * The original's TEXT is copied, not just its id, so the quote still renders
   * after the original is deleted — a dangling id would leave an empty header.
   * @returns {{id:string, text:string, fromId:string}|null}
   */
  function replySnapshot(threadId, messageId) {
    const id = String(messageId || "");
    if (!id) return null;
    const list = (state.messages || {})[threadId] || [];
    const msg = list.find((m) => m && m.id === id);
    if (!msg) return null;
    return {
      id,
      text: String(msg.text || ""),
      fromId: msg.fromId || (msg.role === "user" ? "user" : ""),
    };
  }

  /**
   * The line that makes a reply visible to the model.
   *
   * Without this the quote is pure decoration — Hermes only ever sees the new
   * message, so the teammate answers as if nothing was quoted.
   */
  function replyPreamble(snapshot) {
    if (!snapshot || !snapshot.text) return "";
    const who =
      snapshot.fromId === "user"
        ? state.settings.userName || "Michael"
        : (state.agents.find((a) => a.id === snapshot.fromId) || {}).name || "a teammate";
    const quoted = snapshot.text.replace(/\s+/g, " ").trim().slice(0, 400);
    return `Replying to ${who}: "${quoted}"`;
  }

  /** Stamp this turn's bot chat onto one earlier message. */
  function applyBotReply(threadId, specs, bubbles, inherit, afterId) {
    const spec = Array.isArray(specs) && specs.length ? specs[specs.length - 1] : null;
    const snapshot = (spec && spec.to && replySnapshot(threadId, spec.to)) || inherit || null;
    if (!snapshot) return;
    const targets = Array.isArray(bubbles) ? bubbles.slice() : [];
    if (afterId) {
      const list = threadOf(threadId);
      const start = list.findIndex((m) => m && m.id === afterId);
      if (start >= 0) {
        for (let i = start + 1; i < list.length; i++) {
          const m = list[i];
          if (m && m.role === "bot" && m.kind === "chat") targets.push(m);
        }
      }
    }
    for (const b of targets) {
      if (b && !b.replyTo) b.replyTo = snapshot;
    }
  }

  function snippetOf(msg) {
    const t = String(msg && msg.text ? msg.text : "").replace(/\s+/g, " ").trim();
    return t.length > 120 ? `${t.slice(0, 120)}\u2026` : t;
  }

  /**
   * Should this message raise a desktop notification?
   *
   * Three gates, all required, and this is what finally makes the per-bot
   * "Notifications" toggle mean something:
   *   1. it is a teammate actually saying words — not a status row, not an
   *      approval card, not a routine receipt;
   *   2. the SPEAKER has notifications on (in a channel that is the member who
   *      spoke, not the room);
   *   3. the user is not already looking at that conversation.
   */
  function maybeNotify(conversationId, msg) {
    if (!onNotify) return;
    if (!msg || msg.role !== "bot" || msg.kind !== "chat") return;
    const body = String(msg.text || "").trim();
    if (!body) return;
    const speaker = state.agents.find((a) => a.id === msg.fromId);
    if (!speaker || !speaker.notifications) return;
    if (state.selectedId === conversationId) return;
    const room = channelById(conversationId);
    try {
      onNotify({
        conversationId,
        agentId: speaker.id,
        title: room ? `${speaker.name} in ${room.name}` : speaker.name,
        body: body.length > 220 ? `${body.slice(0, 220)}\u2026` : body,
      });
    } catch {
      /* a failed toast must never break the turn */
    }
  }

  function dmOf(a, b) {
    state.dms ??= {};
    const k = pairKey(a, b);
    state.dms[k] ??= [];
    return state.dms[k];
  }

  function pushDm(a, b, msg) {
    dmOf(a, b).push(msg);
  }

  /**
   * Mark a teammate busy or idle, and say WHERE.
   *
   * `status` is global to the bot, so on its own it makes a teammate look like
   * it is spinning in every view at once — its 1:1 thread, the roster, and
   * every channel — while the turn actually belongs to one conversation.
   * `workingIn` is that conversation's id: the bot's own id for a 1:1 thread,
   * the channel's id for a channel turn, and null the moment the turn ends.
   * `status` is untouched so nothing that reads it regresses.
   *
   * @param {string} id
   * @param {'idle'|'working'} status
   * @param {string} [activity]        label for the working row
   * @param {string} [conversationId]  defaults to the bot's own thread
   */
  function setStatus(id, status, activity, conversationId) {
    const agent = state.agents.find((a) => a.id === id);
    if (!agent) return;
    agent.status = status;
    if (status === "idle") {
      agent.activity = "";
      // `activeAt` is the ONLY honest source for the roster's online pip.
      // A bot that has never taken a turn is not online, and the pip must not
      // claim it is; a bot that just finished one still has a warm Hermes
      // child, so it stays lit for WARM_MS (see lib/presence.js `pipOf`).
      if (agent.workingIn) agent.activeAt = now();
      agent.workingIn = null;
    } else {
      agent.workingIn = conversationId || id;
      agent.activeAt = now();
      if (activity) agent.activity = activity;
      else if (!agent.activity) agent.activity = "Working";
    }
  }

  async function runPing(agent, peer, ask, specialistUser) {
    // The peer's work is visible in the pinger's thread, so that is the
    // conversation it spins in — not the peer's own 1:1.
    setStatus(peer.id, "working", undefined, agent.id);
    pushMsg(agent.id, {
      id: uuid(),
      role: "bot",
      kind: "sending",
      fromId: agent.id,
      text: `Pinging ${peer.name}.`,
      at: now(),
    });
    save();
    const specialist = await speak(
      peer,
      specialistUser,
      "You are being pinged by another teammate. Answer them, not the user. Short.",
      agent.id
    );
    const pingAt = now();
    pushDm(agent.id, peer.id, {
      id: uuid(),
      role: "bot",
      kind: "chat",
      fromId: agent.id,
      peerId: peer.id,
      text: ask,
      at: pingAt,
    });
    for (const bubble of splitBubbles(specialist.text)) {
      pushDm(agent.id, peer.id, {
        id: uuid(),
        role: "bot",
        kind: "chat",
        fromId: peer.id,
        peerId: agent.id,
        text: bubble,
        at: pingAt,
      });
    }
    pushMsg(agent.id, {
      id: uuid(),
      role: "system",
      kind: "tally",
      fromId: peer.id,
      text: "Messaged",
      peerId: peer.id,
      at: now(),
    });
    setStatus(peer.id, "idle");
    return specialist;
  }

  /**
   * The action log: what actually happened, in order.
   *
   * The transcript is what a teammate CHOSE to say. This is what it did —
   * escalated its own tool profile, hired someone, took a checkpoint, renamed
   * itself, showed you an artifact, spawned four workers. Those either happen
   * silently or get one polite sentence, and when something goes wrong there
   * is nothing to read back.
   *
   * Deliberately small: one line each, capped, and never a place for tool
   * output. It is a ledger, not a debug dump.
   */
  const LOG_CAP = 400;

  function logAction(botId, kind, text, extra) {
    if (!botId) return;
    state.log ??= [];
    state.log.unshift({
      id: uuid(),
      botId,
      kind: String(kind || "note"),
      text: String(text || "").slice(0, 240),
      at: now(),
      ...(extra && typeof extra === "object" ? extra : {}),
    });
    if (state.log.length > LOG_CAP) state.log.length = LOG_CAP;
  }

  /**
   * A teammate's plan, lifted off the tool stream.
   *
   * Hermes' `todo` tool has no gateway method and emits no event of its own:
   * the list lives in memory on the AIAgent for the session and exists to be
   * re-injected into the model's own context after compression. It is a
   * planning aid for the model, not a store anyone can query.
   *
   * But every call RETURNS the full current list, and tool results already
   * come past us on `tool.complete`. So we read it there. That makes the plan
   * visible without asking Hermes for anything it does not offer, and without
   * a second source of truth: the model's list stays the only list, we just
   * mirror the last one it wrote.
   */
  function captureTodos(agent, evt) {
    if (!agent || !evt || evt.phase !== "complete") return false;
    if (String(evt.name || "").toLowerCase() !== "todo") return false;
    const raw = evt.result ?? evt.output ?? evt.content ?? evt.text;
    let list = raw;
    if (typeof list === "string") {
      try {
        list = JSON.parse(list);
      } catch {
        return false;
      }
    }
    if (list && !Array.isArray(list) && Array.isArray(list.todos)) list = list.todos;
    if (!Array.isArray(list)) return false;
    const items = list
      .filter((t) => t && (t.content || t.text || t.title))
      .slice(0, 60)
      .map((t) => ({
        id: String(t.id ?? ""),
        text: String(t.content || t.text || t.title).slice(0, 200),
        status: String(t.status || "pending"),
      }));
    // An empty write is the model CLEARING its plan, which is meaningful:
    // it means the work is done. Keep it, do not treat it as "no data".
    agent.todos = items;
    agent.todosAt = now();
    return true;
  }

  /**
   * A teammate showed you something it made.
   *
   * Versioned by target: rewriting `chart.html` and re-opening it is a NEW
   * VERSION of the same artifact, not a second one, so the pane can offer
   * "before / after" instead of two identical-looking cards in the roster.
   *
   * The file is NOT read here. Content is pulled on demand by the renderer
   * (see `readArtifact`), because a dashboard can be two megabytes and putting
   * that in `state.json` would bloat every save and every IPC push forever.
   */
  function recordArtifact(agent, target, label) {
    if (!agent || !target) return null;
    const key = artifactLib.artifactKey(agent.id, target);
    const cls = artifactLib.classify(target);
    const t = now();
    state.artifacts ??= [];
    const existing = state.artifacts.find((a) => a.key === key);
    if (existing) {
      existing.versions = (existing.versions || 1) + 1;
      existing.updatedAt = t;
      existing.title = artifactLib.titleFor(target, label) || existing.title;
      // Move to the front: most recently shown is most relevant.
      state.artifacts = [existing, ...state.artifacts.filter((a) => a.key !== key)];
    } else {
      state.artifacts.unshift({
        id: uuid(),
        key,
        botId: agent.id,
        target: String(target),
        kind: cls.kind,
        title: artifactLib.titleFor(target, label),
        versions: 1,
        createdAt: t,
        updatedAt: t,
      });
    }
    const row = state.artifacts.find((a) => a.key === key);
    logAction(agent.id, "artifact", `${row.versions > 1 ? "updated" : "made"} ${row.title}`);
    // Cap the roster. These are pointers, but an unbounded list still grows
    // state.json without limit on a busy bot.
    if (state.artifacts.length > 200) state.artifacts.length = 200;

    // One card in the thread, at the point in the conversation where it was
    // made. A new VERSION of an artifact already carded in this thread updates
    // that card rather than stacking another one.
    const thread = threadOf(agent.id);
    const card = thread.find((m) => m.kind === "artifact" && m.artifactId === row.id);
    if (card) {
      card.at = t;
      card.versions = row.versions;
      card.text = row.title;
    } else {
      pushMsg(agent.id, {
        id: uuid(),
        role: "bot",
        kind: "artifact",
        fromId: agent.id,
        artifactId: row.id,
        artifactKind: row.kind,
        target: row.target,
        versions: row.versions,
        text: row.title,
        at: t,
      });
    }
    return row;
  }

  /**
   * A teammate changing its OWN profile.
   *
   * "Your name is Finn" is a settings change expressed in English, and until
   * now nothing the model could say reached `setAgent`, so it agreed and the
   * roster row said New Bot forever. Same for "stop notifying me" and "you're
   * the ads one".
   *
   * Whitelisted and bounded on purpose: a bot may describe itself, it may not
   * hand itself more capability. `toolProfile`, `toolsets`, `mcp`, `model` and
   * `reasoningEffort` are deliberately NOT here — those cost money and change
   * what it is allowed to touch, and they stay yours.
   */
  function applySelf(agent, spec) {
    if (!agent || !spec || typeof spec !== "object") return false;
    const patch = {};
    if (typeof spec.name === "string") {
      const next = spec.name.trim().slice(0, 40);
      // A bot must not take a name that already addresses someone else, or
      // `mentionTarget` becomes ambiguous for good.
      const taken = state.agents.some(
        (a) => a.id !== agent.id && String(a.name).toLowerCase() === next.toLowerCase()
      );
      // "my name is Michael" is the user introducing THEMSELVES. A bot that
      // hears it and renames itself Michael has inverted the sentence, and it
      // happens often enough that the app refuses the name outright rather
      // than relying on the model to get the direction right every time.
      const isUser =
        next.toLowerCase() === String(state.settings.userName || "").trim().toLowerCase();
      if (next && !taken && !isUser && next !== agent.name) patch.name = next;
    }
    // `label` is deliberately NOT settable by the bot. It is a one-word role
    // shown next to the name in the roster, it is Michael's shorthand for his
    // own team, and every attempt a bot made at one was either its own name
    // back or a guess from its first thirty seconds. It stays a human field.
    if (typeof spec.description === "string") {
      patch.description = spec.description.trim().slice(0, 600);
    }
    if (typeof spec.notifications === "boolean") patch.notifications = spec.notifications;
    // Appearance. A teammate choosing how it looks is the cheapest kind of
    // self-determination and costs nothing: these are cosmetic fields with a
    // fixed vocabulary, validated against the real lists so a hallucinated
    // colour cannot leave the roster rendering a blank.
    if (typeof spec.blob === "string") {
      const want = spec.blob.trim().toLowerCase();
      if (COLOR_IDS.includes(want) || /^#[0-9a-f]{6}$/i.test(spec.blob.trim())) {
        patch.blob = /^#/.test(spec.blob.trim()) ? spec.blob.trim() : want;
      }
    }
    if (typeof spec.shape === "string") {
      const want = spec.shape.trim().toLowerCase();
      if (SHAPE_IDS.includes(want)) patch.shape = want;
    }
    if (!Object.keys(patch).length) return false;

    const before = agent.name;
    for (const [k, v] of Object.entries(patch)) agent[k] = v;
    agent.updatedAt = now();
    logAction(agent.id, "self", Object.keys(patch).join(", ") + " updated");
    if (patch.name && before !== patch.name) {
      // NOT "You renamed" — you did not. Say who actually did it.
      pushMsg(agent.id, {
        id: uuid(),
        role: "system",
        kind: "event",
        fromId: agent.id,
        text:
          before && before !== "New Bot"
            ? `${before} is now called ${patch.name}.`
            : `Now called ${patch.name}.`,
        at: now(),
      });
      try {
        require("./hermes-gateway.cjs").setTitle(agent.id, patch.name);
      } catch {
        /* no Hermes, nothing to retitle */
      }
    }
    return true;
  }

  /**
   * Hire a new permanent teammate on a bot's own initiative.
   *
   * This is the difference between `delegate_task` and what the reference app
   * does: a worker is a throwaway that dies with its job, while this puts a
   * new row in the roster with its own Hermes home, its own thread and its own
   * history, and then messages it.
   *
   * Deliberately NOT `createAgent`: that one steals `selectedId`, and a bot
   * hiring someone must not yank the user out of the conversation they are in.
   * The new teammate is unread instead, so the roster tells them about it.
   *
   * @param {object} hirer  the bot that asked
   * @param {{name?:string,description?:string,brief?:string,label?:string}} spec
   */
  async function spawnTeammate(hirer, spec) {
    const wanted = String(spec?.name || "").trim().slice(0, 40);
    if (!wanted) return null;
    // A duplicate name would make `mentionTarget` ambiguous forever.
    let name = wanted;
    let n = 2;
    while (state.agents.some((a) => String(a.name).toLowerCase() === name.toLowerCase())) {
      name = `${wanted} ${n++}`;
    }
    const id = uuid();
    const t = now();
    const mark = pickRandomMark(state.agents);
    state.agents.unshift({
      id,
      name,
      label: String(spec?.label || "").trim().slice(0, 24),
      description: String(spec?.description || "").trim().slice(0, 600),
      notifications: false,
      blob: mark.blob,
      shape: mark.shape,
      status: "idle",
      activity: "",
      workingIn: null,
      // Same defaults a hand-made bot gets: cheap until someone raises it.
      toolProfile: "chat",
      profilePinned: false,
      reasoningEffort: "low",
      toolsets: [],
      mcp: [],
      pinned: false,
      unread: true,
      hidden: false,
      draft: "",
      updatedAt: t,
      last: "",
      hiredBy: hirer.id,
    });
    state.messages[id] = [];
    state.routines[id] = [];

    // The hirer's thread shows the hire the way the reference app does: an
    // event line, then the same "Messaged X" tally a ping leaves.
    logAction(hirer.id, "hire", `hired ${name}`);
    pushMsg(hirer.id, {
      id: uuid(),
      role: "system",
      kind: "event",
      fromId: id,
      text: `${hirer.name} added ${name} to the team.`,
      at: now(),
    });
    save();

    const brief = String(spec?.brief || spec?.prompt || "").trim();
    if (brief) {
      const peer = state.agents.find((a) => a.id === id);
      setStatus(id, "working", "Reading the brief");
      save();
      try {
        const first = await speak(
          peer,
          brief,
          `You were just hired by ${hirer.name}, a teammate. This is your brief. Answer them, not the user. Short.`,
          id
        );
        const at = now();
        // The brief lands in the new teammate's OWN thread, so the user can
        // open it and read what it was actually told.
        pushMsg(id, {
          id: uuid(),
          role: "user",
          kind: "chat",
          fromId: hirer.id,
          text: brief,
          at,
        });
        for (const bubble of splitBubbles(String(first.text || ""))) {
          pushMsg(id, { id: uuid(), role: "bot", kind: "chat", fromId: id, text: bubble, at });
        }
      } catch {
        /* the teammate still exists; it just has not answered yet */
      }
      setStatus(id, "idle");
    }
    pushMsg(hirer.id, {
      id: uuid(),
      role: "system",
      kind: "tally",
      fromId: id,
      text: "Messaged",
      peerId: id,
      at: now(),
    });
    save();
    return id;
  }

  load();
  save();
  // Cold start: bind each teammate's durable Hermes session so a restart
  // does not orphan it. Fail-soft — tests and machines without Hermes skip.
  (function resumeStoredHermes() {
    if (opts.complete) return;
    try {
      const gateway = require("./hermes-gateway.cjs");
      if (!gateway.available()) return;
      for (const agent of state.agents || []) {
        if (!agent || !agent.hermesSessionId) continue;
        const home = botHome.prepare(dir, agent.id);
        gateway
          .resume(agent.id, agent.hermesSessionId, {
            cwd: home.cwd,
            title: agent.name,
            hermesProfile: home.profile,
            model: modelPick.sessionModel(agent, state.settings),
            provider: modelPick.sessionProvider(agent, state.settings),
            profile: agent.toolProfile || "builder",
            extraToolsets: Array.isArray(agent.toolsets) ? agent.toolsets : [],
            mcp: Array.isArray(agent.mcp) ? agent.mcp : [],
          })
          .catch(() => {});
      }
    } catch {
      /* no gateway */
    }
  })();

  function normalizeSendImages(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const im of raw.slice(0, 8)) {
      const src = im && (im.src || im.url || im.data);
      if (typeof src !== "string" || !src.startsWith("data:image/")) continue;
      if (src.length > 12_000_000) continue;
      const name = String((im && (im.name || im.filename)) || "image.png");
      const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1] || "png";
      out.push({ src, name, ext: ext.toLowerCase() });
    }
    return out;
  }

  async function attachUserImages(agent, images) {
    if (!agent || !images || !images.length) return;
    const gateway = require("./hermes-gateway.cjs");
    if (!gateway.available()) return;
    for (const im of images) {
      try {
        const b64 = String(im.src).replace(/^data:image\/[^;]+;base64,/, "");
        if (!b64) continue;
        await gateway.attachImageBytes(agent.id, b64, { filename: im.name, ext: im.ext });
      } catch {
        /* still keep the image in the transcript */
      }
    }
  }

  // Bridge a Hermes turn into the transcript as it happens: the bubble appears
  // empty and fills in, instead of the old wait-then-dump.
  async function streamThroughHermes(agent, soulText, userText, notes, convId, flags = {}) {
    const gateway = require("./hermes-gateway.cjs");
    if (!gateway.available()) throw new Error("hermes gateway not available");

    const home = botHome.prepare(dir, agent.id, soulText);
    const cwd = home.cwd;
    // Hermes context engine owns history. AGENTS.md is workspace rules + soul
    // only — dumping MEMORY.md here every turn pays for it forever.
    // Hermes loads identity from profile SOUL.md. AGENTS.md is workspace law only.
    // Rewritten only when it CHANGES. This ran on every turn with byte-
    // identical content: a pointless write, and worse, it bumped the mtime of
    // a file that sits at the front of the prompt. xAI caches on a reused
    // prefix, so anything that makes the prefix look new costs the 75%
    // cached-input discount on everything behind it.
    const agentsPath = path.join(cwd, "AGENTS.md");
    const agentsWant = `${botHome.AGENTS_STAMP}\n${modelPick.agentsModelBlock(agent, state.settings)}\n`;
    try {
      if (fs.readFileSync(agentsPath, "utf8") !== agentsWant) {
        fs.writeFileSync(agentsPath, agentsWant);
      }
    } catch {
      fs.writeFileSync(agentsPath, agentsWant);
    }

    // ── auto mode ────────────────────────────────────────────────────────
    // Pick the cheapest profile this turn can be answered with, and ratchet up
    // if it needs more. `profilePinned` means the user chose by hand in the
    // rail, and a hand-picked profile is a decision, never overridden.
    if (!agent.profilePinned) {
      const want = autoProfile.pickProfile(userText, agent.toolProfile || "chat", {
        hasAttachments: !!(flags && flags.hasAttachments),
      });
      if (want !== agent.toolProfile) {
        logAction(agent.id, "profile", `${agent.toolProfile || "chat"} to ${want}`);
        agent.toolProfile = want;
      }
    }

    const sessionOpts = {
      cwd,
      title: agent.name,
      hermesProfile: home.profile,
      model: modelPick.sessionModel(agent, state.settings),
      provider: modelPick.sessionProvider(agent, state.settings),
      // Channel turns force low when unpinned. 1:1 also defaults to low unless
      // the bot is pinned higher.
      reasoningEffort: agent.reasoningEffort || "low",
      ...(typeof agent.fast === "boolean" ? { fast: agent.fast } : {}),
      profile: agent.toolProfile || "builder",
      extraToolsets: Array.isArray(agent.toolsets) ? agent.toolsets : [],
      mcp: Array.isArray(agent.mcp) ? agent.mcp : [],
    };

    if (!gateway.hasSession(agent.id) && agent.hermesSessionId) {
      try {
        await gateway.resume(agent.id, agent.hermesSessionId, sessionOpts);
      } catch {
        await gateway.sessionFor(agent.id, sessionOpts);
      }
    } else {
      await gateway.sessionFor(agent.id, sessionOpts);
    }
    function persistHermesIds() {
      const storedId = gateway.storedSessionIdOf ? gateway.storedSessionIdOf(agent.id) : "";
      if (storedId && agent.hermesSessionId !== storedId) {
        agent.hermesSessionId = storedId;
        save();
      }
    }
    persistHermesIds();
    // User turns submit as prompt.background so bot.turn yields. Do NOT arm
    // backgroundTurn until a worker (or a long tool) actually starts — a short
    // question must not look like a live job.
    const submitBackground = !!flags.background && !flags.jobWake;
    const liveWorkers = !!(agent.subagentIds && agent.subagentIds.length);
    if (submitBackground && liveWorkers && !agent.backgroundTurn) {
      agent.backgroundTurn = {
        convId: convId || agent.id,
        startedAt: now(),
        goal: String(userText || "").slice(0, 160),
      };
      save();
    }
    let releasedEarly = false;
    let releaseEarly = () => {};
    const earlyP = new Promise((resolve) => {
      releaseEarly = () => {
        if (releasedEarly) return;
        releasedEarly = true;
        resolve("early");
      };
    });
    function mapHermesRowIds(who) {
      Promise.resolve()
        .then(() => gateway.history(who.id))
        .then((hist) => {
          const rows = hist && Array.isArray(hist.messages) ? hist.messages : [];
          if (!rows.length) return;
          const list = threadOf(who.id);
          const hydo = list.filter((m) => m && (m.role === "user" || m.role === "bot"));
          let hi = hydo.length - 1;
          for (let ri = rows.length - 1; ri >= 0 && hi >= 0; ri--) {
            const row = rows[ri];
            const rowRole = String(row.role || row.author || "").toLowerCase();
            const want = rowRole === "assistant" || rowRole === "agent" ? "bot" : rowRole === "user" ? "user" : "";
            if (!want) continue;
            while (hi >= 0 && hydo[hi].role !== want) hi--;
            if (hi < 0) break;
            const rid = row.row_id != null ? row.row_id : row.id;
            if (rid != null) hydo[hi].hermesRowId = rid;
            hi--;
          }
          save();
        })
        .catch(() => {});
    }
    if ((agent.contextPercent || 0) >= COMPACT_AT_PERCENT) {
      try {
        const pre = await gateway.compressIfNeeded(agent.id, COMPACT_AT_PERCENT);
        if (pre && pre.compressed) persistHermesIds();
      } catch {
        /* Hermes auto-compact may already have run */
      }
    }

    const bubble = {
      id: uuid(),
      role: "bot",
      kind: "chat",
      fromId: agent.id,
      text: "",
      streaming: true,
      at: now(),
    };
    let opened = false;
    let committed = false;
    let lateText = "";

    function commitBeat() {
      if (!opened || committed) return;
      bubble.streaming = false;
      committed = true;
      flush(true);
    }

    // save() rewrites state.json and pushes to the renderer, so throttle it —
    // one disk write per delta chunk would thrash.
    let last = 0;
    let pending = null;
    const flush = (force) => {
      const t = Date.now();
      if (!force && t - last < 100) {
        if (!pending) pending = setTimeout(() => flush(true), 100);
        return;
      }
      if (pending) {
        clearTimeout(pending);
        pending = null;
      }
      last = t;
      // Streaming: push every beat, coalesce the disk write.
      saveSoon();
    };

    try {
      const submitP = gateway.submit(agent.id, userText, {
        onDelta: (chunk) => {
          if (!chunk) return;
          if (committed) {
            lateText += chunk;
            return;
          }
          if (!opened) {
            opened = true;
            threadOf(convId || agent.id).push(bubble);
          }
          bubble.text += chunk;
          flush(false);
        },
        onActivity: (label) => {
          setStatus(agent.id, "working", label || "Working", convId || agent.id);
          flush(false);
        },
        onTool: (evt) => {
          if (captureTodos(agent, evt)) flush(false);
          if (evt && evt.phase === "start" && evt.name) {
            const name = String(evt.name);
            const { activityFromTool } = require("./activity.cjs");
            agent.activityDetail = activityFromTool(name, evt);
            if (!opened && !flags.jobWake && (!convId || convId === agent.id) && /delegate|computer_use|^terminal$|^bash$|web_search|browser/.test(name)) {
              bubble.text = "On it.";
              opened = true;
              threadOf(convId || agent.id).push(bubble);
              commitBeat();
              if (submitBackground) {
                if (!agent.backgroundTurn) {
                  agent.backgroundTurn = {
                    convId: convId || agent.id,
                    startedAt: now(),
                    goal: String(userText || "").slice(0, 160),
                  };
                }
                releaseEarly();
              }
            } else if (opened && /delegate|computer_use|^terminal$|^bash$|web_search|browser/.test(name)) {
              commitBeat();
              if (submitBackground) {
                if (!agent.backgroundTurn) {
                  agent.backgroundTurn = {
                    convId: convId || agent.id,
                    startedAt: now(),
                    goal: String(userText || "").slice(0, 160),
                  };
                }
                releaseEarly();
              }
            }
            flush(false);
          }
          if (evt && evt.phase === "complete") {
            const shots = toolImages(evt);
            if (shots.length) {
              bubble.images = (bubble.images || []).concat(shots);
              if (!opened) {
                opened = true;
                threadOf(convId || agent.id).push(bubble);
              }
              flush(true);
            }
            const files = toolFiles(evt, cwd);
            if (files.length) {
              bubble.attachments = (bubble.attachments || []).concat(files);
              if (!opened) {
                opened = true;
                threadOf(convId || agent.id).push(bubble);
              }
              flush(true);
            }
          }
        },
        // Ask-before-acting. Nothing is auto-approved here: the turn parks
        // until the user answers in the UI.
        onApproval: (req) => {
          if (!req || !req.request_id) return;
          pushMsg(agent.id, {
            id: uuid(),
            role: "system",
            kind: "approval",
            fromId: agent.id,
            requestId: req.request_id,
            text: req.description || req.command || "Run this?",
            command: req.command || "",
            choices: req.choices || null,
            at: now(),
          });
          flush(true);
        },
        onClarify: (req) => {
          if (!req || !req.request_id) return;
          const q = req.question || (req.questions && req.questions[0]) || "";
          pushMsg(agent.id, {
            id: uuid(),
            role: "system",
            kind: "clarify",
            fromId: agent.id,
            requestId: req.request_id,
            questionId: req.question_id || null,
            text: typeof q === "string" ? q : q.text || "Quick question.",
            choices: req.choices || null,
            at: now(),
          });
          flush(true);
        },
        // A teammate called `open_preview`. Card it and, if it is the thread
        // you are looking at, the renderer will raise the pane.
        onArtifact: (ev) => {
          if (!ev || !ev.url) return;
          recordArtifact(agent, ev.url, ev.label);
          flush(true);
        },
        onArtifactClose: () => {},
        onGate: (req) => {
          if (!req || !req.request_id) return;
          const kind = String(req.gateKind || "secret");
          const secret = kind === "sudo" || kind === "secret";
          pushMsg(agent.id, {
            id: uuid(),
            role: "system",
            kind: "gate",
            fromId: agent.id,
            requestId: req.request_id,
            gateKind: kind,
            secret,
            text: gatePrompt(kind, req),
            prompt: req.prompt || req.text || "",
            envVar: req.env_var || "",
            at: now(),
          });
          flush(true);
        },
        // Hermes says something out-of-band — in practice "still starting the
        // agent" on a cold build. It belongs in the working row, not the
        // transcript: the rule is that only logs see the machinery.
        onNotice: (n) => {
          if (n && n.text) {
            setStatus(agent.id, "working", String(n.text).slice(0, 80), convId || agent.id);
            flush(false);
          }
        },
        // A teammate delegated work. Surface it in the working row rather than
        // leaving the user staring at a silent "Working".
        onAffection: (kind) => {
          const list = threadOf(convId || agent.id);
          for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].role === "user") {
              toggleReaction(list[i], "❤️", agent.id);
              flush(true);
              return;
            }
          }
          void kind;
        },
        onYielded: () => {
          if (flags.background && agent.backgroundTurn) save();
        },
        onSubagent: (evt) => {
          if (!evt) return;
          botHome.appendSubagentLog(dir, agent.id, evt);
          const tracked = trackSubagent(agent, evt);
          const goal = String(evt.goal || (agent.backgroundTurn && agent.backgroundTurn.goal) || "").slice(0, 80);
          if (evt.type === "subagent.start" || evt.type === "subagent.spawn_requested") {
            commitBeat();
            agent.backgroundTurn = {
              convId: convId || agent.id,
              startedAt: (agent.backgroundTurn && agent.backgroundTurn.startedAt) || now(),
              goal: goal || (agent.backgroundTurn && agent.backgroundTurn.goal) || "",
            };
            agent.activityDetail = goal ? `sub-agent: ${goal}` : "Delegating";
            flush(false);
            if (submitBackground) releaseEarly();
          } else if (evt.type === "subagent.complete") {
            agent.activityDetail = tracked.live ? agent.activityDetail : "";
            flush(false);
            if (tracked.live === 0 && agent.backgroundTurn && !flags.jobWake) {
              const result = String(evt.summary || evt.result || evt.text || "").slice(0, 2000);
              queueJobDone(agent, convId || agent.id, (agent.backgroundTurn && agent.backgroundTurn.goal) || goal, result);
            }
          }
        },
        onComplete: (out) => {
          if (out && out.usage) contextMgmt.applyUsageToAgent(agent, out.usage);
          if (submitBackground && agent.backgroundTurn && !flags.jobWake) {
            const live = (agent.subagentIds && agent.subagentIds.length) || 0;
            if (live === 0) {
              const result = String((out && out.text) || "").slice(0, 2000);
              queueJobDone(
                agent,
                convId || agent.id,
                (agent.backgroundTurn && agent.backgroundTurn.goal) || "",
                result
              );
            }
          }
        },
      },
      {
        notes: Array.isArray(notes) ? notes : [],
        background: submitBackground,
      });

      const raced = await Promise.race([
        submitP.then((r) => ({ kind: "done", result: r })),
        earlyP.then(() => ({ kind: "early" })),
      ]);

      persistHermesIds();
      mapHermesRowIds(agent);

      if (raced.kind === "early") {
        if (pending) clearTimeout(pending);
        const leftover = committed ? lateText.trim() : "";
        if (opened && !committed) {
          bubble.streaming = false;
          flush(true);
        }
        const posted = opened;
        const text = leftover;
        if (bubble.images && bubble.images.length) {
          return { text, images: bubble.images, posted, yielded: true };
        }
        return { text, posted, yielded: true };
      }

      const result = raced.result;
      if (pending) clearTimeout(pending);
      agent.activityDetail = "";
      maybeCompact(agent);
      if (!(agent.subagentIds && agent.subagentIds.length) && !committed) {
        agent.backgroundTurn = null;
      }
      const leftover = committed ? lateText.trim() : "";
      if (opened && !committed) {
        bubble.streaming = false;
        flush(true);
      }
      const posted = opened;
      const text = leftover || (posted ? "" : result.text);
      if (bubble.images && bubble.images.length) {
        return { text, images: bubble.images, posted };
      }
      return { text, posted };
    } catch (err) {
      if (opened) {
        const list = threadOf(agent.id);
        const i = list.indexOf(bubble);
        if (i >= 0) list.splice(i, 1);
      }
      if (pending) clearTimeout(pending);
      agent.activityDetail = "";
      throw err;
    }
  }

  /**
   * Compress a teammate's Hermes history once it has filled the window.
   *
   * Surfaced as ONE quiet system line, never as the raw compaction payload
   * Hermes hands back — a transcript is a conversation, and a summariser's
   * output is machinery.
   */
  function maybeCompact(agent) {
    let gateway;
    try {
      gateway = require("./hermes-gateway.cjs");
    } catch {
      return;
    }
    if (!gateway.available() || !gateway.hasSession(agent.id)) return;
    gateway
      .compressIfNeeded(agent.id, COMPACT_AT_PERCENT)
      .then((res) => {
        if (!res || !res.compressed) return;
        const storedId = gateway.storedSessionIdOf ? gateway.storedSessionIdOf(agent.id) : "";
        if (storedId) agent.hermesSessionId = storedId;
        if (res.percent != null) agent.contextPercent = res.percent;
        pushMsg(agent.id, {
          id: uuid(),
          role: "system",
          kind: "event",
          fromId: agent.id,
          text: `Older messages were summarised to free up room. ${agent.name} still remembers what mattered.`,
          at: now(),
        });
        save();
      })
      .catch(() => {
        /* best-effort housekeeping — never surfaced as a failure */
      });
  }

  function hermesBusy(agentId) {
    try {
      const gateway = require("./hermes-gateway.cjs");
      return typeof gateway.isBusy === "function" && gateway.isBusy(agentId);
    } catch {
      return false;
    }
  }

  function queueJobDone(agent, convId, goal, result) {
    if (!agent || agent._jobWaking) return;
    agent._jobWaking = true;
    let tries = 0;
    const run = () => {
      if (hermesBusy(agent.id) && tries < 40) {
        tries += 1;
        setTimeout(run, 50);
        return;
      }
      Promise.resolve()
        .then(() => api.jobDone(agent.id, { goal, result, convId }))
        .then(() => {
          agent._jobWaking = false;
        }, (err) => {
          const msg = String(err && err.message ? err.message : err);
          if (/in flight/i.test(msg) && tries < 40) {
            tries += 1;
            setTimeout(run, 50);
            return;
          }
          agent._jobWaking = false;
        });
    };
    run();
  }

  async function speak(agent, userText, extra, convId) {
    const soul = soulSnapshot(dir, agent.id);
    const memory = memorySnapshot(dir, agent.id);
    // Reactions the user left since this teammate last spoke. Drained here so
    // they are announced exactly once, whichever backend answers the turn.
    const notes = drainNotes(agent.id);
    const shared = botHome.readSharedMemory(dir);
    const system = standing(
      agent,
      state.settings,
      soul,
      memory,
      [extra || "", shared ? `Shared team memory (SHARED.md):\n${shared}` : "", ...notes]
        .filter(Boolean)
        .join("\n") || undefined
    );
    let raw;
    let shotImages = [];
    try {
      if (opts.complete) {
        raw = await complete(system, userText, agent.model || state.settings.model);
      } else {
        try {
          const jobWake = /^\s*\[job\]/m.test(String(extra || ""));
          raw = await streamThroughHermes(agent, soul, userText, notes, convId, {
            background: !jobWake,
            jobWake,
          });
        } catch (err) {
          let gw = null;
          try {
            gw = require("./hermes-gateway.cjs");
          } catch {
            gw = null;
          }
          // Hermes is the product. If the gateway is up, a failed turn is a
          // failed turn — do not paper it over with OpenRouter "success".
          if (gw && typeof gw.available === "function" && gw.available()) {
            raw = `Hermes failed: ${err && err.message ? err.message : err}`;
          } else {
            raw = await complete(system, userText, agent.model || state.settings.model);
          }
        }
      }
    } catch (err) {
      raw = `Couldn't reach the model. ${err.message}`;
    }
    let posted = false;
    let yielded = false;
    if (raw && typeof raw === "object" && raw.text != null) {
      shotImages = Array.isArray(raw.images) ? raw.images : [];
      posted = !!raw.posted;
      yielded = !!raw.yielded;
      raw = raw.text;
    }
    const extracted = extractDirectives(String(raw || "").trim() || (posted ? "" : "Empty reply."));
    extracted.images = shotImages;
    extracted.posted = posted;
    extracted.yielded = yielded;
    return extracted;
  }

  /**
   * Apply a teammate's own REACT directives to the message it was answering.
   *
   * `by` is the bot's id, so the UI can tell who reacted. The same tapback is
   * forwarded to Hermes with `author: 'agent'` when the target is addressable
   * there — Hermes keeps its own durable copy, which is what a future
   * `session.history` read will show.
   *
   * @param {Object} agent
   * @param {Object|null} targetMsg  the message being replied to
   * @param {Array} specs            parsed `REACT: {...}` payloads
   */
  function applyBotReactions(agent, targetMsg, specs) {
    if (!agent || !targetMsg || !Array.isArray(specs) || !specs.length) return;
    const hit = findMessage(targetMsg.id);
    for (const spec of specs) {
      const emoji = spec && typeof spec.emoji === "string" ? spec.emoji.trim() : "";
      if (!emoji) continue;
      const outcome = toggleReaction(targetMsg, emoji, agent.id);
      if (outcome === "noop") continue;
      const role = newestRoleFor(hit, agent.id);
      const rowId = targetMsg.hermesRowId;
      if (rowId == null && !role) continue;
      Promise.resolve()
        .then(() => {
          const gateway = require("./hermes-gateway.cjs");
          if (!gateway.available() || !gateway.hasSession(agent.id)) return null;
          return gateway.react(agent.id, {
            emoji: outcome === "removed" ? null : emoji,
            ...(rowId != null ? { rowId } : { newestRole: role }),
            author: "agent",
          });
        })
        .catch(() => {
          /* Hermes' copy is a bonus; Hydo's state.json is the source of truth. */
        });
    }
  }

  function applyRoutineCreates(agent, specs) {
    const created = [];
    for (const spec of specs) {
      if (!spec) continue;
      const named = String(spec.name || "").trim();
      const instructed = String(spec.instruction || "").trim();
      const hasTriggers = Array.isArray(spec.triggers) && spec.triggers.length;
      if (!named && !instructed && !hasTriggers && !spec.at) continue;
      const id = uuid();
      const triggers = routinesLib.triggersFromSpec(spec);
      const at = spec.at || routinesLib.earliestAt(triggers);
      const once = spec.once === true || spec.deleteAfter === true;
      const item = {
        id,
        agentId: agent.id,
        name: named,
        instruction: instructed || named,
        active: spec.active !== false,
        at,
        triggers,
        once,
        deleteAfter: spec.deleteAfter === true || once,
        createdAt: now(),
        runs: [],
      };
      state.routines[agent.id] ??= [];
      state.routines[agent.id].unshift(item);
      pushRoutineNote(agent.id, { action: "created", name: item.name, routineId: id });
      created.push(item);
      syncHermesCron(agent, item);
    }
    return created;
  }

  function hermesProfile(agent) {
    return botHome.profileName(agent.id);
  }

  function hermesCron(action, params) {
    try {
      const gateway = require("./hermes-gateway.cjs");
      if (!gateway.available()) return Promise.resolve(null);
      return gateway.cron(action, params).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  function syncHermesCron(agent, item) {
    const tr = (item.triggers || []).find((t) => t.kind === "schedule");
    const schedule = routinesLib.hermesSchedule(tr || { kind: "schedule", cadence: "once", at: item.at });
    if (!schedule || !item.instruction) return;
    const profile = hermesProfile(agent);
    // Scheduler-only: deliver "local" stores the job in Hermes without injecting
    // a turn. Hydo's 15s dueRoutines poll is the only thing that posts to chat.
    hermesCron("add", {
      name: item.name || "Routine",
      schedule,
      prompt: item.instruction,
      repeat: item.once || item.deleteAfter ? 1 : undefined,
      profile,
      deliver: "local",
    }).then((result) => {
      const jobId = routinesLib.jobIdFrom(result);
      if (!jobId) return;
      item.hermesJobId = jobId;
      save();
    });
  }

  function dropHermesCron(agent, item) {
    if (!item?.hermesJobId) return;
    hermesCron("remove", { name: item.hermesJobId, profile: hermesProfile(agent) });
  }

  function pauseHermesCron(agent, item, active) {
    if (!item?.hermesJobId) return;
    hermesCron(active ? "resume" : "pause", { name: item.hermesJobId, profile: hermesProfile(agent) });
  }

  const api = {
    getState() {
      return publicState();
    },
    signIn() {
      state.signedIn = true;
      save();
      return publicState();
    },
    signOut() {
      state.signedIn = false;
      save();
      return publicState();
    },
    select(id) {
      const entry = entryById(id);
      if (entry) {
        state.selectedId = id;
        // Opening a conversation reads it. Without this, "Mark as Unread" is a
        // one-way trap the user can never clear from the UI.
        entry.unread = false;
      }
      save();
      return publicState();
    },
    /** Pin a bot or channel to the top of the roster. */
    setPinned(id, pinned) {
      return setFlag(id, "pinned", pinned);
    },
    /** Mark a bot or channel unread. Cleared again by `select(id)`. */
    setUnread(id, unread) {
      return setFlag(id, "unread", unread);
    },
    /**
     * Hide a bot or channel from the roster.
     *
     * This is NOT a delete: the thread, the routines and any Hermes session all
     * stay exactly as they were, and `getState()` keeps returning the entry with
     * `hidden: true` so the command palette can still reach it. Filtering the
     * roster is the UI's job, not the store's.
     */
    setHidden(id, hidden) {
      return setFlag(id, "hidden", hidden);
    },
    createSection({ name, ids } = {}) {
      const section = { id: uuid(), name: String(name || "New section").trim() || "New section" };
      state.sections = Array.isArray(state.sections) ? [section].concat(state.sections) : [section];
      const list = Array.isArray(ids) ? ids : [];
      for (const id of list) {
        const entry = entryById(id);
        if (entry) entry.sectionId = section.id;
      }
      save();
      return publicState();
    },
    renameSection(id, name) {
      const s = (state.sections || []).find((x) => x.id === id);
      if (s) s.name = String(name || "").trim() || s.name;
      save();
      return publicState();
    },
    deleteSection(id) {
      state.sections = (state.sections || []).filter((s) => s.id !== id);
      for (const a of state.agents) if (a.sectionId === id) a.sectionId = null;
      for (const c of state.channels || []) if (c.sectionId === id) c.sectionId = null;
      save();
      return publicState();
    },
    moveToSection(ids, sectionId) {
      const sid = sectionId ? String(sectionId) : null;
      const known = sid && (state.sections || []).some((s) => s.id === sid);
      const next = known ? sid : null;
      const list = Array.isArray(ids) ? ids : [ids];
      for (const id of list) {
        const entry = entryById(id);
        if (entry) entry.sectionId = next;
      }
      save();
      return publicState();
    },
    deleteEntries(ids) {
      const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map((id) => String(id || "")).filter(Boolean))];
      for (const id of list) {
        const entry = entryById(id);
        if (!entry) continue;
        if (entry.kind === "channel") api.deleteChannel(id);
        else api.deleteAgent(id);
      }
      save();
      return publicState();
    },
    /**
     * Duplicate a teammate's PROFILE — name (suffixed), label, description,
     * blob, shape, notifications.
     *
     * Deliberately not copied: the message thread, the routines, and the Hermes
     * session. This is a fresh teammate wearing the same face, with a new id and
     * its own workspace; copying the transcript would make two bots claim the
     * same history.
     */
    duplicateAgent(id) {
      const src = state.agents.find((a) => a.id === id);
      if (!src) return publicState();
      const copyId = uuid();
      const t = now();
      const base = `${src.name || "Bot"} copy`;
      let name = base;
      let n = 2;
      while (state.agents.some((a) => a.name === name)) name = `${base} ${n++}`;
      const idx = state.agents.indexOf(src);
      state.agents.splice(idx + 1, 0, {
        id: copyId,
        name,
        label: src.label || "",
        description: src.description || "",
        notifications: !!src.notifications,
        blob: src.blob,
        shape: src.shape,
        status: "idle",
        activity: "",
        workingIn: null,
        toolProfile: src.toolProfile || "builder",
        reasoningEffort: src.reasoningEffort || "low",
        toolsets: Array.isArray(src.toolsets) ? src.toolsets.slice() : [],
        mcp: Array.isArray(src.mcp) ? src.mcp.slice() : [],
        pinned: false,
        unread: false,
        hidden: false,
        draft: "",
        updatedAt: t,
        last: "",
      });
      state.messages[copyId] = [];
      state.routines[copyId] = [];
      state.selectedId = copyId;
      save();
      return publicState();
    },
    createAgent(patch = {}) {
      const id = uuid();
      const t = now();
      const mark = pickRandomMark(state.agents);
      const named = String(patch.name || "").trim();
      state.agents.unshift({
        id,
        name: named || "New Bot",
        label: "",
        description: "",
        notifications: false,
        blob: mark.blob,
        shape: mark.shape,
        status: "working",
        activity: "Working",
        workingIn: id,
        // Auto mode: start at the cheapest rung and climb only when a turn
        // actually needs more. `builder` on a bot that says "hey" was ~16.6k
        // of tool schema for a two-word answer.
        toolProfile: "chat",
        profilePinned: false,
        reasoningEffort: "low",
        // Extra Hermes toolsets on top of the profile (browser, vision, ...).
        toolsets: [],
        mcp: [],
        draft: "",
        updatedAt: t,
        // Filled by the bot's own opening bubble (see landNewBot). A literal
        // "New bot is working." was the roster preview for every fresh bot.
        last: "",
      });
      state.messages[id] = [];
      state.routines[id] = [];
      state.selectedId = id;
      save();
      return publicState();
    },
    /**
     * A new teammate opens the thread. It does NOT get a canned line.
     *
     * A canned greeting is why this was ripped out before: eleven fixed
     * strings that `load()` still scrubs out of old threads on sight. But an
     * empty thread is worse. The bot appeared, span for 900ms, and vanished
     * into silence, which is what "it says working and then disappears"
     * describes.
     *
     * So it takes a real, very short turn instead. The brief below is hidden
     * (it is never pushed into the transcript), the answer is a genuine bubble
     * in this bot's own voice, and the spin the user already sees is now
     * honest: it really is working. If Hermes is down the turn throws, and the
     * thread stays empty rather than the app lying with a fake hello.
     */
    async landNewBot(id) {
      const agent = state.agents.find((a) => a.id === id);
      if (!agent) return publicState();
      threadOf(id);
      if ((state.messages[id] || []).length > 0) {
        setStatus(id, "idle");
        save();
        return publicState();
      }
      const user = state.settings.userName || "Michael";
      const named = agent.name && agent.name !== "New Bot" ? agent.name : "";
      const brief = [
        `${user} just made you. You are their new teammate${named ? `, called ${named}` : ""}.`,
        agent.description ? `They set you up for: ${agent.description}` : "",
        named
          ? ""
          : "You have no name yet. Never invent one and never call yourself Hydo, that is the app.",
        // The failure this is written against: every phrasing of "what do you
        // want me for" is the same menu in different words, and it makes the
        // first thing a new teammate does be an admin question. Someone warm
        // says hello and lets you talk.
        "Say hello like a person would. ONE short line, your own voice, under twelve words.",
        `Use their name. Do not ask what they want, do not offer categories, do not list, do not say "how can I help".`,
        "It is fine to just be glad to be here and stop talking. They will tell you what they need.",
        "No tools. No SKIP.",
      ]
        .filter(Boolean)
        .join(" ");
      setStatus(id, "working", "Coming online");
      save();
      let opened = "";
      try {
        const res = await speak(agent, brief, undefined, agent.id);
        opened = String((res && res.text) || "").trim();
      } catch {
        /* no Hermes: leave the thread empty rather than fake a hello */
      }
      const t = now();
      if (opened && !/^SKIP$/i.test(opened)) {
        for (const bubble of splitBubbles(opened)) {
          pushMsg(id, { id: uuid(), role: "bot", kind: "chat", fromId: id, text: bubble, at: t });
        }
      } else {
        for (const text of landingLines(user)) {
          pushMsg(id, { id: uuid(), role: "bot", kind: "chat", fromId: id, text, at: t });
        }
      }
      // Via setStatus so `workingIn` is cleared too — a bot born "working"
      // must not be left marked as busy in its own thread once it lands.
      setStatus(id, "idle");
      save();
      return publicState();
    },
    deleteAgent(id) {
      const idx = state.agents.findIndex((a) => a.id === id);
      if (idx < 0) return publicState();
      state.agents.splice(idx, 1);
      delete state.messages[id];
      delete state.routines[id];
      for (const k of Object.keys(state.dms || {})) {
        if (k.split(":").includes(id)) delete state.dms[k];
      }
      if (state.selectedId === id) state.selectedId = state.agents[0]?.id || null;
      save();
      return publicState();
    },
    setSettings(patch) {
      if (!patch || typeof patch !== "object") return publicState();
      state.settings = { ...state.settings, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, "model")) {
        state.settings.model = modelPick.normalizeChatModel(state.settings.model);
        if (/muse/i.test(state.settings.model)) {
          state.settings.provider = modelPick.MUSE_PROVIDER;
        } else if (/grok/i.test(state.settings.model)) {
          state.settings.provider = modelPick.DEFAULT_PROVIDER;
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, "codingHarness")) {
        state.settings.codingHarness = modelPick.normalizeHarness(state.settings.codingHarness);
      }
      save();
      return publicState();
    },
    setAgent(id, patch) {
      const agent = state.agents.find((a) => a.id === id);
      if (!agent || !patch || typeof patch !== "object") return publicState();
      // `model` / `provider` / `reasoningEffort` / `fast` pin this ONE teammate
      // to a model — Hermes takes them as per-session overrides on
      // session.create and never writes them to its config, so pinning one bot
      // cannot move another. The pin applies from that bot's next session.
      // `toolProfile` / `mcp` decide how much tool schema this teammate carries
      // on EVERY turn. Measured: a `chat` bot pays 5,096 prompt tokens where a
      // bot on Hermes' own default pays 18,327 — 72% of which is tool
      // definitions it never calls. Changing either moves the bot to a
      // different gateway child on its next turn (see hermes-gateway.cjs).
      const allowed = ["name", "label", "description", "notifications", "blob", "shape", "status", "draft", "color", "activity", "activityDetail", "model", "provider", "reasoningEffort", "fast", "toolProfile", "profilePinned", "toolsets", "mcp", "sectionId", "backgroundTurn", "subagentIds", "lastSubagentId"];
      const before = agent.name;
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) agent[key] = patch[key];
      }
      if (typeof agent.name === "string") agent.name = agent.name.trim() || "Bot";
      // A rename should land in the thread — otherwise the bot silently becomes
      // someone else and the transcript above it makes no sense.
      if (
        Object.prototype.hasOwnProperty.call(patch, "name") &&
        before &&
        before !== agent.name &&
        before !== "New Bot"
      ) {
        // Typing a name into the rail fires setAgent PER KEYSTROKE, so
        // "Finn" left four lines behind: F -> Fi -> Fin -> Finn. Coalesce
        // instead: if the last thing in the thread is a rename of this bot
        // and it is recent, rewrite it so the pair reads original -> final.
        const thread = threadOf(agent.id);
        const tail = thread[thread.length - 1];
        const RENAME_COALESCE_MS = 60_000;
        const renamedFrom =
          tail &&
          tail.kind === "event" &&
          tail.role === "system" &&
          tail.fromId === agent.id &&
          typeof tail.renameFrom === "string" &&
          now() - new Date(tail.at).getTime() < RENAME_COALESCE_MS
            ? tail.renameFrom
            : null;
        if (renamedFrom && renamedFrom !== agent.name) {
          tail.renameFrom = renamedFrom;
          tail.text = `You renamed ${renamedFrom} to ${agent.name}.`;
          tail.at = now();
        } else if (renamedFrom === agent.name) {
          // Renamed straight back to what it was. The event is now a lie.
          thread.pop();
        } else {
          pushMsg(agent.id, {
            id: uuid(),
            role: "system",
            kind: "event",
            fromId: agent.id,
            renameFrom: before,
            text: `You renamed ${before} to ${agent.name}.`,
            at: now(),
          });
        }
        // Keep Hermes' own session list readable — otherwise `session.list`
        // still shows the old name forever. Cosmetic, so a failure is ignored.
        try {
          require("./hermes-gateway.cjs").setTitle(agent.id, agent.name);
        } catch {
          /* no Hermes, nothing to retitle */
        }
      }
      agent.updatedAt = now();
      save();
      return publicState();
    },
    setDraft(id, draft) {
      const target = state.agents.find((a) => a.id === id) || channelById(id);
      if (!target) return publicState();
      target.draft = String(draft || "");
      save();
      return publicState();
    },
    createRoutine(patch = {}) {
      const agent = selected();
      if (!agent) return publicState();
      applyRoutineCreates(agent, [
        {
          name: patch.name || "",
          instruction: patch.instruction || "",
          at: patch.at || null,
          schedule: patch.schedule,
          once: patch.once,
          deleteAfter: patch.deleteAfter,
          triggers: patch.triggers,
        },
      ]);
      save();
      return publicState();
    },
    setRoutine(id, patch) {
      for (const a of state.agents) {
        const item = (state.routines[a.id] || []).find((r) => r.id === id);
        if (!item || !patch) continue;
        const wasActive = item.active !== false;
        Object.assign(item, patch);
        if (patch.triggers) {
          item.triggers = routinesLib.triggersFromSpec({ triggers: patch.triggers, at: item.at });
          item.at = routinesLib.earliestAt(item.triggers) || item.at;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "active") && wasActive !== (item.active !== false)) {
          pauseHermesCron(a, item, item.active !== false);
        }
        if (patch.instruction || patch.triggers || patch.name || patch.at) {
          dropHermesCron(a, item);
          item.hermesJobId = null;
          if (item.active !== false) syncHermesCron(a, item);
        }
        save();
        return publicState();
      }
      return publicState();
    },
    deleteRoutine(id) {
      for (const a of state.agents) {
        const list = state.routines[a.id] || [];
        const hit = list.find((r) => r.id === id);
        if (!hit) continue;
        dropHermesCron(a, hit);
        state.routines[a.id] = list.filter((r) => r.id !== id);
        pushRoutineNote(a.id, { action: "deleted", name: hit.name, routineId: id });
      }
      save();
      return publicState();
    },
    async runRoutine(id) {
      let item = null;
      let agent = null;
      for (const a of state.agents) {
        const hit = (state.routines[a.id] || []).find((r) => r.id === id);
        if (hit) {
          item = hit;
          agent = a;
          break;
        }
      }
      if (!item || !agent) return publicState();
      setStatus(agent.id, "working", undefined, agent.id);
      save();
      const extracted = await speak(
        agent,
        item.instruction,
        "This is a scheduled routine. Do the work, then report back in one or two bubbles.",
        agent.id
      );
      const t = now();
      item.runs.unshift({ id: uuid(), at: t, text: extracted.text.slice(0, 240) });
      for (const bubble of splitBubbles(extracted.text)) {
        pushMsg(agent.id, { id: uuid(), role: "bot", kind: "chat", fromId: agent.id, text: bubble, at: t });
      }
      applyRoutineCreates(agent, extracted.dirs.routine);
      if (item.deleteAfter || item.once) {
        dropHermesCron(agent, item);
        state.routines[agent.id] = (state.routines[agent.id] || []).filter((r) => r.id !== id);
        pushRoutineNote(agent.id, { action: "deleted", name: item.name, routineId: id });
      } else {
        for (const tr of item.triggers || []) {
          if (tr.kind === "schedule" && tr.cadence !== "once") {
            tr.at = routinesLib.nextAt(tr, Date.now());
          }
        }
        item.at = routinesLib.earliestAt(item.triggers) || item.at;
      }
      setStatus(agent.id, "idle");
      save();
      return publicState();
    },
    dueRoutines(clock = now()) {
      const t = new Date(clock).getTime();
      const due = [];
      for (const a of state.agents) {
        for (const r of state.routines[a.id] || []) {
          if (!r.active) continue;
          if (!r.triggers || !r.triggers.length) {
            if (r.at) r.triggers = routinesLib.triggersFromSpec(r);
          }
          const atIso = r.at || routinesLib.earliestAt(r.triggers);
          if (!atIso) continue;
          const at = new Date(atIso).getTime();
          if (Number.isNaN(at) || at > t) continue;
          const last = r.runs[0]?.at ? new Date(r.runs[0].at).getTime() : 0;
          if (last >= at) continue;
          due.push(r.id);
        }
      }
      return due;
    },
    /**
     * Send a message to the selected conversation.
     * @param {string} text
     * @param {{replyTo?:string}} [opts]  id of a message in this conversation
     */
    async send(text, opts = {}) {
      const trimmed = String(text || "").trim();
      const images = normalizeSendImages(opts && opts.images);
      if (!trimmed && !images.length) return publicState();

      const entry = selectedEntry();
      if (entry && entry.kind === "channel") return api.sendToChannel(entry.id, trimmed, opts);

      const agent = selected();
      if (!agent) return publicState();
      const t = now();
      agent.draft = "";
      // Held onto: this is the message a REACT directive tapbacks.
      const replyTo = replySnapshot(agent.id, opts && opts.replyTo);
      const userMsg = { id: uuid(), role: "user", kind: "chat", text: trimmed, at: t };
      if (replyTo) userMsg.replyTo = replyTo;
      if (images.length) userMsg.images = images.map((im) => ({ src: im.src, alt: im.name, name: im.name }));
      pushMsg(agent.id, userMsg);
      // The model is handed the quote too — otherwise the reply is cosmetic.
      const body = trimmed || (images.length ? "Look at the attached image(s)." : "");
      const prompt = replyTo ? `${replyPreamble(replyTo)}\n\n${body}` : body;
      await attachUserImages(agent, images);
      if (agent.backgroundTurn || hermesBusy(agent.id)) {
        try {
          const gateway = require("./hermes-gateway.cjs");
          const last = (agent.subagentIds && agent.subagentIds[agent.subagentIds.length - 1]) || agent.lastSubagentId;
          if (last && gateway.steerSubagent) {
            gateway.steerSubagent(agent.id, last, body).catch(() => {});
          } else {
            oweNote(agent.id, `[User sent while a worker was running: "${body.slice(0, 240)}"]`);
          }
        } catch {
          oweNote(agent.id, `[User sent while a worker was running: "${body.slice(0, 240)}"]`);
        }
        save();
        return publicState();
      }
      const peer = mentionTarget(trimmed, state.agents, agent.id);
      setStatus(agent.id, "working", undefined, agent.id);
      if (peer) setStatus(peer.id, "working", undefined, agent.id);
      save();

      if (peer) {
        const specialist = await runPing(
          agent,
          peer,
          trimmed,
          `${agent.name} pinged you on behalf of ${state.settings.userName || "Michael"}:\n${trimmed}`
        );
        const wrap = await speak(
          agent,
          `You pinged ${peer.name}. They said:\n${specialist.text}\nTell ${state.settings.userName || "Michael"} what landed, in one bubble.`,
          "Do not repeat the ping protocol.",
          agent.id
        );
        for (const bubble of splitBubbles(wrap.text)) {
          pushMsg(agent.id, { id: uuid(), role: "bot", kind: "chat", fromId: agent.id, text: bubble, at: now() });
        }
        applyRoutineCreates(agent, wrap.dirs.routine.concat(specialist.dirs.routine));
        setStatus(agent.id, "idle");
        setStatus(peer.id, "idle");
        save();
        return publicState();
      }

      const extracted = await speak(agent, prompt, undefined, agent.id);
      // Reactions land before the SKIP check: reacting and saying nothing is a
      // legitimate answer, and it must survive a turn that produces no text.
      applyBotReactions(agent, userMsg, extracted.dirs.react);
      if (extracted.yielded) {
        save();
        return publicState();
      }
      if (/^SKIP$/i.test(extracted.text.trim())) {
        setStatus(agent.id, "idle");
        save();
        return publicState();
      }
      // Self-settings first: a bot that renames itself this turn should be
      // addressed by the new name in everything below.
      for (const spec of extracted.dirs.self || []) applySelf(agent, spec);
      // Hiring runs BEFORE pings so a bot can create someone and message them
      // in the same turn — `mentionTarget` below then resolves the new name.
      for (const spec of extracted.dirs.teammate || []) {
        await spawnTeammate(agent, spec);
      }
      for (const ping of extracted.dirs.ping) {
        const pingPeer = mentionTarget(`@${ping.name || ""}`, state.agents, agent.id);
        if (!pingPeer) continue;
        await runPing(
          agent,
          pingPeer,
          ping.text || trimmed,
          `${agent.name} pinged you:\n${ping.text || trimmed}`
        );
      }
      const rest = extracted.posted ? String(extracted.text || "").trim() : extracted.text;
      const bubbles = rest ? splitBubbles(rest) : [];
      const done = now();
      const posted = [];
      for (const bubble of bubbles) {
        const m = { id: uuid(), role: "bot", kind: "chat", fromId: agent.id, text: bubble, at: done };
        posted.push(m);
        pushMsg(agent.id, m);
      }
      if (extracted.images && extracted.images.length) {
        const target = posted[0] || threadOf(agent.id).filter((m) => m.fromId === agent.id).pop();
        if (target) target.images = (target.images || []).concat(extracted.images);
      }
      // A teammate that answered a specific earlier message says so with
      // REPLY:; default is a plain append, which is right almost always.
      applyBotReply(agent.id, extracted.dirs.reply, posted, userMsg.replyTo, userMsg.id);
      applyRoutineCreates(agent, extracted.dirs.routine);
      setStatus(agent.id, "idle");
      save();
      return publicState();
    },
    createChannel(patch = {}) {
      const id = uuid();
      const t = now();
      state.channels ??= [];
      state.channels.unshift({
        id,
        kind: "channel",
        name: String(patch.name || "New Channel"),
        description: String(patch.description || ""),
        members: Array.isArray(patch.members) ? patch.members.slice(0, MAX_MEMBERS) : [],
        draft: "",
        last: "",
        updatedAt: t,
      });
      state.messages[id] = [];
      state.selectedId = id;
      save();
      return publicState();
    },
    setChannel(id, patch) {
      const ch = channelById(id);
      if (!ch || !patch || typeof patch !== "object") return publicState();
      if (Object.prototype.hasOwnProperty.call(patch, "name")) {
        const next = String(patch.name).trim() || "Channel";
        if (next !== ch.name) {
          pushMsg(ch.id, {
            id: uuid(),
            role: "system",
            kind: "event",
            text: `Channel renamed to ${next}.`,
            at: now(),
          });
        }
        ch.name = next;
      }
      for (const key of ["description", "draft"]) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) ch[key] = String(patch[key] || "");
      }
      if (Array.isArray(patch.members)) ch.members = patch.members.slice(0, MAX_MEMBERS);
      ch.updatedAt = now();
      save();
      return publicState();
    },
    toggleChannelMember(channelId, agentId) {
      const ch = channelById(channelId);
      const agent = state.agents.find((a) => a.id === agentId);
      if (!ch || !agent) return publicState();
      const at = now();
      if (ch.members.includes(agentId)) {
        ch.members = ch.members.filter((m) => m !== agentId);
        pushMsg(ch.id, {
          id: uuid(),
          role: "system",
          kind: "event",
          text: `${agent.name} left the channel.`,
          at,
        });
      } else {
        if (ch.members.length >= MAX_MEMBERS) return publicState();
        ch.members.push(agentId);
        pushMsg(ch.id, {
          id: uuid(),
          role: "system",
          kind: "event",
          text: `${agent.name} joined the channel.`,
          at,
        });
      }
      ch.updatedAt = at;
      save();
      return publicState();
    },
    deleteChannel(id) {
      const idx = (state.channels || []).findIndex((c) => c.id === id);
      if (idx < 0) return publicState();
      state.channels.splice(idx, 1);
      delete state.messages[id];
      if (state.selectedId === id) {
        state.selectedId = state.agents[0]?.id || state.channels[0]?.id || null;
      }
      save();
      return publicState();
    },
    // Fan out: every member wakes, every member takes its own turn with its own
    // tools and its own Hermes session. Nobody is required to answer.
    async sendToChannel(channelId, text, opts = {}) {
      const ch = channelById(channelId);
      const trimmed = String(text || "").trim();
      const images = normalizeSendImages(opts && opts.images);
      if (!ch || (!trimmed && !images.length)) return publicState();
      const members = membersOf(ch);
      const history = recentHistory(
        (state.messages[ch.id] || []).map((m) => ({
          ...m,
          fromName: state.agents.find((a) => a.id === m.fromId)?.name,
        }))
      );

      ch.draft = "";
      const replyTo = replySnapshot(ch.id, opts && opts.replyTo);
      const userMsg = { id: uuid(), role: "user", kind: "chat", text: trimmed, at: now() };
      if (replyTo) userMsg.replyTo = replyTo;
      if (images.length) userMsg.images = images.map((im) => ({ src: im.src, alt: im.name, name: im.name }));
      pushMsg(ch.id, userMsg);
      const body = trimmed || (images.length ? "Look at the attached image(s)." : "");
      const prompt = replyTo ? `${replyPreamble(replyTo)}\n\n${body}` : body;
      if (!members.length) {
        save();
        return publicState();
      }
      for (const m of members) {
        setStatus(m.id, "working", undefined, ch.id);
        await attachUserImages(m, images);
      }
      save();

      // Members speak one at a time so each one can see what the others just
      // said — that back-and-forth is the whole point of a channel. A round
      // where nobody speaks ends the exchange, and CHANNEL_ROUNDS is the hard
      // stop so a chatty pair can't talk forever on your budget.
      const said = [];
      for (let round = 0; round < CHANNEL_ROUNDS; round++) {
        let spokeThisRound = false;

        for (const m of members) {
          const transcript = [`User: ${body}`]
            .concat(said.map((s) => `${s.name}: ${s.text}`))
            .join("\n");
          setStatus(m.id, "working", undefined, ch.id);
          save();

          let extracted;
          try {
            extracted = await speak(
              m,
              prompt,
              channelBrief(ch, members, m, history, transcript, round),
              ch.id
            );
          } catch {
            extracted = { text: "", dirs: { memory: [], ping: [], routine: [], react: [], reply: [] } };
          }
          // Cleared BEFORE the SKIP branch below: a member that stayed quiet
          // must not be left spinning in the channel.
          setStatus(m.id, "idle");
          applyBotReactions(m, userMsg, extracted.dirs.react || []);

          const replyText = String(extracted.text || "").trim();
          // SKIP is the quiet answer. It must leave no trace in the transcript.
          if (!replyText || /^SKIP\.?$/i.test(replyText)) {
            save();
            continue;
          }
          spokeThisRound = true;
          said.push({ name: m.name, text: replyText });
          const posted = [];
          for (const bubble of splitBubbles(replyText, { max: 1 })) {
            const msg = {
              id: uuid(),
              role: "bot",
              kind: "chat",
              fromId: m.id,
              text: bubble,
              at: now(),
            };
            posted.push(msg);
            pushMsg(ch.id, msg);
          }
          if (extracted.images && extracted.images.length && posted[0]) {
            posted[0].images = (posted[0].images || []).concat(extracted.images);
          }
          applyBotReply(ch.id, extracted.dirs.reply || [], posted, userMsg.replyTo, userMsg.id);
          save();
        }

        if (!spokeThisRound) break;
      }

      for (const m of members) setStatus(m.id, "idle");
      ch.updatedAt = now();
      save();
      return publicState();
    },
    async choose(messageId, choiceId) {
      const entry = selectedEntry();
      if (!entry) return publicState();
      const msg = threadOf(entry.id).find((m) => m.id === messageId);
      if (!msg || !Array.isArray(msg.choices)) return publicState();
      const pick = msg.choices.find((c) => c.id === choiceId);
      if (!pick) return publicState();
      msg.picked = choiceId;
      save();
      return api.send(pick.text);
    },
    // Answer an ask-before-acting gate. The turn is parked inside Hermes until
    // this lands, so resolving the card is what unblocks the teammate.
    async answerApproval(messageId, choice) {
      const entry = selectedEntry();
      if (!entry) return publicState();
      const msg = threadOf(entry.id).find((m) => m.id === messageId);
      if (!msg || msg.kind !== "approval" || msg.answered) return publicState();
      msg.answered = String(choice || "deny");
      save();
      try {
        const gateway = require("./hermes-gateway.cjs");
        await gateway.respondApproval(msg.fromId, msg.requestId, msg.answered);
      } catch (err) {
        msg.error = err.message;
        save();
      }
      return publicState();
    },
    /**
     * Dismiss a clarify without answering it.
     *
     * The card blocks the turn, so with no way out an unwanted question just
     * sits there forever holding the bot open. Hermes still has to be told
     * something or the session waits, so a dismiss sends an explicit skip
     * rather than silently dropping it.
     */
    async dismissClarify(messageId) {
      const entry = selectedEntry();
      if (!entry) return publicState();
      const msg = threadOf(entry.id).find((m) => m.id === messageId);
      if (!msg || msg.kind !== "clarify" || msg.answered) return publicState();
      msg.answered = "";
      msg.dismissed = true;
      logAction(entry.id, "clarify", "dismissed a question");
      save();
      try {
        const gateway = require("./hermes-gateway.cjs");
        await gateway.respondClarify(
          msg.fromId,
          msg.requestId,
          "Skipped. Carry on with your best judgement and say what you assumed.",
          { questionId: msg.questionId || undefined }
        );
      } catch (err) {
        msg.error = err.message;
      }
      save();
      return publicState();
    },
    async answerClarify(messageId, answer) {
      const entry = selectedEntry();
      const body = String(answer || "").trim();
      if (!entry || !body) return publicState();
      const msg = threadOf(entry.id).find((m) => m.id === messageId);
      if (!msg || msg.kind !== "clarify" || msg.answered) return publicState();
      msg.answered = body;
      save();
      try {
        const gateway = require("./hermes-gateway.cjs");
        await gateway.respondClarify(msg.fromId, msg.requestId, body, {
          questionId: msg.questionId || undefined,
        });
      } catch (err) {
        msg.error = err.message;
        save();
      }
      return publicState();
    },
    async answerGate(messageId, value) {
      const entry = selectedEntry();
      if (!entry) return publicState();
      const msg = threadOf(entry.id).find((m) => m.id === messageId);
      if (!msg || msg.kind !== "gate" || msg.answered) return publicState();
      const body = value == null ? "" : String(value);
      msg.answered = body === "" ? "skipped" : "sent";
      save();
      try {
        const gateway = require("./hermes-gateway.cjs");
        const payload = gateRespondBody(msg.gateKind, body, msg.answered === "skipped");
        await gateway.respondGate(msg.fromId, msg.gateKind, msg.requestId, payload);
      } catch (err) {
        msg.error = err.message;
        save();
      }
      return publicState();
    },
    /**
     * The human tapbacks a message. Toggling the same emoji removes it.
     *
     * Three things happen, in this order, and each is independent of the next
     * so a missing Hermes can never lose the reaction:
     *   1. it is toggled on the message in state.json — this is what the UI
     *      renders and what survives a reload;
     *   2. it is forwarded to Hermes via `message.react` when the message is
     *      addressable there (see newestRoleFor — Hermes addresses by durable
     *      row id or by "newest of this role", and Hydo holds neither for an
     *      older message);
     *   3. a note is queued for that teammate's NEXT turn, because Hermes'
     *      own reaction-note channel is gated off by default in config.yaml,
     *      which Hydo does not write. That note is what actually makes the
     *      teammate understand the reaction today.
     *
     * @param {string} messageId  a Hydo message id
     * @param {string} emoji      any emoji
     */
    async react(messageId, emoji) {
      const e = String(emoji || "").trim();
      const hit = findMessage(messageId);
      if (!hit || !e) return publicState();

      const outcome = toggleReaction(hit.msg, e, "user");
      if (outcome === "noop") return publicState();
      save();

      const ownerId = sessionOwner(hit);
      if (!ownerId) return publicState();

      const whose = hit.msg.role === "user" ? "their own" : "your";
      const snippet = snippetOf(hit.msg);
      const verb = outcome === "removed" ? "removed their" : "reacted";
      oweNote(
        ownerId,
        snippet
          ? `[The user ${verb} ${e} ${outcome === "removed" ? "reaction from" : "to"} ${whose} message: "${snippet}"]`
          : `[The user ${verb} ${e} ${outcome === "removed" ? "reaction from" : "to"} ${whose} earlier message]`
      );

      const role = newestRoleFor(hit, ownerId);
      const rowId = hit.msg.hermesRowId;
      if (rowId != null || role) {
        Promise.resolve()
          .then(() => {
            const gateway = require("./hermes-gateway.cjs");
            if (!gateway.available() || !gateway.hasSession(ownerId)) return null;
            return gateway.react(ownerId, {
              emoji: outcome === "removed" ? null : e,
              ...(rowId != null ? { rowId } : { newestRole: role }),
              author: "user",
            });
          })
          .then((ok) => {
            if (!ok) return;
            hit.msg.hermesReaction = true;
            save();
          })
          .catch(() => {
            /* Hydo's copy already saved; Hermes is a bonus. */
          });
      }
      return publicState();
    },
    /**
     * Real usage numbers for the Settings pane, straight from Hermes.
     *
     * Two independent sources, because they answer different questions:
     *   - `session` (`session.usage`) — this teammate's token spend and how
     *     full its context window is. Only exists once the bot has a session.
     *   - `account` (`usage.bars`) — the dollar model behind Hermes' own
     *     /usage screen. Fail-open server-side: logged out yields
     *     `{available:false}` rather than an error.
     *
     * Returns `{available:false}` when Hermes is not installed, so the pane can
     * say so honestly instead of drawing a made-up percentage.
     *
     * @param {string} [agentId]  defaults to the selected teammate
     */
    async usage(agentId) {
      const id = agentId || selectedEntry()?.id || null;
      let gateway;
      try {
        gateway = require("./hermes-gateway.cjs");
      } catch {
        return { available: false, reason: "hermes gateway module missing" };
      }
      if (!gateway.available()) {
        return { available: false, reason: "Hermes is not installed" };
      }
      const [session, account, breakdown] = await Promise.all([
        id ? gateway.usage(id) : Promise.resolve(null),
        gateway.usageBars(),
        id ? gateway.contextBreakdown(id) : Promise.resolve(null),
      ]);
      return {
        available: true,
        agentId: id,
        // null when this teammate has never taken a turn — not zero, because
        // zero would read as "measured, and it is nothing".
        session,
        account,
        breakdown,
        contextPercent:
          session && typeof session.context_percent === "number" ? session.context_percent : null,
      };
    },
    /**
     * Talk to a teammate mid-turn WITHOUT cancelling it.
     *
     * Unlike interrupt, the turn keeps running: Hermes drops the text onto the
     * next tool result, so the model reads it on its next iteration. The text
     * is echoed into the transcript as a user bubble because from the user's
     * point of view they did say it — and Hermes records the same correction
     * on its side, so a reload does not lose it.
     *
     * @param {string} agentId
     * @param {string} text
     */
    async steer(agentId, text) {
      const id = agentId || selectedEntry()?.id;
      const body = String(text || "").trim();
      if (!id || !body) return publicState();
      const agent = state.agents.find((a) => a.id === id);
      if (!agent) return publicState();
      try {
        const gateway = require("./hermes-gateway.cjs");
        if (!gateway.available() || !gateway.hasSession(id)) return publicState();
        const res = await gateway.steer(id, body);
        if (res && res.status === "queued") {
          pushMsg(id, { id: uuid(), role: "user", kind: "chat", text: body, at: now() });
          save();
        }
      } catch {
        /* nothing in flight, or the agent is still building — nothing to say */
      }
      return publicState();
    },
    /**
     * File checkpoints this teammate created, newest first.
     *
     * `{enabled:false}` means checkpointing is off for that bot's profile — a
     * `chat` teammate cannot touch files, so it has nothing to roll back.
     */
    /**
     * Content for one artifact, read on demand.
     *
     * Bounded to the OWNING bot's workspace — the id decides whose workspace,
     * never the caller, so a renderer bug cannot ask bot A to read bot B's
     * files, let alone anything outside a workspace.
     */
    /**
     * Force the debounced write to disk NOW.
     *
     * Saves are coalesced onto a 900ms timer, so without this a quit inside
     * that window loses whatever was in it. Called on `before-quit` and on
     * window close (main.cjs).
     */
    flush() {
      flushSave();
    },
    readArtifact(artifactId) {
      const row = (state.artifacts || []).find((a) => a.id === artifactId);
      if (!row) return { ok: false, reason: "unknown" };
      const home = botHome.prepare(dir, row.botId);
      const res = artifactLib.readArtifact(home.cwd, row.target);
      return { ...res, id: row.id, title: row.title, versions: row.versions, botId: row.botId };
    },
    /** The action log, newest first. `botId` narrows to one teammate. */
    listLog(botId) {
      const rows = state.log || [];
      return botId ? rows.filter((r) => r.botId === botId) : rows;
    },
    /** Artifacts, newest first. `botId` narrows to one teammate. */
    listArtifacts(botId) {
      const rows = state.artifacts || [];
      return botId ? rows.filter((a) => a.botId === botId) : rows;
    },
    deleteArtifact(artifactId) {
      state.artifacts = (state.artifacts || []).filter((a) => a.id !== artifactId);
      save();
      return publicState();
    },
    async rollbackList(agentId) {
      const id = agentId || selectedEntry()?.id;
      if (!id) return { enabled: false, checkpoints: [] };
      try {
        return await require("./hermes-gateway.cjs").rollbackList(id);
      } catch {
        return { enabled: false, checkpoints: [] };
      }
    },
    /** What one checkpoint changed on disk. */
    async rollbackDiff(agentId, hash) {
      const id = agentId || selectedEntry()?.id;
      if (!id || !hash) return null;
      try {
        return await require("./hermes-gateway.cjs").rollbackDiff(id, hash);
      } catch (err) {
        return { error: err.message };
      }
    },
    /**
     * Undo a teammate's file changes.
     *
     * Without `filePath` this is a FULL rollback: Hermes rewinds the session
     * history too, so the transcript gets a line saying so rather than
     * silently disagreeing with what the teammate now remembers.
     */
    async rollbackRestore(agentId, hash, filePath) {
      const id = agentId || selectedEntry()?.id;
      if (!id || !hash) return publicState();
      try {
        const res = await require("./hermes-gateway.cjs").rollbackRestore(id, hash, {
          filePath: filePath || undefined,
        });
        const agent = state.agents.find((a) => a.id === id);
        pushMsg(id, {
          id: uuid(),
          role: "system",
          kind: "event",
          fromId: id,
          text: filePath
            ? `Restored ${filePath} to an earlier version.`
            : `Rolled ${agent ? agent.name : "the teammate"} back to an earlier checkpoint.`,
          at: now(),
        });
        if (res && res.error) {
          pushMsg(id, {
            id: uuid(),
            role: "system",
            kind: "event",
            fromId: id,
            text: `Rollback problem: ${res.error}`,
            at: now(),
          });
        }
        save();
      } catch (err) {
        pushMsg(id, {
          id: uuid(),
          role: "system",
          kind: "event",
          fromId: id,
          text: `Could not roll back: ${err.message}`,
          at: now(),
        });
        save();
      }
      return publicState();
    },
    /** Compress a teammate's history on demand, regardless of how full it is. */
    async compact(agentId) {
      const id = agentId || selectedEntry()?.id;
      if (!id) return publicState();
      try {
        const gateway = require("./hermes-gateway.cjs");
        if (!gateway.available() || !gateway.hasSession(id)) return publicState();
        await gateway.compress(id);
        pushMsg(id, {
          id: uuid(),
          role: "system",
          kind: "event",
          fromId: id,
          text: "Older messages were summarised to free up room.",
          at: now(),
        });
        save();
      } catch (err) {
        /* busy turn, or no Hermes — nothing worth interrupting the user for */
      }
      return publicState();
    },
    async interrupt(agentId) {
      const id = agentId || selectedEntry()?.id;
      if (!id) return publicState();
      try {
        const gateway = require("./hermes-gateway.cjs");
        const agent = state.agents.find((a) => a.id === id);
        const ids = [...new Set([...(agent && agent.subagentIds) || [], agent && agent.lastSubagentId].filter(Boolean))];
        if (typeof gateway.interruptSubagent === "function") {
          for (const sid of ids) {
            await gateway.interruptSubagent(id, sid).catch(() => {});
          }
        }
        await gateway.interrupt(id);
        if (agent) {
          agent.backgroundTurn = null;
          agent.subagentIds = [];
          agent.lastSubagentId = "";
        }
      } catch {
        /* nothing in flight */
      }
      setStatus(id, "idle");
      save();
      return publicState();
    },
    async jobDone(agentId, spec = {}) {
      const agent = state.agents.find((a) => a.id === agentId);
      if (!agent) return publicState();
      const convId = spec.convId || (agent.backgroundTurn && agent.backgroundTurn.convId) || agent.id;
      const extracted = await speak(
        agent,
        "Job done.",
        jobDoneExtra(spec.goal || (agent.backgroundTurn && agent.backgroundTurn.goal), spec.result),
        convId
      );
      const threadId = convId || agent.id;
      if (!/^SKIP\.?$/i.test(String(extracted.text || "").trim())) {
        for (const bubble of splitBubbles(extracted.text, { max: 2 })) {
          pushMsg(threadId, {
            id: uuid(),
            role: "bot",
            kind: "chat",
            fromId: agent.id,
            text: bubble,
            at: now(),
          });
        }
      }
      agent.backgroundTurn = null;
      agent.subagentIds = [];
      agent.lastSubagentId = "";
      setStatus(agent.id, "idle");
      save();
      return publicState();
    },
    async steerSubagent(agentId, text) {
      const id = agentId || selectedEntry()?.id;
      const body = String(text || "").trim();
      if (!id || !body) return publicState();
      try {
        const gateway = require("./hermes-gateway.cjs");
        const agent = state.agents.find((a) => a.id === id);
        const sid = agent && agent.lastSubagentId;
        if (!sid || typeof gateway.steerSubagent !== "function") return publicState();
        await gateway.steerSubagent(id, sid, body);
      } catch {
        /* no live sub-agent */
      }
      return publicState();
    },
    // "Type your own answer" — resolves the card, then sends the typed text.
    async chooseCustom(messageId, text) {
      const entry = selectedEntry();
      const body = String(text || "").trim();
      if (!entry || !body) return publicState();
      const msg = threadOf(entry.id).find((m) => m.id === messageId);
      if (!msg || !Array.isArray(msg.choices)) return publicState();
      msg.picked = "custom";
      save();
      return api.send(body);
    },
    workspacePath(agentId) {
      const id = agentId || selected()?.id;
      if (!id) return "";
      return botHome.workspaceDir(dir, id);
    },
  };

  return api;
}

module.exports = {
  createStore,
  seedState,
  BLOBS,
  landingLines,
  toolImages,
  toolFiles,
  standing,
  splitBubbles,
  stripEmDashes,
  jobDoneExtra,
  trackSubagent,
  extractDirectives,
};
