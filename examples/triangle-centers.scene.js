// Triangle with a slider-driven side, its circumcircle (O) and incircle (I).
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
