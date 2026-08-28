"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const { stripComments } = require("./lib/source-scan.cjs");

const ROOT = path.join(__dirname, "..");

async function main() {
  const { pokeFrame, pokeDuration, POKE_MS, HOP_HEIGHT, MAX_HOPS } = await import(
    pathToFileURL(path.join(ROOT, "src/umbra/poke.js")).href
  );

  // It is a JUMP: the body leaves the ground and comes back to it.
  const rest = pokeFrame(0);
  const end = pokeFrame(1);
  // sin(pi) is not exactly 0 in floating point, so "on the ground" is a
  // sub-pixel tolerance, not an identity.
  assert.ok(rest.hopY < 1e-9, "starts on the ground");
  assert.ok(end.hopY < 1e-9, "lands back on the ground");

  let peak = 0;
  let peakAt = 0;
  for (let i = 0; i <= 100; i++) {
    const f = pokeFrame(i / 100);
    if (f.hopY > peak) {
      peak = f.hopY;
      peakAt = i / 100;
    }
  }
  assert.ok(peak > 0.12, `it actually leaves the ground (peak ${peak})`);
  assert.ok(Math.abs(peak - HOP_HEIGHT) < 1e-6, "peak is HOP_HEIGHT");
  assert.ok(peakAt > 0.35 && peakAt < 0.65, `apex is mid-arc, got ${peakAt}`);

  // It is NOT a stretch. The old poke went to 1.28 tall / 0.90 wide.
  let maxY = 0;
  let minY = 9;
  let maxX = 0;
  let minX = 9;
  for (let i = 0; i <= 100; i++) {
    const f = pokeFrame(i / 100);
    maxY = Math.max(maxY, f.stretchY);
    minY = Math.min(minY, f.stretchY);
    maxX = Math.max(maxX, f.stretchX);
    minX = Math.min(minX, f.stretchX);
  }
  assert.ok(maxY <= 1.05, `no tall stretch, got ${maxY}`);
  assert.ok(minY >= 0.92, `no deep squash, got ${minY}`);
  assert.ok(maxX <= 1.06 && minX >= 0.97, `width stays honest, got ${minX}..${maxX}`);

  // Squash happens on the ground, not at the apex: the whole point of a jump.
  assert.ok(pokeFrame(0.06).stretchY < 1, "crouches on takeoff");
  assert.ok(pokeFrame(0.94).stretchY < 1, "absorbs on landing");
  assert.ok(pokeFrame(0.5).stretchY >= 1, "no squash at the apex");

  // Out-of-range phases must not produce NaN geometry.
  for (const bad of [-1, 2, NaN, undefined, "x"]) {
    const f = pokeFrame(bad);
    for (const k of Object.keys(f)) assert.ok(Number.isFinite(f[k]), `${k} finite for ${bad}`);
  }

  // Direction only affects yaw, never the arc.
  assert.equal(pokeFrame(0.4, -1).hopY, pokeFrame(0.4, 1).hopY);
  assert.equal(pokeFrame(0.4, -1).turn, -pokeFrame(0.4, 1).turn);

  assert.ok(POKE_MS > 200 && POKE_MS < 900, "a poke is one beat, not a performance");

  // ---- CHAINED HOPS. Clicking again mid-air used to reset the phase, which
  // teleported the body from the top of its arc to the floor in one frame.
  // Extra clicks extend the SAME arc into more bounces instead.
  for (const n of [2, 3, 4]) {
    const peaks = [];
    let prev = 0;
    let rising = false;
    for (let i = 0; i <= 400; i++) {
      const y = pokeFrame(i / 400, 1, n).hopY;
      if (y > prev) rising = true;
      else if (rising) {
        peaks.push(prev);
        rising = false;
      }
      prev = y;
    }
    assert.equal(peaks.length, n, `${n} clicks give ${n} bounces, got ${peaks.length}`);
    for (let i = 1; i < peaks.length; i++) {
      assert.ok(peaks[i] < peaks[i - 1], "each bounce is lower than the last");
    }
    // Sampled, so the true apex falls between samples: allow a sample of slack.
    assert.ok(Math.abs(peaks[0] - HOP_HEIGHT) < 0.002, `first bounce is full height, got ${peaks[0]}`);
    assert.equal(pokeDuration(n), POKE_MS * n, "and the poke lasts proportionally longer");
  }

  // The arc is CONTINUOUS: no frame-to-frame teleport anywhere in it.
  for (const n of [1, 2, 3, 4]) {
    let prev = pokeFrame(0, 1, n).hopY;
    for (let i = 1; i <= 2000; i++) {
      const y = pokeFrame(i / 2000, 1, n).hopY;
      assert.ok(Math.abs(y - prev) < 0.02, `no jump in the arc at ${i / 2000} (${n} hops)`);
      prev = y;
    }
  }

  // Hops are clamped, so leaning on the mouse cannot start a minute-long dance.
  assert.equal(pokeDuration(99), pokeDuration(MAX_HOPS));
  assert.deepEqual(pokeFrame(0.5, 1, 99), pokeFrame(0.5, 1, MAX_HOPS));
  assert.deepEqual(pokeFrame(0.5, 1, 0), pokeFrame(0.5, 1, 1), "0 hops is still one hop");

  // A chained poke must not restart the eye motion; the renderer guards on
  // `poke.played`, which extra clicks preserve.
  {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "src/umbra/UmbraFace.jsx"), "utf8"));
    assert.ok(src.includes("poke.played"), "play() is called once per poke, not once per click");
    assert.ok(/live\.hops \+= 1/.test(src), "an extra click adds a hop to the live poke");
    assert.ok(!/pokeRef\.current = \{[^}]*\}\s*;\s*\n\s*setPoking/.test(src), "no unconditional reset");
  }

  // The renderer must actually translate by hopY, and the engine must not have
  // grown a notion of it.
  const uf = fs.readFileSync(path.join(ROOT, "src/umbra/UmbraFace.jsx"), "utf8");
  assert.ok(uf.includes("pokeFrame"), "UmbraFace uses the shared curve");
  assert.ok(/S\.hopY/.test(uf), "the paint group translates by hopY");
  assert.ok(uf.includes("pokeTimer"), "spam-poke uses one owned timer");
  const rt = stripComments(fs.readFileSync(path.join(ROOT, "src/umbra/character-runtime.js"), "utf8"));
  assert.ok(!rt.includes("hopY"), "the vendored engine stays untouched");

  console.log("poke-test ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
