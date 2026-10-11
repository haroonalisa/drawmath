// live.js — when served by server.mjs, keep the drawing in sync with the scene file on disk.
// Edits made here are saved to the file; edits made to the file (e.g. by the drawmath CLI) appear here.
'use strict';

const Live = {
  enabled: false,
  id: 'tab-' + Math.random().toString(36).slice(2, 10),
  lastSynced: null,
  timer: null,

  async init() {
    try {
      const r = await fetch('api/health', { cache: 'no-store' });
      if (!r.ok || (await r.json()).app !== 'drawmath') return false;
    } catch (e) { return false; }
    Live.enabled = true;
    Live.setStatus(true);
    await Live.pull(true);
    const es = new EventSource('api/events');
    es.onmessage = ev => {
      Live.setStatus(true);
      const m = JSON.parse(ev.data);
      if (m.writer === 'reload') { location.reload(); return; }
      if (m.writer !== Live.id && m.writer !== 'hello') Live.pull(false);
    };
    es.onerror = () => Live.setStatus(false);
    return true;
  },

  setStatus(ok) {
    const el = $('#stLive');
    if (!el) return;
    el.innerHTML = ok ? '<span class="ok" title="Synced with the scene file on disk">● live</span>' : '<span class="err" title="Lost connection to the server">● offline</span>';
  },

  async pull(initial) {
    let text;
    try {
      const r = await fetch('api/scene', { cache: 'no-store' });
      if (r.status !== 200) { if (initial) Live.push(); return; }
      text = await r.text();
    } catch (e) { return; }
    let data;
    try { data = JSON.parse(text); } catch (e) { toast('Scene file is not valid JSON', 'error'); return; }
    if (!data || !Array.isArray(data.objects)) return;
    Live.applyExternal(data, initial);
  },

  applyExternal(data, initial) {
    const fit = data.fit || initial || !Doc.data.objects.length;
    delete data.fit;
    delete data.view;
    const playing = new Set(Doc.data.sliders.filter(s => s._playing).map(s => s.name));
    loadDoc(data);
    for (const s of Doc.data.sliders) if (playing.has(s.name) || s.play) { s._playing = true; delete s.play; }
    for (const id of [...App.sel]) if (!O(id)) App.sel.delete(id);
    for (const id of [...App.traces.keys()]) if (!O(id)) App.traces.delete(id);
    Solver.solve();
    Live.lastSynced = serialize();
    if (initial) History.reset(); else History.commit();
    App.dof = Solver.dof();
    if (fit || Live.outOfView()) zoomFit();
    UI.refreshAll();
    App.dirty = true;
    if (!initial) toast('Drawing updated from the scene file');
  },

  outOfView() {
    const [x0, y1] = s2w(0, 0), [x1, y0] = s2w(View.W, View.H);
    return Doc.data.objects.some(o => o.type === 'point' && !o.hidden && (o.x < x0 || o.x > x1 || o.y < y0 || o.y > y1));
  },

  // called whenever history changes; debounced save to the server
  schedulePush() {
    if (!Live.enabled) return;
    clearTimeout(Live.timer);
    Live.timer = setTimeout(Live.push, 300);
  },
  async push() {
    const s = serialize();
    if (s === Live.lastSynced) return;
    Live.lastSynced = s;
    try {
      await fetch('api/scene', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-client': Live.id }, body: s });
    } catch (e) { Live.setStatus(false); }
  },
};
