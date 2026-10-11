---
name: drawmath
description: Draw, edit or animate geometry diagrams in the DrawMath app (constraint-based, live in the browser) — triangles and their centers, circles and tangents, constructions, loci, linkages and mechanisms, proof figures, angle/length-driven figures with sliders, or a clean SVG/PNG of a geometric figure. Use whenever the user asks Claude to make, change or explain a geometric diagram/construction, or refers to "DrawMath", "the geometry app" or "my drawing".
---

# DrawMath diagrams

DrawMath is a constraint-based geometry app that ships inside this skill folder. You build
drawings with a short **scene script** (JavaScript calling the API below). The CLI solves every
constraint with the app's own solver and writes `scenes/current.json`, and the live server pushes
that file to the open browser tab instantly. The user can then drag things, move sliders and edit.
Their edits are saved back to the same file, so you can read and extend them.

`GL` is this skill's base directory: the folder containing this `SKILL.md`, shown when the
skill loads. It is normally `~/.claude/skills/drawmath`. Set it once per shell command:

```bash
GL=~/.claude/skills/drawmath   # replace with the actual base directory if different
```

Requirements: Node.js 18+. Optional: `rsvg-convert` or ImageMagick (`convert`) for PNG previews.

## 1. Make sure the live app is running

```bash
curl -s localhost:8765/api/health || (nohup node $GL/server.mjs > /tmp/drawmath-server.log 2>&1 &) ; sleep 0.5; curl -s localhost:8765/api/health
```

Then make sure the user can **see** it. The health response includes `"clients"`, the number of
open app tabs. If it is `0`, open the app once:

- In the Claude desktop app, if a built-in browser pane is available (`mcp__Claude_Browser__*` tools), open
  `http://localhost:8765` there, e.g. with `preview_start` and `url`. The user sees it next to the chat.
- Otherwise open their default browser: `xdg-open http://localhost:8765 >/dev/null 2>&1 &`
  (on macOS use `open`).

If `clients` is already ≥ 1, don't open another tab, because the open one updates live. Always
mention the link **http://localhost:8765** in your reply. The status bar shows `● live` when
synced. Do not start the server with a tool's background-process option. It must outlive the
session (`nohup … &`).

The health response also has `"scene"`, the file the running server syncs. If it is not
`$GL/scenes/current.json` (a server started from another copy), pass `--out <that path>` to
`build` and give the path to `info`.

## 2. Check what is already there

`scenes/current.json` is the user's current drawing. Before replacing it, look:

```bash
node $GL/cli/drawmath.mjs info
```

- To **add to / modify** their drawing → write a script that uses `get('A')`, `get('AB')`,
  `get('⊙O')` and build with `--append`.
- To make a **new** diagram → build without `--append` (the old drawing is backed up to
  `scenes/.history/` automatically; mention this if it had content).

## 3. Write the scene script

Save it as `$GL/scenes/<short-name>.scene.js` so it can be re-run and tweaked. Rules:

- Give **approximate but sensible coordinates** — the solver starts from them and moves
  things the minimum needed. Wildly wrong starting positions can land in a mirrored or flipped
  configuration (e.g. which of two intersections you get). Place points roughly where they
  belong; units are arbitrary (≈ 2–10 across works well, y points up).
- Name the points the user will talk about (`{ name: 'A' }`); unnamed points get the next free
  letter.
- Prefer **constructions and constraints** over hard-coded coordinates so the figure stays
  correct when the user drags it. Fix one or two anchor points (`{ fixed: true }`) so it doesn't
  float, and use `horizontal(...)` for a base.
- Any value can be a number or an expression of slider names (`'a'`, `'2*a'`, `'sqrt(a^2+b^2)'`,
  `'t/2'`). Undefined names become sliders automatically; call `slider()` first to choose the
  range/animation. Angles are in degrees; trig functions use degrees.
- Construction lines usually look best `{ dashed: true, color: '#94a3b8' }`; hide pure
  scaffolding with `hide(...)` (hidden things still constrain).

## 4. Build, then verify

```bash
node $GL/cli/drawmath.mjs build $GL/scenes/<name>.scene.js [--append] --png /tmp/drawmath-preview.png
```

Then **Read `/tmp/drawmath-preview.png`** to look at the result. The printed report lists every
point, length, constraint and slider, plus:

- `✓ all constraints satisfied` — good. `✗ … Unsatisfied:` means the request is impossible as
  stated or the starting positions were too far off → fix and rebuild.
- `Degrees of freedom` — how many ways the figure can still move. 0 = rigid. Not an error;
  mention it if the user wanted a fully determined figure.
- `Notes` — sliders created, intersections not found (usually bad starting positions).

Exit code 0 = solved, 2 = built but unsatisfied, 1 = script error (message shows the line).

Finish by telling the user what you drew and which sliders/points to play with. For a file
they can paste into documents: `node $GL/cli/drawmath.mjs svg --out <path>.svg` (or `png`).

## Scene API

Objects returned by the API can be passed anywhere an object is expected; a string is looked up
by name (`'A'`, `'AB'`/`'BA'`, `'⊙O'`, `'ABC'`). A **direction/segment ref** is a line object or a
point pair `[P, Q]`. `opts` (optional, last argument) accepts `name, color, dashed, fixed, trace,
hidden, label:false, alpha` (polygon fill opacity).

**Points & curves**

| call | result |
|---|---|
| `point(x, y, opts)` | free point |
| `pointOn(curve, x, y, opts)` | point attached to a line/circle (slides along it) |
| `segment(A, B)` · `line(A, B)` · `ray(A, B)` | line objects (ray starts at A) |
| `circle(C, P)` | circle centered C through P (P drives the radius) |
| `circle(C, r)` / `circleR(C, r)` | circle with radius `r` (number or expression; driving dimension) |
| `circle3(A, B, C)` | circle through 3 points |
| `arc(C, start, end)` | counter-clockwise arc |
| `polygon(A, B, C, …, opts)` | `{ polygon, edges: [AB, BC, …], points }` |
| `rect(A, C)` | axis-aligned rectangle (H/V constraints), same shape as polygon |
| `regularPolygon(A, B, n)` | regular n-gon on edge AB (counter-clockwise) |

**Constructions** (stay correct when dragged)

| call | result |
|---|---|
| `midpoint(seg)` · `midpoint(A, B)` | midpoint |
| `intersect(c1, c2, { names: ['X','Y'] })` | array of intersection points (0–2) |
| `perpLine(ref, P)` · `parallelLine(ref, P)` | line through P ⊥ / ∥ to ref |
| `perpBisector(seg)` · `perpBisector(A, B)` | perpendicular bisector line (creates midpoint) |
| `angleBisector(A, V, B)` | bisector ray of angle AVB |
| `tangents(P, circle)` | tangent lines from P (array; tangent points are named) |
| `reflect(obj, mirrorLine)` | mirrored copy (point/segment/circle/polygon) |
| `xAxis()` · `yAxis()` | hidden fixed axis lines to measure against |

**Constraints**

`coincident(P, Q)` · `on(P, curve)` · `midpointOf(P, seg)` · `fix(P, …)` · `horizontal(ref)` ·
`vertical(ref)` · `parallel(r1, r2)` · `perpendicular(r1, r2)` · `equal(seg|circle, …)`
(lengths/radii, chained) · `tangent(line|circle, circle)` · `symmetric(P, Q, mirror)`

**Dimensions** — give a value to drive the figure; omit it for a reference measurement that is
only displayed.

| call | meaning |
|---|---|
| `length(seg, v)` · `distance(A, B, v)` | length |
| `pointLineDistance(P, ref, v)` | perpendicular distance |
| `angle(r1, r2, v)` | angle measured **counter-clockwise** from direction r1 to r2 (negative = clockwise; `{keepSide:true}` keeps the drawn side) |
| `angleAt(A, V, B, v)` | angle AVB at vertex V (CCW from VA to VB) |
| `angleToX(ref, v)` | direction angle of a line from the +x axis |
| `radius(circle, v)` | radius |

Dimension opts: `off: [dx, dy]` label offset from its anchor, `hidden: true`.

**Variables, visibility, style**

`slider(name, value, min, max, { step, speed, mode: 'bounce'|'loop'|'once', play: true })` —
`play` starts the animation when the drawing loads. `trace(P)` draws P's locus while things move.
`hide(obj, …)` / `show(obj, …)` · `style(obj, opts)` · `get(name)`.

## Examples

Triangle with a slider-driven side, circumcircle and incircle:

```js
slider('a', 6, 2, 10);
const A = point(0, 0, { name: 'A', fixed: true }), B = point(6, 0, { name: 'B' }), C = point(2, 3.5, { name: 'C' });
const t = polygon(A, B, C);
horizontal(t.edges[0]);
length(t.edges[0], 'a');
angleAt(B, A, C, 55);
const guide = { dashed: true, color: '#94a3b8' };
const [O] = intersect(perpBisector(t.edges[0], guide), perpBisector(t.edges[1], guide), { names: ['O'] });
circle(O, A, { color: '#0d9488' });
const [I] = intersect(angleBisector(B, A, C, guide), angleBisector(A, B, C, guide), { names: ['I'] });
const T = pointOn(t.edges[0], 2.5, 0, { name: 'T' });
perpendicular([I, T], t.edges[0]);
circle(I, T, { color: '#e11d48' });
```

Animated crank–rocker linkage with a traced coupler point:

```js
slider('t', 60, 0, 360, { step: 1, speed: 90, mode: 'loop', play: true });
const A = point(0, 0, { name: 'A', fixed: true }), D = point(4, 0, { name: 'D', fixed: true });
const B = point(0.6, 1, { name: 'B' }), C = point(3, 2.8, { name: 'C' }), P = point(2, 4, { name: 'P', trace: true, color: '#e11d48' });
const ground = segment(A, D, { dashed: true }), crank = segment(A, B);
segment(B, C); segment(C, D); polygon(B, C, P, { color: '#e11d48', alpha: 0.1 });
length(crank, 1.2); distance(B, C, 3.5); distance(C, D, 3); distance(B, P, 2.6); distance(C, P, 2.2);
angle(ground, crank, 't');
```

A line through P at 30° to the horizontal, and a point at distance 3 / angle 120° from O (polar):

```js
const P = point(1, 1, { name: 'P', fixed: true });
const L = line(P, point(3, 2));
angleToX(L, 30);
const O = point(-3, 0, { name: 'O', fixed: true });
const Q = point(-4.5, 2.6, { name: 'Q' });
segment(O, Q);
distance(O, Q, 3);
angleToX([O, Q], 120);
```

## Notes

- The app itself (manual use): tools on the left, constraint bar on top, sliders in the right
  panel, `?` for shortcuts. `H` hides, `Shift+H` shows all.
- Engine source: `$GL/js/*.js` (model/solver/tools); scene API: `$GL/cli/api.js`. If the user
  asks for a capability the API lacks, extend `api.js` (and the app if needed) rather than
  faking it with fixed coordinates.
