const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hydo", {
  getState: () => ipcRenderer.invoke("hydo:getState"),
  signIn: () => ipcRenderer.invoke("hydo:signIn"),
  signOut: () => ipcRenderer.invoke("hydo:signOut"),
  select: (id) => ipcRenderer.invoke("hydo:select", id),
  // `opts.replyTo` is a message id in the current conversation; the quote is
  // snapshotted at send time so it survives the original being deleted.
  send: (text, opts) => ipcRenderer.invoke("hydo:send", text, opts),
  createAgent: (patch) => ipcRenderer.invoke("hydo:createAgent", patch),
  deleteAgent: (id) => ipcRenderer.invoke("hydo:deleteAgent", id),
  setSettings: (patch) => ipcRenderer.invoke("hydo:setSettings", patch),
  setAgent: (id, patch) => ipcRenderer.invoke("hydo:setAgent", id, patch),
  setDraft: (id, draft) => ipcRenderer.invoke("hydo:setDraft", id, draft),
  createRoutine: (patch) => ipcRenderer.invoke("hydo:createRoutine", patch),
  setRoutine: (id, patch) => ipcRenderer.invoke("hydo:setRoutine", id, patch),
  deleteRoutine: (id) => ipcRenderer.invoke("hydo:deleteRoutine", id),
  runRoutine: (id) => ipcRenderer.invoke("hydo:runRoutine", id),
  choose: (messageId, choiceId) => ipcRenderer.invoke("hydo:choose", messageId, choiceId),
  chooseCustom: (messageId, text) => ipcRenderer.invoke("hydo:chooseCustom", messageId, text),
  answerApproval: (messageId, choice) => ipcRenderer.invoke("hydo:answerApproval", messageId, choice),
  answerClarify: (messageId, answer) => ipcRenderer.invoke("hydo:answerClarify", messageId, answer),
  answerGate: (messageId, value) => ipcRenderer.invoke("hydo:answerGate", messageId, value),
  previewZip: (filePath) => ipcRenderer.invoke("hydo:previewZip", filePath),
  previewFile: (filePath) => ipcRenderer.invoke("hydo:previewFile", filePath),
  saveFile: (filePath, name) => ipcRenderer.invoke("hydo:saveFile", filePath, name),
  interrupt: (agentId) => ipcRenderer.invoke("hydo:interrupt", agentId),
  openWorkspace: (agentId) => ipcRenderer.invoke("hydo:openWorkspace", agentId),
  createChannel: (patch) => ipcRenderer.invoke("hydo:createChannel", patch),
  setChannel: (id, patch) => ipcRenderer.invoke("hydo:setChannel", id, patch),
  toggleChannelMember: (channelId, agentId) =>
    ipcRenderer.invoke("hydo:toggleChannelMember", channelId, agentId),
  deleteChannel: (id) => ipcRenderer.invoke("hydo:deleteChannel", id),

  // Reactions. Toggling the same emoji from the same actor removes it.
  react: (messageId, emoji) => ipcRenderer.invoke("hydo:react", messageId, emoji),

  // Roster context menu. Each works for a bot OR a channel.
  setPinned: (id, pinned) => ipcRenderer.invoke("hydo:setPinned", id, pinned),
  setUnread: (id, unread) => ipcRenderer.invoke("hydo:setUnread", id, unread),
  setHidden: (id, hidden) => ipcRenderer.invoke("hydo:setHidden", id, hidden),
  createSection: (patch) => ipcRenderer.invoke("hydo:createSection", patch),
  renameSection: (id, name) => ipcRenderer.invoke("hydo:renameSection", id, name),
  deleteSection: (id) => ipcRenderer.invoke("hydo:deleteSection", id),
  moveToSection: (ids, sectionId) => ipcRenderer.invoke("hydo:moveToSection", ids, sectionId),
  deleteEntries: (ids) => ipcRenderer.invoke("hydo:deleteEntries", ids),
  duplicateAgent: (id) => ipcRenderer.invoke("hydo:duplicateAgent", id),

  // Talk to a teammate mid-turn without cancelling it.
  steer: (agentId, text) => ipcRenderer.invoke("hydo:steer", agentId, text),

  // Real usage numbers: {available, session, account, breakdown, contextPercent}.
  usage: (agentId) => ipcRenderer.invoke("hydo:usage", agentId),

  // Model picker: providers + their models, layered on this bot's live session.
  listModels: (agentId, opts) => ipcRenderer.invoke("hydo:listModels", agentId, opts),
  // Self-hosted endpoints from ~/.hermes/config.yaml. `providers` carries no
  // api_key by construction (electron/local-providers.cjs) — a key in
  // renderer state is a key in a devtools heap snapshot.
  localProviders: () => ipcRenderer.invoke("hydo:localProviders"),
  probeLocalProvider: (id) => ipcRenderer.invoke("hydo:probeLocalProvider", id),

  // Hermes' own transcript and session registry.
  history: (agentId) => ipcRenderer.invoke("hydo:history", agentId),
  listSessions: (opts) => ipcRenderer.invoke("hydo:listSessions", opts),
  resumeSession: (agentId, sessionId, opts) =>
    ipcRenderer.invoke("hydo:resumeSession", agentId, sessionId, opts),

  // Attachments — staged into the session, consumed by the next message.
  attachFile: (agentId, path, opts) => ipcRenderer.invoke("hydo:attachFile", agentId, path, opts),
  attachImage: (agentId, path) => ipcRenderer.invoke("hydo:attachImage", agentId, path),
  attachImageBytes: (agentId, base64, opts) =>
    ipcRenderer.invoke("hydo:attachImageBytes", agentId, base64, opts),
  attachPdf: (agentId, path, opts) => ipcRenderer.invoke("hydo:attachPdf", agentId, path, opts),
  pasteClipboard: (agentId) => ipcRenderer.invoke("hydo:pasteClipboard", agentId),
  detachImage: (agentId, path) => ipcRenderer.invoke("hydo:detachImage", agentId, path),

  // Hermes' learning store (skills + memories it wrote for itself).
  learningFrames: (opts) => ipcRenderer.invoke("hydo:learningFrames", opts),
  learningDetail: (id) => ipcRenderer.invoke("hydo:learningDetail", id),
  learningEdit: (id, content) => ipcRenderer.invoke("hydo:learningEdit", id, content),
  learningDelete: (id) => ipcRenderer.invoke("hydo:learningDelete", id),
  insights: (days) => ipcRenderer.invoke("hydo:insights", days),

  // Hermes' scheduler.
  cron: (action, params) => ipcRenderer.invoke("hydo:cron", action, params),

  // Tool profiles. A bot's profile decides how much tool schema it carries on
  // every turn — `chat` costs 5,096 prompt tokens where Hermes' own default
  // costs 18,327. Set with setAgent(id, { toolProfile, mcp }).
  toolProfiles: () => ipcRenderer.invoke("hydo:toolProfiles"),
  toolsets: () => ipcRenderer.invoke("hydo:toolsets"),
  listSkills: () => ipcRenderer.invoke("hydo:listSkills"),
  runtimeStatus: () => ipcRenderer.invoke("hydo:runtimeStatus"),

  // Summarise a long history on demand (it also happens automatically at 70%).
  compact: (agentId) => ipcRenderer.invoke("hydo:compact", agentId),

  // Undo a teammate's file changes.
  dismissClarify: (id) => ipcRenderer.invoke("hydo:dismissClarify", id),
  // The ONE shared box. `boxEnsure` starts or resumes it and therefore starts
  // billing; everything else is free to call.
  // What this teammate left running in the background, and stopping one.
  // Rewind the last exchange: the model forgets it and so does the thread.
  // Not the file rollback . this one touches nothing on disk.
  sessionToolsets: (agentId) => ipcRenderer.invoke("hydo:sessionToolsets", agentId),
  undoLast: (agentId) => ipcRenderer.invoke("hydo:undoLast", agentId),
  processes: (agentId) => ipcRenderer.invoke("hydo:processes", agentId),
  killProcess: (agentId, processId) => ipcRenderer.invoke("hydo:killProcess", agentId, processId),
  boxStatus: () => ipcRenderer.invoke("hydo:boxStatus"),
  boxLimits: () => ipcRenderer.invoke("hydo:boxLimits"),
  boxEnsure: (reason) => ipcRenderer.invoke("hydo:boxEnsure", reason),
  boxStop: () => ipcRenderer.invoke("hydo:boxStop"),
  boxDesktop: () => ipcRenderer.invoke("hydo:boxDesktop"),
  pickFiles: () => ipcRenderer.invoke("hydo:pickFiles"),
  attachAny: (agentId, filePath) => ipcRenderer.invoke("hydo:attachAny", agentId, filePath),
  openExternal: (url) => ipcRenderer.invoke("hydo:openExternal", url),
  readArtifact: (id) => ipcRenderer.invoke("hydo:readArtifact", id),
  listArtifacts: (botId) => ipcRenderer.invoke("hydo:listArtifacts", botId),
  deleteArtifact: (id) => ipcRenderer.invoke("hydo:deleteArtifact", id),
  rollbackList: (agentId) => ipcRenderer.invoke("hydo:rollbackList", agentId),
  rollbackDiff: (agentId, hash) => ipcRenderer.invoke("hydo:rollbackDiff", agentId, hash),
  rollbackRestore: (agentId, hash, filePath) =>
    ipcRenderer.invoke("hydo:rollbackRestore", agentId, hash, filePath),

  // Plugins / connected apps.
  listPlugins: () => ipcRenderer.invoke("hydo:listPlugins"),
  addPlugin: (id) => ipcRenderer.invoke("hydo:addPlugin", id),
  removePlugin: (id) => ipcRenderer.invoke("hydo:removePlugin", id),
  testPlugin: (id) => ipcRenderer.invoke("hydo:testPlugin", id),
  startPluginAuth: (id) => ipcRenderer.invoke("hydo:startPluginAuth", id),
  pollPluginAuth: (id, sessionId) => ipcRenderer.invoke("hydo:pollPluginAuth", id, sessionId),
  setPluginKey: (id, value, envVar) =>
    ipcRenderer.invoke("hydo:setPluginKey", id, value, envVar),

  // Approval mode (Hermes' approvals.mode: smart/manual, never off from
  // here) and the permanent "always" allowlist — scoped to ONE bot's own
  // profile (~/.hermes/profiles/hydo<id>/config.yaml). See docs/SAFETY.md.
  approvalSettings: (agentId) => ipcRenderer.invoke("hydo:approvalSettings", agentId),
  setApprovalMode: (agentId, mode) => ipcRenderer.invoke("hydo:setApprovalMode", agentId, mode),
  revokeApproval: (agentId, pattern) => ipcRenderer.invoke("hydo:revokeApproval", agentId, pattern),
  onState: (fn) => {
    const listener = (_e, state) => fn(state);
    ipcRenderer.on("hydo:state", listener);
    return () => ipcRenderer.removeListener("hydo:state", listener);
  },
});
