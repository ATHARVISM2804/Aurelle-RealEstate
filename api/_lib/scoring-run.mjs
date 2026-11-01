/* Gather a lead's signals from the database, score them, store history, alert on a move to hot. */
import { createHash } from 'node:crypto';
import { db } from './db.mjs';
import { score } from './scoring.mjs';
import { createAlert } from './alerts.mjs';

export async function scoringInputs(lead) {
  const sql = db();
  const [cheap, units, evts, bookings, consents, visitors] = await Promise.all([
    sql`select plan, min(price_from)::float as price from units where project_id = ${lead.project_id} and status = 'available' group by plan`,
    sql`select (e.props->>'code') as code, count(distinct date_trunc('day', e.at))::int as sessions
        from events e join visitors v on v.id = e.visitor_id
        where v.lead_id = ${lead.id} and e.type in ('unit_opened','unit_card_3d') and e.props->>'code' is not null
        group by 1 order by 2 desc, 1 limit 10`,
    sql`select e.type, count(*)::int as n from events e join visitors v on v.id = e.visitor_id
        where v.lead_id = ${lead.id} group by e.type`,
    sql`select status, starts_at from bookings where lead_id = ${lead.id} and status not in ('cancelled','rescheduled')`,
    sql`select distinct on (purpose) purpose, granted from consents where lead_id = ${lead.id} order by purpose, created_at desc`,
    sql`select max(sessions_7d)::int as s7 from visitors where lead_id = ${lead.id}`,
  ]);
  const count = Object.fromEntries(evts.map((e) => [e.type, e.n]));
  const f = lead.fields || {};
  const cheapestByPlan = Object.fromEntries(cheap.map((c) => [c.plan, c.price]));
  const questions = [].concat(f.questions_asked?.value || []).join(' ').toLowerCase();
  return {
    budget: f.budget ? { min: num(f.budget.min), max: num(f.budget.max ?? f.budget.min), value: f.budget.value, evidence: f.budget.evidence } : null,
    configuration: f.configuration?.value || [].concat(f.unit_interest?.value || [])[0] || null,
    financing: f.financing?.value || null,
    timeline: f.timeline?.value || null,
    cheapestByPlan, cheapestOverall: cheap.length ? Math.min(...cheap.map((c) => c.price)) : null,
    unitsOpened: units,
    priceSeen: Boolean(count.price_shown),
    brochure: Boolean(count.brochure_downloaded),
    sessions7d: visitors[0]?.s7 || 0,
    humanRequested: Boolean(count.human_requested),
    askedTerms: /payment|instal|handover|completion|possession/.test(questions),
    booking: {
      active: bookings.some((b) => ['confirmed', 'reminded', 'checked_in'].includes(b.status)),
      attended: bookings.some((b) => ['done', 'checked_in'].includes(b.status)),
    },
    phone: Boolean(lead.phone_e164), email: Boolean(lead.email),
    consents: Object.fromEntries(consents.map((c) => [c.purpose, c.granted])),
    invalidContact: Boolean(f.invalid_contact?.value),
    isBroker: Boolean(lead.is_broker || f.is_broker?.value === true),
  };
}

const num = (v) => (v == null || v === '' ? null : Number(v));

export async function rescoreLead(leadId) {
  const sql = db();
  const [lead] = await sql`select l.*, p.settings from leads l join projects p on p.id = l.project_id where l.id = ${leadId}`;
  if (!lead) return null;
  const inputs = await scoringInputs(lead);
  const r = score(inputs, lead.settings?.scoring || {});
  const hash = createHash('sha1').update(JSON.stringify([r.score, r.band, r.reasons])).digest('hex').slice(0, 16);
  const reasons = { for: r.reasons.for, against: r.reasons.against, groups: r.groups, broker: Boolean(r.broker) };
  await sql`update leads set score = ${r.score}, band = ${r.band}, score_reasons = ${JSON.stringify(reasons)},
      is_broker = ${Boolean(r.broker) || lead.is_broker} where id = ${leadId}`;
  const [last] = await sql`select inputs_hash from lead_scores where lead_id = ${leadId} order by created_at desc limit 1`;
  if (last?.inputs_hash !== hash) {
    await sql`insert into lead_scores(lead_id, score, band, fit, intent, reach, reasons, inputs_hash)
      values (${leadId}, ${r.score}, ${r.band}, ${r.groups.fit}, ${r.groups.intent}, ${r.groups.reach}, ${JSON.stringify(reasons)}, ${hash})`;
  }
  if (r.band === 'hot' && lead.band !== 'hot') {
    await createAlert({ projectId: lead.project_id, leadId, kind: 'hot_lead', payload: { why: r.reasons.for.map((x) => x.label).join(' · ') }, dedupeHours: 24 }).catch((e) => console.error(e));
  }
  return r;
}
