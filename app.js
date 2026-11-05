(() => {
  'use strict';

  // ---------------------------------------------------------------- helpers

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const smooth = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const clock = () => performance.now();
  const hsl = (h, s, l, a) => 'hsla(' + h + ',' + s + '%,' + l + '%,' + a + ')';

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const HUES = [10, 24, 38, 48, 158, 172, 190, 262, 282, 305, 326, 344];

  const stage = document.getElementById('stage');
  const ctx = stage.getContext('2d');
  const bgCanvas = document.getElementById('bg');
  const bgCtx = bgCanvas.getContext('2d');
  const cursorEl = document.getElementById('cursor');

  const MAX = coarse ? 170 : 300;
  const CAPS = coarse
    ? { wave: 9, fractal: 12, flash: 4, spiral: 7, rose: 7, comet: 18, ribbon: 10 }
    : { wave: 16, fractal: 20, flash: 6, spiral: 13, rose: 13, comet: 30, ribbon: 18 };

  const STROKE_MAX = coarse ? 200 : 320;
  const strokeX = new Float64Array(STROKE_MAX);
  const strokeY = new Float64Array(STROKE_MAX);
  const strokeA = new Float64Array(STROKE_MAX);
  const ribbonX = new Float64Array(56);
  const ribbonY = new Float64Array(56);
  const pathX = new Float64Array(256);
  const pathY = new Float64Array(256);

  let W = 0;
  let H = 0;
  let DPR = 1;

  // -------------------------------------------------------------- state

  const particles = [];
  const strokes = [];
  let activeStroke = null;

  let lastSpawn = 0;
  let lastInteraction = 0;
  let lastAmbient = 0;
  let lastHold = 0;
  let lastFrame = clock();
  let started = false;
  let demoDone = false;

  const pointer = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    lastX: window.innerWidth / 2,
    lastY: window.innerHeight / 2,
    vx: 0,
    vy: 0,
    down: false,
    id: null,
    downT: 0,
    moved: 0,
    lastMove: 0,
    lastPulse: 0,
    pulseCount: 0,
    energy: 0
  };

  const cursor = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    offX: 0,
    offY: 0,
    vX: 0,
    vY: 0,
    on: false
  };

  // --------------------------------------------------------- background

  const MODES = ['space', 'water', 'sand'];
  let theme = 'space';
  let nextThemeAt = 9000;
  const themeAlpha = { space: 1, water: 0, sand: 0 };
  const themeTarget = { space: 1, water: 0, sand: 0 };

  let stars = [];
  let grains = [];
  let specks = [[], [], []];
  let ripples = [];
  let rippleTimer = 0;
  let shootingStars = [];
  let shootTimer = 4;

  // -------------------------------------------------------------- resize

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;

    for (const [canvas, context] of [[stage, ctx], [bgCanvas, bgCtx]]) {
      canvas.width = Math.max(1, Math.round(W * DPR));
      canvas.height = Math.max(1, Math.round(H * DPR));
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      context.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    buildBackdrop();
    ripples.length = 0;
    shootingStars.length = 0;
  }

  function buildBackdrop() {
    const area = W * H;
    const starCount = Math.max(50, Math.min(170, Math.round(area / 11000)));
    stars = [];
    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        r: rand(0.3, 1.5),
        base: rand(0.12, 0.62),
        tw: rand(0.4, 1.7),
        ph: rand(0, TAU),
        hue: Math.random() < 0.18 ? pick([190, 220, 280, 330]) : 210,
        drift: rand(-0.004, 0.006)
      });
    }

    const grainCount = Math.max(70, Math.min(170, Math.round(area / 11500)));
    grains = [];
    for (let i = 0; i < grainCount; i++) {
      grains.push({
        x: Math.random(),
        y: Math.random(),
        len: rand(0.6, 16),
        size: rand(0.4, 1.3),
        base: rand(0.08, 0.36),
        hue: rand(29, 47),
        vx: rand(0.006, 0.032),
        sway: rand(0.2, 1.2),
        ph: rand(0, TAU),
        amp: rand(2, 14)
      });
    }

    const speckCount = Math.max(180, Math.min(520, Math.round(area / 3400)));
    specks = [[], [], []];
    for (let i = 0; i < speckCount; i++) {
      const tier = (Math.random() * 3) | 0;
      specks[tier].push({
        x: Math.random(),
        y: Math.random(),
        s: rand(0.5, 1.2) + tier * 0.5
      });
    }
  }

  function applyThemeLayers() {
    const layers = document.querySelectorAll('.bg-layer');
    for (let i = 0; i < layers.length; i++) {
      const el = layers[i];
      el.classList.toggle('active', el.classList.contains('bg-' + theme));
    }
  }

  function switchTheme(t) {
    const next = pick(MODES.filter((m) => m !== theme));
    theme = next;
    for (let i = 0; i < MODES.length; i++) {
      themeTarget[MODES[i]] = MODES[i] === theme ? 1 : 0;
    }
    applyThemeLayers();
    nextThemeAt = t + rand(16000, 26000);
  }

  function drawSpace(t, alpha, dt) {
    const sec = t / 1000;

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const x = (((s.x + sec * s.drift) % 1) + 1) % 1;
      const twinkle = 0.55 + 0.45 * Math.sin(sec * s.tw + s.ph);
      const a = s.base * twinkle * alpha;
      if (a < 0.008) continue;

      bgCtx.fillStyle = hsl(s.hue, 70, 84, a);
      bgCtx.beginPath();
      bgCtx.arc(x * W, s.y * H, s.r, 0, TAU);
      bgCtx.fill();

      if (s.r > 1.15) {
        bgCtx.fillStyle = hsl(s.hue, 85, 80, a * 0.08);
        bgCtx.beginPath();
        bgCtx.arc(x * W, s.y * H, s.r * 4.5, 0, TAU);
        bgCtx.fill();
      }
    }

    if (!reduceMotion) {
      shootTimer -= dt;
      if (shootTimer <= 0 && themeTarget.space > 0.5 && alpha > 0.4) {
        shootTimer = rand(3.5, 8);
        if (shootingStars.length < 3) {
          const angle = rand(Math.PI * 0.62, Math.PI * 0.86);
          const speed = rand(500, 900);
          shootingStars.push({
            x: rand(W * 0.15, W * 0.95),
            y: rand(0, H * 0.5),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: rand(0.5, 0.9),
            born: t,
            hue: pick([190, 210, 45, 320])
          });
        }
      }
    }

    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const s = shootingStars[i];
      const k = (t - s.born) / (s.life * 1000);
      if (k >= 1) {
        shootingStars.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      const a = Math.sin(k * Math.PI) * alpha;
      const tx = s.x - s.vx * 0.1;
      const ty = s.y - s.vy * 0.1;

      bgCtx.strokeStyle = hsl(s.hue, 90, 86, a * 0.6);
      bgCtx.lineWidth = 1.4;
      bgCtx.beginPath();
      bgCtx.moveTo(tx, ty);
      bgCtx.lineTo(s.x, s.y);
      bgCtx.stroke();

      bgCtx.fillStyle = hsl(s.hue, 100, 92, a);
      bgCtx.beginPath();
      bgCtx.arc(s.x, s.y, 1.6, 0, TAU);
      bgCtx.fill();
    }
  }

  function drawWater(t, alpha, dt) {
    const sec = t / 1000;

    for (let i = 0; i < 5; i++) {
      const y0 = H * (0.16 + i * 0.17);
      bgCtx.strokeStyle = hsl(188, 62, 76, alpha * 0.022);
      bgCtx.lineWidth = 1;
      bgCtx.beginPath();
      for (let x = -20; x <= W + 20; x += 30) {
        const y = y0 +
          Math.sin(x * 0.006 + sec * 0.22 + i * 1.7) * 4 +
          Math.sin(x * 0.0021 - sec * 0.14 + i) * 6;
        if (x < 0) bgCtx.moveTo(x, y);
        else bgCtx.lineTo(x, y);
      }
      bgCtx.stroke();
    }

    if (themeTarget.water > 0.5) {
      rippleTimer -= dt;
      if (rippleTimer <= 0) {
        rippleTimer = rand(0.65, 1.8);
        const cap = coarse ? 8 : 13;
        if (ripples.length < cap) {
          ripples.push({
            x: rand(W * 0.06, W * 0.94),
            y: rand(H * 0.1, H * 0.9),
            born: t,
            radius: rand(45, 150),
            life: rand(3.4, 6.2),
            hue: rand(176, 200),
            rings: Math.random() < 0.45 ? 2 : 3
          });
        }
      }
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const k = (t - r.born) / (r.life * 1000);
      if (k >= 1) {
        ripples.splice(i, 1);
        continue;
      }

      const e = easeOut(k);
      for (let j = 0; j < r.rings; j++) {
        const rad = r.radius * e * (1 - j * 0.22);
        const a = Math.pow(1 - k, 1.35) * alpha * 0.18 * (1 - j * 0.28);
        if (rad < 1 || a < 0.004) continue;
        bgCtx.strokeStyle = hsl(r.hue, 72, 78, a);
        bgCtx.lineWidth = 0.9 + (1 - k) * 0.8;
        bgCtx.beginPath();
        bgCtx.arc(r.x, r.y, rad, 0, TAU);
        bgCtx.stroke();
      }

      const ca = Math.pow(1 - k, 2) * alpha * 0.1;
      if (ca > 0.004) {
        bgCtx.fillStyle = hsl(r.hue, 90, 90, ca);
        bgCtx.beginPath();
        bgCtx.arc(r.x, r.y, 1.4, 0, TAU);
        bgCtx.fill();
      }
    }
  }

  function drawSand(t, alpha) {
    const sec = t / 1000;

    for (let i = 0; i < 3; i++) {
      const y0 = H * (0.62 + i * 0.12);
      const amp = H * (0.022 + i * 0.008);
      const ph = sec * 0.05 * (i + 1) + i * 1.7;
      bgCtx.strokeStyle = hsl(30 + i * 4, 52, 62, alpha * 0.032);
      bgCtx.lineWidth = 26 + i * 22;
      bgCtx.beginPath();
      for (let x = -30; x <= W + 30; x += 26) {
        const y = y0 +
          Math.sin(x * 0.0035 + ph) * amp +
          Math.sin(x * 0.0014 - ph * 0.6) * amp * 0.7;
        if (x < 0) bgCtx.moveTo(x, y);
        else bgCtx.lineTo(x, y);
      }
      bgCtx.stroke();
    }

    for (let i = 0; i < grains.length; i++) {
      const g = grains[i];
      let x = (g.x + sec * g.vx) % 1;
      if (x < 0) x += 1;

      const px = x * W;
      const py = g.y * H + Math.sin(sec * g.sway + g.ph) * g.amp;
      const a = g.base * alpha * (0.75 + 0.25 * Math.sin(sec * 1.4 + g.ph));
      if (a < 0.005) continue;

      bgCtx.strokeStyle = hsl(g.hue, 58, 68, a);
      bgCtx.lineWidth = g.size;
      bgCtx.beginPath();
      bgCtx.moveTo(px, py);
      bgCtx.lineTo(px - g.len, py - g.len * 0.28);
      bgCtx.stroke();
    }

    const tiers = [0.05, 0.095, 0.16];
    for (let tier = 0; tier < 3; tier++) {
      const group = specks[tier];
      bgCtx.fillStyle = hsl(36, 55, 70, alpha * tiers[tier]);
      for (let i = 0; i < group.length; i++) {
        const s = group[i];
        bgCtx.fillRect(s.x * W, s.y * H, s.s, s.s);
      }
    }
  }

  function drawBackdrop(t, dt) {
    bgCtx.clearRect(0, 0, W, H);
    bgCtx.globalCompositeOperation = 'lighter';
    bgCtx.lineCap = 'round';
    bgCtx.lineJoin = 'round';

    if (themeAlpha.space > 0.015) drawSpace(t, themeAlpha.space, dt);
    if (themeAlpha.water > 0.015) drawWater(t, themeAlpha.water, dt);
    if (themeAlpha.sand > 0.015) drawSand(t, themeAlpha.sand);
  }

  // ----------------------------------------------------------- add / caps

  function add(p) {
    if (particles.length >= MAX) particles.shift();

    if (p.type !== 'spark' && p.type !== 'comet') {
      p.homeX = p.x;
      p.homeY = p.y;
      p.vx = 0;
      p.vy = 0;
    }

    const cap = CAPS[p.type];
    if (cap) {
      let count = 0;
      let oldest = -1;
      for (let i = 0; i < particles.length; i++) {
        if (particles[i].type === p.type) {
          count++;
          if (oldest < 0) oldest = i;
        }
      }
      if (count >= cap && oldest >= 0) particles.splice(oldest, 1);
    }

    particles.push(p);
  }

  // --------------------------------------------------------- foreground art

  function spawnFractal(x, y, o = {}) {
    let branches = o.branches != null ? o.branches : 2;
    let depth = o.depth != null ? o.depth : 4 + (Math.random() < 0.3 ? 1 : 0);
    let spread = o.spread != null ? o.spread : rand(0.34, 0.62);

    if (o.branches == null && o.depth == null && Math.random() > 0.9) {
      branches = 4;
      depth = 2;
      spread = rand(0.7, 1.15);
    }

    add({
      type: 'fractal',
      x: x,
      y: y,
      born: clock(),
      life: o.life != null ? o.life : rand(1.8, 3.2),
      hue: o.hue != null ? o.hue : pick(HUES),
      sat: o.sat != null ? o.sat : rand(82, 100),
      lum: o.lum != null ? o.lum : rand(58, 72),
      angle: o.angle != null ? o.angle : rand(0, TAU),
      len: o.len != null ? o.len : rand(26, 62),
      depth: depth,
      branches: branches,
      spread: spread,
      width: o.width != null ? o.width : rand(1.3, 2.5),
      sway: o.sway != null ? o.sway : rand(0.03, 0.14),
      seed: Math.random() * 1000,
      alpha: o.alpha != null ? o.alpha : rand(0.3, 0.62)
    });
  }

  function spawnWave(x, y, o = {}) {
    add({
      type: 'wave',
      x: x,
      y: y,
      born: clock(),
      life: o.life != null ? o.life : rand(0.85, 1.65),
      hue: o.hue != null ? o.hue : pick(HUES),
      sat: o.sat != null ? o.sat : rand(80, 100),
      lum: o.lum != null ? o.lum : rand(58, 70),
      r0: o.r0 != null ? o.r0 : 0,
      r1: o.r1 != null ? o.r1 : rand(38, 120),
      width: o.width != null ? o.width : rand(0.9, 2.2),
      rings: o.rings != null ? o.rings : (coarse ? 2 : 2 + ((Math.random() * 2) | 0)),
      wobble: o.wobble != null ? o.wobble : rand(1.2, 4.5),
      freq: o.freq != null ? o.freq : rand(3, 7),
      rot: o.rot != null ? o.rot : rand(0, TAU),
      spin: o.spin != null ? o.spin : rand(-0.8, 0.8),
      seed: Math.random() * 1000,
      alpha: o.alpha != null ? o.alpha : rand(0.35, 0.7)
    });
  }

  function spawnSpark(x, y, vx, vy, o = {}) {
    add({
      type: 'spark',
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      born: clock(),
      life: o.life != null ? o.life : rand(0.35, 1.1),
      hue: ((o.hue != null ? o.hue : pick(HUES)) % 360 + 360) % 360,
      sat: o.sat != null ? o.sat : 96,
      lum: o.lum != null ? o.lum : rand(62, 88),
      size: o.size != null ? o.size : rand(0.7, 2),
      grav: o.grav != null ? o.grav : rand(0, 80),
      drag: o.drag != null ? o.drag : 0.97,
      alpha: o.alpha != null ? o.alpha : 1
    });
  }

  function spawnBurst(x, y, n, o = {}) {
    const base = o.hue != null ? o.hue : pick(HUES);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(o.speedMin != null ? o.speedMin : 30, o.speedMax != null ? o.speedMax : 280);
      spawnSpark(
        x, y,
        Math.cos(a) * sp,
        Math.sin(a) * sp * 0.9 - (o.lift || 0),
        {
          hue: base + rand(-20, 40),
          life: rand(o.lifeMin != null ? o.lifeMin : 0.3, o.lifeMax != null ? o.lifeMax : 1),
          size: rand(0.6, o.size != null ? o.size : 2.1),
          grav: o.grav != null ? o.grav : rand(10, 90),
          drag: o.drag != null ? o.drag : 0.97
        }
      );
    }
  }

  function spawnFlash(x, y, hue) {
    add({
      type: 'flash',
      x: x,
      y: y,
      born: clock(),
      life: 0.55,
      hue: ((hue % 360) + 360) % 360,
      r: coarse ? rand(70, 120) : rand(90, 160)
    });
  }

  function spawnComet(x, y, o = {}) {
    const angle = o.angle != null ? o.angle : rand(0, TAU);
    const speed = o.speed != null ? o.speed : rand(70, 260);
    add({
      type: 'comet',
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      born: clock(),
      life: o.life != null ? o.life : rand(0.9, 1.9),
      hue: o.hue != null ? o.hue : pick(HUES),
      sat: 95,
      lum: o.lum != null ? o.lum : rand(70, 88),
      size: o.size != null ? o.size : rand(1.1, 2.6),
      grav: o.grav != null ? o.grav : rand(-30, 60),
      drag: o.drag != null ? o.drag : 0.988,
      alpha: o.alpha != null ? o.alpha : rand(0.6, 1),
      trail: [{ x: x, y: y }]
    });
  }

  function spawnSpiral(x, y, o = {}) {
    add({
      type: 'spiral',
      x: x,
      y: y,
      born: clock(),
      life: o.life != null ? o.life : rand(2.2, 3.8),
      hue: o.hue != null ? o.hue : pick(HUES),
      sat: o.sat != null ? o.sat : rand(80, 100),
      lum: o.lum != null ? o.lum : rand(60, 74),
      count: coarse ? 90 : 150,
      radius: o.radius != null ? o.radius : rand(45, 120),
      angle: o.angle != null ? o.angle : rand(0, TAU),
      spin: o.spin != null ? o.spin : rand(-0.25, 0.25),
      dot: o.dot != null ? o.dot : rand(1.1, 2.4),
      alpha: o.alpha != null ? o.alpha : rand(0.4, 0.8)
    });
  }

  function spawnRose(x, y, o = {}) {
    add({
      type: 'rose',
      x: x,
      y: y,
      born: clock(),
      life: o.life != null ? o.life : rand(1.8, 3),
      hue: o.hue != null ? o.hue : pick(HUES),
      sat: o.sat != null ? o.sat : rand(80, 100),
      lum: o.lum != null ? o.lum : rand(58, 72),
      petals: o.petals != null ? o.petals : 3 + ((Math.random() * 5) | 0),
      rings: o.rings != null ? o.rings : (coarse ? 2 : 2 + (Math.random() < 0.5 ? 1 : 0)),
      radius: o.radius != null ? o.radius : rand(40, 115),
      rot: o.rot != null ? o.rot : rand(0, TAU),
      spin: o.spin != null ? o.spin : rand(-0.35, 0.35),
      wobble: o.wobble != null ? o.wobble : rand(0, 5),
      width: o.width != null ? o.width : rand(0.9, 1.8),
      seed: Math.random() * 1000,
      alpha: o.alpha != null ? o.alpha : rand(0.38, 0.72)
    });
  }

  function spawnRibbon(x, y, o = {}) {
    add({
      type: 'ribbon',
      x: x,
      y: y,
      born: clock(),
      life: o.life != null ? o.life : rand(1.5, 2.6),
      hue: o.hue != null ? o.hue : pick(HUES),
      sat: o.sat != null ? o.sat : rand(80, 100),
      lum: o.lum != null ? o.lum : rand(62, 74),
      angle: o.angle != null ? o.angle : rand(0, TAU),
      length: o.length != null ? o.length : rand(60, 150),
      curve: o.curve != null ? o.curve : rand(-1.4, 1.4),
      waveAmp: o.waveAmp != null ? o.waveAmp : rand(0.18, 0.75),
      waveFreq: o.waveFreq != null ? o.waveFreq : rand(1.5, 3.5),
      width: o.width != null ? o.width : rand(1, 2.2),
      seed: Math.random() * 1000,
      alpha: o.alpha != null ? o.alpha : rand(0.3, 0.6),
      strands: coarse ? 2 : 3
    });
  }

  function randomTouch(x, y, strong) {
    const r = Math.random();

    if (r < 0.16) {
      spawnWave(x, y, {
        r1: rand(strong ? 55 : 30, strong ? 150 : 80),
        life: strong ? rand(0.8, 1.5) : rand(0.6, 1.1),
        width: rand(0.8, strong ? 2 : 1.4),
        alpha: rand(0.3, strong ? 0.7 : 0.5)
      });
    } else if (r < 0.35) {
      spawnBurst(x, y, strong ? 7 : 3, {
        speedMax: strong ? 240 : 130,
        lifeMax: strong ? 0.9 : 0.6,
        size: strong ? 2.1 : 1.5
      });
    } else if (r < 0.52) {
      spawnFractal(x, y, {
        angle: rand(0, TAU),
        len: rand(strong ? 26 : 16, strong ? 60 : 38),
        depth: 4,
        life: rand(1.4, 2.4),
        width: rand(0.9, 1.7),
        alpha: rand(0.2, 0.45)
      });
    } else if (r < 0.68) {
      spawnRibbon(x, y, {
        length: rand(50, strong ? 170 : 100),
        width: rand(0.8, strong ? 2 : 1.4),
        alpha: rand(0.22, strong ? 0.55 : 0.4)
      });
    } else if (r < 0.8) {
      spawnSpiral(x, y, {
        radius: rand(strong ? 55 : 35, strong ? 120 : 80),
        alpha: rand(0.3, strong ? 0.7 : 0.5)
      });
    } else if (r < 0.91) {
      spawnRose(x, y, {
        radius: rand(strong ? 55 : 35, strong ? 120 : 80),
        alpha: rand(0.3, strong ? 0.7 : 0.5)
      });
    } else {
      spawnComet(x, y, {
        speed: strong ? rand(150, 300) : rand(60, 160),
        life: rand(0.8, 1.6),
        alpha: rand(0.5, 0.9)
      });
    }
  }

  function holdPulse(x, y, st, t) {
    const held = (t - pointer.downT) / 1000;
    const hue = ((st ? st.hue : pick(HUES)) + held * 35) % 360;

    spawnWave(x, y, {
      hue: hue,
      r1: rand(24, 42 + Math.min(60, held * 12)),
      rings: 2,
      life: rand(0.7, 1.2),
      width: rand(0.8, 1.5),
      wobble: rand(1, 4),
      alpha: rand(0.3, 0.55)
    });

    const sparks = 2 + Math.min(3, (held / 1.5) | 0);
    spawnBurst(x, y, sparks, {
      hue: hue + rand(-20, 50),
      speedMin: 15,
      speedMax: 110 + Math.min(120, held * 40),
      size: 1.5,
      lifeMin: 0.3,
      lifeMax: 0.9
    });

    if (pointer.pulseCount % 4 === 0) {
      const roll = Math.random();
      if (roll < 0.3) {
        spawnFractal(x, y, {
          hue: hue + 140,
          len: rand(24, 55),
          depth: 4,
          life: rand(1.5, 2.4),
          alpha: rand(0.3, 0.5)
        });
      } else if (roll < 0.6) {
        spawnSpiral(x, y, {
          hue: hue + 40,
          radius: rand(32, 80),
          life: rand(1.8, 2.8),
          alpha: rand(0.4, 0.65)
        });
      } else if (roll < 0.85) {
        spawnRose(x, y, {
          hue: hue + 90,
          radius: rand(32, 80),
          life: rand(1.6, 2.6),
          alpha: rand(0.4, 0.65)
        });
      } else {
        spawnComet(x, y, {
          hue: hue + 200,
          speed: rand(80, 180),
          life: rand(1, 1.6),
          size: rand(1.3, 2.4)
        });
      }
    }
  }

  function ensemble(x, y) {
    const base = pick(HUES);
    spawnFlash(x, y, base);

    const n = coarse ? 5 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.25, 0.25);
      const d = rand(4, 28);
      spawnFractal(x + Math.cos(a) * d, y + Math.sin(a) * d, {
        angle: a + rand(-0.3, 0.3),
        hue: base + i * 26 + rand(-10, 10),
        len: rand(40, 86),
        depth: coarse ? 4 : 5,
        branches: 2,
        spread: rand(0.4, 0.62),
        life: rand(2.2, 3.6),
        alpha: rand(0.4, 0.75)
      });
    }

    for (let i = 0; i < 3; i++) {
      spawnWave(x, y, {
        hue: base + i * 38,
        r1: rand(110, 240),
        rings: 3,
        life: rand(1.3, 2.1),
        width: rand(1.4, 2.6),
        wobble: rand(2, 7),
        alpha: rand(0.4, 0.8)
      });
    }

    spawnSpiral(x, y, {
      hue: base + 55,
      radius: rand(55, 100),
      dot: rand(1.4, 2.4),
      life: rand(2.4, 3.6),
      alpha: rand(0.5, 0.8)
    });

    spawnRose(x, y, {
      hue: base + 120,
      radius: rand(60, 110),
      petals: 4 + ((Math.random() * 4) | 0),
      rings: 2,
      life: rand(2, 3.2),
      alpha: rand(0.4, 0.7)
    });

    for (let i = 0; i < 3; i++) {
      const a = rand(0, TAU);
      spawnComet(x, y, {
        hue: base + rand(-30, 60),
        angle: a,
        speed: rand(120, 260),
        life: rand(1, 1.8),
        size: rand(1.4, 2.6)
      });
    }

    for (let i = 0; i < 2; i++) {
      spawnRibbon(x + rand(-25, 25), y + rand(-25, 25), {
        hue: base + i * 80,
        length: rand(90, 170),
        width: rand(1.2, 2),
        alpha: rand(0.35, 0.6)
      });
    }

    spawnBurst(x, y, coarse ? 26 : 46, {
      hue: base,
      speedMin: 40,
      speedMax: 340,
      size: 2.2,
      lifeMin: 0.4,
      lifeMax: 1.3
    });

    const notes = 16;
    for (let i = 0; i < notes; i++) {
      const a = (i / notes) * TAU;
      const sp = rand(80, 200);
      spawnSpark(
        x, y,
        Math.cos(a) * 18 + Math.cos(a + Math.PI / 2) * sp,
        Math.sin(a) * 18 + Math.sin(a + Math.PI / 2) * sp,
        {
          hue: base + i * 18,
          life: rand(0.7, 1.4),
          size: rand(1.2, 2.6),
          grav: 0,
          drag: 0.97
        }
      );
    }
  }

  // ----------------------------------------------------------- drawing art

  function tracePath(xs, ys, n) {
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < n - 1; i++) {
      ctx.quadraticCurveTo(
        xs[i], ys[i],
        (xs[i] + xs[i + 1]) / 2,
        (ys[i] + ys[i + 1]) / 2
      );
    }
    ctx.lineTo(xs[n - 1], ys[n - 1]);
  }

  function traceClosed(xs, ys, n) {
    ctx.beginPath();
    ctx.moveTo((xs[n - 1] + xs[0]) / 2, (ys[n - 1] + ys[0]) / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      ctx.quadraticCurveTo(
        xs[i], ys[i],
        (xs[i] + xs[j]) / 2,
        (ys[i] + ys[j]) / 2
      );
    }
    ctx.closePath();
  }

  const segBuf = [];
  for (let i = 0; i < 8; i++) segBuf.push([]);
  const tipBuf = [];

  function drawFractal(p, age, k) {
    const grow = easeOut(Math.min(1, k / 0.52));
    const fade = 1 - smooth(0.58, 1, k);
    if (fade <= 0.001) return;

    for (let i = 0; i < p.depth; i++) segBuf[i].length = 0;
    tipBuf.length = 0;

    collectBranch(p.x, p.y, p.angle, p.len * grow, p.depth, p, age, 0);

    for (let lv = 0; lv < p.depth; lv++) {
      const buf = segBuf[lv];
      if (!buf.length) continue;

      const hue = (p.hue + lv * 16 + age * 12) % 360;
      const alpha = p.alpha * fade * Math.pow(0.8, lv) * 0.9;
      if (alpha < 0.004) continue;

      ctx.strokeStyle = hsl(hue, p.sat, p.lum, alpha);
      ctx.lineWidth = Math.max(0.35, p.width * Math.pow(0.62, lv));
      ctx.beginPath();
      for (let i = 0; i < buf.length; i += 4) {
        ctx.moveTo(buf[i], buf[i + 1]);
        ctx.lineTo(buf[i + 2], buf[i + 3]);
      }
      ctx.stroke();
    }

    if (tipBuf.length) {
      const hue = (p.hue + (p.depth - 1) * 16 + age * 12) % 360;
      const alpha = p.alpha * fade * Math.pow(0.8, p.depth - 1) * 0.75;
      if (alpha >= 0.004) {
        const rad = Math.max(0.5, p.width * 0.55);
        ctx.fillStyle = hsl((hue + 20) % 360, 100, Math.min(90, p.lum + 16), alpha);
        ctx.beginPath();
        for (let i = 0; i < tipBuf.length; i += 2) {
          ctx.moveTo(tipBuf[i] + rad, tipBuf[i + 1]);
          ctx.arc(tipBuf[i], tipBuf[i + 1], rad, 0, TAU);
        }
        ctx.fill();
      }
    }
  }

  function collectBranch(x, y, ang, len, depth, p, t, level) {
    if (depth <= 0 || len < 1.2) return;

    const sway = Math.sin(t * 1.6 + p.seed + level * 1.35) * p.sway * (1 + level * 0.5);
    const a = ang + sway;
    const nx = x + Math.cos(a) * len;
    const ny = y + Math.sin(a) * len;

    segBuf[level].push(x, y, nx, ny);

    if (depth === 1) {
      tipBuf.push(nx, ny);
      return;
    }

    for (let i = 0; i < p.branches; i++) {
      const off = (i - (p.branches - 1) / 2) * p.spread +
        Math.sin(p.seed * 0.7 + level * 2.1 + i * 1.9) * 0.12;
      const child = len * (0.67 + Math.sin(p.seed * 1.3 + level + i * 2.3) * 0.07);
      collectBranch(nx, ny, a + off, child, depth - 1, p, t, level + 1);
    }
  }

  function drawWave(p, t, k) {
    const e = easeOut(k);
    const r = p.r0 + p.r1 * e;
    const fade = Math.pow(1 - k, 1.7);
    const baseAlpha = p.alpha * fade;
    const rot = p.rot + t * p.spin;

    for (let j = 0; j < p.rings; j++) {
      const rr = r * (1 - j * 0.12);
      if (rr < 1) continue;

      const a = baseAlpha * (1 - j / (p.rings + 0.6));
      if (a <= 0.005) continue;

      const hue = (p.hue + j * 24 + t * 30 + 360) % 360;
      const segs = Math.max(40, Math.min(coarse ? 110 : 150, Math.ceil(rr * 0.55)));

      for (let i = 0; i < segs; i++) {
        const ang = (i / segs) * TAU;
        const wob = Math.sin(ang * p.freq + p.seed + t * 2.2 + j) * p.wobble * (0.35 + e);
        const rad = rr + wob;
        pathX[i] = p.x + Math.cos(ang + rot) * rad;
        pathY[i] = p.y + Math.sin(ang + rot) * rad;
      }

      traceClosed(pathX, pathY, segs);
      ctx.strokeStyle = hsl(hue, p.sat, p.lum, a);
      ctx.lineWidth = p.width * (1 - j * 0.18);
      ctx.stroke();
    }
  }

  function drawRose(p, t, k) {
    const grow = easeOut(Math.min(1, k / 0.45));
    const fade = 1 - smooth(0.62, 1, k);
    if (fade <= 0.001) return;

    const R = p.radius * grow;
    for (let j = 0; j < p.rings; j++) {
      const a = p.alpha * fade * (1 - j * 0.24);
      if (a <= 0.005) continue;

      const hue = (p.hue + j * 32 + t * 20) % 360;
      const spin = p.rot + (t - p.born / 1000) * p.spin + j * 0.22;
      const segs = coarse ? 64 : 96;
      const scale = 1 - j * 0.16;

      for (let i = 0; i < segs; i++) {
        const th = (i / segs) * TAU;
        const petal = 0.38 + 0.62 * Math.pow(Math.abs(Math.cos(p.petals * 0.5 * th + spin)), 0.75);
        const rad = R * scale * petal +
          Math.sin(th * 3 + t * 2 + p.seed + j) * p.wobble * (0.3 + grow);
        pathX[i] = p.x + Math.cos(th) * rad;
        pathY[i] = p.y + Math.sin(th) * rad;
      }

      traceClosed(pathX, pathY, segs);
      ctx.strokeStyle = hsl(hue, p.sat, p.lum, a);
      ctx.lineWidth = p.width * (1 - j * 0.2);
      ctx.stroke();
    }
  }

  function drawSpiral(p, age, k) {
    const grow = easeOut(Math.min(1, k / 0.42));
    const fade = 1 - smooth(0.62, 1, k);
    if (fade <= 0.001) return;

    const R = p.radius * grow;
    const n = p.count;
    const buckets = 6;

    for (let b = 0; b < buckets; b++) {
      const start = Math.floor(n * b / buckets);
      const end = Math.floor(n * (b + 1) / buckets);
      if (end <= start) continue;

      const hue = (p.hue + b * 10 + age * 12) % 360;
      const a = p.alpha * fade * (0.3 + 0.7 * (b / (buckets - 1)));
      ctx.fillStyle = hsl(hue, p.sat, p.lum + b * 1.2, a);
      ctx.beginPath();

      for (let i = start; i < end; i++) {
        const idx = i + 0.5;
        const theta = idx * 2.399963 + p.angle + age * p.spin;
        const rr = R * Math.sqrt(idx / n);
        const size = Math.max(0.5, (1 - idx / n) * p.dot + 0.35);
        const x = p.x + Math.cos(theta) * rr;
        const y = p.y + Math.sin(theta) * rr;
        ctx.moveTo(x + size, y);
        ctx.arc(x, y, size, 0, TAU);
      }
      ctx.fill();
    }
  }

  function drawComet(p, k) {
    const a = Math.pow(1 - k, 1.2) * p.alpha;
    const trail = p.trail;
    const buckets = 4;

    if (trail.length > 1) {
      for (let b = 0; b < buckets; b++) {
        const start = Math.floor((trail.length - 1) * b / buckets);
        const end = Math.floor((trail.length - 1) * (b + 1) / buckets) + 1;
        if (end - start < 2) continue;

        const ramp = b / (buckets - 1);
        ctx.strokeStyle = hsl(p.hue, p.sat, p.lum, a * (0.12 + 0.88 * ramp));
        ctx.lineWidth = p.size * (0.35 + 0.65 * ramp);
        ctx.beginPath();
        ctx.moveTo(trail[start].x, trail[start].y);
        for (let i = start + 1; i < end; i++) {
          ctx.lineTo(trail[i].x, trail[i].y);
        }
        ctx.stroke();
      }
    }

    ctx.fillStyle = hsl(p.hue, 100, Math.min(94, p.lum + 10), a);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.size * 0.85), 0, TAU);
    ctx.fill();
    ctx.fillStyle = hsl(p.hue, 100, Math.min(96, p.lum + 18), a * 0.18);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 3.4, 0, TAU);
    ctx.fill();
  }

  function drawRibbon(p, age, k) {
    const grow = easeOut(Math.min(1, k / 0.45));
    const fade = 1 - smooth(0.55, 1, k);
    if (fade <= 0.001) return;

    const n = coarse ? 26 : 40;
    const step = (p.length * grow) / n;

    for (let s = 0; s < p.strands; s++) {
      let x = p.x;
      let y = p.y;

      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const ang = p.angle + p.curve * u +
          Math.sin(u * Math.PI * p.waveFreq + p.seed + age * 1.5 + s * 1.7) * p.waveAmp;
        x += Math.cos(ang) * step;
        y += Math.sin(ang) * step;
        ribbonX[i] = x;
        ribbonY[i] = y;
      }

      const hue = (p.hue + s * 34 + age * 24) % 360;
      const a = p.alpha * fade;

      tracePath(ribbonX, ribbonY, n);
      ctx.strokeStyle = hsl(hue, p.sat, p.lum, a * 0.5);
      ctx.lineWidth = p.width * 2.6;
      ctx.stroke();

      tracePath(ribbonX, ribbonY, n);
      ctx.strokeStyle = hsl(hue, 100, Math.min(88, p.lum + 12), a * 0.85);
      ctx.lineWidth = p.width * 0.8;
      ctx.stroke();
    }
  }

  function drawSpark(p, k) {
    const a = Math.pow(1 - k, 1.1) * p.alpha;
    const tail = 0.016 + 0.022 * (1 - k);

    ctx.strokeStyle = hsl(p.hue, p.sat, p.lum, a);
    ctx.lineWidth = Math.max(0.6, p.size * (1 - k * 0.5));
    ctx.beginPath();
    ctx.moveTo(p.x - p.vx * tail, p.y - p.vy * tail);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function drawFlash(p, k) {
    const r = p.r * (0.4 + 0.6 * easeOut(k));
    const a = Math.pow(1 - k, 2);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, hsl(p.hue, 100, 74, a * 0.55));
    g.addColorStop(0.4, hsl(p.hue, 100, 62, a * 0.28));
    g.addColorStop(1, hsl(p.hue, 100, 50, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fill();
  }

  // ------------------------------------------------------------- stroke

  function startStroke(x, y) {
    const now = clock();
    const stroke = {
      points: [{ x: x, y: y, t: now }],
      hue: pick(HUES),
      sat: rand(85, 100),
      lum: rand(64, 76),
      width: rand(1.6, 3.2),
      strands: coarse ? 2 : 3,
      born: now,
      releasedAt: 0,
      life: coarse ? rand(1.1, 1.7) : rand(1.7, 2.6),
      seed: Math.random() * 1000,
      lastSpark: now,
      lastShape: now
    };

    strokes.push(stroke);
    if (strokes.length > 4) strokes.shift();
    activeStroke = stroke;
  }

  function strokeRun(st, xs, ys, start, end, hue, alpha) {
    if (end <= start || alpha < 0.005) return;

    ctx.strokeStyle = hsl(hue, st.sat, st.lum, alpha);
    ctx.lineWidth = st.width * (0.45 + 0.95 * alpha);
    ctx.beginPath();
    ctx.moveTo(xs[start], ys[start]);
    for (let i = start + 1; i < end; i++) {
      const mx = (xs[i - 1] + xs[i]) / 2;
      const my = (ys[i - 1] + ys[i]) / 2;
      ctx.quadraticCurveTo(xs[i - 1], ys[i - 1], mx, my);
    }
    ctx.lineTo(xs[end], ys[end]);
    ctx.stroke();
  }

  function drawStroke(st, t) {
    const pts = st.points;
    const n = pts.length;
    if (n < 1) return;

    const lifeMs = st.life * 1000;

    for (let i = 0; i < n; i++) {
      const k = (t - pts[i].t) / lifeMs;
      strokeA[i] = k >= 1 ? 0 : Math.pow(1 - k, 1.5);
    }

    if (n > 1) {
      const levels = coarse ? 5 : 7;

      for (let s = 0; s < st.strands; s++) {
        for (let i = 0; i < n; i++) {
          const a0 = pts[i > 0 ? i - 1 : 0];
          const a1 = pts[i < n - 1 ? i + 1 : n - 1];
          let tx = a1.x - a0.x;
          let ty = a1.y - a0.y;
          const len = Math.hypot(tx, ty) || 1;
          tx /= len;
          ty /= len;

          const off =
            (s - (st.strands - 1) / 2) * st.width * 2.1 +
            Math.sin(i * 0.16 + t * 1.7 + st.seed + s * 2.1) * st.width * 1.4 +
            Math.sin(i * 0.045 + t * 0.7 + st.seed * 0.5) * st.width * 2.2;
          const taper = 0.22 + 0.78 * strokeA[i];

          strokeX[i] = pts[i].x - ty * off * taper;
          strokeY[i] = pts[i].y + tx * off * taper;
        }

        const hue = (st.hue + s * 32 + t * 0.02) % 360;
        const strand = s === 0 ? 1 : 0.5;

        let runStart = 0;
        let runLevel = -1;

        for (let i = 0; i < n - 1; i++) {
          const segA = Math.min(strokeA[i], strokeA[i + 1]);
          if (segA <= 0.004) continue;

          const lvl = Math.min(levels - 1, (segA * levels) | 0);
          if (lvl !== runLevel) {
            if (runLevel >= 0) {
              strokeRun(st, strokeX, strokeY, runStart, i, hue, ((runLevel + 0.65) / levels) * strand);
            }
            runStart = i;
            runLevel = lvl;
          }
        }

        if (runLevel >= 0) {
          strokeRun(st, strokeX, strokeY, runStart, n - 1, hue, ((runLevel + 0.65) / levels) * strand);
        }
      }
    }

    const head = pts[n - 1];
    const headAlpha = strokeA[n - 1];
    if (headAlpha > 0.004) {
      const radius = 20 + st.width * (st.releasedAt ? 4 : 9);
      const pulse = st.releasedAt ? 1 : 0.75 + 0.25 * Math.sin(t * 0.006 + st.seed);
      const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, radius);
      g.addColorStop(0, hsl(st.hue, 100, 82, headAlpha * 0.4 * pulse));
      g.addColorStop(0.45, hsl((st.hue + 30) % 360, 100, 68, headAlpha * 0.16 * pulse));
      g.addColorStop(1, hsl((st.hue + 30) % 360, 100, 60, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(head.x, head.y, radius, 0, TAU);
      ctx.fill();
    }
  }

  // -------------------------------------------------------------- update

  function update(dt, t) {
    const invDt = 1 / Math.max(dt, 1 / 240);

    const rawVx = (pointer.x - pointer.lastX) * invDt;
    const rawVy = (pointer.y - pointer.lastY) * invDt;
    pointer.lastX = pointer.x;
    pointer.lastY = pointer.y;
    pointer.vx += (rawVx - pointer.vx) * Math.min(1, dt * 20);
    pointer.vy += (rawVy - pointer.vy) * Math.min(1, dt * 20);

    const pushR = coarse ? 56 : 80;
    const speed = Math.hypot(pointer.vx, pointer.vy);
    const pushBase = 160 + Math.min(600, speed) * 1.25;
    const cursorR = coarse ? 0 : 74;

    let cursorPushX = 0;
    let cursorPushY = 0;

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (t - p.born > p.life * 1000) {
        particles.splice(i, 1);
        continue;
      }

      const dxp = p.x - pointer.x;
      const dyp = p.y - pointer.y;
      const d = Math.hypot(dxp, dyp);

      let ax = 0;
      let ay = 0;
      if (d < pushR && d > 0.001) {
        const fall = 1 - d / pushR;
        const mag = fall * pushBase * (pointer.down ? 1.35 : 1);
        ax = (dxp / d) * mag;
        ay = (dyp / d) * mag;
      }

      if (p.type === 'spark') {
        const f = Math.pow(p.drag, dt * 60);
        p.vx = p.vx * f + ax * dt;
        p.vy = p.vy * f + p.grav * dt + ay * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else if (p.type === 'comet') {
        const f = Math.pow(p.drag, dt * 60);
        p.vx = p.vx * f + ax * dt;
        p.vy = p.vy * f + p.grav * dt + ay * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 12) p.trail.shift();
      } else {
        p.vx += ((p.homeX - p.x) * 9 - p.vx * 3.4 + ax) * dt;
        p.vy += ((p.homeY - p.y) * 9 - p.vy * 3.4 + ay) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      if (cursorR > 0 && t - p.born > 220) {
        const cx = p.x - pointer.x;
        const cy = p.y - pointer.y;
        const cd = Math.hypot(cx, cy);
        if (cd < cursorR && cd > 0.001) {
          const fall = 1 - cd / cursorR;
          const mag = fall * 3400;
          cursorPushX -= (cx / cd) * mag;
          cursorPushY -= (cy / cd) * mag;
        }
      }
    }

    cursor.vX += (-cursor.offX * 120 - cursor.vX * 22 + cursorPushX) * dt;
    cursor.vY += (-cursor.offY * 120 - cursor.vY * 22 + cursorPushY) * dt;
    cursor.offX += cursor.vX * dt;
    cursor.offY += cursor.vY * dt;

    const offLen = Math.hypot(cursor.offX, cursor.offY);
    if (offLen > 46) {
      cursor.offX = (cursor.offX / offLen) * 46;
      cursor.offY = (cursor.offY / offLen) * 46;
    }

    cursor.x = pointer.x + cursor.offX;
    cursor.y = pointer.y + cursor.offY;

    if (cursorEl) {
      cursorEl.style.transform =
        'translate3d(' + cursor.x.toFixed(1) + 'px,' + cursor.y.toFixed(1) + 'px,0)';
    }

    for (let i = strokes.length - 1; i >= 0; i--) {
      const st = strokes[i];
      const lifeMs = st.life * 1000;

      let cut = 0;
      while (cut < st.points.length && t - st.points[cut].t > lifeMs) cut++;
      if (cut > 0) st.points.splice(0, cut);

      if (st.points.length === 0 && st !== activeStroke) strokes.splice(i, 1);
    }

    if (pointer.down && activeStroke) {
      const interval = coarse ? 170 : 125;
      if (t - lastHold >= interval) {
        lastHold = t;
        pointer.pulseCount++;
        holdPulse(cursor.x, cursor.y, activeStroke, t);
      }
    }

    if (!demoDone && !reduceMotion && t > 1400) {
      demoDone = true;
      if (!started) ensemble(W * 0.5, H * 0.5);
    }

    if (!reduceMotion && !pointer.down && t - lastInteraction > 2600 && t - lastAmbient > 1100) {
      lastAmbient = t;
      randomTouch(rand(W * 0.08, W * 0.92), rand(H * 0.1, H * 0.9), Math.random() < 0.22);
    }

    if (t > nextThemeAt) switchTheme(t);

    for (let i = 0; i < MODES.length; i++) {
      const m = MODES[i];
      themeAlpha[m] += (themeTarget[m] - themeAlpha[m]) * Math.min(1, dt * 0.9);
      if (themeAlpha[m] < 0.001) themeAlpha[m] = 0;
      if (themeAlpha[m] > 0.999) themeAlpha[m] = 1;
    }
  }

  // -------------------------------------------------------------- render

  function renderStage(t) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const k = (t - p.born) / (p.life * 1000);
      if (k < 0 || k > 1) continue;
      const age = (t - p.born) / 1000;

      if (p.type === 'fractal') drawFractal(p, age, k);
      else if (p.type === 'wave') drawWave(p, age, k);
      else if (p.type === 'spark') drawSpark(p, k);
      else if (p.type === 'flash') drawFlash(p, k);
      else if (p.type === 'spiral') drawSpiral(p, age, k);
      else if (p.type === 'rose') drawRose(p, age, k);
      else if (p.type === 'comet') drawComet(p, k);
      else if (p.type === 'ribbon') drawRibbon(p, age, k);
    }

    for (let i = 0; i < strokes.length; i++) {
      drawStroke(strokes[i], t);
    }
  }

  // --------------------------------------------------------------- loop

  function frame(t) {
    const dt = Math.min(0.05, Math.max(0, (t - lastFrame) / 1000));
    lastFrame = t;

    update(dt, t);
    drawBackdrop(t, dt);
    renderStage(t);

    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------- pointer

  function wake() {
    lastInteraction = clock();
    if (!started) {
      started = true;
      document.body.classList.add('started');
    }
  }

  function markCursor(down) {
    if (!cursorEl) return;
    if (!cursor.on) {
      cursor.on = true;
      cursorEl.classList.add('on');
      document.body.classList.add('cursor-live');
    }
    cursorEl.classList.toggle('down', down);
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointer.down) return;

    e.preventDefault();

    pointer.down = true;
    pointer.id = e.pointerId;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.lastX = e.clientX;
    pointer.lastY = e.clientY;
    pointer.downT = clock();
    pointer.moved = 0;
    lastHold = pointer.downT;

    markCursor(true);

    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    const ex = e.clientX + cursor.offX;
    const ey = e.clientY + cursor.offY;

    startStroke(ex, ey);
    spawnBurst(ex, ey, coarse ? 5 : 8, {
      speedMax: 120,
      lifeMax: 0.55,
      size: 1.4
    });
    wake();
  });

  stage.addEventListener('pointermove', (e) => {
    const x = e.clientX;
    const y = e.clientY;
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    const dist = Math.hypot(dx, dy);

    pointer.x = x;
    pointer.y = y;

    const t = clock();

    const ex = x + cursor.offX;
    const ey = y + cursor.offY;

    markCursor(pointer.down);

    if (pointer.down && activeStroke) {
      pointer.moved += dist;
      const st = activeStroke;
      const last = st.points[st.points.length - 1];
      const step = last ? Math.hypot(ex - last.x, ey - last.y) : 999;

      if (step > 2.3) {
        if (step > 170) st.points.length = 0;
        st.points.push({ x: ex, y: ey, t: t });
        if (st.points.length > STROKE_MAX) st.points.shift();
      }

      if (t - st.lastSpark > 65 && dist > 0.4) {
        st.lastSpark = t;
        const back = Math.atan2(dy, dx) + Math.PI;
        const sparks = coarse ? 1 : 2;
        for (let i = 0; i < sparks; i++) {
          const a = back + rand(-1.2, 1.2);
          const sp = rand(20, Math.min(240, 30 + dist * 6));
          spawnSpark(ex, ey, Math.cos(a) * sp, Math.sin(a) * sp, {
            hue: st.hue + rand(-25, 45),
            life: rand(0.25, 0.7),
            size: rand(0.6, 1.8),
            grav: rand(-20, 40),
            drag: 0.95
          });
        }
      }

      if (t - st.lastShape > 460) {
        st.lastShape = t;
        randomTouch(ex + rand(-10, 10), ey + rand(-10, 10), true);
      }
    } else if (!pointer.down && dist > 1.5 && t - lastSpawn > 95) {
      lastSpawn = t;
      randomTouch(ex, ey, false);
    }

    if (dist > 0) wake();
  });

  function endPointer(e) {
    if (!pointer.down) return;

    const dur = clock() - pointer.downT;
    const tapped = pointer.moved < 10 && dur < 500;

    pointer.down = false;
    pointer.id = null;

    markCursor(false);

    try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    if (activeStroke) {
      activeStroke.releasedAt = clock();
      if (tapped) {
        const idx = strokes.indexOf(activeStroke);
        if (idx >= 0) strokes.splice(idx, 1);
      } else {
        const pts = activeStroke.points;
        const end = pts[pts.length - 1];
        if (end) {
          spawnBurst(end.x, end.y, coarse ? 6 : 10, {
            hue: activeStroke.hue,
            speedMin: 30,
            speedMax: 200,
            lifeMax: 0.85,
            size: 1.8
          });
        }
      }
      activeStroke = null;
    }

    if (tapped) ensemble(e.clientX + cursor.offX, e.clientY + cursor.offY);
    wake();
  }

  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  // --------------------------------------------------------------- boot

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  document.addEventListener('visibilitychange', () => {
    lastFrame = clock();
  });

  resize();
  applyThemeLayers();

  if (!reduceMotion) {
    for (let i = 0; i < (coarse ? 2 : 4); i++) {
      randomTouch(rand(W * 0.2, W * 0.8), rand(H * 0.25, H * 0.75), false);
    }
  }

  requestAnimationFrame(frame);
})();
