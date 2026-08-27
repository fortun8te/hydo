"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, "../src/umbra/spin-turn.js")).href);
  const { spinTurn, spinCycle, spinStage, makeSpinState, easeYawToRest, hash01, easeInOutCubic, easeInOutQuint, SPIN_PAUSE, SPIN_WOBBLE } = mod;
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.ok(easeInOutCubic(0.5) > 0.4 && easeInOutCubic(0.5) < 0.6);
  assert.equal(easeInOutQuint(0), 0);
  assert.equal(easeInOutQuint(1), 1);
  assert.ok(easeInOutQuint(0.1) < easeInOutCubic(0.1), "quint eases in harder");
  assert.equal(spinTurn(0), 0);
  assert.ok(spinTurn(0.01) < spinTurn(0.2), "ease-in starts slow");
  const pausePhase = 1 - SPIN_PAUSE / 4;
  assert.ok(Math.abs(spinTurn(pausePhase)) <= SPIN_WOBBLE + 0.05);
  assert.ok(hash01(1) >= 0 && hash01(1) < 1);
  const a = spinCycle(0.3, 0.2, 0);
  const b = spinCycle(0.3, 0.2, 1);
  assert.ok(Number.isFinite(a) && Number.isFinite(b));
  const st = makeSpinState();
  const y0 = spinStage(st, 0.999, 0.2, 0);
  const y1 = spinStage(st, 0.02, 0.2, 1);
  assert.ok(Math.abs(y1 - y0) < 90, "stage spin must not snap across cycles");
  assert.equal(easeYawToRest(10, 1), 0);
  assert.equal(easeYawToRest(350, 1), 360);
  console.log("spin-turn-test ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
