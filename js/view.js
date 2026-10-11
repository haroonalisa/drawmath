// view.js — viewport transforms, rendering and hit testing.
'use strict';

const View = { cx: 0, cy: 0, scale: 60, W: 800, H: 600, dpr: 1 };

const COL = {
  bg: '#fbfbfd', gridMinor: '#eef0f5', gridMajor: '#dfe3eb', axis: '#a3abba', axisText: '#8a93a3',
  line: '#334155', point: '#2563eb', pointOn: '#0d9488', pointFixed: '#111827', pointAux: '#94a3b8',
  poly: '#4f46e5', sel: '#f59e0b', dim: '#7c3aed', dimRef: '#64748b', bad: '#dc2626',
  badgeBg: '#ffffff', badgeBorder: '#cbd5e1', badgeText: '#475569', snap: '#f59e0b', preview: '#6366f1', related: '#8b5cf6',
};

function w2s(x, y) { return [(x - View.cx) * View.scale + View.W / 2, View.H / 2 - (y - View.cy) * View.scale]; }
function s2w(sx, sy) { return [(sx - View.W / 2) / View.scale + View.cx, (View.H / 2 - sy) / View.scale + View.cy]; }

function gridStep() {
  const target = 36 / View.scale;
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  for (const m of [1, 2, 5, 10]) if (p * m >= target) return p * m;
  return p * 10;
}

function arcAngles(k) {
  const C = O(k.c), A = O(k.arc.a), B = O(k.arc.b);
  return [Math.atan2(A.y - C.y, A.x - C.x), Math.atan2(B.y - C.y, B.x - C.x)];
}

// ---------- hit testing ----------
function screenDistToLine(sx, sy, l) {
  const A = O(l.p1), B = O(l.p2);
  const [ax, ay] = w2s(A.x, A.y), [bx, by] = w2s(B.x, B.y);
  const f = Geo.project({ x: sx, y: sy }, { x: ax, y: ay }, { x: bx, y: by });
  const t = Geo.clampT(f.t, l.kind);
  return Math.hypot(sx - (ax + t * (bx - ax)), sy - (ay + t * (by - ay)));
}
function screenDistToCircle(sx, sy, k) {
  const C = O(k.c);
  const [cx, cy] = w2s(C.x, C.y);
  const d = Math.abs(Math.hypot(sx - cx, sy - cy) - k.r * View.scale);
  if (k.arc) {
    const [wx, wy] = s2w(sx, sy);
    const [a1, a2] = arcAngles(k);
    if (!Geo.angleInArc(Math.atan2(wy - C.y, wx - C.x), a1, a2)) return Infinity;
  }
  return d;
}
function isCurve(o) { return o && (o.type === 'line' || o.type === 'circle') && isShown(o); }

function curvesNear(sx, sy, tol) {
  const out = [];
  for (const o of Doc.data.objects) {
    if (!isCurve(o)) continue;
    const d = o.type === 'line' ? screenDistToLine(sx, sy, o) : screenDistToCircle(sx, sy, o);
    if (d <= tol) out.push({ o, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

function nearestPoint(sx, sy, tol, exclude) {
  let best = null, bd = tol;
  for (const o of Doc.data.objects) {
    if (o.type !== 'point' || !isShown(o) || (exclude && exclude.has(o.id))) continue;
    const [px, py] = w2s(o.x, o.y);
    const d = Math.hypot(px - sx, py - sy);
    if (d <= bd) { bd = d; best = o; }
  }
  return best;
}

function hitTest(sx, sy, filter) {
  const allow = k => !filter || filter.includes(k);
  const inRect = r => sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h;
  if (allow('dim')) for (let i = App.labelRects.length - 1; i >= 0; i--) if (inRect(App.labelRects[i])) return { kind: 'dim', id: App.labelRects[i].id };
  if (allow('badge')) for (let i = App.badgeRects.length - 1; i >= 0; i--) if (inRect(App.badgeRects[i])) return { kind: 'badge', id: App.badgeRects[i].id };
  if (allow('point')) { const p = nearestPoint(sx, sy, 9); if (p) return { kind: 'point', id: p.id }; }
  const curves = curvesNear(sx, sy, 7).filter(c => allow(c.o.type));
  if (curves.length) return { kind: curves[0].o.type, id: curves[0].o.id };
  if (allow('polygon')) {
    const [wx, wy] = s2w(sx, sy);
    const polys = Doc.data.objects.filter(o => o.type === 'polygon' && isShown(o));
    for (let i = polys.length - 1; i >= 0; i--) {
      if (Geo.pointInPolygon({ x: wx, y: wy }, polys[i].pts.map(O))) return { kind: 'polygon', id: polys[i].id };
    }
  }
  return null;
}

// ---------- drawing primitives ----------
function strokeLineWorld(ctx, A, B, kind) {
  let [ax, ay] = w2s(A.x, A.y), [bx, by] = w2s(B.x, B.y);
  if (kind !== 'segment') {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    const far = (View.W + View.H) * 4 + Math.hypot(ax, ay);
    const ux = dx / L * far, uy = dy / L * far;
    if (kind === 'line') { ax -= ux; ay -= uy; }
    bx = ax + (kind === 'line' ? 2 : 1) * ux; by = ay + (kind === 'line' ? 2 : 1) * uy;
  }
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function strokeCircleWorld(ctx, k) {
  const C = O(k.c);
  const [cx, cy] = w2s(C.x, C.y);
  const R = Math.max(0, k.r * View.scale);
  ctx.beginPath();
  if (k.arc) {
    const [a1, a2] = arcAngles(k);
    ctx.arc(cx, cy, R, -a1, -a2, true);
  } else ctx.arc(cx, cy, R, 0, TAU);
  ctx.stroke();
}

function arrowHead(ctx, fx, fy, tx, ty, size = 7) {
  const a = Math.atan2(ty - fy, tx - fx);
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - size * Math.cos(a - 0.4), ty - size * Math.sin(a - 0.4));
  ctx.lineTo(tx - size * Math.cos(a + 0.4), ty - size * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fill();
}

function pill(ctx, text, x, y, o) {
  ctx.font = o.font || '600 12px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10, h = 18;
  const rx = x - w / 2, ry = y - h / 2;
  ctx.fillStyle = o.bg || 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = o.border || 'transparent';
  ctx.lineWidth = o.selected ? 2 : 1;
  ctx.beginPath();
  ctx.roundRect(rx, ry, w, h, 5);
  ctx.fill();
  if (o.border) ctx.stroke();
  ctx.fillStyle = o.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  return { x: rx, y: ry, w, h };
}

// ---------- grid ----------
function drawGrid(ctx) {
  const st = gridStep();
  const [x0, y1] = s2w(0, 0), [x1, y0] = s2w(View.W, View.H);
  const major = st * 5;
  if (App.settings.grid) {
    ctx.lineWidth = 1;
    for (const [step, color] of [[st, COL.gridMinor], [major, COL.gridMajor]]) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { const sx = Math.round(w2s(x, 0)[0]) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, View.H); }
      for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { const sy = Math.round(w2s(0, y)[1]) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(View.W, sy); }
      ctx.stroke();
    }
  }
  if (!App.settings.axes) return;
  const [ox, oy] = w2s(0, 0);
  ctx.strokeStyle = COL.axis;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(oy) + 0.5); ctx.lineTo(View.W, Math.round(oy) + 0.5);
  ctx.moveTo(Math.round(ox) + 0.5, 0); ctx.lineTo(Math.round(ox) + 0.5, View.H);
  ctx.stroke();
  // tick labels
  ctx.fillStyle = COL.axisText;
  ctx.font = '10px Inter, system-ui, sans-serif';
  const ly = Math.min(Math.max(oy + 4, 4), View.H - 14), lx = Math.min(Math.max(ox - 4, 24), View.W - 4);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const lab = v => fmt(v, 6);
  for (let x = Math.floor(x0 / major) * major; x <= x1; x += major) {
    if (Math.abs(x) < major / 2) continue;
    ctx.fillText(lab(x), w2s(x, 0)[0], ly);
  }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = Math.floor(y0 / major) * major; y <= y1; y += major) {
    if (Math.abs(y) < major / 2) continue;
    ctx.fillText(lab(y), lx, w2s(0, y)[1]);
  }
}

// ---------- traces ----------
function recordTraces() {
  for (const o of Doc.data.objects) {
    if (o.type !== 'point' || !o.trace) continue;
    let strokes = App.traces.get(o.id);
    if (!strokes) { strokes = [[]]; App.traces.set(o.id, strokes); }
    const cur = strokes[strokes.length - 1];
    const last = cur[cur.length - 1];
    if (last) {
      const d = Math.hypot(last[0] - o.x, last[1] - o.y) * View.scale;
      if (d < 0.75) continue;
      if (d > 120) { strokes.push([[o.x, o.y]]); continue; }
    }
    cur.push([o.x, o.y]);
    if (cur.length > 20000) cur.splice(0, cur.length - 20000);
  }
}
function drawTraces(ctx) {
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  for (const [id, strokes] of App.traces) {
    const p = O(id);
    ctx.strokeStyle = (p && p.color) || '#e11d48';
    ctx.globalAlpha = 0.75;
    for (const s of strokes) {
      if (s.length < 2) continue;
      ctx.beginPath();
      s.forEach(([x, y], i) => { const [sx, sy] = w2s(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- dimensions ----------
function dimAnchor(c) {
  switch (c.type) {
    case 'distance': { const [A, B] = pp(c.refs.l); return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }; }
    case 'pldist': { const P = O(c.refs.p), [A, B] = pp(c.refs.l), F = Geo.project(P, A, B); return { x: (P.x + F.x) / 2, y: (P.y + F.y) / 2 }; }
    case 'angle': return angleVertex(c);
    case 'radius': { const C = O(O(c.refs.c).c); return { x: C.x, y: C.y }; }
  }
  return { x: 0, y: 0 };
}

function defaultDimOff(c) {
  const px = 1 / View.scale;
  switch (c.type) {
    case 'distance': {
      const [A, B] = pp(c.refs.l), L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
      return { x: -(B.y - A.y) / L * 26 * px, y: (B.x - A.x) / L * 26 * px };
    }
    case 'pldist': {
      const P = O(c.refs.p), [A, B] = pp(c.refs.l), F = Geo.project(P, A, B);
      const L = Math.hypot(P.x - F.x, P.y - F.y) || 1;
      return { x: -(P.y - F.y) / L * 16 * px, y: (P.x - F.x) / L * 16 * px };
    }
    case 'angle': {
      const [A, B] = pp(c.refs.a), [C, D] = pp(c.refs.b);
      const a1 = Math.atan2(B.y - A.y, B.x - A.x), th = Geo.signedAngle(A, B, C, D);
      const m = a1 + th / 2;
      return { x: Math.cos(m) * 44 * px, y: Math.sin(m) * 44 * px };
    }
    case 'radius': {
      const r = O(c.refs.c).r, R = r * View.scale > 60 ? r * 0.6 : r + 22 * px;
      return { x: R * Math.SQRT1_2, y: R * Math.SQRT1_2 };
    }
  }
  return { x: 0, y: 0 };
}

function drawDim(ctx, c, selected, hovered) {
  if (!c.off) c.off = defaultDimOff(c);
  const color = c._err ? COL.bad : c.driving ? COL.dim : COL.dimRef;
  const an = dimAnchor(c);
  const L = { x: an.x + c.off.x, y: an.y + c.off.y };
  const [lx, ly] = w2s(L.x, L.y);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
  ctx.setLineDash([]);
  if (c.type === 'distance') {
    const [A, B] = pp(c.refs.l);
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1e-9;
    const n = { x: -(B.y - A.y) / len, y: (B.x - A.x) / len };
    const h = c.off.x * n.x + c.off.y * n.y;
    const [as, ay] = w2s(A.x, A.y), [bs, by] = w2s(B.x, B.y);
    const [a2x, a2y] = w2s(A.x + n.x * h, A.y + n.y * h), [b2x, b2y] = w2s(B.x + n.x * h, B.y + n.y * h);
    const el = Math.hypot(a2x - as, a2y - ay);
    ctx.beginPath();
    if (el > 4) {
      const ex = (a2x - as) / el, ey = (a2y - ay) / el;
      ctx.moveTo(as + ex * 3, ay + ey * 3); ctx.lineTo(a2x + ex * 5, a2y + ey * 5);
      ctx.moveTo(bs + ex * 3, by + ey * 3); ctx.lineTo(b2x + ex * 5, b2y + ey * 5);
    }
    ctx.moveTo(a2x, a2y); ctx.lineTo(b2x, b2y);
    ctx.stroke();
    if (Math.hypot(b2x - a2x, b2y - a2y) > 24) {
      arrowHead(ctx, (a2x + b2x) / 2, (a2y + b2y) / 2, a2x, a2y);
      arrowHead(ctx, (a2x + b2x) / 2, (a2y + b2y) / 2, b2x, b2y);
    }
  } else if (c.type === 'pldist') {
    const P = O(c.refs.p), [A, B] = pp(c.refs.l), F = Geo.project(P, A, B);
    const [px, py] = w2s(P.x, P.y), [fx, fy] = w2s(F.x, F.y);
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.setLineDash([]);
    if (Math.hypot(fx - px, fy - py) > 20) { arrowHead(ctx, px, py, fx, fy); arrowHead(ctx, fx, fy, px, py); }
  } else if (c.type === 'angle') {
    const [A, B] = pp(c.refs.a), [C, D] = pp(c.refs.b);
    const V = angleVertex(c);
    const [vx, vy] = w2s(V.x, V.y);
    const a1 = Math.atan2(B.y - A.y, B.x - A.x), a2 = Math.atan2(D.y - C.y, D.x - C.x);
    const th = Geo.signedAngle(A, B, C, D);
    const R = Math.max(14, Math.hypot(c.off.x, c.off.y) * View.scale - 2);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(vx, vy); ctx.lineTo(vx + Math.cos(a1) * (R + 8), vy - Math.sin(a1) * (R + 8));
    ctx.moveTo(vx, vy); ctx.lineTo(vx + Math.cos(a2) * (R + 8), vy - Math.sin(a2) * (R + 8));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(vx, vy, R, -a1, -(a1 + th), th > 0);
    ctx.stroke();
    if (Math.abs(Math.abs(th) - Math.PI / 2) < 1e-4) {
      // right angle marker
      const s = 9;
      ctx.beginPath();
      ctx.moveTo(vx + Math.cos(a1) * s, vy - Math.sin(a1) * s);
      ctx.lineTo(vx + (Math.cos(a1) + Math.cos(a2)) * s, vy - (Math.sin(a1) + Math.sin(a2)) * s);
      ctx.lineTo(vx + Math.cos(a2) * s, vy - Math.sin(a2) * s);
      ctx.stroke();
    }
  } else if (c.type === 'radius') {
    const k = O(c.refs.c), Cc = O(k.c);
    const [cx, cy] = w2s(Cc.x, Cc.y);
    const ol = Math.hypot(c.off.x, c.off.y) || 1, ux = c.off.x / ol, uy = c.off.y / ol;
    const [ex, ey] = w2s(Cc.x + ux * k.r, Cc.y + uy * k.r);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
    if (ol > k.r) ctx.lineTo(lx, ly);
    ctx.stroke();
    arrowHead(ctx, cx, cy, ex, ey);
  }
  const rect = pill(ctx, dimText(c), lx, ly, {
    color: color, border: selected ? COL.sel : hovered ? color : 'rgba(0,0,0,0)', selected,
    bg: selected ? '#fff7e6' : 'rgba(255,255,255,0.92)',
  });
  App.labelRects.push({ id: c.id, ...rect });
}

// ---------- constraint badges ----------
function screenMidNormal(ref, off = 14) {
  const [A, B] = pp(ref);
  const [ax, ay] = w2s(A.x, A.y), [bx, by] = w2s(B.x, B.y);
  const L = Math.hypot(bx - ax, by - ay) || 1;
  return [(ax + bx) / 2 - (by - ay) / L * off, (ay + by) / 2 + (bx - ax) / L * off];
}
function badgeAnchors(c) {
  const r = c.refs;
  const atPoint = id => { const p = O(id); const [x, y] = w2s(p.x, p.y); return [x + 13, y + 13]; };
  const atRef = ref => {
    if (!Array.isArray(ref) && O(ref).type === 'circle') {
      const k = O(ref), C = O(k.c);
      const [x, y] = w2s(C.x, C.y + k.r);
      return [x, y - 12];
    }
    return screenMidNormal(ref);
  };
  switch (c.type) {
    case 'coincident': return [atPoint(r.a)];
    case 'onLine': case 'onCircle': case 'midpoint': return [atPoint(r.p)];
    case 'horizontal': case 'vertical': return [atRef(r.l)];
    case 'parallel': case 'perpendicular': case 'equal': return [atRef(r.a), atRef(r.b)];
    case 'tangentLC': {
      const [A, B] = pp(r.l), C = O(O(r.c).c), F = Geo.project(C, A, B);
      const [x, y] = w2s(F.x, F.y); return [[x + 12, y - 12]];
    }
    case 'tangentCC': {
      const k1 = O(r.a), C1 = O(k1.c), C2 = O(O(r.b).c), d = Geo.dist(C1, C2) || 1;
      const [x, y] = w2s(C1.x + (C2.x - C1.x) / d * k1.r, C1.y + (C2.y - C1.y) / d * k1.r);
      return [[x + 12, y - 12]];
    }
    case 'symmetric': {
      const p = O(r.p), q = O(r.q);
      const [x, y] = w2s((p.x + q.x) / 2, (p.y + q.y) / 2); return [[x, y - 12]];
    }
    case 'bisector': {
      const V = O(r.v), D = O(r.d), d = Geo.dist(V, D) || 1, s = 34 / View.scale;
      const [x, y] = w2s(V.x + (D.x - V.x) / d * s, V.y + (D.y - V.y) / d * s); return [[x, y - 12]];
    }
  }
  return [];
}

// hidden elements are skipped, or drawn ghosted when "Show hidden" is on
function isShown(o) { return !!o && (!o.hidden || App.settings.showHidden); }
// a constraint is hidden with its objects (permanently-hidden `sys` references like an x-axis don't count)
function depsHidden(c) { return !App.settings.showHidden && constraintDeps(c).some(id => { const o = O(id); return o && o.hidden && !o.sys; }); }
function ghost(ctx, o) { ctx.globalAlpha = o.hidden ? 0.28 : 1; }

function drawBadges(ctx) {
  const stack = new Map();
  for (const c of Doc.data.constraints) {
    const def = CDEF[c.type];
    if (!def || def.dim || c.def || !isShown(c) || depsHidden(c)) continue;
    const bad = Solver.residualOf(c) > 1e-5;
    const selected = App.sel.has(c.id), hovered = App.hover && App.hover.id === c.id;
    for (let [x, y] of badgeAnchors(c)) {
      const key = Math.round(x / 10) + ',' + Math.round(y / 10);
      const n = stack.get(key) || 0;
      stack.set(key, n + 1);
      x += n * 19;
      ghost(ctx, c);
      const rect = pill(ctx, def.glyph, x, y, {
        font: '700 11px Inter, system-ui, sans-serif',
        color: bad ? COL.bad : selected ? '#92400e' : COL.badgeText,
        bg: selected ? '#fde68a' : hovered ? '#f1f5f9' : COL.badgeBg,
        border: bad ? COL.bad : selected ? COL.sel : COL.badgeBorder,
      });
      ctx.globalAlpha = 1;
      App.badgeRects.push({ id: c.id, ...rect });
    }
  }
}

// ---------- main render ----------
// `sel`: what is actually selected (or picked by the active tool).
// `rel`: objects a selected/hovered constraint refers to — drawn differently so they
// don't look selected.
function highlightIds() {
  const sel = new Set(), rel = new Set();
  const add = id => {
    sel.add(id);
    const o = O(id);
    if (o && o.refs) for (const d of constraintDeps(o)) rel.add(d);
  };
  for (const id of App.sel) add(id);
  const tool = Tools[App.tool];
  if (tool) {
    if (tool.picks) tool.picks.forEach(add);
    if (tool.highlight) tool.highlight().forEach(add);
  }
  const hov = App.hover && O(App.hover.id);
  if (hov && hov.refs) for (const d of constraintDeps(hov)) rel.add(d);
  return { sel, rel };
}

function render() {
  const ctx = App.ctx;
  ctx.setTransform(View.dpr, 0, 0, View.dpr, 0, 0);
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, View.W, View.H);
  drawGrid(ctx);
  recordTraces();
  drawTraces(ctx);
  App.labelRects = [];
  App.badgeRects = [];

  const { sel, rel } = highlightIds();
  const hov = App.hover && App.hover.id;
  const objs = Doc.data.objects;
  ctx.lineCap = 'round';
  // underlay: amber for selection/hover, violet for "referenced by the selected constraint"
  const underlay = (id, draw, isPoint) => {
    const isSel = sel.has(id), isHov = hov === id, isRel = rel.has(id);
    if (!isSel && !isHov && !isRel) return;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = ctx.fillStyle = isSel || isHov ? COL.sel : COL.related;
    ctx.globalAlpha = isSel ? 0.45 : isHov ? 0.25 : 0.3;
    ctx.lineWidth = isSel ? 7 : 5;
    draw(isPoint);
    ctx.restore();
  };

  // curves on the background layer (o.back) go under polygon fills
  const strokeCurve = o => (o.type === 'line' ? strokeLineWorld(ctx, O(o.p1), O(o.p2), o.kind) : strokeCircleWorld(ctx, o));
  const drawCurve = o => {
    ghost(ctx, o);
    ctx.strokeStyle = o.color || COL.line;
    ctx.lineWidth = o.width || (o.dashed ? 1.2 : 1.8);
    ctx.setLineDash(o.hidden ? [2, 4] : o.dashed ? [6, 5] : []);
    strokeCurve(o);
  };
  for (const o of objs) if (isCurve(o) && o.back) drawCurve(o);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // polygons
  for (const o of objs) {
    if (o.type !== 'polygon' || !isShown(o)) continue;
    const pts = o.pts.map(O);
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = w2s(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = o.color || COL.poly;
    ctx.globalAlpha = (o.alpha ?? 0.12) * (sel.has(o.id) ? 2 : hov === o.id ? 1.5 : 1) * (o.hidden ? 0.35 : 1);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // whirls (nested pursuit polygons)
  for (const o of objs) {
    if (o.type !== 'whirl' || !isShown(o)) continue;
    ctx.beginPath();
    for (const lv of whirlLevels(o)) {
      lv.forEach((p, i) => { const [x, y] = w2s(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath();
    }
    ctx.strokeStyle = o.color || COL.line;
    ctx.lineWidth = (o.width || 0.7) * Math.min(1.5, Math.max(0.3, View.scale / 90));
    ctx.globalAlpha = o.hidden ? 0.28 : 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // curves
  for (const o of objs) if (isCurve(o)) underlay(o.id, () => strokeCurve(o));
  for (const o of objs) if (isCurve(o) && !o.back) drawCurve(o);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  if (App.settings.showDims) {
    for (const c of Doc.data.constraints) {
      if (!CDEF[c.type] || !CDEF[c.type].dim || !isShown(c) || depsHidden(c)) continue;
      ghost(ctx, c);
      drawDim(ctx, c, App.sel.has(c.id), hov === c.id);
      ctx.globalAlpha = 1;
    }
  }
  if (App.settings.showCons) drawBadges(ctx);

  // tool preview
  const tool = Tools[App.tool];
  if (tool && tool.preview) {
    ctx.save();
    ctx.strokeStyle = COL.preview; ctx.fillStyle = COL.preview; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    tool.preview(ctx);
    ctx.restore();
  }

  // points
  const attached = new Set();
  for (const c of Doc.data.constraints) {
    if ((c.type === 'onLine' || c.type === 'onCircle') && !c.def) attached.add(c.refs.p);
    if (c.type === 'midpoint' || c.type === 'coincident') attached.add(c.refs.p || c.refs.a);
  }
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  for (const p of objs) {
    if (p.type !== 'point' || !isShown(p)) continue;
    const [x, y] = w2s(p.x, p.y);
    const r = p.aux ? 3.2 : 4.6;
    underlay(p.id, () => { ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.fill(); });
    ghost(ctx, p);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    if (p.fixed) {
      ctx.fillStyle = p.color || COL.pointFixed;
      ctx.beginPath(); ctx.rect(x - r, y - r, 2 * r, 2 * r); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = p.color || (p.aux ? COL.pointAux : attached.has(p.id) ? COL.pointOn : COL.point);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
    }
    if (App.settings.showLabels && !p.aux && p.showLabel !== false) {
      ctx.fillStyle = '#1e293b';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(251,251,253,0.9)';
      ctx.strokeText(p.name, x + 7, y - 4);
      ctx.fillText(p.name, x + 7, y - 4);
    }
    ctx.globalAlpha = 1;
  }

  // snap indicator for creation tools
  if (App.snap && App.tool !== 'move' && App.mouse.inside) {
    const s = App.snap;
    const [x, y] = w2s(s.x, s.y);
    ctx.strokeStyle = COL.snap; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, s.kind === 'free' ? 4 : 8, 0, TAU); ctx.stroke();
    if (s.kind === 'intersection' || s.kind === 'curve') {
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#b45309'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(s.kind === 'intersection' ? 'intersection' : 'on ' + (O(s.id).type === 'circle' ? 'circle' : 'line'), x + 10, y + 6);
    }
  }

  // box selection
  if (App.drag && App.drag.kind === 'box') {
    const d = App.drag;
    ctx.fillStyle = 'rgba(99,102,241,0.08)';
    ctx.strokeStyle = 'rgba(99,102,241,0.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    const x = Math.min(d.sx0, d.sx1), y = Math.min(d.sy0, d.sy1), w = Math.abs(d.sx1 - d.sx0), h = Math.abs(d.sy1 - d.sy0);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  // empty-state hint
  if (!objs.length) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 15px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Pick a tool on the left and click on the canvas — or load an example from the top bar.', View.W / 2, View.H / 2 - 40);
  }
}
