// svg.js — export the drawing as a standalone SVG (used by the app's SVG button and the CLI).
'use strict';

function blend(hex, bg, a) {
  const p = h => { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, ch => ch + ch); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const [c, b] = [p(hex), p(bg)];
  return '#' + c.map((v, i) => Math.round(v * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}

function exportSVG(opts = {}) {
  const o = Object.assign({ maxWidth: 900, maxHeight: 700, pad: 36, labels: true, dims: true, constraints: false, background: '#ffffff' }, opts);
  const shown = x => x && !x.hidden;
  const objs = Doc.data.objects;

  // world bounding box of visible geometry (+ dimension labels)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const p of objs) {
    if (!shown(p)) continue;
    if (p.type === 'point') grow(p.x, p.y);
    else if (p.type === 'whirl' || p.type === 'polygon') p.pts.forEach(id => grow(O(id).x, O(id).y));
    else if (p.type === 'circle') {
      const C = O(p.c);
      if (p.arc) { const [a1, a2] = arcAngles(p); for (let t = 0; t <= 32; t++) { const a = a1 + Geo.norm2pi(a2 - a1) * t / 32; grow(C.x + p.r * Math.cos(a), C.y + p.r * Math.sin(a)); } }
      else { grow(C.x - p.r, C.y - p.r); grow(C.x + p.r, C.y + p.r); }
    }
  }
  if (!isFinite(x0)) { x0 = -5; y0 = -5; x1 = 5; y1 = 5; }
  const fitScale = () => o.scale || Math.min((o.maxWidth - 2 * o.pad) / Math.max(x1 - x0, 1e-3), (o.maxHeight - 2 * o.pad) / Math.max(y1 - y0, 1e-3), 120);
  // dimension labels without a stored offset get the default one for this output scale
  const dims = o.dims ? Doc.data.constraints.filter(c => CDEF[c.type] && CDEF[c.type].dim && shown(c) && !constraintDeps(c).some(id => O(id) && O(id).hidden && !O(id).sys)) : [];
  const offs = new Map();
  const viewScale = View.scale;
  View.scale = fitScale();
  for (const c of dims) offs.set(c, c.off || defaultDimOff(c));
  View.scale = viewScale;
  for (const c of dims) { const an = dimAnchor(c), f = offs.get(c); grow(an.x + f.x, an.y + f.y); }
  const w = Math.max(x1 - x0, 1e-3), h = Math.max(y1 - y0, 1e-3);
  const s = fitScale();
  const W = Math.ceil(w * s + 2 * o.pad), H = Math.ceil(h * s + 2 * o.pad);
  const X = x => +((x - x0) * s + o.pad).toFixed(2);
  const Y = y => +((y1 - y) * s + o.pad).toFixed(2);
  const e = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const out = [];
  const push = t => out.push(t);

  // clip an infinite line / ray to the canvas rectangle (in world units)
  const bx0 = x0 - o.pad / s, bx1 = x1 + o.pad / s, by0 = y0 - o.pad / s, by1 = y1 + o.pad / s;
  function clip(A, B, kind) {
    const dx = B.x - A.x, dy = B.y - A.y;
    let t0 = kind === 'segment' || kind === 'ray' ? 0 : -Infinity, t1 = kind === 'segment' ? 1 : Infinity;
    for (const [p, q] of [[-dx, A.x - bx0], [dx, bx1 - A.x], [-dy, A.y - by0], [dy, by1 - A.y]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    }
    if (kind === 'segment') { t0 = 0; t1 = 1; }
    if (t0 > t1) return null;
    return [A.x + t0 * dx, A.y + t0 * dy, A.x + t1 * dx, A.y + t1 * dy];
  }

  push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, Helvetica, Arial, sans-serif">`);
  if (o.background) push(`<rect width="100%" height="100%" fill="${o.background}"/>`);

  const lineSvg = l => {
    const seg = clip(O(l.p1), O(l.p2), l.kind);
    return seg ? `<line x1="${X(seg[0])}" y1="${Y(seg[1])}" x2="${X(seg[2])}" y2="${Y(seg[3])}" stroke="${l.color || COL.line}" stroke-width="${l.width || (l.dashed ? 1.2 : 1.8)}" stroke-linecap="round"${l.dashed ? ' stroke-dasharray="6 5"' : ''}/>` : '';
  };
  // background-layer lines (l.back) go under polygon fills
  for (const l of objs) if (l.type === 'line' && l.back && shown(l)) push(lineSvg(l));
  for (const g of objs) {
    if (g.type !== 'polygon' || !shown(g)) continue;
    const col = g.color || COL.poly, a = g.alpha ?? 0.12;
    const fill = o.background ? blend(col, o.background, a) : col;
    push(`<polygon points="${g.pts.map(id => X(O(id).x) + ',' + Y(O(id).y)).join(' ')}" fill="${fill}"${o.background ? '' : ` fill-opacity="${a}"`} stroke="none"/>`);
  }
  for (const w of objs) {
    if (w.type !== 'whirl' || !shown(w)) continue;
    const d = whirlLevels(w).map(lv => 'M' + lv.map(p => X(p.x) + ' ' + Y(p.y)).join('L') + 'Z').join('');
    push(`<path d="${d}" fill="none" stroke="${w.color || COL.line}" stroke-width="${w.width || 0.7}" stroke-linejoin="round"/>`);
  }
  for (const c of objs) {
    if (c.type !== 'circle' || !shown(c)) continue;
    const C = O(c.c), st = `fill="none" stroke="${c.color || COL.line}" stroke-width="${c.dashed ? 1.2 : 1.8}"${c.dashed ? ' stroke-dasharray="6 5"' : ''}`;
    if (c.arc) {
      const [a1, a2] = arcAngles(c), span = Geo.norm2pi(a2 - a1);
      const sx = C.x + c.r * Math.cos(a1), sy = C.y + c.r * Math.sin(a1), ex = C.x + c.r * Math.cos(a2), ey = C.y + c.r * Math.sin(a2);
      push(`<path d="M${X(sx)} ${Y(sy)} A${(c.r * s).toFixed(2)} ${(c.r * s).toFixed(2)} 0 ${span > Math.PI ? 1 : 0} 0 ${X(ex)} ${Y(ey)}" ${st}/>`);
    } else push(`<circle cx="${X(C.x)}" cy="${Y(C.y)}" r="${(c.r * s).toFixed(2)}" ${st}/>`);
  }
  for (const l of objs) if (l.type === 'line' && !l.back && shown(l)) push(lineSvg(l));

  // dimensions
  const arrow = (fx, fy, tx, ty, col) => {
    const a = Math.atan2(ty - fy, tx - fx), z = 7;
    return `<path d="M${tx.toFixed(2)} ${ty.toFixed(2)} L${(tx - z * Math.cos(a - 0.4)).toFixed(2)} ${(ty - z * Math.sin(a - 0.4)).toFixed(2)} L${(tx - z * Math.cos(a + 0.4)).toFixed(2)} ${(ty - z * Math.sin(a + 0.4)).toFixed(2)}Z" fill="${col}"/>`;
  };
  for (const c of dims) {
    const col = c.driving ? COL.dim : COL.dimRef;
    const off = offs.get(c);
    const an = dimAnchor(c), L = { x: an.x + off.x, y: an.y + off.y };
    const ln = (ax, ay, bx, by, extra = '') => `<line x1="${X(ax)}" y1="${Y(ay)}" x2="${X(bx)}" y2="${Y(by)}" stroke="${col}" stroke-width="1"${extra}/>`;
    if (c.type === 'distance') {
      const [A, B] = pp(c.refs.l), len = Geo.dist(A, B) || 1e-9;
      const n = { x: -(B.y - A.y) / len, y: (B.x - A.x) / len }, hh = off.x * n.x + off.y * n.y;
      const A2 = { x: A.x + n.x * hh, y: A.y + n.y * hh }, B2 = { x: B.x + n.x * hh, y: B.y + n.y * hh };
      if (Math.abs(hh) * s > 4) { push(ln(A.x, A.y, A2.x, A2.y)); push(ln(B.x, B.y, B2.x, B2.y)); }
      push(ln(A2.x, A2.y, B2.x, B2.y));
      if (len * s > 24) { push(arrow(X((A2.x + B2.x) / 2), Y((A2.y + B2.y) / 2), X(A2.x), Y(A2.y), col)); push(arrow(X((A2.x + B2.x) / 2), Y((A2.y + B2.y) / 2), X(B2.x), Y(B2.y), col)); }
    } else if (c.type === 'pldist') {
      const P = O(c.refs.p), [A, B] = pp(c.refs.l), F = Geo.project(P, A, B);
      push(ln(P.x, P.y, F.x, F.y, ' stroke-dasharray="4 3"'));
    } else if (c.type === 'angle') {
      const [A, B] = pp(c.refs.a), [C, D] = pp(c.refs.b), V = angleVertex(c);
      const a1 = Math.atan2(B.y - A.y, B.x - A.x), th = Geo.signedAngle(A, B, C, D);
      const R = Math.max(14 / s, Math.hypot(off.x, off.y) - 2 / s);
      const sx = V.x + R * Math.cos(a1), sy = V.y + R * Math.sin(a1), ex = V.x + R * Math.cos(a1 + th), ey = V.y + R * Math.sin(a1 + th);
      push(`<path d="M${X(sx)} ${Y(sy)} A${(R * s).toFixed(2)} ${(R * s).toFixed(2)} 0 0 ${th > 0 ? 0 : 1} ${X(ex)} ${Y(ey)}" fill="none" stroke="${col}" stroke-width="1.3"/>`);
    } else if (c.type === 'radius') {
      const k = O(c.refs.c), C = O(k.c), ol = Math.hypot(off.x, off.y) || 1;
      const E = { x: C.x + off.x / ol * k.r, y: C.y + off.y / ol * k.r };
      push(ln(C.x, C.y, E.x, E.y));
      if (ol > k.r) push(ln(E.x, E.y, L.x, L.y));
      push(arrow(X(C.x), Y(C.y), X(E.x), Y(E.y), col));
    }
    const t = dimText(c), tw = t.length * 6.6 + 10;
    push(`<rect x="${(X(L.x) - tw / 2).toFixed(1)}" y="${(Y(L.y) - 9).toFixed(1)}" width="${tw.toFixed(1)}" height="18" rx="5" fill="#ffffff" fill-opacity="0.92"/>`);
    push(`<text x="${X(L.x)}" y="${Y(L.y) + 4}" font-size="12" font-weight="600" text-anchor="middle" fill="${col}">${e(t)}</text>`);
  }

  // points & labels
  const attached = new Set();
  for (const c of Doc.data.constraints) if ((c.type === 'onLine' || c.type === 'onCircle') && !c.def) attached.add(c.refs.p);
  for (const p of objs) {
    if (p.type !== 'point' || !shown(p) || p.aux) continue; // helper handles are not part of the figure
    const r = p.aux ? 3 : 4.2, x = X(p.x), y = Y(p.y);
    const fill = p.color || (p.fixed ? COL.pointFixed : p.aux ? COL.pointAux : attached.has(p.id) ? COL.pointOn : COL.point);
    push(p.fixed ? `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`
      : `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`);
    if (o.labels && !p.aux && p.showLabel !== false) {
      const t = `x="${x + 7}" y="${y - 5}" font-size="13" font-weight="600"`;
      push(`<text ${t} fill="#ffffff" stroke="#ffffff" stroke-width="3" stroke-linejoin="round">${e(p.name)}</text>`);
      push(`<text ${t} fill="#1e293b">${e(p.name)}</text>`);
    }
  }
  push('</svg>');
  return out.join('\n');
}
