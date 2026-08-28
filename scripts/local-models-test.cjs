"use strict";

/**
 * You can pick any model YOUR OWN server holds, not just the one in config.
 *
 * Settings offered exactly one model per local provider, because that is all
 * Hermes' `model.options` reports for a custom endpoint: the `default_model`
 * line from config.yaml. This user's box actually serves six — a 27B beside the
 * flash one, two gemmas, and UI-TARS, which is a GUI-vision model and a better
 * choice for driving the shared desktop than a text model is. Choosing between
 * them meant hand-editing YAML.
 *
 * Verified against the real endpoint through the real preload bridge: 6 models,
 * loaded first, unloaded ones labelled.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./lib/source-scan.cjs");
const lp = require("../electron/local-providers.cjs");

const ROOT = path.join(__dirname, "..");

// ---- the shelf is read, and read honestly ---------------------------------
const provider = { id: "x", api: "http://box:1/v1", host: "box:1", placeholder: false };

(async () => {
  const body = {
    data: [
      { id: "big/Model-00001-of-00003", loaded: true },   // a weights shard, not a choice
      { id: "b/unloaded-one", loaded: false },
      { id: "a/loaded-one", loaded: true, context_length: 262144 },
      { id: "", loaded: true },                            // junk
    ],
  };
  const res = await lp.models(provider, { key: "k", fetch: async () => ({ ok: true, json: async () => body }) });
  assert.ok(res.ok, "reads the endpoint");
  assert.deepStrictEqual(
    res.models.map((m) => m.id),
    ["a/loaded-one", "b/unloaded-one"],
    "shard filenames and empty ids are dropped; loaded sorts first"
  );
  assert.strictEqual(res.models[0].context, 262144, "context is carried when the server gives one");
  assert.strictEqual(res.models[1].loaded, false, "and `loaded` is NOT flattened away — an unloaded model pays a load before its first token");

  // A placeholder host is never dialled.
  let dialled = false;
  const ph = await lp.models(
    { id: "p", api: "http://REPLACE-ME:1/v1", host: "REPLACE-ME:1", placeholder: true },
    { fetch: async () => { dialled = true; return { ok: true, json: async () => ({ data: [] }) }; } }
  );
  assert.ok(!ph.ok && !dialled, "a placeholder is not a network failure and must not be dialled");

  // Failures are reasons, not exceptions.
  const dead = await lp.models(provider, { key: "k", fetch: async () => { throw new Error("nope"); } });
  assert.ok(!dead.ok && dead.reason, "an unreachable endpoint answers with a reason");
  const four = await lp.models(provider, { key: "k", fetch: async () => ({ ok: false, status: 404 }) });
  assert.ok(!four.ok && /404/.test(four.reason), "an HTTP error carries its status");

  // ---- and it is actually wired to the UI ---------------------------------
  const main = fs.readFileSync(path.join(ROOT, "electron/main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "electron/preload.cjs"), "utf8");
  const settings = fs.readFileSync(path.join(ROOT, "src/screens/Settings.jsx"), "utf8");
  assert.ok(/hydo:localModels/.test(main), "main serves it");
  assert.ok(/localModels:/.test(preload), "preload exposes it");
  assert.ok(/window\.hydo\?\.localModels\?\./.test(settings), "Settings calls it");
  assert.ok(/not loaded/.test(settings), "and says which models are not loaded");
  // The key must never reach the renderer.
  //
  // Strip comments first. Preload carries a comment explaining that no api_key
  // crosses the bridge, and a check that cannot tell prose from code would ban
  // writing the explanation down — which is how a guarantee loses the note
  // saying why it exists. Third time this exact trap has fired in this repo.
  const code = stripComments(preload);
  assert.ok(!/api_key/.test(code), "no key on the bridge");
  assert.ok(!/sk-[A-Za-z0-9]{8}/.test(code), "and no literal key anywhere in it");

  console.log("local-models-test ok");
})().catch((e) => { console.error(e); process.exit(1); });
