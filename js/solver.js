// solver.js — numeric constraint solver.
//
// Damped, weighted minimum-norm Newton iterations:
//     dx = W⁻¹ Jᵀ (J W⁻¹ Jᵀ + λI)⁻¹ (−r)
// The minimum-norm step means anything not forced by a constraint stays where it is,
// which is what makes dragging feel natural. Weights (W) make some variables
// "heavier" (e.g. the point being dragged) so the solver prefers moving others.
'use strict';

const Solver = (() => {
  const TOL = 1e-10;      // stop when max |residual| below this
  const OK_TOL = 1e-6;    // considered satisfied
  const W_RADIUS = 0.1;   // radii are cheap to change (circles resize rather than translate)
  let last = { ok: true, err: 0, iter: 0 };

  function activeConstraints() {
    return Doc.data.constraints.filter(c => {
      const d = CDEF[c.type];
      if (!d) return false;
      if (d.dim && (!c.driving || c._err)) return false;
      return true;
    });
  }

  function collectVars(locked, weights) {
    const vars = [], index = new Map();
    const push = (o, k, w) => { index.set(o.id + '.' + k, vars.length); vars.push({ o, k, w }); };
    for (const o of Doc.data.objects) {
      if (o.type === 'point') {
        if (o.fixed || locked.has(o.id)) continue;
        const w = (weights && weights.get(o.id)) || 1;
        push(o, 'x', w); push(o, 'y', w);
      } else if (o.type === 'circle') {
        if (locked.has(o.id)) continue;
        push(o, 'r', (weights && weights.get(o.id)) || W_RADIUS);
      }
    }
    return { vars, index };
  }

  function evalAll(cons, sizes, out) {
    let n = 0;
    for (let i = 0; i < cons.length; i++) {
      const r = CDEF[cons[i].type].res(cons[i]);
      if (sizes) sizes[i] = r.length;
      for (const v of r) out[n++] = isFinite(v) ? v : 1e6;
    }
    out.length = n;
    return out;
  }
  const maxAbs = r => { let m = 0; for (const v of r) m = Math.max(m, Math.abs(v)); return m; };
  const sumSq = r => { let s = 0; for (const v of r) s += v * v; return s; };

  // Solve A y = b in place (A is m×m Float64Array, row-major). Partial pivoting.
  function gauss(A, b, m) {
    for (let k = 0; k < m; k++) {
      let piv = k, best = Math.abs(A[k * m + k]);
      for (let i = k + 1; i < m; i++) { const v = Math.abs(A[i * m + k]); if (v > best) { best = v; piv = i; } }
      if (best < 1e-300) continue;
      if (piv !== k) {
        for (let j = 0; j < m; j++) { const t = A[k * m + j]; A[k * m + j] = A[piv * m + j]; A[piv * m + j] = t; }
        const t = b[k]; b[k] = b[piv]; b[piv] = t;
      }
      const akk = A[k * m + k];
      for (let i = k + 1; i < m; i++) {
        const f = A[i * m + k] / akk;
        if (f === 0) continue;
        for (let j = k; j < m; j++) A[i * m + j] -= f * A[k * m + j];
        b[i] -= f * b[k];
      }
    }
    const y = new Float64Array(m);
    for (let i = m - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < m; j++) s -= A[i * m + j] * y[j];
      const d = A[i * m + i];
      y[i] = Math.abs(d) < 1e-300 ? 0 : s / d;
    }
    return y;
  }

  // Sparse jacobian: cols[j] = flat [row, value, row, value, ...]
  function jacobian(cons, cv, sizes, rowOf, vars, r) {
    const cols = vars.map(() => []);
    for (let ci = 0; ci < cons.length; ci++) {
      const c = cons[ci], def = CDEF[c.type], row = rowOf[ci], sz = sizes[ci];
      for (const j of cv[ci]) {
        const { o, k } = vars[j];
        const v0 = o[k];
        const h = 1e-7 * Math.max(1, Math.abs(v0));
        o[k] = v0 + h;
        const rr = def.res(c);
        o[k] = v0;
        for (let q = 0; q < sz; q++) {
          const d = (rr[q] - r[row + q]) / h;
          if (d !== 0 && isFinite(d)) cols[j].push(row + q, d);
        }
      }
    }
    return cols;
  }

  function solve(opts = {}) {
    prepareConstraints();
    const locked = opts.locked || new Set();
    const maxIter = opts.maxIter || 60;
    const { vars, index } = collectVars(locked, opts.weights);
    const cons = activeConstraints();
    const cv = cons.map(c => varsOf(c).map(([o, k]) => index.get(o.id + '.' + k)).filter(i => i !== undefined));
    const sizes = new Array(cons.length);
    let r = evalAll(cons, sizes, []);
    const rowOf = [];
    { let off = 0; for (const s of sizes) { rowOf.push(off); off += s; } }
    const m = r.length, n = vars.length;
    let err = maxAbs(r), iter = 0, lambda = 1e-10;

    while (err > TOL && iter < maxIter && n > 0 && m > 0) {
      iter++;
      const cols = jacobian(cons, cv, sizes, rowOf, vars, r);
      // A = J W⁻¹ Jᵀ
      const A = new Float64Array(m * m);
      for (let j = 0; j < n; j++) {
        const L = cols[j], iw = 1 / vars[j].w;
        for (let a = 0; a < L.length; a += 2) {
          const ra = L[a], va = L[a + 1] * iw;
          for (let b = 0; b < L.length; b += 2) A[ra * m + L[b]] += va * L[b + 1];
        }
      }
      for (let i = 0; i < m; i++) A[i * m + i] += lambda * (1 + A[i * m + i]) + 1e-14;
      const rhs = new Float64Array(m);
      for (let i = 0; i < m; i++) rhs[i] = -r[i];
      const y = gauss(A, rhs, m);
      const dx = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        const L = cols[j];
        let s = 0;
        for (let a = 0; a < L.length; a += 2) s += L[a + 1] * y[L[a]];
        dx[j] = s / vars[j].w;
      }
      // line search
      const x0 = vars.map(v => v.o[v.k]);
      const f0 = sumSq(r);
      let alpha = 1, accepted = false, rN = [];
      for (let ls = 0; ls < 14; ls++) {
        for (let j = 0; j < n; j++) vars[j].o[vars[j].k] = x0[j] + alpha * dx[j];
        evalAll(cons, null, rN);
        if (sumSq(rN) < f0) { accepted = true; break; }
        alpha *= 0.5;
      }
      if (!accepted) {
        for (let j = 0; j < n; j++) vars[j].o[vars[j].k] = x0[j];
        lambda = lambda * 100 + 1e-8;
        if (lambda > 1e4) break;
      } else {
        r = rN;
        err = maxAbs(r);
        lambda = Math.max(lambda / 10, 1e-12);
      }
    }
    // keep radii positive
    for (const o of Doc.data.objects) if (o.type === 'circle' && o.r < 0) o.r = -o.r;
    last = { ok: err <= OK_TOL, err, iter };
    return last;
  }

  // degrees of freedom = free variables − rank(J)
  function dof() {
    prepareConstraints();
    const { vars, index } = collectVars(new Set(), null);
    const cons = activeConstraints();
    const n = vars.length;
    const rows = [];
    for (const c of cons) {
      const def = CDEF[c.type];
      const r0 = def.res(c);
      const rws = r0.map(() => new Float64Array(n));
      for (const [o, k] of varsOf(c)) {
        const j = index.get(o.id + '.' + k);
        if (j === undefined) continue;
        const v0 = o[k], h = 1e-7 * Math.max(1, Math.abs(v0));
        o[k] = v0 + h;
        const rr = def.res(c);
        o[k] = v0;
        for (let q = 0; q < r0.length; q++) rws[q][j] = (rr[q] - r0[q]) / h;
      }
      rows.push(...rws);
    }
    // rank by gaussian elimination with column pivoting
    let rank = 0;
    const m = rows.length;
    for (let col = 0; col < n && rank < m; col++) {
      let piv = -1, best = 1e-6;
      for (let i = rank; i < m; i++) { const v = Math.abs(rows[i][col]); if (v > best) { best = v; piv = i; } }
      if (piv < 0) continue;
      [rows[rank], rows[piv]] = [rows[piv], rows[rank]];
      const R = rows[rank];
      for (let i = rank + 1; i < m; i++) {
        const f = rows[i][col] / R[col];
        if (f === 0) continue;
        const Ri = rows[i];
        for (let j = col; j < n; j++) Ri[j] -= f * R[j];
      }
      rank++;
    }
    // helper points that only fix a construction line's direction can slide along it freely;
    // that freedom is cosmetic, so don't count it
    const slack = Doc.data.objects.filter(o => o.type === 'point' && o.aux && !o.fixed && o.owner && O(o.owner) && O(o.owner).type === 'line').length;
    return { dof: Math.max(0, n - rank - slack), n, rank, m };
  }

  // residual of a single constraint (for highlighting broken ones)
  function residualOf(c) {
    const d = CDEF[c.type];
    if (!d || (d.dim && (!c.driving || c._err))) return 0;
    let m = 0;
    for (const v of d.res(c)) m = Math.max(m, Math.abs(v));
    return m;
  }

  return { solve, dof, residualOf, get last() { return last; }, OK_TOL };
})();
