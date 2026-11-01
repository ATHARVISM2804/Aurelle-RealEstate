/* Dashboard API client: same-origin, cookie session, JSON in/out. */
export class ApiError extends Error {}

export async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch('/api/a/' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.error === 'signed_out') { window.dispatchEvent(new CustomEvent('signed-out')); }
  if (!res.ok) { const e = new ApiError(data.message || data.error || 'Request failed'); e.status = res.status; e.code = data.error; throw e; }
  return data;
}

export const qs = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : v)}`).join('&');
