/* In-chat booking: date strip + time chips, contact capture with separate consents, confirmation. */
import { h } from './cards.js';
import { api } from './stream.js';

const CC_FALLBACK = [['+971', 'UAE +971'], ['+91', 'India +91'], ['+966', 'KSA +966'], ['+44', 'UK +44'], ['+1', 'US +1'], ['+974', 'Qatar +974'], ['+965', 'Kuwait +965'], ['+973', 'Bahrain +973'], ['+968', 'Oman +968'], ['+7', 'Russia +7'], ['+86', 'China +86'], ['+49', 'Germany +49']];

function ccSelect(ctx) {
  const sel = h('select', { name: 'cc', 'aria-label': 'Country code' });
  const site = document.querySelector('#enqForm select[name=cc]');
  if (site) for (const o of site.options) sel.append(o.cloneNode(true));
  else for (const [v, l] of CC_FALLBACK) sel.append(h('option', { value: v }, l));
  if (ctx.lang === 'hi' || ctx.lang === 'hi-Latn') sel.value = [...sel.options].some((o) => o.value === '+91') ? '+91' : sel.value;
  return sel;
}

/* Contact fields shared by booking and the contact form. Returns { el, read(), showErrors(map) }. */
function captureFields(ctx, { requireEmail = false } = {}) {
  const T = ctx.T;
  const id = (n) => 'ax-' + n + '-' + Math.random().toString(36).slice(2, 7);
  const field = (name, label, input) => {
    const fid = id(name);
    input.id = fid;
    input.name = name;
    input.placeholder = ' ';
    return h('div', { class: 'axf__field', dataset: { field: name } }, input, h('label', { for: fid, text: label }), h('span', { class: 'axf__msg', 'aria-live': 'polite' }));
  };
  const cc = ccSelect(ctx);
  const consent = (key, label) => h('label', { class: 'axf__check' }, h('input', { type: 'checkbox', name: 'c_' + key }), h('span', { text: label }));
  const el = h('div', { class: 'axf__fields' },
    field('name', T.name, h('input', { type: 'text', autocomplete: 'name', maxlength: '120', required: true })),
    h('div', { class: 'axf__phone' }, cc, field('phone', T.phone, h('input', { type: 'tel', autocomplete: 'tel-national', inputmode: 'tel', maxlength: '20', required: true }))),
    field('email', requireEmail ? T.emailReq : T.email, h('input', { type: 'email', autocomplete: 'email', maxlength: '160', required: requireEmail })),
    h('fieldset', { class: 'axf__consents' }, consent('call', T.consentCall), consent('whatsapp', T.consentWa), consent('marketing', T.consentMkt)),
    h('p', { class: 'axf__note', text: T.consentNote }));
  // a field's error clears as soon as the visitor starts fixing it
  el.addEventListener('input', (e) => {
    const f = e.target.closest('[data-field]');
    if (f && f.classList.contains('is-bad')) { f.classList.remove('is-bad'); f.querySelector('.axf__msg').textContent = ''; }
  });
  const v = (n) => el.querySelector(`[name=${n}]`);
  const read = () => {
    const consents = {}, texts = {};
    for (const k of ['call', 'whatsapp', 'marketing']) { consents[k] = v('c_' + k).checked; texts[k] = v('c_' + k).nextElementSibling.textContent; }
    return { name: v('name').value.trim(), cc: cc.value, phone: v('phone').value.trim(), email: v('email').value.trim(), consents, consent_texts: texts, consent_version: 'chat-v1' };
  };
  const validate = () => {
    const d = read(), errs = {};
    if (d.name.length < 2) errs.name = T.errName;
    if (!/^[0-9 ()-]{6,16}$/.test(d.phone)) errs.phone = T.errPhone;
    if ((requireEmail || d.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) errs.email = T.errEmail;
    showErrors(errs);
    return Object.keys(errs).length ? null : d;
  };
  const showErrors = (errs) => {
    el.querySelectorAll('[data-field]').forEach((f) => {
      const msg = errs[f.dataset.field] || '';
      f.classList.toggle('is-bad', Boolean(msg));
      f.querySelector('.axf__msg').textContent = msg;
    });
    const first = el.querySelector('.is-bad input');
    if (first) first.focus();
  };
  return { el, validate, showErrors };
}

function submitButton(label) {
  return h('button', { class: 'axf__submit', type: 'submit' }, h('span', { text: label }), h('i', { 'aria-hidden': 'true' }));
}

async function withSending(form, btn, T, fn) {
  if (form.classList.contains('is-sending')) return;
  form.classList.add('is-sending');
  btn.disabled = true;
  const label = btn.firstChild.textContent;
  btn.firstChild.textContent = T.sending;
  try { await fn(); } finally { form.classList.remove('is-sending'); btn.disabled = false; btn.firstChild.textContent = label; }
}

export function contactForm(d, ctx) {
  const T = ctx.T;
  const title = { callback: T.callbackT, price_sheet: T.priceSheet, brochure_email: T.brochureT }[d.purpose] || T.callbackT;
  const fields = captureFields(ctx, { requireEmail: d.purpose === 'brochure_email' });
  const btn = submitButton(T.submitContact);
  const err = h('p', { class: 'axf__err', role: 'alert' });
  const form = h('form', { class: 'axc axf', novalidate: true },
    h('p', { class: 'axc__eyebrow', text: title }), d.reason ? h('p', { class: 'axf__lead', text: d.reason }) : null, fields.el, err, btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = fields.validate();
    if (!data) return;
    withSending(form, btn, T, async () => {
      err.textContent = '';
      try {
        const r = await api(ctx.apiBase + '/contact', { method: 'POST', body: { ...data, purpose: d.purpose, ...ctx.auth(), turnstile: await ctx.token(), lang: ctx.lang } });
        ctx.setContact(r.first_name);
        form.replaceWith(h('p', { class: 'axc axc--note axc--ok', text: T.contactDone(r.first_name) }));
      } catch (x) {
        if (x.fields) fields.showErrors(x.fields); else err.textContent = x.message || T.error;
      }
    });
  });
  return form;
}

/* The picker: kind toggle, 7-day strip, time chips (earliest pre-selected), confirm. */
export function bookingPicker(d, ctx) {
  const T = ctx.T;
  const state = { kind: d.kind || 'site_visit', days: d.days || [], selected: d.selected || null, unit: d.unit_code || null };
  const root = h('div', { class: 'axc axb', role: 'group', 'aria-label': T.pick });
  const kinds = h('div', { class: 'axb__kinds', role: 'radiogroup' });
  const strip = h('div', { class: 'axb__days' });
  const slots = h('div', { class: 'axb__slots', role: 'radiogroup', 'aria-label': T.pick });
  const msg = h('p', { class: 'axb__msg', 'aria-live': 'polite' });
  const go = h('button', { class: 'axf__submit', type: 'button' }, h('span', { text: T.confirmAt }), h('i', { 'aria-hidden': 'true' }));
  const capture = h('div', { class: 'axb__capture' });
  let dayIdx = 0;

  const dayOf = (iso) => state.days.findIndex((x) => x.slots.some((s) => s.at === iso));
  const slotOf = (iso) => { for (const x of state.days) for (const s of x.slots) if (s.at === iso) return { day: x, slot: s }; return null; };

  function draw() {
    kinds.replaceChildren(...(d.kinds || ['site_visit', 'video_call']).map((k) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(k === state.kind), class: 'axb__kind' + (k === state.kind ? ' is-on' : ''),
      onclick: () => { if (k !== state.kind) { state.kind = k; reload(); } },
    }, k === 'video_call' ? T.videoCall : T.siteVisit)));
    if (state.selected && dayOf(state.selected) >= 0) dayIdx = dayOf(state.selected);
    else { const first = state.days.findIndex((x) => x.slots.length); dayIdx = first < 0 ? 0 : first; }
    strip.replaceChildren(...state.days.map((x, i) => {
      const [wd, ...rest] = x.label.replace(',', '').split(' ');
      return h('button', { type: 'button', class: 'axb__day' + (i === dayIdx ? ' is-on' : ''), disabled: !x.slots.length, 'aria-pressed': String(i === dayIdx),
        onclick: () => { dayIdx = i; state.selected = x.slots[0]?.at || null; draw(); } }, h('small', { text: wd }), h('b', { text: rest.join(' ') }));
    }));
    const day = state.days[dayIdx];
    slots.replaceChildren(...(day && day.slots.length ? day.slots.map((s) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(s.at === state.selected), class: 'axb__slot' + (s.at === state.selected ? ' is-on' : ''),
      onclick: () => { state.selected = s.at; draw(); },
    }, s.label)) : [h('p', { class: 'axb__none', text: T.noSlots })]));
    const sel = state.selected && slotOf(state.selected);
    go.disabled = !sel;
    go.firstChild.textContent = sel ? `${T.confirmAt} · ${sel.day.label}, ${sel.slot.label}` : T.pick;
  }

  async function reload(note) {
    root.classList.add('is-loading');
    try {
      const r = await api(`${ctx.apiBase}/slots?project=${encodeURIComponent(ctx.project)}&kind=${state.kind}&lang=${ctx.lang}`);
      state.days = r.days;
      state.selected = r.days.find((x) => x.slots.length)?.slots[0]?.at || null;
      msg.textContent = note || '';
      draw();
    } finally { root.classList.remove('is-loading'); }
  }

  async function book(contact) {
    const body = { ...ctx.auth(), kind: state.kind, starts_at: state.selected, unit_code: state.unit, lang: ctx.lang, turnstile: await ctx.token(), ...(contact || {}) };
    try {
      const r = await api(ctx.apiBase + '/bookings', { method: 'POST', body });
      ctx.setBooking(r.booking, r.first_name);
      root.replaceWith(bookingConfirmation(r.booking, ctx));
    } catch (x) {
      if (x.error === 'slot_taken') { capture.replaceChildren(); go.hidden = false; await reload(T.taken); }
      else if (x.error === 'already_booked' && x.booking) { root.replaceWith(h('div', {}, h('p', { class: 'axc axc--note', text: T.already }), bookingConfirmation(x.booking, ctx))); }
      else if (x.fields) throw x;
      else msg.textContent = x.message || T.error;
    }
  }

  go.addEventListener('click', () => {
    if (!state.selected) return;
    if (ctx.hasContact()) { withSending(root, go, T, () => book()); return; }
    go.hidden = true;
    const fields = captureFields(ctx);
    const btn = submitButton(T.submitBook);
    const form = h('form', { class: 'axf', novalidate: true }, h('p', { class: 'axf__lead', text: T.capture }), fields.el, btn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = fields.validate();
      if (!data) return;
      withSending(form, btn, T, async () => { try { await book(data); } catch (x) { if (x.fields) fields.showErrors(x.fields); } });
    });
    capture.replaceChildren(form);
    form.querySelector('input').focus({ preventScroll: true });
  });

  root.append(kinds, strip, slots, msg, go, capture);
  draw();
  if (!state.days.length) reload();
  return root;
}

export function bookingConfirmation(v, ctx) {
  const T = ctx.T;
  return h('article', { class: 'axc axc--done' },
    v.map_img && v.kind === 'site_visit' ? h('div', { class: 'axc__hero', style: `background-image:url(${encodeURI(v.map_img)})` }) : null,
    h('div', { class: 'axc__body' },
      h('p', { class: 'axc__eyebrow', text: v.kind === 'video_call' ? T.bookedVideo : T.booked }),
      h('h4', { class: 'axc__title axc__title--lg', text: v.label }),
      h('p', { class: 'axc__meta', text: [v.kind_label, v.unit_code, v.location].filter(Boolean).join(' · ') }),
      h('div', { class: 'axc__actions axc__actions--wrap' },
        v.maps_url ? h('a', { class: 'axc__btn', href: v.maps_url, target: '_blank', rel: 'noopener' }, T.directions) : null,
        v.ics_url ? h('a', { class: 'axc__btn', href: v.ics_url }, T.addCal) : null,
        v.gcal_url ? h('a', { class: 'axc__btn', href: v.gcal_url, target: '_blank', rel: 'noopener' }, T.gcal) : null,
        v.manage_url ? h('a', { class: 'axc__btn axc__btn--ink', href: v.manage_url, target: '_blank', rel: 'noopener' }, T.reschedule) : null)));
}
