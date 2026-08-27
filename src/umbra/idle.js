/**
 * What a teammate does while he is standing there waiting for you.
 *
 * The previous version was a metronome wearing a costume. Everything hung off
 * one 4.6s grid: `floor(t / 4.6)` picked the motion AND `floor(t / 4.6)` picked
 * where he looked, so every 4.6s, exactly on the beat, he changed posture and
 * changed gaze in the same frame, forever, at the same amplitude. Seeding it
 * per bot only shifted the phase. A grid is not randomness, it is a clock with
 * noise painted on it, and you can feel the difference.
 *
 * Three things fix that, and all three are what "natural" actually means here:
 *
 *   1. IRREGULAR INTERVALS. Every beat draws its own duration, so boundaries
 *      land at 2.1s, then 6.8s, then 3.4s. There is no period to lock onto.
 *   2. DECOUPLED STREAMS. Posture and gaze are separate schedules with
 *      different ranges. Eyes move without the body, and sometimes both at
 *      once by coincidence, which is the only way "at once" ever reads as
 *      coincidence.
 *   3. SETTLING. Someone who has been waiting two minutes is calmer than
 *      someone who just walked up. `restless` decays, stills stretch, glances
 *      shorten. It gives the idle a shape over time instead of a texture.
 *
 * Seeded and deterministic (same seed + same time = same result), so it is
 * testable, but the sequence it produces is aperiodic.
 *
 * Pure. No DOM, no React, no clock of its own.
 */

import { hash01 } from "./spin-turn.js";

export const IDLE = {
  // A still beat: he is just there. The long tail is the point — occasionally
  // he does nothing for seven seconds, which no fixed grid ever produces.
  STILL_MIN: 1700,
  STILL_MAX: 7400,
  // A motion beat: one of the calm motions plays out.
  MOVE_MIN: 900,
  MOVE_MAX: 2300,
  // The gaze runs on its own, faster and more often than posture.
  LOOK_MIN: 900,
  LOOK_MAX: 4600,
  // How long the eased turn onto a new gaze target takes.
  LOOK_EASE_MS: 900,
  // Gaze amplitude in degrees, before `restless` scales it.
  LOOK_MIN_DEG: 5,
  LOOK_MAX_DEG: 17,
  // He is fully settled after this long with nothing happening.
  SETTLE_MS: 75_000,
  // Settled stills last this much longer; settled glances are this much smaller.
  SETTLE_STRETCH: 2.1,
  SETTLE_DAMP: 0.45,
};

// Weighted, and deliberately short. `bounce` and `excited` are REACTIONS and
// belong to a poke; a teammate who bounces while waiting looks unwell.
const CAST = [
  ["lookAround", 0.42],
  ["scan", 0.3],
  ["peek", 0.17],
  ["nod", 0.11],
];

function pickKind(r, avoid) {
  let acc = 0;
  for (const [id, w] of CAST) {
    acc += w;
    if (r < acc) return id === avoid ? null : id;
  }
  return null;
}

/** Choose a motion, never the same one twice running. */
function nextKind(seed, n, avoid) {
  for (let i = 0; i < 4; i++) {
    const hit = pickKind(hash01(seed * 3.7 + n * 11.3 + i * 5.1), avoid);
    if (hit) return hit;
  }
  return avoid === "lookAround" ? "scan" : "lookAround";
}

function span(r, min, max) {
  return min + r * (max - min);
}

export function makeIdleState(seed = 0) {
  return {
    seed: Number(seed) || 0,
    // posture stream
    n: 0,
    kind: "idle",
    until: 0,
    last: null,
    // gaze stream, independent
    ln: 0,
    lookUntil: 0,
    lookFrom: 0,
    lookTo: 0,
    lookAt0: 0,
    deg: 0,
    // when this idle began, for settling
    since: 0,
    started: false,
  };
}

/** 1 when he has just arrived, easing to 0 once he has been waiting a while. */
export function restlessAt(st, now) {
  if (!st || !st.started) return 1;
  const t = (now - st.since) / IDLE.SETTLE_MS;
  if (!Number.isFinite(t) || t <= 0) return 1;
  if (t >= 1) return 0;
  // Smoothstep down, so settling is gradual rather than a step at the end.
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Advance both streams to `now`. Mutates and returns `st`.
 *
 * @returns {{kind:string, deg:number, restless:number}}
 *   kind — the motion id to play ("idle" means stand still)
 *   deg  — yaw offset in degrees, already eased
 */
export function idleStep(st, now, ease) {
  const s = st || makeIdleState();
  if (!s.started) {
    s.started = true;
    s.since = now;
    // PHASE OFFSET. Not `= now`.
    //
    // Faces mount together and share one rAF clock, so starting every stream
    // at `now` meant every face's first beat fired on the same frame. The seed
    // only ever decided WHICH motion and HOW LONG, never WHEN, so a row of
    // them changed posture in unison and looked like one animation playing on
    // three sprites. Start each one at a random point already inside its first
    // beat and they are never aligned to begin with.
    s.until = now + IDLE.STILL_MIN * (0.15 + 0.85 * hash01(s.seed * 3.37 + 11.7));
    s.lookUntil = now + IDLE.LOOK_MIN * (0.1 + 0.9 * hash01(s.seed * 9.11 + 4.2));
    // Stagger the settling too, or they all calm down together.
    s.since = now - IDLE.SETTLE_MS * 0.5 * hash01(s.seed * 5.53 + 2.9);
  }

  const restless = restlessAt(s, now);
  // Settled = longer stills. Motions themselves keep their own length; a nod
  // does not get slower because you have been waiting, it just happens less.
  const stretch = 1 + (1 - restless) * (IDLE.SETTLE_STRETCH - 1);

  // ---- posture ----------------------------------------------------------
  // A while loop, not an if: a tab that was backgrounded comes back with a
  // huge jump in `now`, and one beat per frame would crawl through it.
  let guard = 0;
  while (now >= s.until && guard++ < 64) {
    s.n += 1;
    const r = hash01(s.seed * 7.13 + s.n * 2.91);
    if (s.kind === "idle") {
      // `s.last` is what he did LAST time he moved, so two motion beats in a
      // row are never the same one even though a still beat sits between them.
      s.kind = nextKind(s.seed, s.n, s.last);
      s.until += span(r, IDLE.MOVE_MIN, IDLE.MOVE_MAX);
    } else {
      s.last = s.kind;
      s.kind = "idle";
      s.until += span(r, IDLE.STILL_MIN, IDLE.STILL_MAX) * stretch;
    }
  }
  if (guard >= 64) {
    // Way out of date (tab was hidden for minutes). Restart cleanly rather
    // than replaying a thousand beats nobody saw.
    s.until = now + span(0.5, IDLE.STILL_MIN, IDLE.STILL_MAX) * stretch;
    s.kind = "idle";
  }

  // ---- gaze, on its own clock -------------------------------------------
  let lguard = 0;
  while (now >= s.lookUntil && lguard++ < 64) {
    s.ln += 1;
    const r = hash01(s.seed * 5.77 + s.ln * 4.19);
    const amp = span(hash01(s.seed + s.ln * 8.3), IDLE.LOOK_MIN_DEG, IDLE.LOOK_MAX_DEG);
    const damped = amp * (IDLE.SETTLE_DAMP + (1 - IDLE.SETTLE_DAMP) * restless);
    // Not a coin flip between two sides: sometimes he looks back to centre,
    // sometimes barely moves, which is what stops it reading as a wiper.
    const pick = hash01(s.seed * 2.2 + s.ln * 6.6);
    const to = pick < 0.18 ? 0 : (pick < 0.59 ? 1 : -1) * damped;
    s.lookFrom = s.deg;
    s.lookTo = to;
    s.lookAt0 = s.lookUntil;
    s.lookUntil += span(r, IDLE.LOOK_MIN, IDLE.LOOK_MAX) * stretch;
  }
  if (lguard >= 64) {
    s.lookFrom = s.deg;
    s.lookTo = 0;
    s.lookAt0 = now;
    s.lookUntil = now + IDLE.LOOK_MIN;
  }

  const u = Math.max(0, Math.min(1, (now - s.lookAt0) / IDLE.LOOK_EASE_MS));
  const e = typeof ease === "function" ? ease(u) : u;
  s.deg = s.lookFrom + (s.lookTo - s.lookFrom) * e;

  return { kind: s.kind, deg: s.deg, restless };
}
