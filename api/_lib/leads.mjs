/* Leads, visitors, consents and behaviour events. One lead per phone number per project. */
import { db } from './db.mjs';
import { clean } from './http.mjs';

export const EVENT_TYPES = new Set([
  'section_reached', 'unit_opened', 'level_switched', 'toggle_3d', 'room_opened', 'explorer_opened', 'explorer_closed',
  'brochure_downloaded', 'enquiry_submitted', 'cta_whatsapp', 'chat_opened', 'chat_closed', 'unit_card_3d',
  'price_shown', 'booking_created', 'human_requested', 'session_start',
]);

/* Merge field values, keeping a field a sales rep set unless the rep is the writer. */
export function mergeFields(existing = {}, patch = {}, source = 'ai', at = new Date().toISOString()) {
  const out = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === '' || (Array.isArray(v?.value) && !v.value.length)) continue;
    if (out[k]?.source === 'rep' && source !== 'rep') continue;
    const entry = v && typeof v === 'object' && 'value' in v ? v : { value: v };
    if (entry.value == null || entry.value === '') continue;
    out[k] = { ...entry, source, at };
  }
  return out;
}

export function sanitizeTouch(t = {}) {
  const keep = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'fbc', 'fbp', 'gclid', 'referrer', 'landing', 'at'];
  return Object.fromEntries(keep.filter((k) => t[k]).map((k) => [k, clean(t[k], 400)]));
}

export async function ensureVisitor(projectId, anonId, { firstTouch, lastTouch, sessions7d } = {}) {
  const sql = db();
  const id = clean(anonId, 64) || 'anon-' + crypto.randomUUID();
  const [v] = await sql`insert into visitors(project_id, anon_id, first_touch, last_touch, sessions_7d)
    values (${projectId}, ${id}, ${JSON.stringify(sanitizeTouch(firstTouch))}, ${JSON.stringify(sanitizeTouch(lastTouch || firstTouch))}, ${Math.max(1, Math.min(Number(sessions7d) || 1, 99))})
    on conflict (project_id, anon_id) do update set last_seen = now(),
      last_touch = case when excluded.last_touch <> '{}'::jsonb then excluded.last_touch else visitors.last_touch end,
      sessions_7d = greatest(visitors.sessions_7d, excluded.sessions_7d)
    returning *`;
  return v;
}

export async function storeEvents(projectId, visitorId, sessionId, events = []) {
  const rows = (Array.isArray(events) ? events : []).slice(0, 50)
    .filter((e) => e && EVENT_TYPES.has(e.type))
    .map((e) => ({
      type: e.type,
      props: JSON.stringify(Object.fromEntries(Object.entries(e.props || {}).slice(0, 12).map(([k, v]) => [clean(k, 40), typeof v === 'number' || typeof v === 'boolean' ? v : clean(v, 200)]))),
      url: clean(e.url, 300),
      at: isFinite(new Date(e.at)) ? new Date(Math.min(new Date(e.at).getTime(), Date.now())).toISOString() : new Date().toISOString(),
    }));
  if (!rows.length) return 0;
  const sql = db();
  await sql.query(
    `insert into events(project_id, visitor_id, session_id, type, props, url, at)
     select $1, $2, $3, x.type, x.props::jsonb, x.url, x.at::timestamptz
     from jsonb_to_recordset($4::jsonb) as x(type text, props text, url text, at text)`,
    [projectId, visitorId, sessionId || null, JSON.stringify(rows)],
  );
  return rows.length;
}

function attributionColumns(a = {}) {
  return { source: a.utm_source || (a.fbclid ? 'facebook' : a.gclid ? 'google' : a.referrer ? hostOf(a.referrer) : 'direct'), medium: a.utm_medium || null, campaign: a.utm_campaign || null };
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'referral'; } };

/* Insert or match by phone in one statement (no select-then-insert race). Returns { lead, created }.
   Public input never overwrites an existing lead's name or email: the phone number is not proof of
   identity, so a different name/email is kept as an alternate contact for the sales team to check. */
export async function upsertLead(project, { name, phone, email, lang, attribution, fields, fieldSource = 'form' }) {
  const sql = db();
  const a = attribution || {};
  const cols = attributionColumns(a.first || a);
  const nm = clean(name, 120) || null, em = clean(email, 160) || null;
  const [row] = await sql`insert into leads(project_id, name, phone_e164, email, lang, source, medium, campaign, attribution, fields)
    values (${project.id}, ${nm}, ${phone}, ${em}, ${lang || null},
      ${cols.source}, ${cols.medium}, ${cols.campaign}, ${JSON.stringify(a)}, ${JSON.stringify(mergeFields({}, fields, fieldSource))})
    on conflict (project_id, phone_e164) where phone_e164 is not null and deleted_at is null
    do update set name = coalesce(leads.name, excluded.name), email = coalesce(leads.email, excluded.email),
      lang = coalesce(leads.lang, excluded.lang), last_activity_at = now(),
      attribution = case when leads.attribution = '{}'::jsonb then excluded.attribution else leads.attribution end
    returning *, (xmax = 0) as created`;
  const created = row.created;
  delete row.created;
  if (created) return { lead: row, created };
  const patch = { ...fields };
  const differs = (nm && row.name && nm.toLowerCase() !== row.name.toLowerCase()) || (em && row.email && em.toLowerCase() !== String(row.email).toLowerCase());
  if (differs) patch.alt_contact = { value: [nm, em].filter(Boolean).join(' · ') };
  const merged = mergeFields(row.fields, patch, fieldSource);
  const [lead] = await sql`update leads set fields = ${JSON.stringify(merged)} where id = ${row.id} returning *`;
  return { lead, created };
}

export async function linkVisitor(leadId, visitorId) {
  if (!visitorId) return;
  const sql = db();
  await sql.transaction([
    sql`update visitors set lead_id = ${leadId} where id = ${visitorId}`,
    sql`update chat_sessions set lead_id = ${leadId} where visitor_id = ${visitorId} and lead_id is null`,
  ]);
}

export const CONSENT_PURPOSES = ['call', 'whatsapp', 'email', 'marketing'];

export async function recordConsents(projectId, { leadId, visitorId, consents, textVersion, texts, source, ipHash }) {
  const sql = db();
  const rows = CONSENT_PURPOSES.filter((p) => typeof consents?.[p] === 'boolean').map((p) => ({
    purpose: p, granted: consents[p], text_snapshot: clean(texts?.[p] || texts?.all || '', 600) || '(not recorded)',
  }));
  if (!rows.length) return;
  await sql.query(
    `insert into consents(project_id, lead_id, visitor_id, purpose, granted, text_version, text_snapshot, source, ip_hash)
     select $1, $2, $3, x.purpose, x.granted, $4, x.text_snapshot, $5, $6
     from jsonb_to_recordset($7::jsonb) as x(purpose text, granted boolean, text_snapshot text)`,
    [projectId, leadId || null, visitorId || null, clean(textVersion, 40) || 'v1', source, ipHash || null, JSON.stringify(rows)],
  );
}

export async function currentConsents(leadId) {
  const sql = db();
  const rows = await sql`select distinct on (purpose) purpose, granted from consents where lead_id = ${leadId} order by purpose, created_at desc`;
  return Object.fromEntries(rows.map((r) => [r.purpose, r.granted]));
}

export async function audit({ projectId, actorId, action, entity, entityId, diff, ipHash }) {
  const sql = db();
  await sql`insert into audit_log(project_id, actor_id, action, entity, entity_id, diff, ip_hash)
    values (${projectId || null}, ${actorId || null}, ${action}, ${entity}, ${entityId ? String(entityId) : null}, ${diff ? JSON.stringify(diff) : null}, ${ipHash || null})`;
}
