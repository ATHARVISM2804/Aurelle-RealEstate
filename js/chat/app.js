/* ==========================================================
   "Ask Aurelle" — the AI assistant panel.
   Desktop: a non-modal side panel (the page stays usable).
   Mobile: a modal bottom sheet. Replies stream in sentence by sentence;
   the log never auto-scrolls under the reader.
   ========================================================== */
import { t as strings, RTL, guessLang } from './i18n.js';
import { postStream, api } from './stream.js';
import { h, renderCard } from './cards.js';
import { bookingPicker, contactForm, bookingConfirmation } from './booking.js';

const cfg = window.AURELLE || {};
const A = cfg.assistant || {};
const KEY = 'aurelle.chat';
const mobile = () => matchMedia('(max-width: 860px)').matches;
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };

const state = { ...load(), open: false, busy: false, restored: false };
let lang = state.lang || guessLang();
let T = strings(lang);
let els, controller, lastFocus;

function save() {
  const { sid, t, ref, lang: l, contact, firstName, booking } = state;
  try { localStorage.setItem(KEY, JSON.stringify({ sid, t, ref, lang: l, contact, firstName, booking })); } catch (e) { /* private mode */ }
}

/* ---------- Turnstile (human check), loaded only when the panel opens ---------- */
let tsWidget = null, tsToken = null, tsWaiters = [];
function loadTurnstile() {
  if (!A.turnstileSiteKey || window.turnstile || document.getElementById('cf-ts')) return;
  window.__axTs = () => renderTurnstile();
  document.head.append(h('script', { id: 'cf-ts', src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__axTs', async: true, defer: true }));
}
function renderTurnstile() {
  if (tsWidget != null || !window.turnstile) return;
  tsWidget = window.turnstile.render(els.ts, {
    sitekey: A.turnstileSiteKey, appearance: 'interaction-only', size: 'flexible',
    callback: (tok) => { tsToken = tok; tsWaiters.splice(0).forEach((f) => f(tok)); },
    'error-callback': () => { tsWaiters.splice(0).forEach((f) => f(null)); },
  });
}
/* A fresh single-use token; resets the widget for the next one. */
function token() {
  if (!A.turnstileSiteKey) return Promise.resolve(null);
  const take = (tok) => { tsToken = null; if (window.turnstile && tsWidget != null) setTimeout(() => window.turnstile.reset(tsWidget), 50); return tok; };
  if (tsToken) return Promise.resolve(take(tsToken));
  loadTurnstile();
  return new Promise((res) => { tsWaiters.push((tok) => res(take(tok))); setTimeout(() => res(null), 15000); });
}

/* ---------- panel ---------- */
function build() {
  const head = h('header', { class: 'ax__head' },
    h('div', { class: 'ax__id' },
      h('span', { class: 'ax__mark', 'aria-hidden': 'true' }, h('svg', { viewBox: '-2 6 104 128' })),
      h('div', {}, h('p', { class: 'ax__title', id: 'axTitle' }), h('p', { class: 'ax__sub' }, h('span', { class: 'ax__badge' }), h('span', { class: 'ax__subtext' })))),
    h('div', { class: 'ax__tools' },
      h('button', { class: 'ax__human', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: toggleMenu }),
      h('button', { class: 'ax__close', type: 'button', onclick: close }, h('span', { class: 'ax__x', 'aria-hidden': 'true' }))),
    h('div', { class: 'ax__menu', hidden: true }));
  const log = h('div', { class: 'ax__log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'data-lenis-prevent': '', tabindex: '0' });
  const newer = h('button', { class: 'ax__newer', type: 'button', hidden: true, onclick: () => log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' }) });
  const chips = h('div', { class: 'ax__chips' });
  const input = h('textarea', { rows: '1', maxlength: '1000', enterkeyhint: 'send', 'aria-label': 'Message' });
  const sendBtn = h('button', { class: 'ax__send', type: 'submit' }, h('i', { 'aria-hidden': 'true' }));
  const form = h('form', { class: 'ax__composer' }, input, sendBtn);
  const legal = h('p', { class: 'ax__legal' });
  const ts = h('div', { class: 'ax__ts' });
  const panel = h('section', { class: 'ax', id: 'ax', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'axTitle', 'aria-hidden': 'true', 'data-lenis-prevent': '' },
    h('div', { class: 'ax__grip', 'aria-hidden': 'true' }), head, log, newer, chips, form, legal, ts);
  const lightbox = h('div', { class: 'ax__lightbox', hidden: true, onclick: () => { lightbox.hidden = true; } }, h('img', { alt: '' }), h('p', {}));
  panel.append(lightbox);
  document.body.append(panel);
  // the emblem from the site header
  const logo = document.querySelector('.hdr__logo svg, svg.emblem');
  if (logo) { const mark = logo.cloneNode(true); mark.removeAttribute('class'); mark.removeAttribute('style'); panel.querySelector('.ax__mark svg').replaceWith(mark); }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
  log.addEventListener('scroll', () => { if (nearBottom()) newer.hidden = true; }, { passive: true });
  panel.addEventListener('keydown', onKey, true);
  // phones: a tap on the dimmed backdrop (the body's ::after) closes the sheet
  document.addEventListener('click', (e) => { if (state.open && mobile() && (e.target === document.body || e.target === document.documentElement)) close(); });
  if (window.visualViewport) visualViewport.addEventListener('resize', () => { if (state.open && mobile()) panel.style.height = Math.min(visualViewport.height * 0.94, innerHeight * 0.88) + 'px'; });
  els = { panel, head, log, newer, chips, input, form, legal, ts, sendBtn, menu: head.querySelector('.ax__menu'), lightbox };
  applyStrings();
}

function applyStrings() {
  T = strings(lang);
  const p = els.panel;
  p.setAttribute('dir', RTL.has(lang) ? 'rtl' : 'ltr');
  p.setAttribute('lang', lang === 'hi-Latn' ? 'hi-Latn' : lang);
  p.querySelector('.ax__title').textContent = A.name || T.title;
  p.querySelector('.ax__badge').textContent = T.badge;
  p.querySelector('.ax__subtext').textContent = T.sub;
  p.querySelector('.ax__human').textContent = T.human;
  p.querySelector('.ax__close').setAttribute('aria-label', T.close);
  els.input.placeholder = T.placeholder;
  els.sendBtn.setAttribute('aria-label', T.send);
  els.newer.textContent = T.newer + ' ↓';
  els.legal.replaceChildren(T.legal + ' ');
  const launcher = document.getElementById('axLauncher');
  if (launcher) launcher.querySelector('span').textContent = T.launcher;
  els.menu.replaceChildren(
    cfg.whatsapp ? h('a', { href: `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(prefill())}`, target: '_blank', rel: 'noopener', onclick: () => track('cta_whatsapp', { from: 'chat_menu' }) }, T.whatsapp) : null,
    A.phone ? h('a', { href: 'tel:' + A.phone.replace(/[^\d+]/g, '') }, `${T.call} · ${A.phone}`) : null,
    h('button', { type: 'button', onclick: () => { toggleMenu(); addCard({ kind: 'form', data: { purpose: 'callback' } }); } }, T.callback));
}
const prefill = () => `Hello, I was chatting with the Aurelle assistant${state.ref ? ` (ref ${state.ref})` : ''}.`;

function toggleMenu() {
  const btn = els.head.querySelector('.ax__human');
  const open = els.menu.hidden;
  els.menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) { applyStrings(); els.menu.querySelector('a,button')?.focus(); }
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (!els.lightbox.hidden) { els.lightbox.hidden = true; }
    else if (!els.menu.hidden) toggleMenu();
    else close();
    e.preventDefault(); e.stopImmediatePropagation();
    return;
  }
  if (e.key === 'Tab' && mobile()) {           // the sheet is modal on phones: keep focus inside
    const f = [...els.panel.querySelectorAll('a[href],button:not([disabled]),textarea,input,select,[tabindex="0"]')].filter((x) => x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

export async function open() {
  if (!els) build();
  if (state.open) { els.input.focus(); return; }
  state.open = true;
  lastFocus = document.activeElement;
  document.body.classList.add('ax-open');
  els.panel.setAttribute('aria-hidden', 'false');
  els.panel.setAttribute('aria-modal', String(mobile()));
  if (mobile()) { window.lenis && window.lenis.stop(); els.panel.style.height = ''; }
  document.getElementById('axLauncher')?.setAttribute('aria-expanded', 'true');
  track('chat_opened', {});
  if (!state.sid) loadTurnstile();
  if (!state.restored) await restore();
  setTimeout(() => els.input.focus({ preventScroll: true }), 320);
}

export function close() {
  if (!state.open) return;
  state.open = false;
  document.body.classList.remove('ax-open');
  els.panel.setAttribute('aria-hidden', 'true');
  els.menu.hidden = true;
  if (mobile()) window.lenis && window.lenis.start();
  document.getElementById('axLauncher')?.setAttribute('aria-expanded', 'false');
  closedBeacon();
  (lastFocus && document.contains(lastFocus) ? lastFocus : document.getElementById('axLauncher'))?.focus({ preventScroll: true });
}

/* ---------- history ---------- */
async function restore() {
  state.restored = true;
  if (state.sid) {
    try {
      const r = await api(`${A.api}/session?sid=${encodeURIComponent(state.sid)}&t=${encodeURIComponent(state.t)}`);
      if (r.lang) setLang(r.lang);
      state.ref = r.ref; state.contact = r.contact; state.firstName = r.first_name; state.booking = r.booking;
      save();
      addDisclosure();
      for (const m of r.messages) {
        if (m.role === 'user') addUser(m.content);
        else { const msg = addAssistant(); setText(msg, m.content); for (const c of m.cards) addCard(c, msg); msg.classList.remove('is-pending'); }
      }
      setChips(defaultChips());
      els.log.scrollTop = els.log.scrollHeight;
      startUploads();
      return;
    } catch (e) {
      Object.assign(state, { sid: null, t: null, ref: null });
      save();
    }
  }
  addDisclosure();
  greet();
}

function addDisclosure() {
  els.log.append(h('p', { class: 'ax__disclosure', text: T.disclosure }));
}

/* A greeting from what the visitor is looking at — no network, no model call. */
function greet() {
  const ctx = window.AurelleTrack ? window.AurelleTrack.context() : {};
  const msg = addAssistant();
  setText(msg, ctx.unit ? T.greetUnit(ctx) : T.greet);
  msg.classList.remove('is-pending');
  setChips(ctx.unit
    ? [T.chipAvail, T.chipSimilar, T.chipPlan, T.chipVisit].map((x, i) => ({ label: x, send: i === 0 ? `Is ${ctx.unit} available?` : i === 1 ? `Show me homes similar to ${ctx.unit}` : i === 2 ? `Show me the floor plan of ${ctx.unit}` : null, action: i === 3 ? 'book' : null }))
    : ctx.section === 'location' ? [T.chipCommute, T.chipVisit, T.chipAmen].map((x) => ({ label: x, send: x }))
      : defaultChips());
}
const defaultChips = () => (state.booking
  ? [{ label: T.directions, send: T.chipWhere }, { label: T.chipAmen, send: T.chipAmen }, { label: T.human, action: 'human' }]
  : [T.chipWhat, T.chipVisit, T.chipWhere, T.chipAmen].map((x) => ({ label: x, send: x === T.chipVisit ? null : x, action: x === T.chipVisit ? 'book' : null })));

/* ---------- rendering ---------- */
function addUser(text) {
  els.log.append(h('div', { class: 'ax__msg ax__msg--user' }, h('p', { text })));
}
function addAssistant() {
  const msg = h('div', { class: 'ax__msg ax__msg--bot is-pending' }, h('p', { class: 'ax__text' }), h('span', { class: 'ax__typing', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('div', { class: 'ax__cards' }));
  els.log.append(msg);
  return msg;
}
function setText(msg, text) { msg.querySelector('.ax__text').textContent = text; }
function appendText(msg, text) { msg.querySelector('.ax__text').append(document.createTextNode(text)); msg.classList.remove('is-pending'); }

const ctx = () => ({
  T, lang, project: cfg.project || 'aurelle', apiBase: A.api,
  auth: () => ({ sid: state.sid, t: state.t }),
  token, track,
  hasContact: () => Boolean(state.contact),
  setContact: (first) => { state.contact = true; state.firstName = first || state.firstName; save(); },
  setBooking: (b, first) => { state.booking = b; state.contact = true; state.firstName = first || state.firstName; save(); setChips(defaultChips()); },
  showBooking: (opts) => showBooking(opts),
  view3d: (level, id, code) => {
    track('unit_card_3d', { code });
    if (window.Explorer && window.Explorer.goto) { if (mobile()) close(); window.Explorer.goto(level, id); }
  },
  lightbox: (src, caption) => { els.lightbox.querySelector('img').src = src; els.lightbox.querySelector('p').textContent = caption; els.lightbox.hidden = false; },
  contactForm: (d) => contactForm(d, ctx()),
  bookingPicker: (d) => bookingPicker(d, ctx()),
  bookingConfirmation: (d) => bookingConfirmation(d, ctx()),
});

function addCard(card, msg) {
  const el = renderCard(card, ctx());
  if (!el) return;
  if (!msg) { msg = addAssistant(); msg.classList.remove('is-pending'); }
  msg.querySelector('.ax__cards').append(el);
  msg.classList.remove('is-pending');
}

/* "Book a visit" from a card or chip opens the picker straight away (no model round trip). */
async function showBooking({ unit_code } = {}) {
  if (state.booking) { addCard({ kind: 'booking_done', data: state.booking }); return; }
  if (!state.sid) { send(T.chipVisit); return; }
  addCard({ kind: 'booking', data: { kind: 'site_visit', unit_code, days: [] } });
  scrollToLatest();
}

function setChips(items) {
  els.chips.replaceChildren(...(items || []).slice(0, 4).map((c) => h('button', {
    type: 'button', class: 'ax__chip',
    onclick: () => (c.action === 'book' ? showBooking({ unit_code: window.AurelleTrack?.context().unit })
      : c.action === 'human' ? addCard({ kind: 'human', data: { whatsapp: cfg.whatsapp, phone: A.phone, ref: state.ref, prefill: prefill() } })
        : send(c.send || c.label)),
  }, c.label)));
}

const nearBottom = () => els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 40;
function scrollToLatest() { els.log.scrollTo({ top: els.log.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
/* Bring the start of a new reply into view once, then leave the reader alone. */
function revealStart(msg) {
  const top = msg.offsetTop - 12;
  if (els.log.scrollTop < top) els.log.scrollTo({ top: Math.min(top, els.log.scrollHeight), behavior: 'smooth' });
}
function watchOverflow() { if (!nearBottom()) els.newer.hidden = false; }

function setLang(l) { if (l && l !== lang) { lang = l; state.lang = l; applyStrings(); } }

/* ---------- sending ---------- */
async function send(raw) {
  const text = String(raw || '').trim();
  if (!text || state.busy) return;
  state.busy = true;
  els.input.value = ''; els.input.style.height = 'auto';
  els.chips.replaceChildren();
  els.menu.hidden = true;
  addUser(text);
  scrollToLatest();
  const msg = addAssistant();
  els.log.setAttribute('aria-busy', 'true');
  els.form.classList.add('is-busy');
  let first = true;
  const track = window.AurelleTrack;
  const body = {
    project: cfg.project || 'aurelle', text, client_id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    context: track ? track.context() : {}, lang,
  };
  if (state.sid) Object.assign(body, { sid: state.sid, t: state.t });
  else Object.assign(body, { anon_id: track && track.anonId, attribution: track && track.attribution(), sessions_7d: track && track.sessions7d(), turnstile: await token() });
  if (track) body.events = track.drain();
  controller = new AbortController();
  try {
    await postStream(A.endpoint, body, (event, d) => {
      if (event === 'meta') {
        const isNew = !state.sid;
        Object.assign(state, { sid: d.sid, t: d.t, ref: d.ref });
        setLang(d.lang);
        save();
        if (isNew) startUploads();
      } else if (event === 'text') {
        appendText(msg, d.d);
        if (first) { first = false; revealStart(msg); }
        watchOverflow();
      } else if (event === 'card') {
        addCard(d, msg);
        if (first) { first = false; revealStart(msg); }
        watchOverflow();
      } else if (event === 'chips') setChips(d.items);
      else if (event === 'error' && d.code !== 'duplicate') { msg.classList.remove('is-pending'); if (!msg.querySelector('.ax__text').textContent) setText(msg, d.message || T.error); }
    }, controller.signal);
  } catch (e) {
    msg.classList.remove('is-pending');
    if (e.code === 'cap_reached' || e.code === 'not_configured') {
      setText(msg, e.code === 'cap_reached' ? T.limit : T.offline);
      addCard({ kind: 'human', data: { whatsapp: cfg.whatsapp, phone: A.phone, ref: state.ref, prefill: prefill() } }, msg);
    }
    else if (e.code === 'bad_session') { Object.assign(state, { sid: null, t: null }); save(); setText(msg, T.error); setChips([{ label: T.retry, send: text }]); }
    else { setText(msg, e.message && e.status === 429 ? e.message : T.error); setChips([{ label: T.retry, send: text }]); }
  } finally {
    msg.classList.remove('is-pending');
    els.log.removeAttribute('aria-busy');
    els.form.classList.remove('is-busy');
    state.busy = false;
    if (!els.chips.childElementCount) setChips(defaultChips());
  }
}

/* ---------- events ---------- */
function track(type, props) { if (window.AurelleTrack) window.AurelleTrack.push(type, props); }
let uploading = false;
function startUploads() {
  if (uploading || !window.AurelleTrack || !state.sid) return;
  uploading = true;
  window.AurelleTrack.startUploads((events) => beacon({ events, sessions_7d: window.AurelleTrack.sessions7d() }));
}
function beacon(extra) {
  if (!state.sid) return;
  const body = JSON.stringify({ sid: state.sid, t: state.t, ...extra });
  if (navigator.sendBeacon) navigator.sendBeacon(`${A.api}/events`, new Blob([body], { type: 'text/plain' }));
  else fetch(`${A.api}/events`, { method: 'POST', body, keepalive: true });
}
function closedBeacon() {
  if (!state.sid) return;
  const events = window.AurelleTrack ? window.AurelleTrack.drain() : [];
  beacon({ events: [...events, { type: 'chat_closed', at: new Date().toISOString() }] });
}
addEventListener('pagehide', () => { if (state.open) closedBeacon(); });
