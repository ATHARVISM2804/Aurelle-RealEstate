/* Visit booking: slots from the database, seat-safe inserts, reschedule and cancel. */
import { randomBytes } from 'node:crypto';
import { db } from './db.mjs';
import { generateSlots, isOffered, localDate, dayLabel } from './slots.mjs';
import { HttpError, sha256 } from './http.mjs';

const ACTIVE = ['confirmed', 'reminded', 'checked_in'];
const STAGE_ORDER = ['new', 'contacted', 'qualified', 'visit_booked', 'visited', 'negotiation', 'booked', 'lost'];

export async function loadSlots(project, kind, { lang = 'en', from, days = 7, now = new Date(), excludeBookingId = null } = {}) {
  const sql = db();
  const b = project.settings?.booking || {};
  const [rules, exceptions, bookings] = await Promise.all([
    sql`select * from availability_rules where project_id = ${project.id} and kind = ${kind}`,
    sql`select * from availability_exceptions where project_id = ${project.id} and date >= current_date - 1`,
    sql`select id, kind, starts_at, status from bookings where project_id = ${project.id} and kind = ${kind}
      and starts_at >= now() and status in ('confirmed','reminded','checked_in')`,
  ]);
  return generateSlots(rules, exceptions, bookings.filter((x) => x.id !== excludeBookingId), now, {
    tz: project.timezone, kind, days, from, lang,
    leadMinutes: b.lead_time_minutes ?? 120, horizonDays: b.horizon_days ?? 14,
  });
}

export function bookingLabel(startsAt, tz, lang = 'en') {
  const d = new Date(startsAt);
  const { date } = localDate(d, tz);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${dayLabel(date, tz, lang)}, ${time}`;
}

const newToken = () => randomBytes(24).toString('base64url');

/* Insert into the first free seat. The partial unique index on (project, kind, starts_at, seat) is the real guard.
   moveFrom: in the same statement, mark that booking 'rescheduled' only if the new seat was taken. */
async function insertSeat({ project, leadId, sessionId, kind, unitCode, startsAt, endsAt, capacity, createdVia, tokenHash, assignedTo = null, icsSeq = 0, moveFrom = null }) {
  const sql = db();
  const rows = await sql.query(
    `with ins as (
       insert into bookings(project_id, lead_id, session_id, kind, unit_code, starts_at, ends_at, seat, manage_token_hash, created_via, assigned_to, ics_seq)
       select $1, $2, $3, $4, $5, $6, $7, s.seat, $8, $9, $10, $12
       from generate_series(1, $11::int) as s(seat)
       where not exists (select 1 from bookings b where b.project_id = $1 and b.kind = $4 and b.starts_at = $6
                         and b.seat = s.seat and b.status in ('confirmed','reminded','checked_in'))
       order by s.seat limit 1
       on conflict do nothing
       returning *),
     moved as (
       update bookings set status = 'rescheduled', updated_at = now()
       where id = $13 and status in ('confirmed','reminded','checked_in') and exists (select 1 from ins)
       returning id)
     select ins.*, (select count(*) from moved)::int as moved from ins`,
    [project.id, leadId, sessionId || null, kind, unitCode || null, startsAt, endsAt, tokenHash, createdVia, assignedTo, capacity, icsSeq, moveFrom],
  );
  const row = rows[0] || null;
  const moved = row?.moved;
  if (row) delete row.moved;
  if (row && moveFrom && !moved) {             // the old visit was closed meanwhile: undo the new seat
    await sql`delete from bookings where id = ${row.id}`;
    throw new HttpError(409, 'not_active', 'This visit can no longer be changed.');
  }
  return row;
}

/* Seats can be lost to concurrent bookers; try each seat before giving up. */
async function takeSeat(args) {
  for (let i = 0; i < Math.max(1, args.capacity); i++) {
    const row = await insertSeat(args);
    if (row) return row;
  }
  return null;
}

export async function createBooking(project, { leadId, sessionId, kind, startsAt, unitCode, createdVia = 'chat', lang = 'en', now = new Date() }) {
  if (!['site_visit', 'video_call'].includes(kind)) throw new HttpError(400, 'bad_kind');
  const iso = new Date(startsAt).toISOString();
  const { date } = localDate(new Date(iso), project.timezone);
  const days = await loadSlots(project, kind, { lang, from: date, days: 1, now });
  const slot = isOffered(days, iso);
  if (!slot) throw new HttpError(409, 'slot_taken', 'That time is no longer available.');
  const token = newToken();
  const args = { project, leadId, sessionId, kind, unitCode, startsAt: iso, endsAt: new Date(new Date(iso).getTime() + slot.minutes * 60000).toISOString(), capacity: slot.capacity, createdVia, tokenHash: sha256(token) };
  const row = await takeSeat(args);
  if (!row) throw new HttpError(409, 'slot_taken', 'That time was just taken. Please pick another.');
  await advanceStage(leadId, 'visit_booked');
  return { booking: row, token, label: bookingLabel(row.starts_at, project.timezone, lang) };
}

export async function advanceStage(leadId, stage) {
  const sql = db();
  const idx = STAGE_ORDER.indexOf(stage);
  const earlier = STAGE_ORDER.slice(0, idx);
  await sql`update leads set stage = ${stage}, stage_changed_at = now(), last_activity_at = now()
    where id = ${leadId} and stage = any(${earlier})`;
}

export async function findByToken(bookingId, token) {
  if (!bookingId || !token || !/^[0-9a-f-]{36}$/i.test(bookingId)) throw new HttpError(404, 'not_found');
  // a reschedule creates a new row with the same token, so old email links follow to the latest booking
  const [b] = await db()`select b.* from bookings b
    where b.manage_token_hash = ${sha256(token)}
      and exists (select 1 from bookings x where x.id = ${bookingId} and x.manage_token_hash = b.manage_token_hash)
    order by (b.status <> 'rescheduled') desc, b.created_at desc limit 1`;
  if (!b) throw new HttpError(404, 'not_found');
  return b;
}

/* Move to a new time: the old row becomes 'rescheduled', a new row takes a seat at the new time.
   The same manage token keeps working (we copy its hash). */
export async function reschedule(project, booking, { startsAt, lang = 'en', now = new Date() }) {
  if (!ACTIVE.includes(booking.status)) throw new HttpError(409, 'not_active', 'This visit can no longer be changed.');
  const iso = new Date(startsAt).toISOString();
  const { date } = localDate(new Date(iso), project.timezone);
  const days = await loadSlots(project, booking.kind, { lang, from: date, days: 1, now, excludeBookingId: booking.id });
  const slot = isOffered(days, iso);
  if (!slot) throw new HttpError(409, 'slot_taken', 'That time is no longer available.');
  const row = await takeSeat({
    project, leadId: booking.lead_id, sessionId: booking.session_id, kind: booking.kind, unitCode: booking.unit_code,
    startsAt: iso, endsAt: new Date(new Date(iso).getTime() + slot.minutes * 60000).toISOString(),
    capacity: slot.capacity, createdVia: booking.created_via,
    tokenHash: booking.manage_token_hash, assignedTo: booking.assigned_to, icsSeq: booking.ics_seq + 1, moveFrom: booking.id,
  });
  if (!row) throw new HttpError(409, 'slot_taken', 'That time was just taken. Please pick another.');
  return { booking: row, previous: booking, label: bookingLabel(row.starts_at, project.timezone, lang) };
}

export async function cancel(booking) {
  if (!ACTIVE.includes(booking.status)) throw new HttpError(409, 'not_active', 'This visit is already closed.');
  const [row] = await db()`update bookings set status = 'cancelled', ics_seq = ics_seq + 1, updated_at = now()
    where id = ${booking.id} and status in ('confirmed','reminded','checked_in') returning *`;
  if (!row) throw new HttpError(409, 'not_active', 'This visit is already closed.');
  return row;
}

/* The lead's upcoming visit. With sessionId, only a visit booked in that conversation: a chat that
   matched an existing lead by phone number must not learn someone else's visit details. */
export async function activeBookingForLead(leadId, sessionId) {
  if (!leadId) return null;
  const [b] = sessionId
    ? await db()`select * from bookings where lead_id = ${leadId} and session_id = ${sessionId} and status in ('confirmed','reminded') and starts_at > now() order by starts_at limit 1`
    : await db()`select * from bookings where lead_id = ${leadId} and status in ('confirmed','reminded') and starts_at > now() order by starts_at limit 1`;
  return b || null;
}
