#!/usr/bin/env node
"use strict";

/**
 * local-consent-test.cjs — "ask before you run this somewhere else", and the
 * per-teammate control that decides whether the question can even arise.
 *
 * The behaviour under test replaced an AUTOMATIC fallback that shipped an hour
 * earlier: a teammate pinned to a local endpoint whose endpoint was down had
 * its turn quietly moved to the hosted model and was told about it afterwards.
 * The user's correction was to be asked instead ("if local isnt active for a
 * local bot that it asks you a question ... have this for each like session").
 *
 * scripts/local-fallback-test.cjs owns the question itself — that it appears,
 * that a yes runs the original message on the hosted model, that a no runs
 * nothing. THIS file owns the two things that outlive one turn:
 *
 *   1. the MEMORY of the answer — what keeps it, and the three things that
 *      must take it away again (an explicit switch, the endpoint coming back,
 *      and time). A yes that never expired would be the silent Thursday
 *      reroute the user was worried about;
 *   2. the per-teammate cloud/local CONTROL in the bot rail, including the
 *      thing this repo gets wrong most often: a rule that applies its class
 *      and changes no pixels because a more specific rule already won. The
 *      colour assertions below RESOLVE THE CASCADE (specificity, then source
 *      order) rather than asking whether a class name is present.
 *
 * The store half runs against real sockets — a port with nothing listening,
 * then a real HTTP server bound to that same port — because "the endpoint came
 * back" is not a thing a mocked probe can honestly demonstrate.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { stripComments } = require("./lib/source-scan.cjs");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const gwPath = require.resolve("../electron/hermes-gateway.cjs");
const storePath = require.resolve("../electron/store.cjs");
const fallbackPath = require.resolve("../electron/local-fallback.cjs");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  [FAIL] ${name}\n         ${err.stack || err.message}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function serveOn(port) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "local-model", loaded: true }] }));
    });
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

function writeConfig(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydo-consent-cfg-"));
  const file = path.join(dir, "config.yaml");
  const lines = ["providers:"];
  for (const [name, api] of Object.entries(entries)) {
    lines.push(`  ${name}:`, `    api: ${api}`, `    api_key: sk-test`, `    default_model: local-model`, `    transport: chat_completions`);
  }
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

function stubGateway() {
  const built = [];
  const fake = {
    available: () => true,
    hasSession: () => false,
    TOOL_PROFILES: {},
    storedSessionIdOf: () => "sess-1",
    paceFor: () => ({ local: false, reasoningHonoured: true }),
    fastLaneFor: () => "",
    sessionFor: (botId, opts) => {
      built.push({ provider: opts.provider, model: opts.model });
      return Promise.resolve({ botId, sessionId: "sess-1" });
    },
    resume: () => Promise.reject(new Error("not resumable in this stub")),
    compressIfNeeded: () => Promise.resolve({ compressed: false }),
    submit: (botId, text, handlers) => {
      handlers.onDelta("answered");
      const out = { text: "answered" };
      handlers.onComplete(out);
      return Promise.resolve(out);
    },
  };
  require.cache[gwPath] = { id: gwPath, filename: gwPath, loaded: true, exports: fake };
  return built;
}

const threadOf = (state, id) => state.messages[id] || [];
const cards = (state, id) => threadOf(state, id).filter((m) => m.kind === "clarify" && m.reroute);

async function main() {
  console.log("local-consent-test");

  // ── the memory, driven through a real store ────────────────────────────
  const port = await freePort(); // nothing is listening on it yet
  const prevCfg = process.env.HYDO_HERMES_CONFIG;
  const prevAuth = process.env.HYDO_HOSTED_AUTH;
  let server = null;
  try {
    process.env.HYDO_HERMES_CONFIG = writeConfig({ box: `http://127.0.0.1:${port}/v1` });
    process.env.HYDO_HOSTED_AUTH = "1";
    const built = stubGateway();
    delete require.cache[storePath];
    delete require.cache[fallbackPath];
    const store = require("../electron/store.cjs").createStore({
      dir: fs.mkdtempSync(path.join(os.tmpdir(), "hydo-consent-")),
    });
    store.signIn();
    const id = store.createAgent({ name: "Ada" }).selectedId;
    store.setAgent(id, { provider: "box", model: "local-model" });
    store.select(id);

    let state = await store.send("first one");
    const card = cards(state, id)[0];
    await test("a local teammate with a dead endpoint is asked, once", () => {
      assert.ok(card, "no question card was posted");
      assert.equal(cards(state, id).length, 1);
    });
    state = await store.answerClarify(card.id, card.choices[0].text);
    await test("the yes is remembered: the next message is not re-asked", async () => {
      const next = await store.send("second one");
      assert.equal(cards(next, id).length, 1, "one card, for the first message only");
      assert.equal(built[built.length - 1].provider, "xai-oauth");
    });

    // reset #1 — an explicit switch is a new decision about where this
    // teammate runs, so it cannot inherit the old answer.
    await test("switching the teammate's model forgets the yes", async () => {
      store.setAgent(id, { model: "local-model" });
      const next = await store.send("after the switch");
      assert.equal(cards(next, id).length, 2, "a switch must make it ask again");
    });

    // reset #2 — the endpoint answering again is the change the whole
    // question was about. Same port, now with a real server on it.
    server = await serveOn(port);
    await test("the endpoint coming back forgets the yes AND runs locally again", async () => {
      // Say yes to the outstanding card first, so a live consent exists to be
      // cleared — otherwise this would pass for the wrong reason.
      const open = cards(store.getState(), id).pop();
      await store.answerClarify(open.id, open.choices[0].text);
      const before = cards(store.getState(), id).length;
      // The bad verdict is cached for BAD_TTL_MS. That bound is the feature
      // (no polling, and a woken machine is noticed within seconds), so the
      // test waits it out rather than clearing the cache — clearing would also
      // clear the consent this case is about.
      const fb = require("../electron/local-fallback.cjs");
      await new Promise((r) => setTimeout(r, fb.BAD_TTL_MS + 300));
      const next = await store.send("the box is back");
      assert.equal(cards(next, id).length, before, "a healthy endpoint asks nothing");
      assert.equal(built[built.length - 1].provider, "box", "and it runs on the box");
      // Same module instance the store holds (its require.cache entry was
      // dropped immediately before the store's, so there is only one).
      assert.equal(
        fb.hasConsent(id, "box"),
        false,
        "the yes must not survive the endpoint's return — that is the Thursday reroute"
      );
    });
  } finally {
    if (server) await new Promise((r) => server.close(r));
    delete require.cache[gwPath];
    if (prevCfg == null) delete process.env.HYDO_HERMES_CONFIG;
    else process.env.HYDO_HERMES_CONFIG = prevCfg;
    if (prevAuth == null) delete process.env.HYDO_HOSTED_AUTH;
    else process.env.HYDO_HOSTED_AUTH = prevAuth;
  }

  // reset #3 — time. In-memory alone is not the promise, because this app is
  // left running for days.
  {
    delete require.cache[fallbackPath];
    const fb = require("../electron/local-fallback.cjs");
    await test("a yes expires; Tuesday's answer cannot route Thursday's work", () => {
      const t = 1_700_000_000_000;
      fb.grant("bot", "box", t);
      assert.equal(fb.hasConsent("bot", "box", t + 60_000), true);
      assert.equal(fb.hasConsent("bot", "box", t + fb.CONSENT_TTL_MS), false);
      assert.ok(fb.CONSENT_TTL_MS <= 12 * 60 * 60 * 1000, "a 'session' cannot mean a day");
    });
    await test("the yes is per teammate, not per app", () => {
      const t = 2_000_000_000_000;
      fb.grant("ada", "box", t);
      assert.equal(fb.hasConsent("ada", "box", t), true);
      assert.equal(fb.hasConsent("bo", "box", t), false, "Bo never agreed to anything");
    });
    await test("nothing about the yes is written to disk", () => {
      const src = read("electron/local-fallback.cjs");
      const consentBlock = src.slice(src.indexOf("const consent = new Map()"));
      assert.ok(
        !/writeFileSync|JSON\.stringify\(consent|state\./.test(consentBlock),
        "a persisted yes would survive the restart that is supposed to clear it"
      );
    });
  }

  // ── the per-teammate control ───────────────────────────────────────────
  const rail = read("src/screens/BotRail.jsx");
  const modelPick = require("../electron/model-pick.cjs");

  await test("the rail's hosted literals match model-pick, so Cloud is a real destination", () => {
    const provider = rail.match(/const CLOUD_PROVIDER = "([^"]+)"/);
    const model = rail.match(/const CLOUD_MODEL = "([^"]+)"/);
    assert.ok(provider && model, "BotRail must name the hosted pick it writes");
    assert.equal(provider[1], modelPick.DEFAULT_PROVIDER);
    assert.equal(model[1], modelPick.DEFAULT_CHAT);
  });

  await test("Default clears the pin instead of writing the default in as an override", () => {
    // Writing `{provider: "xai-oauth"}` for "Default" would look identical and
    // be a different fact: the teammate would stop following Settings.
    assert.ok(
      /onClick=\{\(\) => onChange\(\{ provider: "", model: "" \}\)\}/.test(rail),
      "the Default button must clear provider AND model"
    );
  });

  await test("the three states are three different sentences", () => {
    assert.ok(/Inherits the app default \(\$\{appDefaultLabel\}\)/.test(rail));
    assert.ok(/Local · \$\{localPin\?\.name \|\| localPin\?\.id\}/.test(rail));
    assert.ok(/Cloud · \$\{agent\?\.model \|\| CLOUD_MODEL\}/.test(rail));
  });

  // ---- the cascade, resolved rather than assumed -------------------------
  // The signature bug in this rail: the class lands, a more specific (or
  // later) rule already set the property, and nothing moves. So resolve it.
  // Comments stripped first: a `/* ... */` before a rule otherwise ends up
  // parsed as part of its selector, and every lookup silently misses.
  const css = stripComments(read("src/screens/rails.css"));
  const rules = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const body = m[2];
    for (const sel of m[1].split(",")) {
      const s = sel.trim();
      if (!s || s.startsWith("@") || s.startsWith("/*")) continue;
      rules.push({ sel: s, body, at: m.index });
    }
  }
  /** Specificity of a class/element-only selector: [ids, classes, types]. */
  function specificity(sel) {
    const ids = (sel.match(/#[\w-]+/g) || []).length;
    const classes = (sel.match(/[.:][\w-]+(\([^)]*\))?/g) || []).length;
    const types = (sel.replace(/[.:#][\w-]+(\([^)]*\))?/g, "").match(/[a-zA-Z][\w-]*/g) || []).length;
    return ids * 10000 + classes * 100 + types;
  }
  /** Does this descendant selector match an element with `classes` under .bot-rail? */
  function matches(sel, classes) {
    if (/[>+~[]|::/.test(sel)) return false;
    const parts = sel.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    const need = (last.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
    if (!need.length || !need.every((c) => classes.includes(c))) return false;
    if (/[.:#]hover|:hover|is-\w+/.test(last) && !need.every((c) => classes.includes(c))) return false;
    return parts.slice(0, -1).every((p) => p === ".bot-rail" || p === ".bot-rail__field");
  }
  /** The declaration that actually wins for `prop` on an element with `classes`. */
  function winner(classes, prop) {
    let best = null;
    for (const r of rules) {
      if (!matches(r.sel, classes)) continue;
      const decl = [...r.body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))].pop();
      if (!decl) continue;
      const score = [specificity(r.sel), r.at];
      if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
        best = { value: decl[1].trim(), sel: r.sel, score };
      }
    }
    return best;
  }

  const inheritColor = winner(["bot-rail__cost", "bot-rail__runs-state"], "color");
  const overrideColor = winner(["bot-rail__cost", "bot-rail__runs-state", "is-override"], "color");
  await test("'inherits the default' and 'overrides it' resolve to DIFFERENT colours", () => {
    assert.ok(inheritColor, "the state line must get a colour from somewhere");
    assert.ok(overrideColor, "the override line must get a colour from somewhere");
    assert.notEqual(
      overrideColor.value,
      inheritColor.value,
      `both lines resolve to ${inheritColor.value} — the class is applied and no pixel changes ` +
        `(inherit via ${inheritColor.sel}, override via ${overrideColor.sel})`
    );
  });
  await test("the override colour wins the cascade, it does not merely exist", () => {
    assert.ok(
      /is-override/.test(overrideColor.sel),
      `the winning rule for an overriding teammate is ${overrideColor.sel}, not the is-override one`
    );
  });

  const runsGrid = winner(["bot-rail__runs"], "grid-template-columns");
  const presetGrid = winner(["bot-rail__presets"], "grid-template-columns");
  await test("the Runs-on row lays out for a variable number of endpoints", () => {
    assert.ok(runsGrid, ".bot-rail__runs must set its own columns");
    assert.match(runsGrid.value, /auto-fit/, `got ${runsGrid.value}`);
    assert.match(presetGrid.value, /repeat\(5/, "sanity: the Mode row is still the fixed-5 grid");
    assert.ok(
      !/bot-rail__presets/.test(
        (rail.match(/className="bot-rail__runs[^"]*"/) || [""])[0]
      ),
      "sharing the presets class would put two same-specificity grid rules in a file-order race"
    );
  });

  // ── the card the question is asked with ────────────────────────────────
  const transcript = read("src/screens/Transcript.jsx");
  await test("the reroute question reuses the clarify card, not a second vocabulary", () => {
    assert.ok(/kind: "clarify"/.test(read("electron/store.cjs")));
    assert.ok(/msg\.reroute/.test(transcript), "Transcript must know the reroute variant");
  });
  await test("its reassurance line does not claim the bot is carrying on", () => {
    const sub = transcript.slice(transcript.indexOf("msg.reroute"), transcript.indexOf("msg.dismissed\n"));
    assert.ok(/Nothing ran/.test(sub), "declining must say nothing ran");
    assert.ok(/still here/.test(sub), "and that the message survived");
    assert.ok(!/Carrying on/.test(sub.split("msg.dismissed")[0] || ""), "nothing is carrying on");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
