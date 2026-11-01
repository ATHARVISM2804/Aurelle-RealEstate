/* Live evaluation of the assistant against scripted conversations (tests/fixtures/chat-evals.json).
   Runs each case as a fresh chat through the real /api/chat endpoint and checks: expected cards
   (tools), reply language, no leaked money / percentages / years, refusals, and speed.
   Usage: npm run eval [-- http://localhost:3000] [-- case-id ...]
   Costs a few cents with a paid model. Locally it clears the chat rate-limit counters first. */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { detectLang } from '../api/_lib/chat/lang.mjs';
import { extractNumbers } from '../api/_lib/chat/guardrail.mjs';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) || 'http://localhost:3000';
const only = args.filter((a) => !a.startsWith('http'));
const cases = JSON.parse(await readFile(new URL('../tests/fixtures/chat-evals.json', import.meta.url), 'utf8')).filter((c) => !only.length || only.includes(c.id));

if (process.env.DATABASE_DRIVER === 'pg' && process.env.DATABASE_URL) {
  const { db } = await import('../api/_lib/db.mjs');
  await db()`delete from rate_limits where key like 'chat%'`;
  await db().end?.();
}

async function run(c) {
  const started = Date.now();
  let ttft = null, text = '', cards = [], notices = [], error = null, ref = null;
  const res = await fetch(base + '/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: 'aurelle', text: c.text, client_id: randomUUID(), anon_id: 'eval-' + randomUUID(), turnstile: 'XXXX.DUMMY.TOKEN.XXXX', context: c.context || {} }),
  });
  if (!(res.headers.get('content-type') || '').includes('event-stream')) return { error: (await res.text()).slice(0, 200), ms: Date.now() - started, cards: [], notices: [], text: '' };
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = raw.match(/^event: (.+)$/m)?.[1], data = raw.match(/^data: (.+)$/m)?.[1];
      if (!ev || !data) continue;
      const d = JSON.parse(data);
      if ((ev === 'text' || ev === 'card') && ttft == null) ttft = Date.now() - started;
      if (ev === 'text') text += d.d;
      if (ev === 'card') cards.push(d.kind);
      if (ev === 'notice') notices.push(d.kind);
      if (ev === 'error') error = d.code;
      if (ev === 'meta') ref = d.ref;
    }
  }
  return { ttft, ms: Date.now() - started, text: text.trim(), cards, notices, error, ref };
}

function check(c, r) {
  const fails = [];
  if (r.error && r.error !== 'duplicate') fails.push('error:' + r.error);
  for (const k of c.expectCards || []) if (!r.cards.includes(k)) fails.push('missing card ' + k);
  if (c.expectAnyCards && !c.expectAnyCards.some((k) => r.cards.includes(k))) fails.push('missing any card of ' + c.expectAnyCards.join('/'));
  const lang = detectLang(r.text, 'en');
  if (r.text && c.lang && lang !== c.lang && !(c.lang === 'hi-Latn' && lang === 'en')) fails.push(`lang ${lang}≠${c.lang}`);
  const nums = extractNumbers(r.text, { unitCodeRe: /\b\d{2}-(?:[A-E]|P[1-3])\b/ }).numbers;
  if (c.noMoney && nums.some((n) => n.cls === 'money')) fails.push('money in reply');
  if (c.noPercent && nums.some((n) => n.cls === 'percent')) fails.push('percent in reply');
  if (c.noYear && nums.some((n) => n.cls === 'year' && n.value !== new Date().getFullYear())) fails.push('year in reply');
  for (const s of c.mustNot || []) if (r.text.toLowerCase().includes(s.toLowerCase())) fails.push('contains "' + s + '"');
  if (c.mustAny && !c.mustAny.some((s) => r.text.toLowerCase().includes(s.toLowerCase()))) fails.push('none of ' + c.mustAny.join('/'));
  if (r.text.length > 700) fails.push('long reply ' + r.text.length);
  if (!r.text && !r.cards.length) fails.push('empty');
  return fails;
}

const rows = [];
const gap = Number(process.env.EVAL_GAP_MS || 0);   // free Groq tier: ~8k tokens/minute, so space requests out
for (const c of cases) {
  if (rows.length && gap) await new Promise((r) => setTimeout(r, gap));
  const r = await run(c);
  const fails = check(c, r);
  rows.push({ c, r, fails });
  console.log(`${fails.length ? '✖' : '✔'} ${c.id.padEnd(18)} ttft ${String(r.ttft ?? '-').padStart(5)}ms  total ${String(r.ms).padStart(5)}ms  cards [${(r.cards || []).join(',')}]${r.notices?.length ? '  guard:' + r.notices.length : ''}${fails.length ? '  → ' + fails.join('; ') : ''}`);
  console.log(`   ${(r.text || r.error || '').replace(/\s+/g, ' ').slice(0, 220)}`);
}
const passed = rows.filter((x) => !x.fails.length).length;
const ttfts = rows.map((x) => x.r.ttft).filter(Boolean).sort((a, b) => a - b);
console.log(`\n${passed}/${rows.length} passed · median time to first output ${ttfts[Math.floor(ttfts.length / 2)] ?? '-'}ms`);
process.exitCode = passed === rows.length ? 0 : 1;
