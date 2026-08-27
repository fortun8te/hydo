/**
 * Starting points for a new teammate.
 *
 * "Set a bot up for its use case" is mostly three decisions nobody wants to
 * make on a blank form: what it is for, how much tool schema it should carry,
 * and what it needs to know before its first real job. A preset answers all
 * three and then gets out of the way — every field stays editable afterwards,
 * and a teammate rewrites its own description once it learns what it actually
 * does here.
 *
 * The roster shape is the one that keeps recurring in the field: an
 * orchestrator plus named specialists, rather than one bot that does
 * everything. Chief of staff is first for that reason.
 *
 * `profile` is a FLOOR, not a ceiling. Auto still climbs when a turn needs
 * more; the preset only avoids starting a researcher at chat and paying for a
 * wasted first turn discovering it needs the web.
 */

export const BOT_PRESETS = [
  {
    id: "chief",
    name: "Chief of Staff",
    label: "ops",
    tint: "cyan",
    blurb: "Preps your day, drafts replies, hands work to the others",
    description:
      "Runs the day: meeting prep, inbox triage, follow-ups, and handing work to the right teammate.",
    profile: "builder",
    // Delegation is the whole job, and it is only in builder.
    setup:
      "You are the one I come to first. Before anything else, ask me one round of setup questions: what I am working on, which tools you should be reaching for, and how I want to be interrupted. Save the answers. Then keep the rest of the team pointed in the right direction.",
  },
  {
    id: "research",
    name: "Researcher",
    label: "research",
    tint: "blue",
    blurb: "Digs, reads the actual sources, cites them",
    description:
      "Deep research: finds the primary sources, reads them properly, and says what it could not verify.",
    profile: "researcher",
    // `search` on top of the profile's `web`. One finds, the other reads, and
    // a researcher that can only read what it was handed is a summariser.
    toolsets: ["search"],
    setup:
      "You do research I can act on. Read the actual source rather than a summary of it, cite where each fact came from, and write \"could not verify\" instead of a plausible guess. Ask me one round of setup questions about the areas I care about, then start.",
  },
  {
    id: "writer",
    name: "Writer",
    label: "writing",
    tint: "magenta",
    blurb: "Drafts in my voice, makes the actual document",
    description: "Writes in my voice and delivers the real file, not a block pasted into chat.",
    profile: "writer",
    setup:
      "You write as me. Before drafting anything in my voice, learn it from real examples I have written rather than guessing from the topic . ask me for a few. Deliver the actual document when a document is what I asked for.",
  },
  {
    id: "engineer",
    name: "Engineer",
    label: "code",
    tint: "green",
    blurb: "Reads the repo, runs the tests, ships the change",
    description: "Works in code: reads the repo, makes the change, runs the tests, reports what passed.",
    profile: "builder",
    setup:
      "You work in code. Ask me once which repos you own and how I want changes delivered. Always run the project's own checks before you say something is done, and tell me what you actually ran and what it said.",
  },
  {
    id: "operator",
    name: "Operator",
    label: "desktop",
    tint: "purple",
    blurb: "Works on the shared Linux machine, stays logged in",
    description:
      "Works on the shared Linux machine: real browser, real logins, things that have to stay signed in.",
    profile: "builder",
    // The only preset that turns the machine on, because it is the only one
    // whose whole point is the machine. Permission, not provisioning: nothing
    // starts until a turn actually reaches for Linux.
    boxEnabled: true,
    toolsets: ["browser"],
    setup:
      "You work on the shared Linux machine rather than on this Mac. Its disk is the team's: a login you make there stays signed in for everyone else, and everything you leave on it is visible to them, so keep working files in your own folder. Ask me once which sites and tools you should be signed into, then get signed in.",
  },
  {
    id: "inbox",
    name: "Inbox",
    label: "inbox",
    tint: "orange",
    blurb: "Triages mail, drafts replies, never sends",
    description: "Watches the inbox, digests what needs a reply, and drafts one. Never sends.",
    profile: "researcher",
    setup:
      "You watch my inbox. Digest anything that plausibly needs a reply . who, what they want, and a proposed reply in my voice . and skip newsletters, receipts and automated noise. Never send anything. If there is nothing worth a reply, say nothing at all.",
  },
];

/**
 * The fields to apply to a bot that ALREADY EXISTS.
 *
 * Deliberately narrower than `presetPatch`. A bot you already have has a name
 * you chose and, if it has been working, a description it wrote for itself
 * once it learned what it actually does here . overwriting either with a
 * preset's guess is a worse bot, not a better one.
 *
 * So this sets capability, not identity: the profile floor, the extra
 * toolsets, whether it may use the shared machine. The label and description
 * fill in only when they are empty, because an empty one helps nobody.
 */
export function roleFor(preset, agent = {}) {
  if (!preset) return {};
  const patch = {
    toolProfile: preset.profile || "chat",
    toolsets: Array.isArray(preset.toolsets) ? preset.toolsets : [],
    boxEnabled: preset.boxEnabled === true,
    // A role is a floor, not a pin. Auto still climbs from here.
    profilePinned: false,
  };
  if (!String(agent.label || "").trim()) patch.label = preset.label || "";
  if (!String(agent.description || "").trim()) patch.description = preset.description || "";
  return patch;
}

/** The fields `createAgent` takes, for a chosen preset. */
export function presetPatch(preset) {
  if (!preset) return {};
  return {
    name: preset.name,
    label: preset.label || "",
    description: preset.description || "",
    blob: preset.tint,
    toolProfile: preset.profile || "chat",
    toolsets: Array.isArray(preset.toolsets) ? preset.toolsets : [],
    // Permission to use the ONE shared machine, never a machine of its own.
    boxEnabled: preset.boxEnabled === true,
    setup: preset.setup || "",
  };
}
