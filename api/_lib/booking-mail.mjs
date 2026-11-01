/* Booking confirmation / update / cancellation emails with a calendar invite, plus the sales alert. */
import { sendEmail, layout } from './email.mjs';
import { buildIcs, googleCalendarLink } from './ics.mjs';
import { bookingLabel } from './bookings.mjs';
import { createAlert } from './alerts.mjs';

const KIND = { site_visit: 'Private site visit', video_call: 'Video call' };

export function bookingView(project, booking, { origin, token, lang = 'en' }) {
  const loc = project.settings?.location || {};
  const summary = `${KIND[booking.kind]} · ${project.name}`;
  const location = booking.kind === 'video_call' ? 'Video call (link sent by your consultant)' : (loc.address || project.name);
  const manageUrl = token ? `${origin}/visit?b=${booking.id}&t=${encodeURIComponent(token)}` : null;
  return {
    id: booking.id, kind: booking.kind, kind_label: KIND[booking.kind], status: booking.status,
    starts_at: booking.starts_at, ends_at: booking.ends_at, unit_code: booking.unit_code,
    label: bookingLabel(booking.starts_at, project.timezone, lang), tz: project.timezone,
    location, maps_url: booking.kind === 'site_visit' ? loc.maps_url : null, map_img: loc.map_img || null,
    manage_url: manageUrl,
    ics_url: token ? `${origin}/api/p/ics?b=${booking.id}&t=${encodeURIComponent(token)}` : null,
    gcal_url: googleCalendarLink({ start: booking.starts_at, end: booking.ends_at, summary, location, description: manageUrl ? 'Manage your booking: ' + manageUrl : '' }),
    summary,
  };
}

export function icsFor(project, booking, lead, { origin, token, method = 'REQUEST' }) {
  const v = bookingView(project, booking, { origin, token });
  return buildIcs({
    uid: `${booking.manage_token_hash ? Buffer.from(booking.manage_token_hash).toString('hex').slice(0, 16) : booking.id}@${project.slug}`,
    sequence: booking.ics_seq || 0, method, start: booking.starts_at, end: booking.ends_at,
    summary: v.summary, location: v.location, url: v.manage_url,
    description: [v.kind_label, booking.unit_code ? `Residence ${booking.unit_code}` : '', v.manage_url ? `Reschedule or cancel: ${v.manage_url}` : ''].filter(Boolean).join('\n'),
    organizerEmail: (process.env.LEADS_EMAIL_FROM || '').match(/<([^>]+)>/)?.[1] || null, organizerName: project.name,
    attendeeEmail: lead?.email || null, attendeeName: lead?.name || null,
  });
}

/* event: created | rescheduled | cancelled */
export async function notifyBooking(project, booking, lead, { event, origin, token, lang = 'en' }) {
  const v = bookingView(project, booking, { origin, token, lang });
  const jobs = [];
  if (lead?.email) {
    const title = event === 'cancelled' ? 'Your visit is cancelled' : event === 'rescheduled' ? 'Your visit has moved' : 'Your visit is confirmed';
    const lines = [['When', `${v.label} (${project.timezone.replace('_', ' ')})`], ['What', v.kind_label], ['Where', v.location]];
    if (booking.unit_code) lines.push(['Residence', booking.unit_code]);
    jobs.push(sendEmail({
      to: lead.email,
      subject: `${title} · ${project.name}`,
      text: `${title}.\n\n${lines.map(([k, val]) => `${k}: ${val}`).join('\n')}\n\n${v.manage_url ? 'Reschedule or cancel: ' + v.manage_url : ''}`,
      html: layout({
        eyebrow: project.name, title, lines,
        button: event !== 'cancelled' && v.manage_url ? { href: v.manage_url, label: 'Reschedule or cancel' } : null,
        footer: 'This is a transactional message about your booking. Reply to this email to reach the sales team.',
      }),
      attachments: [{ filename: 'visit.ics', content: icsFor(project, booking, lead, { origin, token, method: event === 'cancelled' ? 'CANCEL' : 'REQUEST' }), contentType: `text/calendar; method=${event === 'cancelled' ? 'CANCEL' : 'REQUEST'}` }],
    }).catch((e) => console.error('booking email failed', e)));
  }
  jobs.push(createAlert({
    projectId: project.id, leadId: booking.lead_id, kind: event === 'created' ? 'booking' : 'booking_changed',
    payload: { when: v.label, what: v.kind_label, event, unit: booking.unit_code || '' },
  }).catch((e) => console.error('booking alert failed', e)));
  await Promise.all(jobs);
  return v;
}
