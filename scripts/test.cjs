const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function mustInclude(rel, needles) {
  const src = read(rel);
  for (const needle of needles) {
    assert.ok(src.includes(needle), `${rel} missing ${JSON.stringify(needle)}`);
  }
}

require("./plan-check.cjs");

function srcTree() {
  return walk(path.join(ROOT, "src"))
    .concat(walk(path.join(ROOT, "electron")))
    .concat(walk(path.join(ROOT, "scripts")))
    .filter((p) => /\.(jsx?|cjs|css|html)$/.test(p));
}

// --- kit / theme / no Cursor frontend ---
mustInclude("src/main.jsx", [
  'dataset.theme = "cursor-dark"',
  "tokens.css",
  "icons.css",
]);
assert.ok(
  fs.existsSync(path.join(ROOT, "src/kit/tokens.css")),
  "src/kit/tokens.css missing"
);
assert.ok(
  fs.existsSync(path.join(ROOT, "src/kit/icons.css")),
  "src/kit/icons.css missing"
);
assert.ok(
  fs.existsSync(path.join(ROOT, "src/kit/cursor-icons.woff2")),
  "src/kit/cursor-icons.woff2 missing"
);
assert.ok(
  fs.existsSync(path.join(ROOT, "src/kit/images/app-icon-C7NKj2u7.png")),
  "kit app icon missing"
);

const kitFront = ["extracted-ui-kit", "frontend"].join("/");
for (const file of srcTree()) {
  if (file.endsWith("scripts/test.cjs")) continue;
  const src = fs.readFileSync(file, "utf8");
  assert.ok(!src.includes(kitFront), `${path.relative(ROOT, file)} imports ${kitFront}`);
}

mustInclude("src/screens/SignIn.jsx", ["Sign in"]);
// The shell was split so each surface has one owner: roster in Sidebar,
// input in Composer, layout/routing in Shell.
mustInclude("src/screens/Sidebar.jsx", ["Search", "Plugins", "data-collapsed", "New Bot", "New Channel", "sand-row__dot", "Online"]);
mustInclude("src/lib/plugin-icons.js", ["figma", "blender", "searxng", "pencil", "chatgpt", "pluginIconUrl"]);
mustInclude("src/screens/Plugins.jsx", ["pluginPrettyName", "addPlugin", "orderCategories"]);
mustInclude("src/screens/Sidebar.jsx", ["folder-plus", "Move ", "Unassigned", "New section"]);
mustInclude("src/screens/ContextMenu.jsx", ["submenu", "folder-plus", "chevron-right"]);
mustInclude("src/lib/file-preview.js", [".nd", "property.zip", "ND document"]);
mustInclude("src/screens/RichContent.jsx", ["hy-rc-file-dl", "saveFile"]);
mustInclude("src/lib/working.js", ["workingIn"]);
mustInclude("src/umbra/spin-turn.js", ["easeInOutCubic", "SPIN_PAUSE"]);
mustInclude("src/umbra/UmbraFace.jsx", ["shine: 0.12", "MORPH_MS", "DETAIL = 4", "onPoke", "spinStage"]);
mustInclude("src/umbra/spin-turn.js", ["spinStage", "easeYawToRest"]);
mustInclude("src/screens/BotRail.jsx", ["morph"]);
mustInclude("electron/hermes-gateway.cjs", [
  "respondGate",
  "sudo.request",
  "refusing",
  "hermesProfile",
  "computer_use",
  "prompt.background",
  "background.complete",
  "subagent.interrupt",
  "subagent.steer",
]);
mustInclude("electron/bot-home.cjs", ["SHARED.md", "workspace", "subagents.jsonl"]);
mustInclude("electron/hermes-gateway.cjs", ["cron.manage", "params.profile"]);
mustInclude("electron/routines.cjs", ["hermesSchedule", "jobIdFrom"]);
{
  const r = require(path.join(ROOT, "electron/routines.cjs"));
  assert.equal(r.hermesSchedule({ kind: "schedule", cadence: "hourly" }), "every 1h");
  assert.equal(r.hermesSchedule({ kind: "schedule", cadence: "once", at: "2026-08-27T08:00:00" }), "2026-08-27T08:00:00");
  assert.equal(r.jobIdFrom({ job_id: "abc123def456" }), "abc123def456");
}
mustInclude("electron/SOUL.default.md", ["hydo-soul:", "computer_use", "delegate_task", "SHARED.md", "Grok Build", "Watch jobs", "Silence is default", "dispatcher"]);
mustInclude("electron/hermes-gateway.cjs", ["bot.bg", "onYielded", "muteDelta"]);
{
  const soul = read("electron/SOUL.default.md");
  assert.ok(!soul.includes("short bubbles as you go"), "soul must not invite spray");
  assert.ok(!soul.includes("Talk like Grok Bot"), "soul must not name Grok Bot");
}
mustInclude("src/screens/Settings.jsx", [
  "Chat model",
  "Coding / Grok Build",
  "Coding harness",
  "OpenCode",
  "muse-spark-1.2-contributor",
  "Muse Spark 1.2 contributor",
]);
mustInclude("electron/model-pick.cjs", ["grokCliModel", "sessionModel"]);
mustInclude("electron/context-mgmt.cjs", ["shouldCompact", "contextPercent"]);
mustInclude("src/screens/Settings.jsx", ["Context window", "contextPercent"]);
mustInclude("src/screens/Composer.jsx", ["sand-slash", "New Channel", "New Bot", "send--stop"]);
mustInclude("src/screens/composer.css", ["send--stop"]);
mustInclude("src/screens/BotRail.jsx", ["Open workspace", "Tools", "Reason", "Connections", "toolProfiles", "reasoningEffort"]);
mustInclude("electron/store.cjs", [
  "Hermes failed:",
  "toolImages",
  "sessionModel",
  "sessionProvider",
  "hermesSessionId",
  "hermesRowId",
  "gateRespondBody",
  'deliver: "local"',
]);
{
  const storeSrc = read("electron/store.cjs");
  assert.ok(!storeSrc.includes('deliver: "origin"'), "Hermes cron must not deliver origin turns");
}
{
  const storeSrc = read("electron/store.cjs");
  assert.ok(!storeSrc.includes("function parseChoices"), "parseChoices must be gone");
  assert.ok(!storeSrc.includes("MEMORY:\\s*add"), "MEMORY: regex must be gone");
  assert.ok(!storeSrc.includes("a blank line starts a new bubble"), "standing must not teach blank-line splits");
  assert.ok(!storeSrc.includes("background: !jobWake && liveWorkers"), "first user turn must background without waiting for liveWorkers");
  assert.ok(storeSrc.includes("background: !jobWake"), "speak must pass background: !jobWake");
  assert.ok(
    storeSrc.includes('agent.reasoningEffort || "low"'),
    "1:1 turns default reasoningEffort low"
  );
  // The landing turn is the one turn EVERY bot takes, and it is a greeting.
  // It stays cheap through its PROMPT and its lack of tools — but it must NOT
  // ask for a different reasoningEffort than the turns after it. sessionFor
  // keys the session on that field, so `minimal` here followed by `low` on the
  // first real message tore the session down and rebuilt it, visibly, on every
  // teammate ever created. A few hundred tokens saved against a whole session
  // and its prefill lost.
  // Comments stripped first: the fix's own explanation quotes the pattern it
  // bans, and a scan that cannot tell prose from code would forbid writing
  // down why the rule exists. That has now caught me four times in this repo.
  const storeCode = storeSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/flags\.lean \? "minimal"/.test(storeCode),
    "the landing turn must not move reasoningEffort; it is the session key"
  );
  assert.ok(storeSrc.includes("{ lean: true }"), "and landNewBot asks for it");
  // Nothing may fall back to `builder`. The hydration default is chat and auto
  // climbs from there, so a builder fallback is 16.6k/turn nobody chose.
  assert.ok(
    !/toolProfile \|\| "builder"/.test(storeSrc),
    "no path falls back to the expensive profile"
  );
  assert.ok(storeSrc.includes("agent.backgroundTurn || hermesBusy"), "send must return when busy");
  assert.ok(storeSrc.includes("extracted.yielded"), "speak must forward yielded");
}
{
  const gw = read("electron/hermes-gateway.cjs");
  assert.ok(gw.includes("settleTurn(bot.bg"), "interrupt must settle bot.bg");
  assert.ok(gw.includes("function isBusy"), "gateway must export isBusy");
}
mustInclude("src/screens/AccountMenu.jsx", ["Settings", "About", "Help Center", "Send Feedback", "Log out"]);
{
  const menu = read("src/screens/AccountMenu.jsx");
  assert.ok(!menu.includes("Hydo Plus"), "no fake plus row");
  assert.ok(!menu.includes("iOS"), "no fake iOS row");
}
mustInclude("src/screens/ChannelCreate.jsx", ["New channel", "Ex: Project Falcon", "Add Bots", "Create"]);
mustInclude("src/screens/Shell.jsx", ["ChannelCreate", "setChannelCreate", "BotCreate"]);
// The composer placeholder is owned by Shell, which knows who is selected.
mustInclude("src/screens/Shell.jsx", ["Sidebar", "Composer", "Transcript", "Message "]);
mustInclude("src/screens/Transcript.jsx", ["presenceOf", "mood={presence.mood}"]);
mustInclude("src/lib/presence.js", ["presenceOf", "looking", "typing", "spin", "composerExtrasForMember"]);
mustInclude("src/screens/Transcript.jsx", ["composerExtrasForMember"]);
{
  const { landingLines } = require(path.join(ROOT, "electron/store.cjs"));
  assert.deepEqual(landingLines("Michael"), [], "new bots have no canned start");
}

// The collapsed sidebar must stay mounted. Unmounting it is the bug that made
// collapsing feel like the sidebar was destroyed.
{
  const shell = read("src/screens/Shell.jsx");
  assert.ok(
    !/\{\s*sidebarOpen\s*&&\s*</.test(shell),
    "sidebar must not be conditionally unmounted"
  );
}
mustInclude("src/styles.css", ["--sand-sidebar-width", "--sand-titlebar-block"]);
mustInclude("src/kit/tokens.css", ["--sand-sidebar-width: 280px", "--sand-titlebar-block: 52px"]);

const ui = srcTree()
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");
for (const needle of [
  "Settings",
  "About",
  "Help Center",
  "Send Feedback",
  "Log out",
  "General",
  "Usage",
  "Updates",
  "Name",
  "Label (optional)",
  "Description",
  "Notifications",
]) {
  assert.ok(ui.includes(needle), `UI source missing ${JSON.stringify(needle)}`);
}

const srcOnly = walk(path.join(ROOT, "src"))
  .filter((p) => /\.(jsx?|cjs|css|html)$/.test(p))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");
for (const needle of ["Routines", "Create Routine", "Send that?"]) {
  assert.ok(srcOnly.includes(needle), `src/ missing ${JSON.stringify(needle)}`);
}

async function chatPersist() {
  const { createStore } = require(path.join(ROOT, "electron/store.cjs"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-store-"));
  const store = createStore({
    dir,
    complete: async () => "pong from store",
  });

  const before = store.getState();
  assert.equal(before.signedIn, false);
  assert.equal(before.agents.length, 0, "no placeholder bots");
  store.signIn();
  const signed = store.getState();
  assert.equal(signed.signedIn, true);
  assert.equal(signed.agents.length, 0);

  store.createAgent();
  const firstId = store.getState().selectedId;
  {
    const born = store.getState().agents.find((a) => a.id === firstId);
    // Auto mode: a new bot starts on the CHEAPEST rung and climbs only when a
    // turn actually needs more (auto-profile.cjs). It used to be born on
    // `builder`, ~16.6k of tool schema for a bot whose first message is "hey".
    assert.equal(born.toolProfile, "chat", "new bot starts cheap under auto mode");
    assert.equal(born.profilePinned, false, "and is not pinned, so it can climb");
    assert.equal(born.reasoningEffort, "low", "new bot reasoningEffort");
    assert.deepEqual(born.mcp, [], "new bot mcp must be empty");
  }
  store.setAgent(firstId, { name: "Alpha" });
  store.landNewBot(firstId);
  store.createAgent();
  const secondId = store.getState().selectedId;
  store.setAgent(secondId, { name: "Beta" });
  store.landNewBot(secondId);
  store.select(firstId);
  const second = store.getState().agents.find((a) => a.id === secondId);
  assert.ok(firstId && second, "need two created bots");
  store.deleteAgent("missing");
  assert.equal(store.getState().agents.length, 2);
  assert.ok(store.getState().agents[0].shape, "created bot needs a body shape");

  const afterSend = await store.send("hello");
  const thread = afterSend.messages[firstId] || [];
  const userIdx = thread.findIndex((m) => m.role === "user" && m.text === "hello");
  assert.ok(userIdx >= 0, "user turn 'hello' missing");
  const bot = thread.slice(userIdx + 1).find((m) => m.role === "bot" && String(m.text || "").trim());
  assert.ok(bot, "bot reply after user turn missing");
  assert.ok(String(bot.text).trim().length > 0, "bot reply empty");

  store.select(second.id);
  const switched = store.getState();
  assert.equal(switched.selectedId, second.id);
  const otherThread = switched.messages[second.id] || [];
  assert.ok(
    !otherThread.some((m) => m.role === "user" && m.text === "hello"),
    "hello leaked onto the other bot thread"
  );

  store.select(firstId);
  const back = store.getState();
  assert.equal(back.selectedId, firstId);
  assert.ok(
    (back.messages[firstId] || []).some((m) => m.role === "user" && m.text === "hello"),
    "hello disappeared after reselect"
  );

  const empty = await store.send("   ");
  const emptyThread = empty.messages[firstId] || [];
  assert.equal(emptyThread.length, thread.length, "blank send must not persist");

  store.select(firstId);
  const devLenBefore = (store.getState().messages[second.id] || []).length;
  const pinged = await store.send(`ping ${second.name} hello from tests`);
  const sauceThread = pinged.messages[firstId] || [];
  const devThread = pinged.messages[second.id] || [];
  assert.ok(
    sauceThread.some((m) => m.kind === "sending"),
    "ping must emit Pinging …"
  );
  assert.ok(
    sauceThread.some((m) => m.kind === "tally" && m.peerId === second.id),
    "ping must emit Messaged tally"
  );
  assert.ok(
    !sauceThread.some((m) => m.fromId === second.id && m.kind === "chat"),
    "specialist bubbles must not copy onto the requester thread"
  );
  assert.equal(
    devThread.length,
    devLenBefore,
    "ping must not write onto the specialist's user thread"
  );
  const dmMsgs = Object.values(pinged.dms || {}).flat();
  assert.ok(
    dmMsgs.some((m) => m.fromId === second.id && m.kind === "chat"),
    "ping must land in the bot-to-bot dm"
  );
  const afterPing = (pinged.agents.find((a) => a.id === firstId) || {}).status;
  assert.equal(afterPing, "idle", "bot returns idle after ping");

  const withRoutine = store.createRoutine({
    name: "Check Chandni dispute update",
    instruction: "Check the chat and ping.",
    at: new Date(Date.now() - 1000).toISOString(),
  });
  const list = withRoutine.routines[firstId] || [];
  assert.ok(list.length >= 1, "createRoutine missing");
  assert.ok(
    (withRoutine.messages[firstId] || []).some((m) => m.kind === "routine"),
    "Created routine chip missing"
  );
  const due = store.dueRoutines(new Date().toISOString());
  assert.ok(due.includes(list[0].id), "dueRoutines should include past-due active routine");
  const ran = await store.runRoutine(list[0].id);
  assert.ok((ran.routines[firstId][0].runs || []).length >= 1, "runRoutine history missing");

  store.setDraft(firstId, "hello draft");
  const drafted = store.getState().agents.find((a) => a.id === firstId);
  assert.ok(drafted, "setDraft target agent missing");
  assert.equal(drafted.draft, "hello draft");

  const paused = store.createRoutine({
    name: "Paused Chandni check",
    instruction: "Stay quiet.",
    at: new Date(Date.now() - 1000).toISOString(),
  });
  const pausedId = ((paused.routines[firstId] || [])[0] || {}).id;
  assert.ok(pausedId, "createRoutine for inactive check missing");
  store.setRoutine(pausedId, { active: false });
  const afterPause = store.dueRoutines();
  assert.ok(!afterPause.includes(pausedId), "inactive routine must not be due");

  const threadBeforeChoose = store.getState().messages[firstId] || [];
  const chooseLen = threadBeforeChoose.length;
  await store.choose();
  assert.equal(
    (store.getState().messages[firstId] || []).length,
    chooseLen,
    "choose without a choice message must be a no-op"
  );
}

function stripCanned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-canned-"));
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify({
      hydoSeed: 2,
      signedIn: true,
      selectedId: "sauce",
      settings: { userName: "Michael" },
      agents: [
        { id: "sauce", name: "Sauce", blob: "white" },
        { id: "mine", name: "Mine", blob: "blue" },
      ],
      messages: {},
      routines: {},
    })
  );
  const store = require(path.join(ROOT, "electron/store.cjs")).createStore({
    dir,
    complete: async () => "x",
  });
  const st = store.getState();
  assert.equal(st.agents.length, 1, "canned Sauce/Dev must be stripped");
  assert.equal(st.agents[0].name, "Mine");
}

// --- channels: fan-out, the quiet rule, the member cap, rename events ---
async function channels() {
  const { createStore } = require(path.join(ROOT, "electron/store.cjs"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-channels-"));
  let n = 0;
  const store = createStore({
    dir,
    // A member told it is "Quiet" stays quiet, which is how the prompt rule
    // is supposed to behave in the real thing.
    complete: async (system) => (/You are Quiet/.test(system) ? "SKIP" : `reply ${++n}`),
  });

  store.signIn();
  const make = (name) => {
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name });
    store.landNewBot(id);
    return id;
  };
  const alpha = make("Alpha");
  const beta = make("Beta");
  const quiet = make("Quiet");

  // Renaming a bot must land in its thread.
  store.setAgent(alpha, { name: "Scout" });
  const events = (store.getState().messages[alpha] || []).filter((m) => m.kind === "event");
  assert.equal(events.length, 1, "rename must push exactly one event");
  assert.match(events[0].text, /renamed Alpha to Scout/, "rename event text");

  // A fresh bot renamed off "New Bot" must NOT announce itself.
  store.createAgent();
  const fresh = store.getState().selectedId;
  store.setAgent(fresh, { name: "Gamma" });
  assert.equal(
    (store.getState().messages[fresh] || []).filter((m) => m.kind === "event").length,
    0,
    "naming a brand new bot is not a rename"
  );

  let st = store.createChannel({ name: "Ops" });
  const cid = st.selectedId;
  assert.equal(st.channels.length, 1, "channel created");
  assert.equal(st.selectedId, cid, "new channel is selected");

  for (const id of [alpha, beta, quiet, fresh]) store.toggleChannelMember(cid, id);
  assert.equal(store.getState().channels[0].members.length, 4, "members joined");
  assert.ok(
    (store.getState().messages[cid] || []).some((m) => m.kind === "event" && /joined/.test(m.text)),
    "joining posts an event"
  );

  // The cap is real: a channel holds at most six.
  for (let i = 0; i < 5; i++) store.toggleChannelMember(cid, make(`Extra${i}`));
  assert.equal(store.getState().channels[0].members.length, 6, "channel caps at six members");

  store.select(cid);
  assert.equal(store.getState().selectedId, cid, "a channel can be selected");

  const after = await store.sendToChannel(cid, "status please");
  const thread = after.messages[cid] || [];
  assert.equal(thread.filter((m) => m.role === "user").length, 1, "one user message");

  const bots = thread.filter((m) => m.role === "bot");
  assert.ok(bots.length >= 2, "the message fans out to every member");
  assert.equal(
    bots.filter((m) => m.fromId === quiet).length,
    0,
    "SKIP must leave no trace in the transcript"
  );
  assert.ok(
    new Set(bots.map((m) => m.fromId)).size >= 2,
    "each member takes its own turn under its own name"
  );

  const memberIds = after.channels[0].members;
  assert.ok(
    after.agents.filter((a) => memberIds.includes(a.id)).every((a) => a.status === "idle"),
    "every member returns idle after its turn"
  );

  // Deleting a bot must not leave it haunting a channel.
  await store.deleteAgent(beta);
  const reloaded = createStore({ dir, complete: async () => "x" });
  assert.ok(
    !reloaded.getState().channels[0].members.includes(beta),
    "a deleted bot is pruned from channels on reload"
  );

  store.deleteChannel(cid);
  assert.equal(store.getState().channels.length, 0, "channel deleted");
  assert.ok(!store.getState().messages[cid], "channel thread deleted with it");
}

// --- channels: members answer each other, and silence ends the exchange ---
async function channelRounds() {
  const { createStore } = require(path.join(ROOT, "electron/store.cjs"));

  const mk = (store, name) => {
    store.createAgent();
    const id = store.getState().selectedId;
    store.setAgent(id, { name });
    store.landNewBot(id);
    return id;
  };

  // Scripted teammates reproducing the real Grok exchange: Dev opens, Nephew
  // answers with a question, Dev answers that, then both go quiet.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-rounds-"));
  const store = createStore({
    dir,
    complete: async (system) => {
      const me = /You are ([^.,]+)/.exec(system)[1];
      const seen = /This exchange so far:\n([\s\S]*?)\nReply as yourself/.exec(system);
      const convo = seen ? seen[1] : "";
      if (me === "Dev") {
        if (!convo.includes("Dev:")) return "yo";
        if (convo.includes("Nephew: yo, all good. you?") && !convo.includes("yeah, all good")) {
          return "yeah, all good";
        }
        return "SKIP";
      }
      if (me === "Nephew") {
        return convo.includes("Dev: yo") && !convo.includes("Nephew:")
          ? "yo, all good. you?"
          : "SKIP";
      }
      return "SKIP";
    },
  });
  store.signIn();
  const dev = mk(store, "Dev");
  const nephew = mk(store, "Nephew");
  const cid = store.createChannel({ name: "test" }).selectedId;
  store.toggleChannelMember(cid, dev);
  store.toggleChannelMember(cid, nephew);

  const after = await store.sendToChannel(cid, "hru guys");
  const names = Object.fromEntries(after.agents.map((a) => [a.id, a.name]));
  const said = (after.messages[cid] || [])
    .filter((m) => m.kind === "chat")
    .map((m) => `${m.role === "user" ? "You" : names[m.fromId]}: ${m.text}`);
  assert.deepEqual(
    said,
    ["You: hru guys", "Dev: yo", "Nephew: yo, all good. you?", "Dev: yeah, all good"],
    "members must answer each other across rounds, in order"
  );

  // A round where nobody speaks ends the exchange immediately — no extra turns.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-quiet-"));
  let calls = 0;
  const quiet = createStore({
    dir: dir2,
    complete: async () => {
      calls += 1;
      return "SKIP";
    },
  });
  quiet.signIn();
  const a = mk(quiet, "A");
  const b = mk(quiet, "B");
  const qid = quiet.createChannel({ name: "quiet" }).selectedId;
  quiet.toggleChannelMember(qid, a);
  quiet.toggleChannelMember(qid, b);
  calls = 0;
  const q = await quiet.sendToChannel(qid, "anything?");
  assert.equal(
    (q.messages[qid] || []).filter((m) => m.role === "bot").length,
    0,
    "silence writes nothing to the transcript"
  );
  assert.equal(calls, 2, "a fully silent round stops the exchange (2 members, 1 round)");
}

stripCanned();

channels()
  .then(channelRounds)
  .then(chatPersist)
  .then(() => {
    console.log("ok");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
