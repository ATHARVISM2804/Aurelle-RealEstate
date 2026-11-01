import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNumbers, normalizeDigits, checkSentence, buildAllowed, SentenceGuard, SAFE_LINES } from '../api/_lib/chat/guardrail.mjs';

const unitCodeRe = /\b(?:0[1-9]|1[0-6])-(?:[A-E]|P[1-3])\b/;
const pending = [
  { topic: 'payment_plan', keywords: ['payment plan', 'installment', 'down payment'] },
  { topic: 'handover', keywords: ['handover', 'completion', 'possession'] },
];
const forbidden = ['roi', 'rental yield', 'guaranteed', 'discount', 'capital appreciation'];

function ctx(toolOutputs = [], extra = {}) {
  return {
    allowed: buildAllowed({
      factNumbers: [16, 76, 3.65, 5, 12, 25, 10, 19, 673, 3356],
      factTexts: ['The sales gallery is open daily from 10:00 to 19:00.'],
      toolOutputs, now: new Date('2026-11-01T10:00:00Z'),
    }),
    unitCodeRe, pending, forbidden, phones: ['+971 4 000 0000', '971500000000'], ...extra,
  };
}

const unitTool = { units: [{ code: '04-A', level: 4, price_from: 2434600, price_display: 'From AED 2.43M', areas_sqft: { apartment: 1084.4, balcony: 96.2, total: 1180.6 } }] };
const ok = (s, c = ctx([unitTool])) => assert.equal(checkSentence(s, c).ok, true, `${s} -> ${checkSentence(s, c).reasons}`);
const bad = (s, c = ctx([unitTool])) => assert.equal(checkSentence(s, c).ok, false, `${s} should be blocked`);

test('digit normalisation (Arabic-Indic, Persian, Devanagari)', () => {
  assert.equal(normalizeDigits('١٢٣٫٥'), '123.5');
  assert.equal(normalizeDigits('۴۵'), '45');
  assert.equal(normalizeDigits('२,४३,०००'), '2,43,000');
});

test('classification', () => {
  const c = (s) => extractNumbers(s, { unitCodeRe }).numbers.map((n) => [n.cls, n.value]);
  assert.deepEqual(c('AED 1.25M'), [['money', 1250000]]);
  assert.deepEqual(c('from 2.43 million'), [['money', 2430000]]);
  assert.deepEqual(c('₹1.5 crore'), [['money', 15000000]]);
  assert.deepEqual(c('45 lakh rupees'), [['money', 4500000]]);
  assert.deepEqual(c('Dh 900k'), [['money', 900000]]);
  assert.deepEqual(c('2,434,600'), [['money', 2434600]]);
  assert.deepEqual(c('8% ROI'), [['percent', 8]]);
  assert.deepEqual(c('1,180.6 sq ft'), [['area', 1180.6]]);
  assert.deepEqual(c('3.65 m ceilings'), [['length', 3.65]]);
  assert.deepEqual(c('handover in Q4 2027'), [['count', 4], ['year', 2027]]);
  assert.deepEqual(c('unit 08-C on level 8'), [['count', 8]]);
  assert.deepEqual(c('AED 1.25 m'), [['money', 1250000]]);
  assert.deepEqual(c('٢٫٤٣ مليون درهم'), [['money', 2430000]]);
  assert.deepEqual(c('२.४३ मिलियन'), [['money', 2430000]]);
});

test('prices from tool results pass, within 0.5%', () => {
  ok('Unit 04-A starts from AED 2.43M.');
  ok('That is roughly AED 2,434,600.');
  ok('It is about 2.43 million dirhams.');
  ok('٢٫٤٣ مليون درهم');
});

test('invented or echoed prices are blocked', () => {
  bad('You could get it for AED 1.9M.');
  bad('Yes, AED 900k is right.');
  bad('Prices start at AED 1.25M.', ctx([]));
  bad('It is ₹4.5 crore.');
  bad('That works out to 45 lakh.');
});

test('percentages and yields are blocked', () => {
  bad('Expect an 8% rental return.');
  bad('Service charges are 15 per cent lower.');
});

test('areas: tool and facts pass, invented fail', () => {
  ok('Total area is 1,180.6 sq ft including a 96.2 sq ft balcony.');
  ok('Homes range up to about 3,356 sq ft.');
  bad('It is 1,500 sq ft.');
});

test('facts: counts, lengths, minutes and gallery hours pass', () => {
  ok('Aurelle has 16 levels and 76 residences.');
  ok('Ceilings are 3.65 m high.');
  ok('The Metro is about 5 minutes away and the airport about 25 minutes.');
  ok('The gallery is open from 10:00 to 19:00.');
  ok('It is open 10am to 7pm daily.');
  bad('Ceilings are 4.2 m high.');
  bad('It is 40 minutes from Downtown.');
  bad('The gallery opens at 08:30.');
});

test('small counts, unit codes and contact numbers are fine', () => {
  ok('There are 3 options on high floors, like 14-B and 12-D.');
  ok('Call us on +971 4 000 0000.');
  bad('Call us on +971 55 123 9876.');
});

test('years: current year fine, invented completion year blocked', () => {
  ok('We are booking visits throughout 2026.');
  bad('Handover is expected in Q4 2027.');
  bad('Completion by 2028.');
});

test('forbidden claims blocked unless negated', () => {
  bad('This is a guaranteed investment.');
  bad('Capital appreciation here is strong.');
  ok("I can't comment on ROI or rental yield, but a consultant can help.");
  bad('There is a launch discount this week.');
});

test('pending topics: commitments blocked, deflection allowed', () => {
  bad('The payment plan is 60/40.');
  bad('Handover will be next year.');
  ok('A consultant will share the current payment plan with you.');
  ok("I don't have the handover date yet; a consultant can confirm it.");
});

test('slot times from the booking tool pass', () => {
  const c = ctx([{ earliest_label: 'Tue 3 Nov, 11:00', days: [{ label: 'Wed 4 Nov', slots: [{ label: '14:15' }] }] }]);
  ok('The earliest slot is Tue 3 Nov at 11:00.', c);
  ok('Wednesday 4 Nov at 14:15 is also free.', c);
  bad('How about 16:45?', c);
});

test('SentenceGuard handles sentences split across deltas', () => {
  const g = new SentenceGuard(ctx([unitTool]), 'en');
  let out = '';
  for (const d of ['Unit 04-A', ' starts from AED 2.', '43M. It has ', '16 levels', ' above. Guaranteed ret', 'urns of 9% too.', ' Book a visit?']) out += g.push(d);
  out += g.end();
  assert.match(out, /Unit 04-A starts from AED 2\.43M\./);
  assert.match(out, new RegExp(SAFE_LINES.en.slice(0, 20)));
  assert.doesNotMatch(out, /9%/);
  assert.doesNotMatch(out, /Guaranteed/);
  assert.match(out, /Book a visit\?$/);
  assert.equal(g.violations.length, 1);
});

test('SentenceGuard uses one safe line for several violations and localises it', () => {
  const g = new SentenceGuard(ctx([]), 'ar');
  let out = g.push('السعر ١٫٥ مليون درهم. ') + g.push('العائد ٨٪. ') + g.end();
  assert.equal(out.split(SAFE_LINES.ar).length - 1, 1);
  assert.equal(g.violations.length, 2);
});

test('thin / no-break space thousands separators and no-break hyphens (as models write them)', () => {
  const c = ctx([{ units: [{ code: '15-P1', areas_sqft: { total: 3356.4 } }, { code: '16-P2', areas_sqft: { total: 1191.2 } }] }]);
  ok('- 15‑P1 : 4 BHK पेंटहाउस, 3 356 sq ft', c);
  ok('16‑P2 has 1 191 sq ft.', c);
  bad('It is 2 900 sq ft.', c);
  ok('Call us on +971 4 000 0000.');
});

test('amounts written in words are blocked', () => {
  bad('Prices start from two point five million dirhams.');
  bad('Expect around eight percent each year.');
  bad('Most homes sell for a few crore.');
  ok('Unit 04-A starts from AED 2.43M.');
});

test('negation only counts when it governs the claim', () => {
  bad("Don't miss our guaranteed discount this week.");
  bad('No hidden fees, and capital appreciation here is strong.');
  ok("I can't comment on ROI, but a consultant can.");
  ok('We never promise a rental yield.');
});

test("the visitor's own numbers never vouch for sizes or lengths", () => {
  const c = { ...ctx([]) };
  c.allowed = buildAllowed({ factNumbers: [16, 76], extra: [1500, 42], now: new Date('2026-11-01T10:00:00Z') });
  bad('The unit is 1500 sq ft.', c);
  bad('Ceilings are 42 m.', c);
  ok('You mentioned 42 guests — the social terrace suits that.', c);
});

test('long runs without punctuation are still checked', () => {
  const g = new SentenceGuard(ctx([]), 'en');
  const long = 'word '.repeat(70) + 'AED 3M ' + 'more '.repeat(10);
  const out = g.push(long) + g.end();
  assert.doesNotMatch(out, /AED 3M/);
});
