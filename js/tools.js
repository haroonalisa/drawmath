// tools.js — snapping, construction builders, drag operations, tools, constraint actions.
'use strict';

// ---------- curve helpers ----------
function onArc(k, p) {
  if (!k.arc) return true;
  const C = O(k.c), [a1, a2] = arcAngles(k);
  return Geo.angleInArc(Math.atan2(p.y - C.y, p.x - C.x), a1, a2, 1e-6);
}

function curveIntersections(o1, o2) {
  if (o1.type === 'circle' && o2.type === 'line') [o1, o2] = [o2, o1];
  if (o1.type === 'line' && o2.type === 'line') {
    const X = Geo.lineLine(O(o1.p1), O(o1.p2), O(o2.p1), O(o2.p2));
    return X && Geo.inRange(X.t, o1.kind) && Geo.inRange(X.u, o2.kind) ? [X] : [];
  }
  if (o1.type === 'line') {
    return Geo.lineCircle(O(o1.p1), O(o1.p2), O(o2.c), o2.r).filter(p => Geo.inRange(p.t, o1.kind) && onArc(o2, p));
  }
  return Geo.circleCircle(O(o1.c), o1.r, O(o2.c), o2.r).filter(p => onArc(o1, p) && onArc(o2, p));
}

function projectOnto(o, x, y, clamp) {
  const p = { x, y };
  if (o.type === 'line') {
    const A = O(o.p1), B = O(o.p2), f = Geo.project(p, A, B);
    const t = clamp ? Geo.clampT(f.t, o.kind) : f.t;
    return { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y) };
  }
  const C = O(o.c);
  let a = Math.atan2(y - C.y, x - C.x);
  if (clamp && o.arc) {
    const [a1, a2] = arcAngles(o);
    if (!Geo.angleInArc(a, a1, a2)) {
      const d1 = Math.abs(Geo.wrap(a - a1)), d2 = Math.abs(Geo.wrap(a - a2));
      a = d1 < d2 ? a1 : a2;
    }
  }
  return { x: C.x + o.r * Math.cos(a), y: C.y + o.r * Math.sin(a) };
}

// ---------- snapping ----------
function snapAt(sx, sy, opt = {}) {
  const tol = 10;
  const hp = nearestPoint(sx, sy, tol, opt.exclude);
  if (hp) return { kind: 'point', id: hp.id, x: hp.x, y: hp.y };
  const [wx, wy] = s2w(sx, sy);
  if (!App.keys.alt) {
    const curves = curvesNear(sx, sy, tol + 4);
    let best = null;
    for (let i = 0; i < curves.length; i++) {
      for (let j = i + 1; j < curves.length; j++) {
        for (const X of curveIntersections(curves[i].o, curves[j].o)) {
          const [px, py] = w2s(X.x, X.y);
          const d = Math.hypot(px - sx, py - sy);
          if (d < tol + 2 && (!best || d < best.d)) best = { kind: 'intersection', a: curves[i].o.id, b: curves[j].o.id, x: X.x, y: X.y, d };
        }
      }
    }
    if (best) return best;
    if (curves.length && curves[0].d <= tol) {
      const P = projectOnto(curves[0].o, wx, wy, true);
      return { kind: 'curve', id: curves[0].o.id, x: P.x, y: P.y };
    }
  }
  let x = wx, y = wy;
  if (App.settings.snapGrid) { const st = gridStep(); x = Math.round(x / st) * st; y = Math.round(y / st) * st; }
  return { kind: 'free', x, y };
}

function realizeSnap(s) {
  if (s.kind === 'point') return O(s.id);
  const p = addPoint(s.x, s.y);
  if (s.kind === 'curve') Build.on(p.id, s.id);
  if (s.kind === 'intersection') { Build.on(p.id, s.a); Build.on(p.id, s.b); }
  return p;
}

// ---------- builders ----------
const Build = {
  on(pId, curveId, def = false) {
    const o = O(curveId);
    const extra = def ? { def: true } : {};
    return o.type === 'line' ? addConstraint('onLine', { p: pId, l: curveId }, extra) : addConstraint('onCircle', { p: pId, c: curveId }, extra);
  },
  circle(cId, pId) {
    const k = addCircle(cId, Geo.dist(O(cId), O(pId)), { through: pId });
    Build.on(pId, k.id, true);
    return k;
  },
  circle3(a, b, c) {
    const cc = Geo.circumcenter(O(a), O(b), O(c));
    if (!cc) return null;
    const ctr = addPoint(cc.x, cc.y, { aux: true });
    const k = addCircle(ctr.id, Geo.dist(cc, O(a)));
    ctr.owner = k.id;
    for (const id of [a, b, c]) Build.on(id, k.id, true);
    return k;
  },
  arc(cId, aId, bId) {
    const k = addCircle(cId, Geo.dist(O(cId), O(aId)), { through: aId, arc: { a: aId, b: bId } });
    Build.on(aId, k.id, true);
    Build.on(bId, k.id, false);
    return k;
  },
  polygon(ids, opt = {}) {
    const g = addPolygon(ids, opt);
    const edges = ids.map((id, i) => addLine(id, ids[(i + 1) % ids.length], 'segment', { owner: g.id }));
    return { g, edges };
  },
  rect(aId, cId) {
    const A = O(aId), C = O(cId);
    const B = addPoint(C.x, A.y), D = addPoint(A.x, C.y);
    const { g, edges } = Build.polygon([aId, B.id, cId, D.id]);
    addConstraint('horizontal', { l: edges[0].id });
    addConstraint('vertical', { l: edges[1].id });
    addConstraint('horizontal', { l: edges[2].id });
    addConstraint('vertical', { l: edges[3].id });
    return g;
  },
  regular(aId, bId, n) {
    const A = O(aId), B = O(bId), s = Geo.dist(A, B);
    if (s < 1e-9) return null;
    const nx = -(B.y - A.y) / s, ny = (B.x - A.x) / s;
    const ap = s / (2 * Math.tan(Math.PI / n)), R = s / (2 * Math.sin(Math.PI / n));
    const oc = { x: (A.x + B.x) / 2 + nx * ap, y: (A.y + B.y) / 2 + ny * ap };
    const th0 = Math.atan2(A.y - oc.y, A.x - oc.x);
    const ids = [aId, bId];
    for (let k = 2; k < n; k++) ids.push(addPoint(oc.x + R * Math.cos(th0 + TAU * k / n), oc.y + R * Math.sin(th0 + TAU * k / n)).id);
    const { g, edges } = Build.polygon(ids);
    const ctr = addPoint(oc.x, oc.y, { aux: true, owner: g.id });
    const k = addCircle(ctr.id, R, { hidden: true, sys: true, owner: g.id });
    for (const id of ids) addConstraint('onCircle', { p: id, c: k.id }, { def: true, hidden: true, sys: true });
    for (let i = 0; i + 1 < edges.length; i++) addConstraint('equal', { a: edges[i].id, b: edges[i + 1].id });
    return g;
  },
  midpoint(ref) {
    const [A, B] = pp(ref);
    const M = addPoint((A.x + B.x) / 2, (A.y + B.y) / 2);
    addConstraint('midpoint', { p: M.id, l: ref });
    return M;
  },
  perpLine(baseRef, pId, parallel = false) {
    const [A, B] = pp(baseRef), P = O(pId);
    const L = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    let ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
    if (!parallel) [ux, uy] = [-uy, ux];
    const s = 90 / View.scale;
    const Q = addPoint(P.x + ux * s, P.y + uy * s, { aux: true });
    const line = addLine(pId, Q.id, 'line');
    Q.owner = line.id;
    addConstraint(parallel ? 'parallel' : 'perpendicular', { a: line.id, b: baseRef });
    return line;
  },
  perpBisector(ref) {
    const M = Build.midpoint(ref);
    return Build.perpLine(ref, M.id);
  },
  angleBisector(a, v, b) {
    const A = O(a), V = O(v), B = O(b);
    const la = Geo.dist(A, V) || 1, lb = Geo.dist(B, V) || 1;
    let bx = (A.x - V.x) / la + (B.x - V.x) / lb, by = (A.y - V.y) / la + (B.y - V.y) / lb;
    if (Math.hypot(bx, by) < 1e-9) { bx = -(A.y - V.y) / la; by = (A.x - V.x) / la; }
    const bl = Math.hypot(bx, by), s = 110 / View.scale;
    const D = addPoint(V.x + bx / bl * s, V.y + by / bl * s, { aux: true });
    const ray = addLine(v, D.id, 'ray');
    D.owner = ray.id;
    addConstraint('bisector', { a, v, b, d: D.id });
    return ray;
  },
  tangents(pId, cId) {
    const P = O(pId), k = O(cId), C = O(k.c), d = Geo.dist(P, C);
    if (d < k.r - 1e-7) return null;
    if (Math.abs(d - k.r) < 1e-6) return [Build.perpLine([k.c, pId], pId)];
    const beta = Math.atan2(P.y - C.y, P.x - C.x), phi = Math.acos(k.r / d);
    return [beta + phi, beta - phi].map(a => {
      const T = addPoint(C.x + k.r * Math.cos(a), C.y + k.r * Math.sin(a));
      const L = addLine(pId, T.id, 'line');
      T.owner = L.id;
      addConstraint('onCircle', { p: T.id, c: cId }, { def: true });
      addConstraint('perpendicular', { a: L.id, b: [k.c, T.id] });
      return L;
    });
  },
  intersections(id1, id2) {
    return curveIntersections(O(id1), O(id2)).map(X => {
      const p = addPoint(X.x, X.y);
      Build.on(p.id, id1);
      Build.on(p.id, id2);
      return p;
    });
  },
  reflect(objId, mirrorId) {
    const [A, B] = pp(mirrorId);
    const map = new Map();
    const mp = id => {
      if (map.has(id)) return map.get(id);
      const m = Geo.reflect(O(id), A, B);
      const Q = addPoint(m.x, m.y);
      addConstraint('symmetric', { p: id, q: Q.id, l: mirrorId });
      map.set(id, Q.id);
      return Q.id;
    };
    const o = O(objId);
    if (o.type === 'point') return O(mp(o.id));
    if (o.type === 'line') return addLine(mp(o.p1), mp(o.p2), o.kind, { color: o.color, dashed: o.dashed });
    if (o.type === 'circle') {
      const k = addCircle(mp(o.c), o.r, { color: o.color, dashed: o.dashed, arc: o.arc ? { a: mp(o.arc.b), b: mp(o.arc.a) } : null });
      addConstraint('equal', { a: o.id, b: k.id });
      return k;
    }
    if (o.type === 'polygon') return Build.polygon(o.pts.map(mp).reverse(), { color: o.color, alpha: o.alpha }).g;
    return null;
  },
  dim(type, refs, driving, extra = {}) {
    const c = addConstraint(type, refs, { driving, expr: '0', ...extra });
    if (type === 'pldist') { const [A, B] = pp(refs.l); c.s = Math.sign(Geo.signedDist(O(refs.p), A, B)) || 1; }
    if (type === 'angle') { const [A, B] = pp(refs.a), [C, D] = pp(refs.b); c.s = Math.sign(Geo.signedAngle(A, B, C, D)) || 1; }
    const def = CDEF[type], m = def.measure(c);
    c.expr = fmt(m, def.kind === 'angle' ? 1 : 2);
    c._exact = fmt(m, 9);
    return c;
  },
};

// Adds a dimension; if a rounded value conflicts, falls back to the exact value,
// then to a reference (non-driving) measurement.
function addDimension(type, refs, driving, extra) {
  const dofBefore = driving ? Solver.dof().rank : 0;
  const c = Build.dim(type, refs, driving, extra);
  if (!driving) return c;
  const asReference = () => {
    c.driving = false;
    Solver.solve();
    toast('That value is already determined by other constraints — added as a reference measurement.', 'warn');
    return c;
  };
  // redundant dimension (does not remove a degree of freedom): keep it as a measurement
  if (Solver.dof().rank === dofBefore) return asReference();
  const snap = snapshotVars();
  if (Solver.solve().ok) return c;
  restoreVars(snap);
  c.expr = c._exact;
  if (Solver.solve().ok) return c;
  restoreVars(snap);
  return asReference();
}

// ---------- dragging ----------
function attachmentsOf(pid) {
  return Doc.data.constraints.filter(c => (c.type === 'onLine' || c.type === 'onCircle') && c.refs.p === pid && !c.def);
}
function dragTarget(p, x, y) {
  const att = attachmentsOf(p.id);
  if (att.length === 1) {
    const ref = att[0].refs.l || att[0].refs.c;
    if (!Array.isArray(ref)) return projectOnto(O(ref), x, y, true);
  }
  const own = p.owner && O(p.owner);
  if (own && own.type === 'line') return projectOnto(own, x, y, false);
  return { x, y };
}
function dragStep(p, x, y) {
  const t = dragTarget(p, x, y);
  const snap = snapshotVars();
  p.x = t.x; p.y = t.y;
  if (Solver.solve({ locked: new Set([p.id]), maxIter: 40 }).ok) return true;
  restoreVars(snap);
  p.x = t.x; p.y = t.y;
  if (Solver.solve({ weights: new Map([[p.id, 1000]]), maxIter: 60 }).ok) return true;
  restoreVars(snap);
  return false;
}
function dragPointTo(p, tx, ty) {
  if (p.fixed) return false;
  const sx = p.x, sy = p.y;
  const n = Math.min(24, Math.max(1, Math.ceil(Math.hypot(tx - sx, ty - sy) * View.scale / 25)));
  for (let i = 1; i <= n; i++) if (!dragStep(p, sx + (tx - sx) * i / n, sy + (ty - sy) * i / n)) return false;
  return true;
}

function groupPoints(objIds) {
  const pts = new Set(), objs = new Set();
  const add = id => {
    const o = O(id);
    if (!o || objs.has(id)) return;
    objs.add(id);
    if (o.type === 'point') pts.add(id);
    else if (o.type === 'line') { pts.add(o.p1); pts.add(o.p2); }
    else if (o.type === 'circle') { pts.add(o.c); if (o.through) pts.add(o.through); if (o.arc) { pts.add(o.arc.a); pts.add(o.arc.b); } }
    else if (o.type === 'polygon') { o.pts.forEach(x => pts.add(x)); Doc.data.objects.filter(l => l.owner === id).forEach(l => add(l.id)); }
  };
  objIds.forEach(add);
  for (const c of Doc.data.constraints) {
    if ((c.type === 'onLine' || c.type === 'onCircle') && objs.has(c.refs.l || c.refs.c)) pts.add(c.refs.p);
  }
  for (const o of Doc.data.objects) if (o.type === 'point' && o.owner && objs.has(o.owner)) pts.add(o.id);
  const list = [...pts].map(O).filter(Boolean);
  return list.some(p => p.fixed) ? null : list;
}
function translateStep(pts, dx, dy) {
  const snap = snapshotVars();
  for (const p of pts) { p.x += dx; p.y += dy; }
  const ids = new Set(pts.map(p => p.id));
  if (Solver.solve({ locked: ids, maxIter: 40 }).ok) return true;
  restoreVars(snap);
  for (const p of pts) { p.x += dx; p.y += dy; }
  if (Solver.solve({ weights: new Map(pts.map(p => [p.id, 1000])), maxIter: 60 }).ok) return true;
  restoreVars(snap);
  return false;
}
function translateGroup(pts, dx, dy) {
  const n = Math.min(24, Math.max(1, Math.ceil(Math.hypot(dx, dy) * View.scale / 25)));
  for (let i = 0; i < n; i++) if (!translateStep(pts, dx / n, dy / n)) return false;
  return true;
}

// ---------- tools ----------
function defaultHover(c) {
  App.snap = snapAt(c.sx, c.sy);
  App.hover = App.snap.kind === 'point' ? { kind: 'point', id: App.snap.id } : App.snap.kind === 'curve' ? { id: App.snap.id } : null;
}
function objectHover(filter) {
  return function (c) { App.snap = null; App.hover = hitTest(c.sx, c.sy, filter); };
}
const takePoint = c => realizeSnap(snapAt(c.sx, c.sy));

function lineTool(kind, name, key) {
  return {
    name, key, dragCreate: true, picks: [],
    hint() { return this.picks.length ? 'Click the second point' : 'Click the first point — snaps to points, lines, circles and intersections (hold Alt to not snap)'; },
    down(c) {
      const p = takePoint(c);
      if (!this.picks.length) { this.picks = [p.id]; return; }
      if (p.id === this.picks[0]) return;
      addLine(this.picks[0], p.id, kind);
      this.picks = [];
      App.afterBuild();
    },
    preview(ctx) { if (this.picks.length && App.snap) strokeLineWorld(ctx, O(this.picks[0]), App.snap, kind); },
  };
}

function previewCircle(ctx, C, r) {
  const [x, y] = w2s(C.x, C.y);
  ctx.beginPath(); ctx.arc(x, y, r * View.scale, 0, TAU); ctx.stroke();
}

function dimTool(driving) {
  return {
    name: driving ? 'Dimension (driving)' : 'Measure (reference)', key: driving ? 'd' : 'e', pick: null,
    hint() {
      const what = driving ? 'Dimension' : 'Measure';
      if (!this.pick) return `${what}: click a segment (length), a circle (radius), a point, or a line`;
      if (this.pick.kind === 'point') return 'Click a second point (distance) or a line (point–line distance)';
      return 'Click another line (angle), or click empty space / the same line to place a length';
    },
    hover: objectHover(['point', 'line', 'circle']),
    down(c) {
      const hit = hitTest(c.sx, c.sy, ['point', 'line', 'circle']);
      const make = (type, refs, extra) => {
        const k = addDimension(type, refs, driving, extra);
        this.pick = null;
        App.afterBuild();
        App.select([]);
        if (k.driving) App.openDimEditor(k);
      };
      if (!this.pick) {
        if (!hit) return;
        if (hit.kind === 'circle') return make('radius', { c: hit.id });
        this.pick = hit;
        return;
      }
      const a = this.pick;
      if (a.kind === 'point') {
        if (hit && hit.kind === 'point' && hit.id !== a.id) return make('distance', { l: [a.id, hit.id] });
        if (hit && hit.kind === 'line') return make('pldist', { p: a.id, l: hit.id });
        this.pick = null;
        return;
      }
      // first pick was a line
      if (hit && hit.kind === 'line' && hit.id !== a.id) return make('angle', { a: a.id, b: hit.id });
      const L = O(a.id), A = O(L.p1), B = O(L.p2);
      const mid = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
      const off = hit && hit.id === a.id ? undefined : { x: c.x - mid.x, y: c.y - mid.y };
      return make('distance', { l: a.id }, off ? { off } : {});
    },
    preview() {},
    reset() { this.pick = null; },
    highlight() { return this.pick ? [this.pick.id] : []; },
  };
}

const Tools = {
  move: {
    name: 'Move / Select', key: 'v',
    hint() { return 'Drag points & shapes · click to select · Shift+click to multi-select · drag empty space to box-select · double-click a dimension to edit · right-drag / Space+drag to pan · wheel to zoom'; },
    hover(c) { App.snap = null; App.hover = hitTest(c.sx, c.sy); },
    down(c) {
      const hit = hitTest(c.sx, c.sy);
      if (!hit) {
        if (!c.shift) App.select([]);
        App.drag = { kind: 'box', sx0: c.sx, sy0: c.sy, sx1: c.sx, sy1: c.sy, add: c.shift };
        return;
      }
      if (hit.kind === 'dim') {
        App.select([hit.id], c.shift);
        const k = O(hit.id), an = dimAnchor(k);
        if (!k.off) k.off = defaultDimOff(k);
        App.drag = { kind: 'label', k, gx: c.x - (an.x + k.off.x), gy: c.y - (an.y + k.off.y), moved: false };
        return;
      }
      if (hit.kind === 'badge') { App.select([hit.id], c.shift); return; }
      if (c.shift) { App.toggleSel(hit.id); return; }
      if (!App.sel.has(hit.id)) App.select([hit.id]);
      const objIds = [...App.sel].filter(id => { const o = O(id); return o && o.type; });
      if (hit.kind === 'point' && objIds.length <= 1) {
        const p = O(hit.id);
        App.drag = { kind: 'point', p, ox: p.x - c.x, oy: p.y - c.y, sx: c.sx, sy: c.sy, moved: false, hit: hit.id };
      } else {
        App.drag = { kind: 'group', pts: groupPoints(objIds), lx: c.x, ly: c.y, sx: c.sx, sy: c.sy, moved: false, hit: hit.id };
      }
    },
    move(c) {
      const d = App.drag;
      if (!d) return;
      if (d.kind === 'box') { d.sx1 = c.sx; d.sy1 = c.sy; return; }
      if (d.kind === 'label') {
        const an = dimAnchor(d.k);
        d.k.off = { x: c.x - d.gx - an.x, y: c.y - d.gy - an.y };
        d.moved = true;
        return;
      }
      if (!d.moved && Math.hypot(c.sx - d.sx, c.sy - d.sy) < 3) return;
      d.moved = true;
      if (d.kind === 'point') {
        let tx = c.x + d.ox, ty = c.y + d.oy;
        if (App.settings.snapGrid) { const st = gridStep(); tx = Math.round(tx / st) * st; ty = Math.round(ty / st) * st; }
        dragPointTo(d.p, tx, ty);
      } else if (d.kind === 'group' && d.pts) {
        let tx = c.x, ty = c.y;
        if (translateGroup(d.pts, tx - d.lx, ty - d.ly)) { d.lx = tx; d.ly = ty; }
      }
    },
    up() {
      const d = App.drag;
      if (!d) return;
      if (d.kind === 'box') {
        const [x0, y0] = s2w(Math.min(d.sx0, d.sx1), Math.max(d.sy0, d.sy1));
        const [x1, y1] = s2w(Math.max(d.sx0, d.sx1), Math.min(d.sy0, d.sy1));
        if (Math.abs(d.sx1 - d.sx0) > 3 || Math.abs(d.sy1 - d.sy0) > 3) {
          const inside = p => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
          const ids = [];
          for (const o of Doc.data.objects) {
            if (!isShown(o)) continue;
            if (o.type === 'point' && inside(o)) ids.push(o.id);
            else if (o.type === 'line' && inside(O(o.p1)) && inside(O(o.p2))) ids.push(o.id);
            else if (o.type === 'circle') { const C = O(o.c); if (inside({ x: C.x - o.r, y: C.y - o.r }) && inside({ x: C.x + o.r, y: C.y + o.r })) ids.push(o.id); }
            else if (o.type === 'polygon' && o.pts.every(id => inside(O(id)))) ids.push(o.id);
          }
          App.select(ids, d.add);
        }
      } else if (d.moved) App.commit();
      else if (d.hit && App.sel.size > 1) App.select([d.hit]); // plain click inside a multi-selection
    },
    dblclick(c) {
      const hit = hitTest(c.sx, c.sy, ['dim']);
      if (hit) App.openDimEditor(O(hit.id));
    },
  },

  point: {
    name: 'Point', key: 'p',
    hint() { return 'Click to place a point — on a line/circle it stays attached; at an intersection it is locked to both'; },
    down(c) {
      const s = snapAt(c.sx, c.sy);
      const p = realizeSnap(s);
      if (s.kind === 'point') App.select([p.id]); else App.afterBuild();
    },
  },
  segment: lineTool('segment', 'Segment', 's'),
  line: lineTool('line', 'Line', 'l'),
  ray: lineTool('ray', 'Ray', 'r'),

  polygon: {
    name: 'Polygon', key: 'g', picks: [],
    hint() { return this.picks.length < 3 ? `Click vertices (${this.picks.length} so far)` : 'Click the first vertex, double-click, or press Enter to close the polygon'; },
    down(c) {
      const s = snapAt(c.sx, c.sy);
      if (this.picks.length >= 3 && s.kind === 'point' && (s.id === this.picks[0] || s.id === this.picks[this.picks.length - 1])) return this.close();
      const p = realizeSnap(s);
      if (!this.picks.includes(p.id)) this.picks.push(p.id);
    },
    close() {
      if (this.picks.length < 3) return;
      Build.polygon(this.picks);
      this.picks = [];
      App.afterBuild();
    },
    enter() { this.close(); },
    preview(ctx) {
      if (!this.picks.length || !App.snap) return;
      const pts = this.picks.map(O).concat([App.snap]);
      ctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = w2s(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
      if (pts.length > 2) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        const [ax, ay] = w2s(App.snap.x, App.snap.y), [bx, by] = w2s(pts[0].x, pts[0].y);
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    },
  },

  rect: {
    name: 'Rectangle', key: 'b', picks: [], dragCreate: true,
    hint() { return this.picks.length ? 'Click the opposite corner' : 'Click the first corner (axis-aligned rectangle with H/V constraints)'; },
    down(c) {
      const p = takePoint(c);
      if (!this.picks.length) { this.picks = [p.id]; return; }
      const A = O(this.picks[0]);
      if (Math.abs(p.x - A.x) < 1e-6 || Math.abs(p.y - A.y) < 1e-6) { toast('Rectangle needs non-zero width and height', 'warn'); return; }
      Build.rect(this.picks[0], p.id);
      this.picks = [];
      App.afterBuild();
    },
    preview(ctx) {
      if (!this.picks.length || !App.snap) return;
      const A = O(this.picks[0]), [ax, ay] = w2s(A.x, A.y), [bx, by] = w2s(App.snap.x, App.snap.y);
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    },
  },

  regpoly: {
    name: 'Regular polygon', key: 'n', picks: [], dragCreate: true,
    hint() { return (this.picks.length ? 'Click the second vertex' : 'Click the first vertex of one edge') + ` · sides: <input id="optSides" type="number" min="3" max="40" value="${App.regN}">`; },
    down(c) {
      const p = takePoint(c);
      if (!this.picks.length) { this.picks = [p.id]; return; }
      if (p.id === this.picks[0]) return;
      Build.regular(this.picks[0], p.id, App.regN);
      this.picks = [];
      App.afterBuild();
    },
    preview(ctx) {
      if (!this.picks.length || !App.snap) return;
      const A = O(this.picks[0]), B = App.snap, n = App.regN, s = Geo.dist(A, B);
      if (s < 1e-9) return;
      const nx = -(B.y - A.y) / s, ny = (B.x - A.x) / s, ap = s / (2 * Math.tan(Math.PI / n)), R = s / (2 * Math.sin(Math.PI / n));
      const oc = { x: (A.x + B.x) / 2 + nx * ap, y: (A.y + B.y) / 2 + ny * ap }, th0 = Math.atan2(A.y - oc.y, A.x - oc.x);
      ctx.beginPath();
      for (let k = 0; k <= n; k++) { const [x, y] = w2s(oc.x + R * Math.cos(th0 + TAU * k / n), oc.y + R * Math.sin(th0 + TAU * k / n)); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    },
  },

  circle: {
    name: 'Circle (center, point)', key: 'c', picks: [], dragCreate: true,
    hint() { return this.picks.length ? 'Click a point on the circle (it defines the radius)' : 'Click the center'; },
    down(c) {
      const p = takePoint(c);
      if (!this.picks.length) { this.picks = [p.id]; return; }
      if (p.id === this.picks[0]) return;
      Build.circle(this.picks[0], p.id);
      this.picks = [];
      App.afterBuild();
    },
    preview(ctx) { if (this.picks.length && App.snap) previewCircle(ctx, O(this.picks[0]), Geo.dist(O(this.picks[0]), App.snap)); },
  },

  circle3: {
    name: 'Circle through 3 points', key: 'o', picks: [],
    hint() { return `Click 3 points on the circle (${this.picks.length}/3)`; },
    down(c) {
      const p = takePoint(c);
      if (this.picks.includes(p.id)) return;
      this.picks.push(p.id);
      if (this.picks.length < 3) return;
      const k = Build.circle3(...this.picks);
      this.picks = [];
      if (!k) toast('Points are collinear — no circle', 'warn');
      App.afterBuild();
    },
    preview(ctx) {
      if (this.picks.length !== 2 || !App.snap) return;
      const cc = Geo.circumcenter(O(this.picks[0]), O(this.picks[1]), App.snap);
      if (cc) previewCircle(ctx, cc, Geo.dist(cc, App.snap));
    },
  },

  arc: {
    name: 'Arc (center, start, end)', key: 'a', picks: [],
    hint() { return ['Click the arc center', 'Click the start point (sets the radius)', 'Click the end point (counter-clockwise)'][this.picks.length]; },
    down(c) {
      if (this.picks.length < 2) {
        const p = takePoint(c);
        if (!this.picks.includes(p.id)) this.picks.push(p.id);
        return;
      }
      const C = O(this.picks[0]), r = Geo.dist(C, O(this.picks[1]));
      let s = snapAt(c.sx, c.sy);
      if (s.kind === 'free') {
        const a = Math.atan2(s.y - C.y, s.x - C.x);
        s = { kind: 'free', x: C.x + r * Math.cos(a), y: C.y + r * Math.sin(a) };
      }
      const p = realizeSnap(s);
      if (this.picks.includes(p.id)) return;
      Build.arc(this.picks[0], this.picks[1], p.id);
      this.picks = [];
      App.afterBuild();
    },
    preview(ctx) {
      if (!this.picks.length || !App.snap) return;
      const C = O(this.picks[0]);
      if (this.picks.length === 1) return previewCircle(ctx, C, Geo.dist(C, App.snap));
      const S = O(this.picks[1]), r = Geo.dist(C, S);
      const a1 = Math.atan2(S.y - C.y, S.x - C.x), a2 = Math.atan2(App.snap.y - C.y, App.snap.x - C.x);
      const [x, y] = w2s(C.x, C.y);
      ctx.beginPath(); ctx.arc(x, y, r * View.scale, -a1, -a2, true); ctx.stroke();
    },
  },

  midpoint: {
    name: 'Midpoint', key: 'm', picks: [],
    hint() { return this.picks.length ? 'Click the second point' : 'Click a segment, or two points'; },
    hover(c) {
      const hit = hitTest(c.sx, c.sy, ['point', 'line']);
      if (!this.picks.length && hit && hit.kind === 'line') { App.snap = null; App.hover = hit; } else defaultHover(c);
    },
    down(c) {
      const hit = hitTest(c.sx, c.sy, ['point', 'line']);
      if (!this.picks.length && hit && hit.kind === 'line') { Build.midpoint(hit.id); return App.afterBuild(); }
      const p = takePoint(c);
      if (this.picks.includes(p.id)) return;
      this.picks.push(p.id);
      if (this.picks.length === 2) { Build.midpoint(this.picks.slice()); this.picks = []; App.afterBuild(); }
    },
  },

  intersect: {
    name: 'Intersection points', key: 'i', pick: null,
    hint() { return this.pick ? 'Click the second line or circle' : 'Click two lines/circles (or click right on an intersection)'; },
    hover(c) {
      const s = snapAt(c.sx, c.sy);
      if (!this.pick && s.kind === 'intersection') { App.snap = s; App.hover = null; return; }
      App.snap = null;
      App.hover = hitTest(c.sx, c.sy, ['line', 'circle']);
    },
    down(c) {
      const s = snapAt(c.sx, c.sy);
      if (!this.pick && s.kind === 'intersection') { realizeSnap(s); return App.afterBuild(); }
      const hit = hitTest(c.sx, c.sy, ['line', 'circle']);
      if (!hit) return;
      if (!this.pick) { this.pick = hit.id; return; }
      if (hit.id === this.pick) return;
      const pts = Build.intersections(this.pick, hit.id);
      this.pick = null;
      if (!pts.length) toast('These objects do not intersect', 'warn');
      App.afterBuild();
    },
    reset() { this.pick = null; },
    highlight() { return this.pick ? [this.pick] : []; },
  },

  perp: perpTool(false),
  parallel: perpTool(true),

  perpbis: {
    name: 'Perpendicular bisector', picks: [],
    hint() { return this.picks.length ? 'Click the second point' : 'Click a segment, or two points'; },
    hover: null,
    down(c) {
      const hit = hitTest(c.sx, c.sy, ['point', 'line']);
      if (!this.picks.length && hit && hit.kind === 'line') { Build.perpBisector(hit.id); return App.afterBuild(); }
      const p = takePoint(c);
      if (this.picks.includes(p.id)) return;
      this.picks.push(p.id);
      if (this.picks.length === 2) { Build.perpBisector(this.picks.slice()); this.picks = []; App.afterBuild(); }
    },
  },

  anglebis: {
    name: 'Angle bisector', picks: [],
    hint() { return ['Click a point on the first arm', 'Click the vertex', 'Click a point on the second arm'][this.picks.length]; },
    down(c) {
      const p = takePoint(c);
      if (this.picks.includes(p.id)) return;
      this.picks.push(p.id);
      if (this.picks.length === 3) { Build.angleBisector(...this.picks); this.picks = []; App.afterBuild(); }
    },
    preview(ctx) {
      const pts = this.picks.map(O).concat(App.snap ? [App.snap] : []);
      if (pts.length < 2) return;
      ctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = w2s(p.x, p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    },
  },

  tangent: {
    name: 'Tangent lines (point → circle)', key: 't', point: null, circle: null,
    hint() { return !this.circle ? (this.point ? 'Click a circle' : 'Click a point and a circle (any order)') : 'Click the point the tangents pass through'; },
    hover(c) {
      if (!this.circle) { const h = hitTest(c.sx, c.sy, ['point', 'circle']); if (h && h.kind === 'circle') { App.snap = null; App.hover = h; return; } }
      defaultHover(c);
    },
    down(c) {
      if (!this.circle) {
        const h = hitTest(c.sx, c.sy, ['point', 'circle']);
        if (h && h.kind === 'circle') { this.circle = h.id; if (this.point) this.build(); return; }
      }
      this.point = takePoint(c).id;
      if (this.circle) this.build();
    },
    build() {
      const res = Build.tangents(this.point, this.circle);
      this.point = this.circle = null;
      if (!res) toast('The point is inside the circle — no tangents', 'warn');
      App.afterBuild();
    },
    reset() { this.point = this.circle = null; },
    highlight() { return [this.point, this.circle].filter(Boolean); },
  },

  reflect: {
    name: 'Reflect about line', key: 'f', obj: null,
    hint() { return this.obj ? 'Click the mirror line' : 'Click the point / segment / circle / polygon to reflect'; },
    hover(c) { App.snap = null; App.hover = hitTest(c.sx, c.sy, this.obj ? ['line'] : ['point', 'line', 'circle', 'polygon']); },
    down(c) {
      if (!this.obj) { const h = hitTest(c.sx, c.sy, ['point', 'line', 'circle', 'polygon']); if (h) this.obj = h.id; return; }
      const h = hitTest(c.sx, c.sy, ['line']);
      if (!h || h.id === this.obj) return;
      Build.reflect(this.obj, h.id);
      this.obj = null;
      App.afterBuild();
    },
    reset() { this.obj = null; },
    highlight() { return this.obj ? [this.obj] : []; },
  },

  dimension: dimTool(true),
  measure: dimTool(false),
};

function perpTool(parallel) {
  return {
    name: parallel ? 'Parallel line' : 'Perpendicular line', line: null, point: null,
    hint() { return this.line ? 'Click the point the new line passes through' : this.point ? 'Click the reference line' : 'Click a line and a point (any order)'; },
    hover(c) {
      if (!this.line) { const h = hitTest(c.sx, c.sy, ['point', 'line']); if (h && h.kind === 'line') { App.snap = null; App.hover = h; return; } }
      defaultHover(c);
    },
    down(c) {
      if (!this.line) {
        const h = hitTest(c.sx, c.sy, ['point', 'line']);
        if (h && h.kind === 'line') { this.line = h.id; if (this.point) this.build(); return; }
      }
      this.point = takePoint(c).id;
      if (this.line) this.build();
    },
    build() { Build.perpLine(this.line, this.point, parallel); this.line = this.point = null; App.afterBuild(); },
    preview(ctx) {
      if (!this.line || !App.snap) return;
      const [A, B] = pp(this.line), L = Geo.dist(A, B) || 1;
      let ux = (B.x - A.x) / L, uy = (B.y - A.y) / L;
      if (!parallel) [ux, uy] = [-uy, ux];
      strokeLineWorld(ctx, App.snap, { x: App.snap.x + ux, y: App.snap.y + uy }, 'line');
    },
    reset() { this.line = this.point = null; },
    highlight() { return [this.line, this.point].filter(Boolean); },
  };
}

const TOOL_GROUPS = [
  ['move'],
  ['point', 'segment', 'line', 'ray', 'polygon', 'rect', 'regpoly'],
  ['circle', 'circle3', 'arc'],
  ['midpoint', 'intersect', 'perp', 'parallel', 'perpbis', 'anglebis', 'tangent', 'reflect'],
  ['dimension', 'measure'],
];

// ---------- constraint actions (apply to selection) ----------
function selInfo() {
  const items = [...App.sel].map(O).filter(o => o && o.type && o.type !== 'slider');
  const by = t => items.filter(o => o.type === t);
  return { items, n: items.length, points: by('point'), lines: by('line'), circles: by('circle') };
}

const Actions = {
  coincident: {
    label: 'Coincident', glyph: '◉', tip: 'Make 2+ selected points coincide',
    ok: s => s.points.length >= 2 && s.n === s.points.length,
    run: s => s.points.slice(1).forEach(p => addConstraint('coincident', { a: s.points[0].id, b: p.id })),
  },
  on: {
    label: 'On object', glyph: '∈', tip: 'Put selected point(s) on the selected line or circle',
    ok: s => s.points.length >= 1 && s.lines.length + s.circles.length === 1 && s.n === s.points.length + 1,
    run: s => { const curve = (s.lines[0] || s.circles[0]).id; s.points.forEach(p => Build.on(p.id, curve)); },
  },
  midpoint: {
    label: 'Midpoint', glyph: 'M', tip: 'Make the selected point the midpoint of the selected segment',
    ok: s => s.points.length === 1 && s.lines.length === 1 && s.n === 2,
    run: s => addConstraint('midpoint', { p: s.points[0].id, l: s.lines[0].id }),
  },
  fix: {
    label: 'Fix', glyph: '⚓', tip: 'Lock / unlock the selected points in place',
    ok: s => s.points.length >= 1,
    run: null, // handled directly (never conflicts)
  },
  horizontal: {
    label: 'Horizontal', glyph: 'H', tip: 'Horizontal: selected line(s) or 2 points',
    ok: s => (s.lines.length >= 1 && s.n === s.lines.length) || (s.points.length === 2 && s.n === 2),
    run: s => s.lines.length ? s.lines.forEach(l => addConstraint('horizontal', { l: l.id })) : addConstraint('horizontal', { l: [s.points[0].id, s.points[1].id] }),
  },
  vertical: {
    label: 'Vertical', glyph: 'V', tip: 'Vertical: selected line(s) or 2 points',
    ok: s => (s.lines.length >= 1 && s.n === s.lines.length) || (s.points.length === 2 && s.n === 2),
    run: s => s.lines.length ? s.lines.forEach(l => addConstraint('vertical', { l: l.id })) : addConstraint('vertical', { l: [s.points[0].id, s.points[1].id] }),
  },
  parallel: {
    label: 'Parallel', glyph: '∥', tip: 'Make 2+ selected lines parallel',
    ok: s => s.lines.length >= 2 && s.n === s.lines.length,
    run: s => s.lines.slice(1).forEach(l => addConstraint('parallel', { a: s.lines[0].id, b: l.id })),
  },
  perpendicular: {
    label: 'Perpendicular', glyph: '⊥', tip: 'Make 2 selected lines perpendicular',
    ok: s => s.lines.length === 2 && s.n === 2,
    run: s => addConstraint('perpendicular', { a: s.lines[0].id, b: s.lines[1].id }),
  },
  equal: {
    label: 'Equal', glyph: '=', tip: 'Equal length / radius: 2+ segments or circles',
    ok: s => s.lines.length + s.circles.length >= 2 && s.n === s.lines.length + s.circles.length,
    run: s => { const q = s.items; for (let i = 0; i + 1 < q.length; i++) addConstraint('equal', { a: q[i].id, b: q[i + 1].id }); },
  },
  tangent: {
    label: 'Tangent', glyph: 'T', tip: 'Tangent: a line and a circle, or two circles',
    ok: s => (s.lines.length === 1 && s.circles.length === 1 && s.n === 2) || (s.circles.length === 2 && s.n === 2),
    run: s => {
      if (s.lines.length) {
        const [A, B] = pp(s.lines[0].id), C = O(s.circles[0].c);
        addConstraint('tangentLC', { l: s.lines[0].id, c: s.circles[0].id }, { s: Math.sign(Geo.signedDist(C, A, B)) || 1 });
      } else {
        const [k1, k2] = s.circles, d = Geo.dist(O(k1.c), O(k2.c));
        const internal = d < Math.max(k1.r, k2.r);
        addConstraint('tangentCC', { a: k1.id, b: k2.id }, { internal, s: Math.sign(k1.r - k2.r) || 1 });
      }
    },
  },
  symmetric: {
    label: 'Symmetric', glyph: '⋈', tip: 'Two points symmetric about a line',
    ok: s => s.points.length === 2 && s.lines.length === 1 && s.n === 3,
    run: s => addConstraint('symmetric', { p: s.points[0].id, q: s.points[1].id, l: s.lines[0].id }),
  },
  dimension: {
    label: 'Dimension', glyph: '↔', tip: 'Driving dimension: segment / 2 points (length), point+line, 2 lines or 3 points (angle), circle (radius)',
    ok: s => !!dimSpec(s), run: null,
  },
  measure: {
    label: 'Measure', glyph: '📏', tip: 'Reference measurement (does not constrain)',
    ok: s => !!dimSpec(s), run: null,
  },
};

function dimSpec(s) {
  const { n, points: P, lines: L, circles: C } = s;
  if (n === 1 && L.length === 1) return ['distance', { l: L[0].id }];
  if (n === 1 && C.length === 1) return ['radius', { c: C[0].id }];
  if (n === 2 && P.length === 2) return ['distance', { l: [P[0].id, P[1].id] }];
  if (n === 2 && P.length === 1 && L.length === 1) return ['pldist', { p: P[0].id, l: L[0].id }];
  if (n === 2 && L.length === 2) return ['angle', { a: L[0].id, b: L[1].id }];
  if (n === 3 && P.length === 3) return ['angle', { a: [P[1].id, P[0].id], b: [P[1].id, P[2].id] }];
  return null;
}

function runAction(key) {
  const a = Actions[key], s = selInfo();
  if (!a.ok(s)) { toast(a.tip, 'warn'); return; }
  if (key === 'fix') {
    const allFixed = s.points.every(p => p.fixed);
    s.points.forEach(p => { p.fixed = !allFixed; });
    Solver.solve();
    App.commit();
    return;
  }
  if (key === 'dimension' || key === 'measure') {
    const [type, refs] = dimSpec(s);
    const k = addDimension(type, refs, key === 'dimension');
    App.afterBuild();
    App.select([]);
    if (k.driving) App.openDimEditor(k);
    return;
  }
  // clear the selection once applied, so the next pick starts fresh
  if (App.transaction(() => a.run(s), a.label)) App.select([]);
}
