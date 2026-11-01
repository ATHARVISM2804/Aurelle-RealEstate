/* Resend sender (moved from api/enquiry.js) + attachment support for .ics invites. */
import { escapeHtml } from './http.mjs';

export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY);

export async function sendEmail({ to, subject, text, html, replyTo, attachments, from }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, skipped: true };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: from || process.env.LEADS_EMAIL_FROM || 'Aurelle <onboarding@resend.dev>',
      to: Array.isArray(to) ? to : String(to).split(',').map((s) => s.trim()).filter(Boolean),
      reply_to: replyTo || undefined,
      subject, text, html,
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content).toString('base64'),
        content_type: a.contentType,
      })),
    }),
  });
  return { ok: res.ok, status: res.status };
}

export const salesInbox = () => (process.env.LEADS_EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean);

/* Plain, quiet-luxury email shell. Every value passed in is escaped. */
export function layout({ eyebrow, title, lines = [], button, footer }) {
  const rows = lines.map(([k, v]) => `<tr><td style="padding:6px 0;color:#8f8a80;font-size:12px;letter-spacing:.08em;text-transform:uppercase;width:140px;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;color:#1b1a17;font-size:15px">${escapeHtml(v)}</td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f2eee7;font-family:Inter,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2eee7;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#f7f4ef;border:1px solid rgba(27,26,23,.12);padding:36px">
<tr><td style="color:#8f8a80;font-size:11px;letter-spacing:.22em;text-transform:uppercase">${escapeHtml(eyebrow || 'Aurelle Residence')}</td></tr>
<tr><td style="padding:14px 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.15;color:#1b1a17">${escapeHtml(title)}</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
${button ? `<tr><td style="padding-top:26px"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:#1b1a17;color:#f4f1ea;text-decoration:none;padding:14px 26px;border-radius:99px;font-size:13px;letter-spacing:.06em">${escapeHtml(button.label)}</a></td></tr>` : ''}
${footer ? `<tr><td style="padding-top:28px;color:#8f8a80;font-size:12px;line-height:1.6">${escapeHtml(footer)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}
