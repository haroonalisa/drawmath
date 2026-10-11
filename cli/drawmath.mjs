#!/usr/bin/env node
// drawmath — build DrawMath drawings from a short scene script, headlessly.
//
//   node cli/drawmath.mjs build <scene.js> [--out FILE] [--append] [--png FILE] [--svg FILE] [--no-fit]
//   node cli/drawmath.mjs info  [FILE]                 summary of a drawing (points, constraints, sliders)
//   node cli/drawmath.mjs svg   [FILE] --out x.svg [--png x.png]
//
// FILE defaults to scenes/current.json — the file the live server (server.mjs) syncs with the
// browser, so a build shows up in the open app immediately. The scene-script API is in cli/api.js.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = path.join(ROOT, 'scenes', 'current.json');
const ENGINE = ['expr', 'geom', 'model', 'solver', 'view', 'svg', 'tools', 'ui', 'app'].map(f => path.join(ROOT, 'js', f + '.js'));

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = n => argv.includes('--' + n);
const opt = n => { const i = argv.indexOf('--' + n); return i > 0 ? argv[i + 1] : undefined; };
const VALUE_FLAGS = ['--out', '--png', '--svg'];
const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !VALUE_FLAGS.includes(arr[i - 1]));

function engine() {
  const sandbox = {
    console, performance, setTimeout, clearTimeout,
    window: { addEventListener() {}, devicePixelRatio: 1 },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => ({}), body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: () => 0,
    ResizeObserver: class { observe() {} },
  };
  vm.createContext(sandbox);
  const src = ENGINE.map(f => fs.readFileSync(f, 'utf8')).join('\n;\n') + '\n;\n' +
    fs.readFileSync(path.join(ROOT, 'cli', 'api.js'), 'utf8') +
    '\n;globalThis.__E = { Doc, loadDoc, emptyDoc, Solver, serialize, exportSVG, CDEF, O, nameOf, describeConstraint, dimText, dimValue, fmt, Geo, pp, arcAngles, __warnings };';
  vm.runInContext(src, sandbox, { filename: 'drawmath-engine.js' });
  return { ctx: sandbox, ...sandbox.__E };
}

function load(E, file) {
  if (!fs.existsSync(file)) throw new Error(`No drawing at ${file}`);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete data.fit; delete data.view;
  E.loadDoc(data);
}

function write(E, file, fit) {
  const data = JSON.parse(E.serialize());
  if (fit) data.fit = true;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

function summary(E) {
  const { Doc, O, fmt, Solver, CDEF } = E;
  const L = [];
  const st = Solver.last;
  const d = Solver.dof();
  L.push(st.ok ? `✓ all constraints satisfied (max residual ${st.err.toExponential(1)})` : `✗ CONSTRAINTS NOT SATISFIED (max residual ${st.err.toExponential(2)}) — see "Unsatisfied" below`);
  L.push(`Degrees of freedom: ${d.dof}${d.dof === 0 ? ' (fully determined)' : ' (figure can still move/flex that many ways)'}`);
  const objs = Doc.data.objects;
  const hid = o => (o.hidden ? ' (hidden)' : '');
  const pts = objs.filter(o => o.type === 'point' && !o.aux);
  if (pts.length) L.push('Points:', ...pts.map(p => `  ${p.name} (${fmt(p.x, 3)}, ${fmt(p.y, 3)})${p.fixed ? ' fixed' : ''}${p.trace ? ' traced' : ''}${hid(p)}`));
  const aux = objs.filter(o => o.type === 'point' && o.aux).length;
  if (aux) L.push(`  + ${aux} helper point(s)`);
  const lines = objs.filter(o => o.type === 'line' && !(O(o.p1).aux && O(o.p2).aux && o.hidden));
  if (lines.length) L.push('Lines:', ...lines.map(l => `  ${E.nameOf(l.id)} ${l.kind}${l.kind === 'segment' ? ` length ${fmt(E.Geo.dist(O(l.p1), O(l.p2)), 3)}` : ''}${hid(l)}`));
  const circles = objs.filter(o => o.type === 'circle' && !o.sys);
  if (circles.length) L.push('Circles:', ...circles.map(k => `  ${E.nameOf(k.id)} center ${O(k.c).aux ? `(${fmt(O(k.c).x, 3)}, ${fmt(O(k.c).y, 3)})` : O(k.c).name} r=${fmt(k.r, 3)}${k.arc ? ' (arc)' : ''}${hid(k)}`));
  const polys = objs.filter(o => o.type === 'polygon');
  if (polys.length) L.push('Polygons:', ...polys.map(g => `  ${E.nameOf(g.id)} area ${fmt(Math.abs(E.Geo.polygonArea(g.pts.map(O))), 3)}${hid(g)}`));
  const cons = Doc.data.constraints.filter(c => !c.sys);
  if (cons.length) {
    L.push('Constraints & dimensions:');
    for (const c of cons) {
      const def = CDEF[c.type];
      L.push(`  ${def.label}: ${E.describeConstraint(c)}${def.dim ? ' = ' + E.dimText(c) : ''}`);
    }
  }
  if (Doc.data.sliders.length) L.push('Sliders:', ...Doc.data.sliders.map(s => `  ${s.name} = ${fmt(s.value, 4)} [${s.min} … ${s.max}]${s.play ? ' (auto-play)' : ''}`));
  const bad = Doc.data.constraints.filter(c => c._err || Solver.residualOf(c) > 1e-5);
  if (bad.length) L.push('Unsatisfied:', ...bad.map(c => `  ✗ ${CDEF[c.type].label}: ${E.describeConstraint(c)}${c._err ? ' — ' + c._err : ' (residual ' + Solver.residualOf(c).toExponential(2) + ')'}`));
  if (E.__warnings.length) L.push('Notes:', ...E.__warnings.map(w => '  ' + w));
  return L.join('\n');
}

function exportFiles(E, svgPath, pngPath) {
  const svg = E.exportSVG();
  const tmpSvg = svgPath || (pngPath ? pngPath.replace(/\.png$/i, '') + '.svg' : null);
  if (tmpSvg) { fs.writeFileSync(tmpSvg, svg); if (svgPath) console.log(`SVG: ${svgPath}`); }
  if (pngPath) {
    let r = spawnSync('rsvg-convert', ['-o', pngPath, tmpSvg]);
    if (r.error || r.status !== 0) r = spawnSync('convert', ['-density', '144', tmpSvg, pngPath]);
    if (r.error || r.status !== 0) console.log('PNG: could not convert (needs rsvg-convert or ImageMagick)');
    else console.log(`PNG: ${pngPath}`);
    if (!svgPath) fs.rmSync(tmpSvg, { force: true });
  }
}

function main() {
  if (!cmd || cmd === 'help' || flag('help')) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 9).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const E = engine();
  if (cmd === 'build') {
    const scene = positional[0];
    if (!scene) throw new Error('build needs a scene script path');
    const out = path.resolve(opt('out') || DEFAULT_FILE);
    if (flag('append') && fs.existsSync(out)) load(E, out);
    else {
      // replacing a drawing: keep a copy so the user's work is never lost
      if (fs.existsSync(out)) {
        const dir = path.join(path.dirname(out), '.history');
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(out, path.join(dir, path.basename(out, '.json') + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'));
        const old = fs.readdirSync(dir).sort();
        for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.rmSync(path.join(dir, f));
      }
      E.loadDoc(E.emptyDoc());
    }
    const src = fs.readFileSync(scene, 'utf8');
    try {
      vm.runInContext(`(function () {\n${src}\n})();`, E.ctx, { filename: path.resolve(scene), lineOffset: -1 });
    } catch (e) {
      const where = (e.stack || '').split('\n').find(l => l.includes(path.resolve(scene)));
      console.error(`Scene error: ${e.message}${where ? '\n  ' + where.trim() : ''}`);
      return 1;
    }
    E.Solver.solve({ maxIter: 300 });
    write(E, out, !flag('no-fit'));
    console.log(summary(E));
    console.log(`\nWrote ${out}`);
    exportFiles(E, opt('svg'), opt('png'));
    return E.Solver.last.ok ? 0 : 2;
  }
  if (cmd === 'info') {
    load(E, path.resolve(positional[0] || DEFAULT_FILE));
    E.Solver.solve({ maxIter: 0 });
    console.log(summary(E));
    return 0;
  }
  if (cmd === 'svg' || cmd === 'png') {
    load(E, path.resolve(positional[0] || DEFAULT_FILE));
    E.Solver.solve({ maxIter: 0 });
    const outp = opt('out');
    exportFiles(E, cmd === 'svg' ? (outp || 'drawmath.svg') : opt('svg'), cmd === 'png' ? (outp || 'drawmath.png') : opt('png'));
    return 0;
  }
  throw new Error(`Unknown command "${cmd}" (use build, info, svg, png)`);
}

try { process.exitCode = main(); } catch (e) { console.error('Error: ' + e.message); process.exitCode = 1; }
