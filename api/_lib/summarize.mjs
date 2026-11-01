/* After a conversation: AI summary + extracted fields with message citations, merged into the
   lead (never overwriting a rep's edits), then a rescore. Triggered by booking, chat close, or cron. */
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { db } from './db.mjs';
import { getModel, providerOptions } from './chat/model.mjs';
import { mergeFields } from './leads.mjs';
import { rescoreLead } from './scoring-run.mjs';
import { budgetLeft, spend, costMicros } from './chat/session.mjs';

const cited = (value) => z.object({ value, evidence: z.array(z.number().int()).describe('ids from [m:ID] markers that support this') });

export const SummarySchema = z.object({
  summary: z.array(z.string()).max(3).describe('Up to three short lines for a sales rep: who, what they want, where they are in the decision'),
  one_liner: z.string().max(110).describe('One line for the inbox list'),
  budget: cited(z.object({ text: z.string().nullable(), min: z.number().nullable(), max: z.number().nullable(), currency: z.string().nullable() }).nullable()),
  configuration: cited(z.string().nullable()).describe('e.g. "2 BHK", "penthouse"'),
  unit_interest: cited(z.array(z.string()).describe('unit codes like 08-C')),
  timeline: cited(z.enum(['0-3 months', '3-6 months', '6-12 months', '12+ months', 'unknown'])),
  purpose: cited(z.enum(['end_use', 'investor', 'both', 'unknown'])),
  financing: cited(z.enum(['cash', 'mortgage_preapproved', 'needs_mortgage', 'unknown'])),
  decision_makers: cited(z.string().nullable()),
  objections: cited(z.array(z.string())),
  questions_asked: cited(z.array(z.string())),
  is_broker: cited(z.boolean()),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  language: z.string(),
  next_best_action: z.string().max(140).describe('The single best next step for the sales rep'),
});

export async function summarizeSession(sessionId, { force = false } = {}) {
  const sql = db();
  const [s] = await sql`select * from chat_sessions where id = ${sessionId}`;
  if (!s) return null;
  if (!force && s.summarized_at && new Date(s.summarized_at) >= new Date(s.last_message_at)) return null;
  const msgs = await sql`select id, role, content, content_redacted, cards from messages where session_id = ${sessionId} and role in ('user','assistant','note','agent') order by id`;
  if (msgs.filter((m) => m.role === 'user').length < 2 && !force) return null;

  const transcript = msgs.map((m) => {
    const text = m.role === 'user' ? (m.content_redacted ?? m.content) : m.content;
    const shown = (m.cards || []).map((c) => c.kind === 'unit' ? `unit card ${c.data?.code}` : c.kind === 'units' ? `units ${(c.data?.units || []).map((u) => u.code).join(',')}` : c.kind).join('; ');
    return `[m:${m.id}] ${m.role === 'user' ? 'visitor' : m.role}: ${text}${shown ? ` (shown: ${shown})` : ''}`;
  }).join('\n');
  const ids = new Set(msgs.map((m) => Number(m.id)));

  const spec = process.env.SUMMARY_MODEL || process.env.CHAT_MODEL || 'groq:openai/gpt-oss-120b';
  let data;
  if (spec.startsWith('mock:')) data = heuristicSummary(msgs);
  else {
    if ((await budgetLeft()) <= 0) return null;                 // summaries share the daily AI budget
    const { model, provider } = await getModel(spec);
    const { output, usage } = await generateText({
      model, output: Output.object({ schema: SummarySchema }), temperature: 0,
      providerOptions: providerOptions(provider),
      instructions: 'You summarise a real-estate website chat for the sales team. Use only what the transcript says; use null, "unknown" or [] when not stated. Cite message ids from the [m:ID] markers as evidence. A visitor who says they are an agent, broker or channel partner is_broker=true. Budgets: convert to numbers in the stated currency (e.g. "2-3M AED" -> min 2000000, max 3000000).',
      prompt: transcript,
    });
    data = output;
    await spend(costMicros(usage || {}));
  }
  data = dropBadCitations(data, ids);

  await sql`insert into summaries(lead_id, session_id, model, data) values (${s.lead_id}, ${sessionId}, ${spec}, ${JSON.stringify(data)})`;
  await sql`update chat_sessions set summarized_at = now() where id = ${sessionId}`;
  if (s.lead_id) {
    await applyToLead(s.lead_id, data);
    await rescoreLead(s.lead_id);
  }
  return data;
}

export function dropBadCitations(data, ids) {
  const out = { ...data };
  for (const [k, v] of Object.entries(out)) {
    if (v && typeof v === 'object' && Array.isArray(v.evidence)) out[k] = { ...v, evidence: v.evidence.filter((id) => ids.has(Number(id))) };
  }
  return out;
}

export async function applyToLead(leadId, d) {
  const sql = db();
  const [lead] = await sql`select fields from leads where id = ${leadId}`;
  const val = (x) => (x && x.value != null && !(Array.isArray(x.value) && !x.value.length) && x.value !== 'unknown' ? x : null);
  const patch = {
    budget: d.budget?.value ? { value: d.budget.value.text || null, min: d.budget.value.min, max: d.budget.value.max, currency: d.budget.value.currency, evidence: d.budget.evidence } : null,
    configuration: val(d.configuration), unit_interest: val(d.unit_interest), timeline: val(d.timeline), purpose: val(d.purpose),
    financing: val(d.financing), decision_makers: val(d.decision_makers), objections: val(d.objections), questions_asked: val(d.questions_asked),
    is_broker: d.is_broker?.value ? d.is_broker : null,
    sentiment: d.sentiment ? { value: d.sentiment } : null,
  };
  const fields = mergeFields(lead.fields, patch, 'ai');
  await sql`update leads set fields = ${JSON.stringify(fields)}, one_liner = ${d.one_liner || d.summary?.[0] || null},
      next_action = ${d.next_best_action || null}, lang = coalesce(lang, ${d.language || null}),
      is_broker = is_broker or ${Boolean(d.is_broker?.value)}
    where id = ${leadId}`;
}

/* Deterministic stand-in used with the mock model in local development. */
function heuristicSummary(msgs) {
  const user = msgs.filter((m) => m.role === 'user');
  const text = user.map((m) => m.content).join(' ');
  const find = (re) => user.filter((m) => re.test(m.content)).map((m) => Number(m.id));
  const beds = text.match(/(\d)\s*(?:bed|bhk|br)/i);
  const units = [...new Set(text.match(/\b\d{2}-(?:[A-E]|P[1-3])\b/gi) || [])].map((u) => u.toUpperCase());
  const budget = text.match(/(\d+(?:\.\d+)?)\s*(m|million|k)\b/i);
  const bud = budget ? Number(budget[1]) * (/k/i.test(budget[2]) ? 1e3 : 1e6) : null;
  const visit = find(/visit|book/i);
  return {
    summary: [`Visitor asked about ${beds ? beds[1] + '-bedroom homes' : 'the residences'}${units.length ? ' and ' + units.join(', ') : ''}.`, visit.length ? 'Interested in a site visit.' : 'Still exploring.'],
    one_liner: `${beds ? beds[1] + ' BHK' : 'Residences'}${units.length ? ' · ' + units[0] : ''}${visit.length ? ' · wants a visit' : ''}`,
    budget: { value: bud ? { text: budget[0], min: null, max: bud, currency: 'AED' } : null, evidence: bud ? find(/\d+(?:\.\d+)?\s*(m|million|k)\b/i) : [] },
    configuration: { value: beds ? `${beds[1]} BHK` : null, evidence: beds ? find(/(\d)\s*(?:bed|bhk|br)/i) : [] },
    unit_interest: { value: units, evidence: find(/\b\d{2}-(?:[A-E]|P[1-3])\b/i) },
    timeline: { value: /soon|asap|this month|3 months/i.test(text) ? '0-3 months' : 'unknown', evidence: find(/soon|asap|this month|3 months/i) },
    purpose: { value: /invest|rental|yield|roi/i.test(text) ? 'investor' : /family|live|move/i.test(text) ? 'end_use' : 'unknown', evidence: find(/invest|rental|family|live|move/i) },
    financing: { value: /cash/i.test(text) ? 'cash' : /mortgage|loan/i.test(text) ? 'needs_mortgage' : 'unknown', evidence: find(/cash|mortgage|loan/i) },
    decision_makers: { value: /wife|husband|family|partner/i.test(text) ? 'With family' : null, evidence: find(/wife|husband|family|partner/i) },
    objections: { value: /expensive|too much|far/i.test(text) ? ['Price or distance concern'] : [], evidence: find(/expensive|too much|far/i) },
    questions_asked: { value: user.filter((m) => /\?/.test(m.content)).map((m) => m.content.slice(0, 80)).slice(0, 5), evidence: find(/\?/) },
    is_broker: { value: /\b(i am|i'm) (a |an )?(broker|agent)\b|channel partner|my commission/i.test(text), evidence: find(/broker|channel partner|commission/i) },
    sentiment: 'neutral', language: 'en',
    next_best_action: visit.length ? 'Confirm the visit on WhatsApp and share directions.' : 'Send the floor plans on WhatsApp and offer a visit.',
  };
}
