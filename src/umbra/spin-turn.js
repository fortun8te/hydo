/**
 * Working-face yaw: extreme ease-in, one fast revolution, extreme ease-out,
 * brief pause with a small wobble, then the next turn.
 * Phase is 0..1 over SPIN_MS. Return value is degrees added to cfg.turn.
 */
export const SPIN_MS = 1100;
export const SPIN_PAUSE = 0.14;
export const SPIN_WOBBLE = 3;

export function easeInOutCubic(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Quintic ease — long slow ends, a fast middle. */
export function easeInOutQuint(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x < 0.5 ? 16 * Math.pow(x, 5) : 1 - Math.pow(-2 * x + 2, 5) / 2;
}

export function spinTurn(phase) {
  const p = ((Number(phase) % 1) + 1) % 1;
  const motionEnd = 1 - SPIN_PAUSE;
  if (p >= motionEnd) {
    const u = (p - motionEnd) / SPIN_PAUSE;
    return SPIN_WOBBLE * Math.sin(u * Math.PI * 2);
  }
  return 360 * easeInOutQuint(p / motionEnd);
}

export function hash01(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function cycleSpec(seed = 0, cycle = 0) {
  // Always yaw the same way: the bot's left, our right (positive turn).
  const revs = hash01(seed * 5.03 + cycle * 2.7) > 0.68 ? 2 : 1;
  return { dir: 1, revs };
}

/** Same ease as spinTurn, but some cycles reverse and some do two revs. */
export function spinCycle(phase, seed = 0, cycle = 0) {
  const { dir, revs } = cycleSpec(seed, cycle);
  return dir * revs * spinTurn(phase);
}

/**
 * Continuous yaw across cycles. `state` is mutated so we never walk every
 * past cycle, and a reverse/2-rev cycle does not snap back to 0°.
 */
export function makeSpinState() {
  return { base: 0, cycle: 0, dir: 1, revs: 1, ready: false };
}

export function spinStage(state, phase, seed, cycle) {
  const st = state || makeSpinState();
  if (!st.ready) {
    const s = cycleSpec(seed, cycle);
    st.dir = s.dir;
    st.revs = s.revs;
    st.cycle = cycle;
    st.ready = true;
  }
  while (st.cycle < cycle) {
    st.base += st.dir * st.revs * 360;
    st.cycle += 1;
    const s = cycleSpec(seed, st.cycle);
    st.dir = s.dir;
    st.revs = s.revs;
  }
  const motionEnd = 1 - SPIN_PAUSE;
  if (phase >= motionEnd) {
    const u = (phase - motionEnd) / SPIN_PAUSE;
    return st.base + st.dir * st.revs * 360 + SPIN_WOBBLE * Math.sin(u * Math.PI * 2);
  }
  return st.base + st.dir * st.revs * 360 * easeInOutQuint(phase / motionEnd);
}

/** Shortest-path ease of yaw toward a multiple of 360 (visual rest). */
export function easeYawToRest(yaw, t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  const e = easeInOutQuint(x);
  const wrapped = ((yaw % 360) + 360) % 360;
  const delta = wrapped > 180 ? wrapped - 360 : wrapped;
  return yaw - delta * e;
}
