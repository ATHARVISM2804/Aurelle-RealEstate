/* ==========================================================
   FrameSequence — scroll-scrubbed image sequence on <canvas>
   Frames come from AI video clips as AVIF in two tiers (tools/make-frames-avif.sh):
   assets/seq/<name>/hd/ (1920 px, every frame) for large screens on a good connection,
   assets/seq/<name>/sd/ (1280 px, every 2nd frame) for phones, small tablets and data-saver.
   Each tier: 0001.avif … + manifest.json { count, width, height, ext }

   Smoothness:
   - frames are downloaded and decoded in a small pool of Web Workers, so a
     decode (AVIF takes tens of ms at 1080p) never lands on the main thread;
     each worker keeps its frames compressed and hands back ImageBitmaps
   - download order: frame 0, then a sparse "coarse" set across the whole
     film, then outward from the playhead — the frames you are about to see
     always arrive first
   - only a window of frames around the playhead is decoded, so memory stays
     bounded; the window leans in the scroll direction and, on a fast scroll,
     spreads out (every 2nd–4th frame) so it still covers the film ahead
   - frames are decoded at the size they are drawn, and the canvas is never
     larger than the frames themselves (CSS stretches it), so each paint is cheap
   - a paint blends the two nearest frames by the fractional position, and a
     sharp frame replacing a soft fallback crossfades in instead of popping
   - a film whose section is far off-screen sleeps: it drops its sharp frames
     and stops downloading all but the coarse set
   ========================================================== */
(function () {
  const WINDOW = 30;   // sharp frames kept per sequence
  const AHEAD = 22;    // of which this many sit in the scroll direction
  const MAX_DPR = 1.5;
  const FADE = 140;    // ms for a sharp frame to replace a soft one
  const FIRST = 40;    // frames from the start that count towards `warm`
  // soft fallback frames: one every few frames, ~110 per film, at a third of the drawn size
  const coarseStep = (count) => Math.max(4, Math.ceil(count / 110));

  const conn = navigator.connection || {};
  const TIER = (Math.min(screen.width, innerWidth) >= 1100 && !conn.saveData && !/2g|3g/.test(conn.effectiveType || '')) ? 'hd' : 'sd';
  // AVIF support (all current browsers; older ones keep the poster image instead of the film)
  const avifOK = new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i.width > 0); i.onerror = () => res(false);
    i.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';
  });

  // worker pool: fetch + createImageBitmap off the main thread; bitmaps come back transferred (zero-copy)
  // small on purpose: more decode threads starve the browser's own compositor and raster threads
  const POOL = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
  const DECODES = 4; // concurrent decodes per sequence
  const pool = (() => {
    const code = `const blobs = new Map();
      onmessage = async (e) => {
        const { op, id, url, rw, rh } = e.data;
        try {
          if (op === 'fetch') {
            const r = await fetch(url);
            if (!r.ok) throw 0;
            const b = await r.blob();
            blobs.set(url, b);
            postMessage({ id, ok: true, size: b.size });
          } else {
            const b = blobs.get(url);
            if (!b) throw 0;
            const bmp = await createImageBitmap(b, rw ? { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'medium' } : undefined);
            postMessage({ id, ok: true, bmp }, [bmp]);
          }
        } catch (err) { postMessage({ id, ok: false }); }
      };`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const workers = Array.from({ length: POOL }, () => new Worker(url));
    const pending = new Map();
    let seq = 0;
    workers.forEach((w) => { w.onmessage = (e) => { const p = pending.get(e.data.id); pending.delete(e.data.id); if (p) e.data.ok ? p.res(e.data) : p.rej(); }; });
    // a frame always goes to the same worker (k), since that worker holds its compressed bytes
    return (k, msg) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); workers[k % POOL].postMessage({ ...msg, id }); });
  })();
  let salt = 0;

  class FrameSequence {
    constructor(canvas, name) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.name = name;
      this.salt = salt++;
      this.bitmaps = new Map(); // index -> sharp ImageBitmap
      this.coarse = new Map();  // index -> soft ImageBitmap
      this.decoding = new Set();
      this.fetching = new Set();
      this.pos = 0; // fractional frame index
      this.dir = 1;
      this.vel = 0; // frames per second, smoothed
      this.stride = 1;
      this.lastT = 0;
      this.awake = true;
      this.wasSoft = false;
      this.fadeAt = 0;
      this.dirty = false;
      this.started = false;
      this.ready = new Promise((res, rej) => { this._res = res; this._rej = rej; }); // first frame on screen
      this.warm = new Promise((res) => { this._warm = res; });                       // coarse set + opening frames
      this.paint = this.paint.bind(this);
      this._wakeWaiters = [];
      window.addEventListener('resize', () => {
        cancelAnimationFrame(this._rz);
        this._rz = requestAnimationFrame(() => this.resize());
      });
    }

    start() {
      if (this.started) return this.ready;
      this.started = true;
      this.load().then(this._res, (e) => { this._rej(e); this._warm(); });
      return this.ready;
    }

    async use(tier) {
      const base = `assets/seq/${this.name}/${tier}/`;
      const m = await fetch(base + 'manifest.json').then((r) => { if (!r.ok) throw new Error('no sequence'); return r.json(); });
      // switching tier: drop what the previous one decoded
      for (const m2 of [this.bitmaps, this.coarse]) { m2.forEach((bm) => bm.close()); m2.clear(); }
      this.count = m.count;
      this.w = m.width;
      this.h = m.height;
      this.step = coarseStep(this.count);
      this.fetched = new Uint8Array(this.count);
      this.cq = 0; // next coarse index to fetch
      this.src = (i) => new URL(base + String(i + 1).padStart(4, '0') + '.' + (m.ext || 'webp'), location.href).href;
      this.firstN = Math.min(FIRST, this.count);
      this.coarseN = Math.ceil(this.count / this.step);
      this.coarseDone = 0;
      this.canvas.width = 0; // force resize() to recompute for the new frame size
      this.resize();
    }

    async load() {
      if (!(await avifOK)) throw new Error('no avif');
      await this.use(TIER);
      // a quick throughput probe on the first frames: on a slow link the
      // smaller tier gives a smoother film than a half-loaded large one
      if (TIER === 'hd') {
        const t0 = performance.now();
        const probe = [0, this.step, this.step * 2, this.step * 3, this.step * 4, this.step * 5];
        this.lastFetch = t0;
        const sizes = await Promise.all(probe.map((i) => this.fetchFrame(i)));
        const rate = sizes.reduce((a, b) => a + b, 0) / Math.max(1, this.lastFetch - t0); // bytes per ms, network only
        if (rate < 1500) await this.use('sd');
      }
      await this.fetchFrame(0);
      await this.decode(0);
      this.invalidate();
      // four download loops share the queue; nextFetch() always hands out the most useful frame
      const loop = async () => {
        for (;;) {
          const i = this.nextFetch();
          if (i < 0) {
            if (this.fetchedAll()) return;
            await new Promise((r) => this._wakeWaiters.push(r)); // asleep: wait for wake()
            continue;
          }
          await this.fetchFrame(i);
        }
      };
      for (let k = 0; k < 4; k++) loop();
    }

    fetchedAll() { return this.fetched.every((v) => v !== 0); }

    nextFetch() {
      // the coarse set first, so any scroll position has a near frame early
      while (this.cq < this.count) {
        const i = this.cq;
        this.cq += this.step;
        if (!this.fetched[i] && !this.fetching.has(i)) return i;
      }
      if (!this.awake) return -1;
      // then outward from the playhead, two ahead for every one behind
      const p = Math.round(this.pos), d = this.dir, n = this.count;
      for (let s = 0; s < n; s++) {
        for (const i of [p + 2 * s * d, p + (2 * s + 1) * d, p - s * d]) {
          if (i >= 0 && i < n && !this.fetched[i] && !this.fetching.has(i)) return i;
        }
      }
      return -1;
    }

    async fetchFrame(i) {
      if (this.fetched[i] || this.fetching.has(i)) return 0;
      this.fetching.add(i);
      let size = 0;
      try { size = (await pool(this.salt + i, { op: 'fetch', url: this.src(i) })).size; } catch (e) { this.fetching.delete(i); this.fetched[i] = 2; return 0; }
      this.lastFetch = performance.now();
      this.fetching.delete(i);
      this.fetched[i] = 1;
      if (i % this.step === 0) await this.decodeCoarse(i);
      if (Math.abs(i - this.pos) < AHEAD * this.stride) this.schedule();
      this.checkWarm();
      return size;
    }

    // every few frames one stays decoded at a third of its size, so a fast
    // scroll that outruns the sharp window still shows the right moment
    async decodeCoarse(i) {
      try {
        const { bmp } = await pool(this.salt + i, { op: 'decode', url: this.src(i), rw: Math.round(this.dw / 3), rh: Math.round(this.dh / 3) });
        this.coarse.set(i, bmp);
        this.coarseDone++;
        if (Math.abs(i - this.pos) < this.step * 2) this.invalidate();
      } catch (e) { /* skip */ }
    }

    get loaded() {
      if (!this.count) return 0;
      let first = 0;
      for (let i = 0; i < this.firstN; i++) if (this.fetched[i]) first++;
      return (this.coarseDone + first) / (this.coarseN + this.firstN);
    }

    checkWarm() {
      if (this._warmed || this.coarseDone < this.coarseN - 1) return;
      for (let i = 0; i < this.firstN; i++) if (!this.fetched[i]) return;
      this._warmed = true;
      this._warm();
    }

    async decode(i) {
      if (this.bitmaps.has(i) || this.decoding.has(i) || this.fetched[i] !== 1) return;
      this.decoding.add(i);
      try {
        const { bmp } = await pool(this.salt + i, { op: 'decode', url: this.src(i), rw: this.rw, rh: this.rh });
        // the playhead may have moved on (or the film gone to sleep) while it decoded
        if (i === 0 || (this.awake && this.inWindow(i))) this.bitmaps.set(i, bmp); else bmp.close();
      } catch (e) { /* skip a bad frame */ }
      this.decoding.delete(i);
      if (Math.abs(i - this.pos) <= 4 * this.stride) this.invalidate();
      this.schedule();
    }

    windowRange() {
      const p = Math.round(this.pos), d = this.dir, st = this.stride;
      const span = WINDOW * st, ahead = AHEAD * st;
      const lo = Math.max(0, d > 0 ? p - (span - ahead) : p - ahead);
      return [lo, Math.min(this.count - 1, lo + span - 1)];
    }
    inWindow(i) { const [lo, hi] = this.windowRange(); return i >= lo && i <= hi; }

    // decode the frames around the playhead, nearest first, and drop the far ones
    schedule() {
      if (!this.count || !this.awake) return;
      const [lo, hi] = this.windowRange();
      for (const [i, bm] of this.bitmaps)
        if ((i < lo || i > hi) && i !== 0) { bm.close(); this.bitmaps.delete(i); }
      if (this.decoding.size >= DECODES) return;
      const st = this.stride, d = this.dir;
      const base = Math.round(this.pos / st) * st;
      for (let s = 0; s <= WINDOW; s++) {
        for (const i of [base + s * st * d, base - s * st * d]) {
          if (i < lo || i > hi || this.bitmaps.has(i) || this.decoding.has(i) || this.fetched[i] !== 1) continue;
          this.decode(i);
          if (this.decoding.size >= DECODES) return;
        }
      }
    }

    sleep() {
      if (!this.awake) return;
      this.awake = false;
      for (const [i, bm] of this.bitmaps) if (i !== 0) { bm.close(); this.bitmaps.delete(i); }
    }
    wake() {
      if (this.awake) return;
      this.awake = true;
      this._wakeWaiters.splice(0).forEach((r) => r());
      this.schedule();
      this.invalidate();
    }

    resize() {
      if (!this.w) return;
      const r = this.canvas.getBoundingClientRect();
      if (!r.width) return;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      let cw = r.width * dpr, ch = r.height * dpr;
      // never draw the frames larger than they are: past that, CSS stretches the canvas for free
      const up = Math.max(cw / this.w, ch / this.h);
      if (up > 1) { cw /= up; ch /= up; }
      cw = Math.round(cw); ch = Math.round(ch);
      if (cw === this.canvas.width && ch === this.canvas.height) return; // nothing changed: keep the canvas as is
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      // cover
      const k = Math.max(cw / this.w, ch / this.h);
      this.dw = this.w * k; this.dh = this.h * k;
      this.dx = (cw - this.dw) / 2; this.dy = (ch - this.dh) / 2;
      // decode at the drawn size when that is clearly smaller than the source
      const rw = Math.round(this.dw);
      if (rw < this.w - 16) { this.rw = rw; this.rh = Math.round(this.dh); } else { this.rw = this.rh = 0; }
      this.invalidate();
    }

    invalidate() {
      if (this.dirty) return;
      this.dirty = true;
      requestAnimationFrame(this.paint);
    }

    // the decoded frames either side of pos within `gap` frames, with the blend between them
    pair(map, pos, gap) {
      const lo = Math.floor(pos);
      let a = -1, b = -1;
      for (let i = lo; i >= Math.max(0, lo - gap); i--) if (map.has(i)) { a = i; break; }
      for (let i = lo + 1, e = Math.min(this.count - 1, lo + 1 + gap); i <= e; i++) if (map.has(i)) { b = i; break; }
      if (a >= 0 && b >= 0) return { a: map.get(a), b: map.get(b), f: (pos - a) / (b - a) };
      // one side only: good enough when it is (nearly) the frame itself
      if (a >= 0 && pos - a <= 1) return { a: map.get(a), f: 0 };
      if (b >= 0 && b - pos <= 1) return { a: map.get(b), f: 0 };
      return null;
    }

    nearest(i) {
      let best = null, bd = Infinity;
      for (const m of [this.bitmaps, this.coarse])
        for (const [j, bm] of m) { const dd = Math.abs(j - i); if (dd < bd) { bd = dd; best = bm; } }
      return best && { a: best, f: 0 };
    }

    draw(l, alpha) {
      const c = this.ctx;
      if (l.b && l.f > .98) { c.globalAlpha = alpha; c.drawImage(l.b, this.dx, this.dy, this.dw, this.dh); return; }
      c.globalAlpha = alpha;
      c.drawImage(l.a, this.dx, this.dy, this.dw, this.dh);
      if (l.b && l.f > .02) { c.globalAlpha = alpha * l.f; c.drawImage(l.b, this.dx, this.dy, this.dw, this.dh); }
    }

    paint(now) {
      this.dirty = false;
      if (!this.count || !this.dw) return;
      const pos = this.pos;
      const sharp = this.pair(this.bitmaps, pos, 3 * this.stride);
      const soft = this.pair(this.coarse, pos, this.step);
      if (sharp) {
        if (this.wasSoft && soft) this.fadeAt = now;
        this.wasSoft = false;
        const k = this.fadeAt ? Math.min(1, (now - this.fadeAt) / FADE) : 1;
        if (k < 1 && soft) {
          this.draw(soft, 1);
          this.draw(sharp, k);
          this.invalidate();
        } else {
          this.fadeAt = 0;
          this.draw(sharp, 1);
        }
      } else {
        const l = soft || this.nearest(Math.round(pos));
        if (!l) return;
        this.draw(l, 1);
        this.wasSoft = true;
      }
      this.ctx.globalAlpha = 1;
    }

    // p: 0..1
    set progress(p) {
      if (!this.count) return;
      const pos = Math.min(1, Math.max(0, p)) * (this.count - 1);
      if (Math.abs(pos - this.pos) < 0.01) return;
      const now = performance.now(), dt = now - this.lastT;
      const v = Math.abs(pos - this.pos) / Math.max(dt, 4) * 1000;
      this.vel = dt > 250 ? v : this.vel * .75 + v * .25;
      this.lastT = now;
      // fast scroll: spread the window out (every 2nd–4th frame) so it reaches further ahead
      this.stride = Math.max(1, Math.min(4, Math.round(this.vel / 160)));
      clearTimeout(this._settle);
      this._settle = setTimeout(() => { this.vel = 0; this.stride = 1; this.schedule(); this.invalidate(); }, 140);
      this.dir = pos > this.pos ? 1 : -1;
      this.pos = pos;
      this.schedule();
      this.invalidate();
    }
  }

  window.FrameSequence = FrameSequence;
})();
