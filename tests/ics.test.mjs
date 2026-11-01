import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, fold, googleCalendarLink } from '../api/_lib/ics.mjs';

const base = { uid: 'b1@aurelle', start: '2026-11-03T07:00:00Z', end: '2026-11-03T07:45:00Z', summary: 'Private visit, Aurelle Residence', location: 'Sales gallery, Al Furjan; Dubai', description: 'Line one\nLine two, with comma', now: new Date('2026-11-01T10:00:00Z') };

test('CRLF line endings, required fields, UTC stamps', () => {
  const ics = buildIcs(base);
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'bare LF found');
  assert.match(ics, /\r\nMETHOD:REQUEST\r\n/);
  assert.match(ics, /\r\nDTSTART:20261103T070000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20261103T074500Z\r\n/);
  assert.match(ics, /\r\nSEQUENCE:0\r\n/);
  assert.match(ics, /BEGIN:VALARM/);
});

test('escaping of ; , \\ and newlines', () => {
  const ics = buildIcs(base);
  assert.match(ics, /LOCATION:Sales gallery\\, Al Furjan\\; Dubai/);
  assert.match(ics, /DESCRIPTION:Line one\\nLine two\\, with comma/);
});

test('cancel uses METHOD:CANCEL, STATUS:CANCELLED and the given sequence, no alarm', () => {
  const ics = buildIcs({ ...base, method: 'CANCEL', sequence: 2 });
  assert.match(ics, /METHOD:CANCEL/);
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, /SEQUENCE:2/);
  assert.doesNotMatch(ics, /VALARM/);
});

test('folding at 75 octets without splitting UTF-8', () => {
  const long = 'DESCRIPTION:' + 'زيارة خاصة '.repeat(20);
  const folded = fold(long);
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
  assert.equal(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), long);
});

test('google calendar link', () => {
  const u = new URL(googleCalendarLink(base));
  assert.equal(u.searchParams.get('dates'), '20261103T070000Z/20261103T074500Z');
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
});
