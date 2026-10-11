// A line at 30° to the horizontal, and a point at distance 3 / angle 120° from O.
const P = point(1, 1, { name: 'P', fixed: true });
const L = line(P, point(3, 2));
angleToX(L, 30);
const O = point(-3, 0, { name: 'O', fixed: true });
const Q = point(-4.5, 2.6, { name: 'Q' });
segment(O, Q);
distance(O, Q, 3);
angleToX([O, Q], 120);
