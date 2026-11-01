/* RFC 5545 calendar invite builder: CRLF line endings, 75-octet folding, escaping,
   METHOD:REQUEST for new/updated events and METHOD:CANCEL with a higher SEQUENCE. */

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/* Fold to 75 octets (not characters), never splitting a UTF-8 sequence. */
export function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0, limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;   // back off continuation bytes
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;                                                           // continuation lines start with a space
  }
  return parts.join('\r\n ');
}

export function buildIcs({ uid, sequence = 0, method = 'REQUEST', start, end, summary, description, location, url, organizerName, organizerEmail, attendeeEmail, attendeeName, now = new Date() }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Aurelle//Visit booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(summary)}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    location ? `LOCATION:${esc(location)}` : null,
    url ? `URL:${esc(url)}` : null,
    organizerEmail ? `ORGANIZER;CN=${esc(organizerName || 'Sales team')}:mailto:${organizerEmail}` : null,
    attendeeEmail ? `ATTENDEE;CN=${esc(attendeeName || attendeeEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${attendeeEmail}` : null,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    method === 'CANCEL' ? null : 'BEGIN:VALARM',
    method === 'CANCEL' ? null : 'TRIGGER:-PT2H',
    method === 'CANCEL' ? null : 'ACTION:DISPLAY',
    method === 'CANCEL' ? null : `DESCRIPTION:${esc(summary)}`,
    method === 'CANCEL' ? null : 'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function googleCalendarLink({ start, end, summary, description, location }) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: summary, dates: `${stamp(start)}/${stamp(end)}`, details: description || '', location: location || '' });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
