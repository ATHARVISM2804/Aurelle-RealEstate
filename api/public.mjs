/* Public API for the website (no login): /api/p/<route>. */
import { waitUntil } from '@vercel/functions';
import { json, errorResponse, routeOf, match, HttpError, readJson, ipHash, clientIp, clean, EMAIL_RE } from './_lib/http.mjs';
import { db } from './_lib/db.mjs';
import { loadProject } from './_lib/project.mjs';
import { loadSession } from './_lib/chat/session.mjs';
import { toE164 } from './_lib/phone.mjs';
import { upsertLead, linkVisitor, recordConsents, storeEvents, audit } from './_lib/leads.mjs';
import { verifyTurnstile } from './_lib/turnstile.mjs';
import { hit } from './_lib/ratelimit.mjs';
import { loadSlots, createBooking, findByToken, reschedule, cancel, activeBookingForLead } from './_lib/bookings.mjs';
import { notifyBooking, bookingView, icsFor } from './_lib/booking-mail.mjs';
import { createAlert } from './_lib/alerts.mjs';
import { sendEmail, layout } from './_lib/email.mjs';

const ROUTES = [
  ['GET', 'inventory', inventory],
  ['GET', 'session', sessionRestore],
  ['POST', 'events', events],
  ['GET', 'slots', slots],
  ['POST', 'contact', contact],
  ['POST', 'bookings', book],
  ['GET', 'bookings/manage', manageGet],
  ['POST', 'bookings/manage', managePost],
  ['GET', 'ics', ics],
];

async function handle(request) {
  try {
    const path = routeOf(request, '/api/p');
    const m = match(ROUTES, request.method, path);
    if (!m) throw new HttpError(404, 'not_found');
    return await m.fn(request, m.params);
  } catch (e) { return errorResponse(e); }
}
export const GET = handle;
export const POST = handle;

const later = (p) => { const q = Promise.resolve(p).catch((e) => console.error('background job failed', e)); try { waitUntil(q); } catch {} return q; };
const originOf = (request) => (process.env.APP_ORIGIN || '').split(',')[0].trim() || new URL(request.url).origin;
const q = (request, k) => new URL(request.url).searchParams.get(k);
const LANGS = ['en', 'ar', 'hi', 'hi-Latn'];
const langOf = (v) => (LANGS.includes(v) ? v : 'en');

/* Unit statuses for the explorer. CDN-cached so ordinary site traffic never wakes the database. */
async function inventory(request) {
  const project = await loadProject(q(request, 'project') || 'aurelle');
  const rows = await db()`select code, status from units where project_id = ${project.id} order by code`;
  return json({
    ok: true,
    sold: rows.filter((r) => r.status === 'sold').map((r) => r.code),
    reserved: rows.filter((r) => r.status === 'reserved').map((r) => r.code),
    updated: new Date().toISOString(),
  }, 200, { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' });
}

/* Restore a conversation after reload. */
async function sessionRestore(request) {
  const s = await loadSession(q(request, 'sid'), q(request, 't'));
  const project = await loadProject(s.project_id);
  const rows = await db()`select id, role, content, cards, created_at from messages where session_id = ${s.id}
    and role in ('user','assistant','agent') order by id desc limit 30`;
  const booking = await activeBookingForLead(s.lead_id, s.id);
  return json({
    ok: true, ref: s.ref_code, lang: s.lang, contact: Boolean(s.lead_id),
    booking: booking ? bookingView(project, booking, { origin: originOf(request), lang: langOf(s.lang) }) : null,
    messages: rows.reverse().map((m) => ({ id: String(m.id), role: m.role, content: m.content, cards: m.cards || [], at: m.created_at })),
  });
}

/* Behaviour events (sendBeacon, text/plain). Only sent once the visitor has a chat session. */
async function events(request) {
  const b = await readJson(request, 32 * 1024);
  const s = await loadSession(b.sid, b.t);
  await hit('evt:' + s.id, 120, 3600);
  const evts = Array.isArray(b.events) ? b.events : [];
  await storeEvents(s.project_id, s.visitor_id, s.id, evts);
  if (b.sessions_7d) await db()`update visitors set sessions_7d = greatest(sessions_7d, ${Math.min(Number(b.sessions_7d) || 1, 99)}) where id = ${s.visitor_id}`;
  if (evts.some((e) => e?.type === 'chat_closed')) {
    later(import('./_lib/summarize.mjs').then((m) => m.summarizeSession(s.id)));
  } else if (s.lead_id && evts.length) {
    later(import('./_lib/scoring-run.mjs').then((m) => m.rescoreLead(s.lead_id)));
  }
  return new Response(null, { status: 204 });
}

async function slots(request) {
  const project = await loadProject(q(request, 'project') || 'aurelle');
  const kind = q(request, 'kind') === 'video_call' ? 'video_call' : 'site_visit';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q(request, 'from') || '') ? q(request, 'from') : undefined;
  const days = await loadSlots(project, kind, { lang: langOf(q(request, 'lang')), from, days: Math.min(Number(q(request, 'days')) || 7, 14) });
  return json({ ok: true, kind, tz: project.timezone, days });
}

/* Shared: validate contact details, create/update the lead, link the chat, store consents. */
async function captureLead(request, b, project, session, { requireEmail = false, purpose }) {
  const name = clean(b.name, 120);
  const email = clean(b.email, 160);
  const phone = toE164(clean(b.phone, 40), clean(b.cc, 6));
  const errors = {};
  if (name.length < 2) errors.name = 'Please enter your name.';
  if (!phone) errors.phone = 'Please enter a valid phone number.';
  if ((requireEmail || email) && !EMAIL_RE.test(email)) errors.email = 'Please enter a valid email address.';
  if (Object.keys(errors).length) throw Object.assign(new HttpError(400, 'invalid'), { fields: errors });
  const [visitor] = await db()`select * from visitors where id = ${session.visitor_id}`;
  const { lead, created } = await upsertLead(project, {
    name, phone, email, lang: langOf(b.lang),
    attribution: { first: visitor?.first_touch || {}, last: visitor?.last_touch || {} },
    fields: { preferred_contact: b.consents?.whatsapp ? 'WhatsApp' : b.consents?.call ? 'Call' : null },
    fieldSource: 'form',
  });
  await linkVisitor(lead.id, session.visitor_id);
  await db()`update chat_sessions set lead_id = ${lead.id} where id = ${session.id}`;
  const consents = Object.fromEntries(['call', 'whatsapp', 'email', 'marketing'].filter((k) => typeof b.consents?.[k] === 'boolean').map((k) => [k, b.consents[k]]));
  await recordConsents(project.id, { leadId: lead.id, visitorId: session.visitor_id, consents, textVersion: clean(b.consent_version, 40) || 'chat-v1', texts: b.consent_texts || {}, source: 'chat', ipHash: ipHash(request) });
  await audit({ projectId: project.id, action: created ? 'lead.created' : 'lead.updated', entity: 'lead', entityId: lead.id, diff: { via: 'chat', purpose }, ipHash: ipHash(request) });
  return lead;
}

const note = (session, project, text) => db()`insert into messages(session_id, project_id, role, content) values (${session.id}, ${project.id}, 'note', ${text})`;

async function contact(request) {
  const b = await readJson(request);
  const session = await loadSession(b.sid, b.t);
  const project = await loadProject(session.project_id);
  await hit('contact:' + ipHash(request), 8, 3600);
  await verifyTurnstile(b.turnstile, clientIp(request));
  const purpose = ['callback', 'price_sheet', 'brochure_email'].includes(b.purpose) ? b.purpose : 'callback';
  let lead;
  try { lead = await captureLead(request, b, project, session, { requireEmail: purpose === 'brochure_email', purpose }); } catch (e) {
    if (e.fields) return json({ ok: false, error: 'invalid', fields: e.fields }, 400);
    throw e;
  }
  const label = { callback: 'a callback', price_sheet: 'the price sheet', brochure_email: 'the brochure by email' }[purpose];
  await note(session, project, `The visitor shared contact details through the secure form and asked for ${label}. Sales will follow up.`);
  await storeEvents(project.id, session.visitor_id, session.id, [{ type: purpose === 'callback' ? 'human_requested' : 'brochure_downloaded', props: { via: purpose } }]);
  later((async () => {
    if (purpose === 'brochure_email' && lead.email) {
      const url = originOf(request) + '/' + (project.settings?.brochure_url || 'assets/brochure/Aurelle-Residence-Brochure.pdf');
      await sendEmail({ to: lead.email, subject: `${project.name} brochure`, text: `Here is the brochure: ${url}`, html: layout({ eyebrow: project.name, title: 'Your brochure', lines: [['Download', url]], button: { href: url, label: 'Open the brochure' } }) });
    }
    if (purpose !== 'brochure_email') await createAlert({ projectId: project.id, leadId: lead.id, kind: 'human_requested', payload: { request: label, ref: session.ref_code }, dedupeHours: 1 });
    const { rescoreLead } = await import('./_lib/scoring-run.mjs');
    await rescoreLead(lead.id);
  })());
  return json({ ok: true, first_name: clean(b.name, 120).split(' ')[0] || null, purpose });
}

async function book(request) {
  const b = await readJson(request);
  const session = await loadSession(b.sid, b.t);
  const project = await loadProject(session.project_id);
  const lang = langOf(b.lang);
  await hit('book:' + ipHash(request), 6, 3600);
  await verifyTurnstile(b.turnstile, clientIp(request));
  let lead;
  if (session.lead_id && !b.phone) {
    [lead] = await db()`select * from leads where id = ${session.lead_id}`;
  } else {
    try { lead = await captureLead(request, b, project, session, { purpose: 'booking' }); } catch (e) {
      if (e.fields) return json({ ok: false, error: 'invalid', fields: e.fields }, 400);
      throw e;
    }
  }
  const existing = await activeBookingForLead(lead.id);
  if (existing) {
    // details only for the conversation that booked it; otherwise the phone number alone would reveal someone's visit
    if (existing.session_id === session.id) return json({ ok: false, error: 'already_booked', booking: bookingView(project, existing, { origin: originOf(request), lang }) }, 409);
    return json({ ok: false, error: 'already_booked_elsewhere', message: 'A visit is already booked for this number. Please use the link in your confirmation email, or talk to our team.' }, 409);
  }

  const unit = /^\d{2}-(?:[A-E]|P[1-3])$/.test(String(b.unit_code || '')) ? b.unit_code : null;
  const { booking, token, label } = await createBooking(project, { leadId: lead.id, sessionId: session.id, kind: b.kind === 'video_call' ? 'video_call' : 'site_visit', startsAt: b.starts_at, unitCode: unit, createdVia: 'chat', lang });
  await note(session, project, `The visitor booked a ${booking.kind === 'video_call' ? 'video call' : 'site visit'} for ${label}${unit ? ` (residence ${unit})` : ''}. A confirmation was sent.`);
  await storeEvents(project.id, session.visitor_id, session.id, [{ type: 'booking_created', props: { kind: booking.kind, unit: unit || '' } }]);
  await audit({ projectId: project.id, action: 'booking.created', entity: 'booking', entityId: booking.id, diff: { starts_at: booking.starts_at, kind: booking.kind }, ipHash: ipHash(request) });
  const origin = originOf(request);
  later((async () => {
    await notifyBooking(project, booking, lead, { event: 'created', origin, token, lang });
    const { summarizeSession } = await import('./_lib/summarize.mjs');
    const summary = await summarizeSession(session.id, { force: true }).catch((e) => { console.error(e); return null; });
    if (!summary) { const { rescoreLead } = await import('./_lib/scoring-run.mjs'); await rescoreLead(lead.id); }
  })());
  return json({ ok: true, booking: bookingView(project, booking, { origin, token, lang }), token, first_name: clean(b.name, 120).split(' ')[0] || null });
}

async function manageGet(request) {
  const booking = await findByToken(q(request, 'b'), q(request, 't'));
  const project = await loadProject(booking.project_id);
  const lang = langOf(q(request, 'lang'));
  const view = bookingView(project, booking, { origin: originOf(request), token: q(request, 't'), lang });
  const days = ['confirmed', 'reminded'].includes(booking.status) ? await loadSlots(project, booking.kind, { lang, excludeBookingId: booking.id }) : [];
  const c = project.settings?.contact || {};
  return json({ ok: true, project: { name: project.name, whatsapp: c.whatsapp, phone: c.phone }, booking: view, days });
}

async function managePost(request) {
  const b = await readJson(request);
  const booking = await findByToken(b.b, b.t);
  const project = await loadProject(booking.project_id);
  const lang = langOf(b.lang);
  await hit('manage:' + booking.id, 10, 3600);
  const [lead] = await db()`select * from leads where id = ${booking.lead_id}`;
  const origin = originOf(request);
  let result;
  if (b.action === 'cancel') {
    const row = await cancel(booking);
    await audit({ projectId: project.id, action: 'booking.cancelled', entity: 'booking', entityId: booking.id, diff: { by: 'visitor' }, ipHash: ipHash(request) });
    later(notifyBooking(project, row, lead, { event: 'cancelled', origin, token: b.t, lang }).then(() => import('./_lib/scoring-run.mjs')).then((m) => m.rescoreLead(lead.id)));
    result = row;
  } else if (b.action === 'reschedule') {
    const r = await reschedule(project, booking, { startsAt: b.starts_at, lang });
    await audit({ projectId: project.id, action: 'booking.rescheduled', entity: 'booking', entityId: r.booking.id, diff: { from: booking.starts_at, to: r.booking.starts_at, by: 'visitor' }, ipHash: ipHash(request) });
    later(notifyBooking(project, r.booking, lead, { event: 'rescheduled', origin, token: b.t, lang }));
    result = r.booking;
  } else throw new HttpError(400, 'bad_action');
  return json({ ok: true, booking: bookingView(project, result, { origin, token: b.t, lang }) });
}

async function ics(request) {
  const booking = await findByToken(q(request, 'b'), q(request, 't'));
  const project = await loadProject(booking.project_id);
  const [lead] = await db()`select name, email from leads where id = ${booking.lead_id}`;
  const body = icsFor(project, booking, lead, { origin: originOf(request), token: q(request, 't'), method: booking.status === 'cancelled' ? 'CANCEL' : 'REQUEST' });
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="visit.ics"', 'Cache-Control': 'no-store' } });
}
