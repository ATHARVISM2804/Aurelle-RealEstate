/* ==========================================================
   Visitor context for the assistant and lead scoring.
   Keeps a small local log of what the visitor explores (units opened,
   levels, 3D, sections) plus where they came from (UTM, Meta/Google
   click ids). Nothing leaves the browser until the visitor engages —
   starts a chat or sends a form — so plain browsing never touches the
   server or the leads database.
   ========================================================== */
(function () {
  let LS = null;   // storage can be blocked (privacy modes); then get/set below fail quietly
  try { LS = window.localStorage; } catch (e) { /* this page view only */ }
  const get = (k, d) => { try { return JSON.parse(LS.getItem(k)) ?? d; } catch (e) { return d; } };
  const set = (k, v) => { try { LS.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2));

  let anon = get('aurelle.anon', null);
  if (!anon) { anon = uuid(); set('aurelle.anon', anon); }

  // attribution: first touch is kept forever, last touch is any visit that arrived with campaign data
  const qs = new URLSearchParams(location.search);
  const touch = { at: new Date().toISOString(), landing: location.pathname };
  qs.forEach((v, k) => { if (/^utm_/.test(k)) touch[k] = v.slice(0, 200); });
  if (qs.get('fbclid')) { touch.fbclid = qs.get('fbclid').slice(0, 300); touch.fbc = 'fb.1.' + Date.now() + '.' + touch.fbclid; }
  if (qs.get('gclid')) touch.gclid = qs.get('gclid').slice(0, 300);
  if (document.referrer && !document.referrer.startsWith(location.origin)) touch.referrer = document.referrer.slice(0, 300);
  const fbp = (document.cookie.match(/(?:^|; )_fbp=([^;]+)/) || [])[1];
  if (fbp) touch.fbp = fbp;
  const hasCampaign = Object.keys(touch).some((k) => /^(utm_|fbclid|gclid|referrer)/.test(k));
  if (!get('aurelle.ft', null)) set('aurelle.ft', touch);
  if (hasCampaign || !get('aurelle.lt', null)) set('aurelle.lt', touch);

  // visits: a new one after 30 minutes away; keep the last 7 days
  const now = Date.now();
  let visits = get('aurelle.visits', []).filter((t) => now - t < 7 * 864e5);
  if (!visits.length || now - get('aurelle.seen', 0) > 30 * 60e3) visits.push(now);
  set('aurelle.visits', visits);
  set('aurelle.seen', now);
  addEventListener('pagehide', () => set('aurelle.seen', Date.now()));

  // the local event log (ring buffer)
  let log = get('aurelle.events', []);
  const state = { section: null, unit: null };
  function push(type, props) {
    log.push({ type, props: props || {}, at: new Date().toISOString(), url: location.pathname, sent: false });
    if (log.length > 200) log = log.slice(-200);
    set('aurelle.events', log);
    if (uploader) uploader.schedule();
  }

  ['explorer_opened', 'explorer_closed', 'level_switched', 'unit_opened', 'room_opened', 'toggle_3d', 'brochure_downloaded', 'enquiry_submitted', 'cta_whatsapp'].forEach((t) => {
    document.addEventListener('aurelle:' + t, (e) => {
      if (t === 'unit_opened') state.unit = e.detail;
      if (t === 'explorer_closed') state.unit = null;
      push(t, e.detail);
    });
  });

  // which chapter the visitor reaches (once per chapter per page view)
  const seenSections = new Set();
  function watchSections() {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const id = en.target.id || en.target.dataset.chapter;
        if (!id) return;
        state.section = id;
        if (!seenSections.has(id)) { seenSections.add(id); push('section_reached', { section: id }); }
      });
    }, { threshold: 0.35 });
    document.querySelectorAll('main section[id], main [data-chapter]').forEach((s) => io.observe(s));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchSections); else watchSections();

  /* After a chat session exists, new events go up in small batches. */
  let uploader = null;
  function startUploads(send) {
    let timer = null;
    const flush = () => {
      timer = null;
      const batch = drain();
      if (batch.length) send(batch);
    };
    uploader = { schedule() { if (!timer) timer = setTimeout(flush, 15000); }, flush };
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  function drain() {
    const out = log.filter((e) => !e.sent).slice(-50).map(({ type, props, at, url }) => ({ type, props, at, url }));
    log.forEach((e) => { e.sent = true; });
    set('aurelle.events', log);
    return out;
  }

  /* What the assistant should know about the page right now. */
  function context() {
    const X = window.Explorer;
    const pad = (n) => String(n).padStart(2, '0');
    const open = X && X.root && getComputedStyle(X.root).visibility !== 'hidden';
    const unit = open && X.unit ? { unit: pad(X.level) + '-' + X.unit.id, unit_name: X.unit.name, plan: X.unit.plan } : {};
    return { ...unit, level: open ? X.level : null, is3d: Boolean(open && X.unit && X.is3d), section: state.section };
  }

  window.AurelleTrack = {
    anonId: anon,
    attribution: () => ({ first: get('aurelle.ft', {}), last: get('aurelle.lt', {}) }),
    sessions7d: () => get('aurelle.visits', []).length,
    push, drain, context, startUploads,
    recentUnits: () => log.filter((e) => e.type === 'unit_opened').slice(-5).map((e) => e.props),
  };
})();
