/* Small helpers shared by every function (Web Request/Response handlers). */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/* Strip control characters, trim, cap length (moved from api/enquiry.js). */
export const clean = (v, n = 500) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

export async function readJson(request, maxBytes = 16 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large');
  if (!text) return {};
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : {}; } catch { throw new HttpError(400, 'bad_json'); }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function errorResponse(e) {
  if (e instanceof HttpError) return json({ ok: false, error: e.code, message: e.message !== e.code ? e.message : undefined }, e.status);
  console.error(e);
  return json({ ok: false, error: 'server_error' }, 500);
}

/* Route from the rewrite (?r=) or the path after the function prefix. */
export function routeOf(request, prefix) {
  const url = new URL(request.url);
  const r = url.searchParams.get('r');
  if (r) return r.replace(/^\/+|\/+$/g, '');
  return url.pathname.replace(new RegExp('^' + prefix + '/?'), '').replace(/\/+$/, '');
}

/* Tiny router: [['GET', 'leads/:id', fn], ...] */
export function match(routes, method, path) {
  for (const [m, pattern, fn] of routes) {
    if (m !== method) continue;
    const ps = pattern.split('/'), xs = path.split('/');
    if (ps.length !== xs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].startsWith(':')) { try { params[ps[i].slice(1)] = decodeURIComponent(xs[i]); } catch { ok = false; break; } }
      else if (ps[i] !== xs[i]) { ok = false; break; }
    }
    if (ok) return { fn, params };
  }
  return null;
}

export function clientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || '0.0.0.0';
}

/* True on any Vercel deployment (production and previews); development fallbacks only apply locally. */
export const onVercel = () => Boolean(process.env.VERCEL);

/* The signing secret. Deployments fail closed without it (no well-known fallback a forger could use). */
export function tokenSecret() {
  const s = process.env.CHAT_TOKEN_SECRET;
  if (s) return s;
  if (onVercel()) throw new HttpError(503, 'not_configured', 'CHAT_TOKEN_SECRET is not set.');
  return 'dev-secret';
}

/* Stored instead of raw IPs. Salted with the secret so the hash isn't reversible by lookup. */
export function ipHash(request) {
  return createHash('sha256').update(tokenSecret() + '|' + clientIp(request)).digest('base64url').slice(0, 22);
}

export function originOk(request) {
  const origin = request.headers.get('origin');
  const allowed = (process.env.APP_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin) return false;
  if (allowed.includes(origin)) return true;
  // same-origin requests (preview deployments, vercel dev) are fine too
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export const sha256 = (s) => createHash('sha256').update(s).digest();

export function hmac(value) {
  return createHmac('sha256', tokenSecret()).update(value).digest('base64url');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/* Server-Sent Events over a ReadableStream. send(event, data) / comment(text) / close(). */
export function sseStream() {
  const enc = new TextEncoder();
  let controller, closed = false;
  const stream = new ReadableStream({ start(c) { controller = c; }, cancel() { closed = true; } });
  const write = (s) => { if (!closed) { try { controller.enqueue(enc.encode(s)); } catch { closed = true; } } };
  return {
    response: new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    }),
    send(event, data) { write(formatSse(event, data)); },
    comment(text) { write(`: ${text}\n\n`); },
    close() { if (!closed) { closed = true; try { controller.close(); } catch {} } },
    get closed() { return closed; },
  };
}

export function formatSse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
