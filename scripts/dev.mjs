/* Local dev server that behaves like Vercel for this project, without a Vercel login:
   static files with cleanUrls, the vercel.json rewrites, Web-handler functions (.mjs) and the
   CommonJS api/enquiry.js. Prefer `vercel dev` once the project is linked; this is the fallback.
   Usage: node --env-file-if-exists=.env.local scripts/dev.mjs [port]   (default 3000) */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 3000;
const vercel = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const require = createRequire(import.meta.url);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
const BLOCKED = /^\/(node_modules|db|data|scripts|tests|reports|research_notes|tools|\.env|\.git|package(-lock)?\.json)/;

function toRegex(source) {
  const names = [];
  const re = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)(\*?)/g, (_, n, star) => { names.push(n); return star ? '(.*)' : '([^/]+)'; });
  return { re: new RegExp('^' + re + '$'), names };
}
const rewrites = (vercel.rewrites || []).map((r) => ({ ...toRegex(r.source), destination: r.destination }));

function rewrite(pathname, search) {
  for (const r of rewrites) {
    const m = pathname.match(r.re);
    if (!m) continue;
    let dest = r.destination;
    r.names.forEach((n, i) => { dest = dest.replace(new RegExp(':' + n + '\\*?'), m[i + 1] ?? ''); });
    const u = new URL(dest, 'http://x');
    for (const [k, v] of new URLSearchParams(search)) u.searchParams.append(k, v);
    return { pathname: u.pathname, search: u.search };
  }
  return { pathname, search };
}

function headersFor(pathname) {
  const out = {};
  // vercel.json header sources here are plain regex-style patterns like /dashboard(.*) or /(js|css)/(.*)
  for (const h of vercel.headers || []) if (new RegExp('^' + h.source + '$').test(pathname)) for (const { key, value } of h.headers) out[key] = value;
  return out;
}

async function callWebHandler(file, req, url, body) {
  const mod = await import(pathToFileURL(file).href + '?t=' + (process.env.DEV_RELOAD ? Date.now() : 0));
  const fn = mod[req.method] || mod.default?.fetch;
  if (!fn) return new Response('Method not allowed', { status: 405 });
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  headers.set('x-forwarded-for', req.socket.remoteAddress || '127.0.0.1');
  const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  return fn(request);
}

async function sendResponse(res, response, extra) {
  const headers = { ...extra };
  response.headers.forEach((v, k) => { headers[k] = v; });
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  if (!response.body) return res.end();
  const reader = response.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); }
  res.end();
}

function callCjs(file, req, res, body) {
  delete require.cache[file];
  const handler = require(file);
  let parsed = body.toString('utf8');
  try { parsed = JSON.parse(parsed); } catch {}
  req.body = parsed;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(d)); return res; };
  return handler(req, res);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${port}`);
    if (BLOCKED.test(u.pathname)) { res.writeHead(404); return res.end('Not found'); }
    // like Vercel: a real file wins over a rewrite (so /dashboard/src/*.js is served, other /dashboard/* paths get the app)
    const direct = staticFile(u.pathname);
    const { pathname, search } = (await exists(direct)) || (await isDir(direct)) ? { pathname: u.pathname, search: u.search } : rewrite(u.pathname, u.search);
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const extra = headersFor(u.pathname);

    if (pathname.startsWith('/api/')) {
      const name = pathname.slice(5).replace(/\/$/, '');
      if (name.startsWith('_')) { res.writeHead(404); return res.end(); }
      const mjs = path.join(root, 'api', name + '.mjs'), cjs = path.join(root, 'api', name + '.js');
      if (await exists(mjs)) return sendResponse(res, await callWebHandler(mjs, req, `http://localhost:${port}${pathname}${search}`, body), extra);
      if (await exists(cjs)) return callCjs(cjs, req, res, body);
      res.writeHead(404); return res.end('No function');
    }

    let file = staticFile(pathname);
    if (await isDir(file)) file = path.join(file, 'index.html');
    if (!file.startsWith(root) || !(await exists(file))) { res.writeHead(404); return res.end('Not found'); }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...extra, 'Cache-Control': 'no-store' });   // dev: never cache
    res.end(data);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
  }
});

async function exists(f) { try { return (await stat(f)).isFile(); } catch { return false; } }
async function isDir(f) { try { return (await stat(f)).isDirectory(); } catch { return false; } }
/* cleanUrls: /visit -> visit.html */
function staticFile(pathname) {
  let file = path.join(root, decodeURIComponent(pathname));
  if (!path.extname(file) && existsSync(file + '.html')) file += '.html';
  return file;
}

server.listen(port, () => console.log(`Aurelle dev server on http://localhost:${port}`));
