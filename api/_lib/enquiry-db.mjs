/* The enquiry form's database path (called from the CommonJS api/enquiry.js). */
import { createHash } from 'node:crypto';
import { loadProject } from './project.mjs';
import { parseFormPhone } from './phone.mjs';
import { ensureVisitor, upsertLead, linkVisitor, recordConsents, storeEvents, audit } from './leads.mjs';
import { hit } from './ratelimit.mjs';
import { clean, tokenSecret } from './http.mjs';

const BUDGETS = { '1-2M': [1e6, 2e6], '2-3M': [2e6, 3e6], '3-5M': [3e6, 5e6], '5-8M': [5e6, 8e6], '8M+': [8e6, null] };

export async function saveEnquiry(b, lead, req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'local';
  const ipHash = createHash('sha256').update(tokenSecret() + '|' + ip).digest('base64url').slice(0, 22);
  await hit('enq:' + ipHash, 10, 3600);

  const project = await loadProject(clean(b.project, 60) || 'aurelle');
  const phone = parseFormPhone(lead.phone);
  if (!phone) throw new Error('invalid phone');

  const attribution = { first: b.attribution?.first || pickUtm(lead), last: b.attribution?.last || pickUtm(lead) };
  const visitor = b.anon_id ? await ensureVisitor(project.id, b.anon_id, { firstTouch: attribution.first, lastTouch: attribution.last }) : null;

  const budgetNorm = lead.budget.replace(/[‒-―]/g, '-').replace(/\s/g, '').toUpperCase();
  const budgetKey = Object.keys(BUDGETS).find((k) => budgetNorm.endsWith(k.toUpperCase()));
  const fields = {
    unit_interest: lead.unit ? { value: [lead.unit] } : null,
    budget: budgetKey ? { value: lead.budget, min: BUDGETS[budgetKey][0], max: BUDGETS[budgetKey][1], currency: project.currency } : (lead.budget ? { value: lead.budget } : null),
    preferred_contact: lead.contact || null,
    enquiry_message: lead.message || null,
  };
  const { lead: row, created } = await upsertLead(project, { name: lead.name, phone, email: lead.email, attribution, fields, fieldSource: 'form' });

  if (visitor) {
    await linkVisitor(row.id, visitor.id);
    await storeEvents(project.id, visitor.id, null, [{ type: 'enquiry_submitted', props: { kind: lead.type, unit: lead.unit }, url: lead.page, at: lead.at }, ...(Array.isArray(b.events) ? b.events : [])]);
  }
  // the form has one consent box covering contact about this project
  const granted = b.consent === true;   // the form's box is required; a missing value is not consent
  await recordConsents(project.id, {
    leadId: row.id, visitorId: visitor?.id, source: 'form', ipHash, textVersion: clean(b.consent_version, 40) || 'form-v1',
    consents: { call: granted, whatsapp: granted, email: granted }, texts: { all: b.consent_text || 'I agree to be contacted by the developer about this project.' },
  });
  await audit({ projectId: project.id, action: created ? 'lead.created' : 'lead.enquiry', entity: 'lead', entityId: row.id, diff: { type: lead.type, unit: lead.unit }, ipHash });

  // scoring hook (added in the scoring phase)
  try { const m = await import('./scoring-run.mjs'); await m.rescoreLead(row.id); } catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') console.error(e); }
  return row;
}

const pickUtm = (l) => Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign'].filter((k) => l[k]).map((k) => [k, l[k]]));
