// A fake `window.hydo` for browser-only development.
//
// The real one is injected by electron/preload.cjs. In a plain Vite tab there
// is no preload, so the app can only ever paint the sign-in gate. This mock
// stands in so the whole shell can be looked at (and screenshotted) without
// booting Electron. It is never installed in Electron, and never in a build.
//
// This is shared infrastructure: every other agent working on this app
// verifies their surface against it. The goal here is *coverage* — every
// message kind, every rich-content shape, every optional-chained IPC name —
// so nobody has to invent fixture data by hand. Method names and signatures
// match what App.jsx and Shell.jsx already call; nothing here should ever
// require a change on the caller side.

// A handful of the kit's small square marks, used as stand-in "screenshot"
// images for the image-grid demos below. No network fetch — these are
// checked into src/kit/images/ and Vite resolves them to local blob/dev-
// server URLs at build time.
import imgAda from "../kit/images/ada-CkPKuPfQ.svg";
import imgCalendly from "../kit/images/calendly-DYRMkyLM.svg";
import imgCanva from "../kit/images/canva-djBDOrSx.svg";
import imgMailchimp from "../kit/images/mailchimp-AFHOmIeb.svg";
import imgWorkday from "../kit/images/workday-DI2a8j1o.svg";
import imgSalesforce from "../kit/images/salesforce-DuGcPENR.svg";

const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();

function seed() {
  const bots = [
    {
      id: "b1", name: "Dev", label: "engineering", blob: "gray", shape: "hex",
      // A plan mid-execution, so PlanCard has something real to render. The
      // shape matches what `captureTodos` lifts off the Hermes todo tool.
      todos: [
        { id: "t1", text: "Read the invoice PDFs in the workspace", status: "completed" },
        { id: "t2", text: "Pull every total into one sheet", status: "completed" },
        { id: "t3", text: "Reconcile against the bank export", status: "in_progress" },
        { id: "t4", text: "Flag the rows that do not match", status: "pending" },
        { id: "t5", text: "Write the summary", status: "pending" },
      ],
    },
    { id: "b2", name: "Sauce", label: "", blob: "white", shape: "pebble" },
    { id: "b3", name: "NanoX", label: "ads", blob: "blue", shape: "squircle" },
    { id: "b4", name: "Finance Guy", label: "", blob: "orange", shape: "blob" },
    { id: "b5", name: "Nephew", label: "", blob: "violet", shape: "teardrop" },
  ].map((b, i) => ({
    ...b,
    description: "",
    notifications: false,
    status: i === 0 ? "working" : "idle",
    activity: i === 0 ? "Searching the web" : "",
    activityDetail: i === 0 ? "web_search" : "",
    draft: "",
    updatedAt: iso(i * 37),
    last: ["Looking now.", "Dev's in. Told them it was just…", "Cute line's gone.", "I haven't replied.", ""][i],
  }));

  return {
    signedIn: true,
    selectedId: "b1",
    settings: { appearance: "dark", userName: "Michael", model: "grok-4.6", provider: "xai-oauth", _pane: "general" },
    agents: bots,
    sections: [],
    channels: [
      {
        id: "c1",
        kind: "channel",
        name: "Launch",
        description: "Ship the August batch",
        members: ["b1", "b3", "b4"],
        draft: "",
        last: "Three of us are on it.",
        updatedAt: iso(12),
      },
    ],
    messages: {
      b1: [
        {
          id: "m1",
          role: "user",
          kind: "chat",
          text: "can you check the build?",
          at: iso(40),
          reactions: [{ emoji: "👍", by: "b1", at: iso(39) }],
        },
        {
          id: "m2",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          at: iso(39),
          text: "Checking. Give me a second.",
        },
        {
          id: "m3",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          at: iso(38),
          text:
            "Build's green. Here's what changed:\n\n" +
            "- `marks.js` grew to **20** colours\n" +
            "- the sidebar collapses to a rail now\n" +
            "- icons.css now covers every `gb-icon-*` name in the source\n\n" +
            "```js\nnpm test // ok\n```\n\n" +
            "> One thing worth a look before you ship: [the release notes](https://example.com/release-notes) call out a font swap.",
          reactions: [
            { emoji: "🎉", by: "user", at: iso(37) },
            { emoji: "🎉", by: "b3", at: iso(37) },
            { emoji: "👍", by: "b4", at: iso(36) },
          ],
        },
        { id: "m4", role: "system", kind: "event", text: "You renamed Devin to Dev.", at: iso(34) },
        {
          id: "m-math",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          text:
            "Correlation over the 21 paired days is \\(r = 0.62\\), so it moves with sleep but does not explain it.\n\n" +
            "$$\nr = \\frac{\\sum (x_i - \\bar{x})(y_i - \\bar{y})}{\\sqrt{\\sum (x_i - \\bar{x})^2 \\sum (y_i - \\bar{y})^2}}\n$$\n\n" +
            "Budget stays $5,000 to $8,000 either way.",
          at: iso(35),
        },
        {
          id: "m-md",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          text:
            "Shipped. Notes are at https://vite.dev and the [changelog](https://vitejs.dev/blog).\n\n" +
            "- [x] rename coalescing\n- [x] artifact pane\n- [ ] mermaid\n- [ ] KaTeX",
          at: iso(34),
        },
        {
          id: "m-svg",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          text:
            "Split of where the time went.\n\n```svg\n" +
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 140">' +
            '<rect x="0" y="0" width="180" height="34" rx="6" fill="#5aa8ff"/>' +
            '<rect x="0" y="42" width="120" height="34" rx="6" fill="#2bb673"/>' +
            '<rect x="0" y="84" width="70" height="34" rx="6" fill="#e4a11b"/>' +
            '<text x="190" y="23" fill="#fcfcfc" font-size="13" font-family="sans-serif">Building 4h</text>' +
            '<text x="130" y="65" fill="#fcfcfc" font-size="13" font-family="sans-serif">Review 2h</text>' +
            '<text x="80" y="107" fill="#fcfcfc" font-size="13" font-family="sans-serif">Calls 1h</text>' +
            "</svg>\n```",
          at: iso(33),
        },
        {
          id: "m-artifact",
          role: "bot",
          kind: "artifact",
          fromId: "b1",
          artifactId: "art-1",
          artifactKind: "html",
          target: "/mock/workspace/steps.html",
          versions: 2,
          text: "Steps per day",
          at: iso(33),
        },
        {
          id: "m-tally",
          role: "system",
          kind: "tally",
          fromId: "b3",
          peerId: "b3",
          text: "Messaged",
          at: iso(32),
        },
        {
          id: "m-routine",
          role: "system",
          kind: "routine",
          fromId: "b1",
          text: "Nightly build check",
          routineId: "r1",
          at: iso(30),
        },
        {
          id: "m5",
          role: "bot",
          kind: "choice",
          fromId: "b1",
          at: iso(28),
          text: "What do I tell her?",
          choices: [
            { id: "A", text: "We challenged it, now we want to accept" },
            { id: "B", text: "I'll type what to send" },
            { id: "C", text: "Don't reply yet" },
          ],
        },
        {
          id: "m-approval",
          role: "system",
          kind: "approval",
          fromId: "b1",
          requestId: "req-approve-1",
          text: "Can I push the hotfix branch to origin?",
          command: "git push origin fix/icon-glyphs",
          at: iso(26),
        },
        {
          id: "m-clarify",
          role: "system",
          kind: "clarify",
          fromId: "b1",
          requestId: "req-clarify-1",
          questionId: "q1",
          text: "Should the nightly check block deploys on a failing test, or just notify?",
          choices: [
            { id: "A", text: "Block deploys" },
            { id: "B", text: "Notify only" },
            { id: "C", text: "Ask me each time" },
          ],
          at: iso(24),
        },
        {
          id: "m-files",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          at: iso(22),
          text: "Docs for the release, if you want to skim before it goes out.",
          attachments: [
            { name: "release-notes", ext: ".md", size: 4200, kind: "markdown" },
            { name: "build-report", ext: ".pdf", size: 812000, kind: "pdf" },
            { name: "changelog", ext: ".html", size: 15400, kind: "html" },
            { name: "dist-bundle", ext: ".zip", size: 5200000, kind: "zip" },
          ],
        },
        {
          id: "m-links",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          at: iso(20),
          text: "A couple of things that came up while I was in there:",
          links: [
            { title: "Cursor icon set — 523 glyphs", url: "https://example.com/icons", domain: "example.com" },
            { title: "Vite build docs", url: "https://vite.dev/guide/build", domain: "vite.dev" },
          ],
        },
        {
          id: "m-img1",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          at: iso(18),
          text: "One shot of the panel:",
          images: [{ url: imgAda, alt: "panel screenshot" }],
        },
        {
          id: "m-img3",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          at: iso(16),
          text: "Three variants I tried:",
          images: [
            { url: imgCalendly, alt: "variant A" },
            { url: imgCanva, alt: "variant B" },
            { url: imgMailchimp, alt: "variant C" },
          ],
        },
        {
          id: "m-img6",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          at: iso(14),
          text: "And every pass from today, for the record:",
          images: [
            { url: imgAda, alt: "pass 1" },
            { url: imgCalendly, alt: "pass 2" },
            { url: imgCanva, alt: "pass 3" },
            { url: imgMailchimp, alt: "pass 4" },
            { url: imgWorkday, alt: "pass 5" },
            { url: imgSalesforce, alt: "pass 6" },
          ],
        },
        {
          id: "m-stream",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          at: iso(0),
          streaming: true,
          text: "Still writing this one out, hold on",
        },
      ],
      c1: [
        { id: "n1", role: "user", kind: "chat", text: "where are we on the batch?", at: iso(14) },
        { id: "n2", role: "bot", kind: "chat", fromId: "b1", text: "Build's clean, tests pass.", at: iso(13) },
        { id: "n3", role: "bot", kind: "chat", fromId: "b3", text: "Six statics rendered, two need recasting.", at: iso(12) },
        { id: "n4", role: "bot", kind: "chat", fromId: "b1", text: "@NanoX which two? I'll take a look before EOD.", at: iso(11) },
        { id: "n5", role: "bot", kind: "chat", fromId: "b3", text: "The graveyard and the 2am scene — casting reads too young in both.", at: iso(10) },
        {
          id: "n6",
          role: "bot",
          kind: "chat",
          fromId: "b1",
          at: iso(9),
          text: "Got it, recasting those two.",
          reactions: [{ emoji: "👍", by: "b4", at: iso(8) }],
        },
      ],
    },
    dms: {
      "b1:b3": [
        { id: "d1", role: "bot", kind: "chat", fromId: "b1", peerId: "b3", text: "Ping — can you eyeball the pain-cream batch before it ships?", at: iso(33) },
        { id: "d2", role: "bot", kind: "chat", fromId: "b3", peerId: "b1", text: "On it. Two need recasting, otherwise clean.", at: iso(32) },
      ],
    },
    routines: {
      b1: [
        {
          id: "r1",
          agentId: "b1",
          name: "Nightly build check",
          instruction: "Run the build and tests every night at 2am; message me only on failure.",
          active: true,
          at: iso(-8 * 60), // ~8h from now
          createdAt: iso(30),
          runs: [
            { id: "run1", at: iso(24 * 60), ok: true },
            { id: "run2", at: iso(48 * 60), ok: true },
          ],
        },
      ],
    },
  };
}

export function installDevMock() {
  let state = seed();
  const subs = new Set();
  const push = () => subs.forEach((fn) => fn(JSON.parse(JSON.stringify(state))));
  const patch = (fn) => {
    fn();
    push();
    return JSON.parse(JSON.stringify(state));
  };
  const find = (id) =>
    state.agents.find((a) => a.id === id) || state.channels.find((c) => c.id === id);

  // Realistic listPlugins() shape — see electron/hermes-plugins.cjs's frozen
  // contract: { servers: [{id,name,description,connected,needsAuth,toolCount}],
  // catalog: [{id,name,description,category}] }.
  const pluginServers = [
    { id: "github", name: "GitHub", description: "Issues, PRs, repos.", connected: true, needsAuth: false, toolCount: 12 },
    { id: "slack", name: "Slack", description: "Send and read messages.", connected: true, needsAuth: false, toolCount: 6 },
    { id: "notion", name: "Notion", description: "Pages and databases.", connected: false, needsAuth: true, toolCount: null },
  ];
  const pluginCatalog = [
    { id: "github", name: "GitHub", description: "Issues, PRs, repos.", category: "Installed" },
    { id: "slack", name: "Slack", description: "Send and read messages.", category: "Installed" },
    { id: "notion", name: "Notion", description: "Pages and databases.", category: "Installed" },
    { id: "linear", name: "Linear", description: "Track issues and cycles.", category: "Project management" },
    { id: "figma", name: "Figma", description: "Read designs and files.", category: "Design" },
  ];

  const noop = async () => JSON.parse(JSON.stringify(state));

  // A hand-written artifact so the pane and its sandbox can be looked at
  // without Electron or a live Hermes turn.
  const MOCK_ARTIFACT = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; padding:20px; background:#0d0d0d; color:#fcfcfc;
         font:14px/1.5 ui-sans-serif, system-ui, sans-serif; }
  h1 { font-size:16px; margin:0 0 2px; }
  .sub { color:#8d8d8d; font-size:12.5px; margin:0 0 18px; }
  .bar { fill:#5aa8ff; } .bar:hover { fill:#7dbcff; }
  .axis { stroke:#ffffff20; } .lbl { fill:#8d8d8d; font-size:11px; }
</style>
<h1>Steps per day</h1><p class="sub">Last 7 days &middot; 8,420 average</p>
<svg viewBox="0 0 640 240" width="100%" role="img" aria-label="Steps per day">
  <line class="axis" x1="40" y1="200" x2="620" y2="200"/>
  <rect class="bar" x="52"  y="96"  width="60" height="104" rx="4"><title>Mon 7,900</title></rect>
  <rect class="bar" x="134" y="60"  width="60" height="140" rx="4"><title>Tue 10,600</title></rect>
  <rect class="bar" x="216" y="118" width="60" height="82"  rx="4"><title>Wed 6,200</title></rect>
  <rect class="bar" x="298" y="74"  width="60" height="126" rx="4"><title>Thu 9,500</title></rect>
  <rect class="bar" x="380" y="104" width="60" height="96"  rx="4"><title>Fri 7,300</title></rect>
  <rect class="bar" x="462" y="42"  width="60" height="158" rx="4"><title>Sat 12,000</title></rect>
  <rect class="bar" x="544" y="132" width="60" height="68"  rx="4"><title>Sun 5,100</title></rect>
  <text class="lbl" x="82"  y="218" text-anchor="middle">Mon</text>
  <text class="lbl" x="164" y="218" text-anchor="middle">Tue</text>
  <text class="lbl" x="246" y="218" text-anchor="middle">Wed</text>
  <text class="lbl" x="328" y="218" text-anchor="middle">Thu</text>
  <text class="lbl" x="410" y="218" text-anchor="middle">Fri</text>
  <text class="lbl" x="492" y="218" text-anchor="middle">Sat</text>
  <text class="lbl" x="574" y="218" text-anchor="middle">Sun</text>
</svg>`;

  window.hydo = {
    readArtifact: async (id) =>
      id === "art-1"
        ? {
            ok: true,
            id,
            kind: "html",
            name: "steps.html",
            title: "Steps per day",
            versions: 2,
            text: MOCK_ARTIFACT,
          }
        : { ok: false, reason: "unknown" },
    listArtifacts: async () => ({ ok: true, artifacts: [] }),
    openExternal: async () => ({ ok: true }),
    getState: async () => JSON.parse(JSON.stringify(state)),
    onState: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    signIn: async () => patch(() => { state.signedIn = true; }),
    signOut: async () => patch(() => { state.signedIn = false; }),
    select: async (id) => patch(() => { state.selectedId = id; }),
    setDraft: async (id, draft) => patch(() => { const t = find(id); if (t) t.draft = draft; }),
    setSettings: async (p) => patch(() => { state.settings = { ...state.settings, ...p }; }),
    setAgent: async (id, p) => patch(() => { Object.assign(find(id) || {}, p); }),
    createAgent: async () =>
      patch(() => {
        const id = `b${Date.now()}`;
        state.agents.unshift({
          id, name: "New Bot", label: "", description: "", notifications: false,
          blob: "green", shape: "capsule", status: "idle", activity: "", draft: "",
          updatedAt: new Date().toISOString(), last: "Just landed.",
          // The real store stamps this; the mock must too, or the arrival
          // animation is unreachable in the only place it can be eyeballed.
          bornAt: new Date().toISOString(),
        });
        state.messages[id] = [];
        state.selectedId = id;
      }),
    deleteAgent: async (id) => patch(() => { state.agents = state.agents.filter((a) => a.id !== id); }),
    createSection: async ({ name, ids } = {}) =>
      patch(() => {
        const section = { id: `s${Date.now()}`, name: String(name || "New section").trim() || "New section" };
        state.sections = [section].concat(state.sections || []);
        for (const id of ids || []) {
          const t = find(id);
          if (t) t.sectionId = section.id;
        }
      }),
    renameSection: async (id, name) =>
      patch(() => {
        const s = (state.sections || []).find((x) => x.id === id);
        if (s) s.name = String(name || "").trim() || s.name;
      }),
    deleteSection: async (id) =>
      patch(() => {
        state.sections = (state.sections || []).filter((s) => s.id !== id);
        for (const a of state.agents) if (a.sectionId === id) a.sectionId = null;
        for (const c of state.channels || []) if (c.sectionId === id) c.sectionId = null;
      }),
    moveToSection: async (ids, sectionId) =>
      patch(() => {
        const list = Array.isArray(ids) ? ids : [ids];
        for (const id of list) {
          const t = find(id);
          if (t) t.sectionId = sectionId || null;
        }
      }),
    deleteEntries: async (ids) =>
      patch(() => {
        const list = Array.isArray(ids) ? ids : [ids];
        state.agents = state.agents.filter((a) => !list.includes(a.id));
        state.channels = (state.channels || []).filter((c) => !list.includes(c.id));
      }),
    setPinned: async (id, pinned) => patch(() => { const t = find(id); if (t) t.pinned = pinned; }),
    setUnread: async (id, unread) => patch(() => { const t = find(id); if (t) t.unread = unread; }),
    setHidden: async (id, hidden) => patch(() => { const t = find(id); if (t) t.hidden = hidden; }),
    duplicateAgent: async (id) =>
      patch(() => {
        const src = state.agents.find((a) => a.id === id);
        if (!src) return;
        const copy = { ...src, id: `b${Date.now()}`, name: `${src.name} copy` };
        state.agents.unshift(copy);
        state.messages[copy.id] = [];
      }),
    createChannel: async (p = {}) =>
      patch(() => {
        const id = `c${Date.now()}`;
        state.channels.unshift({
          id, kind: "channel", name: p.name || "New Channel", description: "", members: Array.isArray(p.members) ? p.members : [],
          draft: "", last: "", updatedAt: new Date().toISOString(),
        });
        state.messages[id] = [];
        state.selectedId = id;
      }),
    setChannel: async (id, p) => patch(() => { Object.assign(find(id) || {}, p); }),
    deleteChannel: async (id) => patch(() => { state.channels = state.channels.filter((c) => c.id !== id); }),
    toggleChannelMember: async (cid, aid) =>
      patch(() => {
        const c = state.channels.find((x) => x.id === cid);
        if (!c) return;
        c.members = c.members.includes(aid)
          ? c.members.filter((m) => m !== aid)
          : c.members.concat(aid).slice(0, 6);
      }),
    send: async (text) =>
      patch(() => {
        const id = state.selectedId;
        (state.messages[id] ||= []).push({
          id: `u${Date.now()}`, role: "user", kind: "chat", text, at: new Date().toISOString(),
        });
      }),
    choose: async () => JSON.parse(JSON.stringify(state)),
    chooseCustom: async () => JSON.parse(JSON.stringify(state)),

    // Reactions — toggles the given emoji from "user" on the message.
    react: async (messageId, emoji) =>
      patch(() => {
        for (const list of Object.values(state.messages)) {
          const msg = list.find((m) => m.id === messageId);
          if (!msg) continue;
          msg.reactions = Array.isArray(msg.reactions) ? msg.reactions : [];
          const idx = msg.reactions.findIndex((r) => r.by === "user" && r.emoji === emoji);
          if (idx >= 0) msg.reactions.splice(idx, 1);
          else msg.reactions.push({ emoji, by: "user", at: new Date().toISOString() });
        }
      }),

    answerApproval: async (messageId, choice) =>
      patch(() => {
        for (const list of Object.values(state.messages)) {
          const msg = list.find((m) => m.id === messageId);
          if (msg) msg.answered = choice;
        }
      }),
    answerClarify: async (messageId, answer) =>
      patch(() => {
        for (const list of Object.values(state.messages)) {
          const msg = list.find((m) => m.id === messageId);
          if (msg) msg.answered = answer;
        }
      }),
    answerGate: async (messageId, value) =>
      patch(() => {
        for (const list of Object.values(state.messages)) {
          const msg = list.find((m) => m.id === messageId);
          if (msg) msg.answered = value ? "sent" : "skipped";
        }
      }),
    previewZip: async () => ({ ok: true, name: "property.zip", entries: [{ name: "hello.nd", size: 12 }] }),
    interrupt: noop,
    openWorkspace: async () => ({ ok: true, path: "/tmp/hydo-workspace" }),
    listModels: async () => ({
      ok: true,
      providers: [{ name: "xai", models: [{ id: "grok-4.6" }, { id: "grok-4.5" }] }],
    }),

    // Plugins ("Connected apps") — contract lives in electron/hermes-plugins.cjs.
    listPlugins: async () => ({
      servers: JSON.parse(JSON.stringify(pluginServers)),
      catalog: JSON.parse(JSON.stringify(pluginCatalog)),
    }),
    addPlugin: async (id) => ({ ok: true, id }),
    removePlugin: async (id) => ({ ok: true, removed: id }),
    testPlugin: async (id) => ({ ok: true, toolCount: 4, tools: ["read", "write", "search", "list"] }),
    startPluginAuth: async (id) => ({ ok: true, sessionId: `sess-${id}`, authUrl: "https://example.com/oauth", flow: "oauth" }),
    pollPluginAuth: async (id, sessionId) => ({ ok: true, status: "pending", authUrl: "https://example.com/oauth" }),

    createRoutine: async (spec) =>
      patch(() => {
        const id = state.selectedId;
        const item = {
          id: `r${Date.now()}`,
          agentId: id,
          name: spec?.name || "New routine",
          instruction: spec?.instruction || "",
          active: true,
          at: null,
          createdAt: new Date().toISOString(),
          runs: [],
        };
        (state.routines[id] ||= []).unshift(item);
      }),
    setRoutine: async (routineId, p) =>
      patch(() => {
        for (const list of Object.values(state.routines)) {
          const r = list.find((x) => x.id === routineId);
          if (r) Object.assign(r, p);
        }
      }),
    deleteRoutine: async (routineId) =>
      patch(() => {
        for (const key of Object.keys(state.routines)) {
          state.routines[key] = state.routines[key].filter((r) => r.id !== routineId);
        }
      }),
    runRoutine: noop,
  };
}
