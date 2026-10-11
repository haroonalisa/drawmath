// expr.js — small, safe expression evaluator for dimension values.
// Supports + - * / ^, parentheses, implicit multiplication (2a, 3(a+b)),
// slider variables, constants (pi, e) and functions. Trig uses DEGREES.
'use strict';

const Expr = (() => {
  const D2R = Math.PI / 180;
  const FUNCS = {
    sin: x => Math.sin(x * D2R), cos: x => Math.cos(x * D2R), tan: x => Math.tan(x * D2R),
    asin: x => Math.asin(x) / D2R, acos: x => Math.acos(x) / D2R, atan: x => Math.atan(x) / D2R,
    atan2: (y, x) => Math.atan2(y, x) / D2R,
    sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, min: Math.min, max: Math.max,
    hypot: Math.hypot, sign: Math.sign,
  };
  const CONSTS = { pi: Math.PI, e: Math.E };
  const cache = new Map();
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch) || ch === '°') { i++; continue; }
      if (/[0-9.]/.test(ch)) {
        const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
        if (!m) throw new Error('Bad number');
        toks.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i));
        toks.push({ t: 'id', v: m[0] });
        i += m[0].length;
        continue;
      }
      if ('+-*/^(),'.includes(ch)) { toks.push({ t: ch }); i++; continue; }
      throw new Error(`Unexpected '${ch}'`);
    }
    return toks;
  }

  function parse(src) {
    const toks = tokenize(src);
    const ids = new Set();
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const expect = t => { const k = next(); if (!k || k.t !== t) throw new Error(`Expected '${t}'`); };

    function expr() {
      let a = term();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        const op = next().t, l = a, r = term();
        a = op === '+' ? e => l(e) + r(e) : e => l(e) - r(e);
      }
      return a;
    }
    function term() {
      let a = unary();
      for (;;) {
        const k = peek();
        if (!k) break;
        if (k.t === '*' || k.t === '/') {
          next();
          const l = a, r = unary();
          a = k.t === '*' ? e => l(e) * r(e) : e => l(e) / r(e);
        } else if (k.t === 'id' || k.t === '(' || k.t === 'num') {
          const l = a, r = power(); // implicit multiplication
          a = e => l(e) * r(e);
        } else break;
      }
      return a;
    }
    function unary() {
      const k = peek();
      if (k && k.t === '-') { next(); const a = unary(); return e => -a(e); }
      if (k && k.t === '+') { next(); return unary(); }
      return power();
    }
    function power() {
      const b = primary();
      if (peek() && peek().t === '^') { next(); const ex = unary(); return e => Math.pow(b(e), ex(e)); }
      return b;
    }
    function primary() {
      const k = next();
      if (!k) throw new Error('Unexpected end');
      if (k.t === 'num') { const v = k.v; return () => v; }
      if (k.t === '(') { const a = expr(); expect(')'); return a; }
      if (k.t === 'id') {
        const name = k.v;
        if (peek() && peek().t === '(' && has(FUNCS, name)) {
          next();
          const args = [];
          if (peek() && peek().t !== ')') {
            args.push(expr());
            while (peek() && peek().t === ',') { next(); args.push(expr()); }
          }
          expect(')');
          const f = FUNCS[name];
          return e => f(...args.map(a => a(e)));
        }
        if (has(CONSTS, name)) { const v = CONSTS[name]; return () => v; }
        ids.add(name);
        return e => {
          if (!has(e, name)) throw new Error(`Unknown variable '${name}'`);
          return e[name];
        };
      }
      throw new Error(`Unexpected '${k.t}'`);
    }

    if (!toks.length) throw new Error('Empty expression');
    const fn = expr();
    if (p < toks.length) {
      const t = toks[p];
      throw new Error(`Unexpected '${t.v !== undefined ? t.v : t.t}'`);
    }
    return { fn, ids };
  }

  function compile(src) {
    src = String(src);
    let c = cache.get(src);
    if (!c) {
      c = parse(src);
      if (cache.size > 500) cache.clear();
      cache.set(src, c);
    }
    return c;
  }

  return {
    evaluate(src, env) {
      const v = compile(src).fn(env || {});
      if (!isFinite(v)) throw new Error('Result is not a finite number');
      return v;
    },
    identifiers(src) { return compile(src).ids; },
    isValidName(n) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !has(FUNCS, n) && !has(CONSTS, n); },
    isNumber(src) { return /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(String(src)); },
    // rename a variable inside an expression, token-aware
    rename(src, from, to) {
      return String(src).replace(/[A-Za-z_][A-Za-z_0-9]*/g, m => (m === from ? to : m));
    },
  };
})();
