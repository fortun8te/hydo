"use strict";

/**
 * Chat model vs coding (Grok Build) model.
 * Hermes session.create gets the chat model. Grok CLI `-m` gets the coding
 * model, which defaults to the same pick when it maps onto a grok-* id.
 */

const MUSE_CONTRIBUTOR = "muse-spark-1.2-contributor";
const MUSE_PROVIDER = "meta-ai";
const DEFAULT_CHAT = "grok-4.6";
const DEFAULT_PROVIDER = "xai-oauth";

const HARNESSES = {
  "grok-build": {
    id: "grok-build",
    label: "Grok Build",
    connecting: "Connecting to Grok Build",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    connecting: "Connecting to OpenCode",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    connecting: "Connecting to Cursor",
  },
  shell: {
    id: "shell",
    label: "Workspace shell",
    connecting: "On your computer",
  },
};

const DEFAULT_HARNESS = "grok-build";

function normalizeHarness(id) {
  const s = String(id || "").trim().toLowerCase().replace(/\s+/g, "-");
  if (s === "grok" || s === "grokbuild") return "grok-build";
  if (s === "open-code" || s === "open_code") return "opencode";
  if (HARNESSES[s]) return s;
  return DEFAULT_HARNESS;
}

function harnessInfo(settings) {
  return HARNESSES[normalizeHarness(settings && settings.codingHarness)] || HARNESSES[DEFAULT_HARNESS];
}

function isBannedChatModel(id) {
  const s = String(id || "").trim().toLowerCase();
  if (!s) return false;
  return s.includes("ox-alpha") || s.includes("stealth");
}

function normalizeChatModel(id) {
  const s = String(id || "").trim();
  if (!s || isBannedChatModel(s)) return DEFAULT_CHAT;
  return s;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v == null ? "" : v).trim();
    if (s) return s;
  }
  return "";
}

function sessionModel(agent, settings) {
  return normalizeChatModel(firstNonEmpty(agent && agent.model, settings && settings.model, DEFAULT_CHAT));
}

function sessionProvider(agent, settings) {
  const model = sessionModel(agent, settings).toLowerCase();
  const named = firstNonEmpty(agent && agent.provider, settings && settings.provider);
  if (model.includes("muse")) return named || MUSE_PROVIDER;
  if (model.includes("grok")) {
    if (named === "xai" || named === MUSE_PROVIDER || !named) return DEFAULT_PROVIDER;
    return named;
  }
  if (named) return named;
  return "";
}

function codingModel(agent, settings) {
  return firstNonEmpty(
    settings && settings.codingModel,
    agent && agent.codingModel,
    sessionModel(agent, settings)
  );
}

/** Map Hydo / Hermes / OpenRouter ids onto `grok -m` ids. Empty = omit -m. */
function grokCliModel(id) {
  const raw = String(id || "").trim();
  if (!raw) return "";
  const s = raw.toLowerCase();
  const leaf = s.split("/").pop() || s;
  if (leaf.includes("grok-4.5") || leaf === "grok-4.5") return "grok-4.5";
  if (leaf.includes("grok-4.6") || leaf === "grok-4.6") return "grok-4.6";
  if (/^grok-4($|[^0-9])/.test(leaf) || leaf === "grok-4") return "grok-4.6";
  if (leaf.startsWith("grok-")) return leaf;
  if (s.includes("grok-4.5")) return "grok-4.5";
  if (s.includes("grok-4.6") || s.includes("grok-4")) return "grok-4.6";
  return "";
}

function grokFlag(id) {
  const m = grokCliModel(id);
  return m ? `-m ${m}` : "";
}

function agentsModelBlock(agent, settings) {
  const chat = sessionModel(agent, settings);
  const code = codingModel(agent, settings);
  const grok = grokFlag(code);
  const harness = harnessInfo(settings);
  const lines = [
    "## Models",
    chat ? `Hermes session model: \`${chat}\`.` : "Hermes session model: inherit from Hermes config.",
    `Coding harness (Settings): **${harness.label}**. Workdir is this workspace.`,
  ];
  if (harness.id === "grok-build") {
    lines.push(
      grok
        ? `Heavy coding: Grok Build. Always \`grok --no-auto-update ${grok} -p '...'\`.`
        : "Heavy coding: Grok Build (`grok --no-auto-update -p '...'`). Omit `-m` unless the user named a Grok model."
    );
    lines.push("Prefer `grok --no-auto-update --always-approve -p '...'` for one-shot jobs here.");
  } else if (harness.id === "opencode") {
    lines.push(
      "Heavy coding: OpenCode. Run `opencode run` / `opencode -p '...'` in this workspace. Do not use `grok -p` unless they ask."
    );
  } else if (harness.id === "cursor") {
    lines.push(
      "Heavy coding: Cursor CLI if it exists (`cursor agent` / `agent`). Do not drive the Cursor GUI. Do not use `grok -p` unless they ask."
    );
  } else {
    lines.push(
      "Heavy coding: stay in this workspace with the shell. Do not call grok, opencode, or cursor unless the user names them."
    );
  }
  return lines.join("\n");
}

module.exports = {
  MUSE_CONTRIBUTOR,
  MUSE_PROVIDER,
  DEFAULT_CHAT,
  DEFAULT_PROVIDER,
  HARNESSES,
  DEFAULT_HARNESS,
  isBannedChatModel,
  normalizeChatModel,
  normalizeHarness,
  harnessInfo,
  sessionModel,
  sessionProvider,
  codingModel,
  grokCliModel,
  grokFlag,
  agentsModelBlock,
};
