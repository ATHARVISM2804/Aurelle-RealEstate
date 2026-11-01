/* Chat sessions: capability tokens, history, limits and spend. */
import { randomBytes } from 'node:crypto';
import { db } from '../db.mjs';
import { hmac, sha256, safeEqual, HttpError } from '../http.mjs';
import { hit } from '../ratelimit.mjs';

export const LIMITS = {
  userMessagesPerSession: 40,
  tokensPerSession: 120_000,
  messagesPerMinute: 6,
  messagesPerIpPerDay: 300,
  sessionsPerIpPerHour: 10,
  historyMessages: 16,
  maxChars: 1000,
};

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function refCode(prefix = 'AUR') {
  const b = randomBytes(5);
  return prefix + '-' + Array.from(b, (x) => REF_ALPHABET[x % REF_ALPHABET.length]).join('').slice(0, 5);
}

export const tokenFor = (sid) => sid + '.' + hmac('chat:' + sid);

export async function createSession({ project, visitor, ipHash, lang }) {
  const sql = db();
  await hit('chatsess:' + ipHash, LIMITS.sessionsPerIpPerHour, 3600);
  const id = crypto.randomUUID();
  const token = tokenFor(id);
  const prefix = project.slug.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'REF';
  for (let i = 0; i < 3; i++) {
    try {
      const [s] = await sql`insert into chat_sessions(id, project_id, visitor_id, lead_id, token_hash, ref_code, lang, facts_version, turnstile_at, ip_hash)
        values (${id}, ${project.id}, ${visitor.id}, ${visitor.lead_id || null}, ${sha256(token)}, ${refCode(prefix)}, ${lang}, ${project.facts_version}, now(), ${ipHash})
        returning *`;
      return { session: s, token };
    } catch (e) { if (!String(e.message).includes('ref_code')) throw e; }
  }
  throw new Error('could not allocate ref code');
}

export async function loadSession(sid, token, projectId) {
  if (!sid || !token || !/^[0-9a-f-]{36}$/i.test(sid) || !safeEqual(token, tokenFor(sid))) throw new HttpError(401, 'bad_session');
  const sql = db();
  const [s] = await sql`select * from chat_sessions where id = ${sid}`;
  if (!s || (projectId && s.project_id !== projectId)) throw new HttpError(401, 'bad_session');
  return s;
}

export async function checkLimits(session, ipHash) {
  if (session.user_msgs >= LIMITS.userMessagesPerSession || session.tokens_in + session.tokens_out >= LIMITS.tokensPerSession) {
    throw new HttpError(429, 'cap_reached', 'This conversation has reached its limit. A consultant can take it from here.');
  }
  await hit('chatmin:' + session.id, LIMITS.messagesPerMinute, 60);
  await hit('chatday:' + ipHash, LIMITS.messagesPerIpPerDay, 86400);
}

/* Global daily spend cap, tracked in micro-dollars in rate_limits. */
const today = () => new Date().toISOString().slice(0, 10);
export async function budgetLeft() {
  const cap = Number(process.env.CHAT_DAILY_BUDGET_USD || 5) * 1e6;
  const sql = db();
  const [row] = await sql`select count from rate_limits where key = ${'budget:' + today()} and window_start = ${today() + 'T00:00:00Z'}`;
  return cap - Number(row?.count || 0);
}
export async function spend(micros) {
  if (!micros) return;
  const sql = db();
  await sql`insert into rate_limits(key, window_start, count) values (${'budget:' + today()}, ${today() + 'T00:00:00Z'}, ${micros})
    on conflict (key, window_start) do update set count = rate_limits.count + ${micros}`;
}
export function costMicros(usage) {
  const pin = Number(process.env.CHAT_PRICE_IN_PER_M || 0.15), pout = Number(process.env.CHAT_PRICE_OUT_PER_M || 0.6);
  return Math.round((usage.inputTokens || 0) * pin + (usage.outputTokens || 0) * pout);
}

/* Messages for the model: user text (redacted), assistant text, and notes. */
export async function history(sessionId, limit = LIMITS.historyMessages) {
  const sql = db();
  const rows = await sql`select role, content, content_redacted, cards, tool_calls from messages
    where session_id = ${sessionId} and role in ('user','assistant','note','agent') order by id desc limit ${limit}`;
  return rows.reverse().map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.content_redacted ?? m.content };
    if (m.role === 'note') return { role: 'user', content: `[Note for the assistant, not from the visitor] ${m.content}` };
    if (m.role === 'agent') return { role: 'assistant', content: `[Sales consultant] ${m.content}` };
    const shown = (m.cards || []).map(cardSummary).filter(Boolean);
    return { role: 'assistant', content: (m.content || '') + (shown.length ? `\n[Shown to the visitor: ${shown.join('; ')}]` : '') };
  });
}

function cardSummary(c) {
  if (!c) return '';
  if (c.kind === 'unit') return `unit card ${c.data?.code}`;
  if (c.kind === 'units') return `unit list ${(c.data?.units || []).map((u) => u.code).join(', ')}`;
  if (c.kind === 'booking') return 'visit booking picker';
  if (c.kind === 'form') return `contact form (${c.data?.purpose})`;
  return c.kind + ' card';
}

/* Tool outputs from earlier turns: their numbers stay allowed for the whole session. */
export async function priorToolOutputs(sessionId) {
  const sql = db();
  const rows = await sql`select tool_calls from messages where session_id = ${sessionId} and role = 'assistant' and tool_calls is not null order by id desc limit 20`;
  return rows.flatMap((r) => (r.tool_calls || []).map((t) => t.output));
}
