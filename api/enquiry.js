/* Vercel serverless function: receives the site's enquiry / brochure forms.
   Configure in the Vercel project's environment variables (any or all):
     SHEET_WEBHOOK_URL  a Google Apps Script web-app URL (see tools/enquiry-apps-script.gs) — each lead becomes a row
     RESEND_API_KEY + LEADS_EMAIL_TO (+ LEADS_EMAIL_FROM)  email each lead to the sales inbox via Resend
*/
const clean = (v, n = 500) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const lead = {
    at: new Date().toISOString(), type: clean(b.type, 20), name: clean(b.name, 120), phone: clean(b.phone, 40), email: clean(b.email, 160),
    unit: clean(b.unit, 160), budget: clean(b.budget, 40), contact: clean(b.contact, 20), message: clean(b.message, 2000), page: clean(b.page, 300),
    utm_source: clean(b.utm_source, 80), utm_medium: clean(b.utm_medium, 80), utm_campaign: clean(b.utm_campaign, 120),
  };
  if (!lead.name || !lead.phone || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(lead.email)) return res.status(400).json({ ok: false });

  const jobs = [];
  if (process.env.SHEET_WEBHOOK_URL) {
    jobs.push(fetch(process.env.SHEET_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead) }));
  }
  if (process.env.RESEND_API_KEY && process.env.LEADS_EMAIL_TO) {
    const rows = Object.entries(lead).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
    jobs.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.LEADS_EMAIL_FROM || 'Aurelle leads <onboarding@resend.dev>',
        to: process.env.LEADS_EMAIL_TO.split(','), reply_to: lead.email,
        subject: `New ${lead.type || 'enquiry'}: ${lead.name}${lead.unit ? ' — ' + lead.unit : ''}`, text: rows,
      }),
    }));
  }
  if (!jobs.length) return res.status(503).json({ ok: false, error: 'No lead destination configured' });
  const results = await Promise.allSettled(jobs);
  const ok = results.some((r) => r.status === 'fulfilled' && r.value.ok);
  return res.status(ok ? 200 : 502).json({ ok });
};
