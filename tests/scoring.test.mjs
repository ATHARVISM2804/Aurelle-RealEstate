import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, plansFor, timelineMonths } from '../api/_lib/scoring.mjs';

const stock = { cheapestByPlan: { oneBhk: 1265000, oneBhkStudy: 1480000, twoBhk: 2350000, threeBhk: 7700000, fourBhk: 10000000 }, cheapestOverall: 1265000 };

test('helpers', () => {
  assert.deepEqual(plansFor('2 BHK + Maid Room'), ['twoBhk']);
  assert.deepEqual(plansFor('1 BHK + Study'), ['oneBhkStudy']);
  assert.deepEqual(plansFor('penthouse'), ['threeBhk', 'fourBhk']);
  assert.equal(timelineMonths('within 3 months'), 2);
  assert.equal(timelineMonths('next year'), 18);
  assert.equal(timelineMonths('4 months'), 4);
  assert.equal(timelineMonths('unknown'), null);
});

test('anonymous browser with nothing known is cold', () => {
  const r = score({ ...stock });
  assert.equal(r.band, 'cold');
  assert.equal(r.score, 0);
});

test('a booked visit is hot at minimum, whatever the points', () => {
  const r = score({ ...stock, booking: { active: true } });
  assert.equal(r.band, 'hot');
  assert.ok(r.reasons.for.some((x) => x.key === 'visit_booked'));
});

test('strong fit + intent + reachability crosses the hot line on points alone', () => {
  const r = score({
    ...stock, budget: { min: 2e6, max: 3e6 }, configuration: '2 BHK', financing: 'cash', timeline: 'within 3 months',
    unitsOpened: [{ code: '12-A', sessions: 2 }], priceSeen: true, phone: true, email: true, consents: { whatsapp: true, call: true },
  });
  assert.equal(r.groups.fit, 30);
  assert.equal(r.groups.reach, 20);
  assert.ok(r.score >= 70, String(r.score));
  assert.equal(r.band, 'hot');
  assert.equal(r.reasons.for.length, 3);
  assert.equal(r.reasons.for[0].key, 'budget_fits');
});

test('warm band boundaries', () => {
  const r = score({ ...stock, budget: { min: 2e6, max: 3e6 }, configuration: '2 BHK', phone: true, email: true, consents: { whatsapp: true } });
  assert.equal(r.score, 41);
  assert.equal(r.band, 'warm');
});

test('budget below the cheapest home is a reason against', () => {
  const r = score({ ...stock, budget: { min: 5e5, max: 8e5 }, phone: true });
  assert.ok(r.reasons.against.some((x) => x.key === 'budget_low'));
  assert.equal(r.groups.fit, -15);
  assert.equal(r.band, 'cold');
});

test('budget just short of the configuration still counts as close', () => {
  const r = score({ ...stock, budget: { max: 2.2e6 }, configuration: '2 BHK' });
  assert.ok(r.all.some((x) => x.key === 'budget_close'));
});

test('caps per group and overall clamp to 0..100', () => {
  const r = score({
    ...stock, booking: { active: true, attended: true }, timeline: 'asap', unitsOpened: [{ code: 'a', sessions: 3 }], priceSeen: true, brochure: true,
    sessions7d: 4, humanRequested: true, askedTerms: true, budget: { max: 9e6 }, configuration: '2 BHK', financing: 'cash', phone: true, email: true, consents: { whatsapp: true, call: true },
  });
  assert.equal(r.groups.intent, 45);
  assert.equal(r.groups.fit, 30);
  assert.equal(r.score, 95);
});

test('brokers are routed out of scoring', () => {
  const r = score({ ...stock, isBroker: true, booking: { active: true } });
  assert.equal(r.broker, true);
  assert.equal(r.band, 'cold');
});

test('invalid contact details pull the score down', () => {
  const r = score({ ...stock, invalidContact: true, phone: true });
  assert.equal(r.groups.reach, -30);
});

test('project weights override defaults', () => {
  const r = score({ ...stock, brochure: true }, { brochure: 12 });
  assert.equal(r.score, 12);
});
