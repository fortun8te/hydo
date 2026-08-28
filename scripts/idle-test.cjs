"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const { stripComments } = require("./lib/source-scan.cjs");

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
  for (const banned of ["bounce", "excited", "wink", "sideEye", "curious", "scan", "nod"]) {
    assert.ok(!cast.has(banned), `${banned} snaps or reacts; not a way of waiting`);
  }
  assert.ok(cast.size >= 8, `real variety, got ${cast.size}: ${[...cast].join(",")}`);

  // ---- THE CAST CHANGES AS HE WAITS --------------------------------------
  // A flat list of motions is a loop. Someone who has been waiting two
  // minutes should not behave like someone who just looked up: alert first,
  // easy glances in the middle, visibly bored by the end. `restless` drives
  // it, so the states seen early and late must actually differ.
  {
    const st = makeIdleState(0.42);
    const early = new Set();
    const late = new Set();
    let prev = null;
    for (let t = 0; t < 200_000; t += 100) {
      const r = idleStep(st, t, (x) => x);
      if (r.kind !== prev && r.kind !== "idle") {
        (t < 40_000 ? early : t > 140_000 ? late : new Set()).add?.(r.kind);
        prev = r.kind;
      } else if (r.kind !== prev) {
        prev = r.kind;
      }
    }
    assert.ok(early.size >= 2, `alert cast plays early, got ${[...early]}`);
    assert.ok(late.size >= 2, `settled cast plays late, got ${[...late]}`);
    const overlap = [...late].filter((k) => early.has(k));
    assert.ok(
      overlap.length < Math.min(early.size, late.size),
      `early and late must differ, both were ${[...early]}`
    );
    // The drowsy motions belong to waiting a long time, not to arriving.
    for (const drowsy of ["bored", "sleepy", "meditate"]) {
      assert.ok(!early.has(drowsy), `${drowsy} must not play in the first seconds`);
    }
  }

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
  // Asserted as a PROPERTY, not at fixed timestamps: `since` is now staggered
  // per seed so faces do not all calm down together, which means the exact
  // value at SETTLE_MS/2 is seed-dependent. Monotonic decrease is the thing
  // that actually matters and it holds for every seed.
  for (const seed of [1, 0.4, 7.7, 12.3]) {
    const st = makeIdleState(seed);
    idleStep(st, 0, (x) => x);
    let prev = restlessAt(st, 0);
    for (let t = 0; t <= IDLE.SETTLE_MS * 1.2; t += IDLE.SETTLE_MS / 20) {
      const now = restlessAt(st, t);
      assert.ok(now <= prev + 1e-9, `restlessness only ever falls (seed ${seed})`);
      prev = now;
    }
    assert.equal(prev, 0, `and reaches zero (seed ${seed})`);
    assert.ok(restlessAt(st, 0) > 0.5, `but starts high (seed ${seed})`);
  }
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

  // ---- FACES MUST NOT MOVE IN LOCKSTEP -----------------------------------
  // Faces mount together and share one rAF clock. Starting every stream at
  // `now` meant every face's first beat fired on the same frame: the seed only
  // decided WHICH motion and HOW LONG, never WHEN. A row of them changed
  // posture in unison and read as one animation on three sprites.
  {
    const seeds = [0.11, 0.62, 0.87, 3.4, 9.13];
    const states = seeds.map((x) => makeIdleState(x));
    const changes = seeds.map(() => []);
    const last = seeds.map(() => null);
    for (let t = 0; t < 30000; t += 50) {
      states.forEach((st, i) => {
        const r = idleStep(st, t, (x) => x);
        if (r.kind !== last[i]) {
          changes[i].push(t);
          last[i] = r.kind;
        }
      });
    }
    // Ignore t=0, where every face necessarily starts.
    const after = changes.map((c) => c.filter((t) => t > 0));
    for (const c of after) assert.ok(c.length > 3, "each face actually moves");
    const together = after[0].filter((t) => after.every((c) => c.includes(t)));
    assert.equal(together.length, 0, `no beat where all five change at once`);
    // First beats must be spread out, not identical.
    const firsts = new Set(after.map((c) => c[0]));
    assert.ok(firsts.size >= 4, `first beats differ across faces, got ${[...firsts]}`);
  }

  // ---- The grid scheduler must be gone from the renderer.
  const uf = stripComments(fs.readFileSync(path.join(ROOT, "src/umbra/UmbraFace.jsx"), "utf8"));
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
