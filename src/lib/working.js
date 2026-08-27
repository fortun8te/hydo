/**
 * Working is per-conversation. `agent.workingIn` is the conversation id
 * (bot id for 1:1, channel id for a channel). Missing/null means idle
 * everywhere — never fall back to a global `status === "working"` which
 * would spin the avatar in every chat.
 */
export function botWorks(agent, conversationId) {
  if (!agent) return false;
  if (agent.workingIn == null || agent.workingIn === "") return false;
  const conv = conversationId || agent.id;
  return String(agent.workingIn) === String(conv);
}

/** Roster / collapsed rail: spin wherever this bot is busy. */
export function botBusy(agent) {
  return !!(agent && agent.workingIn);
}

export function channelWorks(channel, agents) {
  const list = Array.isArray(agents) ? agents : [];
  return (channel?.members || []).some((id) => {
    const member = list.find((a) => a.id === id);
    return member ? botWorks(member, channel.id) : false;
  });
}

export function moodForWorking(live) {
  return live ? "spin" : "idle";
}
