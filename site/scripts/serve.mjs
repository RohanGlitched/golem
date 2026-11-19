// Static server for site/dist that behaves like infra/stack.yaml: directory index rewrite, /404.html with status 404,
// and the same Content-Security-Policy, so a policy violation shows up in tests before a deploy.
// Usage: node scripts/serve.mjs [port]   (default 4173)
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
const port = Number(process.argv[2] ?? 4173);
const stack = readFileSync(path.resolve(here, '../../infra/stack.yaml'), 'utf8');
const stackCsp = /ContentSecurityPolicy:\s*"([^"]+)"/.exec(stack)?.[1];
// GOLEM_CSP=none serves without a policy; GOLEM_CSP=eval adds 'unsafe-eval' to script-src (what MuJoCo's embind needs).
const mode = process.env.GOLEM_CSP ?? 'stack';
const csp = mode === 'none' ? undefined : mode === 'eval' ? stackCsp?.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'") : stackCsp;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.stl': 'model/stl', '.bin': 'application/octet-stream', '.md': 'text/markdown; charset=utf-8',
};

function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  else if (path.extname(p) === '') p += '/index.html';
  const file = path.join(dist, p);
  return file.startsWith(dist) && existsSync(file) && statSync(file).isFile() ? file : undefined;
}

export function startServer(port = 4173) {
  const server = createServer((req, res) => {
  const file = resolveFile(req.url ?? '/');
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(csp ? { 'Content-Security-Policy': csp } : {}) };
  if (!file) {
    res.writeHead(404, { ...headers, 'Content-Type': TYPES['.html'] });
    res.end(existsSync(path.join(dist, '404.html')) ? readFileSync(path.join(dist, '404.html')) : 'Not found');
    return;
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  // CloudFront compresses text responses (Compress: true in infra/stack.yaml); do the same so size timings match.
  const gz = /^(text\/|application\/(json|xml)|image\/svg)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  const body = gz ? gzipSync(readFileSync(file)) : readFileSync(file);
  res.writeHead(200, { ...headers, 'Content-Type': type, ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
  res.end(body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer(port);
  console.log(`serving ${dist} on http://127.0.0.1:${port}${csp ? ' with the stack CSP' : ''}`);
}
