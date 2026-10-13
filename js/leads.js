/* ==========================================================
   Leads — enquiry / private-viewing form, brochure download,
   floating WhatsApp button. Any element with data-enquire opens
   the form: data-enquire="viewing" | "brochure" | "unit" (with data-unit).
   Submissions POST JSON to AURELLE.enquiryEndpoint; if that fails the
   visitor is offered WhatsApp and email with their details filled in.
   ========================================================== */
(function () {
  const cfg = window.AURELLE;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const root = $('#enq'), form = $('#enqForm');
  const lenis = () => window.lenis;

  const MODES = {
    viewing: {
      eyebrow: 'Private viewing', title: 'Let’s find your <em>residence.</em>',
      lead: 'Tell us a little about what you’re looking for. A sales consultant will be in touch within one working day.',
      submit: 'Request a private viewing',
    },
    unit: {
      eyebrow: 'Residence enquiry', title: 'This one <em>caught your eye.</em>',
      lead: 'Share your details and we’ll send pricing, payment plans and the full specification for this residence.',
      submit: 'Send my enquiry',
    },
    brochure: {
      eyebrow: 'The brochure', title: 'Take Aurelle <em>with you.</em>',
      lead: 'Thirteen pages of residences, plans, prices and amenities. Your download starts as soon as you send this.',
      submit: 'Download the brochure',
    },
  };

  const wa = (text) => `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(text)}`;
  $('#waBtn').href = wa('Hello, I’m interested in Aurelle Residence, Al Furjan. Could you share availability and prices?');

  let mode = 'viewing', lastFocus = null, lenisWasStopped = false;

  function open(m, unit) {
    mode = MODES[m] ? m : 'viewing';
    const t = MODES[mode];
    root.dataset.mode = mode;
    $('#enqEyebrow').textContent = t.eyebrow;
    $('#enqTitle').innerHTML = t.title;
    $('#enqLead').textContent = t.lead;
    $('#enqSubmit span').textContent = t.submit;
    form.unit.value = unit || '';
    $('#enqUnitNote').textContent = unit || '';
    $('#enqUnitNote').hidden = !unit;
    form.hidden = false;
    $('#enqDone').hidden = true;
    $('#enqErr').textContent = '';
    lastFocus = document.activeElement;
    lenisWasStopped = !!(lenis() && lenis().isStopped);
    lenis() && lenis().stop();
    root.setAttribute('aria-hidden', 'false');
    gsap.timeline()
      .set(root, { visibility: 'visible' })
      .fromTo('.enq__veil', { opacity: 0 }, { opacity: 1, duration: .5 }, 0)
      .fromTo('.enq__media', { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 1, ease: 'expo.inOut' }, 0)
      .fromTo('.enq__media img', { scale: 1.25 }, { scale: 1, duration: 1.6, ease: 'expo.out' }, .2)
      .fromTo('.enq__panel', { xPercent: 100 }, { xPercent: 0, duration: .9, ease: 'expo.inOut' }, .05)
      .fromTo('.enq__body > *, #enqForm > *', { opacity: 0, y: 18 }, { opacity: 1, y: 0, stagger: .035, duration: .6, ease: 'power3.out' }, .55)
      .add(() => form.name.focus({ preventScroll: true }), .7);
  }

  function close() {
    if (root.getAttribute('aria-hidden') === 'true') return;
    root.setAttribute('aria-hidden', 'true');
    gsap.timeline({ onComplete: () => {
      gsap.set(root, { visibility: 'hidden' });
      if (!lenisWasStopped) lenis() && lenis().start();
      lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
    } })
      .to('.enq__panel', { xPercent: 100, duration: .7, ease: 'expo.in' }, 0)
      .to('.enq__media', { clipPath: 'inset(100% 0 0% 0)', duration: .7, ease: 'expo.in' }, 0)
      .to('.enq__veil', { opacity: 0, duration: .4 }, .4);
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-enquire]');
    if (!t) return;
    e.preventDefault();
    open(t.dataset.enquire, t.dataset.unit);
  });
  $('#enqClose').addEventListener('click', close);
  $('.enq__veil').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.getAttribute('aria-hidden') === 'false') { e.stopImmediatePropagation(); close(); }
  }, true);
  // keep Tab inside the dialog
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = $$('button, input:not(.enq__hp), select, textarea, a[href]', root).filter((n) => n.offsetParent !== null);
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // validation: messages appear under the field once it has been touched or on submit
  const RULES = {
    name: (v) => v.trim().length >= 2 || 'Please enter your name.',
    phone: (v) => /^[0-9 ()-]{6,16}$/.test(v.trim()) || 'Please enter a valid phone number.',
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Please enter a valid email address.',
    consent: (_, el) => el.checked || 'Please agree so we can contact you.',
  };
  function check(name) {
    const el = form.elements[name];
    const res = RULES[name](el.value, el);
    const field = el.closest('.field, .consent');
    field.classList.toggle('is-bad', res !== true);
    field.querySelector('.field__msg').textContent = res === true ? '' : res;
    return res === true;
  }
  Object.keys(RULES).forEach((n) => form.elements[n].addEventListener('blur', () => form.elements[n].value && check(n)));
  Object.keys(RULES).forEach((n) => form.elements[n].addEventListener('input', () => form.elements[n].closest('.is-bad') && check(n)));

  const utm = Object.fromEntries([...new URLSearchParams(location.search)].filter(([k]) => k.startsWith('utm_')));

  function payload() {
    const f = form.elements;
    return {
      type: mode, name: f.name.value.trim(), phone: `${f.cc.value} ${f.phone.value.trim()}`, email: f.email.value.trim(),
      unit: f.unit.value || f.interest.value, budget: f.budget.value, contact: (form.querySelector('[name=contact]:checked') || {}).value || '',
      message: f.message.value.trim(), page: location.href, ...utm, at: new Date().toISOString(),
    };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.company.value) return; // honeypot: bots fill every field
    const ok = Object.keys(RULES).map(check).every(Boolean);
    if (!ok) { form.querySelector('.is-bad input, .is-bad select')?.focus(); return; }
    const data = payload();
    root.classList.add('is-sending');
    $('#enqErr').textContent = '';
    try {
      const r = await fetch(cfg.enquiryEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error(r.status);
      done(data);
    } catch (err) {
      const text = `Hello, I'm ${data.name} (${data.phone}, ${data.email}). I'm interested in Aurelle Residence${data.unit ? ' — ' + data.unit : ''}.${data.message ? ' ' + data.message : ''}`;
      $('#enqErr').innerHTML = '';
      const msg = document.createElement('span');
      msg.textContent = 'We couldn’t send that just now. Reach the sales team directly: ';
      const w = Object.assign(document.createElement('a'), { href: wa(text), target: '_blank', rel: 'noopener', textContent: 'WhatsApp' });
      const m = Object.assign(document.createElement('a'), { href: `mailto:${cfg.email}?subject=${encodeURIComponent('Aurelle Residence enquiry')}&body=${encodeURIComponent(text)}`, textContent: 'email' });
      $('#enqErr').append(msg, w, ' or ', m, '.');
    } finally {
      root.classList.remove('is-sending');
    }
  });

  function done(data) {
    const first = data.name.split(' ')[0];
    $('#enqDoneTitle').textContent = mode === 'brochure' ? `Enjoy the read, ${first}.` : `Thank you, ${first}.`;
    $('#enqDoneText').textContent = mode === 'brochure'
      ? 'Your brochure is downloading. A consultant will follow up in case you have questions.'
      : 'A sales consultant will be in touch within one working day to arrange everything.';
    $('#enqDoneWa').href = wa(`Hello, I'm ${data.name}. I just enquired about Aurelle Residence${data.unit ? ' — ' + data.unit : ''}.`);
    if (mode === 'brochure') {
      const a = Object.assign(document.createElement('a'), { href: cfg.brochure, download: 'Aurelle-Residence-Brochure.pdf' });
      document.body.appendChild(a); a.click(); a.remove();
    }
    gsap.timeline()
      .to(form, { opacity: 0, y: -10, duration: .3 })
      .add(() => { form.hidden = true; form.reset(); gsap.set(form, { opacity: 1, y: 0 }); $('#enqDone').hidden = false; })
      .fromTo('#enqDone > *', { opacity: 0, y: 16 }, { opacity: 1, y: 0, stagger: .08, duration: .7, ease: 'power3.out' });
  }

  // the WhatsApp button appears once the visitor is past the opening film
  ScrollTrigger.create({ trigger: '#residences', start: 'top 60%', onEnter: () => document.body.classList.add('show-wa'), onLeaveBack: () => document.body.classList.remove('show-wa') });

  window.Leads = { open, close };
})();
