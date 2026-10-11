// Crank–rocker four-bar linkage. Slider t drives the crank; P traces the coupler curve.
slider('t', 60, 0, 360, { step: 1, speed: 90, mode: 'loop', play: true });
const A = point(0, 0, { name: 'A', fixed: true }), D = point(4, 0, { name: 'D', fixed: true });
const B = point(0.6, 1, { name: 'B' }), C = point(3, 2.8, { name: 'C' }), P = point(2, 4, { name: 'P', trace: true, color: '#e11d48' });
const ground = segment(A, D, { dashed: true }), crank = segment(A, B);
segment(B, C); segment(C, D); polygon(B, C, P, { color: '#e11d48', alpha: 0.1 });
length(crank, 1.2); distance(B, C, 3.5); distance(C, D, 3); distance(B, P, 2.6); distance(C, P, 2.2);
angle(ground, crank, 't');
