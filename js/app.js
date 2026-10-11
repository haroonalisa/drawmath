// app.js — application state, input handling, animation loop, files, examples.
'use strict';

const App = {
  tool: 'move',
  sel: new Set(),
  hover: null,
  snap: null,
  drag: null,
  mouse: { sx: 0, sy: 0, x: 0, y: 0, inside: false },
  keys: { space: false, alt: false },
  settings: { grid: true, axes: true, snapGrid: false, showLabels: true, showDims: true, showCons: true, showHidden: false },
  traces: new Map(),
  labelRects: [],
  badgeRects: [],
  regN: 5,
  dirty: true,
  ctx: null,
  dof: null,
  editing: null,

  select(ids, add = false) {
    if (!add) App.sel.clear();
    ids.forEach(id => App.sel.add(id));
    App.onSelectionChange();
  },
  toggleSel(id) {
    App.sel.has(id) ? App.sel.delete(id) : App.sel.add(id);
    App.onSelectionChange();
  },
  onSelectionChange() {
    UI.refreshProps();
    UI.refreshConstraints();
    UI.refreshToolbar();
    App.dirty = true;
  },

  setTool(id) {
    const cur = Tools[App.tool];
    App.resetTool();
    if (cur && id !== App.tool) App.snap = null;
    App.tool = id;
    App.hover = null;
    // a creation tool picks its own inputs; a leftover selection would only look like one
    if (id !== 'move' && App.sel.size) App.select([]);
    $('#stage').dataset.tool = id;
    UI.refreshToolbar();
    App.dirty = true;
  },
  resetTool() {
    const t = Tools[App.tool];
    if (!t) return;
    if (t.reset) t.reset();
    if (t.picks) t.picks = [];
    App.commit(); // keep any points created mid-tool in history
  },

  commit() {
    // drop selection of things that no longer exist
    for (const id of [...App.sel]) if (!O(id)) App.sel.delete(id);
    if (History.commit()) App.dof = Solver.dof();
    UI.refreshAll();
    App.dirty = true;
  },
  afterBuild() {
    Solver.solve();
    App.commit();
  },

  // run fn, solve, and roll back everything if the result is unsolvable
  transaction(fn, label) {
    const before = serialize();
    try { fn(); } catch (e) {
      console.error(e);
      loadDoc(JSON.parse(before));
      toast(e.message, 'error');
      return false;
    }
    if (!Solver.solve().ok) {
      loadDoc(JSON.parse(before));
      Solver.solve();
      toast(`${label}: conflicts with existing constraints (over-constrained) — not applied`, 'error');
      App.dirty = true;
      return false;
    }
    App.commit();
    return true;
  },

  hideIds(ids) {
    ids = ids.filter(id => O(id) && O(id).type !== 'slider');
    if (!ids.length) { toast('Select something to hide first', 'warn'); return; }
    ids.forEach(id => setHidden(id, true));
    App.sel.clear();
    App.commit();
    if (!App.settings.showHidden) toast(`Hid ${ids.length} item${ids.length > 1 ? 's' : ''} — Shift+H shows everything again, or tick "Show hidden" to pick individual ones`);
  },
  showAll() {
    const n = showAllHidden();
    App.commit();
    toast(n ? `Showing ${n} hidden item${n > 1 ? 's' : ''}` : 'Nothing is hidden');
  },

  deleteIds(ids) {
    if (!ids.length) return;
    removeIds(ids);
    for (const id of [...App.traces.keys()]) if (!O(id)) App.traces.delete(id);
    App.sel.clear();
    Solver.solve();
    App.commit();
  },

  // ---------- dimension editing ----------
  openDimEditor(c) {
    if (!App.settings.showDims) { App.settings.showDims = true; syncSettingsUI(); }
    const ed = $('#dimEditor');
    if (!c.off) c.off = defaultDimOff(c);
    const an = dimAnchor(c);
    const [x, y] = w2s(an.x + c.off.x, an.y + c.off.y);
    ed.style.left = Math.max(70, Math.min(View.W - 70, x)) + 'px';
    ed.style.top = Math.max(16, Math.min(View.H - 16, y)) + 'px';
    ed.value = c.driving ? c.expr : fmt(dimValue(c), 4);
    ed.classList.add('open');
    App.editing = c;
    ed.focus();
    ed.select();
  },
  closeDimEditor(apply) {
    const ed = $('#dimEditor'), c = App.editing;
    if (!c) return;
    App.editing = null;
    ed.classList.remove('open');
    if (apply) App.setDimExpr(c, ed.value);
    $('#cv').focus();
  },
  setDimExpr(c, txt) {
    txt = String(txt).trim();
    if (!txt) return false;
    if (c.driving && txt === c.expr) return true;
    let ids;
    try { ids = Expr.identifiers(txt); } catch (e) { toast('Expression error: ' + e.message, 'error'); return false; }
    const before = serialize();
    const def = CDEF[c.type];
    const cur = def.measure(c);
    for (const id of ids) {
      if (sliderByName(id)) continue;
      if (!Expr.isValidName(id)) { toast(`"${id}" is not a valid variable name`, 'error'); return false; }
      const single = ids.size === 1 && txt === id;
      if (def.kind === 'angle') addSlider(id, single ? Math.round(cur) : 30, 0, 360, 1, { speed: 45 });
      else {
        const v = single ? parseFloat(fmt(cur, 2)) : 1;
        addSlider(id, v, 0, Math.max(10, Math.ceil(v * 2)), 0.01);
      }
      toast(`Created variable "${id}" — drag its slider in the Variables panel`, 'info');
    }
    const snap = snapshotVars();
    c.expr = txt;
    c.driving = true;
    // approach large changes gradually so the figure keeps its configuration
    prepareConstraints();
    if (c._err) { loadDoc(JSON.parse(before)); toast(c._err || 'Invalid expression', 'error'); return false; }
    const target = def.kind === 'angle' ? c._v * 180 / Math.PI : c._v;
    let ok = true;
    if (def.kind !== 'angle' && Math.abs(target - cur) > 1e-9) {
      const n = Math.min(20, Math.max(1, Math.ceil(Math.abs(target - cur) / Math.max(Math.abs(cur), 1e-3) * 10)));
      const realExpr = c.expr;
      for (let i = 1; i <= n && ok; i++) { c.expr = String(cur + (target - cur) * i / n); ok = Solver.solve().ok; }
      c.expr = realExpr;
    }
    ok = ok && Solver.solve().ok;
    if (!ok) {
      restoreVars(snap);
      loadDoc(JSON.parse(before));
      Solver.solve();
      toast('That value is impossible or over-constrained — reverted', 'error');
      App.commit();
      return false;
    }
    App.commit();
    return true;
  },
};

// ---------- sliders ----------
function applySlider(s, v, noInterp = false) {
  const old = s.value;
  const wasOk = Solver.solve().ok;
  const range = Math.abs(s.max - s.min) || 1;
  const n = noInterp ? 1 : Math.min(30, Math.max(1, Math.ceil(Math.abs(v - old) / (range / 100))));
  for (let i = 1; i <= n; i++) {
    const snap = snapshotVars(), prev = s.value;
    s.value = old + (v - old) * i / n;
    if (!Solver.solve().ok && wasOk) {
      s.value = prev;
      restoreVars(snap);
      Solver.solve();
      App.dirty = true;
      return false;
    }
  }
  s.value = v;
  App.dirty = true;
  UI._livePending = true;
  return true;
}

function animateSliders(dt) {
  let any = false;
  for (const s of Doc.data.sliders) {
    if (!s._playing) continue;
    any = true;
    const dir = s._dir || 1;
    let v = s.value + dir * s.speed * dt, wrapped = false;
    if (v > s.max || v < s.min) {
      if (s.mode === 'loop') { v = v > s.max ? s.min + (v - s.max) : s.max - (s.min - v); wrapped = true; }
      else if (s.mode === 'bounce') { s._dir = -dir; v = v > s.max ? 2 * s.max - v : 2 * s.min - v; }
      else { v = Math.max(s.min, Math.min(s.max, v)); s._playing = false; }
    }
    // an unreachable value (e.g. a linkage at its limit) reverses direction
    if (!applySlider(s, v, wrapped)) s._dir = -(s._dir || 1);
  }
  return any;
}

// ---------- view helpers ----------
function zoomFit() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const o of Doc.data.objects) {
    if (o.hidden) continue;
    if (o.type === 'point') add(o.x, o.y);
    else if (o.type === 'circle') { const C = O(o.c); add(C.x - o.r, C.y - o.r); add(C.x + o.r, C.y + o.r); }
  }
  if (!isFinite(x0)) { View.cx = 0; View.cy = 0; View.scale = 60; App.dirty = true; return; }
  const w = Math.max(x1 - x0, 1), h = Math.max(y1 - y0, 1);
  View.scale = Math.max(5, Math.min(400, Math.min(View.W / w, View.H / h) * 0.7));
  View.cx = (x0 + x1) / 2;
  View.cy = (y0 + y1) / 2;
  App.dirty = true;
}

function resize() {
  const st = $('#stage'), cv = $('#cv');
  const r = st.getBoundingClientRect();
  View.dpr = window.devicePixelRatio || 1;
  View.W = Math.max(1, r.width);
  View.H = Math.max(1, r.height);
  cv.width = Math.round(View.W * View.dpr);
  cv.height = Math.round(View.H * View.dpr);
  cv.style.width = View.W + 'px';
  cv.style.height = View.H + 'px';
  App.dirty = true;
}

// ---------- settings ----------
const SETTINGS_KEY = 'drawmath-settings-v1';
function syncSettingsUI() {
  document.querySelectorAll('[data-set]').forEach(el => { el.checked = !!App.settings[el.dataset.set]; });
}
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(App.settings)); } catch (e) { /* ignore */ } }

// ---------- files ----------
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function saveFile() {
  const data = JSON.parse(serialize());
  data.view = { cx: View.cx, cy: View.cy, scale: View.scale };
  download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), 'drawmath.json');
}
function openData(data, keepView) {
  if (!data || !Array.isArray(data.objects) || !Array.isArray(data.constraints)) throw new Error('Not a DrawMath file');
  const view = data.view;
  delete data.view;
  loadDoc(data);
  App.sel.clear();
  App.traces.clear();
  Solver.solve();
  History.reset();
  App.dof = Solver.dof();
  if (view && keepView !== false) Object.assign(View, view); else zoomFit();
  UI.refreshAll();
  App.dirty = true;
}
function newDoc() {
  for (const s of Doc.data.sliders) s._playing = false;
  loadDoc(emptyDoc());
  App.sel.clear();
  App.traces.clear();
  View.cx = 0; View.cy = 0; View.scale = 60;
  App.commit();
}

// ---------- examples ----------
const Examples = {
  fourbar: {
    name: 'Four-bar linkage (crank angle = slider t)',
    build() {
      const A = addPoint(0, 0, { fixed: true, name: 'A' }), D = addPoint(4, 0, { fixed: true, name: 'D' });
      addSlider('t', 60, 0, 360, 1, { speed: 90, mode: 'loop' });
      const B = addPoint(1.2 * Math.cos(Math.PI / 3), 1.2 * Math.sin(Math.PI / 3), { name: 'B' });
      const c0 = Geo.circleCircle(B, 3.5, D, 3).sort((p, q) => q.y - p.y)[0];
      const C = addPoint(c0.x, c0.y, { name: 'C' });
      const p0 = Geo.circleCircle(B, 2.6, C, 2.2).sort((p, q) => q.y - p.y)[0];
      const P = addPoint(p0.x, p0.y, { trace: true, color: '#e11d48', name: 'P' });
      const ground = addLine(A.id, D.id, 'segment', { dashed: true });
      const crank = addLine(A.id, B.id);
      addLine(C.id, D.id);
      Build.polygon([B.id, C.id, P.id], { color: '#e11d48', alpha: 0.1 });
      const dims = [
        [Build.dim('distance', { l: crank.id }, true), '1.2'],
        [Build.dim('distance', { l: [B.id, C.id] }, true), '3.5'],
        [Build.dim('distance', { l: [C.id, D.id] }, true), '3'],
        [Build.dim('distance', { l: [B.id, P.id] }, true), '2.6'],
        [Build.dim('distance', { l: [C.id, P.id] }, true), '2.2'],
        [Build.dim('angle', { a: ground.id, b: crank.id }, true), 't'],
      ];
      dims.forEach(([c, e]) => { c.expr = e; });
      const crankCircle = addCircle(A.id, 1.2, { dashed: true, color: '#94a3b8' });
      Build.on(B.id, crankCircle.id, true);
    },
    after() { const t = sliderByName('t'); if (t) t._playing = true; },
  },
  slidercrank: {
    name: 'Slider-crank / piston (angle th, rod length L)',
    build() {
      const A = addPoint(0, 0, { fixed: true }), R = addPoint(1, 0, { fixed: true, aux: true });
      const rail = addLine(A.id, R.id, 'line', { dashed: true, color: '#94a3b8' });
      addSlider('th', 40, 0, 360, 1, { speed: 120, mode: 'loop' });
      addSlider('L', 4.5, 2.5, 8, 0.05);
      const b = { x: 1.5 * Math.cos(0.7), y: 1.5 * Math.sin(0.7) };
      const B = addPoint(b.x, b.y);
      const C = addPoint(b.x + Math.sqrt(4.5 * 4.5 - b.y * b.y), 0);
      Build.on(C.id, rail.id);
      const crank = addLine(A.id, B.id), rod = addLine(B.id, C.id);
      Build.dim('distance', { l: crank.id }, true).expr = '1.5';
      Build.dim('distance', { l: rod.id }, true).expr = 'L';
      Build.dim('angle', { a: rail.id, b: crank.id }, true).expr = 'th';
      const M = Build.midpoint(rod.id);
      M.trace = true; M.color = '#e11d48'; M.name = 'M';
      const k = addCircle(A.id, 1.5, { dashed: true, color: '#94a3b8' });
      Build.on(B.id, k.id, true);
      Build.dim('distance', { l: [A.id, C.id] }, false);
    },
    after() { const t = sliderByName('th'); if (t) t._playing = true; },
  },
  triangle: {
    name: 'Triangle + circumcircle (side a, angle alpha)',
    build() {
      const A = addPoint(-3, -1.5, { fixed: true }), B = addPoint(3, -1.5), C = addPoint(0.5, 2.5);
      addSlider('a', 6, 2, 10, 0.01);
      addSlider('alpha', 55, 10, 140, 1, { speed: 30 });
      const { edges } = Build.polygon([A.id, B.id, C.id]);
      addConstraint('horizontal', { l: edges[0].id });
      Build.dim('distance', { l: edges[0].id }, true).expr = 'a';
      Build.dim('angle', { a: [A.id, B.id], b: [A.id, C.id] }, true).expr = 'alpha';
      const l1 = Build.perpBisector(edges[0].id), l2 = Build.perpBisector(edges[1].id);
      l1.dashed = l2.dashed = true;
      l1.color = l2.color = '#94a3b8';
      const [O1] = Build.intersections(l1.id, l2.id);
      if (O1) { O1.name = 'O'; const k = Build.circle(O1.id, A.id); k.color = '#0d9488'; Build.dim('radius', { c: k.id }, false); }
      Build.dim('angle', { a: [B.id, C.id], b: [B.id, A.id] }, false);
      Build.dim('angle', { a: [C.id, A.id], b: [C.id, B.id] }, false);
    },
  },
};

function loadExample(key) {
  const ex = Examples[key];
  if (!ex) return;
  if (Doc.data.objects.length && !confirm('Replace the current drawing with this example?')) return;
  for (const s of Doc.data.sliders) s._playing = false;
  loadDoc(emptyDoc());
  App.traces.clear();
  App.sel.clear();
  ex.build();
  Solver.solve();
  History.reset();
  App.dof = Solver.dof();
  zoomFit();
  App.setTool('move');
  if (ex.after) ex.after();
  UI.refreshAll();
}

// ---------- input ----------
function evCtx(e) {
  const r = $('#cv').getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const [x, y] = s2w(sx, sy);
  return { sx, sy, x, y, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
}

function initInput() {
  const cv = $('#cv');
  let down = null;

  cv.addEventListener('contextmenu', e => e.preventDefault());
  // focus is managed manually so the dimension editor can keep it after a click
  cv.addEventListener('mousedown', e => e.preventDefault());

  cv.addEventListener('pointerdown', e => {
    if (App.editing) App.closeDimEditor(true);
    cv.focus();
    cv.setPointerCapture(e.pointerId);
    const c = evCtx(e);
    App.keys.alt = e.altKey;
    if (e.button === 1 || e.button === 2 || App.keys.space) {
      App.drag = { kind: 'pan', sx: c.sx, sy: c.sy, cx: View.cx, cy: View.cy, moved: false, button: e.button };
      return;
    }
    if (e.button !== 0) return;
    down = c;
    const t = Tools[App.tool];
    if (t.down) t.down(c);
    if (App.tool !== 'move') { (t.hover || defaultHover)(c); UI.refreshToolbar(); }
    App.dirty = true;
  });

  cv.addEventListener('pointermove', e => {
    const c = evCtx(e);
    App.mouse = { sx: c.sx, sy: c.sy, x: c.x, y: c.y, inside: true };
    App.keys.alt = e.altKey;
    UI.refreshCoords();
    const d = App.drag;
    if (d && d.kind === 'pan') {
      View.cx = d.cx - (c.sx - d.sx) / View.scale;
      View.cy = d.cy + (c.sy - d.sy) / View.scale;
      if (Math.hypot(c.sx - d.sx, c.sy - d.sy) > 3) d.moved = true;
      App.dirty = true;
      return;
    }
    const t = Tools[App.tool];
    if (d && t.move) { t.move(c); App.dirty = true; UI._livePending = true; return; }
    const prevHover = App.hover && App.hover.id, prevSnap = App.snap && (App.snap.kind + App.snap.x + ',' + App.snap.y);
    (t.hover || defaultHover)(c);
    const nh = App.hover && App.hover.id, ns = App.snap && (App.snap.kind + App.snap.x + ',' + App.snap.y);
    if (nh !== prevHover || ns !== prevSnap || App.tool !== 'move') App.dirty = true;
    cv.style.cursor = App.keys.space ? 'grab' : App.tool === 'move' ? (App.hover ? (App.hover.kind === 'badge' ? 'pointer' : 'move') : 'default') : 'crosshair';
  });

  cv.addEventListener('pointerup', e => {
    const c = evCtx(e);
    const d = App.drag;
    if (d && d.kind === 'pan') {
      App.drag = null;
      if (!d.moved && d.button === 2) App.resetTool();
      App.dirty = true;
      return;
    }
    const t = Tools[App.tool];
    if (App.tool === 'move') {
      if (t.up) t.up(c);
      App.drag = null;
      UI.refreshProps();
    } else if (down && t.dragCreate && Math.hypot(c.sx - down.sx, c.sy - down.sy) > 8 && (t.picks && t.picks.length)) {
      t.down(c); // press-drag-release creates in one gesture
    }
    down = null;
    UI.refreshToolbar();
    App.dirty = true;
  });

  cv.addEventListener('pointerleave', () => { App.mouse.inside = false; UI.refreshCoords(); App.dirty = true; });

  cv.addEventListener('dblclick', e => {
    const t = Tools[App.tool];
    if (t.dblclick) t.dblclick(evCtx(e));
  });

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const c = evCtx(e);
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    const ns = Math.max(2, Math.min(5000, View.scale * f));
    View.cx = c.x - (c.sx - View.W / 2) / ns;
    View.cy = c.y + (c.sy - View.H / 2) / ns;
    View.scale = ns;
    App.dirty = true;
  }, { passive: false });

  // dimension editor
  const ed = $('#dimEditor');
  ed.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); App.closeDimEditor(true); }
    else if (e.key === 'Escape') { e.preventDefault(); App.closeDimEditor(false); }
    e.stopPropagation();
  });
  ed.addEventListener('blur', () => { if (App.editing) App.closeDimEditor(true); });

  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === ' ') { App.keys.space = true; $('#cv').style.cursor = 'grab'; e.preventDefault(); return; }
    if (e.key === 'Alt') { App.keys.alt = true; e.preventDefault(); }
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); return; }
    if (mod && k === 's') { e.preventDefault(); saveFile(); return; }
    if (mod && k === 'o') { e.preventDefault(); $('#fileInput').click(); return; }
    if (mod && k === 'a') { e.preventDefault(); App.select(Doc.data.objects.filter(o => isShown(o)).map(o => o.id)); return; }
    if (mod) return;
    if (e.key === 'Escape') {
      const t = Tools[App.tool];
      const busy = (t.picks && t.picks.length) || t.pick || t.line || t.point || t.circle || t.obj;
      if (busy) App.resetTool();
      else if (App.tool !== 'move') App.setTool('move');
      else App.select([]);
      App.dirty = true;
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); App.deleteIds([...App.sel]); return; }
    if (e.key === 'Enter') { const t = Tools[App.tool]; if (t.enter) t.enter(); return; }
    if (k === 'h') { e.shiftKey ? App.showAll() : App.hideIds([...App.sel]); return; }
    if (k === '?' || (e.shiftKey && k === '/')) { toggleHelp(); return; }
    if (k === 'home' || (k === 'z' && e.shiftKey)) { zoomFit(); return; }
    for (const [id, t] of Object.entries(Tools)) if (t.key === k && !e.shiftKey) { App.setTool(id); return; }
  });
  window.addEventListener('keyup', e => {
    if (e.key === ' ') { App.keys.space = false; $('#cv').style.cursor = ''; }
    if (e.key === 'Alt') App.keys.alt = false;
  });
  window.addEventListener('blur', () => { App.keys.space = false; App.keys.alt = false; });
}

function doUndo() { for (const s of Doc.data.sliders) s._playing = false; if (History.undo()) afterHistory(); }
function doRedo() { if (History.redo()) afterHistory(); }
function afterHistory() {
  for (const id of [...App.sel]) if (!O(id)) App.sel.delete(id);
  Tools[App.tool].reset && Tools[App.tool].reset();
  if (Tools[App.tool].picks) Tools[App.tool].picks = [];
  Solver.solve();
  App.dof = Solver.dof();
  UI.refreshAll();
  App.dirty = true;
}

function toggleHelp(force) {
  const h = $('#help');
  h.classList.toggle('hidden', force === undefined ? !h.classList.contains('hidden') : !force);
}

function initTopbar() {
  document.querySelectorAll('[data-act]').forEach(b => {
    if (b.closest('#sliders') || b.closest('#props')) return;
    b.addEventListener('click', () => {
      switch (b.dataset.act) {
        case 'new': if (!Doc.data.objects.length || confirm('Clear the canvas? (You can undo this.)')) newDoc(); break;
        case 'open': $('#fileInput').click(); break;
        case 'save': saveFile(); break;
        case 'svg': download(new Blob([exportSVG()], { type: 'image/svg+xml' }), 'drawmath.svg'); break;
        case 'png': App.dirty = true; render(); $('#cv').toBlob(bl => download(bl, 'drawmath.png')); break;
        case 'undo': doUndo(); break;
        case 'redo': doRedo(); break;
        case 'delete': App.deleteIds([...App.sel]); break;
        case 'hide': App.hideIds([...App.sel]); break;
        case 'showAll': App.showAll(); break;
        case 'fit': zoomFit(); break;
        case 'clearTraces': App.traces.clear(); App.dirty = true; break;
        case 'help': toggleHelp(); break;
        case 'closeHelp': toggleHelp(false); break;
      }
    });
  });
  document.querySelectorAll('[data-set]').forEach(el => el.addEventListener('change', () => {
    App.settings[el.dataset.set] = el.checked;
    saveSettings();
    App.dirty = true;
  }));
  const exSel = $('#examples');
  exSel.innerHTML = '<option value="">Examples…</option>' + Object.entries(Examples).map(([k, x]) => `<option value="${k}">${esc(x.name)}</option>`).join('');
  exSel.addEventListener('change', () => { const v = exSel.value; exSel.value = ''; if (v) loadExample(v); });
  $('#fileInput').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then(t => {
      try { openData(JSON.parse(t)); toast('Opened ' + f.name); } catch (err) { toast('Could not open file: ' + err.message, 'error'); }
    });
    e.target.value = '';
  });
  $('#help').addEventListener('click', e => { if (e.target.id === 'help') toggleHelp(false); });
}

// ---------- main loop ----------
let lastT = performance.now(), lastPanel = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  if (animateSliders(dt)) { App.dirty = true; UI._livePending = true; }
  if (App.dirty) {
    App.dirty = false;
    render();
    UI.syncSliderValues();
    UI.refreshToolbar();
  }
  if ((UI._livePending || UI._propsDirty) && t - lastPanel > 120) {
    lastPanel = t;
    UI._livePending = false;
    UI.refreshProps();
    UI.refreshConstraints();
    UI.refreshStatus();
  }
  requestAnimationFrame(frame);
}

function init() {
  App.ctx = $('#cv').getContext('2d');
  try { Object.assign(App.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* ignore */ }
  syncSettingsUI();
  UI.init();
  initTopbar();
  initInput();
  new ResizeObserver(resize).observe($('#stage'));
  resize();
  let restored = false;
  try {
    // fall back to the autosave from before the rename to DrawMath
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('geometry-lab-doc-v1');
    if (saved) { openData(JSON.parse(saved), false); restored = true; }
  } catch (e) { restored = false; }
  if (!restored) { History.reset(); App.dof = Solver.dof(); }
  App.setTool('move');
  UI.refreshAll();
  requestAnimationFrame(frame);
  Live.init();
}

window.addEventListener('DOMContentLoaded', init);
