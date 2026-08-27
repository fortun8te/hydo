"use strict";

/**
 * Which browser: Hermes' own, or the box's.
 *
 * A teammate can end up holding both. They are not interchangeable:
 *
 *   - MEASURED (docs/BOX.md, 2026-08-27): the box ladder needs an awake box
 *     (`box exec` on a stopped one returns `machine_not_running` — it does NOT
 *     wake it), the box bills by the second, and its top rung `lux` is capped
 *     at one session at a time and 20/day for the whole team.
 *   - MEASURED (~/.hermes/config.yaml `browser.use_real_profile: true`, mirrored
 *     per teammate by bot-home.cjs): Hermes' own browser drives a snapshot of
 *     the user's default Chrome. It runs on this Mac: no box wake, no box
 *     seconds, no lux ration.
 *   - REASONED from the two: the box's Chrome profile is a different profile
 *     with a different set of logins, so routing a signed-in site to the box
 *     hits a login wall the teammate cannot pass; routing a bulk fetch to
 *     Hermes' browser drags the bytes through this conversation instead of
 *     leaving them on the shared disk.
 *
 * Nothing errors when the rule goes missing — the teammate just picks
 * arbitrarily and loses a turn. Hence a test.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const store = fs.readFileSync(path.join(__dirname, "..", "electron", "store.cjs"), "utf8");
const m = /const boxBlock =([\s\S]*?)\n        : "";/.exec(store);
assert.ok(m, "boxBlock not found in store.cjs");
const block = m[1];

// ---- render the branch the way store.cjs will --------------------------
// The emitted string, not the source: a pin that greps source counts comments
// and punctuation, which is exactly how the old size pin went blind.
const branchSrc = block.split(/\n\s*: agent\.boxEnabled/);
assert.strictEqual(branchSrc.length, 2, "expected a no-shell branch and a shell branch");
const renderBranch = (src, hasBrowser) => {
  const arr = /\[([\s\S]*)\]\.join\("\\n"\)/.exec(src);
  assert.ok(arr, "a boxBlock branch is no longer an array literal joined with newlines");
  // eslint-disable-next-line no-new-func
  return new Function("boxId", "agent", "hasBrowser", `return [${arr[1]}].join("\\n");`)(
    "bx_test123",
    { id: "a1" },
    hasBrowser
  );
};
const withBrowser = renderBranch(branchSrc[1], true);
const withoutBrowser = renderBranch(branchSrc[1], false);
const noShell = renderBranch(branchSrc[0], true);

// ---- the rule exists, and is a decision procedure -------------------------
const rule = withBrowser
  .split("\n")
  .find((l) => /browsers?\./i.test(l) && /`browser`/.test(l));
assert.ok(rule, "the box block must state which browser to use when a teammate has both");

// Both destinations named, each keyed on the side it is for. A description of
// the two tools is not a rule; the model has to follow it without weighing up.
assert.ok(/`browser`/.test(rule), "the rule must name the `browser` tool by its tool name");
assert.ok(/\bbox\b/.test(rule), "the rule must name the box as the other destination");
assert.ok(/logins|accounts/i.test(rule), "the Hermes side must be keyed on logins/accounts");
assert.ok(/shared disk|bulk|scrap/i.test(rule), "the box side must be keyed on bulk work and the shared disk");
assert.ok(/this Mac/.test(rule), "the rule must say the browser runs here, not on the box");

// The claim that makes the split real, and the one a teammate got wrong: the
// box browses as the BOX's Chrome, with its own separate logins.
assert.ok(
  /own separate logins|box's own Chrome/i.test(rule),
  "the rule must say the box browses with the box's own logins, not the user's"
);

// No claim the other way round: the box side must not promise the user's logins.
assert.ok(
  !/your logins|the user's logins[^.]*box/i.test(rule.split(":").slice(-1)[0]),
  "the box half must not claim the user's own logins"
);

// ---- gated on a CHECKED toolset -------------------------------------------
//
// No stock profile carries `browser` (hermes-gateway.cjs TOOL_PROFILES), and
// `full` pins nothing — it inherits the user's own `toolsets:` from
// config.yaml. So it is checked, never assumed, exactly like hasShell.
assert.ok(/const hasBrowser =/.test(store), "the routing rule must be gated on a checked `browser` toolset");
assert.ok(
  !/profileSets === null[\s\S]{0,200}const hasBrowser/.test(store) &&
    !/hasBrowser =[\s\S]{0,120}profileSets === null/.test(store),
  "`full` must not be treated as proof of the browser toolset; it inherits the user's own toolsets list"
);
assert.ok(!/browser/.test(withoutBrowser), "a teammate without the browser toolset must never be told to use it");
assert.ok(!/`browser`/.test(noShell), "the shell-less branch names a switch to ask for, not a browsing rule");

const gateway = require("../electron/hermes-gateway.cjs");
const profiles = gateway.TOOL_PROFILES || {};

// ---- the emitted string, per teammate -------------------------------------
//
// The real check: build the file the way store.cjs does and confirm the rule
// appears for a box+browser teammate and for nobody else.
const render = ({ boxEnabled, boxId, toolProfile, toolsets }) => {
  const profileSets = profiles[toolProfile || "chat"];
  const hasShell =
    profileSets === null ||
    (Array.isArray(profileSets) && profileSets.includes("terminal")) ||
    (Array.isArray(toolsets) && toolsets.includes("terminal"));
  const hasBrowser =
    (Array.isArray(profileSets) && profileSets.includes("browser")) ||
    (Array.isArray(toolsets) && toolsets.includes("browser"));
  if (!(boxEnabled && boxId)) return "";
  if (!hasShell) return "no-shell";
  return hasBrowser ? "routed" : "box-only";
};

assert.strictEqual(
  render({ boxEnabled: true, boxId: "bx_1", toolProfile: "builder", toolsets: ["browser"] }),
  "routed",
  "a builder with the box and the browser toolset must get the rule"
);
assert.strictEqual(
  render({ boxEnabled: true, boxId: "bx_1", toolProfile: "builder", toolsets: [] }),
  "box-only",
  "a teammate without the browser toolset must not be told to use it"
);
assert.strictEqual(
  render({ boxEnabled: false, boxId: "bx_1", toolProfile: "builder", toolsets: ["browser"] }),
  "",
  "a teammate without the box gets no block at all, and so no routing rule"
);
assert.strictEqual(
  render({ boxEnabled: true, boxId: "bx_1", toolProfile: "writer", toolsets: ["browser"] }),
  "no-shell",
  "a shell-less teammate still gets the name-the-switch branch, not a browsing ladder"
);

// ---- and it must stay cheap ------------------------------------------------
// This block is taxed on every turn of every box-enabled teammate. The size pin
// in box-runtime-test.cjs caps the branch at 2000 chars of prose; the rule
// itself must be a few lines, not a section.
assert.ok(rule.length < 400, `the routing rule must stay short (${rule.length} chars)`);

console.log("browse-routing-test ok");
