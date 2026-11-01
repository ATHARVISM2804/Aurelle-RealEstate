/* ==========================================================
   Site settings — edit these before launch.
   ========================================================== */
window.AURELLE = {
  // Sales WhatsApp number: digits only, with country code (placeholder until the real number is in)
  whatsapp: '971500000000',
  email: 'hello@haldenproperties.example',
  // Where enquiry forms are POSTed as JSON. /api/enquiry is served by api/enquiry.js on Vercel
  // and by tools/serve.py locally (which writes leads/leads.csv).
  enquiryEndpoint: '/api/enquiry',
  brochure: 'assets/brochure/Aurelle-Residence-Brochure.pdf',
  // which project this site is in the leads database (data/projects/<project>)
  project: 'aurelle',
  // AI assistant ("Ask Aurelle"). Switch on once the Vercel project has DATABASE_URL, GROQ_API_KEY,
  // CHAT_TOKEN_SECRET and TURNSTILE_SECRET (it is always on at localhost). At the same time, replace the
  // Turnstile key below — Cloudflare's always-pass test key — with your real site key.
  assistant: {
    enabled: false,
    name: 'Aurelle',
    endpoint: '/api/chat',
    api: '/api/p',
    turnstileSiteKey: '1x00000000000000000000AA',
    phone: '+971 4 000 0000',
  },
};

/* Prices and availability. Sample figures: replace with the live sales sheet. */
window.INVENTORY = {
  currency: 'AED',
  // starting price of each unit type on level 01; every floor up adds `perLevel`
  from: { oneBhk: 1250000, oneBhkStudy: 1480000, twoBhk: 2350000, threeBhk: 6900000, fourBhk: 8900000 },
  perLevel: 0.012,
  // "level-unit" ids (typical floors: A–E, penthouse floors: P1–P3)
  sold: ['01-B', '01-C', '02-A', '02-C', '03-B', '03-D', '03-E', '04-C', '05-A', '05-B', '06-D', '07-C', '07-E',
    '08-B', '08-C', '09-A', '10-D', '11-C', '12-B', '12-E', '13-C', '14-A', '15-P2'],
  reserved: ['06-A', '10-B', '16-P1'],
};
