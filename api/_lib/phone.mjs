/* Phone normalisation to E.164 so the same buyer is one lead, whichever form they used. */
import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/* cc like "+971" or "971"; number may already include it. Returns "+9715..." or null. */
export function toE164(number, cc) {
  const raw = String(number || '').replace(/[^\d+]/g, '');
  if (raw.length < 6) return null;
  const withCc = raw.startsWith('+') ? raw : raw.startsWith('00') ? '+' + raw.slice(2) : (cc ? '+' + String(cc).replace(/\D/g, '') + raw.replace(/^0+/, '') : '+' + raw);
  const p = parsePhoneNumberFromString(withCc);
  if (!p || !p.isPossible()) return null;
  return p.number;
}

/* Split the existing form's "+971 50 123 4567" style value. */
export function parseFormPhone(value) {
  const s = String(value || '').trim();
  const m = s.match(/^(\+\d{1,4})\s+(.+)$/);
  return m ? toE164(m[2], m[1]) : toE164(s);
}
