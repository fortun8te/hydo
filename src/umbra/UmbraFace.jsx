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
import matcapChrome from "../kit/images/matcap-chrome.png";
import { SPIN_MS, spinCycle, spinStage, makeSpinState, easeYawToRest, easeInOutQuint, hash01 } from "./spin-turn.js";
import { POKE_MS, MAX_HOPS, pokeDuration, pokeFrame } from "./poke.js";
import { makeIdleState, idleStep } from "./idle.js";
import { glowPaint, GLOW_GEOM } from "./glow.js";

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

// Slowed variants of two engine motions.
//
// `scan` ships with 150ms "snappy" transitions and `nod` with 190ms. On a
// working face that snap is right; on a face that is just waiting for you to
// finish typing it reads as a flinch, and between them they were 41% of the
// idle cast. Same poses, three to four times the duration, smooth easing, and
// long holds so the pose actually lands before the next one starts.
function slowed(base, mult, hold) {
  const m = MOTION_BY_ID[base];
  if (!m) return MOTION_BY_ID.idle;
  return {
    ...m,
    id: `calm-${base}`,
    motionScale: (m.motionScale ?? 1) * 0.6,
    steps: (m.steps || []).map((st) => ({
      ...st,
      transition: "smooth",
      transitionMs: Math.round((st.transitionMs || 300) * mult),
      holdMs: Math.round((st.holdMs || 500) * hold),
    })),
  };
}

let CALM = null;
function calmMotions() {
  if (!CALM) {
    CALM = {
      calmScan: slowed("scan", 4.2, 2.4),
      calmNod: slowed("nod", 3.4, 2.8),
      calmSideEye: slowed("sideEye", 1.8, 2.2),
      calmYawn: slowed("yawn", 2.0, 2.0),
      calmCurious: slowed("curious", 2.4, 2.2),
    };
  }
  return CALM;
}

function motionFor(id) {
  if (id === "spin") return STEADY;
  const calm = calmMotions();
  if (calm[id]) return calm[id];
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

/**
 * Geometry detail, chosen from the size the face is actually drawn at.
 *
 * `detail` multiplies the mesh: meridians are `round(12 * detail)`, and the
 * rim resolution scales with it too. At 4 that is 48 meridians, and the path
 * string handed to the DOM every frame for ONE 36px avatar was measured at
 * ~133,000 characters. A 36px avatar cannot show 48 meridians. It is paying
 * for a mesh nobody can see, on every frame, on every face in the roster.
 *
 * Three levels rather than a continuous function, because `getGeometry`
 * caches on `shape|dense|detail` . a continuous one would build and keep a
 * separate mesh for every pixel size in the app.
 *
 * The big faces are untouched: the rail's 72px mark and the lab keep 4, which
 * is where the depth slices are actually visible.
 */
function detailFor(size) {
  const n = Number(size) || 0;
  if (n <= 48) return 2; // roster rows, composer marks, home cards
  if (n <= 96) return 3; // the bot rail's mark
  return 4; // the lab, and anything full-size
}

const DETAIL = 4;
const NO_DRAG = { x: 0, y: 0, active: false, vx: 0, vy: 0, lastX: 0, lastY: 0 };

const configCache = new Map();
function configFor(bodyColor, eyeColor, motionId, metal) {
  const key = bodyColor + "|" + eyeColor + "|" + motionId + (metal ? "|m" : "");
  let cfg = configCache.get(key);
  if (!cfg) {
    cfg = { ...BASE_CONFIG, bodyColor, eyeColor, motionId };
    if (metal) {
      // The matcap already contains every light in the scene. The engine's
      // own shine/shadow/gloss/rim render as extra <path> overlays AFTER the
      // body, so leaving them on painted a flat clay wash straight over the
      // material — which is why the metal looked like grey plastic even
      // though the texture was loading correctly.
      cfg.shine = 0;
      cfg.shadow = 0;
      cfg.gloss = 0;
      cfg.rim = 0;
    }
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

// `detail` is part of the KEY, not just a parameter: the cached rest frame is
// geometry, and one built at detail 2 must never be handed to a face drawing
// at detail 4.
function stillFrame(shapeId, motionId, detail = 4) {
  const key = shapeId + "|" + motionId + "|" + detail;
  let hit = stillCache.get(key);
  if (hit) return hit;
  const spec = cachedSpec(shapeId);
  const motion = motionFor(motionId);
  const cfg = { ...BASE_CONFIG, motionId, blink: false };
  const A = createAvatar(spec, motion, true, 4.3, detail);
  const f = svgFrame(computeFrame(A, 0, { config: cfg, style: EYE_STYLE_BY_ID.plain, topper: null, drag: NO_DRAG }));
  hit = { frame: f, extent: BOX_EXTENT, fit: fitExtentFor(spec) };
  stillCache.set(key, hit);
  return hit;
}

// -------------------------------------------------------------- on screen
//
// A face that nobody can see must not compute frames.
//
// One animated face is not cheap: computeFrame() + svgFrame() for the default
// body is ~3.3ms per frame, and the `d` it produces is ~130KB of path data
// (65 depth rings x ~192 vertices), which the browser then has to re-parse and
// re-tessellate. That is ~20% of the main thread for ONE face, so the number of
// faces actually running at any moment is the single biggest lever in the app.
//
// Faces go off screen constantly and none of it is visible: a channel where
// five teammates are working puts a spinning face on every one of their
// messages, and the transcript scrolls, so most of them are above the fold.
// The roster does the same when the sidebar is scrolled or collapsed.
//
// Defaults to ON, so a face still animates where there is no IntersectionObserver
// (tests, jsdom, an old runtime) rather than silently freezing. `rootMargin`
// keeps a face just past the edge running, so scrolling never reveals a mark
// that has to start up.

const SEEN_MARGIN = "220px";

// ONE observer for every face, not one each — the same reason there is one rAF
// above. A roster plus a channel transcript is easily 60+ marks, and 60
// IntersectionObservers is 60 sets of bookkeeping the browser runs on every
// scroll for an answer they could all share.
const seenFns = new WeakMap();
let seenIO = null;

function watchSeen(el, fn) {
  if (!el || typeof IntersectionObserver !== "function") return () => {};
  if (!seenIO) {
    seenIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const cb = seenFns.get(e.target);
          if (cb) cb(e.isIntersecting);
        }
      },
      { rootMargin: SEEN_MARGIN }
    );
  }
  seenFns.set(el, fn);
  seenIO.observe(el);
  return () => {
    seenFns.delete(el);
    if (seenIO) seenIO.unobserve(el);
  };
}

/**
 * Whether this face is anywhere near the viewport.
 *
 * Defaults to TRUE and only ever moves on a real observation, so every path
 * that cannot observe — no IntersectionObserver, a test renderer, a document
 * whose observations are suspended because it is hidden — leaves the face
 * animating exactly as it did before. Being wrong in that direction costs
 * frames; being wrong in the other direction freezes a mark the user is
 * looking at.
 */
function useOnScreen() {
  const [seen, setSeen] = useState(true);
  const [el, setEl] = useState(null);
  useEffect(() => watchSeen(el, setSeen), [el]);
  // A callback ref, not an object ref: this component renders TWO different
  // <svg> roots (the blank one and the real one) and an object ref with a
  // `[ref]` effect keeps observing whichever element happened to commit first,
  // even after that element is gone from the DOM. The callback fires on every
  // swap, so the observer always watches the node actually on screen.
  return [seen, setEl];
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
// A MATCAP, not a hand-tuned gradient.
//
// Five previous attempts built the reflection out of stops by hand and every
// one of them read as a decal, for the same reason each time: a gradient is a
// function of POSITION, and a reflection is a function of the surface NORMAL.
// No amount of moving stops closes that gap.
//
// `matcap-chrome.png` is a rendered sphere (scripts/make-matcap.cjs): for each
// pixel, take the sphere normal, reflect the view vector off it, look up what
// that ray sees in a studio environment, and apply Schlick Fresnel. Because
// it is indexed by normal, projecting it onto a convex body is not an
// approximation of a reflection, it IS one. The horizon curves with the form,
// the rim goes bright at grazing angles, the highlight sits where the light
// actually is, and all of it comes free.
//
// Generated rather than downloaded: the public matcap libraries state that
// their textures "were obtained from various websites", which is not a
// licence.
//
// The mapping below is the honest limitation. A true matcap needs a real
// normal per pixel; the engine hands the paint layer a flat 2D silhouette, so
// the sphere is fitted to the body's own extent and clipped to its outline.
// For these rounded bodies that is very close. On a sharply concave shape it
// would not be.

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
// The body/dots trade. Shorter than a shape morph on purpose: this one fires
// every time a teammate starts and stops writing, so it has to read as a beat
// rather than an event.
const DOTS_MS = 340;
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

function useLiveFrame(shapeId, motionId, cfg, active, stagger, morphRef, pokeRef, idleSeed = 0, size = 64) {
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
        avatarRef.current = createAvatar(spec, first, true, 4.3, detailFor(size));
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
          if (beat.kind !== fidgetShown && now - lastPlay > 240) {
            const m = motionFor(beat.kind);
            if (m) {
              fidgetShown = beat.kind;
              lastPlay = now;
              play(avatarRef.current, m);
            }
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
            avatarRef.current = createAvatar(cachedSpec(showId), motionFor(motionRef.current), true, 4.3, detailFor(size));
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
  }, [active, shapeId, stagger, idleSeed, size]);

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
  // Opt-in, and off everywhere it is not asked for: a face without `glow` must
  // render the exact paths it rendered before this prop existed.
  glow = false,
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
  const [dotsPhase, setDotsPhase] = useState(null);
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

  // Body <-> dots, both directions.
  //
  // This used to bail on `!dots`, so becoming the dots was animated and coming
  // back was a hard cut: the dots blinked out and the body popped in at full
  // size. And the dots were mounted the moment `dots` went true, on top of a
  // body that was still there for the whole morph, so the two overlapped
  // instead of trading places.
  //
  // `dotsPhase` is what both halves key off: it outlives `dots` going false,
  // which is what keeps the body's return animatable at all.
  useEffect(() => {
    if (dots === wasDots.current) return undefined;
    wasDots.current = dots;
    if (reduced) return undefined;
    morphRef.current = pickMorph(shapeId, shapeId);
    setMorphing(true);
    setDotsPhase(dots ? "in" : "out");
    const t = setTimeout(() => {
      setMorphing(false);
      setDotsPhase(null);
    }, DOTS_MS);
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

  const isChrome = isMetal(tint);
  // Chrome is excluded on purpose. The matcap already contains every light in
  // the scene, so lighting it again is the same mistake that made metal look
  // like grey plastic (see configFor).
  const lit = glow && !isChrome;
  const glowInk = useMemo(() => (lit ? glowPaint(color) : null), [lit, color]);
  const cfg = useMemo(
    () => configFor(color.value, color.ink, motionId, isChrome),
    [color.value, color.ink, motionId, isChrome]
  );

  // `stagger` is a low-discrepancy sequence on purpose: it spreads SPIN phase
  // evenly so a roster of working bots never turns in unison.
  const [stagger] = useState(() => (seq * 0.37) % 1);
  // The idle seed is the opposite — genuinely random per mount. An even spread
  // here would mean two bots' waiting rhythms stayed a fixed distance apart
  // for the life of the app, which is exactly the artificial regularity the
  // aperiodic scheduler exists to kill.
  const [idleSeed] = useState(() => Math.random() * 1000);
  const [onScreen, hostRef] = useOnScreen();
  const liveFrame = useLiveFrame(
    shapeId,
    motionId,
    cfg,
    !still && onScreen,
    stagger,
    morphRef,
    pokeRef,
    idleSeed,
    // `size` picks the tessellation detail. It used to be read here as a free
    // variable that did not exist, so `detailFor(size)` threw a ReferenceError
    // into the effect's own `catch`, which answered by setting the frame to
    // null. Every face fell back to its rest frame and the whole app's
    // animation was off, with no error anywhere. Passing it is the fix.
    size
  );
  // NOT useId(): two React roots on one page both start their ids at r0, and a
  // duplicate <radialGradient id> means url(#...) resolves to whichever face
  // mounted first — every avatar wearing the first one's colour. A process-wide
  // counter cannot collide.
  const [gid] = useState(nextId);

  const body = useMemo(() => {
    try {
      const spec = cachedSpec(shapeId);
      const rest = stillFrame(shapeId, motionId, detailFor(size));
      return { spec, paint: bodyPaint(cfg, spec), rest };
    } catch {
      return null;
    }
  }, [shapeId, motionId, cfg]);

  const cls = `umbra-face ${className}`.trim();
  const blank = (
    <svg
      ref={hostRef}
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
    // When the face is paused (still, or scrolled out of sight) it shows its
    // cached rest frame — the same one an idle face has always shown — so a
    // paused face is a calm mark, never a body frozen mid-spin.
    const S = (!still && onScreen && liveFrame) || body.rest.frame;
    const extent = fit ? body.rest.fit || body.rest.extent : body.rest.extent;
    const k = size / (extent * 2);
    const paint = body.paint;
    const ramp = S.ramp ? [S.ramp.light, S.ramp.mid, S.ramp.dark] : [paint.light, paint.mid, paint.dark];
    const clipId = `uf-clip-${gid}`;
    const gradId = `uf-grad-${gid}`;
    const coreId = `uf-core-${gid}`;
    const haloId = `uf-halo-${gid}`;
    const scaled = paint.scaleX !== 1 || paint.scaleY !== 1;
    const metal = isChrome;
    // The body's OWN radii, not a single extent. `spec.er` is what the engine
    // uses to size this silhouette, so a wedge and a teardrop get reflections
    // shaped like themselves rather than one circle stretched over both.
    const er = body.spec && body.spec.er;
    const erx = typeof er === "number" ? er : (er && er.x) || extent;
    const ery = typeof er === "number" ? er : (er && er.y) || extent;
    const metalR = Math.max(erx, ery) || extent;
    const metalSX = metalR ? erx / metalR : 1;
    const metalSY = metalR ? ery / metalR : 1;

    return (
      <svg
        ref={hostRef}
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
              {/* Nothing to define: the material is an image. A flat fill is
                  kept only so `bodyD` has something to paint when the frame
                  has no image yet. */}
              <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={0} y1={-extent} x2={0} y2={extent}>
                <stop offset="0" stopColor="#C8CFD8" />
                <stop offset="1" stopColor="#6E7681" />
              </linearGradient>
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
          {glowInk ? (
            <>
              {/* Two static gradients, no filter. See glow.js for why the
                  icon's three blur passes are not reproduced literally. */}
              <radialGradient
                id={coreId}
                gradientUnits="userSpaceOnUse"
                cx={0}
                cy={extent * GLOW_GEOM.coreY}
                r={extent * GLOW_GEOM.coreR}
              >
                {glowInk.core.map((st) => (
                  <stop key={st.offset} offset={st.offset} stopColor={st.color} stopOpacity={st.opacity} />
                ))}
              </radialGradient>
              <radialGradient
                id={haloId}
                gradientUnits="userSpaceOnUse"
                cx={0}
                cy={extent * GLOW_GEOM.haloY}
                r={extent * GLOW_GEOM.haloR}
              >
                {glowInk.halo.map((st) => (
                  <stop key={st.offset} offset={st.offset} stopColor={st.color} stopOpacity={st.opacity} />
                ))}
              </radialGradient>
            </>
          ) : null}
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
        <g className={dotsPhase ? `uf-body is-${dotsPhase}` : undefined}>
        <g transform={`translate(${size / 2} ${size / 2 - (S.hopY || 0) * size}) scale(${k})`}>
          <g transform={S.groupTransform}>
            {/* The light the body throws into whatever it is sitting on. A
                plain circle, not the silhouette: at this blur radius the shape
                of the source is not readable anyway, and reusing `bodyD` here
                would mean a third tessellation of a ~130KB path per frame.
                .umbra-face is overflow:visible, so it may spill past the box. */}
            {glowInk && !(dots && !dotsPhase) ? (
              <circle
                className="uf-glow-halo"
                cx={0}
                cy={extent * GLOW_GEOM.haloY}
                r={extent * GLOW_GEOM.haloR}
                fill={`url(#${haloId})`}
              />
            ) : null}
            {/* NONZERO winding: the depth rings union into one solid body. */}
            {S.bodyD && !(dots && !dotsPhase) ? (
              <path
                d={S.bodyD}
                fill={glowInk ? glowInk.rim : `url(#${gradId})`}
                shapeRendering="geometricPrecision"
              />
            ) : null}
            {/* The hairline self-stroke closes the gaps between depth slices. */}
            {S.bodyD && paint.seam !== false && !(dots && !dotsPhase) ? (
              <path
                d={S.bodyD}
                fill="none"
                stroke={glowInk ? glowInk.rim : `url(#${gradId})`}
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {S.bodyD && !(dots && !dotsPhase) ? (
              <g clipPath={`url(#${clipId})`}>
                {/* White body first, THEN the tint laid back into its middle —
                    the icon's order, and the whole reason the rim comes out
                    bright without anyone drawing an outline. */}
                {glowInk ? <path d={S.bodyD} fill={`url(#${coreId})`} /> : null}
                {metal ? null : S.texture.map((L, i) =>
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
                {metal ? null : S.overlays.map((v) => (
                  <path
                    key={v.id}
                    d={v.d}
                    fill={v.fill}
                    opacity={v.op}
                    filter={v.blur > 0 ? `url(#uf-b-${gid}-${v.id})` : undefined}
                  />
                ))}
                {/* Chrome. A matcap — a photograph of a lit sphere, looked up by
                    surface normal — fitted to the body's extent and clipped to
                    its outline. It must be the LAST body layer: the depth-slice
                    texture above is opaque body colour and painted straight
                    over it, which is why chrome read as flat grey. It replaces
                    that shading rather than sitting under it, because a mirror
                    has no diffuse term of its own to shade. */}
                {metal ? (
                  <image
                    href={matcapChrome}
                    x={-extent}
                    y={-extent}
                    width={extent * 2}
                    height={extent * 2}
                    preserveAspectRatio="none"
                  />
                ) : null}
                {dots ? null : eyePaths(S, cfg)}
              </g>
            ) : null}
          </g>
        </g>
        </g>
        {dots || dotsPhase === "out" ? (
          <Dots size={size} fill={color.value} still={reduced} phase={dotsPhase} />
        ) : null}
      </svg>
    );
  } catch {
    return blank;
  }
}

// Writing. Three dots where the eyes were, bobbing in turn — declarative SMIL,
// so a room full of typing bots still schedules no animation frames.
function Dots({ size, fill, still, phase }) {
  const r = size * 0.09;
  const gap = size * 0.26;
  const cy = size * 0.5;
  return (
    <g fill={fill} className={phase ? `uf-dots is-${phase}` : undefined}>
      {[-1, 0, 1].map((i) => (
        <circle
          key={i}
          cx={size / 2 + i * gap}
          cy={cy}
          r={r}
          opacity={still ? 0.75 : 0.35}
          // Left to right on the way in, right to left on the way out, so the
          // pair reads as one gesture reversing rather than two animations.
          style={phase ? { animationDelay: `${(phase === "in" ? i + 1 : 1 - i) * 42}ms` } : undefined}
        >
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
