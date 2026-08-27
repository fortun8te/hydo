var GHOSTPTS = (() => {
  const p = [];
  for (let a = 180; a >= 0; a -= 22.5) {
    const r = a * Math.PI / 180;
    p.push([88 * Math.cos(r), -28 - 88 * Math.sin(r)]);
  }
  p.push(
    [87, 8],
    [82, 44],
    [70, 80],
    [50, 100],
    [26, 66],
    [0, 103],
    [-26, 66],
    [-50, 100],
    [-70, 80],
    [-82, 44],
    [-87, 8]
  );
  return p;
})();
function flattenCR(P, steps) {
  const n = P.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = P[(i + n - 1) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    for (let j = 0; j < steps; j++) {
      const s = j / steps, u = 1 - s;
      const a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, d = s * s * s;
      out.push([
        a * p1[0] + b * c1x + c * c2x + d * p2[0],
        a * p1[1] + b * c1y + c * c2y + d * p2[1]
      ]);
    }
  }
  return out;
}
var ghostSteps = (detail) => Math.max(3, Math.round(3 * detail));
function ghostRim(detail) {
  return flattenCR(GHOSTPTS, ghostSteps(detail));
}
var GLIDE_CYCLE_MS = 1e4;
var GLIDE_KEYS = [
  [0, 1400, 0, -1],
  [1400, 4200, -1, 1],
  [4200, 7e3, 1, -1],
  [7e3, 8600, -1, 0]
];
var io = (p) => p * p * (3 - 2 * p);
function glideX(t) {
  const c = (t % GLIDE_CYCLE_MS + GLIDE_CYCLE_MS) % GLIDE_CYCLE_MS;
  for (const [t0, t1, a, b] of GLIDE_KEYS) {
    if (c < t1) {
      const p = Math.min(Math.max((c - t0) / (t1 - t0), 0), 1);
      return a + (b - a) * io(p);
    }
  }
  return 0;
}
function glideV(t) {
  const c = (t % GLIDE_CYCLE_MS + GLIDE_CYCLE_MS) % GLIDE_CYCLE_MS;
  for (const [t0, t1, a, b] of GLIDE_KEYS) {
    if (c < t1) {
      const L = t1 - t0;
      const u = Math.min(Math.max((c - t0) / L, 0), 1);
      return (b - a) * 6 * u * (1 - u) / L;
    }
  }
  return 0;
}
var GLIDE_LEAN_GAIN = 18;
function glideLeanTarget(t, travel) {
  const v = glideV(t) * travel;
  return Math.min(Math.max(v * GLIDE_LEAN_GAIN, -1), 1);
}
var GLIDE_LAG = 0.027395522883651657;
var GLIDE_SUBSTEP_MS = 1e3 / 240;
var GLIDE_DEADZONE = 4e-3;
var GLIDE_BOB_AMP = 3.5;
var GLIDE_BOB_RATE = 16e-4;
var GLIDE_LEAN_DEG = 4;
var GLIDE_EYE_SLIDE = 33;
var GLIDE_FADE_MS = 320;
function ghostSkirt(P, k, t, w = 1) {
  const ak = Math.abs(k);
  const out = [];
  for (const p of P) {
    let px = p[0], py = p[1];
    const d2 = Math.max(0, py + 28) / 131;
    px -= k * 54 * Math.pow(d2, 1.25) * w;
    if (py > 40) {
      const wf = (py - 40) / 63;
      const ph = t * 0.011 + p[0] * 0.05;
      py += (3.5 + 9 * ak) * Math.sin(ph) * wf * w;
      px += (2 + 7 * ak) * Math.sin(ph + 0.9) * wf * w;
      if (k !== 0) py -= ak * 0.3 * Math.max(0, -Math.sign(k) * px - 20) * wf * w;
    }
    out.push([px, py]);
  }
  return out;
}
function ghostRimDeformed(detail, k, t, w = 1) {
  return flattenCR(ghostSkirt(GHOSTPTS, k, t, w), ghostSteps(detail));
}
var DEG = Math.PI / 180;
var scale = (n, detail) => Math.max(3, Math.round(n * detail));
function polar(fn, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = i / n * Math.PI * 2;
    const r = fn(th);
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  return pts;
}
function roundedPoly(sides, R2, cr, rot2, detail = 1) {
  const arcN = scale(6, detail);
  const vs = [];
  for (let i = 0; i < sides; i++) {
    const a = rot2 + i / sides * Math.PI * 2;
    vs.push([R2 * Math.cos(a), R2 * Math.sin(a)]);
  }
  const t = cr / Math.tan(Math.PI * (sides - 2) / (2 * sides));
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const v = vs[i], pv = vs[(i + sides - 1) % sides], nv = vs[(i + 1) % sides];
    const din = [v[0] - pv[0], v[1] - pv[1]], lin = Math.sqrt(din[0] * din[0] + din[1] * din[1]);
    const dout = [nv[0] - v[0], nv[1] - v[1]], lout = Math.sqrt(dout[0] * dout[0] + dout[1] * dout[1]);
    const p1 = [v[0] - din[0] / lin * t, v[1] - din[1] / lin * t];
    const p2 = [v[0] + dout[0] / lout * t, v[1] + dout[1] / lout * t];
    pts.push(p1);
    for (let k = 1; k < arcN; k++) {
      const u = k / arcN;
      const bx = p1[0] + (p2[0] - p1[0]) * u, by = p1[1] + (p2[1] - p1[1]) * u;
      const bl = Math.sqrt(bx * bx + by * by) || 1;
      const target = Math.sqrt(p1[0] * p1[0] + p1[1] * p1[1]);
      const bulge = target + (Math.sqrt(v[0] * v[0] + v[1] * v[1]) - target) * Math.sin(u * Math.PI) * 0.45;
      pts.push([bx / bl * bulge, by / bl * bulge]);
    }
    pts.push(p2);
  }
  return pts;
}
var se = (a, n) => (th) => a / Math.pow(
  Math.pow(Math.abs(Math.cos(th)), n) + Math.pow(Math.abs(Math.sin(th)), n),
  1 / n
);
var lobes = (n, d, pr, rot2, core) => (th) => {
  let m = core;
  for (let k = 0; k < n; k++) {
    const a = th - (rot2 + k / n * Math.PI * 2);
    const s = d * Math.sin(a), c = d * Math.cos(a);
    const disc2 = pr * pr - s * s;
    if (disc2 <= 0) continue;
    const r = c + Math.sqrt(disc2);
    if (r > m) m = r;
  }
  return m;
};
function shapePoints(kind, args, detail = 1) {
  const N = (n) => scale(n, detail);
  if (kind === "sun") {
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const th = i / 24 * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 106 : 80;
      pts.push([r * Math.cos(th), r * Math.sin(th)]);
    }
    return pts;
  }
  if (kind === "flower") return polar(lobes(5, 56, 50, -Math.PI / 2, 46), N(120));
  if (kind === "clover") return polar(lobes(4, 54, 52, -Math.PI / 4, 48), N(120));
  if (kind === "heart") {
    const hN = N(96);
    let pts = [];
    for (let i = 0; i < hN; i++) {
      const t = i / hN * Math.PI * 2;
      const x = 16 * Math.pow(Math.sin(t), 3) * 6.8;
      const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 6.8 + 10;
      pts.push([x, y]);
    }
    for (let pass = 0; pass < 2; pass++) {
      const n = pts.length, next = [];
      for (let i = 0; i < n; i++) {
        const a = pts[(i + n - 1) % n], b = pts[i], c = pts[(i + 1) % n];
        next.push([
          a[0] * 0.25 + b[0] * 0.5 + c[0] * 0.25,
          a[1] * 0.25 + b[1] * 0.5 + c[1] * 0.25
        ]);
      }
      pts = next;
    }
    return pts;
  }
  if (kind === "hexagon") return roundedPoly(6, 104, 20, -Math.PI / 2, detail);
  if (kind === "triangle") return roundedPoly(3, 118, 24, -Math.PI / 2, detail);
  if (kind === "ghost") {
    return ghostRim(detail);
  }
  if (kind === "arch") {
    const aN = N(22);
    const pts = [[-84, 104]];
    for (let i = 0; i <= aN; i++) {
      const a = Math.PI - i / aN * Math.PI;
      pts.push([84 * Math.cos(a), -14 - 84 * Math.sin(a)]);
    }
    pts.push([84, 104], [78, 111], [-78, 111]);
    return pts;
  }
  if (kind === "squircle") return polar(se(96, 4), N(56));
  if (kind === "blob")
    return polar(
      (th) => se(92, 3.2)(th) * (1 + 0.055 * Math.sin(5 * th + 1.7) + 0.04 * Math.sin(3 * th + 0.4)),
      N(64)
    );
  if (kind === "cloud") return polar(lobes(3, 46, 58, -Math.PI / 2, 50), N(110));
  // "rim": caller supplies the outline directly as points centred on (0,0).
  // Lets Grok's own body silhouettes drive this engine instead of the
  // engine's built-in primitives. See src/umbra/rims.js.
  if (kind === "rim" && Array.isArray(args && args.pts) && args.pts.length > 7) {
    return args.pts;
  }
  if (kind === "ellipse") {
    const a = args.a, b = args.b;
    return polar(
      (th) => a * b / Math.sqrt(Math.pow(b * Math.cos(th), 2) + Math.pow(a * Math.sin(th), 2)),
      N(56)
    );
  }
  return polar(() => 100, N(56));
}
function buildRings(rim, depth, dense, detail = 1) {
  const levels = ringLevels(dense, detail);
  const step = Math.max(1, Math.ceil(rim.length / (64 * detail)));
  const base = [];
  for (let i = 0; i < rim.length; i += step) base.push(rim[i]);
  return levels.map((u) => {
    const c = Math.sqrt(Math.max(0, 1 - u * u));
    const z = depth * u;
    return base.map((p) => [p[0] * c, p[1] * c, z]);
  });
}
function ringLevels(dense, detail) {
  if (detail <= 1) {
    return dense ? [
      0,
      0.17,
      -0.17,
      0.32,
      -0.32,
      0.45,
      -0.45,
      0.57,
      -0.57,
      0.68,
      -0.68,
      0.78,
      -0.78,
      0.87,
      -0.87,
      0.94,
      -0.94
    ] : [0, 0.24, -0.24, 0.45, -0.45, 0.62, -0.62, 0.78, -0.78, 0.91, -0.91];
  }
  const n = Math.max(2, Math.round((dense ? 8 : 5) * detail));
  const out = [0];
  for (let k = 1; k <= n; k++) {
    const u = Math.sin(k / n * 70 * DEG);
    out.push(u, -u);
  }
  return out;
}
function meridianLevels(detail) {
  if (detail <= 1) {
    return [
      -0.97,
      -0.9,
      -0.8,
      -0.68,
      -0.54,
      -0.38,
      -0.2,
      0,
      0.2,
      0.38,
      0.54,
      0.68,
      0.8,
      0.9,
      0.97
    ];
  }
  const n = Math.max(3, Math.round(7 * detail));
  const out = [];
  for (let k = n; k >= 1; k--) out.push(-Math.sin(k / n * 76 * DEG));
  out.push(0);
  for (let k = 1; k <= n; k++) out.push(Math.sin(k / n * 76 * DEG));
  return out;
}
function radiusTable(rim, n) {
  const tab = new Float64Array(n), m = rim.length;
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let best = 0;
    for (let i = 0; i < m; i++) {
      const p = rim[i], q = rim[(i + 1) % m];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (p[0] * ey - p[1] * ex) / den;
      const s = (p[0] * dy - p[1] * dx) / den;
      if (t > best && s >= -1e-6 && s <= 1 + 1e-6) best = t;
    }
    tab[k] = best;
  }
  return tab;
}
function buildMeridians(tab, depth, count, detail = 1) {
  const us = meridianLevels(detail);
  const n = tab.length;
  const at = (a) => {
    let x = a / (Math.PI * 2) * n;
    x = (x % n + n) % n;
    const i = Math.floor(x), f = x - i, A = tab[i], B = tab[(i + 1) % n];
    return A + (B - A) * f;
  };
  const out = [];
  for (let k = 0; k < count; k++) {
    const al = k / count * Math.PI, ca = Math.cos(al), sa = Math.sin(al);
    const r1 = at(al), r2 = at(al + Math.PI);
    const loop = [[0, 0, -depth]];
    for (let i = 0; i < us.length; i++) {
      const u = us[i], c = Math.sqrt(1 - u * u);
      loop.push([r1 * c * ca, r1 * c * sa, depth * u]);
    }
    loop.push([0, 0, depth]);
    for (let i = us.length - 1; i >= 0; i--) {
      const u = us[i], c = Math.sqrt(1 - u * u);
      loop.push([-r2 * c * ca, -r2 * c * sa, depth * u]);
    }
    out.push(loop);
  }
  return out;
}
var EYE_N = 60;
var D = Math.PI / 180;
var TAU = Math.PI * 2;
var outlineCache =  new Map();
function outline(w, h) {
  const key = w + "|" + h;
  const hit = outlineCache.get(key);
  if (hit) return hit;
  const a = Math.max(w, 0.4) / 2, b = Math.max(h, 0.4) / 2, Rr = Math.min(a, b);
  const sx = a - Rr, sy = b - Rr, arc = Math.PI / 2 * Rr;
  const segs = [
    { len: sy, f: (t) => [a, t] },
    {
      len: arc,
      f: (t) => {
        const u = t / Rr;
        return [sx + Rr * Math.cos(u), sy + Rr * Math.sin(u)];
      }
    },
    { len: 2 * sx, f: (t) => [sx - t, b] },
    {
      len: arc,
      f: (t) => {
        const u = t / Rr + Math.PI / 2;
        return [-sx + Rr * Math.cos(u), sy + Rr * Math.sin(u)];
      }
    },
    { len: 2 * sy, f: (t) => [-a, sy - t] },
    {
      len: arc,
      f: (t) => {
        const u = t / Rr + Math.PI;
        return [-sx + Rr * Math.cos(u), -sy + Rr * Math.sin(u)];
      }
    },
    { len: 2 * sx, f: (t) => [-sx + t, -b] },
    {
      len: arc,
      f: (t) => {
        const u = t / Rr + Math.PI * 1.5;
        return [sx + Rr * Math.cos(u), -sy + Rr * Math.sin(u)];
      }
    },
    { len: sy, f: (t) => [a, -sy + t] }
  ];
  let P = 0;
  for (const s of segs) P += s.len;
  const pts = new Array(EYE_N);
  let si = 0, acc = 0;
  for (let i = 0; i < EYE_N; i++) {
    const d = i / EYE_N * P;
    while (si < segs.length - 1 && d > acc + segs[si].len) {
      acc += segs[si].len;
      si++;
    }
    pts[i] = segs[si].f(Math.max(0, d - acc));
  }
  if (outlineCache.size > 400) outlineCache.clear();
  outlineCache.set(key, pts);
  return pts;
}
function profile(fn) {
  const p = new Float64Array(EYE_N);
  let m = 0;
  for (let i = 0; i < EYE_N; i++) {
    const v = fn(i / EYE_N * TAU);
    p[i] = v;
    if (v > m) m = v;
  }
  for (let i = 0; i < EYE_N; i++) p[i] /= m || 1;
  return p;
}
function poly(verts) {
  const vs = verts.map((v) => [v[0], (v[1] * D % TAU + TAU) % TAU]).sort((x, y) => x[1] - y[1]);
  const m = vs.length;
  return profile((th) => {
    const t = (th % TAU + TAU) % TAU;
    let i = 0;
    while (i < m && vs[i][1] <= t) i++;
    const v1 = vs[(i - 1 + m) % m], v2 = vs[i % m];
    let t1 = v1[1], t2 = v2[1], tt = t;
    if (t2 <= t1) t2 += TAU;
    if (tt < t1) tt += TAU;
    const den = v1[0] * Math.sin(tt - t1) + v2[0] * Math.sin(t2 - tt);
    return Math.abs(den) < 1e-9 ? v1[0] : v1[0] * v2[0] * Math.sin(t2 - t1) / den;
  });
}
function spike(n, ro, ri, rot2) {
  const v = [];
  for (let k = 0; k < n; k++) {
    v.push([ro, rot2 + k * 360 / n]);
    v.push([ri, rot2 + (k + 0.5) * 360 / n]);
  }
  return poly(v);
}
function cart(pts, rot2) {
  return poly(
    pts.map((p) => {
      const a = Math.atan2(p[1], p[0]) / D + (rot2 || 0);
      return [Math.sqrt(p[0] * p[0] + p[1] * p[1]), a];
    })
  );
}
function plusProfile(t) {
  return cart(
    [
      [t, -1],
      [t, -t],
      [1, -t],
      [1, t],
      [t, t],
      [t, 1],
      [-t, 1],
      [-t, t],
      [-1, t],
      [-1, -t],
      [-t, -t],
      [-t, -1]
    ],
    0
  );
}
function heartProfile() {
  const rim = [];
  for (let i = 0; i < 200; i++) {
    const t = i / 200 * TAU;
    rim.push([
      16 * Math.pow(Math.sin(t), 3),
      -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) - 7.4
    ]);
  }
  const tab = radiusTable(rim, EYE_N);
  let m = 0;
  for (let i = 0; i < EYE_N; i++) if (tab[i] > m) m = tab[i];
  const p = new Float64Array(EYE_N);
  for (let i = 0; i < EYE_N; i++) p[i] = tab[i] / m;
  return p;
}
var COS = new Float64Array(EYE_N);
var SIN = new Float64Array(EYE_N);
for (let i = 0; i < EYE_N; i++) {
  const th = i / EYE_N * TAU;
  COS[i] = Math.cos(th);
  SIN[i] = Math.sin(th);
}
function toPts(prof) {
  const a = new Array(EYE_N);
  for (let i = 0; i < EYE_N; i++) a[i] = [prof[i] * COS[i], prof[i] * SIN[i]];
  return a;
}
function dome(flip) {
  const arcN = 42, edgeN = EYE_N - arcN, pts = [];
  for (let i = 0; i < arcN; i++) {
    const a = i / (arcN - 1) * Math.PI;
    pts.push([Math.cos(a), (flip ? -1 : 1) * Math.sin(a) - 0.5 * (flip ? -1 : 1)]);
  }
  for (let i = 1; i <= edgeN; i++) {
    const t = i / (edgeN + 1);
    pts.push([-1 + 2 * t, -0.5 * (flip ? -1 : 1)]);
  }
  return pts;
}
function rot(pts, deg) {
  const a = deg * D, c = Math.cos(a), s = Math.sin(a);
  return pts.map((p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
}
function lid(bcx, bbow, tcx, tbow) {
  const pts = [];
  const bez = (p0, c, p1, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([
        u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
        u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]
      ]);
    }
  };
  bez([1, 0], [bcx, bbow], [-1, 0], EYE_N / 2);
  bez([-1, 0], [tcx, tbow], [1, 0], EYE_N / 2);
  return pts;
}
function qbez(a, c, b, n, out) {
  for (let i = 0; i < n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]
    ]);
  }
}
function heroLens(T, C1, P1, C2, P2, C3) {
  const p = [];
  qbez(T, C1, P1, 20, p);
  qbez(P1, C2, P2, 20, p);
  qbez(P2, C3, T, 20, p);
  for (let pass = 0; pass < 2; pass++) {
    const n2 = p.length, sm = p.slice();
    for (let i = 2; i < n2 - 2; i++) {
      const a = p[i - 1], b = p[i], c2 = p[i + 1];
      sm[i] = [
        a[0] * 0.25 + b[0] * 0.5 + c2[0] * 0.25,
        a[1] * 0.25 + b[1] * 0.5 + c2[1] * 0.25
      ];
    }
    for (let i = 0; i < n2; i++) p[i] = sm[i];
  }
  return p;
}
var mirrorRev = (L) => L.map((q) => [-q[0], q[1]]).reverse();
var EYEUNIT = {
  star: toPts(spike(5, 1, 0.44, -90)),
  sparkle: toPts(spike(4, 1, 0.2, -90)),
  diamond: toPts(
    poly([
      [1, -90],
      [0.66, 0],
      [1, 90],
      [0.66, 180]
    ])
  ),
  gem: toPts(
    poly([
      [1, -90],
      [1, -30],
      [1, 30],
      [1, 90],
      [1, 150],
      [1, 210]
    ])
  ),
  wedge: toPts(
    poly([
      [1, -90],
      [0.94, 30],
      [0.42, 90],
      [0.94, 150]
    ])
  ),
  cross: toPts(
    cart(
      [
        [0.3, -1],
        [0.3, -0.3],
        [1, -0.3],
        [1, 0.3],
        [0.3, 0.3],
        [0.3, 1],
        [-0.3, 1],
        [-0.3, 0.3],
        [-1, 0.3],
        [-1, -0.3],
        [-0.3, -0.3],
        [-0.3, -1]
      ],
      45
    )
  ),
  plus: toPts(plusProfile(0.32)),
  flower: toPts(profile((th) => 0.74 + 0.26 * Math.cos(5 * (th + Math.PI / 2)))),
  lens: toPts(profile((th) => 1 / (1 + 2.1 * Math.abs(Math.sin(th))))),
  heart: toPts(heartProfile()),
  ball: toPts(profile(() => 1)),
  dome: dome(false),
  domeUp: dome(true),
  lidL: rot(dome(false), -20),
  lidR: rot(dome(false), 20),
  bar: outline(2, 0.66).map((p) => [p[0], p[1]]),
  egg: toPts(profile((th) => 1 + 0.26 * Math.sin(th))),
  sqr: toPts(
    profile(
      (th) => Math.pow(
        Math.pow(Math.abs(Math.cos(th)), 4) + Math.pow(Math.abs(Math.sin(th)), 4),
        -0.25
      )
    )
  ),
  beanL: toPts(profile((th) => 1 - 0.62 * Math.pow(Math.max(0, Math.cos(th)), 1.3))),
  beanR: toPts(profile((th) => 1 - 0.62 * Math.pow(Math.max(0, -Math.cos(th)), 1.3))),
  dropL: toPts(profile((th) => Math.pow(Math.abs(Math.cos(th / 2)), 0.5))),
  dropR: toPts(profile((th) => Math.pow(Math.abs(Math.sin(th / 2)), 0.5))),
  tri: toPts(
    poly([
      [1, 90],
      [1, 210],
      [1, 330]
    ])
  ),
  hexV: toPts(
    poly([
      [1, -90],
      [0.82, -25],
      [0.82, 25],
      [1, 90],
      [0.82, 155],
      [0.82, 205]
    ])
  ),
  lensV: rot(toPts(profile((th) => 1 / (1 + 2.1 * Math.abs(Math.sin(th))))), 90),
  blobL: rot(toPts(profile((th) => Math.pow(Math.abs(Math.cos(th / 2)), 0.5))), -38),
  blobR: rot(toPts(profile((th) => Math.pow(Math.abs(Math.sin(th / 2)), 0.5))), 38),
  swooshL: lid(0.22, 1.5, 0.52, -0.5),
  swooshR: lid(-0.22, 1.5, -0.52, -0.5),
  swoopL: lid(0.52, 0.5, 0.22, -1.5),
  swoopR: lid(-0.52, 0.5, -0.22, -1.5),
  visorL: lid(0.1, 1.15, -0.2, -0.72),
  visorR: lid(-0.1, 1.15, 0.2, -0.72),
  fangL: lid(0.02, 1.34, -0.62, -0.16),
  fangR: lid(-0.02, 1.34, 0.62, -0.16),
  heroL1: heroLens([1, 0.25], [0.05, -1.05], [-0.75, -0.75], [-1.25, -0.1], [-0.8, 0.55], [0.15, 1.1]),
  heroR1: mirrorRev(heroLens([1, 0.25], [0.05, -1.05], [-0.75, -0.75], [-1.25, -0.1], [-0.8, 0.55], [0.15, 1.1])),
  heroL2: heroLens([1, 0.22], [0.2, -0.92], [-0.72, -0.7], [-1.18, -0.05], [-0.76, 0.52], [0.3, 0.95]),
  heroR2: mirrorRev(heroLens([1, 0.22], [0.2, -0.92], [-0.72, -0.7], [-1.18, -0.05], [-0.76, 0.52], [0.3, 0.95])),
  heroL3: heroLens([1, 0.2], [0.15, -1.15], [-0.6, -0.88], [-1.22, -0.12], [-0.88, 0.45], [0.05, 1.18]),
  heroR3: mirrorRev(heroLens([1, 0.2], [0.15, -1.15], [-0.6, -0.88], [-1.22, -0.12], [-0.88, 0.45], [0.05, 1.18])),
  heroL4: heroLens([1, 0.15], [0, -0.85], [-0.8, -0.6], [-1.2, 0], [-0.7, 0.6], [0.2, 0.9]),
  heroR4: mirrorRev(heroLens([1, 0.15], [0, -0.85], [-0.8, -0.6], [-1.2, 0], [-0.7, 0.6], [0.2, 0.9])),
  heroL5: heroLens([1, 0.32], [0.1, -0.95], [-0.7, -0.72], [-1.3, -0.05], [-0.75, 0.6], [0.1, 1.25]),
  heroR5: mirrorRev(heroLens([1, 0.32], [0.1, -0.95], [-0.7, -0.72], [-1.3, -0.05], [-0.75, 0.6], [0.1, 1.25])),
  venomL: heroLens([-0.85, -0.7], [0.1, -0.85], [0.8, -0.35], [1.2, 0.1], [0.55, 0.6], [-0.6, 0.8]),
  venomR: mirrorRev(heroLens([-0.85, -0.7], [0.1, -0.85], [0.8, -0.35], [1.2, 0.1], [0.55, 0.6], [-0.6, 0.8])),
  venomL1: heroLens([-0.85, -0.7], [0.1, -0.85], [0.8, -0.35], [1.2, 0.1], [0.55, 0.6], [-0.6, 0.8]),
  venomR1: mirrorRev(heroLens([-0.85, -0.7], [0.1, -0.85], [0.8, -0.35], [1.2, 0.1], [0.55, 0.6], [-0.6, 0.8])),
  venomL2: heroLens([-0.9, -0.78], [0.05, -0.9], [0.8, -0.32], [1.26, 0.12], [0.5, 0.62], [-0.66, 0.86]),
  venomR2: mirrorRev(heroLens([-0.9, -0.78], [0.05, -0.9], [0.8, -0.32], [1.26, 0.12], [0.5, 0.62], [-0.66, 0.86])),
  venomL3: heroLens([-0.8, -0.64], [0.16, -0.8], [0.86, -0.3], [1.14, 0.16], [0.62, 0.7], [-0.54, 0.74]),
  venomR3: mirrorRev(heroLens([-0.8, -0.64], [0.16, -0.8], [0.86, -0.3], [1.14, 0.16], [0.62, 0.7], [-0.54, 0.74])),
  venomL4: heroLens([-0.96, -0.84], [0, -0.78], [0.74, -0.3], [1.2, 0.04], [0.56, 0.54], [-0.6, 0.7]),
  venomR4: mirrorRev(heroLens([-0.96, -0.84], [0, -0.78], [0.74, -0.3], [1.2, 0.04], [0.56, 0.54], [-0.6, 0.7])),
  venomL5: heroLens([-0.85, -0.6], [0.22, -0.92], [0.9, -0.36], [1.3, 0.1], [0.6, 0.66], [-0.66, 0.8]),
  venomR5: mirrorRev(heroLens([-0.85, -0.6], [0.22, -0.92], [0.9, -0.36], [1.3, 0.1], [0.6, 0.66], [-0.66, 0.8]))
};
var EYESCALE = {
  star: 1.34,
  sparkle: 1.4,
  diamond: 1.2,
  gem: 1.16,
  wedge: 1.2,
  cross: 1.24,
  plus: 1.24,
  flower: 1.24,
  lens: 1.5,
  heart: 1.28,
  ball: 1.16,
  dome: 1.5,
  domeUp: 1.5,
  lidL: 1.5,
  lidR: 1.5,
  bar: 1.5,
  egg: 1.14,
  sqr: 1.04,
  beanL: 1.3,
  beanR: 1.3,
  dropL: 1.3,
  dropR: 1.3,
  tri: 1.34,
  hexV: 1.12,
  lensV: 1.5,
  blobL: 1.26,
  blobR: 1.26,
  swooshL: 1.42,
  swooshR: 1.42,
  swoopL: 1.42,
  swoopR: 1.42,
  visorL: 1.5,
  visorR: 1.5,
  fangL: 1.46,
  fangR: 1.46,
  heroL: 1.34,
  heroR: 1.34,
  venomL: 1.4,
  venomR: 1.4
};
for (let k = 1; k <= 5; k++) {
  EYESCALE["heroL" + k] = 1.34;
  EYESCALE["heroR" + k] = 1.34;
  EYESCALE["venomL" + k] = 1.4;
  EYESCALE["venomR" + k] = 1.4;
}
var EYEEXTENT = (() => {
  const out = {};
  for (const k of Object.keys(EYEUNIT)) {
    let mx = 0, my = 0;
    for (const p of EYEUNIT[k]) {
      const ax = Math.abs(p[0]), ay = Math.abs(p[1]);
      if (ax > mx) mx = ax;
      if (ay > my) my = ay;
    }
    out[k] = [mx || 1, my || 1];
  }
  return out;
})();
function eyeBase(neutral, side, w, spacing, kind, st) {
  const nh = side < 0 ? neutral.heightLeft : neutral.heightRight;
  const nw = side < 0 ? neutral.widthLeft : neutral.widthRight;
  const big = st.scleraFill ? 1.55 : 1;
  const wish = Math.sqrt(Math.max(w, nw * 0.6) * nh) * 0.5 * (EYESCALE[kind] || 1.2) * (st.scale || 1) * big;
  return st.mono ? wish : Math.min(wish, spacing * 0.52 * (st.cap || 1) * big);
}
function eyeShapePts(neutral, side, kind, w, h, spacing, st, wK = 1, hK = 1) {
  if (kind === "capsule") return outline(w, h);
  const U = EYEUNIT[kind];
  if (!U) return outline(w, h);
  const r = eyeBase(neutral, side, w, spacing, kind, st);
  const nh = side < 0 ? neutral.heightLeft : neutral.heightRight;
  const sy = Math.min(1.15, h / (nh || 1)) * (st.sy || 1), sx = st.sx || 1;
  const out = new Array(U.length);
  for (let i = 0; i < U.length; i++) {
    out[i] = [U[i][0] * r * sx * wK, U[i][1] * r * sy * hK];
  }
  return out;
}
function eyePts(neutral, side, eyeFrom, eyeTo, morph, w, h, spacing, st, wK = 1, hK = 1) {
  const styled = st.sclera;
  const rs = (k) => k === "capsule" && styled ? styled : k;
  const from = rs(eyeFrom), to = rs(eyeTo);
  if (from === to) return eyeShapePts(neutral, side, to, w, h, spacing, st, wK, hK);
  const t = morph, s = t * t * (3 - 2 * t);
  if (s <= 2e-3) return eyeShapePts(neutral, side, from, w, h, spacing, st, wK, hK);
  if (s >= 0.998) return eyeShapePts(neutral, side, to, w, h, spacing, st, wK, hK);
  const p = eyeShapePts(neutral, side, from, w, h, spacing, st, wK, hK);
  const q = eyeShapePts(neutral, side, to, w, h, spacing, st, wK, hK);
  const out = new Array(p.length);
  for (let i = 0; i < p.length; i++) {
    out[i] = [p[i][0] + (q[i][0] - p[i][0]) * s, p[i][1] + (q[i][1] - p[i][1]) * s];
  }
  return out;
}
var SURFACES = [
  {
    id: "solid",
    label: "Solid"
  }
];
var SURFACE_BY_ID = Object.fromEntries(
  SURFACES.map((s) => [s.id, s])
);
var hex2 = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
function mix(a, b, amt) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const ar = A >> 16 & 255, ag = A >> 8 & 255, ab = A & 255;
  const br = B >> 16 & 255, bg = B >> 8 & 255, bb = B & 255;
  return "#" + hex2(ar + (br - ar) * amt) + hex2(ag + (bg - ag) * amt) + hex2(ab + (bb - ab) * amt);
}
var extentCache =  new Map();
function bodyExtent(spec) {
  const hit = extentCache.get(spec.id);
  if (hit) return hit;
  let m = 0;
  for (const p of shapePoints(spec.shape, spec.shapeArgs, 1)) {
    const r = Math.sqrt(p[0] * p[0] + p[1] * p[1]);
    if (r > m) m = r;
  }
  extentCache.set(spec.id, m);
  return m;
}
function bodyPaint(cfg, spec) {
  var _a;
  const rx = typeof spec.er === "number" ? spec.er : spec.er.x;
  const ry = typeof spec.er === "number" ? spec.er : spec.er.y;
  const base = Math.max(rx, ry) * 1.5;
  const cx = base * cfg.lightX, cy = base * cfg.lightY;
  const surface = SURFACE_BY_ID[cfg.surfaceId];
  const stops = (_a = surface == null ? void 0 : surface.stops) == null ? void 0 : _a.map((st) => {
    var _a2;
    return {
      offset: st.offset,
      color: (_a2 = st.color) != null ? _a2 : cfg.bodyColor,
      opacity: st.opacity
    };
  });
  return {
    light: mix(cfg.bodyColor, cfg.lightColor, cfg.shine),
    mid: cfg.bodyColor,
    dark: mix(cfg.bodyColor, cfg.shadowColor, cfg.shadow),
    cx,
    cy,
    r: base * cfg.lightSpread,
    scaleX: cfg.stretchX,
    scaleY: cfg.stretchY,
    gloss: cfg.gloss > 0 ? {
      cx,
      cy,
      r: base * 0.46 * cfg.lightSpread,
      color: cfg.lightColor,
      opacity: cfg.gloss
    } : null,
    rim: cfg.rim > 0 ? { r: bodyExtent(spec) * 1.01, inner: 0.76, color: cfg.rimColor, opacity: cfg.rim } : null,
    ...stops ? { stops } : {},
    ...stops && stops.some((st) => st.opacity < 1) ? { seam: false } : {}
  };
}
var R = 120;
var F = 620;
function qmul(a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ];
}
function quatFromEuler(hx, hy, hz) {
  const d = Math.PI / 360;
  const qx = [Math.sin(hx * d), 0, 0, Math.cos(hx * d)];
  const qy = [0, Math.sin(hy * d), 0, Math.cos(hy * d)];
  const qz = [0, 0, Math.sin(hz * d), Math.cos(hz * d)];
  return qmul(qmul(qz, qx), qy);
}
function rotQ(q, p) {
  const qx = q[0], qy = q[1], qz = q[2], w = q[3];
  const tx = 2 * (qy * p[2] - qz * p[1]);
  const ty = 2 * (qz * p[0] - qx * p[2]);
  const tz = 2 * (qx * p[1] - qy * p[0]);
  return [
    p[0] + w * tx + (qy * tz - qz * ty),
    p[1] + w * ty + (qz * tx - qx * tz),
    p[2] + w * tz + (qx * ty - qy * tx)
  ];
}
function project(P, persp) {
  let denom = F - P[2] * persp;
  if (Math.abs(denom) < 1e-4) denom = 1e-4;
  const sc = F / denom;
  return [P[0] * sc, P[1] * sc, P[2], sc];
}
var q1 = (v) => Math.floor(v * 10 + 0.5) / 10;
var q2 = (v) => Math.floor(v * 100 + 0.5) / 100;
var q3 = (v) => Math.floor(v * 1e3 + 0.5) / 1e3;
function ease(name, p) {
  if (name === "snappy") return 1 - Math.pow(1 - p, 3);
  if (name === "spring") return 1 - Math.exp(-6 * p) * Math.cos(8 * p);
  return p * p * (3 - 2 * p);
}
var HASH_Q = 1024;
function mix32(k) {
  let h = k | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}
function hash01(v) {
  return mix32(Math.floor(v * HASH_Q + 0.5)) / 4294967296;
}
function hash(v) {
  return hash01(v) * 2 - 1;
}
function sn(t, axis, seed, interval) {
  const step = Math.floor(t / interval);
  const f = t / interval - step;
  const s = f * f * (3 - 2 * f);
  const a = hash(step + axis * 61.7 + seed);
  const b = hash(step + 1 + axis * 61.7 + seed);
  return a + (b - a) * s;
}
function sacc(t, axis, seed) {
  const step = Math.floor(t / 1100);
  let f = (t - step * 1100) / 140;
  if (f > 1) f = 1;
  const s = f * f * (3 - 2 * f);
  const a = hash(step - 1 + axis * 61.7 + 17.29 + seed);
  const b = hash(step + axis * 61.7 + 17.29 + seed);
  return a + (b - a) * s;
}
function buildExprs(n) {
  const X = (o) => Object.assign({}, n, o);
  return {
    neutral: X({}),
    perk: X({
      heightLeft: n.heightLeft * 1.2,
      heightRight: n.heightRight * 1.2,
      widthLeft: n.widthLeft * 1.05,
      widthRight: n.widthRight * 1.05,
      spacing: n.spacing * 1.14,
      headX: 7,
      positionYLeft: n.positionYLeft - 2,
      positionYRight: n.positionYRight - 2
    }),
    squintHappy: X({
      heightLeft: Math.max(10, n.heightLeft * 0.32),
      heightRight: Math.max(10, n.heightRight * 0.32),
      widthLeft: n.widthLeft * 1.2,
      widthRight: n.widthRight * 1.2,
      leftAngle: n.leftAngle - 9,
      rightAngle: n.rightAngle + 9,
      headX: 4,
      positionYLeft: n.positionYLeft + 3,
      positionYRight: n.positionYRight + 3
    }),
    drowsy: X({
      heightLeft: Math.max(9, n.heightLeft * 0.34),
      heightRight: Math.max(9, n.heightRight * 0.34),
      headX: -5,
      positionYLeft: n.positionYLeft + 2,
      positionYRight: n.positionYRight + 2
    }),
    drowsyLeft: X({
      heightLeft: Math.max(9, n.heightLeft * 0.34),
      heightRight: Math.max(9, n.heightRight * 0.34),
      headX: -3,
      headZ: -11,
      headY: 7,
      positionYLeft: n.positionYLeft + 2,
      positionYRight: n.positionYRight + 2
    }),
    drowsyRight: X({
      heightLeft: Math.max(9, n.heightLeft * 0.34),
      heightRight: Math.max(9, n.heightRight * 0.34),
      headX: -3,
      headZ: 11,
      headY: -7,
      positionYLeft: n.positionYLeft + 2,
      positionYRight: n.positionYRight + 2
    }),
    scanRight: X({ headY: -30, headZ: -3 }),
    scanLeft: X({ headY: 30, headZ: 3 }),
    scanUp: X({
      headX: 16,
      heightLeft: n.heightLeft * 1.08,
      heightRight: n.heightRight * 1.08
    }),
    sleep: X({
      heightLeft: 6,
      heightRight: 6,
      widthLeft: n.widthLeft * 1.15,
      widthRight: n.widthRight * 1.15,
      headX: -9,
      positionYLeft: n.positionYLeft + 5,
      positionYRight: n.positionYRight + 5
    }),
    sleepDrift: X({
      heightLeft: 6,
      heightRight: 6,
      widthLeft: n.widthLeft * 1.15,
      widthRight: n.widthRight * 1.15,
      headX: -11,
      headY: 9,
      headZ: -5,
      positionYLeft: n.positionYLeft + 5,
      positionYRight: n.positionYRight + 5
    }),
    tiltLeft: X({ headZ: -8, headY: 6 }),
    tiltRight: X({ headZ: 8, headY: -6 }),
    peekRight: X({
      positionXLeft: n.positionXLeft + 34,
      positionXRight: n.positionXRight + 34,
      headY: -10
    }),
    peekLeft: X({
      positionXLeft: n.positionXLeft - 34,
      positionXRight: n.positionXRight - 34,
      headY: 10
    }),
    rollLeft: X({ headZ: -14, headY: 24 }),
    rollRight: X({ headZ: 14, headY: -24 }),
    turnRight: X({ headY: -24, headZ: -5, headX: 4 }),
    turnLeft: X({ headY: 24, headZ: 5, headX: 4 }),
    wobble: X({
      headZ: 10,
      heightLeft: n.heightLeft * 0.7,
      heightRight: n.heightRight * 0.7
    }),
    glanceRight: X({
      headY: -16,
      headZ: -2,
      positionXLeft: n.positionXLeft + 2,
      positionXRight: n.positionXRight + 2
    }),
    glanceLeft: X({
      headY: 16,
      headZ: 2,
      positionXLeft: n.positionXLeft - 2,
      positionXRight: n.positionXRight - 2
    }),
    lookUp: X({
      headX: 13,
      headY: 9,
      heightLeft: n.heightLeft * 0.92,
      heightRight: n.heightRight * 0.92,
      positionYLeft: n.positionYLeft - 3,
      positionYRight: n.positionYRight - 3
    }),
    attentive: X({
      heightLeft: n.heightLeft * 1.12,
      heightRight: n.heightRight * 1.12,
      widthLeft: n.widthLeft * 1.08,
      widthRight: n.widthRight * 1.08,
      spacing: n.spacing * 1.06,
      headX: 3
    }),
    tiltCurious: X({
      headZ: 9,
      headY: -7,
      headX: 5,
      heightLeft: n.heightLeft * 1.15,
      heightRight: n.heightRight * 0.95
    }),
    shyAway: X({
      headY: 14,
      positionXLeft: n.positionXLeft - 6,
      positionXRight: n.positionXRight - 6,
      heightLeft: n.heightLeft * 0.78,
      heightRight: n.heightRight * 0.78,
      positionYLeft: n.positionYLeft + 2,
      positionYRight: n.positionYRight + 2
    }),
    shyPeek: X({
      headY: -5,
      heightLeft: n.heightLeft * 1.05,
      heightRight: n.heightRight * 1.05
    }),
    sad: X({
      heightLeft: n.heightLeft * 0.72,
      heightRight: n.heightRight * 0.72,
      headX: -7,
      positionYLeft: n.positionYLeft + 4,
      positionYRight: n.positionYRight + 4,
      leftAngle: n.leftAngle + 12,
      rightAngle: n.rightAngle - 12
    }),
    sadLower: X({
      heightLeft: n.heightLeft * 0.6,
      heightRight: n.heightRight * 0.6,
      headX: -11,
      headY: 8,
      headZ: -4,
      positionYLeft: n.positionYLeft + 6,
      positionYRight: n.positionYRight + 6,
      leftAngle: n.leftAngle + 12,
      rightAngle: n.rightAngle - 12
    }),
    angry: X({
      heightLeft: n.heightLeft * 0.8,
      heightRight: n.heightRight * 0.8,
      widthLeft: n.widthLeft * 1.06,
      widthRight: n.widthRight * 1.06,
      spacing: n.spacing * 0.94,
      headX: -4,
      leftAngle: n.leftAngle - 15,
      rightAngle: n.rightAngle + 15
    }),
    angryHard: X({
      heightLeft: n.heightLeft * 0.6,
      heightRight: n.heightRight * 0.6,
      widthLeft: n.widthLeft * 1.1,
      widthRight: n.widthRight * 1.1,
      spacing: n.spacing * 0.9,
      headX: -7,
      leftAngle: n.leftAngle - 19,
      rightAngle: n.rightAngle + 19
    }),
    surprised: X({
      heightLeft: n.heightLeft * 1.5,
      heightRight: n.heightRight * 1.5,
      widthLeft: n.widthLeft * 1.18,
      widthRight: n.widthRight * 1.18,
      spacing: n.spacing * 1.12,
      headX: 8,
      positionYLeft: n.positionYLeft - 3,
      positionYRight: n.positionYRight - 3
    }),
    confused: X({
      headZ: 13,
      headY: -9,
      headX: 3,
      heightLeft: n.heightLeft * 1.22,
      heightRight: n.heightRight * 0.78
    }),
    confusedFlip: X({
      headZ: -11,
      headY: 8,
      headX: 2,
      heightLeft: n.heightLeft * 0.8,
      heightRight: n.heightRight * 1.2
    }),
    tiltCuriousR: X({
      headZ: -9,
      headY: 7,
      headX: 5,
      heightLeft: n.heightLeft * 0.95,
      heightRight: n.heightRight * 1.15
    }),
    yawnWide: X({
      heightLeft: n.heightLeft * 1.55,
      heightRight: n.heightRight * 1.55,
      widthLeft: n.widthLeft * 1.1,
      widthRight: n.widthRight * 1.1,
      headX: -13,
      positionYLeft: n.positionYLeft + 2,
      positionYRight: n.positionYRight + 2
    }),
    boredSide: X({
      heightLeft: Math.max(9, n.heightLeft * 0.42),
      heightRight: Math.max(9, n.heightRight * 0.42),
      headY: 13,
      headZ: 7,
      positionXLeft: n.positionXLeft + 8,
      positionXRight: n.positionXRight + 8
    }),
    narrowSquint: X({
      heightLeft: Math.max(8, n.heightLeft * 0.4),
      heightRight: Math.max(8, n.heightRight * 0.4),
      widthLeft: n.widthLeft * 1.12,
      widthRight: n.widthRight * 1.12
    }),
    sideEye: X({
      positionXLeft: n.positionXLeft + 13,
      positionXRight: n.positionXRight + 13,
      headY: -7,
      heightLeft: n.heightLeft * 0.88,
      heightRight: n.heightRight * 0.88
    }),
    sideEyeL: X({
      positionXLeft: n.positionXLeft - 13,
      positionXRight: n.positionXRight - 13,
      headY: 7,
      heightLeft: n.heightLeft * 0.88,
      heightRight: n.heightRight * 0.88
    }),
    nodDown: X({
      headX: -16,
      heightLeft: n.heightLeft * 0.9,
      heightRight: n.heightRight * 0.9
    }),
    nodUp: X({ headX: 9 }),
    lookDown: X({
      headX: -15,
      heightLeft: n.heightLeft * 0.85,
      heightRight: n.heightRight * 0.85,
      positionYLeft: n.positionYLeft + 3,
      positionYRight: n.positionYRight + 3
    }),
    shakeL: X({ headY: 20, headZ: 3 }),
    shakeR: X({ headY: -20, headZ: -3 }),
    wide: X({
      spacing: n.spacing * 1.3,
      heightLeft: n.heightLeft * 1.18,
      heightRight: n.heightRight * 1.18,
      widthLeft: n.widthLeft * 1.1,
      widthRight: n.widthRight * 1.1,
      headX: 5
    }),
    widePop: X({
      spacing: n.spacing * 1.38,
      heightLeft: n.heightLeft * 1.34,
      heightRight: n.heightRight * 1.34,
      widthLeft: n.widthLeft * 1.18,
      widthRight: n.widthRight * 1.18,
      headX: 8
    }),
    wideTiltL: X({
      spacing: n.spacing * 1.3,
      heightLeft: n.heightLeft * 1.18,
      heightRight: n.heightRight * 1.18,
      headZ: -9,
      headY: 7
    }),
    wideTiltR: X({
      spacing: n.spacing * 1.3,
      heightLeft: n.heightLeft * 1.18,
      heightRight: n.heightRight * 1.18,
      headZ: 9,
      headY: -7
    }),
    wideSmall: X({
      spacing: n.spacing * 1.22,
      heightLeft: n.heightLeft * 0.82,
      heightRight: n.heightRight * 0.82,
      widthLeft: n.widthLeft * 0.9,
      widthRight: n.widthRight * 0.9
    })
  };
}
function makeOccluder(tab, depth, q, persp, bx, by, bz) {
  const qi = [-q[0], -q[1], -q[2], q[3]];
  const c = rotQ(qi, [0, 0, F / persp]);
  let rmax = depth;
  for (let i = 0; i < tab.length; i++) if (tab[i] > rmax) rmax = tab[i];
  return { tab, depth, rmax, cam: [c[0] / bx, c[1] / by, c[2] / bz] };
}
function rimAt(tab, angle) {
  const n = tab.length;
  let x = angle / (Math.PI * 2) * n;
  x = (x % n + n) % n;
  const i = Math.floor(x);
  const f = x - i;
  const A = tab[i];
  const B = tab[(i + 1) % n];
  return A + (B - A) * f;
}
function headRadius(o, nx, ny, nz) {
  const hxy = Math.sqrt(nx * nx + ny * ny);
  const rad = rimAt(o.tab, Math.atan2(ny, nx));
  const k = rad / o.depth;
  const den = Math.sqrt(hxy * hxy + k * k * nz * nz);
  return den > 1e-9 ? rad / den : o.depth;
}
var RAY_SAMPLES = 13;
function probe(o, px, py, pz, dir) {
  let dx = o.cam[0] - px, dy = o.cam[1] - py, dz = o.cam[2] - pz;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dl > 1e-9) {
    dx /= dl;
    dy /= dl;
    dz /= dl;
  }
  let t0 = -(px * dx + py * dy + pz * dz);
  if (t0 < 0) t0 = 0;
  else if (t0 > dl) t0 = dl;
  const cx = px + dx * t0, cy = py + dy * t0, cz = pz + dz * t0;
  const cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
  const half = cl < o.rmax ? Math.sqrt(o.rmax * o.rmax - cl * cl) : 0;
  const count = half === 0 ? 1 : RAY_SAMPLES;
  let worst = 0;
  let found = false;
  for (let i = 0; i < count; i++) {
    let t = t0 + (half === 0 ? 0 : (i * 2 / (RAY_SAMPLES - 1) - 1) * half);
    if (t < 0) t = 0;
    else if (t > dl) t = dl;
    const ax = px + dx * t, ay = py + dy * t, az = pz + dz * t;
    const al = Math.sqrt(ax * ax + ay * ay + az * az);
    if (al < 1e-9) {
      dir[0] = 0;
      dir[1] = 0;
      dir[2] = 0;
      return -o.depth;
    }
    const nx = ax / al, ny = ay / al, nz = az / al;
    const c = al - headRadius(o, nx, ny, nz);
    if (!found || c < worst) {
      found = true;
      worst = c;
      dir[0] = nx;
      dir[1] = ny;
      dir[2] = nz;
    }
  }
  return worst;
}
var PUSH_STEPS = 3;
var COLOUR_EDGE = 8;
function densify(p) {
  const n = p.length;
  let need = false;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[i + 1 === n ? 0 : i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    if (dx * dx + dy * dy + dz * dz > COLOUR_EDGE * COLOUR_EDGE) {
      need = true;
      break;
    }
  }
  if (!need) return p;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[i + 1 === n ? 0 : i + 1];
    out.push(a);
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const k = Math.ceil(len / COLOUR_EDGE);
    for (let s = 1; s < k; s++) {
      const u = s / k;
      out.push([a[0] + dx * u, a[1] + dy * u, a[2] + dz * u]);
    }
  }
  return out;
}
var CL = new Float64Array(256);
var DX = new Float64Array(256);
var DY = new Float64Array(256);
var DZ = new Float64Array(256);
var DIR = [0, 0, 0];
function occludeLoop(o, pts) {
  const n = pts.length;
  if (CL.length < n) {
    CL = new Float64Array(n * 2);
    DX = new Float64Array(n * 2);
    DY = new Float64Array(n * 2);
    DZ = new Float64Array(n * 2);
  }
  let hidden = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    CL[i] = probe(o, p[0], p[1], p[2], DIR);
    if (CL[i] < 0) hidden++;
    DX[i] = DIR[0];
    DY[i] = DIR[1];
    DZ[i] = DIR[2];
  }
  if (hidden === 0) return pts;
  if (hidden === n) return null;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (CL[i] >= 0) {
      out[i] = pts[i];
      continue;
    }
    let x = pts[i][0], y = pts[i][1], z = pts[i][2];
    x += DX[i] * -CL[i];
    y += DY[i] * -CL[i];
    z += DZ[i] * -CL[i];
    for (let k = 1; k < PUSH_STEPS; k++) {
      const c = probe(o, x, y, z, DIR);
      if (c >= 0) break;
      const step = -c;
      x += DIR[0] * step;
      y += DIR[1] * step;
      z += DIR[2] * step;
    }
    out[i] = [x, y, z];
  }
  return out;
}
var MOTION_KNOB_DEFAULT = 1;
function motionParam(params, id) {
  const v = params == null ? void 0 : params[id];
  return v === void 0 ? MOTION_KNOB_DEFAULT : v;
}
var PHI = (1 + Math.sqrt(5)) / 2;
var ICO_V = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1]
].map(normalize);
var ICO_F = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1]
];
function normalize(p) {
  const L = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
  return [p[0] / L, p[1] / L, p[2] / L];
}
var WELD = 1e-3;
var gi = (v) => Math.round(v / WELD);
function weldKey(map, p) {
  const x = gi(p[0]), y = gi(p[1]), z = gi(p[2]);
  const own = x + "," + y + "," + z;
  if (map.has(own)) return own;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        const k = x + dx + "," + (y + dy) + "," + (z + dz);
        if (map.has(k)) return k;
      }
    }
  }
  return own;
}
var shellCache =  new Map();
function goldbergShell(freq) {
  const F2 = Math.max(2, Math.round(freq));
  const hit = shellCache.get(F2);
  if (hit) return hit;
  const corners =  new Map();
  const add = (v, c) => {
    const k = weldKey(corners, v);
    let e = corners.get(k);
    if (!e) {
      e = { n: v, c: [] };
      corners.set(k, e);
    }
    e.c.push(c);
  };
  for (const f of ICO_F) {
    const A = ICO_V[f[0]], B = ICO_V[f[1]], C = ICO_V[f[2]];
    const at = (i, j) => normalize([
      A[0] + (B[0] - A[0]) * i / F2 + (C[0] - A[0]) * j / F2,
      A[1] + (B[1] - A[1]) * i / F2 + (C[1] - A[1]) * j / F2,
      A[2] + (B[2] - A[2]) * i / F2 + (C[2] - A[2]) * j / F2
    ]);
    const cent = (p, q, r) => normalize([p[0] + q[0] + r[0], p[1] + q[1] + r[1], p[2] + q[2] + r[2]]);
    for (let i = 0; i < F2; i++) {
      for (let j = 0; j < F2 - i; j++) {
        const p00 = at(i, j), p10 = at(i + 1, j), p01 = at(i, j + 1);
        const c1 = cent(p00, p10, p01);
        add(p00, c1);
        add(p10, c1);
        add(p01, c1);
        if (i + j < F2 - 1) {
          const p11 = at(i + 1, j + 1);
          const c2 = cent(p10, p11, p01);
          add(p10, c2);
          add(p11, c2);
          add(p01, c2);
        }
      }
    }
  }
  const cells = [];
  for (const e of corners.values()) {
    if (e.c.length < 5) continue;
    const n = e.n;
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const ex = normalize([
      ref[1] * n[2] - ref[2] * n[1],
      ref[2] * n[0] - ref[0] * n[2],
      ref[0] * n[1] - ref[1] * n[0]
    ]);
    const ey = [
      n[1] * ex[2] - n[2] * ex[1],
      n[2] * ex[0] - n[0] * ex[2],
      n[0] * ex[1] - n[1] * ex[0]
    ];
    const uniq = [];
    const seen =  new Map();
    for (const c of e.c) {
      const k = weldKey(seen, c);
      if (!seen.has(k)) {
        seen.set(k, true);
        uniq.push(c);
      }
    }
    uniq.sort(
      (p, r) => Math.atan2(
        p[0] * ey[0] + p[1] * ey[1] + p[2] * ey[2],
        p[0] * ex[0] + p[1] * ex[1] + p[2] * ex[2]
      ) - Math.atan2(
        r[0] * ey[0] + r[1] * ey[1] + r[2] * ey[2],
        r[0] * ex[0] + r[1] * ex[1] + r[2] * ex[2]
      )
    );
    cells.push({ n, v: uniq });
  }
  const want = 10 * F2 * F2 + 2;
  const pents = cells.reduce((n, c) => n + (c.v.length === 5 ? 1 : 0), 0);
  if (cells.length !== want || pents !== 12) {
    throw new Error(
      `goldbergShell(${F2}): ${cells.length} cells / ${pents} pentagons, expected ${want} / 12`
    );
  }
  shellCache.set(F2, cells);
  return cells;
}
var SHELL_PROUD = 1.09;
var newSink = () => ({ pts: [], ends: [] });
var DISC_SEGMENTS = 16;
function makeTexCtx(inp) {
  const { q, persp, rim, rk, bx, by, sz } = inp;
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const N = rim.length;
  const TAU2 = Math.PI * 2;
  const rimAt2 = (x, y) => {
    let a = Math.atan2(y, x) / TAU2;
    a -= Math.floor(a);
    const f = a * N;
    const i = Math.floor(f);
    const t = f - i;
    const r0 = rim[i % N], r1 = rim[(i + 1) % N];
    return (r0 + (r1 - r0) * t) * rk;
  };
  const rotZ = (p0, p1, p2) => {
    const tx = 2 * (qy * p2 - qz * p1);
    const ty = 2 * (qz * p0 - qx * p2);
    const tz = 2 * (qx * p1 - qy * p0);
    return p2 + qw * tz + (qx * ty - qy * tx);
  };
  const facing = (v) => {
    const R2 = rimAt2(v[0], v[1]);
    const n0 = v[0] / (R2 * bx), n1 = v[1] / (R2 * by), n2 = v[2] / sz;
    const l = Math.sqrt(n0 * n0 + n1 * n1 + n2 * n2) || 1;
    return rotZ(n0, n1, n2) / l;
  };
  const project2 = (v) => {
    const R2 = rimAt2(v[0], v[1]);
    const p0 = v[0] * R2 * bx, p1 = v[1] * R2 * by, p2 = v[2] * sz;
    const tx = 2 * (qy * p2 - qz * p1);
    const ty = 2 * (qz * p0 - qx * p2);
    const tz = 2 * (qx * p1 - qy * p0);
    const X = p0 + qw * tx + (qy * tz - qz * ty);
    const Y = p1 + qw * ty + (qz * tx - qx * tz);
    const Z = p2 + qw * tz + (qx * ty - qy * tx);
    let den = F - Z * persp;
    if (den < 1e-4 && den > -1e-4) den = 1e-4;
    const sc = F / den;
    return [X * sc, Y * sc, sc];
  };
  const sp = (lat, lon) => [
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    Math.cos(lat) * Math.sin(lon)
  ];
  const ctx = {
    t: inp.t,
    sp,
    hash,
    cl: (x) => Math.max(-1.42, Math.min(1.42, x)),
    cells: (f) => goldbergShell(Math.max(2, Math.round(f * inp.density))),
    noise: (v, s) => Math.sin(v[0] * s + 1.7) + Math.sin(v[1] * s * 1.21 + 4.2) + Math.sin(v[2] * s * 0.87 + 2.1) + 0.8 * Math.sin((v[0] + v[2]) * s * 1.6) + 0.7 * Math.sin((v[1] - v[0]) * s * 1.35),
    poly(out, verts, n) {
      if (n) {
        if (facing(n) < -0.04) return;
      } else {
        let z = 0;
        for (const v of verts) z += facing(v);
        if (z / verts.length < -0.02) return;
      }
      for (const v of verts) {
        const p = project2(v);
        out.pts.push(q1(p[0]), q1(p[1]));
      }
      out.ends.push(out.pts.length >> 1);
    },
    line(out, pts, closed, backOut) {
      const n = pts.length;
      const lim = closed ? n : n - 1;
      let fRun = 0, bRun = 0;
      const close = (sink, len) => {
        if (sink) {
          if (len > 1) sink.ends.push(sink.pts.length >> 1);
          else if (len === 1) sink.pts.length -= 2;
        }
        return 0;
      };
      for (let i = 0; i <= lim; i++) {
        const v = pts[i % n];
        const p = project2(v);
        if (facing(v) > 0.02) {
          bRun = close(backOut, bRun);
          out.pts.push(q1(p[0]), q1(p[1]));
          fRun++;
        } else {
          fRun = close(out, fRun);
          if (backOut) {
            backOut.pts.push(q1(p[0]), q1(p[1]));
            bRun++;
          }
        }
      }
      close(out, fRun);
      close(backOut, bRun);
    },
    disc(out, c, rad) {
      const f = facing(c);
      if (f < 0.08) return;
      const p = project2(c);
      const local = rimAt2(c[0], c[1]) * (bx + by) * 0.5;
      const r = rad * local * p[2] * (0.4 + 0.6 * f);
      if (r < 0.3) return;
      for (let i = 0; i < DISC_SEGMENTS; i++) {
        const a = i / DISC_SEGMENTS * Math.PI * 2;
        out.pts.push(q1(p[0] + Math.cos(a) * r), q1(p[1] + Math.sin(a) * r));
      }
      out.ends.push(out.pts.length >> 1);
    },
    quad(out, lat, lon, dl, dn) {
      ctx.poly(out, [
        sp(lat - dl, lon - dn),
        sp(lat - dl, lon + dn),
        sp(lat + dl, lon + dn),
        sp(lat + dl, lon - dn)
      ]);
    }
  };
  return ctx;
}
var sinkOutline = (s) => s.ends.length > 0 ? { pts: s.pts, ends: s.ends } : null;
var TEXTURES = [
  { id: "none", label: "None", layers: [] },
  {
    id: "hex",
    label: "Hex",
    base: "#d8201c",
    cells: true,
    layers: [{ name: "Lines", kind: "poly", stroke: "#0b0d10", w: 0.9 }],
    build: (L, cx) => {
      for (const c of cx.cells(8)) cx.poly(L[0], c.v, c.n);
    }
  },
  {
    id: "camo",
    label: "Camo",
    base: "#3f4636",
    cells: true,
    layers: [
      { name: "Mid", kind: "poly", fill: "#5e6a46" },
      { name: "Shadow", kind: "poly", fill: "#20241b" },
      { name: "Sand", kind: "poly", fill: "#8c8b63" }
    ],
    build: (L, cx) => {
      for (const c of cx.cells(9)) {
        const n = cx.noise(c.n, 3.1);
        if (n > 1.15) cx.poly(L[2], c.v, c.n);
        else if (n > -0.1) cx.poly(L[0], c.v, c.n);
        else if (n < -1.5) cx.poly(L[1], c.v, c.n);
      }
    }
  },
  {
    id: "wire",
    label: "Wire",
    base: "#0b1a22",
    layers: [
      { name: "Far side", kind: "line", stroke: "#1f6e78", w: 0.9, op: 0.55 },
      { name: "Grid", kind: "line", stroke: "#3be0ce", w: 1.1 },
      { name: "Nodes", kind: "poly", fill: "#3be0ce", op: 0.9 }
    ],
    build: (L, cx) => {
      for (let k = 1; k < 11; k++) {
        const lat = -1.4 + k * 0.255;
        const p = [];
        for (let i = 0; i <= 72; i++) p.push(cx.sp(lat, i / 72 * Math.PI * 2));
        cx.line(L[1], p, true, L[0]);
      }
      for (let k = 0; k < 14; k++) {
        const lon = k / 14 * Math.PI * 2;
        const p = [];
        for (let i = 0; i <= 48; i++) p.push(cx.sp(-Math.PI / 2 + Math.PI * (i / 48), lon));
        cx.line(L[1], p, false, L[0]);
      }
      for (let k = 1; k < 11; k += 3) {
        for (let j = 0; j < 14; j += 3) {
          cx.disc(L[2], cx.sp(-1.4 + k * 0.255, j / 14 * Math.PI * 2), 0.03);
        }
      }
    }
  },
  {
    id: "lava",
    label: "Lava",
    base: "#1a0d0a",
    cells: true,
    layers: [
      { name: "Crust", kind: "poly", fill: "#31160f" },
      { name: "Ember", kind: "poly", fill: "#b3300f" },
      { name: "Flow", kind: "poly", fill: "#f2892b" },
      { name: "Core", kind: "poly", fill: "#ffe28a" }
    ],
    build: (L, cx) => {
      for (const c of cx.cells(9)) {
        const v = cx.noise(c.n, 2.6) + cx.noise(c.n, 6.1) * 0.4;
        if (v > 2) cx.poly(L[3], c.v, c.n);
        else if (v > 1.1) cx.poly(L[2], c.v, c.n);
        else if (v > 0.35) cx.poly(L[1], c.v, c.n);
        else if (v > -0.9) cx.poly(L[0], c.v, c.n);
      }
    }
  },
  {
    id: "nebula",
    label: "Nebula",
    base: "#0b0a1c",
    cells: true,
    layers: [
      { name: "Deep", kind: "poly", fill: "#2b1c4a", op: 0.9 },
      { name: "Cloud", kind: "poly", fill: "#7b3e8f", op: 0.75 },
      { name: "Glow", kind: "poly", fill: "#d96ba0", op: 0.6 },
      { name: "Stars", kind: "poly", fill: "#fff6d8" }
    ],
    build: (L, cx) => {
      for (const c of cx.cells(9)) {
        const n = cx.noise(c.n, 2.2) + 0.5 * cx.noise(c.n, 5.3);
        if (n > 2.3) cx.poly(L[2], c.v, c.n);
        else if (n > 1.1) cx.poly(L[1], c.v, c.n);
        else if (n > -0.4) cx.poly(L[0], c.v, c.n);
      }
      for (let k = 0; k < 34; k++) {
        cx.disc(
          L[3],
          cx.sp(cx.hash(k * 4.7) * 1.4, cx.hash(k * 8.9 + 2) * Math.PI),
          0.012 + Math.abs(cx.hash(k * 2.3)) * 0.016
        );
      }
    }
  },
  {
    id: "lightning",
    label: "Lightning",
    base: "#0a0a14",
    anim: true,
    layers: [
      { name: "Glow", kind: "line", stroke: "#3b4e8f", w: 5, op: 0.55 },
      { name: "Bolt", kind: "line", stroke: "#cfe0ff", w: 1.6 },
      { name: "Strike", kind: "poly", fill: "#ffffff" }
    ],
    build: (L, cx) => {
      const beat = Math.floor(cx.t * 8);
      for (let k = 0; k < 4; k++) {
        if (cx.hash(beat * 5.3 + k * 41) < -0.5) continue;
        let lat = cx.hash(beat * 7.7 + k * 13) * 1.3;
        let lon = cx.hash(beat * 3.1 + k * 29) * Math.PI;
        const pts = [cx.sp(lat, lon)];
        for (let j = 0; j < 7; j++) {
          lat = cx.cl(lat + cx.hash(beat * 2.7 + k * 11 + j) * 0.3 - 0.16);
          lon += 0.2 + cx.hash(beat * 4.1 + k * 17 + j) * 0.26;
          pts.push(cx.sp(lat, lon));
        }
        cx.line(L[0], pts, false);
        cx.line(L[1], pts, false);
        cx.disc(L[2], pts[pts.length - 1], 0.03);
      }
    }
  },
  {
    id: "plasma",
    label: "Plasma",
    base: "#12002a",
    anim: true,
    cells: true,
    layers: [
      { name: "Deep", kind: "poly", fill: "#3b0f6b" },
      { name: "Mid", kind: "poly", fill: "#8b1e8c" },
      { name: "Hot", kind: "poly", fill: "#e0457b" },
      { name: "Core", kind: "poly", fill: "#ffd166" }
    ],
    build: (L, cx) => {
      for (const c of cx.cells(9)) {
        const v = cx.noise(
          [
            c.n[0] + 0.3 * Math.sin(cx.t * 0.5),
            c.n[1],
            c.n[2] + 0.3 * Math.cos(cx.t * 0.4)
          ],
          2.4
        ) + Math.sin(cx.t * 0.9 + c.n[1] * 4);
        if (v > 2.3) cx.poly(L[3], c.v, c.n);
        else if (v > 1.2) cx.poly(L[2], c.v, c.n);
        else if (v > 0) cx.poly(L[1], c.v, c.n);
        else if (v > -1.4) cx.poly(L[0], c.v, c.n);
      }
    }
  },
  {
    id: "ripple",
    label: "Ripple grid",
    base: "#08131c",
    anim: true,
    layers: [
      { name: "Far side", kind: "line", stroke: "#1c4e66", w: 1, op: 0.6 },
      { name: "Grid", kind: "line", stroke: "#5cd2f0", w: 1.3 }
    ],
    build: (L, cx) => {
      for (let k = 0; k < 12; k++) {
        const base = -1.32 + k * 0.24;
        const p = [];
        for (let i = 0; i <= 64; i++) {
          const lon = i / 64 * Math.PI * 2;
          p.push(cx.sp(cx.cl(base + 0.11 * Math.sin(3 * lon + cx.t * 2 + k * 0.6)), lon));
        }
        cx.line(L[1], p, true, L[0]);
      }
      for (let k = 0; k < 16; k++) {
        const lon0 = k / 16 * Math.PI * 2;
        const p = [];
        for (let i = 0; i <= 36; i++) {
          const lat = -1.4 + 2.8 * (i / 36);
          p.push(cx.sp(lat, lon0 + 0.09 * Math.sin(4 * lat + cx.t * 1.7)));
        }
        cx.line(L[1], p, false, L[0]);
      }
    }
  },
  {
    id: "strobe",
    label: "Strobe",
    base: "#0b0b0f",
    anim: true,
    layers: [
      { name: "Off", kind: "poly", fill: "#1e2228" },
      { name: "Dim", kind: "poly", fill: "#6e7a88" },
      { name: "Lit", kind: "poly", fill: "#f5f8fa" }
    ],
    build: (L, cx) => {
      for (let r = 0; r < 11; r++) {
        for (let c = 0; c < 15; c++) {
          const ph = Math.sin(cx.t * 4 + r * 0.9 + c * 0.6);
          cx.quad(
            L[ph > 0.7 ? 2 : ph > 0 ? 1 : 0],
            -1.35 + r * 0.255,
            c / 15 * Math.PI * 2,
            0.115,
            0.185
          );
        }
      }
    }
  }
];
var TEXTURE_BY_ID = Object.fromEntries(
  TEXTURES.map((t) => [t.id, t])
);
var TEXTURE_SLOTS = 4;
for (const t of TEXTURES) {
  if (t.layers.length > TEXTURE_SLOTS) {
    throw new Error(
      `texture "${t.id}" has ${t.layers.length} layers; TEXTURE_SLOTS is ${TEXTURE_SLOTS}. Raise it and every renderer's node pool follows \u2014 see the note above.`
    );
  }
}
var POSE_FIELDS = [
  "headX",
  "headY",
  "headZ",
  "widthLeft",
  "widthRight",
  "heightLeft",
  "heightRight",
  "spacing",
  "positionXLeft",
  "positionXRight",
  "positionYLeft",
  "positionYRight",
  "leftAngle",
  "rightAngle",
  "perspective"
];
var ANGLE_FIELDS = [
  "headX",
  "headY",
  "headZ",
  "leftAngle",
  "rightAngle"
];
var STEP_MS = 1e3 / 240;
var AMB_MS = 1e3 / 30;
var HOP_FADE_MS = 320;
var CHEEK_BLUR = 4.5;
var geomCache =  new Map();
function getGeometry(spec, dense, detail = 1) {
  const key = spec.id + "|" + (dense ? "d" : "l") + "|" + detail;
  const hit = geomCache.get(key);
  if (hit) return hit;
  const rim = shapePoints(spec.shape, spec.shapeArgs, detail);
  const rz = typeof spec.er === "number" ? spec.er : spec.er.z;
  const depth = rz * 1.02;
  const rings = buildRings(rim, depth, dense, detail);
  const rimTab = radiusTable(rim, 360);
  const meridians = buildMeridians(
    rimTab,
    depth,
    Math.round((dense ? 12 : 10) * detail),
    detail
  );
  const g = {
    rim,
    rings,
    meridians,
    loopsFull: rings.concat(meridians),
    rimTab,
    depth
  };
  geomCache.set(key, g);
  return g;
}
function neutralPose(spec) {
  return {
    headX: 0,
    headY: 0,
    headZ: 0,
    widthLeft: spec.eyes.w,
    widthRight: spec.eyes.w,
    heightLeft: spec.eyes.h,
    heightRight: spec.eyes.h,
    spacing: spec.eyes.sp,
    positionXLeft: 0,
    positionXRight: 0,
    positionYLeft: spec.eyes.py,
    positionYRight: spec.eyes.py,
    leftAngle: spec.eyes.aL,
    rightAngle: spec.eyes.aR,
    perspective: 1
  };
}
function createAvatar(spec, motion, dense, seedOff = 4.3, detail = 1) {
  const neutral = neutralPose(spec);
  const rx = typeof spec.er === "number" ? spec.er : spec.er.x;
  const ry = typeof spec.er === "number" ? spec.er : spec.er.y;
  const rz = typeof spec.er === "number" ? spec.er : spec.er.z;
  const A = {
    spec,
    rx,
    ry,
    rz,
    neutral,
    EXPR: buildExprs(neutral),
    geom: getGeometry(spec, dense, detail),
    detail,
    dense,
    gradR: Math.max(rx, ry) * 1.5,
    merOn: false,
    seedOff,
    motion,
    stepIndex: 0,
    stepStart: 0,
    startPose: { ...neutral },
    targetPose: { ...neutral },
    basePose: { ...neutral },
    transMs: 1,
    holdMs: 0,
    easing: "smooth",
    eyeFrom: "capsule",
    eyeTo: "capsule",
    eyeMorph: 1,
    blinking: false,
    blinkStart: 0,
    nextBlinkAt: 1e15,
    dblDone: false,
    winkSide: -1,
    amb: { hx: 0, hy: 0, hz: 0, ox: 0, oy: 0, ex: 0, ey: 0, px: 0, py: 0 },
    ambStep: -1,
    blinkSeq: 0,
    hopAmt: motion.hop ? 1 : 0,
    glideK: 0,
    glideAmt: spec.glide ? 1 : 0,
    flush: 0,
    flushT: 0,
    clock: 0,
    clockSteps: 0,
    acc: 0,
    lastNow: -1
  };
  beginStep(A, 0, 0, { ...neutral });
  A.nextBlinkAt = motion.blink.enabled ? motion.blink.initialDelayMs : 1e15;
  return A;
}
function beginStep(A, i, at, fromPose) {
  const st = A.motion.steps[i];
  A.stepIndex = i;
  A.stepStart = at;
  A.startPose = fromPose;
  A.eyeFrom = A.eyeTo || "capsule";
  A.eyeTo = st.eyeShape || "capsule";
  A.eyeMorph = A.eyeFrom === A.eyeTo ? 1 : 0;
  const t = { ...A.EXPR[st.expressionId] };
  for (const k of ANGLE_FIELDS) {
    if (st.spin && st.spin[k] != null) {
      t[k] = fromPose[k] + st.spin[k];
      continue;
    }
    let v = t[k];
    const s = fromPose[k];
    while (v - s > 180) v -= 360;
    while (v - s < -180) v += 360;
    t[k] = v;
  }
  A.targetPose = t;
  A.transMs = Math.max(st.transitionMs, 1);
  A.holdMs = st.holdMs;
  A.easing = st.transition;
  A.flushT = A.motion.flush && st.flush != null ? st.flush : 0;
}
function play(A, motion) {
  A.motion = motion;
  A.blinking = false;
  A.dblDone = false;
  A.winkSide = -1;
  A.eyeTo = A.eyeTo || "capsule";
  beginStep(A, 0, A.clock, { ...A.basePose });
  A.nextBlinkAt = motion.blink.enabled ? A.clock + motion.blink.initialDelayMs : 1e15;
}
function facePoint(x, y, rx, ry, rz) {
  const lon = x / R, lat = y / R;
  const fx = R * Math.cos(lat) * Math.sin(lon);
  const fy = R * Math.sin(lat);
  const k = 1 - fx / rx * (fx / rx) - fy / ry * (fy / ry);
  const z = rz * Math.sqrt(Math.max(0, k));
  const nx = fx / (rx * rx), ny = fy / (ry * ry), nz = z / (rz * rz);
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return { p: [fx, fy, z], n: [nx / nl, ny / nl, nz / nl] };
}
function mapEye(c, pts, cx, cy, ca, sa) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const px = pts[i][0], py = pts[i][1];
    const fp = facePoint(cx + px * ca - py * sa, cy + px * sa + py * ca, c.rx, c.ry, c.rz);
    const P = rotQ(c.q, fp.p), N = rotQ(c.q, fp.n);
    sum += N[2];
    const pr = project(P, c.persp);
    out.push(q2(pr[0] + c.slideX), q2(pr[1]));
  }
  const mean = sum / pts.length;
  return {
    o: { pts: out, ends: [pts.length] },
    op: sum <= 0 ? 0 : Math.max(0, Math.min(1, mean * 5))
  };
}
var INNER_TRAVEL = 0.55;
var ONE = [1, 1];
function eyeGeom(g, side, blink) {
  const st0 = g.style;
  const st = side > 0 && st0.R ? st0._r || (st0._r = Object.assign({}, st0, st0.R)) : st0;
  const sd = side < 0 ? -1 : 1;
  const pose = g.pose;
  const w = sd < 0 ? pose.widthLeft : pose.widthRight;
  const rh = sd < 0 ? pose.heightLeft : pose.heightRight;
  const h = 5 + (rh - 5) * blink;
  const spacing = pose.spacing * (st.spacing || 1);
  const styled = st.sclera || "ball";
  const shaped = g.eyeTo !== "capsule" || g.eyeFrom !== "capsule";
  const kind = shaped ? g.eyeMorph > 0.5 ? g.eyeTo : g.eyeFrom : styled;
  const base = eyeBase(
    g.neutral,
    side,
    w,
    spacing,
    kind === "capsule" ? styled : kind,
    st
  );
  const ang = ((sd < 0 ? pose.leftAngle : pose.rightAngle) + (side === 0 ? 0 : sd * (st.rot || 0)) + (st.tilt || 0) * sd) * Math.PI / 180;
  const cx = (side === 0 ? 0 : side * spacing / 2) + (sd < 0 ? pose.positionXLeft : pose.positionXRight) + g.eox + (st.ox || 0) * base;
  const cy = (sd < 0 ? pose.positionYLeft : pose.positionYRight) + g.eoy + (st.oy || 0) * base;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const pts = eyePts(
    g.neutral,
    side,
    g.eyeFrom,
    g.eyeTo,
    g.eyeMorph,
    w,
    h,
    spacing,
    st,
    g.eyeWK,
    g.eyeHK
  );
  const scl = mapEye(g.ctx, pts, cx, cy, ca, sa);
  const out = {
    sclera: scl.o,
    op: q3(scl.op),
    iris: null,
    pupil: null,
    glint: null,
    pop: 0
  };
  const nh = sd < 0 ? g.neutral.heightLeft : g.neutral.heightRight;
  const sq = Math.min(1.15, h / (nh || 1));
  const inw = side === 0 ? 1 : -sd;
  const inner = [];
  if (st.ir && !shaped) {
    const e = EYEEXTENT[st.ish || "ball"] || ONE;
    inner.push([st.ir * g.irisK * (st.isx || 1) * e[0], st.ir * g.irisK * (st.isy || 1) * e[1]]);
  }
  if (st.pr) {
    const pr = Math.min(st.pr, shaped ? 0.2 : 1) * g.pupilK;
    const e = EYEEXTENT[shaped ? "ball" : st.pupShape || "ball"] || ONE;
    const psx = shaped ? 1 : st.psx || 1, psy = shaped ? 1 : st.psy || 1;
    inner.push([pr * psx * e[0], pr * psy * e[1]]);
  }
  if (st.gl && !shaped) {
    const e = EYEEXTENT.ball || ONE;
    inner.push([st.gl * g.glintK * e[0], st.gl * g.glintK * e[1]]);
  }
  let gx = 0, gy = 0;
  if (inner.length > 0) {
    let relX = 0, relY = 0;
    for (const e of inner) {
      if (e[0] > relX) relX = e[0];
      if (e[1] > relY) relY = e[1];
    }
    const sx = st.sx || 1;
    const sy = st.sy || 1;
    const statX = shaped ? 0 : Math.abs(st.px || 0);
    const statY = shaped ? 0 : Math.abs(st.py || 0);
    const P = scl.o.pts;
    let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity;
    for (let i = 0; i < P.length; i += 2) {
      const x = P[i], y = P[i + 1];
      if (x < px0) px0 = x;
      if (x > px1) px1 = x;
      if (y < py0) py0 = y;
      if (y > py1) py1 = y;
    }
    const projHalfX = (px1 - px0) / 2, projHalfY = (py1 - py0) / 2;
    const roomX = projHalfX - relX * base - statX * sx * base;
    const roomY = projHalfY - relY * base * sq - statY * sy * base * sq;
    if (roomX > 0 && roomY > 0) {
      const SAFE = 0.6;
      gx = g.pox * roomX * INNER_TRAVEL * SAFE;
      gy = g.poy * roomY * INNER_TRAVEL * SAFE;
    }
  }
  const layer = (shapeKey, r, lsx, lsy, ox, oy) => {
    const U = EYEUNIT[shapeKey] || EYEUNIT.ball;
    const a = new Array(U.length);
    const dx = inw * ox * base * (st.sx || 1) + gx, dy = oy * base * sq * (st.sy || 1) + gy;
    for (let i = 0; i < U.length; i++) {
      a[i] = [dx + U[i][0] * r * lsx, dy + U[i][1] * r * lsy * sq];
    }
    return mapEye(g.ctx, a, cx, cy, ca, sa).o;
  };
  if (st.ir && !shaped) {
    out.iris = layer(
      st.ish || "ball",
      base * st.ir * g.irisK,
      st.isx || 1,
      st.isy || 1,
      st.ix || 0,
      st.iy || 0
    );
  }
  if (st.pr) {
    const pr = base * Math.min(st.pr, shaped ? 0.2 : 1) * g.pupilK;
    out.pupil = layer(
      shaped ? "ball" : st.pupShape || "ball",
      pr,
      shaped ? 1 : st.psx || 1,
      shaped ? 1 : st.psy || 1,
      shaped ? 0 : st.px || 0,
      shaped ? 0 : st.py || 0
    );
    out.pop = q3(scl.op);
  }
  if (st.gl && !shaped) {
    out.glint = layer("ball", base * st.gl * g.glintK, 1, 1, st.glx || 0, st.gly || 0);
  }
  return out;
}
var NO_DRAG = { x: 0, y: 0, active: false };
var TOPPER_ANCHOR_R = 110;
var SX = new Float64Array(512);
var SY = new Float64Array(512);
var SLAB_ANGLE = 42 * Math.PI / 180;
var slabCache =  new Map();
function slabRings(detail) {
  const hit = slabCache.get(detail);
  if (hit) return hit;
  const half = Math.max(3, Math.round(detail));
  const zMax = Math.sin(SLAB_ANGLE);
  const out = [];
  for (let k = -half; k <= half; k++) {
    const a = k / half * SLAB_ANGLE;
    out.push([1 - Math.cos(a), Math.sin(a) / zMax]);
  }
  slabCache.set(detail, out);
  return out;
}
function computeFrame(A, now, input) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  const cfg = input.config;
  const drag = input.drag || NO_DRAG;
  const dt = A.lastNow < 0 ? 0 : Math.min(now - A.lastNow, 100);
  A.lastNow = now;
  A.acc += dt * cfg.speed;
  const steps = Math.floor(A.acc / STEP_MS);
  if (steps > 0) {
    A.acc -= steps * STEP_MS;
    A.clockSteps += steps;
    A.clock = A.clockSteps * STEP_MS;
    if (A.spec.glide) {
      const travel = A.spec.glide.travel;
      for (let i = 0; i < steps; i++) {
        const ti = (A.clockSteps - steps + i + 1) * STEP_MS;
        A.glideK += (glideLeanTarget(ti, travel) - A.glideK) * GLIDE_LAG;
      }
    }
  }
  const t = A.clock;
  const mps = (_a = cfg.motionParams) == null ? void 0 : _a[A.motion.id];
  const K = (id) => motionParam(mps, id);
  const dwell = K("dwell");
  let elapsed = t - A.stepStart;
  let guard = 0;
  while (elapsed >= A.transMs + A.holdMs * dwell && guard++ < 64) {
    const carry = elapsed - (A.transMs + A.holdMs * dwell);
    const next = (A.stepIndex + 1) % A.motion.steps.length;
    beginStep(A, next, t - carry, { ...A.targetPose });
    elapsed = t - A.stepStart;
  }
  const p = Math.min(elapsed / A.transMs, 1);
  const e = ease(A.easing, p);
  const base = {};
  for (const k of POSE_FIELDS) {
    base[k] = A.startPose[k] + (A.targetPose[k] - A.startPose[k]) * e;
  }
  A.basePose = base;
  A.eyeMorph = e;
  const pose = { ...base };
  pose.widthLeft *= cfg.eyeWidth;
  pose.widthRight *= cfg.eyeWidth;
  pose.heightLeft *= cfg.eyeHeight;
  pose.heightRight *= cfg.eyeHeight;
  pose.spacing *= cfg.eyeSpacing;
  pose.positionYLeft -= cfg.eyeRaise;
  pose.positionYRight -= cfg.eyeRaise;
  pose.leftAngle += cfg.eyeAngle;
  pose.rightAngle -= cfg.eyeAngle;
  pose.perspective = cfg.perspective;
  const bx = cfg.stretchX, by = cfg.stretchY, bz = cfg.depth;
  const neutral = {
    widthLeft: A.neutral.widthLeft * cfg.eyeWidth,
    widthRight: A.neutral.widthRight * cfg.eyeWidth,
    heightLeft: A.neutral.heightLeft * cfg.eyeHeight,
    heightRight: A.neutral.heightRight * cfg.eyeHeight
  };
  const bl = A.motion.blink;
  let blinkL = 1, blinkR = 1;
  if (bl.enabled && cfg.blink) {
    if (!A.blinking && t >= A.nextBlinkAt) {
      A.blinking = true;
      A.blinkStart = t;
    }
    if (A.blinking) {
      const u = (t - A.blinkStart) / bl.durationMs;
      let bv = 1;
      if (u >= 1) {
        A.blinking = false;
        if (A.motion.wink) A.winkSide = -A.winkSide;
        if (bl.double && !A.dblDone) {
          A.dblDone = true;
          A.nextBlinkAt = t + 150;
        } else {
          A.dblDone = false;
          A.nextBlinkAt = t + (bl.minIntervalMs + hash01(A.blinkSeq++ * 7.13 + A.seedOff) * (bl.maxIntervalMs - bl.minIntervalMs)) / cfg.blinkRate;
        }
      } else if (u < 0.42) {
        const v = u / 0.42;
        bv = 1 - v * v;
      } else {
        const wv = (u - 0.42) / 0.58;
        bv = 1 - (1 - wv) * (1 - wv);
      }
      if (A.motion.wink) {
        if (A.winkSide < 0) blinkL = bv;
        else blinkR = bv;
      } else {
        blinkL = bv;
        blinkR = bv;
      }
    }
  } else {
    A.blinking = false;
    A.nextBlinkAt = t + (bl.initialDelayMs || 2e3);
  }
  const ms = ((_b = A.motion.motionScale) != null ? _b : 1) * cfg.motionAmount;
  const ambStep = Math.floor(t / AMB_MS);
  if (ambStep !== A.ambStep) {
    A.ambStep = ambStep;
    const at = ambStep * AMB_MS;
    const M = A.amb, bm = A.motion.bodyMotion, em = A.motion.eyeMotion;
    if (bm === "slowDrift") {
      const seed = A.targetPose.headX * 0.71 + A.targetPose.headY * 1.13 + A.targetPose.headZ * 1.37 + A.seedOff;
      const da = K("driftAmount"), ds = K("driftSpeed");
      M.hx = sn(at, 0, seed, 2600 / ds) * 0.8 * da;
      M.hy = sn(at, 1, seed, 3300 / ds) * 1.15 * da;
      M.hz = sn(at, 2, seed, 4100 / ds) * 0.45 * da;
      M.ox = sn(at, 3, seed, 2900 / ds) * 1.45 * da;
      M.oy = sn(at, 4, seed, 3700 / ds) * 1.1 * da;
    } else if (bm === "shake") {
      const sa = K("shakeAmount"), ss = K("shakeSpeed");
      const tt = (at + A.seedOff * 14) / 1e3 * ss;
      M.hx = (Math.sin(31 * tt) + 0.45 * Math.sin(53 * tt)) * 1.15 * sa;
      M.hy = (Math.sin(37 * tt) + 0.4 * Math.sin(61 * tt)) * 1.35 * sa;
      M.hz = Math.sin(43 * tt) * 0.7 * sa;
      M.ox = (Math.sin(31 * tt) + 0.45 * Math.sin(53 * tt)) * 1.35 * sa;
      M.oy = (Math.sin(37 * tt) + 0.4 * Math.sin(61 * tt)) * 1.1 * sa;
    } else {
      M.hx = M.hy = M.hz = M.ox = M.oy = 0;
    }
    if (em === "microSaccades") {
      const gz = K("gaze");
      M.ex = sacc(at, 0, A.seedOff) * 1.5 * gz;
      M.ey = sacc(at, 1, A.seedOff) * 0.9 * gz;
      M.px = sacc(at, 2, A.seedOff) * gz;
      M.py = sacc(at, 3, A.seedOff) * gz;
    } else {
      M.ex = M.ey = M.px = M.py = 0;
    }
  }
  const s = drag.active ? 0 : e;
  let hx = base.headX + A.amb.hx * s * ms + cfg.tilt;
  let hy = base.headY + A.amb.hy * s * ms + cfg.turn;
  const hz = base.headZ + A.amb.hz * s * ms + cfg.lean;
  hx += drag.x;
  hy += drag.y;
  const q = quatFromEuler(hx, hy, 0);
  const persp = Math.max(pose.perspective, 1e-4);
  const styleSpread = Math.max(1, (_c = input.style.spacing) != null ? _c : 1);
  const eyeSlideX = A.spec.glide && A.glideAmt > 0 ? ease("smooth", A.glideAmt) * GLIDE_EYE_SLIDE * (Math.abs(A.glideK) < GLIDE_DEADZONE ? 0 : A.glideK) / styleSpread : 0;
  const ctx = {
    rx: A.rx * bx,
    ry: A.ry * by,
    rz: A.rz * bz,
    q,
    persp,
    slideX: eyeSlideX
  };
  const transform = {
    tx: A.amb.ox * s * ms,
    ty: A.amb.oy * s * ms,
    rot: hz,
    sx: 1,
    sy: 1
  };
  const hopTarget = A.motion.hop ? 1 : 0;
  if (steps > 0 && A.hopAmt !== hopTarget) {
    const d = steps * STEP_MS / HOP_FADE_MS;
    A.hopAmt = hopTarget > A.hopAmt ? Math.min(hopTarget, A.hopAmt + d) : Math.max(hopTarget, A.hopAmt - d);
  }
  if (A.hopAmt > 0) {
    const hh = K("hopHeight");
    const hb = Math.pow(Math.abs(Math.sin(t / 1e3 * 3.4 * K("hopSpeed") + A.seedOff)), 0.65);
    const sqz = (1 - hb) * hh;
    const w = ease("smooth", A.hopAmt);
    transform.tx = transform.tx * (1 - w);
    transform.ty = transform.ty * (1 - w) + -hb * 11 * hh * w;
    transform.sx = 1 - 0.045 * sqz * w;
    transform.sy = 1 + 0.06 * sqz * w;
  }
  {
    const gTarget = A.spec.glide && cfg.glide ? 1 : 0;
    if (steps > 0 && A.glideAmt !== gTarget) {
      const d = steps * STEP_MS / GLIDE_FADE_MS;
      A.glideAmt = gTarget > A.glideAmt ? Math.min(gTarget, A.glideAmt + d) : Math.max(gTarget, A.glideAmt - d);
    }
    if (A.spec.glide && A.glideAmt > 0) {
      const w = ease("smooth", A.glideAmt);
      const k = Math.abs(A.glideK) < GLIDE_DEADZONE ? 0 : A.glideK;
      transform.tx += glideX(t) * A.spec.glide.travel * w;
      transform.ty += GLIDE_BOB_AMP * Math.sin(t * GLIDE_BOB_RATE) * w;
      transform.rot += GLIDE_LEAN_DEG * k * w;
    }
  }
  transform.tx = q2(transform.tx);
  transform.ty = q2(transform.ty);
  transform.rot = q2(transform.rot);
  transform.sx = q3(transform.sx);
  transform.sy = q3(transform.sy);
  const turn = Math.max(
    Math.abs(Math.sin(hy * Math.PI / 180)),
    Math.abs(Math.sin(hx * Math.PI / 180))
  );
  if (A.merOn ? turn < 0.07 : turn > 0.13) A.merOn = !A.merOn;
  let loops = A.merOn ? A.geom.loopsFull : A.geom.rings;
  let rimTab = A.geom.rimTab;
  if ((_d = A.spec.glide) == null ? void 0 : _d.skirt) {
    const w = ease("smooth", A.glideAmt);
    const gk = (Math.abs(A.glideK) < GLIDE_DEADZONE ? 0 : A.glideK) * w;
    const dRim = ghostRimDeformed(A.detail, gk, t, 1);
    const rings = buildRings(dRim, A.geom.depth, A.dense, A.detail);
    if (A.merOn) {
      rimTab = radiusTable(dRim, 360);
      loops = rings.concat(
        buildMeridians(
          rimTab,
          A.geom.depth,
          Math.round((A.dense ? 12 : 10) * A.detail),
          A.detail
        )
      );
    } else {
      loops = rings;
    }
  }
  const bodyPts = [];
  const bodyEnds = [];
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const emitInto = (dstPts, dstEnds, pts3, hole) => {
    const n = pts3.length;
    if (SX.length < n) {
      SX = new Float64Array(n * 2);
      SY = new Float64Array(n * 2);
    }
    for (let i = 0; i < n; i++) {
      const p2 = pts3[i];
      const p0 = p2[0] * bx, p1 = p2[1] * by, p22 = p2[2] * bz;
      const tx = 2 * (qy * p22 - qz * p1);
      const ty = 2 * (qz * p0 - qx * p22);
      const tz = 2 * (qx * p1 - qy * p0);
      const X = p0 + qw * tx + (qy * tz - qz * ty);
      const Y = p1 + qw * ty + (qz * tx - qx * tz);
      const Z = p22 + qw * tz + (qx * ty - qy * tx);
      let den = F - Z * persp;
      if (den < 1e-4 && den > -1e-4) den = 1e-4;
      const sc = F / den;
      SX[i] = X * sc;
      SY[i] = Y * sc;
    }
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += SX[i] * SY[j] - SX[j] * SY[i];
    }
    const rev = hole ? area > 0 : area < 0;
    for (let k = 0; k < n; k++) {
      const i = rev ? n - 1 - k : k;
      dstPts.push(q1(SX[i]), q1(SY[i]));
    }
    dstEnds.push(dstPts.length >> 1);
  };
  const emit = (pts3, hole) => emitInto(bodyPts, bodyEnds, pts3, hole);
  for (let ri = 0; ri < loops.length; ri++) emit(loops[ri], false);
  let texture;
  const texSpec = TEXTURE_BY_ID[cfg.textureId];
  if ((texSpec == null ? void 0 : texSpec.build) && cfg.textureOpacity > 0 && A.spec.texture !== false) {
    const rk = SHELL_PROUD;
    const ctx2 = makeTexCtx({
      q,
      persp,
      rim: rimTab,
      rk,
      bx,
      by,
      sz: A.geom.depth * rk * bz,
      t: t / 1e3,
      density: cfg.textureDensity
    });
    const sinks = texSpec.layers.map(() => newSink());
    texSpec.build(sinks, ctx2);
    const layers = [];
    for (let i = 0; i < sinks.length; i++) {
      const o = sinkOutline(sinks[i]);
      if (!o) continue;
      const spec = texSpec.layers[i];
      const over = (_e = cfg.textureColors) == null ? void 0 : _e[cfg.textureId + ":" + i];
      const paintKey = spec.fill ? "fill" : "stroke";
      layers.push({
        o,
        closed: spec.kind !== "line",
        fill: paintKey === "fill" ? over || spec.fill || "" : "",
        stroke: paintKey === "stroke" ? over || spec.stroke || "" : "",
        width: q3(((_f = spec.w) != null ? _f : 1) * cfg.textureWidth),
        opacity: q3(((_g = spec.op) != null ? _g : 1) * cfg.textureOpacity)
      });
    }
    if (layers.length > 0) texture = layers;
  }
  const ovPts = [];
  const ovEnds = [];
  const emitOverlay = (pts3, hole) => emitInto(ovPts, ovEnds, pts3, hole);
  if (input.topper) {
    const ts = cfg.topperSize, lift = cfg.topperLift, spread = cfg.topperSpread, height = cfg.topperHeight, across = cfg.topperAcross;
    const thickness = ((_h = input.topper.thickness) != null ? _h : 0) * ts * cfg.topperDepth;
    const ta = cfg.topperTilt * Math.PI / 180, tc = Math.cos(ta), tsn = Math.sin(ta);
    const occ = cfg.topperColor ? makeOccluder(rimTab, A.geom.depth, q, persp, bx, by, bz) : null;
    const emitTopper = (p2, hole, loft, out, occ2) => {
      if (occ2) p2 = densify(p2);
      const n = p2.length;
      if (!loft) {
        const v = occ2 ? occludeLoop(occ2, p2) : p2;
        if (v) out(v, hole);
        return;
      }
      const rings3 = slabRings(A.detail);
      const rings = rings3.map(([tuck, zf]) => {
        const r = new Array(n);
        const z = thickness * zf;
        const d = thickness * tuck;
        for (let i = 0; i < n; i++) {
          const px = p2[i][0], py = p2[i][1];
          const rad = Math.max(Math.sqrt(px * px + py * py), 1e-3);
          const c = 1 - d / rad;
          r[i] = [px * c, py * c, z];
        }
        return r;
      });
      const shown = occ2 ? rings.map((r) => occludeLoop(occ2, r)) : rings;
      for (let k = 0; k < shown.length; k++) {
        const r = shown[k];
        if (r) out(r, false);
      }
      const quad = new Array(4);
      for (let k = 0; k + 1 < shown.length; k++) {
        const Aring = shown[k], Bring = shown[k + 1];
        if (!Aring || !Bring) continue;
        for (let i = 0; i < n; i++) {
          const j = i + 1 === n ? 0 : i + 1;
          quad[0] = Aring[i];
          quad[1] = Aring[j];
          quad[2] = Bring[j];
          quad[3] = Bring[i];
          out(quad, false);
        }
      }
    };
    for (const L of input.topper.loops) {
      const n = L.pts.length;
      const pts = new Array(n);
      let flat = true;
      for (let i = 0; i < n; i++) {
        const pt = L.pts[i];
        const r = Math.sqrt(pt[0] * pt[0] + pt[1] * pt[1] + pt[2] * pt[2]);
        const s2 = r > TOPPER_ANCHOR_R ? TOPPER_ANCHOR_R / r : 1;
        const ax = pt[0] * s2, ay = pt[1] * s2, az = pt[2] * s2;
        const g2 = r > TOPPER_ANCHOR_R ? ts : 1;
        const x = (ax + (pt[0] - ax) * g2) * spread + across, y = ay + (pt[1] - ay) * g2 * height - lift;
        pts[i] = [x * tc - y * tsn, x * tsn + y * tc, az + (pt[2] - az) * g2];
        if (pt[2] > 1e-6 || pt[2] < -1e-6) flat = false;
      }
      const loft = thickness > 0 && flat && !L.hole;
      emitTopper(pts, !!L.hole, loft, emit, null);
      if (occ) emitTopper(pts, !!L.hole, loft, emitOverlay, occ);
    }
  }
  const st = input.style;
  const morph = cfg.eyeMorph !== false;
  const g = {
    ctx,
    pose,
    neutral,
    style: st,
    eyeFrom: morph ? A.eyeFrom : "capsule",
    eyeTo: morph ? A.eyeTo : "capsule",
    eyeMorph: morph ? A.eyeMorph : 1,
    eox: A.amb.ex * s * ms,
    eoy: A.amb.ey * s * ms,
    pox: A.amb.px * s * ms,
    poy: A.amb.py * s * ms,
    eyeWK: cfg.eyeWidth,
    eyeHK: cfg.eyeHeight,
    irisK: cfg.irisSize,
    pupilK: cfg.pupilSize,
    glintK: cfg.glintSize
  };
  const fspec = cfg.flush ? A.motion.flush : void 0;
  const overlays = [];
  let ramp = null;
  if (fspec) {
    const pick = (_i = cfg.flushColors) == null ? void 0 : _i[A.motion.id];
    const col = pick || fspec.color;
    const hi = pick ? mix(pick, "#ffffff", 0.25) : fspec.hi || fspec.color;
    const lo = pick ? mix(pick, "#000000", 0.35) : fspec.lo || fspec.color;
    if (steps > 0 && A.flush !== A.flushT) {
      A.flush += (A.flushT - A.flush) * (1 - Math.exp(-(steps * STEP_MS) / fspec.tauMs));
    }
    const fl = A.flush;
    if (fl > 4e-3) {
      if (fspec.mode === "face") {
        const p2 = bodyPaint(cfg, A.spec);
        ramp = {
          light: mix(p2.light, hi, fl),
          mid: mix(p2.mid, col, fl),
          dark: mix(p2.dark, lo, fl * 0.85)
        };
      } else {
        const e2 = A.spec.eyes;
        const cw = e2.w * 1.2;
        const cx = e2.sp / 2 + e2.w * 1.35;
        const cy = e2.py + e2.h * 0.62 + 4;
        const cpts = outline(cw, cw);
        const ca2 = Math.cos(0.22), sa2 = Math.sin(0.22);
        const L = mapEye(ctx, cpts, -cx, cy, ca2, sa2);
        const Rr = mapEye(ctx, cpts, cx, cy, ca2, -sa2);
        const k = fl * 0.95;
        overlays.push({
          id: "cheekL",
          o: L.o,
          color: col,
          opacity: q3(L.op * k),
          blur: CHEEK_BLUR
        });
        overlays.push({
          id: "cheekR",
          o: Rr.o,
          color: col,
          opacity: q3(Rr.op * k),
          blur: CHEEK_BLUR
        });
      }
    }
  }
  {
    const surface = SURFACE_BY_ID[cfg.surfaceId];
    if (surface == null ? void 0 : surface.glints) {
      for (const gl of surface.glints) {
        const G = mapEye(
          ctx,
          outline(gl.w, gl.h),
          gl.x,
          gl.y,
          Math.cos(gl.angle),
          Math.sin(gl.angle)
        );
        if (G.o.ends.length === 0) continue;
        overlays.push({
          id: gl.id,
          o: G.o,
          color: "#FFFFFF",
          opacity: q3(G.op * gl.opacity),
          blur: CHEEK_BLUR
        });
      }
    }
  }
  if (cfg.topperColor && ovEnds.length > 0) {
    overlays.push({
      id: "topper",
      o: { pts: ovPts, ends: ovEnds },
      color: cfg.topperColor,
      opacity: 1,
      blur: 0
    });
  }
  return {
    body: { pts: bodyPts, ends: bodyEnds },
    transform,
    eyeL: st.mono ? null : eyeGeom(g, -1, blinkL),
    eyeR: st.mono ? null : eyeGeom(g, 1, blinkR),
    eyeC: st.mono || st.three ? eyeGeom(g, 0, blinkL) : null,
    overlays,
    ramp,
    ...texture ? { texture } : {}
  };
}
var TOPPER_ANCHOR_R2 = 110;
function contentExtent(spec, cfg, topper, motion) {
  var _a, _b, _c;
  const SKIRT_REACH = 141.7688 / 116;
  const SKIRT_PARKED_REACH = 117.046 / 116;
  const rimR = ((_a = spec.glide) == null ? void 0 : _a.skirt) ? bodyExtent(spec) * (cfg.glide ? SKIRT_REACH : SKIRT_PARKED_REACH) : bodyExtent(spec);
  const rz = (typeof spec.er === "number" ? spec.er : spec.er.z) * 1.02;
  const bx = cfg.stretchX, by = cfg.stretchY, bz = cfg.depth;
  let maxR = Math.max(rimR * Math.max(bx, by), rz * bz);
  if (topper) {
    const ts = cfg.topperSize, lift = cfg.topperLift, spread = cfg.topperSpread, height = cfg.topperHeight, across = cfg.topperAcross;
    const ta = cfg.topperTilt * Math.PI / 180, tc = Math.cos(ta), tsn = Math.sin(ta);
    const thickness = ((_b = topper.thickness) != null ? _b : 0) * ts * cfg.topperDepth;
    for (const L of topper.loops) {
      for (const pt of L.pts) {
        const r = Math.sqrt(pt[0] * pt[0] + pt[1] * pt[1] + pt[2] * pt[2]);
        const s = r > TOPPER_ANCHOR_R2 ? TOPPER_ANCHOR_R2 / r : 1;
        const ax = pt[0] * s, ay = pt[1] * s, az = pt[2] * s;
        const g = r > TOPPER_ANCHOR_R2 ? ts : 1;
        const x0 = (ax + (pt[0] - ax) * g) * spread + across, y0 = ay + (pt[1] - ay) * g * height - lift;
        const x = (x0 * tc - y0 * tsn) * bx, y = (x0 * tsn + y0 * tc) * by, z = (az + (pt[2] - az) * g) * bz;
        const zt = z + (z >= 0 ? thickness : -thickness);
        const m = Math.sqrt(x * x + y * y + zt * zt);
        if (m > maxR) maxR = m;
      }
    }
  }
  const persp = Math.max(cfg.perspective, 1e-4);
  const denom = Math.sqrt(Math.max(F * F - maxR * maxR * persp * persp, 1e-6));
  const screenR = maxR * F / denom;
  let margin = 6;
  if (motion == null ? void 0 : motion.hop) {
    margin += 11 * motionParam((_c = cfg.motionParams) == null ? void 0 : _c[motion.id], "hopHeight");
  }
  if (spec.glide && cfg.glide) {
    margin += spec.glide.travel;
  }
  return (screenR + margin) / Math.max(cfg.size, 1e-6);
}
var VELOCITY_TAU = 90;
var RETURN_TAU = 150;
var MAX_PITCH = 70;
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var DRAG_GAIN = 0.55;
function stepDrag(d, dtMs) {
  if (d.active) return;
  const dt = Math.min(Math.max(dtMs, 0), 100);
  if (dt <= 0) return;
  d.x = clamp(d.x + d.vx * dt, -MAX_PITCH, MAX_PITCH);
  d.y += d.vy * dt;
  const kv = Math.exp(-dt / VELOCITY_TAU);
  const kr = Math.exp(-dt / RETURN_TAU);
  d.vx *= kv;
  d.vy *= kv;
  d.x *= kr;
  d.y *= kr;
  if (Math.abs(d.vx) < 1e-4) d.vx = 0;
  if (Math.abs(d.vy) < 1e-4) d.vy = 0;
  if (Math.abs(d.x) < 0.02) d.x = 0;
  if (Math.abs(d.y) < 0.02) d.y = 0;
}
function moveDrag(d, dxPx, dyPx, dtMs) {
  const dx = dxPx * DRAG_GAIN;
  const dy = dyPx * DRAG_GAIN;
  d.y += dx;
  d.x = clamp(d.x - dy, -MAX_PITCH, MAX_PITCH);
  const dt = Math.max(dtMs, 1);
  d.vx = -dy / dt;
  d.vy = dx / dt;
}
var EYE_STYLES = [
  {
    id: "plain",
    label: "Plain"
  },
  {
    id: "visorSlit",
    label: "Visor slit",
    sclera: "bar",
    scale: 1.5,
    sy: 0.38,
    pr: 0.24,
    spacing: 1.22
  },
  {
    id: "scowl",
    label: "Scowl",
    sclera: "lidL",
    scale: 1.46,
    sy: 1.4,
    pr: 0.22,
    px: 0.26,
    py: 0.28,
    spacing: 0.86,
    R: { sclera: "lidR" }
  },
  {
    id: "venom",
    label: "Venom",
    sclera: "venomL",
    scale: 1.7,
    sy: 1.15,
    spacing: 2.3,
    cap: 2.6,
    R: { sclera: "venomR" }
  }
];
var EYE_STYLE_BY_ID = Object.fromEntries(
  EYE_STYLES.map((s) => [s.id, s])
);
var S = (expressionId, transitionMs, transition, holdMs, extra) => ({ expressionId, transitionMs, transition, holdMs, ...extra });
var MOTIONS = [
  {
    id: "idle",
    name: "Idle",
    bodyMotion: "slowDrift",
    eyeMotion: "microSaccades",
    steps: [
      S("neutral", 500, "smooth", 5200),
      S("glanceRight", 500, "smooth", 3600),
      S("neutral", 500, "smooth", 5200),
      S("glanceLeft", 500, "smooth", 3600)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2600,
      minIntervalMs: 3400,
      maxIntervalMs: 6200,
      durationMs: 280
    }
  },
  {
    id: "listening",
    name: "Listening",
    bodyMotion: "slowDrift",
    eyeMotion: "microSaccades",
    steps: [
      S("attentive", 420, "smooth", 3200),
      S("tiltCurious", 520, "smooth", 2800, { eyeShape: "flower" }),
      S("attentive", 420, "smooth", 3200)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 3200,
      minIntervalMs: 4800,
      maxIntervalMs: 7200,
      durationMs: 240
    }
  },
  {
    id: "thinking",
    name: "Thinking",
    bodyMotion: "slowDrift",
    eyeMotion: "microSaccades",
    steps: [
      S("lookUp", 600, "smooth", 3600, { eyeShape: "gem" }),
      S("glanceLeft", 600, "smooth", 2600, { eyeShape: "gem" }),
      S("lookUp", 600, "smooth", 3600, { eyeShape: "gem" }),
      S("neutral", 600, "smooth", 2200)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2100,
      minIntervalMs: 2800,
      maxIntervalMs: 5e3,
      durationMs: 260
    }
  },
  {
    id: "excited",
    name: "Excited",
    bodyMotion: "shake",
    eyeMotion: "none",
    steps: [
      S("squintHappy", 220, "snappy", 900),
      S("widePop", 280, "spring", 1e3, { eyeShape: "star" }),
      S("wide", 300, "smooth", 700, { eyeShape: "star" }),
      S("squintHappy", 240, "snappy", 900)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1200,
      minIntervalMs: 1800,
      maxIntervalMs: 3600,
      durationMs: 220
    }
  },
  {
    id: "happy",
    name: "Happy",
    bodyMotion: "slowDrift",
    motionScale: 0.7,
    eyeMotion: "none",
    steps: [
      S("squintHappy", 260, "snappy", 1500),
      S("wide", 420, "spring", 1200, { eyeShape: "heart" }),
      S("squintHappy", 300, "snappy", 1500)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1800,
      minIntervalMs: 2600,
      maxIntervalMs: 4400,
      durationMs: 200
    }
  },
  {
    id: "sad",
    name: "Sad",
    bodyMotion: "slowDrift",
    motionScale: 0.7,
    eyeMotion: "none",
    steps: [
      S("sad", 700, "smooth", 2400),
      S("sadLower", 900, "smooth", 2400)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2200,
      minIntervalMs: 3400,
      maxIntervalMs: 5600,
      durationMs: 360
    }
  },
  {
    id: "angry",
    name: "Angry",
    bodyMotion: "shake",
    motionScale: 0.45,
    eyeMotion: "none",
    flush: { mode: "face", color: "#E0393E", hi: "#F06A4F", lo: "#8E1F1B", tauMs: 950 },
    steps: [
      S("angry", 240, "snappy", 1400, { flush: 0.55 }),
      S("angryHard", 240, "snappy", 2100, { flush: 1 }),
      S("neutral", 1300, "smooth", 2100, { flush: 0 })
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1600,
      minIntervalMs: 2400,
      maxIntervalMs: 4200,
      durationMs: 160
    }
  },
  {
    id: "surprised",
    name: "Surprised",
    bodyMotion: "none",
    eyeMotion: "none",
    steps: [
      S("surprised", 130, "snappy", 1100, { eyeShape: "diamond" }),
      S("neutral", 420, "smooth", 1300),
      S("surprised", 130, "snappy", 900, { eyeShape: "diamond" }),
      S("perk", 360, "smooth", 1200)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2600,
      minIntervalMs: 3600,
      maxIntervalMs: 5600,
      durationMs: 160
    }
  },
  {
    id: "confused",
    name: "Confused",
    bodyMotion: "slowDrift",
    motionScale: 0.8,
    eyeMotion: "microSaccades",
    steps: [
      S("confused", 420, "smooth", 1700),
      S("confusedFlip", 560, "smooth", 1700)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1900,
      minIntervalMs: 2600,
      maxIntervalMs: 4600,
      durationMs: 240
    }
  },
  {
    id: "curious",
    name: "Curious",
    bodyMotion: "slowDrift",
    motionScale: 0.8,
    eyeMotion: "microSaccades",
    steps: [
      S("tiltCurious", 380, "smooth", 1500),
      S("perk", 300, "snappy", 1e3, { eyeShape: "sparkle" }),
      S("tiltCuriousR", 380, "smooth", 1500)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1700,
      minIntervalMs: 2400,
      maxIntervalMs: 4200,
      durationMs: 220
    }
  },
  {
    id: "shy",
    name: "Shy",
    bodyMotion: "slowDrift",
    motionScale: 0.6,
    eyeMotion: "none",
    flush: { mode: "cheeks", color: "#F2A9C4", tauMs: 650 },
    steps: [
      S("neutral", 500, "smooth", 2400, { flush: 0.12 }),
      S("shyAway", 700, "smooth", 3e3, { flush: 1 }),
      S("shyPeek", 500, "smooth", 1800, { flush: 0.55 })
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2200,
      minIntervalMs: 3e3,
      maxIntervalMs: 5200,
      durationMs: 260
    }
  },
  {
    id: "wink",
    name: "Winking",
    bodyMotion: "slowDrift",
    motionScale: 0.8,
    eyeMotion: "microSaccades",
    wink: true,
    steps: [
      S("neutral", 400, "smooth", 2200),
      S("tiltLeft", 320, "smooth", 1400),
      S("neutral", 400, "smooth", 2200),
      S("tiltRight", 320, "smooth", 1400)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1600,
      minIntervalMs: 2200,
      maxIntervalMs: 4200,
      durationMs: 260
    }
  },
  {
    id: "squint",
    name: "Squint",
    bodyMotion: "slowDrift",
    motionScale: 0.6,
    eyeMotion: "microSaccades",
    steps: [
      S("narrowSquint", 420, "smooth", 2200),
      S("neutral", 420, "smooth", 1e3)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2400,
      minIntervalMs: 3200,
      maxIntervalMs: 5e3,
      durationMs: 200
    }
  },
  {
    id: "sideEye",
    name: "Side-eye",
    bodyMotion: "slowDrift",
    motionScale: 0.6,
    eyeMotion: "none",
    steps: [
      S("sideEye", 620, "smooth", 2300, { eyeShape: "lens" }),
      S("neutral", 460, "smooth", 1100),
      S("sideEyeL", 620, "smooth", 2300, { eyeShape: "lens" })
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2200,
      minIntervalMs: 3e3,
      maxIntervalMs: 5200,
      durationMs: 240
    }
  },
  {
    id: "alert",
    name: "Alert",
    bodyMotion: "shake",
    motionScale: 0.3,
    eyeMotion: "microSaccades",
    steps: [
      S("perk", 160, "snappy", 1200),
      S("scanRight", 180, "snappy", 520),
      S("scanLeft", 180, "snappy", 520),
      S("perk", 180, "snappy", 800)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1400,
      minIntervalMs: 2e3,
      maxIntervalMs: 3400,
      durationMs: 150
    }
  },
  {
    id: "scan",
    name: "Scan",
    bodyMotion: "shake",
    motionScale: 0.28,
    eyeMotion: "microSaccades",
    steps: [
      S("scanRight", 150, "snappy", 560),
      S("scanLeft", 150, "snappy", 560),
      S("scanUp", 140, "snappy", 400),
      S("neutral", 170, "snappy", 820)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1300,
      minIntervalMs: 1500,
      maxIntervalMs: 2800,
      durationMs: 170,
      double: true
    }
  },
  {
    id: "lookAround",
    name: "Look around",
    bodyMotion: "slowDrift",
    motionScale: 0.7,
    eyeMotion: "microSaccades",
    steps: [
      S("lookUp", 560, "smooth", 1100),
      S("glanceRight", 520, "smooth", 1e3),
      S("lookDown", 520, "smooth", 1e3),
      S("glanceLeft", 520, "smooth", 1e3)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1800,
      minIntervalMs: 2600,
      maxIntervalMs: 4400,
      durationMs: 240
    }
  },
  {
    id: "peek",
    name: "Peeking",
    bodyMotion: "slowDrift",
    motionScale: 0.7,
    eyeMotion: "none",
    steps: [
      S("neutral", 500, "smooth", 2e3),
      S("peekRight", 650, "smooth", 2600),
      S("neutral", 500, "smooth", 1600),
      S("peekLeft", 650, "smooth", 2600)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2400,
      minIntervalMs: 3200,
      maxIntervalMs: 5600,
      durationMs: 260
    }
  },
  {
    id: "nod",
    name: "Nod yes",
    bodyMotion: "none",
    eyeMotion: "none",
    steps: [
      S("nodDown", 190, "snappy", 90),
      S("nodUp", 210, "snappy", 130),
      S("nodDown", 190, "snappy", 90),
      S("neutral", 300, "smooth", 1300)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2e3,
      minIntervalMs: 2800,
      maxIntervalMs: 4600,
      durationMs: 220
    }
  },
  {
    id: "shakeNo",
    name: "Shake no",
    bodyMotion: "none",
    eyeMotion: "none",
    steps: [
      S("shakeL", 180, "snappy", 70),
      S("shakeR", 180, "snappy", 70),
      S("shakeL", 180, "snappy", 70),
      S("neutral", 280, "smooth", 1200)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2e3,
      minIntervalMs: 2800,
      maxIntervalMs: 4600,
      durationMs: 220
    }
  },
  {
    id: "bored",
    name: "Bored",
    bodyMotion: "slowDrift",
    motionScale: 1.1,
    eyeMotion: "none",
    steps: [
      S("drowsy", 800, "smooth", 2200),
      S("boredSide", 900, "smooth", 2600),
      S("drowsy", 800, "smooth", 1800)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2600,
      minIntervalMs: 3400,
      maxIntervalMs: 5400,
      durationMs: 380
    }
  },
  {
    id: "sleepy",
    name: "Sleepy",
    bodyMotion: "slowDrift",
    motionScale: 1.3,
    eyeMotion: "none",
    steps: [
      S("drowsy", 1200, "smooth", 2e3),
      S("narrowSquint", 900, "smooth", 900),
      S("drowsy", 1100, "smooth", 2400)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1800,
      minIntervalMs: 2400,
      maxIntervalMs: 3800,
      durationMs: 620
    }
  },
  {
    id: "yawn",
    name: "Yawn",
    bodyMotion: "slowDrift",
    motionScale: 1.1,
    eyeMotion: "none",
    steps: [
      S("drowsy", 600, "smooth", 900),
      S("yawnWide", 380, "snappy", 1e3),
      S("drowsy", 700, "smooth", 1500)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2400,
      minIntervalMs: 3e3,
      maxIntervalMs: 4600,
      durationMs: 420
    }
  },
  {
    id: "sleep",
    name: "Sleeping",
    bodyMotion: "slowDrift",
    motionScale: 1.4,
    eyeMotion: "none",
    steps: [
      S("sleep", 1500, "smooth", 4600),
      S("sleepDrift", 1500, "smooth", 5e3)
    ],
    blink: {
      enabled: false,
      initialDelayMs: 0,
      minIntervalMs: 0,
      maxIntervalMs: 0,
      durationMs: 0
    }
  },
  {
    id: "meditate",
    name: "Meditate",
    bodyMotion: "slowDrift",
    motionScale: 1.2,
    eyeMotion: "none",
    steps: [
      S("drowsy", 1400, "smooth", 2200),
      S("drowsyLeft", 1800, "smooth", 2600),
      S("drowsy", 1400, "smooth", 2200),
      S("drowsyRight", 1800, "smooth", 2600)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2e3,
      minIntervalMs: 2600,
      maxIntervalMs: 4200,
      durationMs: 700
    }
  },
  {
    id: "bounce",
    name: "Bouncing",
    bodyMotion: "none",
    eyeMotion: "none",
    hop: true,
    steps: [
      S("neutral", 400, "smooth", 1100),
      S("turnRight", 520, "smooth", 900),
      S("perk", 260, "snappy", 900),
      S("turnLeft", 520, "smooth", 900)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2e3,
      minIntervalMs: 3e3,
      maxIntervalMs: 5200,
      durationMs: 240
    }
  },
  {
    id: "dance",
    name: "Dancing",
    bodyMotion: "none",
    eyeMotion: "none",
    steps: [
      S("rollLeft", 260, "snappy", 380),
      S("rollRight", 260, "snappy", 380),
      S("rollLeft", 260, "snappy", 380),
      S("squintHappy", 220, "snappy", 700)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1600,
      minIntervalMs: 2200,
      maxIntervalMs: 4e3,
      durationMs: 200
    }
  },
  {
    id: "spin",
    name: "Spin",
    bodyMotion: "shake",
    motionScale: 0.2,
    eyeMotion: "none",
    steps: [
      S("neutral", 300, "smooth", 1600),
      S("perk", 220, "snappy", 420),
      S("neutral", 1100, "smooth", 300, { spin: { headY: 360 } }),
      S("widePop", 260, "spring", 900, { eyeShape: "star" })
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1400,
      minIntervalMs: 2200,
      maxIntervalMs: 4200,
      durationMs: 220
    }
  },
  {
    id: "tumble",
    name: "Tumble",
    bodyMotion: "none",
    eyeMotion: "none",
    steps: [
      S("neutral", 300, "smooth", 800),
      S("perk", 200, "snappy", 300),
      S("neutral", 1250, "smooth", 260, { spin: { headX: 360 } }),
      S("squintHappy", 260, "snappy", 900)
    ],
    blink: {
      enabled: true,
      initialDelayMs: 1500,
      minIntervalMs: 2400,
      maxIntervalMs: 4200,
      durationMs: 200
    }
  },
  {
    id: "dizzy",
    name: "Dizzy",
    bodyMotion: "slowDrift",
    motionScale: 1,
    eyeMotion: "none",
    steps: [
      S("neutral", 400, "smooth", 1800),
      S("neutral", 1300, "smooth", 200, { spin: { leftAngle: 360, rightAngle: -360 } }),
      S("wobble", 420, "smooth", 1500, { eyeShape: "cross" })
    ],
    blink: {
      enabled: true,
      initialDelayMs: 2600,
      minIntervalMs: 3400,
      maxIntervalMs: 5600,
      durationMs: 240
    }
  }
];
var MOTION_BY_ID = Object.fromEntries(
  MOTIONS.map((m) => [m.id, m])
);
function build(detail) {
  const N = (n) => Math.max(2, Math.round(n * detail));
  const qb = (p0, c, p1, n, out) => {
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([
        u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
        u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]
      ]);
    }
  };
  const z0 = (pts) => ({
    pts: pts.map((p) => [p[0], p[1], 0])
  });
  const mirror = (loop) => ({
    pts: loop.pts.map((p) => [-p[0], p[1], p[2]]).reverse(),
    hole: loop.hole
  });
  const disc2 = (cx, cy, rx, n, ry) => {
    const pts = [];
    const m = N(n);
    for (let i = 0; i < m; i++) {
      const a = i / m * Math.PI * 2;
      pts.push([cx + rx * Math.cos(a), cy + (ry || rx) * Math.sin(a)]);
    }
    return z0(pts);
  };
  const chain = (start, segs) => {
    const pts = [...start];
    for (const s of segs) qb(s[0], s[1], s[2], N(s[3] || 8), pts);
    pts.pop();
    return z0(pts);
  };
  const catR = chain(
    [
      [31, -95],
      [85, -53]
    ],
    [
      [
        [85, -53],
        [110, -100],
        [115, -158]
      ],
      [
        [115, -158],
        [72, -118],
        [31, -95]
      ]
    ]
  );
  const hornR = chain(
    [
      [42, -96],
      [78, -70]
    ],
    [
      [
        [78, -70],
        [106, -114],
        [88, -160]
      ],
      [
        [88, -160],
        [64, -112],
        [42, -96]
      ]
    ]
  );
  const crown = z0([
    [-38, -100],
    [-32, -158],
    [-15, -132],
    [0, -166],
    [15, -132],
    [32, -158],
    [38, -100]
  ]);
  const swoosh = chain(
    [[-30, -92]],
    [
      [[-30, -92], [-40, -170], [58, -168], 10],
      [
        [58, -168],
        [22, -132],
        [18, -98]
      ]
    ]
  );
  const haloLoop = (Rr, hole) => {
    const pts = [];
    const m = N(40);
    for (let i = 0; i < m; i++) {
      const a = i / m * Math.PI * 2;
      const x = Rr * Math.cos(a), zc = Rr * Math.sin(a);
      pts.push([x, -164 + zc * 0.375, zc * 0.927]);
    }
    return { pts, hole };
  };
  const stem = chain(
    [[-4, -95]],
    [
      [[-4, -95], [-10, -124], [-3, -148], 6],
      [[-3, -148], [-2, -124], [4, -95], 6]
    ]
  );
  const leafL = chain(
    [[-2, -144]],
    [
      [[-2, -144], [-28, -140], [-42, -168], 6],
      [[-42, -168], [-18, -176], [-2, -144], 6]
    ]
  );
  const leafR = chain(
    [[0, -146]],
    [
      [[0, -146], [20, -142], [30, -164], 5],
      [[30, -164], [8, -172], [0, -146], 5]
    ]
  );
  return {
    catEars: { id: "catEars", label: "Cat ears", thickness: 26, loops: [catR, mirror(catR)] },
    bearEars: {
      id: "bearEars",
      label: "Bear ears",
      thickness: 30,
      loops: [disc2(73, -100, 36, 26), mirror(disc2(73, -100, 36, 26))]
    },
    crown: { id: "crown", label: "Crown", thickness: 34, loops: [crown] },
    devilHorns: {
      id: "devilHorns",
      label: "Devil horns",
      thickness: 22,
      loops: [hornR, mirror(hornR)]
    },
    halo: { id: "halo", label: "Halo", loops: [haloLoop(58, false), haloLoop(45, true)] },
    swoosh: { id: "swoosh", label: "Swoosh", thickness: 18, loops: [swoosh] },
    sprout: { id: "sprout", label: "Sprout", thickness: 12, loops: [stem, leafL, leafR] }
  };
}
var libCache =  new Map();
function topperLibrary(detail = 1) {
  const hit = libCache.get(detail);
  if (hit) return hit;
  const lib = build(detail);
  libCache.set(detail, lib);
  return lib;
}
var TOPPER_LIBRARY = topperLibrary(1);
var TOPPER_IDS = ["none", "catEars", "bearEars", "crown", "halo", "swoosh", "sprout"];
var TOPPERS = TOPPER_IDS.map(
  (id) => id === "none" ? { id, label: "None" } : { id, label: TOPPER_LIBRARY[id].label }
);
function topperById(id, detail = 1) {
  var _a;
  if (id === "none") return null;
  return (_a = topperLibrary(detail)[id]) != null ? _a : null;
}
function pathD(o, closed = true) {
  if (!o || o.ends.length === 0) return "";
  const p = o.pts;
  let d = "";
  let start = 0;
  for (let s = 0; s < o.ends.length; s++) {
    const end = o.ends[s];
    for (let i = start; i < end; i++) {
      d += (i === start ? "M" : "L") + p[i * 2] + " " + p[i * 2 + 1];
    }
    if (closed) d += "Z";
    start = end;
  }
  return d;
}
var opacityAttr = (v) => v.toFixed(3);
function transformAttr(t) {
  const base = "translate(" + t.tx.toFixed(2) + " " + t.ty.toFixed(2) + ") rotate(" + t.rot.toFixed(2) + ")";
  return t.sx === 1 && t.sy === 1 ? base : base + " scale(" + t.sx.toFixed(3) + " " + t.sy.toFixed(3) + ")";
}
function svgEye(g) {
  if (!g) return null;
  return {
    d: pathD(g.sclera),
    op: opacityAttr(g.op),
    id: pathD(g.iris),
    pd: pathD(g.pupil),
    gd: pathD(g.glint),
    pop: opacityAttr(g.pop)
  };
}
function svgFrame(f) {
  var _a;
  return {
    bodyD: pathD(f.body),
    groupTransform: transformAttr(f.transform),
    eyeL: svgEye(f.eyeL),
    eyeR: svgEye(f.eyeR),
    eyeC: svgEye(f.eyeC),
    overlays: f.overlays.map((v) => ({
      id: v.id,
      d: pathD(v.o),
      fill: v.color,
      op: opacityAttr(v.opacity),
      blur: v.blur
    })),
    ramp: f.ramp,
    texture: ((_a = f.texture) != null ? _a : []).map((v) => ({
      d: pathD(v.o, v.closed),
      fill: v.fill || "none",
      stroke: v.stroke || "none",
      width: String(v.width),
      op: opacityAttr(v.opacity)
    }))
  };
}
var DISC_STEPS = 20;
function pathLength(polys) {
  let L = 0;
  for (const p of polys) {
    for (let i = 1; i < p.pts.length; i++) {
      const gx = p.pts[i][0] - p.pts[i - 1][0], gy = p.pts[i][1] - p.pts[i - 1][1];
      L += Math.sqrt(gx * gx + gy * gy);
    }
  }
  return L;
}
function disc(cx, cy, r, steps = DISC_STEPS) {
  const out = [];
  if (r <= 0) return out;
  for (let i = 0; i < steps; i++) {
    const a = i / steps * Math.PI * 2;
    out.push([cx + r * Math.cos(a), cy - r * Math.sin(a)]);
  }
  return out;
}
function strokeLoops(polys, width, frac) {
  const loops = [];
  const r = width / 2;
  if (r <= 0 || frac <= 0) return loops;
  const total = pathLength(polys);
  let budget = total * Math.min(1, frac);
  for (const p of polys) {
    if (p.pts.length === 0) continue;
    const pts = p.closed ? [...p.pts, p.pts[0]] : p.pts;
    let drew = false;
    for (let i = 1; i < pts.length && budget > 0; i++) {
      const a = pts[i - 1];
      let b = pts[i];
      const sx = b[0] - a[0], sy = b[1] - a[1];
      const seg = Math.sqrt(sx * sx + sy * sy);
      if (seg <= 1e-9) continue;
      if (seg > budget) {
        const t = budget / seg;
        b = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      budget -= seg;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len <= 1e-9) continue;
      const nx = -dy / len * r, ny = dx / len * r;
      loops.push([
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny]
      ]);
      if (!drew) {
        loops.push(disc(a[0], a[1], r));
        drew = true;
      }
      loops.push(disc(b[0], b[1], r));
    }
    if (budget <= 0) break;
  }
  return loops;
}
function fillLoops(polys) {
  return polys.filter((p) => p.pts.length > 2).map((p) => p.pts.map((q) => [q[0], q[1]]));
}
var REF_RIM = 122.3;
var GLYPH_Y = -202;
var CROWN_Y = -84;
var RISE = 90;
var LAND = 800;
var TAIL = 3e3;
var c01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
var outC = (u) => 1 - Math.pow(1 - u, 3);
var inC = (u) => u * u * u;
var spring = (u) => u <= 0 ? 0 : Math.max(1e-3, 1 - Math.exp(-7 * u) * Math.cos(5.5 * u));
var EMPTY = { drops: [], glyph: null, glyphOpacity: 0 };
function impressionFrame(plan, input) {
  const N = plan.pts.length;
  if (N === 0) return EMPTY;
  const scale2 = input.rim / REF_RIM;
  const glyphY = GLYPH_Y * scale2 * input.height;
  const crownY = CROWN_Y * scale2;
  const size = input.size;
  const dotR = plan.dotR * input.drops * size;
  const setT = plan.setT;
  const stag = plan.stag;
  const P = setT + TAIL;
  const t = input.t < 0 ? -1 : input.t % P;
  const rt = t < 0 ? 0 : c01((t - (setT + 2e3)) / 620);
  const landAt = (k) => RISE + k * stag + LAND;
  const letterOf = (k) => {
    for (let j = 0; j < plan.letters.length; j++) {
      if (k >= plan.letters[j].first && k <= plan.letters[j].last) return j;
    }
    return -1;
  };
  const drops = [];
  for (let k = 0; k < N; k++) {
    const u = t < 0 ? 0 : c01((t - (RISE + k * stag)) / LAND);
    let abT;
    if (plan.kind === "icon") {
      abT = landAt(k) + 70;
    } else {
      const j = letterOf(k);
      abT = (j < 0 ? setT : plan.letters[j].setT) - 60 + (k - (j < 0 ? 0 : plan.letters[j].first)) * 16;
    }
    const ab = t < 0 ? 0 : c01((t - abT) / 280);
    if (u <= 0 || ab >= 1 || rt > 0) continue;
    const e = outC(u);
    const ax = plan.pts[k][0] * size;
    const ay = glyphY + plan.pts[k][1] * size;
    const sx = (-34 + k % 7 * 11 + hash(k * 3.7) * 6) * scale2;
    const x = u < 1 ? sx + (ax - sx) * e + 3 * Math.sin(u * 9 + k * 2.1) * (1 - u) : ax + 1.1 * Math.sin(t * 0.01 + k * 1.7);
    const y = u < 1 ? crownY + (ay - crownY) * e : ay + 1.1 * Math.cos(t * 0.011 + k * 2.3);
    const r = (u < 0.2 ? dotR * (u / 0.2) : dotR) * (1 - ab * ab);
    drops.push({ x: q1(x), y: q1(y), r: q1(r) });
  }
  const drip = (t0, dur, x0, dy, y1, r0) => {
    const u = t < 0 ? 0 : c01((t - t0) / dur);
    if (u <= 0 || u >= 1) return;
    const y = glyphY + dy * scale2 + (y1 * scale2 - (glyphY + dy * scale2)) * u * u;
    drops.push({ x: q1(x0 * scale2), y: q1(y), r: q1(r0 * input.drops * (1 - 0.35 * u)) });
  };
  drip(setT + 700, 700, 10, 26, -92, 4.6);
  drip(setT + 1400, 620, -6, 32, -90, 5.2);
  let started = false;
  let drawn = 0;
  let dg = 0;
  if (plan.kind === "icon") {
    const nStroke = plan.dot ? N - 1 : N;
    drawn = t < 0 ? 0 : c01((t - landAt(0)) / Math.max(1, (nStroke - 1) * stag));
    started = drawn > 0;
    dg = plan.dot ? t < 0 ? 0 : c01((t - landAt(N - 1)) / 240) : 0;
  } else {
    for (const L of plan.letters) {
      if ((t < 0 ? 0 : c01((t - L.setT) / 300)) > 0) started = true;
    }
  }
  const sc = 1 - inC(rt);
  if (t < 0 || !started || sc <= 0.02) return { drops, glyph: null, glyphOpacity: 0 };
  const wob = c01((t - setT - 300) / 400) * (1 - rt);
  const ty = glyphY + (4.5 * Math.sin(t * 36e-4 + 1.2) * wob + 48 * inC(rt)) * scale2;
  const rot2 = 3.4 * Math.sin(t * 29e-4) * wob;
  const sw = 0.05 * Math.sin(t * 52e-4) * wob;
  const gx = sc * (1 - sw) * size;
  const gy = sc * (1 + sw) * size;
  let loops;
  if (plan.kind === "text") {
    loops = [];
    for (let j = 0; j < plan.letters.length; j++) {
      const L = plan.letters[j];
      const g2 = t < 0 ? 0 : c01((t - L.setT) / 300);
      const ls = spring(g2);
      if (ls <= 2e-3) continue;
      for (const loop of L.loops) {
        loops.push(loop.map((p) => [p[0] * ls + L.x, p[1] * ls]));
      }
    }
  } else {
    loops = plan.filled ? fillLoops(plan.polys) : strokeLoops(plan.polys, plan.sw, drawn);
    if (plan.dot) {
      const dr = 9.5 * spring(dg);
      if (dr > 0) loops.push(disc(plan.dot[0], plan.dot[1], dr));
    }
  }
  const rad = rot2 * Math.PI / 180;
  const cs = Math.cos(rad);
  const sn2 = Math.sin(rad);
  const pts = [];
  const ends = [];
  for (const loop of loops) {
    for (const p of loop) {
      const px = p[0] * gx;
      const py = p[1] * gy;
      pts.push(q1(px * cs - py * sn2), q1(px * sn2 + py * cs + ty));
    }
    ends.push(pts.length / 2);
  }
  return {
    drops,
    glyph: ends.length ? { pts, ends } : null,
    glyphOpacity: q3(plan.kind === "icon" && plan.filled ? drawn : 1)
  };
}
function impressionReach(input) {
  const scale2 = input.rim / REF_RIM;
  return Math.abs(GLYPH_Y) * scale2 * input.height + 70 * input.size + 8;
}
function svgImpression(f) {
  return {
    drops: f.drops.map((d) => ({ cx: String(d.x), cy: String(d.y), r: String(d.r) })),
    glyphD: pathD(f.glyph),
    glyphOpacity: String(f.glyphOpacity)
  };
}
function fillOutline(path, o) {
  if (!o || o.ends.length === 0) return path;
  const p = o.pts;
  let start = 0;
  for (let s = 0; s < o.ends.length; s++) {
    const end = o.ends[s];
    path.moveTo(p[start * 2], p[start * 2 + 1]);
    for (let i = start + 1; i < end; i++) path.lineTo(p[i * 2], p[i * 2 + 1]);
    path.close();
    start = end;
  }
  return path;
}
function strokeOutline(path, o) {
  if (!o || o.ends.length === 0) return path;
  const p = o.pts;
  let start = 0;
  for (let s = 0; s < o.ends.length; s++) {
    const end = o.ends[s];
    path.moveTo(p[start * 2], p[start * 2 + 1]);
    for (let i = start + 1; i < end; i++) path.lineTo(p[i * 2], p[i * 2 + 1]);
    start = end;
  }
  return path;
}
function outlineToPath(Skia, o, closed = true) {
  if (!o || o.ends.length === 0) return null;
  const path = Skia.Path.Make();
  return closed ? fillOutline(path, o) : strokeOutline(path, o);
}
function skiaEye(Skia, g) {
  if (!g) return null;
  return {
    sclera: outlineToPath(Skia, g.sclera),
    iris: outlineToPath(Skia, g.iris),
    pupil: outlineToPath(Skia, g.pupil),
    glint: outlineToPath(Skia, g.glint),
    op: g.op,
    pop: g.pop
  };
}
function skiaFrame(Skia, f) {
  var _a;
  return {
    body: outlineToPath(Skia, f.body),
    transform: f.transform,
    eyeL: skiaEye(Skia, f.eyeL),
    eyeR: skiaEye(Skia, f.eyeR),
    eyeC: skiaEye(Skia, f.eyeC),
    overlays: f.overlays.map((v) => ({
      id: v.id,
      o: outlineToPath(Skia, v.o),
      color: v.color,
      opacity: v.opacity,
      blur: v.blur
    })),
    ramp: f.ramp,
    texture: ((_a = f.texture) != null ? _a : []).map((v) => ({
      o: outlineToPath(Skia, v.o, v.closed),
      fill: v.fill,
      stroke: v.stroke,
      width: v.width,
      opacity: v.opacity
    }))
  };
}
function skiaImpression(Skia, f) {
  return {
    drops: f.drops,
    glyph: f.glyph ? fillOutline(Skia.Path.Make(), f.glyph) : null,
    glyphOpacity: f.glyphOpacity
  };
}
export {
  DRAG_GAIN,
  EYE_STYLES,
  EYE_STYLE_BY_ID,
  MOTIONS,
  MOTION_BY_ID,
  TOPPERS,
  bodyPaint,
  computeFrame,
  contentExtent,
  createAvatar,
  fillOutline,
  impressionFrame,
  impressionReach,
  moveDrag,
  opacityAttr,
  outlineToPath,
  pathD,
  play,
  skiaFrame,
  skiaImpression,
  stepDrag,
  svgFrame,
  svgImpression,
  topperById,
  transformAttr
};
