/* Dashboard API: /api/a/<route>. Every route except login/accept-invite needs a session, and every
   query is scoped to a project the user belongs to (projectScope). */
import { waitUntil } from '@vercel/functions';
import { json, errorResponse, routeOf, match, HttpError, readJson, clean, ipHash, EMAIL_RE } from './_lib/http.mjs';
import { db, builder } from './_lib/db.mjs';
import { login, logout, requireUser, projectScope, sessionCookie, clearCookie, createInvite, acceptInvite, ROLES } from './_lib/auth.mjs';
import { mergeFields, audit } from './_lib/leads.mjs';
import { rescoreLead } from './_lib/scoring-run.mjs';
import { loadSlots, advanceStage, bookingLabel } from './_lib/bookings.mjs';
import { generateSlots } from './_lib/slots.mjs';
import { createAlert } from './_lib/alerts.mjs';
import { sendEmail, layout } from './_lib/email.mjs';
import { clearProjectCache } from './_lib/project.mjs';

const STAGES = ['new', 'contacted', 'qualified', 'visit_booked', 'visited', 'negotiation', 'booked', 'lost'];
const ROUTES = [
  ['POST', 'login', doLogin, { open: true }],
  ['POST', 'logout', doLogout, { open: true }],
  ['POST', 'accept-invite', doAccept, { open: true }],
  ['GET', 'me', me],
  ['GET', 'leads', listLeads],
  ['GET', 'leads/:id', getLead],
  ['PATCH', 'leads/:id', patchLead],
  ['DELETE', 'leads/:id', deleteLead],
  ['POST', 'leads/:id/notes', addNote],
  ['POST', 'leads/:id/read', markRead],
  ['POST', 'leads/:id/touch', touch],
  ['GET', 'bookings', listBookings],
  ['PATCH', 'bookings/:id', patchBooking],
  ['GET', 'availability', getAvailability],
  ['PUT', 'availability', putAvailability],
  ['GET', 'kpis', kpis],
  ['GET', 'pulse', pulse],
  ['GET', 'alerts', listAlerts],
  ['POST', 'alerts/read', readAlerts],
  ['GET', 'views', listViews],
  ['POST', 'views', saveView],
  ['DELETE', 'views/:id', deleteView],
  ['GET', 'team', team],
  ['POST', 'invites', invite],
  ['GET', 'units', listUnits],
  ['PATCH', 'units/:code', patchUnit],
  ['GET', 'search', search],
  ['GET', 'export.csv', exportCsv],
];

async function handle(request) {
  try {
    const path = routeOf(request, '/api/a');
    const r = ROUTES.find(([m, p]) => m === request.method && match([[m, p, null]], request.method, path));
    if (!r) throw new HttpError(404, 'not_found');
    const { params } = match([[r[0], r[1], null]], request.method, path);
    const ctx = r[3]?.open ? null : await requireUser(request);
    return await r[2](request, params, ctx);
  } catch (e) { return errorResponse(e); }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;

const q = (request, k) => new URL(request.url).searchParams.get(k);
/* A valid ISO date from a query value, or the fallback (ms). */
const isoOr = (v, fallbackMs) => { const d = new Date(v || fallbackMs); return Number.isFinite(d.getTime()) ? d.toISOString() : new Date(fallbackMs).toISOString(); };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const later = (p) => { const x = Promise.resolve(p).catch((e) => console.error(e)); try { waitUntil(x); } catch {} return x; };
const sql = () => db();
const origin = (request) => (process.env.APP_ORIGIN || '').split(',')[0].trim() || new URL(request.url).origin;

async function leadIn(ctx, id, minRole = 'viewer') {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  const [lead] = await sql()`select * from leads where id = ${id} and deleted_at is null and project_id = any(${ctx.projectIds})`;
  if (!lead) throw new HttpError(404, 'not_found');
  const m = projectScope(ctx, lead.project_id, minRole);
  if (m.role === 'agent' && lead.owner_id && lead.owner_id !== ctx.user.id) throw new HttpError(403, 'not_yours');
  return { lead, membership: m };
}

/* ---------- auth ---------- */
async function doLogin(request) {
  const b = await readJson(request);
  const { user, token } = await login(request, b.email, b.password);
  return json({ ok: true, user: { id: user.id, name: user.name, email: user.email } }, 200, { 'Set-Cookie': sessionCookie(token) });
}
async function doLogout(request) {
  await logout(request);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
}
async function doAccept(request) {
  const b = await readJson(request);
  const user = await acceptInvite(b.token, { name: clean(b.name, 120), password: String(b.password || '') });
  const { token } = await login(request, user.email, b.password);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token) });
}
async function me(request, _, ctx) {
  const projects = ctx.memberships.map((m) => ({ id: m.project_id, name: m.name, slug: m.slug, role: m.role, timezone: m.timezone, currency: m.currency }));
  return json({ ok: true, user: ctx.user, projects });
}

/* ---------- leads ---------- */
const VIEWS = {
  hot_unassigned: (w) => { w.push(`l.band = 'hot'`, `l.owner_id is null`, `l.stage not in ('booked','lost')`); },
  needs_reply: (w) => { w.push(`l.first_response_at is null`, `l.stage = 'new'`); },
  visits_week: (w) => { w.push(`exists (select 1 from bookings b where b.lead_id = l.id and b.status in ('confirmed','reminded','checked_in') and b.starts_at between now() - interval '12 hours' and now() + interval '7 days')`); },
  brokers: (w) => { w.push(`l.is_broker`); },
};

async function listLeads(request, _, ctx) {
  const m = projectScope(ctx, q(request, 'project'));
  const b = builder([m.project_id, ctx.user.id]);
  const where = ['l.project_id = $1', 'l.deleted_at is null'];
  const list = (k) => (q(request, k) || '').split(',').filter(Boolean);
  if (list('band').length) where.push(`l.band = any(${b.p(list('band'))})`);
  if (list('stage').length) where.push(`l.stage = any(${b.p(list('stage'))})`);
  else if (q(request, 'view') !== 'all' && !q(request, 'q')) where.push(`l.stage <> 'lost'`);
  if (q(request, 'source')) where.push(`l.source = ${b.p(q(request, 'source'))}`);
  const owner = q(request, 'owner');
  if (owner === 'me' || m.role === 'agent') where.push(m.role === 'agent' ? `(l.owner_id = $2 or l.owner_id is null)` : `l.owner_id = $2`);
  else if (owner === 'none') where.push('l.owner_id is null');
  else if (owner && UUID_RE.test(owner)) where.push(`l.owner_id = ${b.p(owner)}`);
  if (q(request, 'broker') !== 'include' && q(request, 'view') !== 'brokers') where.push('not l.is_broker');
  if (q(request, 'q')) {
    const raw = clean(q(request, 'q'), 80).replace(/[%_]/g, '');
    const text = b.p('%' + raw + '%');
    const digits = raw.replace(/\D/g, '');
    where.push(`(l.name ilike ${text} or l.email ilike ${text} or l.one_liner ilike ${text}${digits.length >= 3 ? ` or l.phone_e164 like ${b.p('%' + digits + '%')}` : ''})`);
  }
  if (Object.hasOwn(VIEWS, q(request, 'view') || '')) VIEWS[q(request, 'view')](where);
  const limit = Math.min(Math.max(Math.trunc(Number(q(request, 'limit'))) || 60, 1), 200);
  const offset = Math.min(Math.max(Math.trunc(Number(q(request, 'offset'))) || 0, 0), 100000);
  const SORTS = { score: 'l.score desc', created: 'l.created_at desc', activity: 'l.last_activity_at desc' };
  const sort = Object.hasOwn(SORTS, q(request, 'sort') || '') ? SORTS[q(request, 'sort')] : null;
  const rows = await sql().query(`
    select l.id, l.name, l.phone_e164, l.email, l.band, l.score, l.one_liner, l.stage, l.stage_changed_at, l.source, l.medium, l.campaign,
      l.owner_id, u.name as owner_name, l.last_activity_at, l.created_at, l.first_response_at, l.is_broker, l.lang,
      l.fields->'budget' as budget, l.fields->'unit_interest' as unit_interest, l.fields->'configuration' as configuration,
      l.score_reasons->'for' as reasons,
      (select min(bk.starts_at) from bookings bk where bk.lead_id = l.id and bk.status in ('confirmed','reminded','checked_in') and bk.starts_at > now() - interval '12 hours') as next_visit,
      (r.read_at is null or r.read_at < l.last_activity_at) as unread,
      (l.band = 'hot' and l.stage not in ('booked','lost') and (l.owner_id is null or l.first_response_at is null)) as pinned
    from leads l left join users u on u.id = l.owner_id left join lead_reads r on r.lead_id = l.id and r.user_id = $2
    where ${where.join(' and ')}
    order by ${sort || `(l.band = 'hot' and l.stage not in ('booked','lost') and (l.owner_id is null or l.first_response_at is null)) desc, l.score desc, l.last_activity_at desc`}, l.id
    limit ${limit + 1} offset ${offset}`, b.params);
  return json({ ok: true, leads: rows.slice(0, limit), more: rows.length > limit });
}

async function getLead(request, { id }, ctx) {
  const { lead, membership } = await leadIn(ctx, id);
  const s = sql();
  const [events, messages, bookings, notes, history, scores, summary, consents, owner, sessions] = await Promise.all([
    s`select e.id, e.type, e.props, e.url, e.at from events e join visitors v on v.id = e.visitor_id where v.lead_id = ${id} order by e.at desc limit 300`,
    s`select m.id, m.session_id, m.role, m.content, m.cards, m.guardrail, m.created_at from messages m join chat_sessions cs on cs.id = m.session_id
      where cs.lead_id = ${id} and m.role in ('user','assistant','agent','note') order by m.id desc limit 400`.then((r) => r.reverse()),
    s`select * from bookings where lead_id = ${id} order by starts_at desc`,
    s`select n.id, n.body, n.created_at, u.name as author from notes n join users u on u.id = n.author_id where n.lead_id = ${id} order by n.created_at desc`,
    s`select a.action, a.diff, a.at, u.name as actor from audit_log a left join users u on u.id = a.actor_id where a.entity = 'lead' and a.entity_id = ${id} order by a.at desc limit 100`,
    s`select score, band, fit, intent, reach, created_at from lead_scores where lead_id = ${id} order by created_at desc limit 60`.then((r) => r.reverse()),
    s`select data, created_at, model from summaries where lead_id = ${id} order by created_at desc limit 1`,
    s`select distinct on (purpose) purpose, granted, created_at, source from consents where lead_id = ${id} order by purpose, created_at desc`,
    lead.owner_id ? s`select id, name, email from users where id = ${lead.owner_id}` : [],
    s`select id, ref_code, lang, started_at, last_message_at, user_msgs, guardrail_hits, flagged from chat_sessions where lead_id = ${id} order by started_at`,
  ]);
  const [project] = await s`select id, name, timezone, currency, settings->'contact' as contact from projects where id = ${lead.project_id}`;
  later(s`insert into lead_reads(user_id, lead_id) values (${ctx.user.id}, ${id}) on conflict (user_id, lead_id) do update set read_at = now()`);
  return json({
    ok: true, role: membership.role, project, lead, owner: owner[0] || null, events, messages, sessions, notes, history, scores, consents,
    summary: summary[0] || null,
    bookings: bookings.map((b) => ({ ...b, manage_token_hash: undefined, label: bookingLabel(b.starts_at, project.timezone) })),
  });
}

async function patchLead(request, { id }, ctx) {
  const { lead } = await leadIn(ctx, id, 'agent');
  const b = await readJson(request);
  const s = sql();
  const diff = {};
  if (b.stage !== undefined) {
    if (!STAGES.includes(b.stage)) throw new HttpError(400, 'bad_stage');
    if (b.stage === 'lost' && !clean(b.lost_reason, 200)) throw new HttpError(400, 'lost_reason', 'Add a reason when marking a lead lost.');
    if (b.stage !== lead.stage) {
      await s`update leads set stage = ${b.stage}, stage_changed_at = now(), lost_reason = ${b.stage === 'lost' ? clean(b.lost_reason, 200) : null}, last_activity_at = now(),
        first_response_at = coalesce(first_response_at, case when ${b.stage} <> 'new' then now() end) where id = ${id}`;
      diff.stage = [lead.stage, b.stage];
    }
  }
  if (b.owner_id !== undefined) {
    const owner = b.owner_id || null;
    if (owner) {
      const [ok] = await s`select 1 from memberships where user_id = ${owner} and project_id = ${lead.project_id}`;
      if (!ok) throw new HttpError(400, 'bad_owner');
    }
    await s`update leads set owner_id = ${owner} where id = ${id}`;
    diff.owner = [lead.owner_id, owner];
  }
  if (b.fields && typeof b.fields === 'object') {
    const allowed = ['budget', 'configuration', 'unit_interest', 'timeline', 'purpose', 'financing', 'decision_makers', 'preferred_contact'];
    const patch = Object.fromEntries(Object.entries(b.fields).filter(([k]) => allowed.includes(k)).map(([k, v]) => [k, typeof v === 'object' && v ? v : { value: clean(v, 200) }]));
    await s`update leads set fields = ${JSON.stringify(mergeFields(lead.fields, patch, 'rep'))} where id = ${id}`;
    diff.fields = Object.keys(patch);
  }
  if (b.next_action !== undefined) { await s`update leads set next_action = ${clean(b.next_action, 200) || null} where id = ${id}`; diff.next_action = true; }
  if (b.is_broker !== undefined) { await s`update leads set is_broker = ${Boolean(b.is_broker)} where id = ${id}`; diff.is_broker = Boolean(b.is_broker); }
  if (b.name !== undefined) { await s`update leads set name = ${clean(b.name, 120)} where id = ${id}`; diff.name = true; }
  await audit({ projectId: lead.project_id, actorId: ctx.user.id, action: 'lead.updated', entity: 'lead', entityId: id, diff, ipHash: ipHash(request) });
  later(rescoreLead(id));
  const [row] = await s`select * from leads where id = ${id}`;
  return json({ ok: true, lead: row });
}

/* Data-subject deletion: personal data is removed, aggregate history stays. */
async function deleteLead(request, { id }, ctx) {
  const { lead } = await leadIn(ctx, id, 'manager');
  const s = sql();
  // consent rows stay as evidence (without IPs); every other personal trace is removed or blanked
  await s.transaction([
    s`update messages set content = '[deleted]', content_redacted = null, cards = null, tool_calls = null, guardrail = null where session_id in (select id from chat_sessions where lead_id = ${id})`,
    s`delete from summaries where lead_id = ${id} or session_id in (select id from chat_sessions where lead_id = ${id})`,
    s`update chat_sessions set ip_hash = null where lead_id = ${id}`,
    s`delete from notes where lead_id = ${id}`,
    s`delete from events where visitor_id in (select id from visitors where lead_id = ${id})`,
    s`update visitors set lead_id = null, first_touch = '{}', last_touch = '{}', anon_id = 'deleted-' || id where lead_id = ${id}`,
    s`update consents set ip_hash = null where lead_id = ${id}`,
    s`update bookings set status = case when status in ('confirmed','reminded','checked_in') then 'cancelled' else status end, outcome_note = null, unit_code = null where lead_id = ${id}`,
    s`update alerts set payload = '{}' where lead_id = ${id}`,
    s`update lead_scores set reasons = '{}' where lead_id = ${id}`,
    s`update audit_log set diff = null, ip_hash = null where entity = 'lead' and entity_id = ${String(id)}`,
    s`update leads set name = null, phone_e164 = null, email = null, fields = '{}', attribution = '{}', score_reasons = '{}', one_liner = null, next_action = null, lost_reason = null, deleted_at = now() where id = ${id}`,
  ]);
  await audit({ projectId: lead.project_id, actorId: ctx.user.id, action: 'lead.deleted', entity: 'lead', entityId: id, ipHash: ipHash(request) });
  return json({ ok: true });
}

async function addNote(request, { id }, ctx) {
  const { lead } = await leadIn(ctx, id, 'agent');
  const body = clean((await readJson(request)).body, 4000);
  if (!body) throw new HttpError(400, 'empty');
  const [n] = await sql()`insert into notes(lead_id, author_id, body) values (${id}, ${ctx.user.id}, ${body}) returning id, body, created_at`;
  await sql()`update leads set last_activity_at = now() where id = ${id}`;
  await audit({ projectId: lead.project_id, actorId: ctx.user.id, action: 'note.added', entity: 'lead', entityId: id });
  return json({ ok: true, note: { ...n, author: ctx.user.name } });
}

async function markRead(request, { id }, ctx) {
  await leadIn(ctx, id);
  await sql()`insert into lead_reads(user_id, lead_id) values (${ctx.user.id}, ${id}) on conflict (user_id, lead_id) do update set read_at = now()`;
  return json({ ok: true });
}

/* A rep reached out (WhatsApp / call / email): first response time and stage. */
async function touch(request, { id }, ctx) {
  const { lead } = await leadIn(ctx, id, 'agent');
  const b = await readJson(request);
  const ch = ['whatsapp', 'call', 'email'].includes(b.channel) ? b.channel : 'other';
  await sql()`update leads set first_response_at = coalesce(first_response_at, now()), last_activity_at = now(),
    stage = case when stage = 'new' then 'contacted' else stage end,
    stage_changed_at = case when stage = 'new' then now() else stage_changed_at end,
    owner_id = coalesce(owner_id, ${ctx.user.id})
    where id = ${id}`;
  await audit({ projectId: lead.project_id, actorId: ctx.user.id, action: 'lead.contacted', entity: 'lead', entityId: id, diff: { channel: ch } });
  const [row] = await sql()`select * from leads where id = ${id}`;
  return json({ ok: true, lead: row });
}

/* ---------- bookings / calendar ---------- */
async function listBookings(request, _, ctx) {
  const m = projectScope(ctx, q(request, 'project'));
  const from = isoOr(q(request, 'from'), Date.now() - 86400e3);
  const to = isoOr(q(request, 'to'), Date.now() + 14 * 86400e3);
  const rows = await sql()`select b.id, b.kind, b.unit_code, b.starts_at, b.ends_at, b.status, b.assigned_to, b.outcome_note, b.created_via, b.lead_id,
      l.name as lead_name, l.phone_e164, l.band, l.score, l.one_liner, l.owner_id, u.name as assigned_name
    from bookings b join leads l on l.id = b.lead_id left join users u on u.id = b.assigned_to
    where b.project_id = ${m.project_id} and b.starts_at >= ${from} and b.starts_at < ${to} and b.status <> 'rescheduled' and l.deleted_at is null
    order by b.starts_at`;
  // agents see their own leads, unassigned ones, and visits assigned to them
  const visible = rows.filter((r) => m.role !== 'agent' || !r.owner_id || r.owner_id === ctx.user.id || r.assigned_to === ctx.user.id);
  return json({ ok: true, timezone: m.timezone, bookings: visible });
}

async function patchBooking(request, { id }, ctx) {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'not_found');
  const [bk] = await sql()`select * from bookings where id = ${id} and project_id = any(${ctx.projectIds})`;
  if (!bk) throw new HttpError(404, 'not_found');
  const { membership: m } = await leadIn(ctx, bk.lead_id, 'agent');   // agents: only visits on their own or unassigned leads
  const b = await readJson(request);
  const s = sql();
  // allowed outcome changes; a cancelled / rescheduled visit is never revived (its seat may be taken)
  const NEXT = { confirmed: ['checked_in', 'done', 'no_show', 'cancelled'], reminded: ['checked_in', 'done', 'no_show', 'cancelled'], checked_in: ['done', 'no_show'], done: ['no_show'], no_show: ['done'] };
  if (b.status) {
    if (!(NEXT[bk.status] || []).includes(b.status)) throw new HttpError(409, 'bad_transition', `A ${bk.status.replace('_', ' ')} visit can't be marked ${b.status.replace('_', ' ')}.`);
    const [done] = await s`update bookings set status = ${b.status}, outcome_note = coalesce(${clean(b.outcome_note, 500) || null}, outcome_note), updated_at = now(),
      ics_seq = ics_seq + case when ${b.status} = 'cancelled' then 1 else 0 end where id = ${id} and status = ${bk.status} returning id`;
    if (!done) throw new HttpError(409, 'changed', 'This visit was just updated by someone else. Reload and try again.');
    if (b.status === 'checked_in' || b.status === 'done') await advanceStage(bk.lead_id, 'visited');
    if (b.status === 'no_show') await createAlert({ projectId: bk.project_id, leadId: bk.lead_id, kind: 'no_show', payload: { when: bookingLabel(bk.starts_at, m.timezone) } });
  }
  if (b.assigned_to !== undefined) {
    const to = b.assigned_to || null;
    if (to && !(UUID_RE.test(to) && (await s`select 1 from memberships where user_id = ${to} and project_id = ${bk.project_id}`).length)) throw new HttpError(400, 'bad_assignee');
    await s`update bookings set assigned_to = ${to} where id = ${id}`;
  }
  await audit({ projectId: bk.project_id, actorId: ctx.user.id, action: 'booking.updated', entity: 'booking', entityId: id, diff: { status: b.status, assigned_to: b.assigned_to } });
  await audit({ projectId: bk.project_id, actorId: ctx.user.id, action: 'booking.' + (b.status || 'updated'), entity: 'lead', entityId: bk.lead_id, diff: { booking: id, status: b.status } });
  later(rescoreLead(bk.lead_id));
  const [row] = await s`select * from bookings where id = ${id}`;
  return json({ ok: true, booking: { ...row, manage_token_hash: undefined } });
}

async function getAvailability(request, _, ctx) {
  const m = projectScope(ctx, q(request, 'project'));
  const [rules, exceptions] = await Promise.all([
    sql()`select kind, weekday, to_char(start_local, 'HH24:MI') as start, to_char(end_local, 'HH24:MI') as "end", slot_minutes, capacity, location from availability_rules where project_id = ${m.project_id} order by kind, weekday, start_local`,
    sql()`select id, kind, to_char(date, 'YYYY-MM-DD') as date, closed, to_char(start_local, 'HH24:MI') as start, to_char(end_local, 'HH24:MI') as "end", note from availability_exceptions where project_id = ${m.project_id} and date >= current_date order by date`,
  ]);
  return json({ ok: true, timezone: m.timezone, rules, exceptions });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
async function putAvailability(request, _, ctx) {
  const b = await readJson(request, 64 * 1024);
  const m = projectScope(ctx, b.project, 'manager');
  const kind = b.kind === 'video_call' ? 'video_call' : 'site_visit';
  const rules = (Array.isArray(b.rules) ? b.rules : []).slice(0, 50).map((r) => {
    if (!(r.weekday >= 0 && r.weekday <= 6) || !HHMM.test(r.start) || !HHMM.test(r.end) || r.start >= r.end) throw new HttpError(400, 'bad_rule', 'Check the opening hours.');
    return { weekday: r.weekday, start: r.start, end: r.end, slot_minutes: Math.min(Math.max(Number(r.slot_minutes) || 45, 15), 240), capacity: Math.min(Math.max(Number(r.capacity) || 1, 1), 20), location: clean(r.location, 120) || null };
  });
  const exceptions = (Array.isArray(b.exceptions) ? b.exceptions : []).slice(0, 100).map((e) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new HttpError(400, 'bad_date');
    if (!e.closed && (!HHMM.test(e.start) || !HHMM.test(e.end))) throw new HttpError(400, 'bad_exception');
    return { date: e.date, closed: Boolean(e.closed), start: e.closed ? null : e.start, end: e.closed ? null : e.end, note: clean(e.note, 120) || null, kind: e.kind || null };
  });
  const s = sql();
  await s.transaction([
    s`delete from availability_rules where project_id = ${m.project_id} and kind = ${kind}`,
    ...rules.map((r) => s`insert into availability_rules(project_id, kind, weekday, start_local, end_local, slot_minutes, capacity, location)
      values (${m.project_id}, ${kind}, ${r.weekday}, ${r.start}, ${r.end}, ${r.slot_minutes}, ${r.capacity}, ${r.location})`),
    ...(b.exceptions ? [s`delete from availability_exceptions where project_id = ${m.project_id} and date >= current_date`,
      ...exceptions.map((e) => s`insert into availability_exceptions(project_id, kind, date, closed, start_local, end_local, note)
        values (${m.project_id}, ${e.kind}, ${e.date}, ${e.closed}, ${e.start}, ${e.end}, ${e.note})`)] : []),
  ]);
  await audit({ projectId: m.project_id, actorId: ctx.user.id, action: 'availability.updated', entity: 'project', entityId: m.project_id, diff: { kind, rules: rules.length } });
  const preview = generateSlots(rules.map((r) => ({ ...r, kind, start_local: r.start, end_local: r.end })), exceptions.map((e) => ({ ...e, start_local: e.start, end_local: e.end })), [], new Date(), { tz: m.timezone, kind, days: 7 });
  return json({ ok: true, preview });
}

/* ---------- insights ---------- */
async function kpis(request, _, ctx) {
  const m = projectScope(ctx, q(request, 'project'));
  const days = Math.min(Math.max(Number(q(request, 'days')) || 30, 1), 365);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400e3);
  const prev = new Date(from.getTime() - days * 86400e3);
  const s = sql();
  const period = async (a, b) => (await s`
    select
      (select count(*)::int from leads where project_id = ${m.project_id} and deleted_at is null and created_at >= ${a} and created_at < ${b}) as new_leads,
      (select count(*)::int from leads where project_id = ${m.project_id} and deleted_at is null and band = 'hot' and last_activity_at >= ${a} and last_activity_at < ${b}) as hot_leads,
      (select count(*)::int from bookings where project_id = ${m.project_id} and status <> 'rescheduled' and created_at >= ${a} and created_at < ${b}) as visits_booked,
      (select count(*) filter (where status in ('done','checked_in'))::int from bookings where project_id = ${m.project_id} and starts_at >= ${a} and starts_at < least(${b}::timestamptz, now())) as shows,
      (select count(*) filter (where status in ('done','checked_in','no_show'))::int from bookings where project_id = ${m.project_id} and starts_at >= ${a} and starts_at < least(${b}::timestamptz, now())) as due,
      (select count(*) filter (where stage = 'booked')::int from leads where project_id = ${m.project_id} and deleted_at is null and created_at >= ${a} and created_at < ${b}) as bookings_won,
      (select count(*) filter (where stage in ('visited','negotiation','booked'))::int from leads where project_id = ${m.project_id} and deleted_at is null and created_at >= ${a} and created_at < ${b}) as visited,
      (select percentile_cont(0.5) within group (order by extract(epoch from first_response_at - created_at)) from leads
        where project_id = ${m.project_id} and first_response_at is not null and created_at >= ${a} and created_at < ${b}) as median_response_s,
      (select count(*)::int from chat_sessions where project_id = ${m.project_id} and started_at >= ${a} and started_at < ${b}) as chats,
      (select coalesce(sum(cost_micros), 0)::bigint from chat_sessions where project_id = ${m.project_id} and started_at >= ${a} and started_at < ${b}) as ai_cost_micros`)[0];
  const [cur, before] = await Promise.all([period(from, to), period(prev, from)]);
  // one grouped pass per table (index-friendly range filters), joined onto a plain date series —
  // independent of the database session's TimeZone
  const series = await s`
    with days as (
      select d::date as day from generate_series((${from}::timestamptz at time zone ${m.timezone})::date,
        (${to}::timestamptz at time zone ${m.timezone})::date, interval '1 day') d),
    l as (select (created_at at time zone ${m.timezone})::date as day, count(*)::int as leads, count(*) filter (where band = 'hot')::int as hot
      from leads where project_id = ${m.project_id} and deleted_at is null and created_at >= ${from} group by 1),
    b as (select (created_at at time zone ${m.timezone})::date as day, count(*)::int as visits
      from bookings where project_id = ${m.project_id} and status <> 'rescheduled' and created_at >= ${from} group by 1),
    c as (select (started_at at time zone ${m.timezone})::date as day, count(*)::int as chats
      from chat_sessions where project_id = ${m.project_id} and started_at >= ${from} group by 1)
    select to_char(days.day, 'YYYY-MM-DD') as day, coalesce(l.leads, 0) as leads, coalesce(l.hot, 0) as hot,
      coalesce(b.visits, 0) as visits, coalesce(c.chats, 0) as chats
    from days left join l using (day) left join b using (day) left join c using (day) order by days.day`;
  const funnel = await s`
    select coalesce(l.source, 'direct') as source, coalesce(l.campaign, '') as campaign, count(*)::int as leads,
      count(*) filter (where l.first_response_at is not null or l.stage <> 'new')::int as contacted,
      count(*) filter (where l.stage in ('qualified','visit_booked','visited','negotiation','booked'))::int as qualified,
      count(*) filter (where exists (select 1 from bookings b where b.lead_id = l.id and b.status <> 'rescheduled'))::int as visit_booked,
      count(*) filter (where l.stage in ('visited','negotiation','booked'))::int as visited,
      count(*) filter (where l.stage = 'booked')::int as booked,
      count(*) filter (where l.band = 'hot')::int as hot
    from leads l where l.project_id = ${m.project_id} and l.deleted_at is null and l.created_at >= ${from} and l.created_at < ${to}
    group by 1, 2 order by leads desc limit 20`;
  const bands = await s`select band, count(*)::int as n from leads where project_id = ${m.project_id} and deleted_at is null and stage <> 'lost' group by band`;
  const stages = await s`select stage, count(*)::int as n from leads where project_id = ${m.project_id} and deleted_at is null group by stage`;
  const topUnits = await s`select e.props->>'code' as code, count(distinct v.id)::int as visitors from events e join visitors v on v.id = e.visitor_id
    where e.project_id = ${m.project_id} and e.type in ('unit_opened','unit_card_3d') and e.at >= ${from} and e.props->>'code' is not null group by 1 order by 2 desc limit 8`;
  return json({ ok: true, days, current: cur, previous: before, series, funnel, bands, stages, top_units: topUnits });
}

async function pulse(request, _, ctx) {
  const m = projectScope(ctx, q(request, 'project'));
  const since = isoOr(q(request, 'since'), Date.now() - 60e3);
  const s = sql();
  const [alerts, [counts]] = await Promise.all([
    s`select a.id, a.kind, a.payload, a.created_at, a.lead_id, l.name as lead_name, l.band, l.score from alerts a left join leads l on l.id = a.lead_id
      where a.project_id = ${m.project_id} and a.created_at > ${since} order by a.created_at desc limit 20`,
    s`select count(*) filter (where created_at > ${since})::int as new_leads, max(last_activity_at) as last_activity,
        count(*) filter (where band = 'hot' and stage not in ('booked','lost') and owner_id is null)::int as hot_unassigned,
        count(*) filter (where stage = 'new' and first_response_at is null)::int as awaiting_reply
      from leads where project_id = ${m.project_id} and deleted_at is null`,
  ]);
  return json({ ok: true, now: new Date().toISOString(), alerts, ...counts });
}

async function listAlerts(request, _, ctx) {
  const m = projectScope(ctx, q(request, 'project'));
  const rows = await sql()`select a.id, a.kind, a.payload, a.created_at, a.read_at, a.lead_id, l.name as lead_name, l.band from alerts a left join leads l on l.id = a.lead_id
    where a.project_id = ${m.project_id} order by a.created_at desc limit 50`;
  return json({ ok: true, alerts: rows });
}
async function readAlerts(request, _, ctx) {
  const b = await readJson(request);
  const m = projectScope(ctx, b.project);
  await sql()`update alerts set read_at = now() where project_id = ${m.project_id} and read_at is null`;
  return json({ ok: true });
}

/* ---------- saved views ---------- */
async function listViews(request, _, ctx) {
  const m = projectScope(ctx, q(request, 'project'));
  const rows = await sql()`select id, name, filters, position from saved_views where user_id = ${ctx.user.id} and project_id = ${m.project_id} order by position, name`;
  return json({ ok: true, views: rows });
}
async function saveView(request, _, ctx) {
  const b = await readJson(request);
  const m = projectScope(ctx, b.project);
  const name = clean(b.name, 60);
  if (!name) throw new HttpError(400, 'empty');
  const [v] = await sql()`insert into saved_views(user_id, project_id, name, filters, position) values (${ctx.user.id}, ${m.project_id}, ${name}, ${JSON.stringify(b.filters || {})}, ${Number(b.position) || 0}) returning *`;
  return json({ ok: true, view: v });
}
async function deleteView(request, { id }, ctx) {
  await sql()`delete from saved_views where id = ${id} and user_id = ${ctx.user.id}`;
  return json({ ok: true });
}

/* ---------- team ---------- */
async function team(request, _, ctx) {
  const m = projectScope(ctx, q(request, 'project'));
  const rows = await sql()`select u.id, u.name, u.email, m.role, u.last_login_at,
      (select count(*)::int from leads l where l.owner_id = u.id and l.project_id = ${m.project_id} and l.stage not in ('booked','lost') and l.deleted_at is null) as open_leads
    from memberships m join users u on u.id = m.user_id where m.project_id = ${m.project_id} and u.disabled_at is null order by u.name`;
  const invites = ROLES.indexOf(m.role) >= ROLES.indexOf('manager')
    ? await sql()`select email, role, expires_at from invites where project_id = ${m.project_id} and accepted_at is null and expires_at > now() order by expires_at desc` : [];
  return json({ ok: true, members: rows, invites, role: m.role });
}
async function invite(request, _, ctx) {
  const b = await readJson(request);
  const email = clean(b.email, 160).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'bad_email', 'Enter a valid email.');
  const m = projectScope(ctx, b.project, 'manager');
  const token = await createInvite(ctx, { projectId: m.project_id, email, role: ROLES.includes(b.role) ? b.role : 'agent' });
  const link = `${origin(request)}/dashboard/invite?token=${token}`;
  const sent = await sendEmail({ to: email, subject: `You're invited to the ${m.name} sales dashboard`, text: `${ctx.user.name} invited you. Set your password here (valid 7 days): ${link}`,
    html: layout({ eyebrow: m.name, title: 'Join the sales dashboard', lines: [['Invited by', ctx.user.name], ['Role', b.role || 'agent']], button: { href: link, label: 'Accept invite' }, footer: 'This link is valid for 7 days.' }) });
  await audit({ projectId: m.project_id, actorId: ctx.user.id, action: 'invite.created', entity: 'user', entityId: email });
  // the token proves mailbox ownership, so it travels by email; only an owner gets a copyable link, and only when email isn't set up
  return json({ ok: true, emailed: sent.ok, link: !sent.ok && m.role === 'owner' ? link : null });
}

/* ---------- units (live availability shown on the site) ---------- */
async function listUnits(request, _, ctx) {
  const m = projectScope(ctx, q(request, 'project'));
  const rows = await sql()`select u.code, u.level, u.plan, u.name, u.status, u.price_from::float as price_from, u.areas,
      (select count(distinct e.visitor_id)::int from events e where e.project_id = u.project_id and e.type in ('unit_opened','unit_card_3d') and e.props->>'code' = u.code) as viewers
    from units u where u.project_id = ${m.project_id} order by u.level desc, u.code`;
  return json({ ok: true, units: rows });
}
async function patchUnit(request, { code }, ctx) {
  const b = await readJson(request);
  const m = projectScope(ctx, b.project, 'manager');
  if (!['available', 'reserved', 'sold'].includes(b.status)) throw new HttpError(400, 'bad_status');
  const [u] = await sql()`update units set status = ${b.status}, updated_at = now() where project_id = ${m.project_id} and code = ${code} returning code, status`;
  if (!u) throw new HttpError(404, 'not_found');
  clearProjectCache();
  await audit({ projectId: m.project_id, actorId: ctx.user.id, action: 'unit.status', entity: 'unit', entityId: code, diff: { status: b.status } });
  return json({ ok: true, unit: u });
}

async function search(request, _, ctx) {
  const term = clean(q(request, 'q'), 60);
  if (term.length < 2) return json({ ok: true, leads: [] });
  const like = '%' + term.replace(/[%_]/g, '') + '%';
  const digits = term.replace(/\D/g, '');
  const phone = digits.length >= 3 ? '%' + digits + '%' : '__no_phone_match__';
  // agents see only their own and unassigned leads, as in listLeads/leadIn
  const agentProjects = ctx.memberships.filter((m) => m.role === 'agent').map((m) => m.project_id);
  const rows = await sql()`select id, name, phone_e164, band, score, stage, one_liner from leads
    where project_id = any(${ctx.projectIds}) and deleted_at is null
      and (project_id <> all(${agentProjects}) or owner_id = ${ctx.user.id} or owner_id is null)
      and (name ilike ${like} or phone_e164 like ${phone} or email ilike ${like} or one_liner ilike ${like})
    order by last_activity_at desc limit 8`;
  return json({ ok: true, leads: rows });
}

async function exportCsv(request, _, ctx) {
  const m = projectScope(ctx, q(request, 'project'), 'manager');
  const rows = await sql()`select l.created_at, l.name, l.phone_e164, l.email, l.band, l.score, l.stage, l.source, l.medium, l.campaign, u.name as owner,
      l.one_liner, l.fields->'budget'->>'value' as budget, l.fields->'configuration'->>'value' as configuration, l.fields->'timeline'->>'value' as timeline,
      l.first_response_at, l.last_activity_at
    from leads l left join users u on u.id = l.owner_id where l.project_id = ${m.project_id} and l.deleted_at is null order by l.created_at desc limit 20000`;
  const cols = ['created_at', 'name', 'phone_e164', 'email', 'band', 'score', 'stage', 'source', 'medium', 'campaign', 'owner', 'one_liner', 'budget', 'configuration', 'timeline', 'first_response_at', 'last_activity_at'];
  const cell = (v) => {
    let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^\+\d+$/.test(s)) s = "'" + s;   // no spreadsheet formula injection (plain phone numbers are harmless)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  await audit({ projectId: m.project_id, actorId: ctx.user.id, action: 'leads.exported', entity: 'project', entityId: m.project_id, diff: { rows: rows.length }, ipHash: ipHash(request) });
  return new Response('﻿' + csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${m.slug}-leads-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
}
