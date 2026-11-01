/* ==========================================================
   Aurelle Residence — scroll choreography
   GSAP + ScrollTrigger + Lenis
   ========================================================== */
gsap.registerPlugin(ScrollTrigger, SplitText);

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, '0');
const isMobile = () => window.matchMedia('(max-width: 860px)').matches;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = window.matchMedia('(hover: none), (pointer: coarse)').matches;

/* ---------------- motion language ----------------
   one set of eases and durations for the whole site, so every section
   moves with the same rhythm */
const EASE = { reveal: 'expo.out', move: 'power3.inOut', quick: 'power2.out', curtain: 'expo.inOut' };
const DUR = { reveal: 1.4, move: 1.1, quick: .6 };
const RISE = reduce ? 0 : 1; // reduced motion: reveals fade in place

/* ---------------- smooth scroll ----------------
   One smoother only. Lenis eases the wheel, so scrubbed timelines follow
   it 1:1 (scrub: true) — a second scrub lag on top is what made the old
   scroll feel rubbery. Touch scrolls natively; a short scrub there takes
   the edge off without trailing behind the finger. */
const SCRUB = touch ? .35 : true;
ScrollTrigger.config({ ignoreMobileResize: true });
if (touch) ScrollTrigger.defaults({ anticipatePin: 1 });
const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, stopInertiaOnNavigate: true });
window.lenis = lenis;
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();

/* ---------------- chapter jumps ----------------
   A jump of more than a screen and a half would scrub through the long
   pinned films (hundreds of frames). Instead the green curtain wipes up,
   the page moves behind it in one step, and the curtain lifts. */
const curtain = $('#curtain');
let jumping = false;
function jumpTo(target, { covered = false } = {}) {
  const el = target === 0 ? null : $(target);
  const y = el ? el.getBoundingClientRect().top + window.scrollY : 0;
  if (reduce || Math.abs(y - window.scrollY) < innerHeight * 1.5) {
    lenis.scrollTo(target, { duration: 1.6, force: true });
    return;
  }
  // the chapters menu already covers the screen: move behind it
  if (covered) { lenis.scrollTo(target, { immediate: true, force: true }); ScrollTrigger.update(); return; }
  if (jumping) return;
  jumping = true;
  gsap.timeline({ onComplete: () => { jumping = false; } })
    .set(curtain, { visibility: 'visible' })
    .fromTo(curtain, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: .7, ease: EASE.curtain })
    .fromTo('.curtain__mark', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .5, ease: EASE.quick }, .3)
    .add(() => { lenis.scrollTo(target, { immediate: true, force: true }); ScrollTrigger.update(); })
    .to({}, { duration: .35 }) // a beat for the film at the new spot to decode
    .to('.curtain__mark', { opacity: 0, y: -14, duration: .35, ease: 'power2.in' })
    .to(curtain, { clipPath: 'inset(0% 0% 100% 0%)', duration: .8, ease: EASE.curtain }, '-=.15')
    .set(curtain, { visibility: 'hidden' });
}

$$('[data-scrollto]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const target = a.dataset.scrollto === '#top' ? 0 : a.dataset.scrollto;
    const fromMenu = chapters.style.visibility === 'visible';
    jumpTo(target, { covered: fromMenu });
    if (fromMenu) setTimeout(closeChapters, 120);
  })
);

/* ---------------- split headings ----------------
   words rise through a line mask (SplitText). No per-word blur: animating
   filter on dozens of words repaints every frame. autoSplit re-splits when
   the web fonts arrive or the width changes, and rebuilds the animation. */
function riseWords(el, scrollTrigger, opts = {}) {
  return SplitText.create(el, {
    type: 'lines,words', mask: 'lines', linesClass: 'ln', autoSplit: true,
    onSplit: (self) => gsap.from(self.words, {
      yPercent: 105 * RISE, opacity: 0, duration: DUR.reveal, ease: EASE.reveal, stagger: .06, scrollTrigger, ...opts,
    }),
  });
}

/* ==========================================================
   IMAGES — decode each section's images ~2 screens before it arrives,
   so first paint never stalls the scroll on a WebP decode, and let every
   image fade in once decoded instead of popping in half-drawn
   ========================================================== */
const decoded = new Set();
function decodeUrl(url) {
  if (!url || decoded.has(url)) return Promise.resolve();
  decoded.add(url);
  const img = new Image();
  img.src = url;
  return img.decode().catch(() => {});
}
function decodeWithin(root) {
  // decode the <img> itself, so it is the srcset candidate the browser picked
  const jobs = [...root.querySelectorAll('img')].map((i) => { i.loading = 'eager'; return i.decode().catch(() => {}); });
  [root, ...root.querySelectorAll('[style*="background-image"]')].forEach((el) => {
    const m = /url\(["']?([^"')]+)/.exec(el.style.backgroundImage || '');
    if (m) jobs.push(decodeUrl(m[1]));
  });
  return Promise.all(jobs);
}
function fadeInImages(root = document) {
  $$('main img:not(.is-in)', root).forEach((img) => {
    const show = () => img.classList.add('is-in');
    if (img.complete && img.naturalWidth) return show();
    img.addEventListener('load', () => img.decode().catch(() => {}).then(show), { once: true });
    img.addEventListener('error', show, { once: true });
  });
}
const decodeIO = new IntersectionObserver((entries) => entries.forEach((e) => {
  if (e.isIntersecting) { decodeWithin(e.target); decodeIO.unobserve(e.target); }
}), { rootMargin: '200% 0px' });
$$('main > section').forEach((s) => decodeIO.observe(s));

/* ==========================================================
   LOADER
   ========================================================== */
// The site opens once the opening film is warm (its coarse frames across
// the whole film + the first frames sharp), so the first scroll never
// stutters. The counter shows that real progress; 8 s is the most it waits.
function loader(film) {
  $$('.loader .draw').forEach((p) => {
    const len = p.getTotalLength();
    gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
  });

  const tl = gsap.timeline({ paused: true });
  tl.to('.loader .base', { strokeDashoffset: 0, duration: .8, ease: 'power2.inOut' })
    // the emblem draws itself: arch, then the A, then its crossbar
    .to('.loader .draw:not(.base):not(.bar)', { strokeDashoffset: 0, duration: 1.2, stagger: .18, ease: 'power2.inOut' }, '-=.4')
    .to('.loader .bar', { strokeDashoffset: 0, duration: .5, ease: 'power2.out' }, '-=.4')
    .from('.loader__title', { opacity: 0, y: 10, duration: .8 }, '-=.6')
    .from('.loader__count', { opacity: 0, duration: .6 }, '<')
    .to({}, { duration: .4 });

  // the counter eases toward the real figure, and never runs backwards
  const shown = { v: 0 };
  let target = 0;
  const pct = $('#loaderPct'), bar = $('#loaderBar');
  const tick = () => {
    target = Math.max(target, Math.min(.99, film.s.loaded));
    shown.v += (target - shown.v) * .12;
    pct.textContent = pad(Math.floor(shown.v * 100));
    bar.style.transform = `scaleX(${shown.v})`;
  };
  gsap.ticker.add(tick);

  let ready = false, played = false;
  const finish = () => {
    if (!ready || !played) return;
    ready = false;
    gsap.ticker.remove(tick);
    gsap.timeline()
      .to(shown, { v: 1, duration: .5, ease: EASE.quick, onUpdate: () => { pct.textContent = pad(Math.min(99, Math.floor(shown.v * 100))); bar.style.transform = `scaleX(${shown.v})`; } })
      .add(() => { pct.textContent = '100'; })
      .to('.loader__title, .loader__arch, .loader__count', { opacity: 0, duration: .5 }, '+=.15')
      .to('.loader', { clipPath: 'inset(0 0 100% 0)', duration: 1.1, ease: EASE.curtain }, '-=.1')
      .fromTo('.arrival__title span', { yPercent: 100 * RISE, opacity: 0 }, { yPercent: 0, opacity: 1, stagger: .12, duration: DUR.reveal, ease: EASE.reveal }, '-=.5')
      .fromTo('.arrival__tag, .arrival__dev', { opacity: 0, y: 12 * RISE }, { opacity: 1, y: 0, duration: 1 }, '-=1')
      .add(() => { document.body.classList.remove('is-loading'); gsap.set('.loader', { display: 'none' }); lenis.start(); ScrollTrigger.refresh(); });
  };
  tl.eventCallback('onComplete', () => { played = true; finish(); });
  tl.play();
  const done = () => { ready = true; finish(); };
  Promise.race([
    Promise.all([film.s.warm, document.fonts ? document.fonts.ready : null]),
    new Promise((r) => setTimeout(r, 8000)),
  ]).then(done);
}

/* ==========================================================
   CHAPTERS MENU
   ========================================================== */
const chapters = $('#chapters');
function openChapters() {
  lenis.stop();
  gsap.set(chapters, { visibility: 'visible' });
  gsap.to(chapters, { clipPath: 'inset(0 0 0% 0)', duration: .9, ease: 'expo.inOut' });
  gsap.fromTo('.chapters__list li', { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: .05, duration: .8, delay: .35, ease: 'expo.out' });
}
function closeChapters() {
  if (chapters.style.visibility !== 'visible') return;
  gsap.to(chapters, { clipPath: 'inset(0 0 100% 0)', duration: .8, ease: 'expo.inOut', onComplete: () => { gsap.set(chapters, { visibility: 'hidden' }); } });
  lenis.start();
}
$('#chaptersBtn').addEventListener('click', openChapters);
$('#chaptersClose').addEventListener('click', closeChapters);

/* AI-film frame sequences (see js/sequence.js). If a sequence's frames
   are missing the canvas stays hidden and the image layers play instead. */
function makeSeq(sel, name, onReady, section, { lazy = false } = {}) {
  const o = { c: $(sel), ok: false };
  o.s = new FrameSequence(o.c, name);
  o.s.ready.then(() => { o.ok = true; onReady && onReady(o); }).catch(() => {});
  // a film is awake (keeps sharp frames, downloads around its playhead) from
  // two screens before its section until a screen after it; asleep it keeps
  // only its coarse frames, so the two films never hold memory at once
  const st = ScrollTrigger.create({
    trigger: section, start: 'top 300%', end: 'bottom -100%',
    onToggle: (self) => (self.isActive ? o.s.wake() : o.s.sleep()),
  });
  if (!st.isActive) o.s.sleep();
  // the films carry their own texture: no grain layer over the canvas while one is on screen
  ScrollTrigger.create({ trigger: section, start: 'top bottom', end: 'bottom top', toggleClass: { targets: document.body, className: 'on-film' } });
  // a lazy film starts loading once its section is within ~3 screens
  if (lazy) ScrollTrigger.create({ trigger: section, start: 'top 400%', once: true, onEnter: () => o.s.start() });
  else o.s.start();
  return o;
}

/* ==========================================================
   01 ARRIVAL — one continuous film: above the clouds, down through
   them, over the community, and round to the tower at dusk. The film
   ends on the exact frame the residences section opens with.
   ========================================================== */
const hero = (function arrival() {
  const T = 10; // timeline length; the film runs across all of it
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: { trigger: '.arrival', start: 'top top', end: '+=900%', scrub: SCRUB, pin: '.arrival__stage' },
  });
  tl.to('.arrival__hero', { y: -80, opacity: 0, duration: .8 }, 0)
    .to('.arrival__dev', { opacity: 0, duration: .5 }, 0)
    .to('.layer--clouds', { opacity: 0, duration: .3 }, .2)
    // READY TO RISE. — lands on the cut from the clouds to the tower (film ≈ 48%)
    .to('.rise', { opacity: 1, duration: .5 }, 4.1)
    .from('.rise__title', { y: 40, duration: .7 }, 4.1)
    .from('.rise__sub', { opacity: 0, duration: .4 }, 4.4)
    .to('.rise', { opacity: 0, duration: .5 }, 5.1)
    .fromTo('.rise-ghost', { opacity: 0 }, { opacity: .9, duration: .3 }, 5.1)
    .to('.rise-ghost', { opacity: 0, scale: 1.15, filter: 'blur(14px)', duration: .7 }, 5.4)
    // WHY DUBAI? — while the camera circles the tower
    .to('.why-shade', { opacity: 1, duration: .5 }, 6.2)
    .to('.why', { opacity: 1, duration: .5 }, 6.3)
    .from('.why__title', { y: 30, duration: .5 }, 6.3)
    .to('.why', { opacity: 0, y: -30, duration: .5 }, 8.1)
    .to('.why-shade', { opacity: 0, duration: .6 }, 8.1)
    .to({}, { duration: T - 8.7 }, 8.7);

  const sync = () => { if (film.ok) film.s.progress = tl.time() / T; };
  const film = makeSeq('#seqHero', 'hero', (o) => { o.c.classList.add('is-live'); sync(); }, '.arrival');
  tl.eventCallback('onUpdate', sync);
  return film;
})();
loader(hero);

/* ==========================================================
   02 EXPLORE RESIDENCES
   ========================================================== */
(function residences() {
  Explorer.init();
  const L = window.EXPLORER_LEVELS;
  const ruler = $('#ruler');
  for (let n = L; n >= 1; n--) {
    const li = document.createElement('li');
    li.textContent = pad(n);
    li.dataset.level = n;
    li.addEventListener('mouseenter', () => setLevel(n));
    li.addEventListener('click', () => Explorer.open(n, beamY(n)));
    ruler.appendChild(li);
  }

  const hit = $('#towerHit');
  const bar = $('#lvlBar');
  let current = 8;

  function setLevel(n) {
    current = n;
    const info = levelInfo(n);
    $('#lvlName').textContent = 'Level ' + pad(n);
    $('#lvlTypes').textContent = info.types;
    $('#lvlAvail').textContent = `${info.sold} Sold · ${info.avail} Available`;
    $$('#ruler li').forEach((li) => li.classList.toggle('is-on', +li.dataset.level === n));
    const band = 100 / L;
    gsap.to(bar, { top: `${(L - n) * band + band / 2}%`, yPercent: -50, duration: .35, ease: 'power3.out' });
  }
  // viewport y of a level's band on the tower
  const beamY = (n) => { const r = hit.getBoundingClientRect(); return r.top + ((L - n) + .5) * (r.height / L); };
  const levelFromEvent = (e) => {
    const r = hit.getBoundingClientRect();
    const rel = gsap.utils.clamp(0, .999, (e.clientY - r.top) / r.height);
    return L - Math.floor(rel * L);
  };
  hit.addEventListener('mousemove', (e) => { const n = levelFromEvent(e); if (n !== current) setLevel(n); });
  hit.addEventListener('click', (e) => { const n = levelFromEvent(e); Explorer.open(n, beamY(n)); });
  setLevel(8);

  gsap.from('.residences__info > *, .residences__foot > *', {
    y: 24, opacity: 0, stagger: .08, duration: 1, ease: 'expo.out',
    scrollTrigger: { trigger: '.residences', start: 'top 60%' },
  });
})();

/* ==========================================================
   03 ENTRANCE → LOBBY → RESIDENCE — one continuous tour film
   ========================================================== */
(function tour() {
  const T = 10;
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: '.lobby', start: 'top top', end: '+=1800%', scrub: SCRUB, pin: '.lobby__stage',
      onUpdate: (st) => gsap.set('#tourBar', { scaleX: st.progress }),
    },
  });
  // caption windows, in timeline units (film: entrance 0–1.6, lobby –2.8, lift –3.35, living –4.65,
  // bedroom –6.2, balcony –8.1, roof terrace)
  const caps = $$('.tour__cap');
  [[0, 1.5], [1.7, 2.75], [2.85, 3.3], [3.45, 4.6], [4.75, 6.1], [6.3, 8.0], [8.2, T]].forEach(([a, b], i) => {
    tl.fromTo(caps[i], { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: .4, ease: 'power2.out' }, a);
    if (b < T) tl.to(caps[i], { opacity: 0, y: -24, duration: .3, ease: 'power2.in' }, b - .3);
  });
  tl.to({}, { duration: 0 }, T);
  const sync = () => { if (seq.ok) seq.s.progress = tl.time() / T; };
  const seq = makeSeq('#seqTour', 'tour', (o) => { o.c.classList.add('is-live'); sync(); }, '.lobby', { lazy: true });
  tl.eventCallback('onUpdate', sync);
  // once the opening film is warm, quietly fetch the tour's coarse frames
  // too, so a fast scroll (or a chapter jump) into the lobby lands on a picture
  hero.s.warm.then(() => setTimeout(() => seq.s.start(), 1500));
})();

const FULL = 'inset(0px 0px 0px 0px round 0px 0px 0px 0px)';

/* ==========================================================
   04 STEP INSIDE — arches rise one by one
   ========================================================== */
(function inside() {
  const cards = $$('.arch-card');
  gsap.timeline({ scrollTrigger: { trigger: '.arches', start: 'top 90%', end: 'center 55%', scrub: SCRUB } })
    .from('.arch-card .arch', { clipPath: 'inset(100% 0% 0% 0%)', stagger: .35, duration: 1, ease: 'power2.out' })
    .from('.arch-card .arch img', { scale: 1.35, stagger: .35, duration: 1 }, 0)
    .from('.arch-card > :not(.arch)', { opacity: 0, y: 14, stagger: .05, duration: .5 }, .9);

  gsap.from('.sprig path', { strokeDasharray: 600, strokeDashoffset: 600, duration: 3, ease: 'power2.out', scrollTrigger: { trigger: '.inside', start: 'top 70%' } });

  // Room overlay — the arch expands to fill the screen
  const ROOMS = {
    living: { n: '01', t: 'The<br>Living Room', s: 'Space to gather, light to linger.', m: 'Double-height glazing · Oak floors' },
    kitchen: { n: '02', t: 'The<br>Kitchen', s: 'Where the day begins.', m: 'Italian joinery · Stone island' },
    bedroom: { n: '03', t: 'The<br>Bedroom', s: 'Rooms made to return to.', m: 'Floor-to-ceiling glass · Skyline views' },
    bathroom: { n: '04', t: 'The<br>Bathroom', s: 'A private ritual, every day.', m: 'Natural stone · Rain shower' },
  };
  const room = $('#room');
  let lastArch = null;

  const archClip = (r) => {
    const t = r.top, l = r.left, rt = innerWidth - r.right, b = innerHeight - r.bottom, rad = r.width / 2;
    return `inset(${t}px ${rt}px ${b}px ${l}px round ${rad}px ${rad}px 0px 0px)`;
  };

  cards.forEach((c) =>
    c.addEventListener('click', () => {
      const d = ROOMS[c.dataset.room];
      lastArch = c.querySelector('.arch');
      const im = c.querySelector('img');
      $('#roomImg').src = im.currentSrc || im.src;
      $('#roomNum').textContent = d.n;
      $('#roomTitle').innerHTML = d.t;
      $('#roomSub').textContent = d.s;
      $('#roomMeta').textContent = d.m;
      lenis.stop();
      gsap.timeline()
        .set(room, { visibility: 'visible', clipPath: archClip(lastArch.getBoundingClientRect()) })
        .fromTo('#roomImg', { scale: 1.25 }, { scale: 1, duration: 1.4, ease: 'expo.inOut' }, 0)
        .to(room, { clipPath: FULL, duration: 1.4, ease: 'expo.inOut' }, 0)
        .to('.room__shade, .room__back, .room__meta', { opacity: 1, duration: .6 }, 1)
        .fromTo('.room__text > *', { opacity: 0, y: 30 }, { opacity: 1, y: 0, stagger: .1, duration: 1, ease: 'expo.out' }, 1);
    })
  );
  const closeRoom = () => {
    gsap.timeline({ onComplete: () => { gsap.set(room, { visibility: 'hidden' }); lenis.start(); } })
      .to('.room__text > *, .room__shade, .room__back, .room__meta', { opacity: 0, duration: .4 })
      .to(room, { clipPath: archClip(lastArch.getBoundingClientRect()), duration: 1.1, ease: 'expo.inOut' }, .2)
      .to('#roomImg', { scale: 1.2, duration: 1.1, ease: 'expo.inOut' }, .2);
  };
  $('#roomBack').addEventListener('click', closeRoom);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && room.style.visibility === 'visible') closeRoom(); });
})();

/* ==========================================================
   05 AMENITIES — pinned; scrolling steps through the twelve.
   Each new image rises in a curtain (two opposite translates, GPU only).
   ========================================================== */
(function amenities() {
  const ITEMS = [
    ['Zen Garden', 'A quiet green pause between home and the city.', 'garden-vertical.webp', 'Wellness'],
    ['Yoga Studio', 'Soft light, sprung floors, room to breathe.', 'yoga.webp', 'Wellness'],
    ['Modern Well-Equipped Gym', 'Strength, cardio and functional training.', 'gym-equipment.webp', 'Fitness'],
    ['Walking Track', 'A loop for the beginning and end of every day.', 'track.webp', 'Fitness'],
    ['Adults Swimming Pool', 'Long, calm lengths above the community.', 'pool-deck.webp', 'Leisure'],
    ['Steam Room & Lockers', 'Heat, stillness and somewhere to leave it all.', 'sauna.webp', 'Wellness'],
    ['Open Terrace for Socials', 'Long tables for friends and late sunsets.', 'terrace-social.webp', 'Social'],
    ['Jacuzzi', 'Warm water, open sky.', 'jacuzzi.webp', 'Leisure'],
    ['Adults Outdoor Gym', 'Open-air exercise in the shade of the planting.', 'outdoor-gym.webp', 'Fitness'],
    ['Kids Play Area', 'Room for their adventures.', 'kids-play.webp', 'Family'],
    ['Padel Court', 'The game everyone is playing, downstairs.', 'padel.webp', 'Sport'],
    ['Cricket Simulator', 'Net practice, any time of year.', 'cricket.webp', 'Sport'],
  ];
  const N = ITEMS.length;
  const stage = $('#amenStage'), list = $('#amenList');
  const slides = ITEMS.map(([t, , src]) => {
    const d = document.createElement('div');
    d.className = 'amen__slide';
    const im = document.createElement('img');
    const base = 'assets/img/' + src.replace('.webp', '');
    im.srcset = `${base}-1600.webp 1600w, ${base}.webp 2560w`;
    im.sizes = '(max-width: 860px) 92vw, 55vw';
    im.src = base + '.webp'; im.alt = t; im.decoding = 'async';
    d.appendChild(im);
    stage.insertBefore(d, stage.firstChild);
    return d;
  });
  ITEMS.forEach(([t, , , cat], i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="amen__num">${pad(i + 1)}</span><h4></h4><span class="amen__cat">${cat}</span>`;
    li.querySelector('h4').textContent = t;
    li.addEventListener('click', () => {
      const st = pinST;
      if (st) lenis.scrollTo(st.start + (st.end - st.start) * ((i + .5) / N), { duration: 1.4 });
    });
    list.appendChild(li);
  });
  const lis = $$('#amenList li');
  let active = -1, z = 1, lastAt = 0;
  function show(i, dir = 1) {
    if (i === active) return;
    const prev = slides[active];
    active = i;
    // stepping quickly through the list: shorter curtains, so the image keeps up with the list
    const now = performance.now(), d = now - lastAt < 450 ? .55 : DUR.move;
    lastAt = now;
    lis.forEach((li, k) => li.classList.toggle('is-on', k === i));
    const s = slides[i], img = s.firstChild;
    gsap.killTweensOf([s, img]);
    gsap.set(s, { zIndex: ++z, visibility: 'visible' });
    gsap.fromTo(s, { yPercent: 100 * dir }, { yPercent: 0, duration: d, ease: 'expo.inOut' });
    gsap.fromTo(img, { yPercent: -70 * dir, scale: 1.15 }, { yPercent: 0, scale: 1, duration: d, ease: 'expo.inOut' });
    if (prev) {
      gsap.killTweensOf(prev.firstChild);
      gsap.to(prev.firstChild, { yPercent: -18 * dir, duration: d, ease: 'expo.inOut' });
    }
    // counter + caption
    const num = $('#amenNum');
    gsap.timeline()
      .to(['#amenNum', '#amenCat', '#amenDesc'], { yPercent: -40 * dir, opacity: 0, duration: .3, ease: 'power2.in' })
      .add(() => { num.textContent = pad(i + 1); $('#amenCat').textContent = ITEMS[i][3]; $('#amenDesc').textContent = ITEMS[i][1]; })
      .fromTo(['#amenNum', '#amenCat', '#amenDesc'], { yPercent: 40 * dir }, { yPercent: 0, opacity: 1, duration: .6, stagger: .05, ease: 'expo.out' });
  }
  gsap.set(slides, { visibility: 'hidden' });
  gsap.set(slides[0], { visibility: 'visible', zIndex: 1 });
  active = 0; lis[0].classList.add('is-on');
  $('#amenCat').textContent = ITEMS[0][3]; $('#amenDesc').textContent = ITEMS[0][1];

  const pinST = ScrollTrigger.create({
    trigger: '.amenities', start: 'top top', end: () => '+=' + innerHeight * (isMobile() ? 9 : 12),
    pin: '.amen', invalidateOnRefresh: true,
    onUpdate: (st) => {
      const i = Math.min(N - 1, Math.floor(st.progress * N));
      if (i !== active) show(i, i > active ? 1 : -1);
    },
  });

  // intro: stage opens from a line, list rows arrive
  gsap.timeline({ scrollTrigger: { trigger: '.amenities', start: 'top 75%', end: 'top top', scrub: SCRUB } })
    .fromTo('#amenStage', { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', ease: 'power2.out' })
    .from(lis, { opacity: 0, y: 24, stagger: .04, ease: 'power2.out' }, .2);
})();

/* ==========================================================
   06 WELLNESS — horizontal scroll chapter
   ========================================================== */
(function wellness() {
  const track = $('#wTrack');
  const dist = () => track.scrollWidth - innerWidth;
  const h = gsap.to(track, {
    x: () => -dist(), ease: 'none',
    scrollTrigger: {
      trigger: '.wellness', start: 'top top', end: () => '+=' + dist(), pin: '.wellness__pin', scrub: SCRUB,
      invalidateOnRefresh: true,
      onUpdate: (s) => gsap.set('#wBar', { scaleX: s.progress }),
    },
  });

  // images drift inside their frames (the frames themselves stay on the grid)
  $$('.wp').forEach((p) => {
    const st = { trigger: p, containerAnimation: h, start: 'left right', end: 'right left', scrub: true };
    p.querySelectorAll('.wp__frame img, .wp__arch img').forEach((img) =>
      gsap.fromTo(img, { xPercent: -6 }, { xPercent: 6, ease: 'none', scrollTrigger: st }));
    const text = p.querySelectorAll('.wp__text > *, .wp__over > *');
    if (text.length && !p.classList.contains('wp--intro'))
      gsap.from(text, { opacity: 0, y: 30, stagger: .08, duration: 1, ease: 'expo.out',
        scrollTrigger: { trigger: p, containerAnimation: h, start: 'left 70%' } });
    const arch = p.querySelector('.wp__arch');
    if (arch && !p.classList.contains('wp--intro'))
      gsap.from(arch, { clipPath: 'inset(100% 0 0 0)', ease: 'power2.out', scrollTrigger: { trigger: p, containerAnimation: h, start: 'left right', end: 'left 40%', scrub: true } });
  });
  gsap.from('.wp--intro .wp__arch', { clipPath: 'inset(100% 0 0 0)', duration: 1.6, ease: 'expo.inOut', scrollTrigger: { trigger: '.wellness', start: 'top 60%' } });
})();

/* ==========================================================
   07 BY THE WATER → LESS RUSH (circle reveal)
   ========================================================== */
gsap.timeline({
  defaults: { ease: 'none' },
  scrollTrigger: { trigger: '.water', start: 'top top', end: '+=260%', scrub: SCRUB, pin: '.water__pin' },
})
  .fromTo('.water__img', { scale: 1.2 }, { scale: 1, duration: 1.6 }, 0)
  .from('.water__h .l1', { opacity: 0, y: 50 * RISE, duration: .5, ease: EASE.quick }, .1)
  .from('.water__h .l2', { opacity: 0, y: 50 * RISE, duration: .5, ease: EASE.quick }, .35)
  .to('.water__disc', { scale: 1, duration: 1.2, ease: 'power2.in' }, 1.3)
  .fromTo('.water__reveal .eyebrow, .water__reveal .display', { opacity: 0, y: 80 }, { opacity: 1, y: 0, duration: .8 }, 2.2)
  .fromTo('.water__thumb, .mono', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: .5 }, 2.5)
  // the terrace rises over "Less rush." and hands off to the next section
  .fromTo('.water__next', { yPercent: 100, visibility: 'visible' }, { yPercent: 0, duration: 1.1, ease: 'power2.inOut' }, 2.8)
  .fromTo('.water__next img', { scale: 1.35 }, { scale: 1.15, duration: 1.1, ease: 'power2.inOut' }, 2.8)
  .to('.water__reveal .display', { yPercent: -40, opacity: .4, duration: 1.1 }, 2.8);

/* ==========================================================
   08 ABOVE THE EVERYDAY — continues the terrace panel from the water section
   ========================================================== */
gsap.timeline({
  defaults: { ease: 'none' },
  scrollTrigger: { trigger: '.above', start: 'top top', end: '+=220%', scrub: SCRUB, pin: '.above__pin' },
})
  .fromTo('.above__frame img', { scale: 1.15 }, { scale: 1, duration: 1.4 }, 0)
  .from('.above__h', { opacity: 0, yPercent: 30 * RISE, scale: .97, duration: .6, ease: EASE.quick }, .1)
  .to('.above__copy, .above__tag', { opacity: 1, duration: .4 }, .7)
  .to('.above__h', { y: -40, duration: .6 }, 1)
  .to({}, { duration: .3 });

/* ==========================================================
   09 GENERATION / 10 HOME / 11 LIFE
   ========================================================== */
const parallax = (sel, y, trigger) =>
  gsap.fromTo(sel, { y: -y / 2 }, { y: y / 2, ease: 'none', scrollTrigger: { trigger: trigger || sel, start: 'top bottom', end: 'bottom top', scrub: true } });

gsap.from('.gen__arch', { clipPath: 'inset(100% 0 0 0)', duration: 1.8, ease: 'expo.inOut', scrollTrigger: { trigger: '.gen__art', start: 'top 80%' } });
gsap.fromTo('.gen__arch img', { scale: 1.25 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.gen', start: 'top bottom', end: 'bottom top', scrub: true } });
parallax('.gen__portrait', -160, '.gen');
gsap.fromTo('.gen__ghost', { xPercent: 10 }, { xPercent: -30, ease: 'none', scrollTrigger: { trigger: '.gen', start: 'top bottom', end: 'bottom top', scrub: true } });
gsap.from('.gen__lead, .gen__tags li', { opacity: 0, y: 24, stagger: .08, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.gen__lead', start: 'top 85%' } });

// HOME: side frames part, the centre frame opens to full screen, the line lands
(function home() {
  riseWords($('.home__h'), { trigger: '.home', start: 'top 60%' });
  gsap.from('.hf--side, .hf--main', { opacity: 0, y: 60, stagger: .1, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.home', start: 'top 50%' } });
  gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: { trigger: '.home', start: 'top top', end: '+=220%', scrub: SCRUB, pin: '.home__pin' },
  })
    .to('.hf--l', { xPercent: -60, opacity: 0, duration: 1 }, .2)
    .to('.hf--r', { xPercent: 60, opacity: 0, duration: 1 }, .2)
    .to('.home__head', { yPercent: -40, opacity: 0, duration: .8 }, .3)
    .to('.hf--main', { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: 'power2.inOut' }, .2)
    .fromTo('.hf--main img', { scale: 1.3 }, { scale: 1, duration: 1.8 }, .2)
    .to('.home__end', { opacity: 1, duration: .4 }, 1.5)
    .from('.home__end > *', { y: 30, stagger: .1, duration: .4 }, 1.5)
    .to({}, { duration: .4 });
})();

gsap.from('.life__img', { clipPath: 'inset(0 0 100% 0)', duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.life__img', start: 'top 85%' } });
$$('.life__specs li').forEach((li) =>
  gsap.from(li.children, { opacity: 0, y: 30, stagger: .1, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: li, start: 'top 80%' } }));

/* ==========================================================
   12 YOUR WORLD — blur-in + counters
   ========================================================== */
parallax('.reach__bg', 200, '.reach');
gsap.from('.reach__h span, .reach__h em', {
  opacity: 0, yPercent: 30 * RISE, scale: .96, stagger: .25, ease: 'none',
  scrollTrigger: { trigger: '.reach__h', start: 'top 90%', end: 'top 40%', scrub: SCRUB },
});
$$('.reach__stats b').forEach((b) => {
  const o = { v: 0 };
  gsap.to(o, {
    v: +b.dataset.count, duration: 1.8, ease: 'power2.out',
    onUpdate: () => (b.textContent = pad(Math.round(o.v))),
    scrollTrigger: { trigger: '.reach__stats', start: 'top 85%' },
  });
});
gsap.from('.reach__stats li', { opacity: 0, y: 30, stagger: .12, duration: 1, scrollTrigger: { trigger: '.reach__stats', start: 'top 85%' } });

/* ==========================================================
   13 PODIUM — strip opens into the plan
   ========================================================== */
// the plan box sits at its final size; this clips it down to the thin
// line it starts as (70vw wide, 2px high, 66% down the screen)
const podiumLine = () => {
  const w = innerWidth, h = innerHeight, box = w * (isMobile() ? .92 : .84), line = isMobile() ? box : w * .7;
  const side = (box - line) / 2;
  return `inset(${h * .41 - 1}px ${side}px ${h * .25 - 1}px ${side}px)`;
};
gsap.timeline({
  defaults: { ease: 'none' },
  scrollTrigger: { trigger: '.podium', start: 'top top', end: '+=200%', scrub: SCRUB, pin: '.podium__pin', invalidateOnRefresh: true },
})
  .fromTo('.podium__map', { clipPath: podiumLine }, { clipPath: 'inset(0px 0px 0px 0px)', duration: 1, ease: 'power2.inOut' })
  .fromTo('.podium__map img', { scale: 1.6 }, { scale: 1, duration: 1, ease: 'power2.inOut' }, 0)
  .to('.podium .sec-head', { y: -60, opacity: .2, duration: 1 }, 0)
  .to('.pin', { opacity: 1, stagger: .08, duration: .2 }, .9)
  .to({}, { duration: .3 });

/* ==========================================================
   14 FINALE — wordmark, arch window, full reveal
   ========================================================== */
// the arch window: 16vw wide (44vw on phones), 20vh from the top, 50vh tall
const finaleArch = () => {
  const w = innerWidth, h = innerHeight, aw = w * (isMobile() ? .44 : .16), l = (w - aw) / 2;
  return `inset(${h * .2}px ${l}px ${h * .3}px ${l}px round ${aw / 2}px ${aw / 2}px 0px 0px)`;
};
gsap.timeline({
  defaults: { ease: 'none' },
  scrollTrigger: { trigger: '.finale', start: 'top top', end: '+=300%', scrub: SCRUB, pin: '.finale__pin', invalidateOnRefresh: true },
})
  .from('.finale__word', { yPercent: 40, opacity: 0, duration: .6 })
  .from('.finale__arch', { y: '40vh', duration: .7 }, .1)
  .from('.finale__cta', { opacity: 0, y: 30, duration: .4 }, .5)
  .to({}, { duration: .4 })
  .to('.finale__cta, .finale__eyebrow', { opacity: 0, duration: .3 }, 1.3)
  .fromTo('.finale__arch', { clipPath: finaleArch }, { clipPath: FULL, duration: 1.1, ease: 'power2.inOut' }, 1.4)
  .to('.finale__word', { scale: 1.3, opacity: 0, duration: .8 }, 1.5)
  .to('.finale__end', { opacity: 1, duration: .4 }, 2.4)
  .from('.finale__end .display', { y: 30, duration: .4 }, 2.4)
  .to({}, { duration: .3 });

/* ==========================================================
   15 CONTACT + WALKTHROUGH
   ========================================================== */
gsap.from('.contact__main > .eyebrow, .contact__ctas', {
  opacity: 0, y: 20, stagger: .1, duration: 1, scrollTrigger: { trigger: '.contact', start: 'top 60%' },
});
gsap.from('.contact__grid > div', { opacity: 0, y: 30, stagger: .08, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.contact__grid', start: 'top 90%' } });
gsap.fromTo('.contact__word', { yPercent: 30 }, { yPercent: 0, ease: 'none', scrollTrigger: { trigger: '.contact__word', start: 'top bottom', end: 'bottom bottom', scrub: true } });

(function walkthrough() {
  const walk = $('#walk');
  const kb = $('#walkKb');
  const video = $('#walkVideo');
  const bar = $('#walkBar');
  // cues: [seconds, caption] — captions follow the film like the reference's burned-in titles
  const TRACKS = [
    { title: 'The One-Bedroom', video: 'assets/video/walkthrough.mp4', sub: 'The plan, the living and dining, the terrace', n: '01', label: '01 Bedroom<br>floor layout',
      cues: [[0, 'Living and dining'], [3.2, 'Past the kitchen'], [5.6, 'A bedroom made for rest']],
      shots: ['room-living.webp', 'room-kitchen.webp', 'room-bedroom.webp'] },
    { title: 'The Two-Bedroom', video: 'assets/video/walkthrough-2.mp4', sub: 'The plan, both bedrooms, the maid’s room', n: '02', label: '02 Bedroom<br>floor layout',
      cues: [[0, 'Welcome to this spacious home'], [2.4, 'Serving as the central heart']],
      shots: ['plan-2bhk-maid.webp', 'home-1.webp', 'home-3.webp'] },
  ];
  let idx = 0, kbTl = null, seeking = false;
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const setCaption = (txt) => {
    const c = $('#walkCaption');
    if (c.textContent === txt) return;
    gsap.fromTo(c, { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: .6, onStart: () => { c.textContent = txt; } });
  };

  function slideshow(t) {
    video.style.opacity = 0;
    kb.style.opacity = 1;
    kbTl = gsap.timeline({ repeat: -1 });
    t.shots.forEach((img, k) => {
      kbTl.add(() => { kb.style.backgroundImage = `url(assets/img/${img})`; setCaption(t.cues[k][1]); })
        .fromTo(kb, { scale: 1.02, xPercent: -1 }, { scale: 1.14, xPercent: 1, duration: 4.5, ease: 'none' });
    });
  }

  function play(i) {
    idx = (i + TRACKS.length) % TRACKS.length;
    const t = TRACKS[idx];
    $('#walkTitle').textContent = t.title;
    $('#walkSub').textContent = t.sub;
    $('#walkLabel').innerHTML = t.label;
    $('#walkCount').textContent = `${t.n} / 02`;
    kbTl && kbTl.kill();
    walk.classList.add('is-loading');
    gsap.fromTo('.walk__meta > div:first-child', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .6 });
    kb.style.opacity = 0;
    video.style.opacity = 0;
    video.onerror = () => { walk.classList.remove('is-loading'); slideshow(t); };
    video.src = t.video;
    video.load();
    video.play().catch(() => {});
  }

  video.addEventListener('playing', () => { walk.classList.remove('is-loading', 'is-paused'); gsap.to(video, { opacity: 1, duration: .6 }); });
  video.addEventListener('pause', () => walk.classList.add('is-paused'));
  video.addEventListener('waiting', () => walk.classList.add('is-loading'));
  video.addEventListener('loadedmetadata', () => { $('#walkCount').textContent = `${TRACKS[idx].n} / 02 · ${fmt(video.duration)}`; });
  video.addEventListener('timeupdate', () => {
    const t = TRACKS[idx], ct = video.currentTime;
    $('#walkTime').textContent = `${fmt(ct)} / ${fmt(video.duration || 0)}`;
    if (!seeking) gsap.set('#walkBar b', { scaleX: video.duration ? ct / video.duration : 0 });
    let cap = t.cues[0][1];
    t.cues.forEach(([at, txt]) => { if (ct >= at) cap = txt; });
    setCaption(cap);
  });
  video.addEventListener('ended', () => play(idx + 1));

  $('#walkPlay').addEventListener('click', () => (video.paused ? video.play() : video.pause()));
  $('.walk__screen').addEventListener('click', (e) => { if (!e.target.closest('.walk__controls')) video.paused ? video.play() : video.pause(); });
  const seekTo = (e) => {
    const r = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    gsap.set('#walkBar b', { scaleX: f });
    if (video.duration) video.currentTime = f * video.duration;
  };
  bar.addEventListener('pointerdown', (e) => { seeking = true; bar.setPointerCapture(e.pointerId); seekTo(e); });
  bar.addEventListener('pointermove', (e) => seeking && seekTo(e));
  bar.addEventListener('pointerup', () => { seeking = false; });

  function open() {
    lenis.stop();
    const arch = $$('.walk__arch .draw');
    arch.forEach((p) => { const l = p.getTotalLength(); gsap.set(p, { strokeDasharray: l, strokeDashoffset: l, opacity: 1 }); });
    gsap.set('.walk__logo', { opacity: 0, filter: 'blur(20px)', scale: 1.1 });
    gsap.set('.walk__player', { opacity: 0, visibility: 'hidden' });
    gsap.timeline()
      .set(walk, { visibility: 'visible', opacity: 1 })
      .to(arch, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.inOut', stagger: .1 })
      .to(arch, { opacity: 0, duration: .4 })
      .to('.walk__logo', { opacity: 1, filter: 'blur(0px)', scale: 1, duration: 1, ease: 'expo.out' }, '-=.2')
      .to('.walk__logo', { opacity: 0, filter: 'blur(14px)', duration: .6, delay: .6 })
      .add(() => play(0))
      .set('.walk__player', { visibility: 'visible' })
      .to('.walk__player', { opacity: 1, duration: .6 });
  }
  function close() {
    gsap.to(walk, { opacity: 0, duration: .5, onComplete: () => { gsap.set([walk, '.walk__player'], { visibility: 'hidden' }); video.pause(); kbTl && kbTl.kill(); lenis.start(); } });
  }
  $('#walkBtn').addEventListener('click', open);
  $('#walkClose').addEventListener('click', close);
  $('#walkPrev').addEventListener('click', () => play(idx - 1));
  $('#walkNext').addEventListener('click', () => play(idx + 1));
  document.addEventListener('keydown', (e) => {
    if (walk.style.visibility !== 'visible') return;
    if (e.key === 'Escape') close();
    if (e.key === ' ') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
  });
})();

/* ==========================================================
   HAND-OFFS — where a pinned scene gives way to a section of another
   colour, the scene drifts up slower than the page and dissolves into the
   next section's colour, so there is no hard seam. Transform + opacity only.
   ========================================================== */
function handoff(stage, next) {
  const el = $(stage), nx = $(next);
  if (!el || !nx) return;
  // move the scene's children into one layer that can drift as a whole
  const layer = document.createElement('div');
  layer.className = 'handoff';
  while (el.firstChild) layer.appendChild(el.firstChild);
  el.appendChild(layer);
  const veil = document.createElement('i');
  veil.className = 'handoff__veil';
  veil.style.background = getComputedStyle(nx).backgroundColor;
  el.appendChild(veil);
  gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: nx, start: 'top bottom', end: 'top top', scrub: SCRUB } })
    .fromTo(layer, { yPercent: 0 }, { yPercent: 32 * RISE }, 0)
    .fromTo(veil, { opacity: 0 }, { opacity: .9, ease: 'power1.in' }, 0);
}
handoff('.lobby__stage', '.inside');
handoff('.above__pin', '.gen');
handoff('.home__pin', '.life');
handoff('.podium__pin', '.finale');
handoff('.finale__pin', '.contact');

fadeInImages();

/* created last so their positions include every pinned section above them */
/* ==========================================================
   GENERIC — split headings reveal
   ========================================================== */
$$('.split').forEach((h) => riseWords(h, { trigger: h, start: 'top 85%' }));

/* ==========================================================
   HEADER / RAIL THEME + PROGRESS
   ========================================================== */
const sections = $$('main > section');
sections.forEach((sec, i) => {
  ScrollTrigger.create({
    trigger: sec,
    start: 'top 50%',
    end: 'bottom 50%',
    onToggle: (self) => {
      if (!self.isActive) return;
      const light = sec.dataset.theme === 'light';
      $('#hdr').classList.toggle('is-light', light);
      $('#rail').classList.toggle('is-light', light);
      $('#railNum').textContent = pad(i + 1);
    },
  });
});
ScrollTrigger.create({
  start: 0, end: 'max',
  onUpdate: (self) => gsap.set('#railFill', { scaleY: self.progress }),
});

window.addEventListener('load', () => ScrollTrigger.refresh());
