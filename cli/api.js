// api.js — the scene-script API used by the drawmath CLI.
// Runs inside the same VM context as the app's engine (model, solver, builders), so a scene
// built here is exactly what the app would build. All values accept numbers or expression
// strings ("a", "2*a+1"); unknown names become sliders automatically.
'use strict';

const __warnings = [];
toast = (msg, type) => { __warnings.push(`${type || 'info'}: ${msg}`); };

const __id = x => {
  if (x == null) throw new Error('Missing object reference');
  if (typeof x === 'string') return get(x).id;
  if (x.id) return x.id;
  throw new Error('Not an object: ' + JSON.stringify(x));
};
// direction / segment reference: a line, or a pair of points [P, Q]
const __ref = x => (Array.isArray(x) ? [__id(x[0]), __id(x[1])] : __id(x));
function __style(o, opts = {}) {
  if (opts.name) o.name = opts.name;
  if (opts.color) o.color = opts.color;
  if (opts.dashed) o.dashed = true;
  if (opts.fixed) o.fixed = true;
  if (opts.trace) o.trace = true;
  if (opts.label === false) o.showLabel = false;
  if (opts.alpha != null) o.alpha = opts.alpha;
  if (opts.width) o.width = opts.width;
  if (opts.back) o.back = true;
  if (opts.hidden) setHidden(o.id, true);
  return o;
}
function __num(v) { return typeof v === 'number' ? v : Expr.evaluate(String(v), sliderEnv()); }
function __ensureSliders(expr, guess, isAngle) {
  for (const id of Expr.identifiers(String(expr))) {
    if (sliderByName(id)) continue;
    const v = String(expr).trim() === id ? guess : 1;
    if (isAngle) addSlider(id, Math.round(v), 0, 360, 1, { speed: 45 });
    else addSlider(id, +fmt(v, 2), 0, Math.max(10, Math.ceil(v * 2)), 0.01);
    __warnings.push(`info: created slider "${id}" = ${fmt(v, 2)}`);
  }
}
function __wrapPoly(g, points) {
  const edges = Doc.data.objects.filter(o => o.type === 'line' && o.owner === g.id);
  return { id: g.id, polygon: g, edges, points: points || g.pts.map(O) };
}

// ---------- lookup ----------
// by point name ("A"), line name ("AB" — either order), circle ("⊙O"), polygon ("ABC") or id
function get(name) {
  const rev = String(name).split('').reverse().join('');
  const o = Doc.data.objects.find(p => p.type === 'point' && p.name === name) || O(name) ||
    Doc.data.objects.find(p => p.type !== 'point' && (nameOf(p.id) === name || (p.type === 'line' && nameOf(p.id) === rev))) ||
    Doc.data.objects.find(p => p.type === 'circle' && nameOf(p.id).slice(1) === name.replace(/^[⊙◠]/, ''));
  if (!o) throw new Error(`No object named "${name}"`);
  return o;
}

// ---------- points & curves ----------
function point(x, y, opts = {}) { return __style(addPoint(x, y, { name: opts.name || '' }), opts); }
function pointOn(curve, x, y, opts = {}) {
  const c = O(__id(curve));
  const P = projectOnto(c, x, y, false);
  const p = point(P.x, P.y, opts);
  Build.on(p.id, c.id);
  return p;
}
function segment(a, b, opts = {}) { return __style(addLine(__id(a), __id(b), 'segment'), opts); }
function line(a, b, opts = {}) { return __style(addLine(__id(a), __id(b), 'line'), opts); }
function ray(a, b, opts = {}) { return __style(addLine(__id(a), __id(b), 'ray'), opts); }
function circle(center, through, opts = {}) {
  if (typeof through === 'number' || typeof through === 'string' && !O(through) && !Doc.data.objects.some(o => o.name === through)) return circleR(center, through, opts);
  return __style(Build.circle(__id(center), __id(through)), opts);
}
function circleR(center, r, opts = {}) {
  let r0;
  try { r0 = __num(r); } catch (e) { r0 = 1; } // expression uses a slider that doesn't exist yet
  const k = addCircle(__id(center), r0);
  radius(k, r);
  return __style(k, opts);
}
function circle3(a, b, c, opts = {}) {
  const k = Build.circle3(__id(a), __id(b), __id(c));
  if (!k) throw new Error('circle3: points are collinear');
  return __style(k, opts);
}
function arc(center, start, end, opts = {}) { return __style(Build.arc(__id(center), __id(start), __id(end)), opts); }
function polygon(...args) {
  let opts = {};
  if (args.length && !Array.isArray(args[args.length - 1]) && !args[args.length - 1].id && typeof args[args.length - 1] === 'object') opts = args.pop();
  const pts = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map(__id);
  const { g } = Build.polygon(pts);
  __style(g, opts);
  return __wrapPoly(g);
}
// nested pursuit polygons: each level moves every vertex the fraction t toward the next vertex
// (t, steps may be expressions / slider names). opts: t (0.05), steps (80), color, width
function whirl(...args) {
  let opts = {};
  if (args.length && !Array.isArray(args[args.length - 1]) && !args[args.length - 1].id && typeof args[args.length - 1] === 'object') opts = args.pop();
  const pts = (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map(__id);
  const t = opts.t ?? 0.05, steps = opts.steps ?? 80;
  if (typeof t !== 'number') __ensureSliders(t, 0.05);
  if (typeof steps !== 'number') __ensureSliders(steps, 80);
  const w = addWhirl(pts, t, steps);
  if (opts.width) w.width = opts.width;
  return __style(w, opts);
}
function rect(a, c, opts = {}) { return __wrapPoly(__style(Build.rect(__id(a), __id(c)), opts)); }
function regularPolygon(a, b, n, opts = {}) { return __wrapPoly(__style(Build.regular(__id(a), __id(b), n), opts)); }

// ---------- constructions ----------
function midpoint(a, b, opts = {}) {
  if (b && (b.id || typeof b === 'string')) return __style(Build.midpoint([__id(a), __id(b)]), opts);
  return __style(Build.midpoint(__ref(a)), b || opts);
}
function intersect(c1, c2, opts = {}) {
  const pts = Build.intersections(__id(c1), __id(c2));
  if (!pts.length) __warnings.push(`warn: intersect(${nameOf(__id(c1))}, ${nameOf(__id(c2))}) found no intersection — check approximate positions`);
  if (opts.names) pts.forEach((p, i) => { if (opts.names[i]) p.name = opts.names[i]; });
  return pts;
}
function perpLine(lineRef, through, opts = {}) { return __style(Build.perpLine(__ref(lineRef), __id(through)), opts); }
function parallelLine(lineRef, through, opts = {}) { return __style(Build.perpLine(__ref(lineRef), __id(through), true), opts); }
function perpBisector(a, b, opts = {}) {
  if (b && (b.id || typeof b === 'string')) return __style(Build.perpBisector([__id(a), __id(b)]), opts);
  return __style(Build.perpBisector(__ref(a)), b || opts);
}
function angleBisector(a, vertex, b, opts = {}) { return __style(Build.angleBisector(__id(a), __id(vertex), __id(b)), opts); }
function tangents(p, c, opts = {}) {
  const ls = Build.tangents(__id(p), __id(c));
  if (!ls) throw new Error('tangents: the point is inside the circle');
  return ls.map(l => __style(l, opts));
}
function reflect(obj, mirror, opts = {}) {
  const r = Build.reflect(__id(obj), __id(mirror));
  return r && r.type === 'polygon' ? __wrapPoly(__style(r, opts)) : __style(r, opts);
}
let __xAxis = null, __yAxis = null;
function xAxis() {
  if (__xAxis && O(__xAxis.id)) return __xAxis;
  const a = addPoint(0, 0, { aux: true, fixed: true, hidden: true, sys: true }), b = addPoint(1, 0, { aux: true, fixed: true, hidden: true, sys: true });
  return (__xAxis = addLine(a.id, b.id, 'line', { hidden: true, sys: true, name: 'x-axis' }));
}
function yAxis() {
  if (__yAxis && O(__yAxis.id)) return __yAxis;
  const a = addPoint(0, 0, { aux: true, fixed: true, hidden: true, sys: true }), b = addPoint(0, 1, { aux: true, fixed: true, hidden: true, sys: true });
  return (__yAxis = addLine(a.id, b.id, 'line', { hidden: true, sys: true, name: 'y-axis' }));
}

// ---------- constraints ----------
function coincident(a, b) { return addConstraint('coincident', { a: __id(a), b: __id(b) }); }
function on(p, curve) { return Build.on(__id(p), __id(curve)); }
function midpointOf(p, seg) { return addConstraint('midpoint', { p: __id(p), l: __ref(seg) }); }
function fix(...pts) { pts.flat().forEach(p => { O(__id(p)).fixed = true; }); }
function horizontal(ref) { return addConstraint('horizontal', { l: __ref(ref) }); }
function vertical(ref) { return addConstraint('vertical', { l: __ref(ref) }); }
function parallel(a, b) { return addConstraint('parallel', { a: __ref(a), b: __ref(b) }); }
function perpendicular(a, b) { return addConstraint('perpendicular', { a: __ref(a), b: __ref(b) }); }
function equal(...items) {
  const q = items.flat().map(x => (Array.isArray(x) ? __ref(x) : __id(x)));
  const out = [];
  for (let i = 0; i + 1 < q.length; i++) out.push(addConstraint('equal', { a: q[i], b: q[i + 1] }));
  return out;
}
function tangent(a, b) {
  const A = O(__id(a)), B = O(__id(b));
  if (A.type === 'circle' && B.type === 'circle') {
    const d = Geo.dist(O(A.c), O(B.c));
    return addConstraint('tangentCC', { a: A.id, b: B.id }, { internal: d < Math.max(A.r, B.r), s: Math.sign(A.r - B.r) || 1 });
  }
  const [L, K] = A.type === 'line' ? [A, B] : [B, A];
  const [P, Q] = pp(L.id);
  return addConstraint('tangentLC', { l: L.id, c: K.id }, { s: Math.sign(Geo.signedDist(O(K.c), P, Q)) || 1 });
}
function symmetric(p, q, mirror) { return addConstraint('symmetric', { p: __id(p), q: __id(q), l: __ref(mirror) }); }

// ---------- dimensions (value omitted → reference measurement) ----------
function __dim(type, refs, value, opts = {}) {
  const reference = value === undefined || value === null || opts.reference;
  const c = Build.dim(type, refs, !reference);
  if (type === 'angle' && !reference && !opts.keepSide) c.s = 1; // counter-clockwise from first to second direction
  if (!reference) {
    __ensureSliders(value, CDEF[type].measure(c), CDEF[type].kind === 'angle');
    c.expr = String(value);
  }
  if (opts.off) c.off = { x: opts.off[0], y: opts.off[1] };
  if (opts.hidden) c.hidden = true;
  return c;
}
function length(seg, value, opts) { return __dim('distance', { l: __ref(seg) }, value, opts); }
function distance(a, b, value, opts) { return __dim('distance', { l: [__id(a), __id(b)] }, value, opts); }
function pointLineDistance(p, lineRef, value, opts) { return __dim('pldist', { p: __id(p), l: __ref(lineRef) }, value, opts); }
function angle(a, b, value, opts) { return __dim('angle', { a: __ref(a), b: __ref(b) }, value, opts); }
function angleAt(a, vertex, b, value, opts) { return __dim('angle', { a: [__id(vertex), __id(a)], b: [__id(vertex), __id(b)] }, value, opts); }
function angleToX(ref, value, opts) { return angle(xAxis(), ref, value, opts); }
function radius(c, value, opts) { return __dim('radius', { c: __id(c) }, value, opts); }

// ---------- variables & visibility ----------
function slider(name, value, min = 0, max = 10, opts = {}) {
  let s = sliderByName(name);
  if (!s) s = addSlider(name, value, min, max, opts.step ?? (max - min <= 20 ? 0.01 : 1));
  Object.assign(s, { value, min, max });
  if (opts.step) s.step = opts.step;
  if (opts.speed) s.speed = opts.speed;
  if (opts.mode) s.mode = opts.mode;
  if (opts.play) s.play = true;
  return s;
}
function hide(...objs) { objs.flat().forEach(o => setHidden(__id(o), true)); }
function show(...objs) { objs.flat().forEach(o => setHidden(__id(o), false)); }
function style(obj, opts) { return __style(O(__id(obj)), opts); }
function trace(...pts) { pts.flat().forEach(p => { O(__id(p)).trace = true; }); }
