/* Booking slots from weekly rules + date exceptions - existing bookings. Pure (no I/O).
   All rule times are local to the project's timezone; output instants are UTC ISO strings. */

const LOCALES = { en: 'en-GB', ar: 'ar-AE', hi: 'hi-IN', 'hi-Latn': 'en-IN' };

/* Offset (minutes) of `tz` at instant `date`. */
export function tzOffset(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/* Local wall time in `tz` -> UTC Date. Handles DST by re-checking the offset. */
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffset(new Date(guess), tz);
  let utc = guess - off * 60000;
  const off2 = tzOffset(new Date(utc), tz);
  if (off2 !== off) utc = guess - off2 * 60000;
  return new Date(utc);
}

/* Calendar date (YYYY-MM-DD) and weekday (0=Sun) of an instant in `tz`. */
export function localDate(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const toMin = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m; };
const fromMin = (n) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

export function dayLabel(dateStr, tz, lang = 'en') {
  const d = zonedToUtc(dateStr, '12:00', tz);
  return new Intl.DateTimeFormat(LOCALES[lang] || 'en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

/**
 * @param rules        [{kind, weekday, start_local, end_local, slot_minutes, capacity, valid_from, valid_to}]
 * @param exceptions   [{kind|null, date, closed, start_local, end_local}]
 * @param bookings     [{kind, starts_at, status}]  (active ones count against capacity)
 * @param now          Date
 * @param opts         {tz, kind, days=7, from (YYYY-MM-DD, default today), leadMinutes=120, horizonDays=14, lang}
 */
export function generateSlots(rules, exceptions, bookings, now, opts) {
  const { tz, kind, days = 7, leadMinutes = 120, horizonDays = 14, lang = 'en' } = opts;
  const today = localDate(now, tz).date;
  const start = opts.from && opts.from > today ? opts.from : today;
  const lastDay = addDays(today, horizonDays);
  const earliest = now.getTime() + leadMinutes * 60000;
  const taken = new Map();
  for (const b of bookings) {
    if (b.kind !== kind || !['confirmed', 'reminded', 'checked_in'].includes(b.status)) continue;
    const k = new Date(b.starts_at).toISOString();
    taken.set(k, (taken.get(k) || 0) + 1);
  }
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    if (date > lastDay) break;
    const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
    const ex = exceptions.find((e) => String(e.date).slice(0, 10) === date && (!e.kind || e.kind === kind));
    let windows;
    if (ex?.closed) windows = [];
    else if (ex && ex.start_local && ex.end_local) {
      const base = rules.find((r) => r.kind === kind && r.weekday === weekday) || rules.find((r) => r.kind === kind);
      windows = base ? [{ ...base, start_local: ex.start_local, end_local: ex.end_local }] : [];
    } else {
      windows = rules.filter((r) => r.kind === kind && r.weekday === weekday
        && (!r.valid_from || String(r.valid_from).slice(0, 10) <= date) && (!r.valid_to || String(r.valid_to).slice(0, 10) >= date));
    }
    const slots = [];
    for (const r of windows) {
      const step = Number(r.slot_minutes) || 45;
      for (let t = toMin(r.start_local); t + step <= toMin(r.end_local); t += step) {
        const at = zonedToUtc(date, fromMin(t), tz);
        if (at.getTime() < earliest) continue;
        const iso = at.toISOString();
        const left = (Number(r.capacity) || 1) - (taken.get(iso) || 0);
        if (left > 0 && !slots.some((s) => s.at === iso)) slots.push({ at: iso, label: fromMin(t), left, minutes: step, capacity: Number(r.capacity) || 1 });
      }
    }
    slots.sort((a, b) => a.at.localeCompare(b.at));
    out.push({ date, label: dayLabel(date, tz, lang), slots });
  }
  return out;
}

/* Is `iso` a currently offered slot? Used to reject forged booking times. */
export function isOffered(days, iso) {
  const t = new Date(iso).toISOString();
  for (const d of days) for (const s of d.slots) if (s.at === t) return s;
  return null;
}
