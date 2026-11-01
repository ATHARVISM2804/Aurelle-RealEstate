/* Alerts for the sales team: stored for the dashboard, emailed to the owner or the sales inbox. */
import { db } from './db.mjs';
import { sendEmail, salesInbox, layout } from './email.mjs';

const TITLES = {
  hot_lead: 'New hot lead',
  human_requested: 'A visitor asked for a person',
  booking: 'New visit booked',
  booking_changed: 'Visit changed',
  no_show: 'Visitor did not show',
  cap: 'Assistant spend cap reached',
};

/* dedupeHours: skip if the same kind of alert exists for this lead within the window. */
export async function createAlert({ projectId, leadId = null, kind, payload = {}, dedupeHours = 0, email = true }) {
  const sql = db();
  if (dedupeHours && leadId) {
    const [dup] = await sql`select id from alerts where lead_id = ${leadId} and kind = ${kind} and created_at > now() - make_interval(hours => ${dedupeHours})`;
    if (dup) return null;
  }
  const [a] = await sql`insert into alerts(project_id, lead_id, kind, payload) values (${projectId}, ${leadId}, ${kind}, ${JSON.stringify(payload)}) returning *`;
  if (email) await emailAlert(a).catch((e) => console.error('alert email failed', e));
  return a;
}

async function emailAlert(a) {
  const sql = db();
  let to = [];
  let lead = null;
  if (a.lead_id) {
    [lead] = await sql`select l.name, l.phone_e164, l.band, l.score, l.one_liner, u.email as owner_email
      from leads l left join users u on u.id = l.owner_id where l.id = ${a.lead_id}`;
    if (lead?.owner_email) to = [lead.owner_email];
  }
  if (!to.length) {
    const [p] = await sql`select settings from projects where id = ${a.project_id}`;
    to = p?.settings?.contact?.sales_emails?.length ? p.settings.contact.sales_emails : salesInbox();
  }
  if (!to.length) return;
  const origin = (process.env.APP_ORIGIN || '').split(',')[0];
  const lines = [];
  if (lead) {
    if (lead.name) lines.push(['Lead', lead.name]);
    if (lead.phone_e164) lines.push(['Phone', lead.phone_e164]);
    lines.push(['Score', `${lead.band} · ${lead.score}`]);
    if (lead.one_liner) lines.push(['Summary', lead.one_liner]);
  }
  for (const [k, v] of Object.entries(a.payload || {})) if (typeof v === 'string' && v) lines.push([k.replace(/_/g, ' '), v]);
  const title = TITLES[a.kind] || 'Alert';
  await sendEmail({
    to, subject: `${title}${lead?.name ? ': ' + lead.name : ''}`,
    text: lines.map(([k, v]) => `${k}: ${v}`).join('\n') + (a.lead_id && origin ? `\n\nOpen: ${origin}/dashboard/leads/${a.lead_id}` : ''),
    html: layout({ eyebrow: 'Sales alert', title, lines, button: a.lead_id && origin ? { href: `${origin}/dashboard/leads/${a.lead_id}`, label: 'Open lead' } : null }),
  });
  await sql`update alerts set emailed_at = now() where id = ${a.id}`;
}
