// ui.js — toolbar, constraint bar, side panels, toasts.
'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const ICONS = {
  move: '<path d="M6 3l12 9-5.5 1.2L16 20l-2.6 1.1-2.8-6.6L6 18z" fill="currentColor" stroke="none"/>',
  point: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
  segment: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="2" fill="currentColor"/><circle cx="19" cy="5" r="2" fill="currentColor"/>',
  line: '<path d="M2 21L22 3"/><circle cx="8.5" cy="15.2" r="2" fill="currentColor"/><circle cx="15.5" cy="8.8" r="2" fill="currentColor"/>',
  ray: '<path d="M5 19L22 4"/><circle cx="5" cy="19" r="2" fill="currentColor"/><circle cx="12.5" cy="12.4" r="2" fill="currentColor"/>',
  polygon: '<path d="M5 18L3.5 9.5 12 4l8.5 5.5L18 18z"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>',
  regpoly: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>',
  circle: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="17.7" cy="6.3" r="1.8" fill="currentColor"/>',
  circle3: '<circle cx="12" cy="12" r="8"/><circle cx="4" cy="12" r="1.8" fill="currentColor"/><circle cx="17.7" cy="6.3" r="1.8" fill="currentColor"/><circle cx="14" cy="19.7" r="1.8" fill="currentColor"/>',
  arc: '<path d="M4.5 16A8 8 0 0 1 19.5 16"/><circle cx="12" cy="16" r="1.6" fill="currentColor"/>',
  midpoint: '<path d="M3 18L21 6"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  intersect: '<path d="M4 4l16 16M20 4L4 20"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  perp: '<path d="M3 19h18M12 19V3"/><path d="M12 15h4v4"/>',
  parallel: '<path d="M3 15L15 3M9 21L21 9"/>',
  perpbis: '<path d="M3 15h18M12 3v18"/><circle cx="5" cy="15" r="1.8" fill="currentColor"/><circle cx="19" cy="15" r="1.8" fill="currentColor"/>',
  anglebis: '<path d="M4 20h16M4 20L14 5"/><path d="M4 20l15-7.5" stroke-dasharray="2 2.5"/>',
  tangent: '<circle cx="12" cy="14" r="6"/><path d="M2 8h20"/><circle cx="12" cy="8" r="1.6" fill="currentColor"/>',
  reflect: '<path d="M12 2v20" stroke-dasharray="2 2"/><path d="M9 7L3 17h6zM15 7l6 10h-6z"/>',
  dimension: '<path d="M4 7v10M20 7v10M4 12h16"/><path d="M7 9.5L4 12l3 2.5M17 9.5l3 2.5-3 2.5"/>',
  measure: '<rect x="2.5" y="8" width="19" height="8" rx="1"/><path d="M6 8v3M9.5 8v4.5M13 8v3M16.5 8v4.5"/>',
};

function toast(msg, type = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = ''; }, type === 'error' ? 4200 : 2800);
}

const UI = {
  _propsDirty: false,

  init() {
    // toolbar
    const tb = $('#toolbar');
    tb.innerHTML = TOOL_GROUPS.map(g => '<div class="tgroup">' + g.map(id => {
      const t = Tools[id];
      return `<button class="tool" data-tool="${id}" title="${esc(t.name)}${t.key ? ' (' + t.key.toUpperCase() + ')' : ''}"><svg viewBox="0 0 24 24">${ICONS[id] || ''}</svg></button>`;
    }).join('') + '</div>').join('');
    tb.addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) App.setTool(b.dataset.tool); });

    // constraint bar
    const cb = $('#consbar .buttons');
    cb.innerHTML = Object.entries(Actions).map(([k, a]) =>
      `${k === 'dimension' ? '<span class="sep"></span>' : ''}<button class="cbtn" data-cons="${k}" title="${esc(a.tip)}"><b>${a.glyph}</b>${a.label}</button>`).join('');
    cb.addEventListener('click', e => { const b = e.target.closest('[data-cons]'); if (b) runAction(b.dataset.cons); });

    // sliders panel
    $('#addSlider').addEventListener('click', () => {
      const s = addSlider(nextSliderName(), 1, 0, 10, 0.01);
      s._open = true;
      App.commit();
      UI.renderSliders();
    });
    const sl = $('#sliders');
    sl.addEventListener('input', e => {
      const row = e.target.closest('.slider'); if (!row) return;
      const s = O(row.dataset.id), f = e.target.dataset.f;
      if (f === 'range') {
        applySlider(s, parseFloat(e.target.value));
        row.querySelector('[data-f=value]').value = fmt(s.value, 4);
        App.dirty = true;
      }
    });
    sl.addEventListener('change', e => {
      const row = e.target.closest('.slider'); if (!row) return;
      const s = O(row.dataset.id), f = e.target.dataset.f, v = e.target.value;
      if (f === 'range') { App.commit(); return; }
      if (f === 'name') {
        const n = v.trim();
        if (n === s.name) return;
        if (!Expr.isValidName(n)) { toast(`"${n}" is not a valid variable name`, 'error'); e.target.value = s.name; return; }
        if (sliderByName(n)) { toast(`A variable named "${n}" already exists`, 'error'); e.target.value = s.name; return; }
        renameSlider(s, n);
      } else if (f === 'value') {
        const x = parseFloat(v);
        if (!isFinite(x)) { e.target.value = fmt(s.value, 4); return; }
        if (x < s.min) s.min = x;
        if (x > s.max) s.max = x;
        if (!applySlider(s, x)) toast('That value is impossible with the current constraints', 'warn');
      } else if (f === 'min' || f === 'max' || f === 'step' || f === 'speed') {
        const x = parseFloat(v);
        if (isFinite(x)) s[f] = f === 'step' ? Math.max(1e-6, x) : x;
        if (s.min > s.max) [s.min, s.max] = [s.max, s.min];
      } else if (f === 'mode') s.mode = v;
      App.commit();
      UI.renderSliders();
    });
    sl.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const row = b.closest('.slider'), s = O(row.dataset.id);
      if (b.dataset.act === 'play') {
        s._playing = !s._playing;
        if (s._playing && s.mode === 'once' && s.value >= s.max) applySlider(s, s.min);
        if (!s._playing) App.commit();
        UI.renderSliders();
      } else if (b.dataset.act === 'cfg') { s._open = !s._open; UI.renderSliders(); }
      else if (b.dataset.act === 'del') { removeSlider(s); Solver.solve(); App.commit(); UI.renderSliders(); }
    });

    // properties panel
    const pr = $('#props');
    pr.addEventListener('change', e => UI.onPropChange(e));
    pr.addEventListener('input', e => { if (e.target.dataset.live) UI.onPropChange(e); });
    pr.addEventListener('click', e => {
      const b = e.target.closest('[data-pact]'); if (!b) return;
      const o = O(b.dataset.id);
      const a = b.dataset.pact;
      if (a === 'delete') App.deleteIds([o.id]);
      else if (a === 'dimLen') { const k = addDimension('distance', { l: o.id }, true); App.afterBuild(); App.select([]); App.openDimEditor(k); }
      else if (a === 'dimRad') { const k = addDimension('radius', { c: o.id }, true); App.afterBuild(); App.select([]); App.openDimEditor(k); }
      else if (a === 'clearTrace') { App.traces.delete(o.id); App.dirty = true; }
      else if (a === 'select') App.select([b.dataset.id]);
      else if (a === 'hideSel') App.hideIds([...App.sel]);
      else if (a === 'showSel') { [...App.sel].forEach(id => setHidden(id, false)); App.commit(); }
    });

    // constraint list
    $('#consList').addEventListener('click', e => {
      const row = e.target.closest('[data-cid]'); if (!row) return;
      if (e.target.closest('.del')) App.deleteIds([row.dataset.cid]);
      else if (e.target.closest('.eye')) { const c = O(row.dataset.cid); setHidden(c.id, !c.hidden); App.commit(); }
      else App.select([row.dataset.cid], e.shiftKey);
    });
    $('#consList').addEventListener('dblclick', e => {
      const row = e.target.closest('[data-cid]'); if (!row) return;
      const c = O(row.dataset.cid);
      if (c && CDEF[c.type].dim) App.openDimEditor(c);
    });
  },

  refreshAll() {
    UI.renderSliders();
    UI.refreshProps();
    UI.refreshConstraints();
    UI.refreshToolbar();
    UI.refreshStatus();
  },

  refreshToolbar() {
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === App.tool));
    const s = selInfo();
    document.querySelectorAll('[data-cons]').forEach(b => { b.disabled = !Actions[b.dataset.cons].ok(s); });
    const t = Tools[App.tool];
    const hint = $('#hint');
    const html = (t.hint ? t.hint() : '');
    if (hint._html !== html) {
      hint.innerHTML = `<b>${esc(t.name)}</b> · ${html}`;
      hint._html = html;
      const inp = $('#optSides');
      if (inp) inp.addEventListener('change', () => { App.regN = Math.max(3, Math.min(40, parseInt(inp.value, 10) || 5)); inp.value = App.regN; });
    }
  },

  renderSliders() {
    const el = $('#sliders');
    if (!Doc.data.sliders.length) {
      el.innerHTML = '<p class="muted">No variables yet. Add a slider, or type a name (e.g. <code>a</code>, <code>2*a+1</code>) into any dimension — missing variables are created automatically.</p>';
      return;
    }
    el.innerHTML = Doc.data.sliders.map(s => `
      <div class="slider" data-id="${s.id}">
        <div class="srow">
          <button class="icon play ${s._playing ? 'on' : ''}" data-act="play" title="${s._playing ? 'Pause' : 'Animate'}">${s._playing ? '❚❚' : '▶'}</button>
          <input class="sname" data-f="name" value="${esc(s.name)}" spellcheck="false">
          <span class="eq">=</span>
          <input class="sval" data-f="value" type="number" step="${s.step}" value="${fmt(s.value, 4)}">
          <button class="icon" data-act="cfg" title="Range & animation settings">⚙</button>
          <button class="icon" data-act="del" title="Delete variable (its value is baked into expressions)">✕</button>
        </div>
        <input type="range" data-f="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}">
        <div class="cfg ${s._open ? '' : 'hidden'}">
          <label>min<input data-f="min" type="number" value="${s.min}"></label>
          <label>max<input data-f="max" type="number" value="${s.max}"></label>
          <label>step<input data-f="step" type="number" value="${s.step}"></label>
          <label>speed/s<input data-f="speed" type="number" value="${fmt(s.speed, 4)}"></label>
          <label>mode<select data-f="mode">${['bounce', 'loop', 'once'].map(m => `<option ${m === s.mode ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
        </div>
      </div>`).join('');
  },

  // cheap per-frame update of slider values (during animation)
  syncSliderValues() {
    for (const s of Doc.data.sliders) {
      const row = document.querySelector(`.slider[data-id="${s.id}"]`);
      if (!row) continue;
      const r = row.querySelector('[data-f=range]'), v = row.querySelector('[data-f=value]');
      if (document.activeElement !== r) r.value = s.value;
      if (document.activeElement !== v) v.value = fmt(s.value, 4);
      const pb = row.querySelector('.play');
      if (pb.classList.contains('on') !== !!s._playing) UI.renderSliders();
    }
  },

  refreshProps() {
    const el = $('#props');
    if (el.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') { UI._propsDirty = true; return; }
    UI._propsDirty = false;
    const ids = [...App.sel].filter(id => O(id));
    if (!ids.length) {
      const d = Doc.data;
      const count = t => d.objects.filter(o => o.type === t && !o.hidden).length;
      el.innerHTML = `<p class="muted">Nothing selected. Click an object to edit it; select several to apply constraints from the bar above.</p>
        <div class="stats"><span>${count('point')} points</span><span>${count('line')} lines</span><span>${count('circle')} circles</span><span>${count('polygon')} polygons</span><span>${d.constraints.length} constraints</span></div>`;
      return;
    }
    if (ids.length > 1) {
      el.innerHTML = `<p><b>${ids.length}</b> items selected</p><div class="chips">${ids.map(id => `<button class="chip" data-pact="select" data-id="${id}">${esc(UI.objLabel(O(id)))}</button>`).join('')}</div>
        <p class="muted small">Use the constraint bar above to relate them. Delete removes them all.</p>
        <div class="pactions"><button class="mini" data-pact="${ids.every(id => O(id).hidden) ? 'showSel' : 'hideSel'}">${ids.every(id => O(id).hidden) ? 'Show all' : 'Hide all'}</button></div>`;
      return;
    }
    const o = O(ids[0]);
    const vis = o.sys ? '' : `<label class="field"><span>Visible</span><input type="checkbox" data-prop="visible" data-id="${o.id}" ${o.hidden ? '' : 'checked'}></label>`;
    el.innerHTML = UI.propsHtml(o) + vis + `<div class="pactions"><button class="danger" data-pact="delete" data-id="${o.id}">Delete</button></div>`;
  },

  objLabel(o) {
    if (o.refs) return (CDEF[o.type].glyph || '') + ' ' + CDEF[o.type].label;
    const kind = o.type === 'line' ? o.kind : o.type === 'circle' && o.arc ? 'arc' : o.type;
    return kind + ' ' + nameOf(o.id);
  },

  propsHtml(o) {
    const f = (label, inner) => `<label class="field"><span>${label}</span>${inner}</label>`;
    const num = (key, v, live) => `<input type="number" step="any" data-prop="${key}" data-id="${o.id}" value="${fmt(v, 4)}" ${live ? 'data-live="1"' : ''}>`;
    const chk = (key, v) => `<input type="checkbox" data-prop="${key}" data-id="${o.id}" ${v ? 'checked' : ''}>`;
    const color = (key, v) => `<input type="color" data-prop="${key}" data-id="${o.id}" value="${v}">`;
    const title = t => `<div class="ptitle">${t}</div>`;
    switch (o.type) {
      case 'point':
        return title(`Point <b>${esc(o.aux ? '(helper)' : o.name)}</b>`) +
          (o.aux ? '' : f('Name', `<input type="text" data-prop="name" data-id="${o.id}" value="${esc(o.name)}">`)) +
          f('x', num('x', o.x)) + f('y', num('y', o.y)) +
          f('Fixed', chk('fixed', o.fixed)) +
          f('Trace path', chk('trace', o.trace) + (o.trace ? ` <button class="mini" data-pact="clearTrace" data-id="${o.id}">clear</button>` : '')) +
          f('Show label', chk('showLabel', o.showLabel !== false)) +
          f('Color', color('color', o.color || '#2563eb'));
      case 'line': {
        const A = O(o.p1), B = O(o.p2);
        return title(`${o.kind[0].toUpperCase() + o.kind.slice(1)} <b>${esc(nameOf(o.id))}</b>`) +
          f('Type', `<select data-prop="kind" data-id="${o.id}">${['segment', 'line', 'ray'].map(k => `<option ${k === o.kind ? 'selected' : ''}>${k}</option>`).join('')}</select>`) +
          f('Length', `<span class="ro">${fmt(Geo.dist(A, B), 4)}</span> <button class="mini" data-pact="dimLen" data-id="${o.id}">+ dimension</button>`) +
          f('Angle to x-axis', `<span class="ro">${fmt(Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI, 2)}°</span>`) +
          f('Dashed', chk('dashed', o.dashed)) +
          f('Color', color('color', o.color || '#334155'));
      }
      case 'circle': {
        const C = O(o.c);
        let extra = '';
        if (o.arc) {
          const [a1, a2] = arcAngles(o), span = Geo.norm2pi(a2 - a1);
          extra = f('Arc angle', `<span class="ro">${fmt(span * 180 / Math.PI, 2)}°</span>`) + f('Arc length', `<span class="ro">${fmt(span * o.r, 4)}</span>`);
        } else {
          extra = f('Circumference', `<span class="ro">${fmt(TAU * o.r, 4)}</span>`) + f('Area', `<span class="ro">${fmt(Math.PI * o.r * o.r, 4)}</span>`);
        }
        return title(`${o.arc ? 'Arc' : 'Circle'} <b>${esc(nameOf(o.id))}</b>`) +
          f('Center', `<span class="ro">${esc(C.name)} (${fmt(C.x, 3)}, ${fmt(C.y, 3)})</span>`) +
          f('Radius', num('r', o.r) + ` <button class="mini" data-pact="dimRad" data-id="${o.id}">+ dim</button>`) + extra +
          f('Dashed', chk('dashed', o.dashed)) +
          f('Color', color('color', o.color || '#334155'));
      }
      case 'whirl':
        return title(`Whirl <b>${esc(nameOf(o.id))}</b>`) +
          f('Step t', `<span class="ro">${esc(String(o.t))}</span>`) +
          f('Levels', `<span class="ro">${esc(String(o.steps))}</span>`) +
          f('Color', color('color', o.color || '#334155'));
      case 'polygon': {
        const pts = o.pts.map(O);
        let per = 0;
        pts.forEach((p, i) => { per += Geo.dist(p, pts[(i + 1) % pts.length]); });
        return title(`Polygon <b>${esc(nameOf(o.id))}</b>`) +
          f('Area', `<span class="ro">${fmt(Math.abs(Geo.polygonArea(pts)), 4)}</span>`) +
          f('Perimeter', `<span class="ro">${fmt(per, 4)}</span>`) +
          f('Fill', color('color', o.color || '#4f46e5')) +
          f('Opacity', `<input type="range" min="0" max="0.8" step="0.02" data-live="1" data-prop="alpha" data-id="${o.id}" value="${o.alpha ?? 0.12}">`);
      }
    }
    if (o.refs) {
      const def = CDEF[o.type];
      let h = title(`${def.glyph ? def.glyph + ' ' : ''}${def.label}`) + `<p class="small">${esc(describeConstraint(o))}</p>`;
      if (def.dim) {
        h += f('Driving', chk('driving', o.driving)) +
          (o.driving ? f('Value / expr', `<input type="text" data-prop="expr" data-id="${o.id}" value="${esc(o.expr)}" spellcheck="false">`) : '') +
          f('Current', `<span class="ro">${fmt(def.measure(o), 4)}${def.kind === 'angle' ? '°' : ''}</span>`) +
          (o._err ? `<p class="err">${esc(o._err)}</p>` : '') +
          `<p class="muted small">Expressions may use variables (sliders), + − * / ^, sqrt, sin/cos/tan (degrees), pi.</p>`;
      } else {
        const r = Solver.residualOf(o);
        h += `<p class="small ${r > 1e-5 ? 'err' : 'ok'}">${r > 1e-5 ? 'Not satisfied (residual ' + r.toExponential(2) + ')' : 'Satisfied'}</p>`;
      }
      return h;
    }
    return '';
  },

  onPropChange(e) {
    const t = e.target, key = t.dataset.prop;
    if (!key) return;
    const o = O(t.dataset.id);
    if (!o) return;
    const v = t.type === 'checkbox' ? t.checked : t.value;
    switch (key) {
      case 'x': case 'y': {
        const x = key === 'x' ? parseFloat(v) : o.x, y = key === 'y' ? parseFloat(v) : o.y;
        if (!isFinite(x) || !isFinite(y)) return;
        const snap = snapshotVars(), wasFixed = o.fixed;
        o.fixed = false;
        o.x = x; o.y = y;
        let ok = Solver.solve({ locked: new Set([o.id]) }).ok;
        if (!ok) { restoreVars(snap); o.x = x; o.y = y; ok = Solver.solve({ weights: new Map([[o.id, 1000]]) }).ok; }
        o.fixed = wasFixed;
        if (!ok) { restoreVars(snap); toast('Cannot move the point there with the current constraints', 'warn'); }
        break;
      }
      case 'r': {
        const r = parseFloat(v);
        if (!(r > 0)) return;
        const snap = snapshotVars();
        o.r = r;
        if (!Solver.solve({ locked: new Set([o.id]) }).ok) { restoreVars(snap); Solver.solve(); toast('That radius conflicts with the constraints (add/edit a radius dimension instead)', 'warn'); }
        break;
      }
      case 'name': {
        const n = v.trim();
        if (!n || Doc.data.objects.some(p => p !== o && p.type === 'point' && p.name === n)) { toast('Name must be unique', 'error'); t.value = o.name; return; }
        o.name = n;
        break;
      }
      case 'expr': App.setDimExpr(o, v); return;
      case 'driving': {
        if (v) {
          const rank0 = Solver.dof().rank;
          o.expr = fmt(CDEF[o.type].measure(o), 4);
          o.driving = true;
          if (Solver.dof().rank === rank0 || !Solver.solve().ok) { o.driving = false; Solver.solve(); toast('Already determined by other constraints — kept as reference', 'warn'); }
        }
        else o.driving = false;
        break;
      }
      case 'alpha': o.alpha = parseFloat(v); App.dirty = true; if (e.type === 'input') return; break;
      case 'fixed': o.fixed = v; Solver.solve(); break;
      case 'visible': setHidden(o.id, !v); break;
      case 'trace': o.trace = v; if (!v) App.traces.delete(o.id); break;
      default: o[key] = v;
    }
    App.commit();
    UI.refreshProps();
  },

  refreshConstraints() {
    const list = Doc.data.constraints;
    $('#consCount').textContent = list.length ? `(${list.length})` : '';
    if (!list.length) { $('#consList').innerHTML = '<p class="muted">No constraints yet.</p>'; return; }
    $('#consList').innerHTML = list.map(c => {
      const def = CDEF[c.type];
      const bad = c._err || Solver.residualOf(c) > 1e-5;
      const val = def.dim ? `<span class="cval ${c.driving ? 'drv' : 'ref'}">${esc(dimText(c))}</span>` : '';
      return `<div class="crow ${App.sel.has(c.id) ? 'sel' : ''} ${bad ? 'bad' : ''} ${c.hidden ? 'hid' : ''}" data-cid="${c.id}" title="${def.dim ? 'Double-click to edit' : ''}">
        <span class="cg">${def.glyph || (def.kind === 'angle' ? '∠' : '↔')}</span>
        <span class="cd"><b>${def.label}</b> ${esc(describeConstraint(c))}</span>${val}
        ${c.sys ? '' : `<button class="eye" title="${c.hidden ? 'Show' : 'Hide'} on canvas">${c.hidden ? '◌' : '◉'}</button>`}<button class="del" title="Delete constraint">✕</button></div>`;
    }).join('');
  },

  refreshStatus() {
    const d = App.dof;
    const st = Solver.last;
    $('#stDof').innerHTML = d ? (d.n === 0 ? '—' : d.dof === 0 ? '<span class="ok">Fully constrained</span>' : `<b>${d.dof}</b> degrees of freedom`) : '';
    $('#stSolver').innerHTML = st.ok ? '<span class="ok">● solved</span>' : `<span class="err">● unsatisfied (${st.err.toExponential(1)})</span>`;
  },

  refreshCoords() {
    const m = App.mouse;
    $('#stCoords').textContent = m.inside ? `x ${fmt(m.x, 3)}   y ${fmt(m.y, 3)}` : '';
  },
};
