import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSlots, zonedToUtc, tzOffset, isOffered, localDate } from '../api/_lib/slots.mjs';

const daily = (kind, start, end, slot, capacity) => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ kind, weekday, start_local: start, end_local: end, slot_minutes: slot, capacity }));

test('zonedToUtc: Dubai has no DST, London does', () => {
  assert.equal(zonedToUtc('2026-11-03', '10:00', 'Asia/Dubai').toISOString(), '2026-11-03T06:00:00.000Z');
  assert.equal(zonedToUtc('2026-07-01', '10:00', 'Europe/London').toISOString(), '2026-07-01T09:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-01', '10:00', 'Europe/London').toISOString(), '2026-12-01T10:00:00.000Z');
  assert.equal(zonedToUtc('2026-11-03', '10:00', 'Asia/Kolkata').toISOString(), '2026-11-03T04:30:00.000Z');
  assert.equal(tzOffset(new Date('2026-03-29T12:00:00Z'), 'Europe/London'), 60);
});

test('daily 10:00-19:00, 45-min slots, capacity 2 -> 12 slots per full day', () => {
  const now = new Date('2026-11-01T02:00:00Z'); // 06:00 Dubai
  const days = generateSlots(daily('site_visit', '10:00', '19:00', 45, 2), [], [], now, { tz: 'Asia/Dubai', kind: 'site_visit', days: 3 });
  assert.equal(days.length, 3);
  assert.equal(days[0].date, '2026-11-01');
  assert.equal(days[0].slots.length, 12);
  assert.equal(days[0].slots[0].label, '10:00');
  assert.equal(days[0].slots.at(-1).label, '18:15');
  assert.equal(days[0].slots[0].at, '2026-11-01T06:00:00.000Z');
  assert.equal(days[0].slots[0].left, 2);
});

test('lead time removes slots that are too soon', () => {
  const now = new Date('2026-11-01T08:00:00Z'); // 12:00 Dubai, +120 min lead -> first slot >= 14:00
  const [d] = generateSlots(daily('site_visit', '10:00', '19:00', 45, 2), [], [], now, { tz: 'Asia/Dubai', kind: 'site_visit', days: 1 });
  assert.equal(d.slots[0].label, '14:30');
});

test('capacity counts only active bookings of the same kind', () => {
  const now = new Date('2026-11-01T02:00:00Z');
  const at = '2026-11-02T06:00:00.000Z';
  const bookings = [
    { kind: 'site_visit', starts_at: at, status: 'confirmed' },
    { kind: 'site_visit', starts_at: at, status: 'cancelled' },
    { kind: 'video_call', starts_at: at, status: 'confirmed' },
  ];
  let days = generateSlots(daily('site_visit', '10:00', '19:00', 45, 2), [], bookings, now, { tz: 'Asia/Dubai', kind: 'site_visit', days: 2 });
  assert.equal(days[1].slots[0].left, 1);
  bookings.push({ kind: 'site_visit', starts_at: at, status: 'reminded' });
  days = generateSlots(daily('site_visit', '10:00', '19:00', 45, 2), [], bookings, now, { tz: 'Asia/Dubai', kind: 'site_visit', days: 2 });
  assert.equal(days[1].slots[0].label, '10:45');
});

test('exceptions close a day or change its hours', () => {
  const now = new Date('2026-11-01T02:00:00Z');
  const ex = [{ kind: null, date: '2026-11-02', closed: true }, { kind: 'site_visit', date: '2026-11-03', closed: false, start_local: '14:00', end_local: '16:00' }];
  const days = generateSlots(daily('site_visit', '10:00', '19:00', 45, 2), ex, [], now, { tz: 'Asia/Dubai', kind: 'site_visit', days: 3 });
  assert.equal(days[1].slots.length, 0);
  assert.deepEqual(days[2].slots.map((s) => s.label), ['14:00', '14:45']);
});

test('weekday rules and validity windows', () => {
  const now = new Date('2026-11-01T02:00:00Z'); // Sunday
  const rules = [{ kind: 'video_call', weekday: 1, start_local: '10:00', end_local: '11:00', slot_minutes: 30, capacity: 1, valid_from: '2026-11-09' }];
  const days = generateSlots(rules, [], [], now, { tz: 'Asia/Dubai', kind: 'video_call', days: 10 });
  assert.equal(days.find((d) => d.date === '2026-11-02').slots.length, 0); // Monday before valid_from
  assert.equal(days.find((d) => d.date === '2026-11-09').slots.length, 2);
});

test('horizon caps how far ahead slots go; isOffered rejects forged times', () => {
  const now = new Date('2026-11-01T02:00:00Z');
  const days = generateSlots(daily('site_visit', '10:00', '19:00', 45, 2), [], [], now, { tz: 'Asia/Dubai', kind: 'site_visit', days: 30, horizonDays: 5 });
  assert.equal(days.length, 6);
  assert.ok(isOffered(days, '2026-11-02T06:00:00.000Z'));
  assert.equal(isOffered(days, '2026-11-02T06:10:00.000Z'), null);
  assert.equal(localDate(new Date('2026-11-01T21:00:00Z'), 'Asia/Dubai').date, '2026-11-02');
});
