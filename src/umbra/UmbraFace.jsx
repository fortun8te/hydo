import { useEffect, useMemo, useRef, useState } from "react";
import {
  EYE_STYLE_BY_ID,
  MOTION_BY_ID,
  bodyPaint,
  computeFrame,
  contentExtent,
  createAvatar,
  play,
  svgFrame,
} from "./character-runtime.js";
import { BOX_EXTENT, FACE, shapeIdOf, specFor } from "./rims.js";
import { colorOf } from "../lib/marks.js";
import { SPIN_MS, spinCycle, spinStage, makeSpinState, easeYawToRest, easeInOutQuint, hash01 } from "./spin-turn.js";
import { POKE_MS, MAX_HOPS, pokeDuration, pokeFrame } from "./poke.js";
import { makeIdleState, idleStep } from "./idle.js";

// A Grok bot's mark, drawn by Umbra's own character engine.
//
// This is a port of Umbra's official React-Native renderer (UmbraView.tsx) to
// SVG. The engine is identical — `character-runtime.js` is vendored byte for
// byte apart from one added `rim` branch in shapePoints() that lets Grok's own
// 18 silhouettes stand in for the engine's built-in primitives (see rims.js).
// Only the paint layer changes: Skia's <Path>/<RadialGradient>/<Group>/<Blur>
// become <path>/<radialGradient>/<g>/<feGaussianBlur>, and skiaFrame() becomes
// svgFrame(), which walks the same outlines into the same subpaths.
//
// THE ONE THING THAT MUST NOT BE CHANGED
//
// The engine's body is a stack of MANY closed depth rings — computeFrame()
// returns `{pts, ends}` with one `end` per ring, and svgFrame() concatenates
// them into a single `d`. Skia fills a path with NONZERO winding, so the rings
// union into one solid silhouette. SVG's default fill-rule is nonzero too, so
// the plain <path d={bodyD}/> below is correct. Setting fill-rule="evenodd"
// XORs the rings into alternating filled and empty bands and the body comes out
// as concentric wireframe stripes. That was the bug, twice. Do not add it.

// -------------------------------------------------------------- shared clock
//
// One rAF for every animating face on screen, not one each. A face that is not
// animating never touches it, so a roster of idle bots schedules no frames at
// all.

const ticking = new Set();
let rafId = 0;

function beat(now) {
  rafId = ticking.size ? requestAnimationFrame(beat) : 0;
  for (const fn of Array.from(ticking)) {
    try {
      fn(now);
    } catch {
      /* one sick face must not stop the others */
    }
  }
}

function joinClock(fn) {
  ticking.add(fn);
  if (!rafId && typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(beat);
  return () => {
    ticking.delete(fn);
    if (!ticking.size && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}

// -------------------------------------------------------------- moods
//
// A mood names one of the engine's 30 motions. The four the app actually asks
// for:
//   idle    — still. No motion, no clock, no re-render twitch.
//   think   — reading/thinking: the head turns in 3D and the eyes go looking.
//   spin    — working: the engine's own yaw spin, so the eyes ride the surface
//             instead of the whole mark being rotated in the plane.
//   typing  — writing: three dots, no eyes.

const MOOD_MOTION = {
  idle: "idle",
  still: "idle",
  // "scan" is the widest yaw the engine ships — its two scan expressions are
  // +/-30 degrees of headY, which still reads as a turn at 16px. lookAround and
  // thinking only reach 16 and vanish at roster size.
  reading: "scan",
  looking: "scan",
  lookaround: "scan",
  thinking: "scan",
  waiting: "lookAround",
  fidget: "lookAround",
  working: "spin",
  spin: "spin",
  typing: "idle",
  writing: "idle",
  typewriting: "idle",
};

const STILL = new Set(["idle", "still"]);
const DOTS = new Set(["typing", "writing", "typewriting"]);

function motionIdFor(mood) {
  const key = String(mood || "idle");
  if (MOOD_MOTION[key]) return MOOD_MOTION[key];
  if (MOTION_BY_ID[key]) return key;
  return "idle";
}

// Working is a CONTINUOUS turn about the body's own vertical axis, and the
// engine already has the field for it: cfg.turn is added straight to the head's
// yaw before the pose quaternion is built, so winding it round at a steady rate
// gives a real z-axis rotation with the eyes riding the curved surface and
// disappearing round the far side. It is the studio's own turn control, driven
// off the clock.
//
// The shipped `spin` motion is a performance — 1.6s of standing still, a perk,
// one eased revolution, then a star-eyed pop — which is a party trick, not a
// busy indicator, and its single eased revolution stalls at both ends. So spin
// rides a plain steady pose instead and cfg.turn does the turning.
// Curve: ease-in → revolution → ease-out → brief pause with wobble (spin-turn.js).

const STEADY = {
  id: "steady",
  name: "Steady",
  bodyMotion: "none",
  motionScale: 0.15,
  eyeMotion: "microSaccades",
  steps: [{ expressionId: "neutral", transitionMs: 400, transition: "smooth", holdMs: 3200 }],
  blink: MOTION_BY_ID.idle.blink,
};

function motionFor(id) {
  if (id === "spin") return STEADY;
  return MOTION_BY_ID[id] || MOTION_BY_ID.idle;
}

// -------------------------------------------------------------- config
//
// UmbraView ships one frozen CONFIG per exported character. Ours is the same
// object with the roster's colours dropped in, and with shine/shadow at zero:
// Grok's avatars are a single flat colour (sampled off the kit screenshot, the
// bodies are one exact RGB triple edge to edge), so the RadialGradient below is
// wired up exactly as the official renderer wires it and simply resolves to
// three identical stops.

const BASE_CONFIG = {
  characterId: "grok",
  eyeStyleId: "plain",
  motionId: "idle",
  topperId: "none",
  size: 1,
  stretchX: 1,
  stretchY: 1,
  depth: 1,
  perspective: 1,
  turn: FACE.turn,
  tilt: FACE.tilt,
  lean: 0,
  bodyColor: "#777777",
  surfaceId: "solid",
  lightColor: "#ffffff",
  shadowColor: "#000000",
  // Clay volume: a real light wrap, not a sticker. Stays one hue.
  shine: 0.12,
  shadow: 0.08,
  lightX: -0.28,
  lightY: -0.32,
  lightSpread: 0.95,
  gloss: 0.05,
  rim: 0.06,
  rimColor: "#ffffff",
  eyeColor: "#141414",
  irisColor: "#7FBF52",
  pupilColor: "#0B0D10",
  glintColor: "#FFFFFF",
  eyeWidth: 1.04,
  eyeHeight: 1.06,
  eyeSpacing: 1,
  eyeRaise: 0.02,
  eyeAngle: 0,
  irisSize: 1.05,
  pupilSize: 1,
  glintSize: 1.22,
  eyeMorph: true,
  speed: 1,
  motionAmount: 1,
  blink: true,
  // The engine divides its blink interval BY this, so below 1 is slower.
  // At 1 the roster blinked about every 2s per face, and a column of eight
  // faces blinking at 1Hz between them is what "moving too much" was: no one
  // face was wrong, the wall of them was. 0.55 roughly doubles the gap.
  blinkRate: 0.55,
  flush: false,
  glide: false,
  flushColors: {},
  motionParams: {},
  textureId: "none",
  textureColors: {},
  textureWidth: 1,
  textureOpacity: 1,
  textureDensity: 1,
  topperSize: 1,
  topperSpread: 1,
  topperHeight: 1,
  topperAcross: 0,
  topperLift: 0,
  topperTilt: 0,
  topperDepth: 0.2,
  topperColor: "",
  impressionId: "none",
  impressionGlyph: "",
  impressionText: "",
  impressionColor: "",
  impressionSize: 1,
  impressionHeight: 1,
  impressionDrops: 1,
  impressionSpeed: 1,
};

const DETAIL = 4;
const NO_DRAG = { x: 0, y: 0, active: false, vx: 0, vy: 0, lastX: 0, lastY: 0 };

const configCache = new Map();
function configFor(bodyColor, eyeColor, motionId) {
  const key = bodyColor + "|" + eyeColor + "|" + motionId;
  let cfg = configCache.get(key);
  if (!cfg) {
    cfg = { ...BASE_CONFIG, bodyColor, eyeColor, motionId };
    configCache.set(key, cfg);
  }
  return cfg;
}

const specCache = new Map();
function cachedSpec(shapeId) {
  let spec = specCache.get(shapeId);
  if (!spec) {
    spec = specFor(shapeId);
    specCache.set(shapeId, spec);
  }
  return spec;
}

// Grok draws all 18 silhouettes through ONE fixed frame, so a teardrop and a
// hex keep their relative sizes and a wide shape overhangs rather than being
// shrunk. contentExtent() is per character and would scale each of the 18
// differently, so rims.js turns Grok's own viewBox into the engine's units and
// that is the scale every face uses. Overhang is safe: styles.css leaves
// .umbra-face overflow visible.

// -------------------------------------------------------------- frames

let seq = 0;
const nextId = () => "uf" + ++seq;

const stillCache = new Map();

/**
 * The one frame a still face shows. Cached by shape and motion because it does
 * not depend on colour or size — ten idle bots of the same shape compute it
 * once between them, and a re-render never recomputes it, so an idle face
 * cannot twitch.
 */
function fitExtentFor(spec) {
  try {
    const r = contentExtent(spec, BASE_CONFIG, null, MOTION_BY_ID.idle);
    if (Number.isFinite(r) && r > 0) return r;
  } catch {
    /* fall through */
  }
  return BOX_EXTENT;
}

function stillFrame(shapeId, motionId) {
  const key = shapeId + "|" + motionId;
  let hit = stillCache.get(key);
  if (hit) return hit;
  const spec = cachedSpec(shapeId);
  const motion = motionFor(motionId);
  const cfg = { ...BASE_CONFIG, motionId, blink: false };
  const A = createAvatar(spec, motion, true, 4.3, DETAIL);
  const f = svgFrame(computeFrame(A, 0, { config: cfg, style: EYE_STYLE_BY_ID.plain, topper: null, drag: NO_DRAG }));
  hit = { frame: f, extent: BOX_EXTENT, fit: fitExtentFor(spec) };
  stillCache.set(key, hit);
  return hit;
}

// -------------------------------------------------------------- reduced motion

function prefersReducedMotion() {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    let mq;
    try {
      mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    } catch {
      mq = null;
    }
    if (!mq) return undefined;
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

// -------------------------------------------------------------- chrome
//
// Chrome is not a colour with shading on it. A polished metal ball is almost
// entirely a MIRROR: what you read as "chrome" is the room reflected in it —
// bright sky along the top, a hard dark band where the horizon wraps, a
// lighter bounce off the floor below that, and a thin specular hit near the
// top where the light source is.
//
// A radial gradient cannot say that. It only knows distance from a point, so
// it produces a shiny plastic ball. This is a VERTICAL ramp with deliberately
// tight stops: the sharp transitions are what the eye reads as polish, and
// softening them turns it back into plastic.
// Tuned against the FULL body, top to bottom. Chrome on a dark app has to
// stay bright overall or it reads as a hole in the page, so the darkest value
// here is a mid-slate, not black — the contrast comes from the sharpness of
// the horizon, not from how far down the ramp goes.
const CHROME_RAMP = [
  // HARD EDGES ARE THE WHOLE THING.
  //
  // A smooth vertical ramp reads as plastic or satin no matter how you tune
  // the values, because a mirror does not blur what it reflects. What the eye
  // uses to decide "that is chrome" is sharp discontinuity: the horizon line,
  // the corner where a wall meets a floor.
  //
  // But not EVERY edge is hard, or it reads as a barcode. A real room gives
  // you two or three crisp lines and a lot of soft falloff between them, and
  // the bands are uneven. Three hard edges here, at uneven heights, and
  // everything else blends.
  [0.0, "#AEBBCB"],   // grazing sky, dim
  [0.12, "#F4F8FD"],  // sky opening up (soft)
  [0.26, "#FFFFFF"],  // blown highlight band (soft)
  [0.38, "#AAB5C2"],  // falling toward the horizon (soft)
  [0.455, "#79838F"],
  [0.47, "#1B2028"],  // ── HARD: the horizon. The one everything reads from.
  [0.53, "#13181E"],
  [0.545, "#525A65"], // ── HARD: ground plane begins
  [0.66, "#8A9099"],  // ground receding (soft)
  [0.75, "#EDE8DF"],  // ── warm floor bounce, brightest below the horizon
  [0.79, "#F7F3EB"],
  [0.87, "#9C9A97"],  // falloff (soft)
  [1.0, "#6B7079"],   // terminator, kept off black so it does not punch a
                      // hole in a dark page
];

function isMetal(colorId) {
  return String(colorId || "") === "chrome";
}

// -------------------------------------------------------------- the live face
//
// The animating half of UmbraView: an avatar built once in a ref, re-aimed with
// play() when the motion changes, and driven by computeFrame() off a clock in
// an effect that cancels on unmount.

// ------------------------------------------------------------- transitions
//
// Every branch below writes cfg values for its own state. Left alone, the
// FRAME a state changes on is a hard cut: spin hands over at turn=712deg and
// lean=10 and the fidget branch writes turn=8, lean=1, so the body snaps. That
// is the glitch "between stages". There was a `wind` easing for exactly one of
// these paths (morph -> rest) and nothing for the rest.
//
// So instead of easing each pair by hand, everything goes through one settle:
// remember what was actually drawn last frame, and when the ACTIVE BRANCH
// changes, ease from those values into the new branch's for SETTLE_MS. One
// mechanism, every transition, including ones added later.
const SETTLE_MS = 340;
const SETTLE_KEYS = ["turn", "lean", "tilt", "stretchX", "stretchY"];

/**
 * The representation of `to` that is nearest `from` on the circle.
 *
 * Yaw accumulates: after three revolutions spin is at 1080deg, and easing that
 * to 8deg would visibly unwind three whole turns. Adding the nearest multiple
 * of 360 makes it take the short way round instead.
 */
function nearestAngle(from, to) {
  return to + 360 * Math.round((from - to) / 360);
}

function makeSettle() {
  return { mode: null, t0: 0, from: null, last: null };
}

const MORPH_MS = 1080;
const MORPH_TURNS = 720;
const WIND_MS = 420;
const POKE_KINDS = ["bounce", "excited", "wink", "peek", "nod", "curious"];

// -------------------------------------------------------------- fidget pace
//
// Posture and gaze both live in idle.js now, on two independent aperiodic
// schedules that settle the longer he waits. What used to be here was a single
// 4.6s grid driving both, which is why every face on screen changed posture
// and gaze on the same beat forever.

function pickMorph(from, to) {
  const r = Math.random();
  return {
    from,
    to,
    t0: performance.now(),
    turns: r < 0.42 ? 720 : 360,
    dir: r < 0.38 ? -1 : 1,
    squash: 0.16 + r * 0.12,
    hop: r > 0.4,
  };
}

function useLiveFrame(shapeId, motionId, cfg, active, stagger, morphRef, pokeRef, idleSeed = 0) {
  const [frame, setFrame] = useState(null);
  const avatarRef = useRef(null);
  const inputRef = useRef(null);
  const shownRef = useRef(shapeId);
  const motionRef = useRef(motionId);
  motionRef.current = motionId;

  if (!inputRef.current) {
    inputRef.current = { config: { ...cfg }, style: EYE_STYLE_BY_ID.plain, topper: null, drag: { ...NO_DRAG } };
  }
  Object.assign(inputRef.current.config, cfg);

  useEffect(() => {
    if (!active) {
      setFrame(null);
      return undefined;
    }
    let stop = () => {};
    try {
      const spec = cachedSpec(shapeId);
      const first = motionFor(motionRef.current);
      if (avatarRef.current && avatarRef.current.spec === spec) {
        play(avatarRef.current, first);
      } else {
        avatarRef.current = createAvatar(spec, first, true, 4.3, DETAIL);
        shownRef.current = shapeId;
      }
      let t0 = 0;
      let fidgetShown = first.id;
      let shownMotion = first.id;
      const spinState = makeSpinState();
      const idle = makeIdleState(idleSeed);
      let wind = null;
      let lastYaw = 0;
      let hopY = 0;
      let lastPlay = 0;
      const settle = makeSettle();
      stop = joinClock((now) => {
        const mid = motionRef.current;
        const spinning = mid === "spin";
        const fidgeting = mid === "lookAround" || mid === "fidget" || mid === "scan";
        const m = morphRef && morphRef.current;
        const poke = pokeRef && pokeRef.current;
        let showId = shownRef.current === undefined ? shapeId : shownRef.current;
        if (!m) showId = shapeId;
        const cfgLive = inputRef.current.config;
        cfgLive.stretchX = 1;
        cfgLive.stretchY = 1;
        cfgLive.lean = 0;
        cfgLive.tilt = FACE.tilt;
        hopY = 0;

        if (shownMotion !== mid && !poke && !m && avatarRef.current && MOTION_BY_ID[motionFor(mid).id]) {
          play(avatarRef.current, motionFor(mid));
          shownMotion = mid;
          fidgetShown = motionFor(mid).id;
        }

        let mode = "rest";
        if (poke && avatarRef.current) {
          mode = "poke";
          const kind = poke.kind && MOTION_BY_ID[poke.kind] ? poke.kind : "bounce";
          // `play()` restarts the motion's expression timeline, so calling it
          // again mid-poke snapped the eyes back to frame zero. That is the
          // eye glitch. Only ever play it ONCE per poke, tracked on the poke
          // itself rather than on `fidgetShown`, which extra clicks mutate.
          if (!poke.played) {
            poke.played = true;
            fidgetShown = kind;
            play(avatarRef.current, MOTION_BY_ID[kind]);
          }
          // A JUMP, not a stretch — the curve lives in poke.js so it can be
          // tested without a DOM. `hopY` translates the whole body up on the
          // paint group; the engine never learns about it.
          const u = Math.max(0, Math.min(1, (now - poke.t0) / pokeDuration(poke.hops)));
          const f = pokeFrame(u, poke.dir, poke.hops);
          hopY = f.hopY;
          cfgLive.stretchY = f.stretchY;
          cfgLive.stretchX = f.stretchX;
          cfgLive.tilt = FACE.tilt;
          cfgLive.turn = FACE.turn + f.turn;
          if (u >= 1) pokeRef.current = null;
        } else if (m) {
          mode = "morph";
          const t = Math.max(0, Math.min(1, (now - m.t0) / MORPH_MS));
          const e = easeInOutQuint(t);
          const turns = m.turns || MORPH_TURNS;
          const dir = m.dir || 1;
          const squash = m.squash || 0.22;
          showId = t < 0.5 ? m.from : m.to;
          cfgLive.turn = FACE.turn + dir * e * turns;
          const squashWave = Math.sin(t * Math.PI);
          cfgLive.stretchX = 1 - squash * squashWave;
          cfgLive.lean = dir * 6 * squashWave;
          cfgLive.tilt = FACE.tilt;
          if (m.hop && t > 0.78) {
            const h = Math.sin(((t - 0.78) / 0.22) * Math.PI);
            cfgLive.stretchY = 1 + 0.16 * h;
            cfgLive.stretchX = (1 - squash * squashWave) * (1 - 0.06 * h);
          }
          lastYaw = cfgLive.turn;
          if (t >= 1) {
            morphRef.current = null;
            showId = m.to;
            cfgLive.stretchX = 1;
            cfgLive.stretchY = 1;
            cfgLive.lean = 0;
            cfgLive.turn = FACE.turn + dir * turns;
            lastYaw = cfgLive.turn;
            if (!spinning) wind = { from: lastYaw, t0: now };
          }
        } else if (spinning) {
          mode = "spin";
          wind = null;
          if (!t0) t0 = now - stagger * SPIN_MS;
          const elapsed = now - t0;
          const cycle = Math.floor(elapsed / SPIN_MS);
          const phase = (((elapsed / SPIN_MS) % 1) + 1) % 1;
          const yaw = spinStage(spinState, phase, stagger, cycle);
          lastYaw = FACE.turn + yaw;
          cfgLive.turn = lastYaw;
          const wave = Math.sin(phase * 2 * Math.PI);
          const hopBit = hash01(cycle + stagger * 4) > 0.55;
          cfgLive.lean = 10 * wave;
          cfgLive.tilt = FACE.tilt + 5 * wave;
          if (hopBit && phase < 0.18) {
            const h = Math.sin((phase / 0.18) * Math.PI);
            cfgLive.stretchY = 1 + 0.12 * h;
            cfgLive.stretchX = 1 - 0.06 * h;
          }
        } else if (wind) {
          mode = "wind";
          const u = Math.max(0, Math.min(1, (now - wind.t0) / WIND_MS));
          cfgLive.turn = easeYawToRest(wind.from, u);
          lastYaw = cfgLive.turn;
          if (u >= 1) {
            wind = null;
            cfgLive.turn = FACE.turn;
          }
        } else if (fidgeting && avatarRef.current) {
          mode = "fidget";
          const beat = idleStep(idle, now, easeInOutQuint);
          // Re-playing a motion resets its expression timeline, which pops the
          // eyes. The scheduler already alternates still -> move -> still, so
          // this fires at most twice per beat; the guard below stops it firing
          // again on the frame right after a poke released, when `fidgetShown`
          // still holds "bounce" and the eyes are mid-settle.
          if (beat.kind !== fidgetShown && MOTION_BY_ID[beat.kind] && now - lastPlay > 240) {
            fidgetShown = beat.kind;
            lastPlay = now;
            play(avatarRef.current, MOTION_BY_ID[beat.kind]);
          }
          // Gaze is one eased drift, and the body leans a little with it
          // rather than the head swivelling off a fixed torso. No stretch: a
          // teammate waiting for you to finish typing stands still.
          cfgLive.turn = FACE.turn + beat.deg;
          cfgLive.lean = beat.deg * 0.12;
        }

        // ---- settle across a state change ------------------------------
        if (settle.mode !== mode) {
          // Only blend when we already drew something; the first frame of a
          // face has nothing to come from.
          settle.from = settle.last ? { ...settle.last } : null;
          settle.t0 = now;
          settle.mode = mode;
          if (settle.from) settle.from.turn = nearestAngle(settle.from.turn, cfgLive.turn);
        }
        if (settle.from) {
          const u = Math.max(0, Math.min(1, (now - settle.t0) / SETTLE_MS));
          if (u >= 1) {
            settle.from = null;
          } else {
            const e = easeInOutQuint(u);
            for (const k of SETTLE_KEYS) {
              const a = settle.from[k];
              const b = k === "turn" ? nearestAngle(a, cfgLive[k]) : cfgLive[k];
              if (Number.isFinite(a) && Number.isFinite(b)) cfgLive[k] = a + (b - a) * e;
            }
            hopY = settle.from.hopY + (hopY - settle.from.hopY) * e;
          }
        }
        settle.last = {
          turn: cfgLive.turn,
          lean: cfgLive.lean,
          tilt: cfgLive.tilt,
          stretchX: cfgLive.stretchX,
          stretchY: cfgLive.stretchY,
          hopY,
        };

        if (showId !== shownRef.current) {
          try {
            avatarRef.current = createAvatar(cachedSpec(showId), motionFor(motionRef.current), true, 4.3, DETAIL);
            shownRef.current = showId;
            shownMotion = motionRef.current;
          } catch {
            /* keep previous body */
          }
        }
        const A = avatarRef.current;
        if (!A) return;
        const next = svgFrame(computeFrame(A, now, inputRef.current));
        // Carried on the frame rather than in cfg: the engine has no notion of
        // translating the whole body, and it must not grow one.
        next.hopY = hopY;
        setFrame(next);
      });
    } catch {
      setFrame(null);
    }
    return () => stop();
  }, [active, shapeId, stagger, idleSeed]);

  return frame;
}

// -------------------------------------------------------------- paint

function eyePaths(S, cfg) {
  const out = [];
  const one = (e, k) => {
    if (!e) return;
    if (e.d) out.push(<path key={k + "s"} d={e.d} fill={cfg.eyeColor} opacity={e.op} />);
    if (e.id) out.push(<path key={k + "i"} d={e.id} fill={cfg.irisColor} opacity={e.pop} />);
    if (e.pd) out.push(<path key={k + "p"} d={e.pd} fill={cfg.pupilColor} opacity={e.pop} />);
    if (e.gd) out.push(<path key={k + "g"} d={e.gd} fill={cfg.glintColor} opacity={e.pop} />);
  };
  one(S.eyeL, "L");
  one(S.eyeR, "R");
  one(S.eyeC, "C");
  return out;
}

// -------------------------------------------------------------- component

export default function UmbraFace({
  mood = "idle",
  tint = "gray",
  shape = "hex",
  size = 36,
  live = false,
  morph = false,
  fit = false,
  poke,
  className = "",
  title,
}) {
  const reduced = useReducedMotion();
  const shapeId = shapeIdOf(shape);
  const color = useMemo(() => colorOf(tint), [tint]);
  const motionId = motionIdFor(mood);
  const dots = DOTS.has(String(mood));
  const morphRef = useRef(null);
  const pokeRef = useRef(null);
  const prevShape = useRef(shapeId);
  const wasDots = useRef(dots);
  const [morphing, setMorphing] = useState(false);
  const [poking, setPoking] = useState(false);

  useEffect(() => {
    if (!morph || reduced || prevShape.current === shapeId) {
      prevShape.current = shapeId;
      return undefined;
    }
    morphRef.current = pickMorph(prevShape.current, shapeId);
    prevShape.current = shapeId;
    setMorphing(true);
    const t = setTimeout(() => setMorphing(false), MORPH_MS + 40);
    return () => clearTimeout(t);
  }, [shapeId, morph, reduced]);

  useEffect(() => {
    if (dots === wasDots.current) return undefined;
    wasDots.current = dots;
    if (!dots || reduced) return undefined;
    morphRef.current = pickMorph(shapeId, shapeId);
    setMorphing(true);
    const t = setTimeout(() => setMorphing(false), MORPH_MS + 40);
    return () => clearTimeout(t);
  }, [dots, reduced, shapeId]);

  const canPoke = poke !== false && size >= 18;
  const fidget = String(mood) === "fidget" || String(mood) === "waiting";
  const still =
    (dots || STILL.has(String(mood)) || reduced) && !morphing && !fidget && !poking && !live;

  // Spamming the mark used to stack a fresh setTimeout per click while the
  // OLD ones stayed armed, so the third click's jump was killed early by the
  // first click's expiry and the face froze mid-air. One owned timer, cleared
  // and re-armed on every poke, and cleared on unmount.
  const pokeTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(pokeTimer.current), []);

  function onPoke() {
    if (!canPoke || reduced) return;
    const now = performance.now();
    const live = pokeRef.current;
    // Clicking again mid-bounce ADDS a hop to the arc already running rather
    // than resetting t0, which used to teleport the body from the top of its
    // jump to the floor in a single frame. `played` is preserved so the eye
    // motion is not restarted either.
    if (live && live.hops < MAX_HOPS) {
      live.hops += 1;
    } else if (!live) {
      pokeRef.current = { kind: "bounce", t0: now, dir: Math.random() > 0.5 ? 1 : -1, hops: 1, played: false };
    }
    const p = pokeRef.current;
    setPoking(true);
    window.clearTimeout(pokeTimer.current);
    pokeTimer.current = window.setTimeout(() => {
      pokeRef.current = null;
      setPoking(false);
    }, Math.max(0, p.t0 + pokeDuration(p.hops) - now) + 60);
  }

  const cfg = useMemo(
    () => configFor(color.value, color.ink, motionId),
    [color.value, color.ink, motionId]
  );

  // `stagger` is a low-discrepancy sequence on purpose: it spreads SPIN phase
  // evenly so a roster of working bots never turns in unison.
  const [stagger] = useState(() => (seq * 0.37) % 1);
  // The idle seed is the opposite — genuinely random per mount. An even spread
  // here would mean two bots' waiting rhythms stayed a fixed distance apart
  // for the life of the app, which is exactly the artificial regularity the
  // aperiodic scheduler exists to kill.
  const [idleSeed] = useState(() => Math.random() * 1000);
  const liveFrame = useLiveFrame(shapeId, motionId, cfg, !still, stagger, morphRef, pokeRef, idleSeed);
  // NOT useId(): two React roots on one page both start their ids at r0, and a
  // duplicate <radialGradient id> means url(#...) resolves to whichever face
  // mounted first — every avatar wearing the first one's colour. A process-wide
  // counter cannot collide.
  const [gid] = useState(nextId);

  const body = useMemo(() => {
    try {
      const spec = cachedSpec(shapeId);
      const rest = stillFrame(shapeId, motionId);
      return { spec, paint: bodyPaint(cfg, spec), rest };
    } catch {
      return null;
    }
  }, [shapeId, motionId, cfg]);

  const cls = `umbra-face ${className}`.trim();
  const blank = (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    />
  );
  if (!body) return blank;

  try {
    const S = (!still && liveFrame) || body.rest.frame;
    const extent = fit ? body.rest.fit || body.rest.extent : body.rest.extent;
    const k = size / (extent * 2);
    const paint = body.paint;
    const ramp = S.ramp ? [S.ramp.light, S.ramp.mid, S.ramp.dark] : [paint.light, paint.mid, paint.dark];
    const clipId = `uf-clip-${gid}`;
    const gradId = `uf-grad-${gid}`;
    const scaled = paint.scaleX !== 1 || paint.scaleY !== 1;
    const metal = isMetal(tint);

    return (
      <svg
        className={cls}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        xmlns="http://www.w3.org/2000/svg"
        role={title ? "img" : undefined}
        aria-label={title || undefined}
        aria-hidden={title ? undefined : "true"}
        style={canPoke ? { cursor: "pointer" } : undefined}
        onPointerDown={onPoke}
      >
        {title ? <title>{title}</title> : null}
        <defs>
          {metal ? (
            <>
              {/* Vertical, in the BODY's own space, so the reflection stays
                  put while the head turns. A reflection that rotates with the
                  object is the classic tell that it is painted on. */}
              {/* Bounds are the BODY's extent, not `paint.r`.
                  `paint.r` is `max(rx,ry) * 1.5 * lightSpread` — about 1.4x
                  the real radius, because it was sized for a light falloff
                  that is meant to spill past the silhouette. Using it here
                  meant the body only ever saw the middle ~70% of the ramp:
                  the blown-out sky and the terminator landed outside the
                  shape and the visible part was a muddy grey band. */}
              <linearGradient
                id={gradId}
                gradientUnits="userSpaceOnUse"
                x1={0}
                y1={-extent}
                x2={0}
                y2={extent}
              >
                {CHROME_RAMP.map(([off, col]) => (
                  <stop key={off} offset={off} stopColor={col} />
                ))}
              </linearGradient>
              {/* The specular hit: a small blown-out highlight up and to the
                  left, where the light actually is (cfg.lightX/lightY). */}
              {/* Broad key: the soft wrap of the light source. */}
              <radialGradient
                id={`${gradId}-spec`}
                gradientUnits="userSpaceOnUse"
                cx={-extent * 0.34}
                cy={-extent * 0.44}
                r={extent * 0.78}
              >
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
                <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.16" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
              {/* Hot core: small and nearly opaque. Polished metal returns the
                  light source almost undiffused, so the highlight has a hard
                  little centre. One broad glow alone reads as satin. */}
              <radialGradient
                id={`${gradId}-hot`}
                gradientUnits="userSpaceOnUse"
                cx={-extent * 0.36}
                cy={-extent * 0.5}
                r={extent * 0.2}
              >
                <stop offset="0" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.5" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
              {/* Rim light along the lower edge: the floor bounce catching the
                  silhouette. It is what stops the bottom dissolving into the
                  dark background. */}
              <radialGradient
                id={`${gradId}-rim`}
                gradientUnits="userSpaceOnUse"
                cx={extent * 0.14}
                cy={extent * 0.82}
                r={extent * 0.68}
              >
                <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="0.9" stopColor="#E8EDF4" stopOpacity="0.42" />
                <stop offset="1" stopColor="#E8EDF4" stopOpacity="0" />
              </radialGradient>
            </>
          ) : (
            <radialGradient
              id={gradId}
              gradientUnits="userSpaceOnUse"
              cx={paint.cx}
              cy={paint.cy}
              r={paint.r}
              gradientTransform={scaled ? `scale(${paint.scaleX} ${paint.scaleY})` : undefined}
            >
              <stop offset="0" stopColor={ramp[0]} />
              <stop offset="0.38" stopColor={ramp[1]} />
              <stop offset="1" stopColor={ramp[2]} />
            </radialGradient>
          )}
          {S.bodyD ? (
            <clipPath id={clipId}>
              <path d={S.bodyD} />
            </clipPath>
          ) : null}
          {S.overlays.map((v) =>
            v.blur > 0 ? (
              <filter key={v.id} id={`uf-b-${gid}-${v.id}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation={v.blur} />
              </filter>
            ) : null
          )}
        </defs>
        <g transform={`translate(${size / 2} ${size / 2 - (S.hopY || 0) * size}) scale(${k})`}>
          <g transform={S.groupTransform}>
            {/* NONZERO winding: the depth rings union into one solid body. */}
            {S.bodyD && !(dots && !morphing) ? (
              <path d={S.bodyD} fill={`url(#${gradId})`} shapeRendering="geometricPrecision" />
            ) : null}
            {/* Specular. Clipped to the body so the highlight cannot spill off
                the silhouette, and drawn after the fill so it sits on top. */}
            {metal && S.bodyD && !(dots && !morphing) ? (
              <g clipPath={`url(#${clipId})`}>
                <path d={S.bodyD} fill={`url(#${gradId}-rim)`} />
                <path d={S.bodyD} fill={`url(#${gradId}-spec)`} />
                <path d={S.bodyD} fill={`url(#${gradId}-hot)`} />
              </g>
            ) : null}
            {/* The hairline self-stroke closes the gaps between depth slices. */}
            {S.bodyD && paint.seam !== false && !(dots && !morphing) ? (
              <path
                d={S.bodyD}
                fill="none"
                stroke={`url(#${gradId})`}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {S.bodyD && !(dots && !morphing) ? (
              <g clipPath={`url(#${clipId})`}>
                {S.texture.map((L, i) =>
                  L.d ? (
                    <path
                      key={`t${i}`}
                      d={L.d}
                      fill={L.fill}
                      stroke={L.stroke}
                      strokeWidth={L.width}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={L.op}
                    />
                  ) : null
                )}
                {S.overlays.map((v) => (
                  <path
                    key={v.id}
                    d={v.d}
                    fill={v.fill}
                    opacity={v.op}
                    filter={v.blur > 0 ? `url(#uf-b-${gid}-${v.id})` : undefined}
                  />
                ))}
                {dots ? null : eyePaths(S, cfg)}
              </g>
            ) : null}
          </g>
        </g>
        {dots ? <Dots size={size} fill={color.value} still={reduced} /> : null}
      </svg>
    );
  } catch {
    return blank;
  }
}

// Writing. Three dots where the eyes were, bobbing in turn — declarative SMIL,
// so a room full of typing bots still schedules no animation frames.
function Dots({ size, fill, still }) {
  const r = size * 0.09;
  const gap = size * 0.26;
  const cy = size * 0.5;
  return (
    <g fill={fill}>
      {[-1, 0, 1].map((i) => (
        <circle key={i} cx={size / 2 + i * gap} cy={cy} r={r} opacity={still ? 0.75 : 0.35}>
          {still ? null : (
            <>
              <animate
                attributeName="opacity"
                values="0.35;1;0.35"
                dur="1.05s"
                begin={`${(i + 1) * 0.14}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="cy"
                values={`${cy};${cy - size * 0.055};${cy}`}
                dur="1.05s"
                begin={`${(i + 1) * 0.14}s`}
                repeatCount="indefinite"
              />
            </>
          )}
        </circle>
      ))}
    </g>
  );
}
