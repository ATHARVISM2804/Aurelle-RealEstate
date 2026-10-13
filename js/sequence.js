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
   - only a window of frames around the playhead is decoded, so memory stays
     bounded and a draw never waits on a decode
   - the window leans in the scroll direction, so frames are ready before
     they are needed
   - drawing is coalesced to one paint per animation frame, and the
     fractional position blends two neighbouring frames
   ========================================================== */
(function () {
  const WINDOW = 36; // decoded frames kept per sequence (~8 MB each at 1080p)
  const AHEAD = 24;  // of which this many sit in the scroll direction
  // half-size fallback frames: one every few frames, ~80 per film at most
  const coarseStep = (count) => Math.max(6, Math.ceil(count / 80));

  const conn = navigator.connection || {};
  const TIER = (Math.min(screen.width, innerWidth) >= 1100 && !conn.saveData && !/2g|3g/.test(conn.effectiveType || '')) ? 'hd' : 'sd';
  // AVIF support (all current browsers; older ones keep the poster image instead of the film)
  const avifOK = new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i.width > 0); i.onerror = () => res(false);
    i.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';
  });

  // worker pool: fetch + createImageBitmap off the main thread; bitmaps come back transferred (zero-copy)
  const pool = (() => {
    const code = `const blobs = new Map();
      onmessage = async (e) => {
        const { op, id, url, rw, rh } = e.data;
        try {
          if (op === 'fetch') {
            const r = await fetch(url);
            if (!r.ok) throw 0;
            blobs.set(url, await r.blob());
            postMessage({ id, ok: true });
          } else {
            const b = blobs.get(url);
            if (!b) throw 0;
            const bmp = await createImageBitmap(b, rw ? { resizeWidth: rw, resizeHeight: rh, resizeQuality: 'medium' } : undefined);
            postMessage({ id, ok: true, bmp }, [bmp]);
          }
        } catch (err) { postMessage({ id, ok: false }); }
      };`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
    const workers = Array.from({ length: n }, () => new Worker(url));
    const pending = new Map();
    let seq = 0;
    workers.forEach((w) => { w.onmessage = (e) => { const p = pending.get(e.data.id); pending.delete(e.data.id); if (p) e.data.ok ? p.res(e.data.bmp) : p.rej(); }; });
    // a frame always goes to the same worker (k), since that worker holds its compressed bytes
    return (k, msg) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); workers[k % n].postMessage({ ...msg, id }); });
  })();
  let salt = 0;

  class FrameSequence {
    constructor(canvas, name) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.name = name;
      this.blobs = [];          // index -> true once its worker holds the bytes
      this.salt = salt++;
      this.bitmaps = new Map(); // index -> ImageBitmap
      this.coarse = new Map();  // index -> half-size ImageBitmap
      this.decoding = new Set();
      this.pos = 0; // fractional frame index
      this.dir = 1;
      this.dirty = false;
      this.started = false;
      this.ready = new Promise((res, rej) => { this._res = res; this._rej = rej; });
      this.paint = this.paint.bind(this);
      window.addEventListener('resize', () => this.resize());
    }

    start() {
      if (this.started) return this.ready;
      this.started = true;
      this.load().then(this._res, this._rej);
      return this.ready;
    }

    async load() {
      if (!(await avifOK)) throw new Error('no avif');
      const base = `assets/seq/${this.name}/${TIER}/`;
      const m = await fetch(base + 'manifest.json').then((r) => { if (!r.ok) throw new Error('no sequence'); return r.json(); });
      this.count = m.count;
      this.w = m.width;
      this.h = m.height;
      this.resize();
      const src = this.src = (i) => new URL(base + String(i + 1).padStart(4, '0') + '.' + (m.ext || 'webp'), location.href).href;
      await this.fetchFrame(0, src(0));
      await this.decode(0);
      // coarse-to-fine so any scroll position has a near frame early
      const order = [];
      const seen = new Set([0]);
      for (let step = 32; step >= 1; step /= 2)
        for (let i = 0; i < this.count; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
      let k = 0;
      const worker = async () => { while (k < order.length) { const i = order[k++]; await this.fetchFrame(i, src(i)); } };
      Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
    }

    async fetchFrame(i, url) {
      try { await pool(this.salt + i, { op: 'fetch', url }); } catch (e) { return; }
      this.blobs[i] = true;
      if (i % coarseStep(this.count) === 0) await this.decodeCoarse(i);
      if (Math.abs(i - this.pos) < AHEAD) this.schedule();
    }

    // every few frames one stays decoded at half size, so a fast scroll that
    // outruns the full-size window still shows the right moment of the film
    async decodeCoarse(i) {
      try {
        this.coarse.set(i, await pool(this.salt + i, { op: 'decode', url: this.src(i), rw: this.w / 2, rh: this.h / 2 }));
      } catch (e) { /* skip */ }
    }

    async decode(i) {
      if (this.bitmaps.has(i) || this.decoding.has(i) || !this.blobs[i]) return;
      this.decoding.add(i);
      try {
        const bm = await pool(this.salt + i, { op: 'decode', url: this.src(i) });
        // the playhead may have moved on while it decoded
        if (this.inWindow(i)) this.bitmaps.set(i, bm); else bm.close();
      } catch (e) { /* skip a bad frame */ }
      this.decoding.delete(i);
      if (Math.abs(i - this.pos) < 2) this.invalidate();
      this.schedule();
    }

    windowRange() {
      const p = Math.round(this.pos), d = this.dir;
      const lo = Math.max(0, d > 0 ? p - (WINDOW - AHEAD) : p - AHEAD);
      return [lo, Math.min(this.count - 1, lo + WINDOW - 1)];
    }
    inWindow(i) { const [lo, hi] = this.windowRange(); return i === 0 || (i >= lo && i <= hi); }

    // decode the frames around the playhead, nearest first, and drop the far ones
    schedule() {
      if (!this.count) return;
      const p = Math.round(this.pos), d = this.dir;
      const [lo, hi] = this.windowRange();
      for (const [i, bm] of this.bitmaps)
        if ((i < lo || i > hi) && i !== 0) { bm.close(); this.bitmaps.delete(i); }
      if (this.decoding.size >= 4) return;
      for (let s = 0; s <= WINDOW; s++) {
        for (const i of [p + s * d, p - s * d]) {
          if (i < lo || i > hi || this.bitmaps.has(i) || this.decoding.has(i) || !this.blobs[i]) continue;
          this.decode(i);
          if (this.decoding.size >= 4) return;
        }
      }
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = this.canvas.getBoundingClientRect();
      if (!r.width) return;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      this.invalidate();
    }

    // closest available frame to i: full size if one is as close as the coarse set
    nearest(i) {
      if (this.bitmaps.has(i)) return this.bitmaps.get(i);
      let best = null, bd = Infinity;
      for (const [j, bm] of this.bitmaps) { const dd = Math.abs(j - i); if (dd < bd) { bd = dd; best = bm; } }
      for (const [j, bm] of this.coarse) { const dd = Math.abs(j - i); if (dd < bd) { bd = dd; best = bm; } }
      return best;
    }

    invalidate() {
      if (this.dirty) return;
      this.dirty = true;
      requestAnimationFrame(this.paint);
    }

    blit(img, alpha) {
      const cw = this.canvas.width, ch = this.canvas.height;
      const s = Math.max(cw / this.w, ch / this.h); // cover
      const dw = this.w * s, dh = this.h * s;
      this.ctx.globalAlpha = alpha;
      this.ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    }

    paint() {
      this.dirty = false;
      if (!this.count) return;
      const lo = Math.floor(this.pos), hi = Math.min(lo + 1, this.count - 1), f = this.pos - lo;
      const a = this.nearest(lo);
      if (!a) return;
      this.blit(a, 1);
      // blend toward the next frame for sub-frame smoothness
      if (f > 0.02 && this.bitmaps.has(lo) && this.bitmaps.has(hi)) this.blit(this.bitmaps.get(hi), f);
      this.ctx.globalAlpha = 1;
    }

    // p: 0..1
    set progress(p) {
      if (!this.count) return;
      const pos = Math.min(1, Math.max(0, p)) * (this.count - 1);
      if (Math.abs(pos - this.pos) < 0.01) return;
      this.dir = pos > this.pos ? 1 : -1;
      this.pos = pos;
      this.schedule();
      this.invalidate();
    }
  }

  window.FrameSequence = FrameSequence;
})();
