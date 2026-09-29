#!/usr/bin/env node
// ── Local hostname proxy ────────────────────────────────
// Maps friendly hostnames to local dev server ports:
//   http://hot   → localhost:5173  (Vite HMR)
//   http://cold  → localhost:5174  (Static preview)
//   http://admin → localhost:5175  (Admin dashboard)
//
// Requires hosts file entries:
//   127.0.0.1  hot
//   127.0.0.1  cold
//   127.0.0.1  admin
//
// Must run as admin (port 80 on Windows).
// Usage: node scripts/local-proxy.js

import http from 'node:http';

const ROUTES = {
  hot:   5173,
  cold:  5174,
  admin: 5175,
};

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const target = ROUTES[host];

  if (!target) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Unknown host: ${host}\nKnown routes: ${Object.entries(ROUTES).map(([h, p]) => `${h} → :${p}`).join(', ')}`);
    return;
  }

  // Rewrite Host header so Vite sees localhost, not the alias
  const headers = { ...req.headers, host: `localhost:${target}` };

  const proxyReq = http.request(
    { hostname: 'localhost', port: target, path: req.url, method: req.method, headers },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Proxy error: ${host} → localhost:${target}\n${err.message}`);
  });

  req.pipe(proxyReq);
});

const PORT = parseInt(process.env.PROXY_PORT || '8080', 10);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Local proxy listening on port ${PORT}`);
  console.log(`  http://hot:${PORT}   → localhost:5173  (Vite HMR)`);
  console.log(`  http://cold:${PORT}  → localhost:5174  (Static preview)`);
  console.log(`  http://admin:${PORT} → localhost:5175  (Admin dashboard)`);
});

