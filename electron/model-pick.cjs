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

/**
 * Is this provider id one of the user's own self-hosted endpoints?
 *
 * The name of a MODEL never decides where it runs. A local box can serve
 * anything it likes -- including a GGUF someone named `grok-something` -- and
 * the old `/grok/i` test would then hand that turn to xAI over the network.
 * The provider id is the only thing that knows which machine answers, so it is
 * the only thing allowed to decide.
 *
 * Lazily required and wrapped: this must never throw into a settings write,
 * and a missing/garbage ~/.hermes/config.yaml simply means "no local
 * endpoints", not "crash".
 */
function isLocalProvider(name) {
  const id = String(name || "").trim();
  if (!id) return false;
  try {
    const lp = require("./local-providers.cjs");
    const file = process.env.HYDO_HERMES_CONFIG || lp.CONFIG;
    return lp.list(file).some((p) => p.id === id);
  } catch {
    return false;
  }
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
  // A local endpoint wins over every model-name rule below. See
  // `isLocalProvider`: the model string is not evidence about the machine.
  if (isLocalProvider(named)) return named;
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
  // The user's name goes in AGENTS.md, which is the only durable context a
  // Hermes session gets. It was nowhere: not in the soul, not here, so every
  // bot opened by asking a question the app already knew the answer to.
  // Stable text, so it does not disturb the cached prompt prefix.
  const you = String((settings && settings.userName) || "").trim();
  const chat = sessionModel(agent, settings);
  const code = codingModel(agent, settings);
  const grok = grokFlag(code);
  const harness = harnessInfo(settings);
  // And who the teammate ITSELF is. This was nowhere either, and it is the
  // half that breaks: a bot renames itself, the roster changes, and the model
  // never sees that it landed — so the next time the user pushes ("you are
  // still called test") it believes them and picks a SECOND name. Michael
  // watched one call itself Wes and the roster say Arlo. The name is written
  // here, once, and it is the thing that says the rename worked.
  const me = String((agent && agent.name) || "").trim();
  const named = me && me !== "New Bot";
  const lines = [
    ...(named
      ? ["## Who you are", `The roster calls you **${me}**. That is your name, whatever an earlier message in this thread says.`, ""]
      : []),
    ...(you ? ["## Who you are talking to", `Their name is **${you}**. Use it. Never ask for it.`, ""] : []),
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
  isLocalProvider,
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
