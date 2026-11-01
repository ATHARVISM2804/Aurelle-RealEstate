/* Rule-based lead score. Pure. Three groups — Fit (≤35), Intent (≤45), Reachability (≤20) —
   producing 0-100, a band, and readable reasons with evidence. Weights can be overridden per
   project (projects.settings.scoring) and recalibrated against attended visits later. */

export const DEFAULT_WEIGHTS = {
  budget_fits: 20, budget_close: 8, budget_low: -15, config_available: 5, financing_ready: 5,
  visit_booked: 30, visit_attended: 10, timeline_3: 15, timeline_6: 8, timeline_long: -5,
  unit_opened: 6, unit_returned: 6, price_seen: 4, brochure: 5, repeat_sessions: 6, human_requested: 8, asked_terms: 4,
  phone: 8, email: 4, consent_whatsapp: 4, consent_call: 4, invalid_contact: -30,
};
const CAPS = { fit: 35, intent: 45, reach: 20 };
export const BANDS = { hot: 70, warm: 40 };

const PLAN_BY_BEDS = { 1: ['oneBhk', 'oneBhkStudy'], 2: ['twoBhk'], 3: ['threeBhk'], 4: ['fourBhk'] };

export function plansFor(config) {
  const s = String(config || '').toLowerCase();
  if (!s) return [];
  if (/study/.test(s)) return ['oneBhkStudy'];
  const m = s.match(/(\d)\s*(?:bhk|bed|br|bedroom)/) || s.match(/^(\d)$/);
  if (m) return PLAN_BY_BEDS[m[1]] || [];
  if (/pent/.test(s)) return ['threeBhk', 'fourBhk'];
  if (/studio/.test(s)) return ['oneBhk'];
  return [];
}

export function timelineMonths(v) {
  const s = String(v || '').toLowerCase();
  if (!s || s === 'unknown') return null;
  if (/immediate|asap|now|this month|0-3|within 3|1-3|next month|abhi|turant/.test(s)) return 2;
  if (/3-6|within 6|six months|6 months/.test(s)) return 5;
  if (/6-12|this year|within a year|12 months/.test(s)) return 9;
  if (/12\+|next year|1-2 years|later|just looking|browsing|no hurry/.test(s)) return 18;
  const n = s.match(/(\d+)\s*(month|mo|week|year)/);
  if (n) return n[2].startsWith('year') ? Number(n[1]) * 12 : n[2].startsWith('week') ? Math.max(1, Number(n[1]) / 4) : Number(n[1]);
  return null;
}

/**
 * input = {
 *   budget: {min, max, value} | null, configuration, financing, timeline,
 *   cheapestByPlan: {plan: price}, cheapestOverall,
 *   unitsOpened: [{code, sessions}], priceSeen, brochure, sessions7d, humanRequested, askedTerms,
 *   booking: {active, attended}, phone, email, consents: {whatsapp, call}, invalidContact, isBroker
 * }
 */
export function score(input, weights = {}) {
  const W = { ...DEFAULT_WEIGHTS, ...weights };
  const reasons = [];
  const add = (group, key, label, evidence) => { const points = W[key]; if (points) reasons.push({ group, key, label, points, evidence }); };

  if (input.isBroker) {
    return { score: 0, band: 'cold', groups: { fit: 0, intent: 0, reach: 0 }, reasons: { for: [], against: [{ group: 'fit', key: 'broker', label: 'Identified as a broker or channel partner', points: 0 }] }, broker: true };
  }

  // Fit
  const plans = plansFor(input.configuration);
  const budgetTop = input.budget?.max ?? input.budget?.min ?? null;
  const target = plans.length ? Math.min(...plans.map((p) => input.cheapestByPlan?.[p]).filter(Boolean)) : input.cheapestOverall;
  if (budgetTop && Number.isFinite(target)) {
    if (budgetTop >= target) add('fit', 'budget_fits', 'Budget covers an available home', input.budget.evidence);
    else if (budgetTop >= target * 0.9) add('fit', 'budget_close', 'Budget within 10% of an available home', input.budget.evidence);
    else if (input.cheapestOverall && budgetTop < input.cheapestOverall * 0.8) add('fit', 'budget_low', 'Budget below the cheapest available home', input.budget.evidence);
  }
  if (plans.length && plans.some((p) => input.cheapestByPlan?.[p])) add('fit', 'config_available', `${input.configuration} is available`);
  if (/cash|pre-?approved|approved/i.test(String(input.financing || ''))) add('fit', 'financing_ready', 'Cash or pre-approved finance');

  // Intent
  if (input.booking?.active || input.booking?.attended) add('intent', 'visit_booked', 'Booked a visit');
  if (input.booking?.attended) add('intent', 'visit_attended', 'Attended the visit');
  const months = timelineMonths(input.timeline);
  if (months != null) {
    if (months <= 3) add('intent', 'timeline_3', 'Wants to buy within 3 months');
    else if (months <= 6) add('intent', 'timeline_6', 'Wants to buy within 6 months');
    else if (months > 12) add('intent', 'timeline_long', 'Buying more than a year out');
  }
  const opened = input.unitsOpened || [];
  if (opened.length) add('intent', 'unit_opened', `Explored ${opened.slice(0, 2).map((u) => u.code).join(', ')}${opened.length > 2 ? ` +${opened.length - 2}` : ''} in 3D`);
  if (opened.some((u) => u.sessions > 1)) add('intent', 'unit_returned', `Came back to ${opened.find((u) => u.sessions > 1).code}`);
  if (input.priceSeen) add('intent', 'price_seen', 'Looked at prices');
  if (input.brochure) add('intent', 'brochure', 'Downloaded the brochure');
  if ((input.sessions7d || 0) >= 2) add('intent', 'repeat_sessions', `${input.sessions7d} visits this week`);
  if (input.humanRequested) add('intent', 'human_requested', 'Asked to speak to sales');
  if (input.askedTerms) add('intent', 'asked_terms', 'Asked about payment plan or handover');

  // Reachability
  if (input.invalidContact) add('reach', 'invalid_contact', 'Contact details look invalid');
  else {
    if (input.phone) add('reach', 'phone', 'Phone number shared');
    if (input.email) add('reach', 'email', 'Email shared');
    if (input.consents?.whatsapp) add('reach', 'consent_whatsapp', 'OK to message on WhatsApp');
    if (input.consents?.call) add('reach', 'consent_call', 'OK to call');
  }

  const groups = { fit: 0, intent: 0, reach: 0 };
  for (const r of reasons) groups[r.group] += r.points;
  for (const g of Object.keys(groups)) groups[g] = Math.min(groups[g], CAPS[g]);
  let total = Math.max(0, Math.min(100, groups.fit + groups.intent + groups.reach));
  let band = total >= BANDS.hot ? 'hot' : total >= BANDS.warm ? 'warm' : 'cold';
  if (input.booking?.active || input.booking?.attended) band = 'hot';
  const sorted = [...reasons].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return {
    score: total, band, groups,
    reasons: { for: sorted.filter((r) => r.points > 0).slice(0, 3), against: sorted.filter((r) => r.points < 0).slice(0, 3) },
    all: reasons,
  };
}
