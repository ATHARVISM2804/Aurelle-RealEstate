/* Cloudflare Turnstile verification. Only on a local machine do checks pass without TURNSTILE_SECRET. */
import { HttpError, onVercel } from './http.mjs';

export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    if (onVercel()) throw new HttpError(503, 'not_configured', 'Human check is not configured.');
    return true;
  }
  if (!token) throw new HttpError(403, 'turnstile', 'Please complete the human check.');
  const body = new URLSearchParams({ secret, response: String(token) });
  if (ip) body.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new HttpError(403, 'turnstile', 'Human check failed. Please try again.');
  return true;
}
