#!/usr/bin/env node
// DrawMath live server — serves the app and keeps one scene file in sync with the browser.
//
//   node server.mjs [--port 8765] [--scene scenes/current.json]
//
// GET  /api/health   → { app: 'drawmath', scene }
// GET  /api/scene    → the scene JSON (404 if none yet)
// PUT  /api/scene    → browser saves its drawing (header x-client identifies the tab)
// GET  /api/events   → server-sent events: {version, writer} whenever the scene changes
//
// Anything that rewrites the scene file (e.g. the drawmath CLI) is pushed to open tabs live.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = +arg('port', process.env.PORT || 8765);
const SCENE = path.resolve(ROOT, arg('scene', process.env.DRAWMATH_SCENE || 'scenes/current.json'));
fs.mkdirSync(path.dirname(SCENE), { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const readScene = () => { try { return fs.readFileSync(SCENE, 'utf8'); } catch { return null; } };

let lastContent = readScene();
let version = 0;
const clients = new Set();
function broadcast(writer) {
  version++;
  const msg = `data: ${JSON.stringify({ version, writer })}\n\n`;
  for (const res of clients) res.write(msg);
}
// poll-based watch survives editors/CLIs that write via rename
fs.watchFile(SCENE, { interval: 250 }, () => {
  const c = readScene();
  if (c !== null && c !== lastContent) { lastContent = c; broadcast('external'); }
});

// app code changed (js/, index.html, css) → open tabs reload themselves
const appFiles = ['js', 'css'].flatMap(d => fs.readdirSync(path.join(ROOT, d)).map(n => path.join(ROOT, d, n))).concat(path.join(ROOT, 'index.html'));
for (const f of appFiles) {
  fs.watchFile(f, { interval: 500 }, (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) broadcast('reload'); });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const noCache = { 'Cache-Control': 'no-store' };

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...noCache });
    return res.end(JSON.stringify({ app: 'drawmath', scene: SCENE, clients: clients.size }));
  }
  if (url.pathname === '/api/scene' && req.method === 'GET') {
    const c = readScene();
    if (c === null) { res.writeHead(404, noCache); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json', ...noCache });
    return res.end(c);
  }
  if (url.pathname === '/api/scene' && req.method === 'PUT') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 20e6) req.destroy(); });
    req.on('end', () => {
      try { JSON.parse(body); } catch { res.writeHead(400); return res.end('invalid JSON'); }
      const tmp = SCENE + '.tmp';
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, SCENE);
      lastContent = body;
      broadcast(String(req.headers['x-client'] || 'browser'));
      res.writeHead(204, noCache);
      res.end();
    });
    return;
  }
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ version, writer: 'hello' })}\n\n`);
    clients.add(res);
    const ka = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); });
    return;
  }

  // static files
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...noCache });
    res.end(data);
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use — is the DrawMath server already running? (curl localhost:${PORT}/api/health)`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`DrawMath running at http://localhost:${PORT}`);
  console.log(`Live scene file: ${SCENE}`);
});
