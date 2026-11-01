/* ==========================================================
   Residence explorer v2 — building → floor plate → unit (2D / 3D)
   Plans are rendered images (Google Flow); unit overlays are traced
   polygons in a 1000 × 562.5 space that matches the 16:9 plate image
   (see js/plates.js).
   ========================================================== */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const LEVELS = 16;
  const PENTHOUSE_FROM = 15;
  const VB_W = 1000, VB_H = 558;

  const COLORS = { blue: '#3a78e0', green: '#4f9a52', lilac: '#8f93ec', olive: '#c8c23a', navy: '#3438b0', orange: '#e2952d' };

  const PLANS = window.UNIT_PLANS;
  const ROOMS = window.UNIT_ROOMS;
  const ROOM_TYPES = window.ROOM_TYPES;
  const PLATES = window.FLOOR_PLATES;

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const pad = (n) => String(n).padStart(2, '0');
  const img = (name) => `assets/img/${name}.webp`;

  /* availability and prices come from window.INVENTORY (js/config.js) */
  const INV = window.INVENTORY;
  function unitStatus(n, u) {
    const id = pad(n) + '-' + u.id;
    return INV.sold.includes(id) ? 'sold' : INV.reserved.includes(id) ? 'reserved' : 'available';
  }
  function unitPrice(n, u) {
    const v = INV.from[u.plan] * (1 + INV.perLevel * (n - 1));
    return `${INV.currency} ${(v / 1e6).toFixed(2)}M`;
  }
  const STATUS = { sold: 'Sold', reserved: 'Reserved', available: 'Available' };

  function levelInfo(n) {
    const pent = n >= PENTHOUSE_FROM;
    const plate = pent ? PLATES.penthouse : PLATES.typical;
    const types = [...new Set(plate.units.map((u) => u.name))].join(' · ');
    const shared = pent ? 'Levels 15 & 16' : (n % 2 === 0 ? 'Levels 02, 04, 08 & 10' : 'Levels 01, 03, 05 & 07');
    const sold = plate.units.filter((u) => unitStatus(n, u) !== 'available').length;
    return { n, pent, plate, types, shared, sold, avail: plate.units.length - sold };
  }

  const ptsArr = (pts) => pts.trim().split(/\s+/).map((p) => p.split(',').map(Number));
  function bbox(pts) {
    const p = ptsArr(pts), xs = p.map((a) => a[0]), ys = p.map((a) => a[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  const clipFor = (pts) => 'polygon(' + ptsArr(pts).map(([x, y]) => `${(x / VB_W) * 100}% ${(y / VB_H) * 100}%`).join(',') + ')';

  function drawOverlays(svg, plate, { mini = false, active = null, level = 0, onPick, onHover } = {}) {
    svg.innerHTML = '';
    plate.units.forEach((u) => {
      const st = level ? unitStatus(level, u) : 'available';
      const g = el('g', { class: 'u-shape' + (active === u.id ? ' is-active' : '') + (st !== 'available' ? ' is-' + st : ''), 'data-id': u.id }, svg);
      el('polygon', { points: u.pts, class: 'u-fill', fill: COLORS[u.color], 'fill-opacity': mini ? (active === u.id ? .85 : .12) : .42, stroke: COLORS[u.color], 'stroke-width': mini ? 6 : 2 }, g);
      if (mini) return;
      g.addEventListener('mouseenter', () => { svg.classList.add('has-hover'); g.classList.add('is-hover'); onHover && onHover(u); });
      g.addEventListener('mouseleave', () => { svg.classList.remove('has-hover'); g.classList.remove('is-hover'); onHover && onHover(null); });
      g.addEventListener('click', () => onPick(u));
    });
  }

  const Explorer = {
    level: 4,
    unit: null,
    is3d: false,
    busy: false,

    init() {
      this.root = $('#explorer');
      this.stage = $('#xpStage');
      this.plateEl = $('#plate');
      this.svg = $('#plateSvg');
      this.tip = $('#xpTip');

      const ol = $('#rulerXp');
      for (let n = LEVELS; n >= 1; n--) {
        const li = document.createElement('li');
        li.textContent = pad(n);
        li.dataset.level = n;
        li.addEventListener('click', () => this.switchLevel(n));
        ol.appendChild(li);
      }
      $('#backBuilding').addEventListener('click', () => this.close());
      $('#backFloor').addEventListener('click', () => this.backToFloor());
      $('#view3d').addEventListener('click', () => this.toggle3d());
      $('#roomvBack').addEventListener('click', () => this.closeRoom());
      $('#roomvPrev').addEventListener('click', () => this.stepRoom(-1));
      $('#roomvNext').addEventListener('click', () => this.stepRoom(1));
      this.root.addEventListener('mousemove', (e) => { this.tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 16}px)`; });
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || this.root.style.visibility !== 'visible') return;
        this.whenFree(() => (this.room != null ? this.closeRoom() : this.unit ? this.backToFloor() : this.close()));
      });
      // warm the decoder for every plan so the first open is instant
      const urls = [PLATES.typical.img, PLATES.penthouse.img, ...Object.values(PLANS).flatMap((p) => [p.d2, p.d3])];
      setTimeout(() => urls.forEach((u) => { const i = new Image(); i.src = img(u); i.decode().catch(() => {}); }), 4000);
    },

    fillFloor(n) {
      const info = levelInfo(n);
      this.level = n;
      this.plate = info.plate;
      $('#floorTitle').textContent = 'Level ' + pad(n);
      $('#floorTypes').textContent = info.types;
      $('#floorShared').textContent = 'Floorplate shared with ' + info.shared.toLowerCase();
      $('#floorCaption').textContent = info.plate.caption;
      $('#plateImg').src = img(info.plate.img);
      $('#plateFocus').src = img(info.plate.img);
      gsap.set('#plateFocus', { opacity: 0 });
      drawOverlays(this.svg, info.plate, {
        level: n,
        onPick: (u) => this.openUnit(u),
        onHover: (u) => {
          if (u) {
            const st = unitStatus(n, u);
            this.tip.innerHTML = '';
            const b = document.createElement('b'); b.textContent = u.name;
            const i = document.createElement('i'); i.textContent = st === 'available' ? 'From ' + unitPrice(n, u) : STATUS[st];
            this.tip.append(b, i);
          }
          this.tip.classList.toggle('is-on', !!u);
        },
      });
      document.querySelectorAll('#rulerXp li').forEach((li) => li.classList.toggle('is-on', +li.dataset.level === n));
      return info;
    },

    // beamY: viewport y of the light beam, so the plate rises out of that floor
    open(n, beamY) {
      if (this.busy) return;
      this.busy = true;
      window.lenis && window.lenis.stop();
      this.fillFloor(n);
      const fromY = (beamY ?? innerHeight / 2) - innerHeight / 2;
      gsap.set(this.root, { visibility: 'visible', opacity: 1 });
      gsap.set('#floorView', { visibility: 'visible', opacity: 1 });
      gsap.set('#unitView', { visibility: 'hidden', opacity: 0 });
      gsap.set(this.stage, { visibility: 'visible', opacity: 1, x: 0, y: 0, scale: 1 });
      gsap.set('#plateImg', { filter: 'none' });
      gsap.timeline()
        .add(() => { this.busy = false; }, 1.15) // units clickable as soon as the plate has landed
        .fromTo('.explorer__dim', { opacity: 0 }, { opacity: 1, duration: 1, ease: 'power2.inOut' }, 0)
        .fromTo('.explorer__grid', { opacity: 0 }, { opacity: 1, duration: .8 }, .3)
        .fromTo(this.plateEl,
          { y: fromY, rotateX: 74, scale: .46, opacity: 0 },
          { y: 0, rotateX: 0, scale: 1, opacity: 1, duration: 1.5, ease: 'expo.inOut' }, .1)
        .fromTo('#plateSvg .u-shape', { opacity: 0 }, { opacity: 1, stagger: .06, duration: .5, clearProps: 'opacity' }, 1.1)
        .fromTo('#floorView .xp-head > *, .plate__tag, #floorCaption, #rulerXp', { opacity: 0, y: 12 }, { opacity: 1, y: 0, stagger: .04, duration: .7, ease: 'power3.out' }, 1);
    },

    // clicks during a transition are queued, never dropped
    whenFree(fn) { if (this.busy) setTimeout(() => this.whenFree(fn), 80); else fn(); },

    switchLevel(n) {
      if (this.busy) return this.whenFree(() => this.switchLevel(n));
      if (n === this.level) return;
      if (this.unit) this.backToFloor(true);
      const up = n > this.level;
      gsap.timeline()
        .to(this.plateEl, { y: up ? 40 : -40, opacity: 0, duration: .3, ease: 'power2.in' })
        .add(() => this.fillFloor(n))
        .fromTo(this.plateEl, { y: up ? -40 : 40, opacity: 0 }, { y: 0, opacity: 1, duration: .55, ease: 'power3.out' })
        .fromTo('#plateSvg .u-shape', { opacity: 0 }, { opacity: 1, stagger: .05, duration: .4, clearProps: 'opacity' }, '<.15');
    },

    close() {
      if (this.busy) return this.whenFree(() => this.close());
      this.busy = true;
      gsap.timeline({ onComplete: () => {
        gsap.set([this.root, '#floorView', '#unitView', this.stage], { visibility: 'hidden' });
        this.unit = null; this.busy = false;
        window.lenis && window.lenis.start();
      } })
        .to('#floorView .xp-head > *, .plate__tag, #floorCaption, #rulerXp', { opacity: 0, duration: .3 })
        .to(this.plateEl, { rotateX: 74, scale: .46, opacity: 0, duration: .9, ease: 'expo.in' }, 0)
        .to('.explorer__grid', { opacity: 0, duration: .5 }, .2)
        .to('.explorer__dim', { opacity: 0, duration: .7 }, .3)
        .to(this.root, { opacity: 0, duration: .3 }, .75);
    },

    openUnit(u) {
      if (this.busy) return this.whenFree(() => this.openUnit(u));
      this.busy = true;
      this.unit = u;
      this.tip.classList.remove('is-on');
      const info = levelInfo(this.level);
      const plan = PLANS[u.plan];
      $('#unitLevel').textContent = 'Level ' + pad(this.level);
      $('#unitTitle').textContent = u.name;
      $('#unitType').textContent = u.type;
      $('#unitShared').textContent = info.shared;
      $('#unitPos').textContent = u.pos;
      const st = unitStatus(this.level, u);
      $('#unitPrice').textContent = st === 'sold' ? 'Sold' : 'From ' + unitPrice(this.level, u);
      $('#unitStatus').textContent = STATUS[st];
      $('#unitStatus').dataset.status = st;
      $('#unitEnquire').dataset.unit = `${u.name} · Level ${pad(this.level)} · Unit ${u.id}`;
      $('#unitEnquire').firstChild.textContent = st === 'sold' ? 'Ask about similar residences ' : 'Enquire about this residence ';
      $('#unitAreas').replaceChildren(...[['Apartment area', u.areas[0]], ['Balcony area', u.areas[1]], ['Total area', u.areas[2]]].map(([k, v]) => {
        const li = document.createElement('li');
        li.textContent = `${k} = ${v} sq ft`;
        return li;
      }));
      $('#plan2d').src = img(plan.d2);
      $('#plan3d').src = img(plan.d3);
      gsap.set('#entryMark', { left: plan.entry[0] + '%', top: plan.entry[1] + '%' });
      $('#keyImg').src = img(info.plate.img);
      drawOverlays($('#keySvg'), info.plate, { mini: true, active: u.id });
      this.is3d = false;
      gsap.set('#plan2d', { opacity: 1, rotateX: 0, scale: 1 });
      gsap.set('#plan3d', { opacity: 0, rotateX: -18, scale: .94 });
      gsap.set('.unit__card .reveal--2d', { opacity: 1 });
      $('#view3d').firstChild.textContent = 'View in 3D ';
      this.buildRooms(u);

      // isolate the unit, then zoom the plate toward it
      const b = bbox(u.pts);
      const r = this.plateEl.getBoundingClientRect();
      const cx = ((b.x0 + b.x1) / 2 / VB_W - .5) * r.width;
      const cy = ((b.y0 + b.y1) / 2 / VB_H - .5) * r.height;
      const z = Math.min(2.6, .7 / Math.max((b.x1 - b.x0) / VB_W, (b.y1 - b.y0) / VB_H * (r.height / r.width)));
      $('#plateFocus').style.clipPath = clipFor(u.pts);
      gsap.timeline({ onComplete: () => { this.busy = false; } })
        .to('#plateSvg .u-shape:not([data-id="' + u.id + '"])', { opacity: 0, duration: .35 }, 0)
        .to('#plateImg', { filter: 'brightness(.18) saturate(.4)', duration: .5 }, 0)
        .to('#plateFocus', { opacity: 1, duration: .5 }, 0)
        .to('#floorView .xp-head > *, .plate__tag, #floorCaption', { opacity: 0, duration: .3 }, 0)
        .to(this.stage, { x: -cx * z, y: -cy * z, scale: z, duration: 1, ease: 'expo.inOut' }, .2)
        .to(this.stage, { opacity: 0, duration: .45 }, .95)
        .set('#floorView', { visibility: 'hidden' })
        .set('#unitView', { visibility: 'visible', opacity: 1 }, 1.05)
        .fromTo('.unit__card', { opacity: 0, scale: .96, y: 20 }, { opacity: 1, scale: 1, y: 0, duration: 1, ease: 'expo.out' }, 1.05)
        .fromTo('#unitView .xp-head > *', { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: .05, duration: .7, ease: 'power3.out' }, 1.15)
        .fromTo('.unit__card .reveal', { opacity: 0 }, { opacity: 1, stagger: .06, duration: .5 }, 1.4)
        .fromTo('#unitRooms', { opacity: 0 }, { opacity: 1, duration: .4 }, 1.6);
      // outline the rooms once so it is clear they can be opened (outside the timeline, so it never holds `busy`)
      gsap.delayedCall(1.8, () => $('#unitRooms').classList.add('is-hint'));
      gsap.delayedCall(3.4, () => $('#unitRooms').classList.remove('is-hint'));
    },

    /* ---------- rooms: zoom into the plan, then open the room's render ---------- */
    buildRooms(u) {
      this.rooms = ROOMS[u.plan] || [];
      this.room = null;
      const box = $('#unitRooms');
      box.replaceChildren(...this.rooms.map((r, i) => {
        const b = document.createElement('button');
        b.className = 'unit__room';
        const label = document.createElement('span');
        label.textContent = this.roomName(r);
        b.setAttribute('aria-label', 'Step inside: ' + label.textContent);
        b.appendChild(label);
        b.addEventListener('click', () => this.openRoom(i));
        return b;
      }));
      this.placeRooms();
      gsap.set('#roomView', { visibility: 'hidden', opacity: 0 });
    },

    roomName: (r) => r.name || ROOM_TYPES[r.type].name,

    placeRooms() {
      const key = this.is3d ? 'd3' : 'd2';
      [...$('#unitRooms').children].forEach((b, i) => {
        const [x0, y0, x1, y1] = this.rooms[i][key];
        Object.assign(b.style, { left: x0 + '%', top: y0 + '%', width: (x1 - x0) + '%', height: (y1 - y0) + '%' });
      });
    },

    fillRoom(i) {
      const r = this.rooms[i], t = ROOM_TYPES[r.type];
      this.room = i;
      $('#roomvTitle').textContent = this.roomName(r);
      $('#roomvLine').textContent = t.line;
      $('#roomvMeta').textContent = `Level ${pad(this.level)} · ${this.unit.name}`;
      $('#roomvCount').textContent = `${pad(i + 1)} / ${pad(this.rooms.length)}`;
    },

    // the 2D plan image's box on screen (the 3D model is framed to match it exactly)
    planRect() { return $('#unitZoom').getBoundingClientRect(); },

    // a room opens as a live 3D model: the flat plan lifts into walls and the camera flies in
    openRoom(i) {
      if (this.busy) return this.whenFree(() => this.openRoom(i));
      this.busy = true;
      this.fillRoom(i);
      const plan = PLANS[this.unit.plan].d2;
      gsap.set('#roomView', { visibility: 'visible', opacity: 0 });
      gsap.set('.roomv__text > *, .roomv__back, .roomv__nav, .roomv__tip', { opacity: 0 });
      Model3D.open(plan, this.rooms[i].d2, this.planRect()).then(({ tl: fly }) => {
        gsap.timeline({ onComplete: () => { this.busy = false; } })
          .to('.unit__card .reveal, #unitRooms', { opacity: 0, duration: .3 }, 0)
          .to('#roomView', { opacity: 1, duration: this.is3d ? .6 : .25 }, 0)
          .to(['#plan2d', '#plan3d'], { opacity: 0, duration: .3 }, .2)
          .add(fly.play(), 0)
          .fromTo('.roomv__text > *, .roomv__back, .roomv__nav', { opacity: 0, y: 16 }, { opacity: 1, y: 0, stagger: .06, duration: .7, ease: 'power3.out' }, 1.3)
          .fromTo('.roomv__tip', { opacity: 0 }, { opacity: .5, duration: .6 }, 1.9);
      }).catch(() => { this.busy = false; });
    },

    stepRoom(dir) {
      if (this.room == null) return;
      if (this.busy) return this.whenFree(() => this.stepRoom(dir));
      this.busy = true;
      const i = (this.room + dir + this.rooms.length) % this.rooms.length;
      gsap.timeline({ onComplete: () => { this.busy = false; } })
        .to('.roomv__text > *', { opacity: 0, y: -12, duration: .25, stagger: .03 }, 0)
        .add(() => this.fillRoom(i), .3)
        .add(Model3D.focus(this.rooms[i].d2), .1)
        .fromTo('.roomv__text > *', { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: .05, duration: .6, ease: 'power3.out' }, .9);
    },

    closeRoom(instant) {
      if (this.room == null) return;
      const planOpacity = () => {
        gsap.set('#plan2d', { opacity: this.is3d ? 0 : 1 });
        gsap.set('#plan3d', { opacity: this.is3d ? 1 : 0 });
      };
      if (instant) {
        this.room = null;
        Model3D.stop();
        gsap.set('#roomView', { visibility: 'hidden', opacity: 0 });
        planOpacity();
        gsap.set('#unitRooms, .unit__card .reveal:not(.reveal--2d)', { opacity: 1 });
        gsap.set('.unit__card .reveal--2d', { opacity: this.is3d ? 0 : 1 });
        return;
      }
      if (this.busy) return this.whenFree(() => this.closeRoom());
      this.busy = true;
      this.room = null;
      const show = this.is3d ? '#plan3d' : '#plan2d';
      gsap.timeline({ onComplete: () => { this.busy = false; } })
        .to('.roomv__text > *, .roomv__back, .roomv__nav, .roomv__tip', { opacity: 0, duration: .25 }, 0)
        .add(Model3D.close(this.planRect()), 0)
        .set(show, { opacity: 1 }, 1.45)
        .to('#roomView', { opacity: 0, duration: this.is3d ? .6 : .25 }, 1.5)
        .set('#roomView', { visibility: 'hidden' })
        .add(() => Model3D.stop())
        .to('#unitRooms, .unit__card .reveal:not(.reveal--2d)', { opacity: 1, duration: .4 }, 1.6)
        .to('.unit__card .reveal--2d', { opacity: this.is3d ? 0 : 1, duration: .4 }, 1.6);
    },

    backToFloor(instant) {
      if (!instant && this.busy) return this.whenFree(() => this.backToFloor());
      this.closeRoom(true);
      this.unit = null;
      const restore = () => {
        gsap.set('#unitView', { visibility: 'hidden', opacity: 0 });
        gsap.set('#floorView', { visibility: 'visible', opacity: 1 });
        gsap.set(this.stage, { visibility: 'visible', opacity: 1 });
        gsap.set('#plateImg', { filter: 'none' });
        gsap.set('#plateFocus', { opacity: 0 });
        gsap.set('#plateSvg .u-shape', { clearProps: 'opacity' });
        gsap.set('#floorView .xp-head > *, .plate__tag, #floorCaption', { opacity: 1, y: 0 });
      };
      if (instant) { restore(); gsap.set(this.stage, { x: 0, y: 0, scale: 1 }); return; }
      if (this.busy) return this.whenFree(() => this.backToFloor());
      this.busy = true;
      gsap.timeline({ onComplete: () => { this.busy = false; } })
        .to('#unitView', { opacity: 0, duration: .35 })
        .add(restore)
        .fromTo(this.stage, { opacity: 0 }, { opacity: 1, duration: .35 })
        .to(this.stage, { x: 0, y: 0, scale: 1, duration: 1, ease: 'expo.inOut' }, '<')
        .fromTo('#floorView .xp-head > *, .plate__tag, #floorCaption', { opacity: 0 }, { opacity: 1, stagger: .03, duration: .5 }, '-=.4');
    },

    toggle3d() {
      if (!this.unit) return;
      if (this.busy) return this.whenFree(() => this.toggle3d());
      if (this.room != null) { this.closeRoom(); return this.whenFree(() => this.toggle3d()); }
      this.is3d = !this.is3d;
      gsap.to('#unitRooms', { opacity: 0, duration: .3, onComplete: () => { this.placeRooms(); gsap.to('#unitRooms', { opacity: 1, duration: .5, delay: .6 }); } });
      $('#view3d').firstChild.textContent = this.is3d ? 'View in 2D ' : 'View in 3D ';
      const show = this.is3d ? '#plan3d' : '#plan2d', hide = this.is3d ? '#plan2d' : '#plan3d';
      gsap.timeline()
        .to(hide, { opacity: 0, rotateX: this.is3d ? 22 : -18, scale: .94, duration: .7, ease: 'power3.in' }, 0)
        .to(show, { opacity: 1, rotateX: 0, scale: 1, duration: 1, ease: 'expo.out' }, .35)
        .to('.unit__card .reveal--2d', { opacity: this.is3d ? 0 : 1, duration: .4 }, 0);
    },
  };

  window.Explorer = Explorer;
  window.levelInfo = levelInfo;
  window.EXPLORER_LEVELS = LEVELS;
})();
