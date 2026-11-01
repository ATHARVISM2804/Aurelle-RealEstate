/* ==========================================================
   "Ask Aurelle" launcher. Takes the WhatsApp button's place (WhatsApp
   moves into the assistant's "Talk to a person" menu; the old button
   stays in the page as a fallback if this script fails). The panel code
   (js/chat/*) loads only when the visitor opens it, or quietly once the
   page is idle.
   ========================================================== */
(function () {
  const cfg = window.AURELLE || {};
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!cfg.assistant || !(cfg.assistant.enabled || local) || !window.fetch || !window.ReadableStream) return;
  const base = document.currentScript ? new URL('.', document.currentScript.src).href : '/js/';
  let mod = null;
  const load = () => (mod ||= import(base + 'chat/app.js'));

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'axLauncher';
  btn.className = 'ax-launcher';
  btn.setAttribute('aria-controls', 'ax');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<i aria-hidden="true"></i><span>Ask Aurelle</span>';
  btn.addEventListener('click', () => {
    btn.classList.add('is-loading');
    load().then((m) => (document.body.classList.contains('ax-open') ? m.close() : m.open()))
      .catch(() => { const wa = document.getElementById('waBtn'); if (wa) location.href = wa.href; })
      .finally(() => btn.classList.remove('is-loading'));
  });
  document.body.appendChild(btn);
  document.body.classList.add('has-assistant');

  // a visitor who had a conversation sees it again after a reload
  try { if (JSON.parse(localStorage.getItem('aurelle.chat') || '{}').sid) btn.classList.add('has-history'); } catch (e) { /* ignore */ }

  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1));
  setTimeout(() => idle(() => load().catch(() => {})), 8000);

  window.Assistant = { open: () => load().then((m) => m.open()), close: () => load().then((m) => m.close()) };
})();
