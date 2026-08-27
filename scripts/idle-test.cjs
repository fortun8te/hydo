"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

/** Walk one idle for `ms`, sampling every 50ms. */
function run(mod, seed, ms, step = 50) {
  const st = mod.makeIdleState(seed);
  const out = { kinds: [], changes: [], degs: [], restless: [] };
  let last = null;
  for (let t = 0; t <= ms; t += step) {
    const r = mod.idleStep(st, t, (x) => x);
    if (r.kind !== last) {
      out.changes.push(t);
      last = r.kind;
    }
    out.kinds.push(r.kind);
    out.degs.push(r.deg);
    out.restless.push(r.restless);
  }
  return out;
}

async function main() {
  const mod = await import(pathToFileURL(path.join(ROOT, "src/umbra/idle.js")).href);
  const { makeIdleState, idleStep, restlessAt, IDLE } = mod;

  const a = run(mod, 0.37, 120_000);

  // ---- APERIODIC. This is the whole point: the old scheduler changed on a
  // fixed 4.6s grid, so every gap was identical.
  const gaps = a.changes.slice(1).map((t, i) => t - a.changes[i]);
  assert.ok(gaps.length > 8, `enough beats to judge, got ${gaps.length}`);
  const uniq = new Set(gaps);
  assert.ok(uniq.size > gaps.length * 0.6, `gaps must vary, ${uniq.size}/${gaps.length} distinct`);
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  assert.ok(max / min > 2.5, `a real spread of beat lengths, got ${min}..${max}`);

  // No common divisor: a grid would leave every gap a multiple of one number.
  const gcd = (x, y) => (y ? gcd(y, x % y) : x);
  const g = gaps.reduce((acc, n) => gcd(acc, n), gaps[0]);
  assert.ok(g <= 200, `no grid period hiding in the gaps (gcd ${g})`);

  // ---- STILL IS THE BASE STATE. He stands there more than he moves.
  const stillFrac = a.kinds.filter((k) => k === "idle").length / a.kinds.length;
  assert.ok(stillFrac > 0.55, `mostly still, got ${(stillFrac * 100) | 0}%`);
  assert.ok(stillFrac < 0.95, `but not frozen, got ${(stillFrac * 100) | 0}%`);

  // ---- REACTIONS ARE NOT IDLE BEHAVIOUR.
  const cast = new Set(a.kinds);
  for (const banned of ["bounce", "excited", "wink", "sideEye", "curious"]) {
    assert.ok(!cast.has(banned), `${banned} is a reaction, not a way of waiting`);
  }
  assert.ok(cast.size >= 3, `some variety in the cast, got ${[...cast].join(",")}`);

  // ---- NEVER THE SAME MOTION TWICE RUNNING.
  const moves = a.kinds.filter((k, i) => k !== "idle" && a.kinds[i - 1] === "idle");
  for (let i = 1; i < moves.length; i++) {
    assert.notEqual(moves[i], moves[i - 1], "no motion repeats back to back");
  }

  // ---- SETTLING. Later stills are longer than early ones.
  assert.equal(restlessAt(makeIdleState(1), 0), 1, "a fresh idle is fully restless");
  const settled = makeIdleState(1);
  idleStep(settled, 0, (x) => x);
  assert.ok(restlessAt(settled, IDLE.SETTLE_MS * 2) === 0, "fully settled after the window");
  assert.ok(
    restlessAt(settled, IDLE.SETTLE_MS / 2) < 0.9 &&
      restlessAt(settled, IDLE.SETTLE_MS / 2) > 0.1,
    "and gets there gradually"
  );
  const early = a.changes.filter((t) => t < 30_000);
  const late = a.changes.filter((t) => t > 80_000);
  const avg = (list) => {
    const gs = list.slice(1).map((t, i) => t - list[i]);
    return gs.reduce((x, y) => x + y, 0) / (gs.length || 1);
  };
  assert.ok(avg(late) > avg(early), `he calms down: ${avg(early)|0}ms -> ${avg(late)|0}ms`);

  // ---- GAZE IS DECOUPLED FROM POSTURE.
  // The old bug: both read off one grid, so gaze only ever changed on a
  // posture boundary. Now a gaze turn must happen while posture is unchanged.
  const st = makeIdleState(2.5);
  let prev = idleStep(st, 0, (x) => x);
  let gazeMovedWhileStill = 0;
  for (let t = 50; t < 120_000; t += 50) {
    const r = idleStep(st, t, (x) => x);
    if (r.kind === prev.kind && Math.abs(r.deg - prev.deg) > 0.05) gazeMovedWhileStill++;
    prev = r;
  }
  assert.ok(gazeMovedWhileStill > 100, `gaze runs on its own clock (${gazeMovedWhileStill})`);

  // ---- GAZE STAYS IN A HUMAN RANGE and never goes NaN.
  const maxDeg = Math.max(...a.degs.map(Math.abs));
  assert.ok(maxDeg <= IDLE.LOOK_MAX_DEG + 0.01, `gaze bounded, got ${maxDeg}`);
  assert.ok(maxDeg > 3, "but he does actually look around");
  assert.ok(a.degs.every(Number.isFinite), "no NaN yaw");

  // ---- SURVIVES A BACKGROUNDED TAB. `now` can jump by minutes; the loops
  // must not replay every missed beat or spin forever.
  const jump = makeIdleState(3);
  idleStep(jump, 0, (x) => x);
  const t0 = Date.now();
  const after = idleStep(jump, 45 * 60 * 1000, (x) => x);
  assert.ok(Date.now() - t0 < 250, "a huge time jump resolves fast");
  assert.ok(Number.isFinite(after.deg) && typeof after.kind === "string", "and lands sane");

  // ---- DETERMINISTIC for a given seed, DIFFERENT across seeds.
  const b = run(mod, 0.37, 40_000);
  const c = run(mod, 9.13, 40_000);
  assert.deepEqual(run(mod, 0.37, 40_000).changes, b.changes, "same seed, same sequence");
  assert.notDeepEqual(c.changes, b.changes, "different seeds diverge");

  // ---- The grid scheduler must be gone from the renderer.
  const uf = fs.readFileSync(path.join(ROOT, "src/umbra/UmbraFace.jsx"), "utf8");
  assert.ok(uf.includes("idleStep"), "UmbraFace uses the scheduler");
  assert.ok(!uf.includes("FIDGET_SLOT_S"), "the fixed grid is gone");
  assert.ok(!/function fidgetKind/.test(uf), "and its slot picker with it");
  assert.ok(uf.includes("idleSeed"), "each face gets its own random idle seed");

  console.log("idle-test ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
