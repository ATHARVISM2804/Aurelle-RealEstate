/* Manage a booked visit from the email / chat link: /visit?b=<booking>&t=<token> */
import { h } from './chat/cards.js';
import { api } from './chat/stream.js';
import { bookingConfirmation } from './chat/booking.js';
import { t as strings } from './chat/i18n.js';

const qs = new URLSearchParams(location.search);
const b = qs.get('b'), tok = qs.get('t');
const T = strings('en');
const $ = (id) => document.getElementById(id);
const ctx = { T, lang: 'en' };
let data;

async function load() {
  if (!b || !tok) return fail('This link is incomplete. Please use the link from your confirmation email.');
  try { data = await api(`/api/p/bookings/manage?b=${encodeURIComponent(b)}&t=${encodeURIComponent(tok)}`); }
  catch (e) { return fail('We could not find this booking. The link may have expired.'); }
  render();
}

function fail(text) {
  $('vTitle').textContent = 'Link not found';
  $('vMsg').textContent = text;
  $('vMsg').classList.add('v__msg--err');
}

function render(note) {
  const v = data.booking;
  const active = ['confirmed', 'reminded'].includes(v.status);
  $('vEyebrow').textContent = v.kind === 'video_call' ? 'Your video call' : 'Your private visit';
  $('vTitle').replaceChildren(...(v.status === 'cancelled' ? ['This visit is ', h('em', { text: 'cancelled.' })] : active ? ['See you ', h('em', { text: 'soon.' })] : ['Your ', h('em', { text: 'visit.' })]));
  const card = bookingConfirmation({ ...v, manage_url: null }, ctx);
  $('vCard').replaceChildren(card);
  $('vMsg').textContent = note || '';
  $('vMsg').classList.remove('v__msg--err');
  $('vPicker').replaceChildren();
  $('vActions').replaceChildren(...(active ? [
    h('button', { class: 'axc__btn axc__btn--ink', type: 'button', onclick: showPicker }, 'Choose another time'),
    h('button', { class: 'axc__btn', type: 'button', onclick: confirmCancel }, 'Cancel this visit'),
  ] : [h('a', { class: 'axc__btn axc__btn--ink', href: '/' }, 'Back to Aurelle Residence')]));
  const p = data.project || {};
  $('vFoot').replaceChildren('Questions? ', p.whatsapp ? h('a', { href: `https://wa.me/${p.whatsapp}`, target: '_blank', rel: 'noopener' }, 'WhatsApp the sales team') : '', p.phone ? [' or call ', h('a', { href: 'tel:' + p.phone.replace(/[^\d+]/g, '') }, p.phone)] : '', '.');
}

function showPicker() {
  let selected = data.days.find((d) => d.slots.length)?.slots[0]?.at || null;
  let dayIdx = Math.max(0, data.days.findIndex((d) => d.slots.length));
  const strip = h('div', { class: 'axb__days' }), slots = h('div', { class: 'axb__slots' });
  const go = h('button', { class: 'axf__submit', type: 'button' }, h('span'), h('i', { 'aria-hidden': 'true' }));
  const draw = () => {
    strip.replaceChildren(...data.days.map((d, i) => {
      const [wd, ...rest] = d.label.replace(',', '').split(' ');
      return h('button', { type: 'button', class: 'axb__day' + (i === dayIdx ? ' is-on' : ''), disabled: !d.slots.length, onclick: () => { dayIdx = i; selected = d.slots[0]?.at; draw(); } }, h('small', { text: wd }), h('b', { text: rest.join(' ') }));
    }));
    const day = data.days[dayIdx];
    slots.replaceChildren(...(day?.slots.length ? day.slots.map((s) => h('button', { type: 'button', class: 'axb__slot' + (s.at === selected ? ' is-on' : ''), onclick: () => { selected = s.at; draw(); } }, s.label)) : [h('p', { class: 'axb__none', text: T.noSlots })]));
    const s = day?.slots.find((x) => x.at === selected);
    go.disabled = !s;
    go.firstChild.textContent = s ? `Move to ${day.label}, ${s.label}` : T.pick;
  };
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const r = await api('/api/p/bookings/manage', { method: 'POST', body: { b, t: tok, action: 'reschedule', starts_at: selected } });
      data = await api(`/api/p/bookings/manage?b=${encodeURIComponent(r.booking.id)}&t=${encodeURIComponent(tok)}`);
      render('Done — your visit has moved. An updated calendar invite is on its way.');
    } catch (e) { $('vMsg').textContent = e.message || T.error; $('vMsg').classList.add('v__msg--err'); go.disabled = false; }
  });
  $('vActions').replaceChildren();
  $('vPicker').replaceChildren(h('div', { class: 'axc axb' }, strip, slots, go));
  draw();
}

function confirmCancel() {
  $('vActions').replaceChildren(
    h('p', { class: 'v__msg', text: 'Cancel this visit? You can always book a new one.' }),
    h('button', { class: 'axc__btn axc__btn--ink', type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { const r = await api('/api/p/bookings/manage', { method: 'POST', body: { b, t: tok, action: 'cancel' } }); data.booking = r.booking; render('Your visit is cancelled.'); }
      catch (x) { $('vMsg').textContent = x.message || T.error; }
    } }, 'Yes, cancel it'),
    h('button', { class: 'axc__btn', type: 'button', onclick: () => render() }, 'Keep my visit'));
}

load();
