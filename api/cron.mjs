/* Daily jobs (08:00 Dubai), called by Vercel Cron with Authorization: Bearer CRON_SECRET.
   - visit reminders for visits 12-36h ahead (email; WhatsApp reminders are a later phase)
   - summaries + scoring for chats idle > 20 minutes
   - housekeeping: expired sessions, old rate-limit windows, anonymous chats older than 90 days */
import { json, errorResponse, HttpError, safeEqual } from './_lib/http.mjs';
import { db } from './_lib/db.mjs';
import { loadProject } from './_lib/project.mjs';
import { bookingView } from './_lib/booking-mail.mjs';
import { sendEmail, layout } from './_lib/email.mjs';
import { summarizeSession } from './_lib/summarize.mjs';
import { cleanup } from './_lib/ratelimit.mjs';

export async function GET(request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || !safeEqual(request.headers.get('authorization') || '', 'Bearer ' + secret)) throw new HttpError(401, 'unauthorized');
    const out = { reminders: 0, summaries: 0, purged: 0 };
    const sql = db();
    const origin = (process.env.APP_ORIGIN || '').split(',')[0].trim() || new URL(request.url).origin;

    // claim each reminder before sending, so an overlapping or retried run never emails twice
    const due = await sql`update bookings b set status = 'reminded', reminded_at = now()
      from leads l where l.id = b.lead_id and l.deleted_at is null
        and b.status = 'confirmed' and b.reminded_at is null and b.starts_at between now() + interval '12 hours' and now() + interval '36 hours'
        and b.id in (select id from bookings where status = 'confirmed' and reminded_at is null order by starts_at limit 200)
      returning b.*, l.name, l.email`;
    for (const b of due) {
      const project = await loadProject(b.project_id);
      const v = bookingView(project, b, { origin });
      if (b.email) {
        await sendEmail({ to: b.email, subject: `Tomorrow: your visit to ${project.name}`, text: `A reminder of your ${v.kind_label.toLowerCase()} on ${v.label}. ${v.location}.`,
          html: layout({ eyebrow: project.name, title: 'See you tomorrow', lines: [['When', v.label], ['Where', v.location]], button: v.maps_url ? { href: v.maps_url, label: 'Directions' } : null }) }).catch((e) => console.error(e));
      }
      out.reminders++;
    }

    const idle = await sql`select id from chat_sessions where last_message_at < now() - interval '20 minutes' and last_message_at > now() - interval '3 days'
      and (summarized_at is null or summarized_at < last_message_at) and user_msgs >= 2 order by last_message_at limit 25`;
    for (const s of idle) {
      try { if (await summarizeSession(s.id)) out.summaries++; } catch (e) { console.error('summary failed', s.id, e.message); }
    }

    await sql`delete from auth_sessions where expires_at < now()`;
    await cleanup();
    // retention, in small batches so one run never times out: anonymous chats and anonymous browsing after 90 days
    for (let i = 0; i < 20; i++) {
      const gone = await sql`delete from chat_sessions where id in (select id from chat_sessions where lead_id is null and last_message_at < now() - interval '90 days' limit 200) returning id`;
      out.purged += gone.length;
      if (gone.length < 200) break;
    }
    for (let i = 0; i < 20; i++) {
      const gone = await sql`delete from events where id in (select e.id from events e join visitors v on v.id = e.visitor_id
        where v.lead_id is null and e.at < now() - interval '90 days' limit 2000) returning id`;
      if (gone.length < 2000) break;
    }
    await sql`delete from visitors v where v.lead_id is null and v.last_seen < now() - interval '90 days'
      and not exists (select 1 from chat_sessions c where c.visitor_id = v.id) and not exists (select 1 from events e where e.visitor_id = v.id)`;
    return json({ ok: true, ...out });
  } catch (e) { return errorResponse(e); }
}
