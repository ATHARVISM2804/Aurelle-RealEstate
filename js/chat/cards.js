/* Rich cards rendered from tool data (never from model text). DOM built with h(), no innerHTML. */

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const fmtArea = (n) => (n ? Math.round(n).toLocaleString('en-US') : '');

export function unitCard(u, ctx, { compact = false } = {}) {
  const T = ctx.T;
  const status = u.status || 'available';
  const [lvl, id] = u.code.split('-');
  const body = h('div', { class: 'axc__body' },
    h('p', { class: 'axc__eyebrow', text: `${T.level} ${lvl} · ${u.code}` }),
    h('h4', { class: 'axc__title', text: u.name }),
    h('p', { class: 'axc__meta', text: [u.areas_sqft?.total ? `${fmtArea(u.areas_sqft.total)} ${T.sqft}` : '', u.position].filter(Boolean).join(' · ') }),
    h('div', { class: 'axc__row' },
      h('p', { class: 'axc__price', text: u.price_display || '' }),
      h('span', { class: 'axc__status', dataset: { status }, text: T[status] || status })),
    h('div', { class: 'axc__actions' },
      h('button', { class: 'axc__btn', type: 'button', onclick: () => ctx.view3d(Number(lvl), id, u.code) }, T.view3d),
      status !== 'sold' ? h('button', { class: 'axc__btn axc__btn--ink', type: 'button', onclick: () => ctx.showBooking({ unit_code: u.code }) }, T.book) : null),
  );
  const fig = u.plan_img ? h('button', { class: 'axc__img', type: 'button', 'aria-label': `${u.name} floor plan, enlarge`, onclick: () => ctx.lightbox(u.plan_img, `${u.name} · ${u.code}`) },
    h('img', { src: u.plan_img, alt: `${u.name} floor plan`, loading: 'lazy', decoding: 'async' })) : null;
  const card = h('article', { class: 'axc axc--unit' + (compact ? ' axc--compact' : '') }, fig, body);
  if (!compact && u.alternatives?.length) {
    card.append(h('div', { class: 'axc__alts' }, h('p', { class: 'axc__eyebrow', text: T.alternatives }),
      h('div', { class: 'axc__scroller' }, u.alternatives.map((a) => unitCard(a, ctx, { compact: true })))));
  }
  return card;
}

export function renderCard(card, ctx) {
  const T = ctx.T, d = card.data || {};
  switch (card.kind) {
    case 'unit': return unitCard(d, ctx);
    case 'units': return h('div', { class: 'axc axc--list' }, h('div', { class: 'axc__scroller' }, d.units.map((u) => unitCard(u, ctx, { compact: true }))));
    case 'location': return h('article', { class: 'axc axc--place' },
      d.img ? h('div', { class: 'axc__hero', style: `background-image:url(${encodeURI(d.img)})` }) : null,
      h('div', { class: 'axc__body' },
        h('p', { class: 'axc__eyebrow', text: d.title || '' }),
        h('h4', { class: 'axc__title', text: d.address || '' }),
        d.hours ? h('p', { class: 'axc__meta', text: d.hours }) : null,
        d.travel?.length ? h('ul', { class: 'axc__travel' }, d.travel.map((x) => h('li', {}, h('b', { text: String(x.minutes).padStart(2, '0') }), h('span', { text: ` min · ${x.label}` })))) : null,
        d.maps_url ? h('div', { class: 'axc__actions' }, h('a', { class: 'axc__btn', href: d.maps_url, target: '_blank', rel: 'noopener' }, T.directions)) : null));
    case 'amenities': return h('div', { class: 'axc axc--gallery' }, h('div', { class: 'axc__scroller' }, d.items.map((a) => h('figure', { class: 'axc__am' },
      h('img', { src: a.img, alt: a.name, loading: 'lazy', decoding: 'async' }), h('figcaption', {}, h('b', { text: a.name }), h('span', { text: a.desc }))))));
    case 'specs': return h('article', { class: 'axc axc--specs' }, h('ul', {}, d.items.map((s) => h('li', { text: s }))));
    case 'brochure': return h('article', { class: 'axc axc--file' },
      h('div', { class: 'axc__body' }, h('p', { class: 'axc__eyebrow', text: 'PDF' }), h('h4', { class: 'axc__title', text: d.title }),
        h('div', { class: 'axc__actions' }, h('a', { class: 'axc__btn axc__btn--ink', href: d.url, download: '', onclick: () => ctx.track('brochure_downloaded', { via: 'chat' }) }, T.download))));
    case 'human': return humanCard(d, ctx);
    case 'form': return ctx.contactForm(d);
    case 'booking': return ctx.bookingPicker(d);
    case 'booking_done': return ctx.bookingConfirmation(d);
    case 'note': return h('p', { class: 'axc axc--note', text: d.text });
    default: return null;
  }
}

export function humanCard(d, ctx) {
  const T = ctx.T;
  const wa = d.whatsapp ? `https://wa.me/${d.whatsapp}?text=${encodeURIComponent(d.prefill || '')}` : null;
  return h('article', { class: 'axc axc--human' },
    h('div', { class: 'axc__body' },
      h('p', { class: 'axc__eyebrow', text: `${T.ref} ${d.ref || ''}` }),
      h('div', { class: 'axc__stack' },
        wa ? h('a', { class: 'axc__btn axc__btn--wa', href: wa, target: '_blank', rel: 'noopener', onclick: () => ctx.track('cta_whatsapp', { from: 'chat' }) }, T.whatsapp) : null,
        d.phone ? h('a', { class: 'axc__btn', href: 'tel:' + d.phone.replace(/[^\d+]/g, '') }, `${T.call} · ${d.phone}`) : null,
        h('button', { class: 'axc__btn', type: 'button', onclick: (e) => { e.currentTarget.closest('.axc').replaceWith(ctx.contactForm({ purpose: 'callback' })); } }, T.callback))));
}
