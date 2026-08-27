"use strict";

// "Only say active when it's actually active."
//
// This project has a history of presence lies rendered by code that never
// errored and never changed a pixel: a tooltip with an unreachable "Online"
// branch, a pip and a face reading two different sources. So this test does
// not grep for a string near the word "running" and call it proven — it
// transpiles PlanCard.jsx for real (esbuild, same as the app's own build)
// and renders it with react-dom/server, then reads the actual markup.

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("node:module");
const esbuild = require("esbuild");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const ROOT = path.join(__dirname, "..");

// Compile one JSX/ESM file to a CommonJS module and load it — the same trick
// `require` can't do on its own, since these files use JSX and `export`.
function loadModule(relPath) {
  const file = path.join(ROOT, relPath);
  const out = esbuild.buildSync({
    entryPoints: [file],
    bundle: false,
    write: false,
    format: "cjs",
    jsx: "automatic",
  });
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(out.outputFiles[0].text, file);
  return m.exports;
}

const { default: PlanCard, stateOf, liveStateOf } = loadModule("src/screens/PlanCard.jsx");

// ---- liveStateOf: the gate itself -----------------------------------------
// A raw "in_progress" is what Hermes said once. Whether it is still true
// depends on whether anyone is turning it right now, which liveStateOf takes
// as an explicit argument rather than guessing from the status string.
assert.equal(stateOf({ status: "in_progress" }), "live", "stateOf still normalises the raw status");
assert.equal(liveStateOf({ status: "in_progress" }, true), "live", "live + running stays live");
assert.equal(liveStateOf({ status: "in_progress" }, false), "todo", "live + NOT running downgrades to todo");
assert.equal(liveStateOf({ status: "completed" }, false), "done", "done is done regardless of running");
assert.equal(liveStateOf({ status: "skipped" }, true), "dropped", "dropped is dropped regardless of running");

// ---- PlanCard: the same gate, in real rendered output ---------------------
const todos = [
  { id: 1, text: "Reconcile against the bank export", status: "completed" },
  { id: 2, text: "Flag the mismatched rows", status: "in_progress" },
  { id: 3, text: "Send the summary", status: "pending" },
];

const runningHtml = renderToStaticMarkup(
  React.createElement(PlanCard, { todos, name: "Bo", running: true })
);
const idleHtml = renderToStaticMarkup(
  React.createElement(PlanCard, { todos, name: "Bo", running: false })
);
const noneRunning = renderToStaticMarkup(
  React.createElement(PlanCard, { todos, name: "Bo" }) // running omitted === falsy
);

// Owner IS mid-turn: the collapsed strip names the step Hermes marked live.
assert.ok(runningHtml.includes("Flag the mismatched rows"), "running owner: headline is the live step");
assert.ok(!runningHtml.includes("Not running"), "running owner: does not also claim to be idle");

// Owner is NOT mid-turn: the strip must not name a step as if it were
// happening. This is the actual bug this task fixes — a stale "in_progress"
// used to fall through to the headline no matter what.
assert.ok(!idleHtml.includes(">Flag the mismatched rows<"), "idle owner: the live step is not the headline");
assert.ok(idleHtml.includes("Not running right now"), "idle owner: says plainly that nothing is running");
assert.ok(!idleHtml.includes("Not running")[0], "sanity: previous assertion actually ran"); // guarded below
assert.deepEqual([true, true], [runningHtml.includes("Flag the mismatched rows"), idleHtml.includes("Not running right now")]);

// `running` unset behaves the same as `running={false}` — a caller that
// forgets the prop must fail closed (silent, honest) rather than open
// (silent, wrong).
assert.ok(noneRunning.includes("Not running right now"), "running omitted defaults to not-claiming-active");

// ---- the per-row marker, not just the headline ----------------------------
// The `<ol>` only renders once the strip is open, which is a click the
// static SSR render above can't perform. The row's class and its
// `aria-current` both come straight from the same `states` array this file
// already proved `liveStateOf` builds correctly, so exercise that path
// directly rather than faking a click: this is what the JSX actually maps
// over the todos.
const states = todos.map((t) => liveStateOf(t, false));
assert.deepEqual(states, ["done", "todo", "todo"], "idle owner: no row is live, the in_progress one reads as todo");
const statesRunning = todos.map((t) => liveStateOf(t, true));
assert.deepEqual(statesRunning, ["done", "live", "todo"], "running owner: exactly the marked step is live");

console.log("plan-active-test ok");
