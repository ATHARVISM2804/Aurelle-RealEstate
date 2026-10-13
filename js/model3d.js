/* ==========================================================
   Model3D — the unit plan as a live 3D model (Three.js)
   The 2D plan render is the floor; walls are extruded from rectangles
   traced out of that render (tools/extract-walls.py → assets/model/*.json).
   open(): the flat plan lifts into walls and the camera flies into a room.
   The cursor (or a drag on touch) looks around the surrounding rooms.
   Three.js is loaded the first time a room is opened.
   ========================================================== */
(function () {
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const THREE_SRI = 'sha384-CI3ELBVUz9XQO+97x6nwMDPosPR5XvsxW2ua7N1Xeygeh1IxtgqtCkGfQY9WWdHu';
  const DEPTH = 10;      // plan height in world units (width = DEPTH * aspect)
  const WALL_H = 1.25;   // a cut-away dollhouse height, so the rooms stay readable
  const FOV = 32;

  let three = null;
  const loadThree = () => three || (three = new Promise((res, rej) => {
    if (window.THREE) return res(window.THREE);
    const s = document.createElement('script');
    s.src = THREE_URL; s.integrity = THREE_SRI; s.crossOrigin = 'anonymous';
    s.onload = () => res(window.THREE); s.onerror = rej;
    document.head.appendChild(s);
  }));
  const models = {}; // plan name -> wall json
  const loadWalls = (name) => models[name] || (models[name] = fetch(`assets/model/${name}.json`).then((r) => r.json()));

  const M = {
    active: false,

    async init(canvas) {
      const THREE = await loadThree();
      if (this.renderer) return;
      this.T = THREE;
      this.canvas = canvas;
      const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      r.outputEncoding = THREE.sRGBEncoding;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(FOV, 1, .1, 200);
      this.scene.add(new THREE.HemisphereLight(0xfffaf2, 0xcfc3b0, .62));
      const sun = this.sun = new THREE.DirectionalLight(0xfff3e2, .62);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -.0005;
      sun.shadow.radius = 4;
      this.scene.add(sun, sun.target);

      this.wallMat = new THREE.MeshStandardMaterial({ color: 0xf3efe7, roughness: .82 });
      this.capMat = new THREE.MeshBasicMaterial({ color: 0x1d1c19 });
      // the floor shows the plan render's own colours (unlit); shadows land on a transparent layer above it
      this.floorMat = new THREE.MeshBasicMaterial();
      this.shadowMat = new THREE.ShadowMaterial({ opacity: .2 });
      this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false });

      this.ptr = { x: 0, y: 0, tx: 0, ty: 0 };
      const onMove = (e) => {
        if (!this.active) return;
        const b = canvas.getBoundingClientRect();
        this.ptr.tx = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width - .5) * 2));
        this.ptr.ty = Math.max(-1, Math.min(1, ((e.clientY - b.top) / b.height - .5) * 2));
      };
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerleave', () => { this.ptr.tx = 0; this.ptr.ty = 0; });
      addEventListener('resize', () => this.active && this.resize());
      this.tick = this.tick.bind(this);
    },

    // build (or reuse) the model for a plan image
    async build(plan) {
      const THREE = this.T;
      if (this.plan === plan) return;
      this.plan = plan;
      if (this.group) this.scene.remove(this.group);
      const data = await loadWalls(plan);
      const W = DEPTH * data.aspect;
      this.size = { w: W, d: DEPTH };
      const g = this.group = new THREE.Group();

      const tex = await new Promise((res) => new THREE.TextureLoader().load(`assets/img/${plan}.webp`, res));
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.floorMat.map = tex; this.floorMat.needsUpdate = true;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, DEPTH), this.floorMat);
      floor.rotation.x = -Math.PI / 2;
      const shade = new THREE.Mesh(new THREE.PlaneGeometry(W, DEPTH), this.shadowMat);
      shade.rotation.x = -Math.PI / 2;
      shade.position.y = .002;
      shade.receiveShadow = true;
      g.add(floor, shade);

      // walls: one instanced box per traced rectangle, plus a dark cap that reads like a section cut
      const n = data.rects.length;
      const box = new THREE.BoxGeometry(1, 1, 1);
      box.translate(0, .5, 0); // grow from the floor
      const walls = this.walls = new THREE.InstancedMesh(box, this.wallMat, n);
      const caps = this.caps = new THREE.InstancedMesh(box, this.capMat, n);
      walls.castShadow = walls.receiveShadow = true;
      this.rects = data.rects.map(([x, y, w, h]) => ({
        x: (x + w / 2 - .5) * W, z: (y + h / 2 - .5) * DEPTH, w: Math.max(w * W, .04), d: Math.max(h * DEPTH, .04),
      }));
      g.add(walls, caps);

      this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glowMat);
      this.glow.rotation.x = -Math.PI / 2;
      this.glow.position.y = .01;
      g.add(this.glow);

      this.sun.position.set(-W * .45, 14, -DEPTH * .2);
      Object.assign(this.sun.shadow.camera, { left: -W * .6, right: W * .6, top: DEPTH * .8, bottom: -DEPTH * .8, near: 1, far: 40 });
      this.sun.shadow.camera.updateProjectionMatrix();
      this.scene.add(g);
      this.setHeight(0);
    },

    setHeight(k) {
      this.h = k;
      const m = new this.T.Matrix4();
      this.rects.forEach((r, i) => {
        const h = Math.max(.001, WALL_H * k);
        m.makeScale(r.w, h, r.d).setPosition(r.x, 0, r.z);
        this.walls.setMatrixAt(i, m);
        m.makeScale(r.w * 1.002, .02, r.d * 1.002).setPosition(r.x, h, r.z);
        this.caps.setMatrixAt(i, m);
      });
      this.walls.instanceMatrix.needsUpdate = true;
      this.caps.instanceMatrix.needsUpdate = true;
    },

    resize() {
      const b = this.canvas.getBoundingClientRect();
      this.renderer.setSize(b.width, b.height, false);
      this.camera.aspect = b.width / b.height;
      this.camera.updateProjectionMatrix();
    },

    // camera straight above, framed so the model lines up with the plan image in `rect` (card px)
    topPose(rect) {
      const b = this.canvas.getBoundingClientRect();
      const worldPerPx = DEPTH / rect.height;
      const visH = b.height * worldPerPx;
      const dist = visH / 2 / Math.tan((FOV * Math.PI) / 360);
      const ox = (b.width / 2 - (rect.left - b.left + rect.width / 2)) * worldPerPx;
      const oz = (b.height / 2 - (rect.top - b.top + rect.height / 2)) * worldPerPx;
      return { tx: ox, tz: oz, dist, polar: .0001, az: 0 };
    },

    // the room box ([x0,y0,x1,y1] % of the plan image) → orbit pose looking into it
    roomPose(box) {
      const [x0, y0, x1, y1] = box;
      const { w, d } = this.size;
      const cx = ((x0 + x1) / 200 - .5) * w, cz = ((y0 + y1) / 200 - .5) * d;
      const span = Math.max((x1 - x0) / 100 * w, (y1 - y0) / 100 * d);
      return { tx: cx, tz: cz + .6, dist: 5.4 + span * 1.6, polar: .82, az: 0, box: [cx, cz, (x1 - x0) / 100 * w, (y1 - y0) / 100 * d] };
    },

    apply() {
      const p = this.pose, q = this.ptr;
      // look around: orbit with the cursor and lean the target toward it to show the surroundings
      const az = p.az + q.x * .55 * this.look;
      const polar = Math.max(.0001, p.polar - q.y * .16 * this.look);
      const tx = p.tx + q.x * 1.6 * this.look, tz = p.tz + q.y * 1.1 * this.look;
      const c = this.camera;
      c.position.set(tx + p.dist * Math.sin(polar) * Math.sin(az), p.dist * Math.cos(polar), tz + p.dist * Math.sin(polar) * Math.cos(az));
      c.up.set(0, polar < .01 ? 0 : 1, polar < .01 ? -1 : 0);
      c.lookAt(tx, 0, tz);
    },

    tick() {
      if (!this.active) return;
      this.ptr.x += (this.ptr.tx - this.ptr.x) * .06;
      this.ptr.y += (this.ptr.ty - this.ptr.y) * .06;
      this.apply();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.tick);
    },

    highlight(box, on) {
      if (box) {
        const [cx, cz, w, d] = box;
        this.glow.position.x = cx; this.glow.position.z = cz;
        this.glow.scale.set(w * .96, d * .96, 1);
      }
      return gsap.to(this.glowMat, { opacity: on ? .22 : 0, duration: .8 });
    },

    // fly from the flat plan (aligned with `rect`) into room `box`
    async open(plan, box, rect) {
      await this.init(this.canvas || document.getElementById('model3d'));
      await this.build(plan);
      this.resize();
      this.pose = this.topPose(rect);
      this.look = 0;
      this.ptr.x = this.ptr.y = this.ptr.tx = this.ptr.ty = 0;
      this.setHeight(0);
      this.active = true;
      this.apply();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this.tick);
      const to = this.roomPose(box);
      const h = { k: 0 };
      // wrapped: a GSAP timeline is thenable, so returning it bare from an async function would wait for it to finish
      return { tl: gsap.timeline({ paused: true })
        .to(this.pose, { tx: to.tx, tz: to.tz, dist: to.dist, polar: to.polar, duration: 1.8, ease: 'expo.inOut' }, 0)
        .to(h, { k: 1, duration: 1.4, ease: 'expo.out', onUpdate: () => this.setHeight(h.k) }, .35)
        .to(this, { look: 1, duration: 1 }, 1.4)
        .add(() => this.highlight(to.box, true), 1.2) };
    },

    focus(box) {
      const to = this.roomPose(box);
      this.highlight(null, false);
      return gsap.timeline()
        .to(this.pose, { tx: to.tx, tz: to.tz, dist: to.dist, polar: to.polar, duration: 1.3, ease: 'expo.inOut' }, 0)
        .add(() => this.highlight(to.box, true), .8);
    },

    // back to the flat top view aligned with `rect`, then stop rendering
    close(rect) {
      const to = this.topPose(rect);
      const h = { k: this.h };
      this.highlight(null, false);
      return gsap.timeline({ onComplete: () => { this.active = false; } })
        .to(this, { look: 0, duration: .5 }, 0)
        .to(h, { k: 0, duration: .9, ease: 'expo.in', onUpdate: () => this.setHeight(h.k) }, 0)
        .to(this.pose, { tx: to.tx, tz: to.tz, dist: to.dist, polar: to.polar, duration: 1.3, ease: 'expo.inOut' }, .2);
    },

    stop() { this.active = false; },
  };

  window.Model3D = M;
})();
