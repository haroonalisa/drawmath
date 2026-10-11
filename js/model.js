// model.js — the document: objects, constraints, sliders, history.
//
// Objects (all referenced by id):
//   point   {x, y, name, fixed, aux, owner, trace, color, showLabel}
//   line    {kind: segment|line|ray, p1, p2, color, dashed, owner}
//   circle  {c (center point), r, through, arc: {a, b} | null, color, dashed, hidden, owner}
//   polygon {pts: [...], color, alpha, owner}
//   whirl   {pts: [...], t, steps (numbers or expressions), color} — nested pursuit polygons, drawn only
//
// Constraints {type, refs, ...}. A "direction ref" is a line id or a [pointId, pointId] pair.
// Dimensions are constraints with CDEF[type].dim; driving dims use `expr`, reference dims only measure.
'use strict';

const Doc = { data: null, idx: new Map() };

function emptyDoc() { return { version: 1, seq: 1, objects: [], constraints: [], sliders: [] }; }
function uid(prefix) { return prefix + (Doc.data.seq++); }
function O(id) { return Doc.idx.get(id); }

function reindex() {
  Doc.idx.clear();
  for (const o of Doc.data.objects) Doc.idx.set(o.id, o);
  for (const c of Doc.data.constraints) Doc.idx.set(c.id, c);
  for (const s of Doc.data.sliders) Doc.idx.set(s.id, s);
}
function loadDoc(data) {
  const d = Object.assign(emptyDoc(), data);
  Doc.data = d;
  reindex();
}
loadDoc(emptyDoc());

// ---------- creation ----------
function nextPointName() {
  const used = new Set(Doc.data.objects.filter(o => o.type === 'point').map(o => o.name));
  for (let k = 0; ; k++) {
    for (let i = 0; i < 26; i++) {
      const n = String.fromCharCode(65 + i) + (k ? k : '');
      if (!used.has(n)) return n;
    }
  }
}
function addObj(o) { Doc.data.objects.push(o); Doc.idx.set(o.id, o); return o; }
function addPoint(x, y, opt = {}) {
  const p = { id: uid('p'), type: 'point', x, y, name: '', fixed: false, ...opt };
  if (!p.name) p.name = p.aux ? '·' + p.id : nextPointName();
  return addObj(p);
}
function addLine(p1, p2, kind = 'segment', opt = {}) { return addObj({ id: uid('l'), type: 'line', kind, p1, p2, ...opt }); }
function addCircle(c, r, opt = {}) { return addObj({ id: uid('c'), type: 'circle', c, r, through: null, arc: null, ...opt }); }
function addPolygon(pts, opt = {}) { return addObj({ id: uid('g'), type: 'polygon', pts: pts.slice(), alpha: 0.12, ...opt }); }
function addWhirl(pts, t, steps, opt = {}) { return addObj({ id: uid('w'), type: 'whirl', pts: pts.slice(), t, steps, ...opt }); }
// evaluated levels of a whirl (array of point arrays)
function whirlLevels(o) {
  const env = sliderEnv(), ev = v => (typeof v === 'number' ? v : Expr.evaluate(String(v), env));
  const t = ev(o.t), steps = Math.max(0, Math.min(2000, Math.round(ev(o.steps))));
  return isFinite(t) && isFinite(steps) ? Geo.whirl(o.pts.map(O), t, steps) : [];
}
function addConstraint(type, refs, extra = {}) {
  const c = { id: uid('k'), type, refs, ...extra };
  Doc.data.constraints.push(c);
  Doc.idx.set(c.id, c);
  return c;
}
function addSlider(name, value, min, max, step, opt = {}) {
  const s = { id: uid('s'), type: 'slider', name, value, min, max, step, speed: (max - min) / 6, mode: 'bounce', ...opt };
  Doc.data.sliders.push(s);
  Doc.idx.set(s.id, s);
  return s;
}
function sliderByName(n) { return Doc.data.sliders.find(s => s.name === n); }
function nextSliderName() {
  const used = new Set(Doc.data.sliders.map(s => s.name));
  for (const ch of 'abcdfghkmnpqrstuvwxyz') if (!used.has(ch)) return ch;
  for (let i = 1; ; i++) if (!used.has('a' + i)) return 'a' + i;
}
function sliderEnv() {
  const env = Object.create(null);
  for (const s of Doc.data.sliders) env[s.name] = s.value;
  return env;
}

// ---------- dependencies & deletion ----------
function objDeps(o) {
  const d = o.owner ? [o.owner] : [];
  if (o.type === 'line') d.push(o.p1, o.p2);
  else if (o.type === 'circle') { d.push(o.c); if (o.arc) d.push(o.arc.a, o.arc.b); }
  else if (o.type === 'polygon' || o.type === 'whirl') d.push(...o.pts);
  return d;
}
function constraintDeps(c) {
  const out = [];
  for (const v of Object.values(c.refs)) Array.isArray(v) ? out.push(...v) : out.push(v);
  return out;
}

// removes ids plus everything depending on them; returns the set actually removed
function removeIds(ids) {
  const del = new Set(ids);
  for (const id of ids) { const s = O(id); if (s && s.type === 'slider') removeSlider(s); }
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of Doc.data.objects) {
      if (!del.has(o.id) && objDeps(o).some(d => del.has(d))) { del.add(o.id); changed = true; }
    }
    for (const c of Doc.data.constraints) {
      if (!del.has(c.id) && constraintDeps(c).some(d => del.has(d))) { del.add(c.id); changed = true; }
    }
  }
  for (const o of Doc.data.objects) if (o.type === 'circle' && del.has(o.through)) o.through = null;
  Doc.data.objects = Doc.data.objects.filter(o => !del.has(o.id));
  Doc.data.constraints = Doc.data.constraints.filter(c => !del.has(c.id));
  reindex();
  return del;
}

// hide/show an object or constraint; objects it owns (polygon edges, helper points) follow.
// `sys` helpers (e.g. a regular polygon's circumcircle) are never un-hidden.
function setHidden(id, hidden) {
  const o = O(id);
  if (!o || (o.sys && !hidden)) return;
  o.hidden = hidden;
  for (const x of Doc.data.objects) if (x.owner === id && x !== o) setHidden(x.id, hidden);
}
function showAllHidden() {
  let n = 0;
  for (const o of [...Doc.data.objects, ...Doc.data.constraints]) if (o.hidden && !o.sys) { o.hidden = false; n++; }
  return n;
}

// deleting a slider bakes its current value into any expression that uses it
function removeSlider(s) {
  for (const c of Doc.data.constraints) {
    if (c.expr !== undefined) {
      try {
        if (Expr.identifiers(c.expr).has(s.name)) c.expr = Expr.rename(c.expr, s.name, '(' + fmt(s.value, 6) + ')');
      } catch (e) { /* leave invalid expressions alone */ }
    }
  }
  Doc.data.sliders = Doc.data.sliders.filter(x => x !== s);
  reindex();
}

function renameSlider(s, name) {
  for (const c of Doc.data.constraints) if (c.expr !== undefined) c.expr = Expr.rename(c.expr, s.name, name);
  s.name = name;
}

// ---------- constraint definitions ----------
function pp(ref) {
  if (Array.isArray(ref)) return [O(ref[0]), O(ref[1])];
  const l = O(ref);
  return [O(l.p1), O(l.p2)];
}
function circ(id) { const k = O(id); return [O(k.c), k]; }
function qty(ref) {
  if (!Array.isArray(ref)) { const o = O(ref); if (o.type === 'circle') return o.r; }
  const [A, B] = pp(ref);
  return Math.hypot(B.x - A.x, B.y - A.y);
}
const lenOf = (A, B) => Math.max(Math.hypot(B.x - A.x, B.y - A.y), 1e-9);

// vertex used to draw angle dimensions between two direction refs
function angleVertex(c) {
  const a = c.refs.a, b = c.refs.b;
  const [A1, A2] = pp(a), [B1, B2] = pp(b);
  if (A1 === B1 || A1 === B2) return A1;
  if (A2 === B1 || A2 === B2) return A2;
  const X = Geo.lineLine(A1, A2, B1, B2);
  if (X) return X;
  return { x: (A1.x + A2.x + B1.x + B2.x) / 4, y: (A1.y + A2.y + B1.y + B2.y) / 4 };
}

const CDEF = {
  coincident: {
    label: 'Coincident', glyph: '◉',
    res(c) { const a = O(c.refs.a), b = O(c.refs.b); return [a.x - b.x, a.y - b.y]; },
  },
  onLine: {
    label: 'Point on line', glyph: '∈',
    res(c) { const [A, B] = pp(c.refs.l); return [Geo.signedDist(O(c.refs.p), A, B)]; },
  },
  onCircle: {
    label: 'Point on circle', glyph: '∈',
    res(c) { const [C, k] = circ(c.refs.c), p = O(c.refs.p); return [Math.hypot(p.x - C.x, p.y - C.y) - k.r]; },
  },
  midpoint: {
    label: 'Midpoint', glyph: 'M',
    res(c) { const p = O(c.refs.p), [A, B] = pp(c.refs.l); return [p.x - (A.x + B.x) / 2, p.y - (A.y + B.y) / 2]; },
  },
  horizontal: {
    label: 'Horizontal', glyph: 'H',
    res(c) { const [A, B] = pp(c.refs.l); return [A.y - B.y]; },
  },
  vertical: {
    label: 'Vertical', glyph: 'V',
    res(c) { const [A, B] = pp(c.refs.l); return [A.x - B.x]; },
  },
  parallel: {
    label: 'Parallel', glyph: '∥',
    res(c) {
      const [A, B] = pp(c.refs.a), [C, D] = pp(c.refs.b);
      return [((B.x - A.x) * (D.y - C.y) - (B.y - A.y) * (D.x - C.x)) / (lenOf(A, B) * lenOf(C, D))];
    },
  },
  perpendicular: {
    label: 'Perpendicular', glyph: '⊥',
    res(c) {
      const [A, B] = pp(c.refs.a), [C, D] = pp(c.refs.b);
      return [((B.x - A.x) * (D.x - C.x) + (B.y - A.y) * (D.y - C.y)) / (lenOf(A, B) * lenOf(C, D))];
    },
  },
  equal: {
    label: 'Equal', glyph: '=',
    res(c) { return [qty(c.refs.a) - qty(c.refs.b)]; },
  },
  tangentLC: {
    label: 'Tangent', glyph: 'T',
    res(c) { const [A, B] = pp(c.refs.l), [C, k] = circ(c.refs.c); return [Geo.signedDist(C, A, B) - c.s * k.r]; },
  },
  tangentCC: {
    label: 'Tangent', glyph: 'T',
    res(c) {
      const [C1, k1] = circ(c.refs.a), [C2, k2] = circ(c.refs.b);
      const d = Math.hypot(C2.x - C1.x, C2.y - C1.y);
      return [c.internal ? d - c.s * (k1.r - k2.r) : d - (k1.r + k2.r)];
    },
  },
  symmetric: {
    label: 'Symmetric', glyph: '⋈',
    res(c) {
      const p = O(c.refs.p), q = O(c.refs.q), [A, B] = pp(c.refs.l);
      const M = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      const L = lenOf(A, B);
      return [Geo.signedDist(M, A, B), ((q.x - p.x) * (B.x - A.x) + (q.y - p.y) * (B.y - A.y)) / L];
    },
  },
  bisector: {
    label: 'Angle bisector', glyph: '∠',
    res(c) {
      const A = O(c.refs.a), V = O(c.refs.v), B = O(c.refs.b), D = O(c.refs.d);
      return [Geo.wrap(Geo.signedAngle(V, A, V, D) - Geo.signedAngle(V, D, V, B))];
    },
  },
  // ----- dimensions -----
  distance: {
    label: 'Distance', dim: true, kind: 'length',
    res(c) { const [A, B] = pp(c.refs.l); return [Math.hypot(B.x - A.x, B.y - A.y) - c._v]; },
    measure(c) { const [A, B] = pp(c.refs.l); return Math.hypot(B.x - A.x, B.y - A.y); },
  },
  pldist: {
    label: 'Point–line distance', dim: true, kind: 'length',
    res(c) { const [A, B] = pp(c.refs.l); return [Geo.signedDist(O(c.refs.p), A, B) - c.s * c._v]; },
    measure(c) { const [A, B] = pp(c.refs.l); return Math.abs(Geo.signedDist(O(c.refs.p), A, B)); },
  },
  angle: {
    label: 'Angle', dim: true, kind: 'angle',
    res(c) { const [A, B] = pp(c.refs.a), [C, D] = pp(c.refs.b); return [Geo.wrap(Geo.signedAngle(A, B, C, D) - c.s * c._v)]; },
    measure(c) { const [A, B] = pp(c.refs.a), [C, D] = pp(c.refs.b); return Math.abs(Geo.signedAngle(A, B, C, D)) * 180 / Math.PI; },
  },
  radius: {
    label: 'Radius', dim: true, kind: 'length',
    res(c) { return [O(c.refs.c).r - c._v]; },
    measure(c) { return O(c.refs.c).r; },
  },
};

// variables a constraint reads: [object, key] pairs
function varsOf(c) {
  const seen = new Set(), out = [];
  const addP = p => { if (p && !seen.has(p.id)) { seen.add(p.id); out.push([p, 'x'], [p, 'y']); } };
  for (const id of constraintDeps(c)) {
    const o = O(id);
    if (!o) continue;
    if (o.type === 'point') addP(o);
    else if (o.type === 'line') { addP(O(o.p1)); addP(O(o.p2)); }
    else if (o.type === 'circle') {
      addP(O(o.c));
      if (!seen.has(o.id)) { seen.add(o.id); out.push([o, 'r']); }
    }
  }
  return out;
}

function prepareConstraints() {
  const env = sliderEnv();
  for (const c of Doc.data.constraints) {
    const def = CDEF[c.type];
    if (!def || !def.dim || !c.driving) continue;
    try {
      const v = Expr.evaluate(c.expr, env);
      c._v = def.kind === 'angle' ? v * Math.PI / 180 : v;
      c._err = null;
    } catch (e) {
      c._err = e.message;
    }
  }
}

// value shown on a dimension label (display units: length or degrees)
function dimValue(c) {
  const def = CDEF[c.type];
  if (c.driving && !c._err && c._v !== undefined) return def.kind === 'angle' ? c._v * 180 / Math.PI : c._v;
  return def.measure(c);
}
function dimText(c) {
  const def = CDEF[c.type];
  let t = def.kind === 'angle' ? fmt(dimValue(c), 1) + '°' : fmt(dimValue(c));
  if (c.type === 'radius') t = 'R ' + t;
  if (c.driving && c.expr !== undefined && !Expr.isNumber(c.expr)) t = c.expr + ' = ' + t;
  return c.driving ? t : '(' + t + ')';
}

// ---------- naming for UI ----------
function nameOf(ref) {
  if (Array.isArray(ref)) return ref.map(id => (O(id) ? O(id).name : '?')).join('');
  const o = O(ref);
  if (!o) return '?';
  if (o.type === 'point') return o.name;
  if (o.type === 'line') {
    if (o.name) return o.name;
    const a = O(o.p1), b = O(o.p2);
    // construction lines end in a helper point: name them after the real one
    if (a && b && (a.aux || b.aux)) return (a.aux ? (b.aux ? 'line' : b.name) : a.name) + '-line';
    return (a?.name || '?') + (b?.name || '?');
  }
  if (o.type === 'circle') return (o.arc ? '◠' : '⊙') + (O(o.c)?.name || '?');
  if (o.type === 'polygon') return o.pts.map(id => O(id)?.name || '?').join('');
  if (o.type === 'whirl') return '🌀' + o.pts.map(id => O(id)?.name || '?').join('');
  return o.id;
}
function describeConstraint(c) {
  const parts = [];
  const r = c.refs;
  switch (c.type) {
    case 'bisector': parts.push('∠' + nameOf([r.a, r.v, r.b]), nameOf([r.v, r.d])); break;
    case 'symmetric': parts.push(nameOf(r.p), nameOf(r.q), 'about ' + nameOf(r.l)); break;
    default: for (const v of Object.values(r)) parts.push(nameOf(v));
  }
  return parts.join(', ');
}

// ---------- serialization & history ----------
function serialize() {
  return JSON.stringify(Doc.data, (k, v) => (k[0] === '_' ? undefined : v));
}

const STORAGE_KEY = 'drawmath-doc-v1';
const History = {
  stack: [], pos: -1,
  reset() { this.stack = [serialize()]; this.pos = 0; this.persist(); },
  commit() {
    const s = serialize();
    if (s === this.stack[this.pos]) return false;
    this.stack.splice(this.pos + 1);
    this.stack.push(s);
    if (this.stack.length > 300) this.stack.shift();
    this.pos = this.stack.length - 1;
    this.persist();
    return true;
  },
  undo() { if (this.pos > 0) { this.pos--; loadDoc(JSON.parse(this.stack[this.pos])); this.persist(); return true; } return false; },
  redo() { if (this.pos < this.stack.length - 1) { this.pos++; loadDoc(JSON.parse(this.stack[this.pos])); this.persist(); return true; } return false; },
  persist() {
    try { localStorage.setItem(STORAGE_KEY, this.stack[this.pos]); } catch (e) { /* storage unavailable */ }
    if (typeof Live !== 'undefined') Live.schedulePush();
  },
};

// ---------- state snapshots (for solver rollback) ----------
function snapshotVars() {
  const s = [];
  for (const o of Doc.data.objects) {
    if (o.type === 'point') s.push(o, o.x, o.y);
    else if (o.type === 'circle') s.push(o, o.r, 0);
  }
  return s;
}
function restoreVars(s) {
  for (let i = 0; i < s.length; i += 3) {
    const o = s[i];
    if (o.type === 'point') { o.x = s[i + 1]; o.y = s[i + 2]; } else o.r = s[i + 1];
  }
}
