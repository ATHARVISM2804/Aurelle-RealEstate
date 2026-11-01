/* Database tests: run against a disposable database only.
   TEST_DATABASE_URL=postgres://... DATABASE_DRIVER=pg node --test tests/db/
   (migrate + seed that database first). Skipped when TEST_DATABASE_URL is not set. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
const skip = !url && 'TEST_DATABASE_URL not set';

let db, loadProject, createBooking, loadSlots, upsertLead, project;
before(async () => {
  if (skip) return;
  process.env.DATABASE_URL = url;
  process.env.DATABASE_DRIVER ||= 'pg';
  ({ db } = await import('../../api/_lib/db.mjs'));
  ({ loadProject } = await import('../../api/_lib/project.mjs'));
  ({ createBooking, loadSlots } = await import('../../api/_lib/bookings.mjs'));
  ({ upsertLead } = await import('../../api/_lib/leads.mjs'));
  project = await loadProject('aurelle');
});
after(async () => { if (!skip) await db().end?.(); });

test('five buyers racing for one slot with capacity 2: exactly two win', { skip }, async () => {
  const days = await loadSlots(project, 'site_visit', { days: 7 });
  const day = days.filter((d) => d.slots.length).at(-1);
  const slot = day.slots.find((s) => s.left === s.capacity);
  assert.ok(slot, 'need an empty slot');
  const leads = [];
  for (let i = 0; i < 5; i++) {
    const { lead } = await upsertLead(project, { name: 'Race ' + i, phone: `+97150000${String(Date.now()).slice(-4)}${i}`, fieldSource: 'form' });
    leads.push(lead);
  }
  const results = await Promise.allSettled(leads.map((l) => createBooking(project, { leadId: l.id, kind: 'site_visit', startsAt: slot.at, createdVia: 'form' })));
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');
  assert.equal(won.length, slot.capacity);
  assert.ok(lost.every((r) => r.reason.code === 'slot_taken'));
  assert.deepEqual(won.map((r) => r.value.booking.seat).sort(), Array.from({ length: slot.capacity }, (_, i) => i + 1));
  await db()`update bookings set status = 'cancelled' where lead_id = any(${leads.map((l) => l.id)})`;
});

test('a forged time that is not an offered slot is rejected', { skip }, async () => {
  const { lead } = await upsertLead(project, { name: 'Forger', phone: '+971500009999', fieldSource: 'form' });
  await assert.rejects(createBooking(project, { leadId: lead.id, kind: 'site_visit', startsAt: '2026-11-02T06:10:00Z', createdVia: 'form' }), /no longer available/);
});

test('the same phone becomes the same lead', { skip }, async () => {
  const a = await upsertLead(project, { name: 'Same Person', phone: '+971501110000', email: 'a@example.com', fieldSource: 'form' });
  const b = await upsertLead(project, { name: 'Same Person', phone: '+971501110000', fields: { budget: { value: 'AED 2-3M' } }, fieldSource: 'form' });
  assert.equal(a.lead.id, b.lead.id);
  assert.equal(b.created, false);
  assert.equal(b.lead.email, 'a@example.com');
  assert.equal(b.lead.fields.budget.value, 'AED 2-3M');
});
