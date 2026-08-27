"use strict";

// Pins the Computer-screen-is-a-rail-not-a-dialog decision. The user's own
// verdict was "this is a weird menu, i don't want this — it should open a
// sidebar instead", and a future edit re-wrapping ComputerRail in <Sheet>
// would silently bring the dialog back without any component test catching
// it (this app has no jsdom render step, only source-shape assertions like
// wiring-check.cjs — so that is what this checks too).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const shell = fs.readFileSync(path.join(ROOT, "src/screens/Shell.jsx"), "utf8");
const rail = fs.readFileSync(path.join(ROOT, "src/screens/ComputerRail.jsx"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "src/screens/rails.css"), "utf8");
const icons = fs.readFileSync(path.join(ROOT, "src/kit/icons.css"), "utf8");

// The old modal is gone, not just unused.
assert.ok(!fs.existsSync(path.join(ROOT, "src/screens/Computer.jsx")), "Computer.jsx should be removed");
assert.ok(!shell.includes('import Computer from "./Computer.jsx"'), "Shell still imports the old modal");
assert.ok(!shell.includes('sheet === "computer"'), "Shell still opens Computer in a Sheet dialog");

// The header monitor button reveals the rail, not a sheet.
assert.ok(shell.includes("import ComputerRail from"), "Shell does not import ComputerRail");
const headerBtn = shell.slice(shell.indexOf('aria-label="Computer"'), shell.indexOf('aria-label="Computer"') + 200);
assert.ok(headerBtn.includes('setRail'), 'the Computer header button should setRail, not setSheet');
assert.ok(!headerBtn.includes('setSheet("computer")'), 'the Computer header button still opens a Sheet');
assert.ok(shell.includes('rail === "computer"'), "Shell never renders ComputerRail from rail state");

// ComputerRail itself: an <aside>, not a role="dialog" — Sheet.jsx is the
// only place role="dialog" belongs in this app.
assert.ok(rail.includes("<aside"), "ComputerRail should render an <aside>, matching BotRail/ChannelRail");
assert.ok(!rail.includes('role="dialog"'), "ComputerRail must not be a dialog");
assert.ok(!rail.includes("<Sheet"), "ComputerRail must not wrap itself in the Sheet modal");

// The thumbnail: no polling loop. setInterval/setTimeout anywhere in this
// file is exactly the cost the rework exists to avoid on a per-second-billed
// machine — box-runtime.cjs's own comment names the law this pins.
assert.ok(!rail.includes("setInterval"), "ComputerRail must not poll the screen");
assert.ok(rail.includes("desktopUrl"), "ComputerRail should use the runtime's own desktopUrl, not a screenshot call");

// The hover-to-open affordance and the caption the user asked for.
assert.ok(rail.includes("computer-rail__open"), "missing the hover Open pill");
// The caption must not claim a per-bot screen. Checked against the CLI and
// docs on 2026-08-27: a Box has ONE desktop — a single `desktopUrl` with one
// Moonlight hostId/appId, no display/session flag on `box desktop`, and the
// streaming docs say Lux "controls the Box's single shared desktop, so run only
// one Lux session at a time". "<Bot>'s screen" over a desktop every bot shares
// is the quiet kind of lie this codebase treats as a bug, so it is pinned out.
assert.ok(
  !/\{botName\}&apos;s screen|\{botName\}'s screen/.test(rail),
  "the caption must not claim the shared desktop belongs to one bot"
);
assert.ok(/Shared screen/.test(rail), "the caption should name the screen as shared");
assert.ok(
  /same\s+windows/.test(rail),
  "the rail must say out loud that teammates see the same desktop"
);

// Every icon class ComputerRail renders must actually resolve to a glyph.
// This is the exact failure mode named in the task: gb-icon-desktop doesn't
// exist, ::before falls to `content: none`, and the button measures 0x0
// while looking correct in a diff.
const usedIcons = [...rail.matchAll(/gb-icon-([a-z0-9-]+)/g)].map((m) => `gb-icon-${m[1]}`);
assert.ok(usedIcons.length > 0, "expected ComputerRail to reference icon classes");
for (const cls of new Set(usedIcons)) {
  assert.ok(icons.includes(`.${cls}::before`), `icon class ${cls} has no ::before rule in icons.css`);
}

// The CSS the component actually renders exists — a class used in JSX with
// no rule behind it is the same silent-0x0 failure mode above, just in the
// stylesheet instead of the icon font.
const usedClasses = new Set(
  [...rail.matchAll(/className=(?:"([\w-]+(?: [\w-]+)*)"|\{[^}]*"([\w-]+(?: [\w-]+)*)")/g)]
    .flatMap((m) => (m[1] || m[2] || "").split(" "))
    .filter((c) => c.startsWith("computer-rail__"))
);
assert.ok(usedClasses.size > 0, "expected computer-rail__* classes in ComputerRail.jsx");
for (const cls of usedClasses) {
  assert.ok(css.includes(`.${cls}`), `class ${cls} used in ComputerRail.jsx has no rule in rails.css`);
}

// The Open pill must drive the VNC path (electron/main.cjs's hydo:boxDesktop
// handler, box-runtime.cjs's desktopUrl({vnc:true})), not the raw WebRTC
// `desktopUrl` from `box list`/`box info` via openExternal. That URL hung on
// "Connecting to desktop stream..." on a box that was verifiably up — the
// vendor's own docs say WebRTC "can be choppy or fail to connect" on
// restrictive networks — and openExternal also threw the user out of Hydo
// into a browser tab to look at their own teammate's screen, which they
// explicitly did not want.
assert.ok(rail.includes("window.hydo?.boxDesktop?.()"), "the Open pill must call window.hydo.boxDesktop()");
assert.ok(!rail.includes("openExternal"), "ComputerRail must not fall back to openExternal for the desktop");

// boxDesktop can answer {ok:false, reason} or reject outright — both must
// reach the DOM. openWorkspace once returned {ok, path} and the renderer
// discarded it outright, so a bot with no workspace got a button that did
// nothing and said nothing; the same shape bug here would be silent too.
const openFn = rail.slice(rail.indexOf("async function openDesktop"), rail.indexOf("const running ="));
assert.ok(/catch\s*\(e\)/.test(openFn), "openDesktop must catch a rejected boxDesktop() call");
assert.ok(/setErr\(/.test(openFn), "openDesktop must surface a failure reason via setErr, not swallow it");

console.log("computer-rail-test ok");
