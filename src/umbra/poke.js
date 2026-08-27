/**
 * The poke: what a bot mark does when you click it.
 *
 * It used to scale the body to 128% tall and 90% wide and swing the tilt six
 * degrees. That is not a hop, it is the mark being pulled out of shape, and at
 * roster size it read as a rendering glitch rather than a reaction.
 *
 * A jump instead. `hopY` is a fraction of the face box that the WHOLE body is
 * translated up by, so the silhouette stays honest for the entire arc, and the
 * only squash is the two beats that sell it: a crouch as it leaves the ground
 * and an absorb as it lands.
 *
 * Pure, so it can be tested without a DOM. Phase `u` is 0..1 over POKE_MS.
 */

export const POKE_MS = 520;
export const HOP_HEIGHT = 0.23;
export const MAX_HOPS = 4;
const CROUCH_END = 0.16;
const LAND_START = 0.82;
// Each chained hop is a bit lower than the one before, the way a real bounce
// loses energy. Flat repeats read as a loop, not as a reaction.
const HOP_DECAY = 0.72;

function clamp01(u) {
  const x = Number(u);
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * @param {number} u     phase over the WHOLE poke, 0..1
 * @param {number} dir   which way the small yaw goes
 * @param {number} hops  how many times it bounces (see `pokeDuration`)
 */
export function pokeFrame(u, dir = 1, hops = 1) {
  const t = clamp01(u);
  const n = Math.max(1, Math.min(MAX_HOPS, Math.round(Number(hops) || 1)));

  // Which bounce are we in, and how far through it. Clicking again mid-air
  // used to reset t0, which teleported the body from the top of its arc back
  // to the floor in one frame — the "it doesn't restart properly" glitch.
  // Extra clicks now ADD a bounce to the same continuous arc instead.
  const scaled = t * n;
  const idx = Math.min(n - 1, Math.floor(scaled));
  const local = scaled - idx;

  const height = HOP_HEIGHT * Math.pow(HOP_DECAY, idx);
  // Ballistic-ish: fast off the ground, a hang at the top, fast back down.
  // `air ** 1.6` flattens the apex so it reads as a hang rather than a bounce.
  const air = Math.sin(local * Math.PI) ** 1.6;
  const crouch = local < CROUCH_END ? Math.sin((local / CROUCH_END) * Math.PI) : 0;
  const land = local > LAND_START ? Math.sin(((local - LAND_START) / (1 - LAND_START)) * Math.PI) : 0;
  const squash = Math.max(crouch, land);
  const energy = height / HOP_HEIGHT;
  return {
    hopY: height * air,
    // Wider and shorter on the ground, a touch narrower in the air.
    stretchY: 1 - 0.07 * squash * energy + 0.04 * air,
    stretchX: 1 + 0.05 * squash * energy - 0.02 * air,
    turn: (dir || 1) * 4 * air * energy,
  };
}

/** A poke of `hops` bounces runs this long. */
export function pokeDuration(hops = 1) {
  const n = Math.max(1, Math.min(MAX_HOPS, Math.round(Number(hops) || 1)));
  return POKE_MS * n;
}
