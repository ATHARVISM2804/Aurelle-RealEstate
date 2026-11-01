/* POST and read a Server-Sent Events response (EventSource can't POST). */
export async function postStream(url, body, onEvent, signal) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.message || data.error || 'HTTP ' + res.status);
    err.code = data.error; err.status = res.status;
    throw err;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message', data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue;
      try { onEvent(event, JSON.parse(data)); } catch (e) { console.error(e); }
    }
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.message || data.error || 'HTTP ' + res.status); Object.assign(e, data, { status: res.status }); throw e; }
  return data;
}
