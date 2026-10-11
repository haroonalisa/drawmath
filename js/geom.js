// geom.js — pure geometry helpers (no document state)
'use strict';

const TAU = Math.PI * 2;

const Geo = {
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),

  // wrap angle to (-PI, PI]
  wrap(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  },
  norm2pi(a) {
    a %= TAU;
    if (a < 0) a += TAU;
    return a;
  },

  // projection of p onto infinite line ab; t is the parameter along a->b
  project(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy || 1e-12;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    return { x: a.x + t * dx, y: a.y + t * dy, t };
  },

  clampT(t, kind) {
    if (kind === 'segment') return Math.max(0, Math.min(1, t));
    if (kind === 'ray') return Math.max(0, t);
    return t;
  },

  inRange(t, kind, eps = 1e-9) {
    if (kind === 'segment') return t >= -eps && t <= 1 + eps;
    if (kind === 'ray') return t >= -eps;
    return true;
  },

  // signed distance of p from line ab (positive = left of a->b)
  signedDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1e-12;
    return (dx * (p.y - a.y) - dy * (p.x - a.x)) / L;
  },

  // signed angle from direction (a->b) to direction (c->d)
  signedAngle(a, b, c, d) {
    const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - c.x, vy = d.y - c.y;
    return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  },

  // intersection of infinite lines a1a2, b1b2. t,u = params on each.
  lineLine(a1, a2, b1, b2) {
    const d1x = a2.x - a1.x, d1y = a2.y - a1.y, d2x = b2.x - b1.x, d2y = b2.y - b1.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-12) return null;
    const ex = b1.x - a1.x, ey = b1.y - a1.y;
    const t = (ex * d2y - ey * d2x) / den;
    const u = (ex * d1y - ey * d1x) / den;
    return { x: a1.x + t * d1x, y: a1.y + t * d1y, t, u };
  },

  lineCircle(a, b, c, r) {
    const dx = b.x - a.x, dy = b.y - a.y, fx = a.x - c.x, fy = a.y - c.y;
    const A = dx * dx + dy * dy;
    if (A < 1e-18) return [];
    const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
    let disc = B * B - 4 * A * C;
    if (disc < -1e-12 * A) return [];
    disc = Math.sqrt(Math.max(0, disc));
    const ts = disc < 1e-12 ? [-B / (2 * A)] : [(-B - disc) / (2 * A), (-B + disc) / (2 * A)];
    return ts.map(t => ({ x: a.x + t * dx, y: a.y + t * dy, t }));
  },

  circleCircle(c1, r1, c2, r2) {
    const d = Geo.dist(c1, c2);
    if (d < 1e-12 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    const ux = (c2.x - c1.x) / d, uy = (c2.y - c1.y) / d;
    const mx = c1.x + a * ux, my = c1.y + a * uy;
    if (h < 1e-12) return [{ x: mx, y: my }];
    return [{ x: mx - h * uy, y: my + h * ux }, { x: mx + h * uy, y: my - h * ux }];
  },

  // is angle `ang` inside CCW arc from a1 to a2
  angleInArc(ang, a1, a2, eps = 1e-9) {
    const span = Geo.norm2pi(a2 - a1);
    const rel = Geo.norm2pi(ang - a1);
    return rel <= span + eps || rel >= TAU - eps;
  },

  circumcenter(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-12) return null;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    return {
      x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
      y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
    };
  },

  reflect(p, a, b) {
    const f = Geo.project(p, a, b);
    return { x: 2 * f.x - p.x, y: 2 * f.y - p.y };
  },

  polygonArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      s += p.x * q.y - q.x * p.y;
    }
    return s / 2;
  },

  // "whirl" / pursuit polygons: each level moves every vertex a fraction t along its edge
  // toward the next vertex; returns [level0, level1, ...] (level0 = the polygon itself)
  whirl(pts, t, steps) {
    const out = [pts.map(p => ({ x: p.x, y: p.y }))];
    for (let k = 0; k < steps; k++) {
      const P = out[out.length - 1], n = P.length;
      out.push(P.map((p, i) => ({ x: p.x + t * (P[(i + 1) % n].x - p.x), y: p.y + t * (P[(i + 1) % n].y - p.y) })));
    }
    return out;
  },

  pointInPolygon(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  },
};

function fmt(v, d = 2) {
  if (!isFinite(v)) return '—';
  const s = parseFloat(v.toFixed(d)).toString();
  return s === '-0' ? '0' : s;
}
