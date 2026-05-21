// /hero-radar.js · FragValue
//
// Shared script : tactical CS2 radar canvas animation for the hero section
// + motion design Intersection Observer (scroll reveal + count-up FV Rating).
//
// Used by both /index.html (FR) and /en/index.html (EN) to avoid code
// duplication. The radar JS is language-neutral (round numbers, position
// coordinates, color hex codes), the motion observer is too.
//
// Boots when <canvas id="heroRadar"> exists in the DOM. No-ops on mobile
// (<900px) and reduced-motion (accessibility).
//
// Architecture :
//   - PLAYERS  : 5 dots (3 T + 2 CT) moving along scripted paths on Mirage radar
//   - EVENTS   : smoke expansions (~3s) + kill X markers (~1.5s)
//   - RADAR PNG: /maps/de_mirage_radar_psd.png (Valve official 1024x1024)
//   - LOOP     : 16 seconds, scripted timeline R12 -> R13 -> R14
//   - Coords are MAP-RELATIVE (0-1 of drawn map rect), converted via
//     mapToCanvas() at render time. Avoids dots falling outside the map.

(function() {
  'use strict';
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.getElementById('heroRadar');
  if (!cv) return;
  // Skip mobile (CSS hides it too, double-check to avoid useless boot)
  if (window.innerWidth < 900) return;

  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  function resize() {
    const rect = cv.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = rect.width; H = rect.height;
    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', () => { resize(); });

  // Load the official CS2 Mirage radar PNG (same asset as 2D Replay).
  // Drawn with globalAlpha 0.38 so it stays subtle behind the H1.
  const mapImg = new Image();
  let mapImgReady = false;
  mapImg.onload = () => { mapImgReady = true; };
  mapImg.onerror = () => { console.warn('[hero-radar] map img failed, fallback to lime outline'); };
  mapImg.src = '/maps/de_mirage_radar_psd.png';

  // Player/event positions are MAP-RELATIVE (0-1 of the drawn map rect,
  // not the canvas). Converted at render time via mapToCanvas(). Else the
  // dots fall outside the map (PNG is centered with margins).
  //
  // Mirage radar layout (Valve official PNG, 1024x1024 square) :
  //   - A site default (palace pit) : top-left (~0.20, 0.25)
  //   - A ramp                       : top-mid (~0.42, 0.30)
  //   - Top mid / window             : center (~0.48, 0.42)
  //   - Mid / connector              : center (~0.50, 0.50)
  //   - Jungle / catwalk             : top-right (~0.60, 0.30)
  //   - CT spawn                     : right (~0.70, 0.30)
  //   - B apartments                 : bottom-left (~0.20, 0.65)
  //   - B site                       : bottom-mid (~0.32, 0.68)
  //   - Underpass / B short          : bottom (~0.42, 0.62)
  //   - T spawn (pyramid)            : bottom-right (~0.62, 0.72)
  //   - T ramp                       : bottom-mid (~0.50, 0.62)
  const PLAYERS = [
    // T side (orange) : T spawn -> T ramp -> top mid -> A ramp -> A site
    { team:'T',  color:'#ff9544', path:[[0.60,0.70],[0.52,0.60],[0.48,0.50],[0.42,0.40],[0.28,0.30]], speed:0.06 },
    { team:'T',  color:'#ff9544', path:[[0.62,0.72],[0.55,0.62],[0.50,0.52],[0.40,0.42],[0.25,0.32]], speed:0.055 },
    { team:'T',  color:'#ff9544', path:[[0.58,0.68],[0.50,0.58],[0.46,0.48],[0.38,0.38],[0.30,0.28]], speed:0.065 },
    // CT side (cyan) : defending A palace + jungle rotation
    { team:'CT', color:'#5b9eff', path:[[0.32,0.32],[0.28,0.30],[0.26,0.32],[0.30,0.34]], speed:0.04 },
    { team:'CT', color:'#5b9eff', path:[[0.42,0.32],[0.45,0.30],[0.48,0.32],[0.45,0.34]], speed:0.035 },
  ];

  const EVENTS = [
    { t:2.0,  type:'smoke', pos:[0.38,0.32], dur:3.0 },  // smoke CT palace
    { t:5.5,  type:'kill',  pos:[0.30,0.30], dur:1.5 },  // kill A site
    { t:8.0,  type:'smoke', pos:[0.48,0.42], dur:3.0 },  // smoke top mid
    { t:11.0, type:'kill',  pos:[0.26,0.30], dur:1.5 },  // kill A palace
    { t:13.5, type:'kill',  pos:[0.46,0.45], dur:1.5 },  // kill mid
  ];

  // Stored at render time so player/event coords can be converted from
  // map-relative to canvas-absolute.
  let MAP_RECT = { x:0, y:0, w:1, h:1 };
  function mapToCanvas(p) {
    return [MAP_RECT.x + p[0] * MAP_RECT.w, MAP_RECT.y + p[1] * MAP_RECT.h];
  }

  // Scripted round counter : R12 -> R13 -> R14 over the 16s loop
  const ROUND_TIMELINE = [
    { t:0.0,  r:12, score:'7-5' },
    { t:6.0,  r:13, score:'8-5' },
    { t:11.5, r:14, score:'8-6' },
  ];

  // ── Helpers ───────────────────────────────────────────────────────────
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpPos(p1, p2, t) { return [lerp(p1[0],p2[0],t), lerp(p1[1],p2[1],t)]; }

  // Player position along its path at normalized progress (0-1 loop)
  function playerPos(player, progress) {
    const segments = player.path.length - 1;
    const totalLen = segments;
    const pos = (progress % 1) * totalLen;
    const seg = Math.floor(pos);
    const frac = pos - seg;
    return lerpPos(player.path[seg], player.path[Math.min(seg+1, segments)], frac);
  }

  function currentRound(t) {
    let r = ROUND_TIMELINE[0];
    for (const x of ROUND_TIMELINE) { if (t >= x.t) r = x; }
    return r;
  }

  // ── Render frame ──────────────────────────────────────────────────────
  let startTime = performance.now();
  const LOOP_MS = 16000;
  let visible = true;
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible) startTime = performance.now();
  });

  function render(now) {
    if (!visible) { requestAnimationFrame(render); return; }
    const elapsedMs = (now - startTime) % LOOP_MS;
    const t = elapsedMs / 1000;
    const progress = elapsedMs / LOOP_MS;

    ctx.clearRect(0, 0, W, H);

    // 1. Mirage radar PNG. Centered draw + MAP_RECT stored for coord conversion.
    if (mapImgReady) {
      const imgAR = mapImg.width / mapImg.height;
      const drawH = H * 0.92;
      const drawW = drawH * imgAR;
      const drawX = (W - drawW) / 2;
      const drawY = (H - drawH) / 2;
      MAP_RECT = { x: drawX, y: drawY, w: drawW, h: drawH };
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.drawImage(mapImg, drawX, drawY, drawW, drawH);
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = 'rgba(184,255,87,0.08)';
      ctx.fillRect(drawX, drawY, drawW, drawH);
      ctx.restore();
    } else {
      // Geometric fallback while img loads (first paint)
      MAP_RECT = { x: W * 0.15, y: H * 0.15, w: W * 0.7, h: H * 0.7 };
      ctx.strokeStyle = 'rgba(184,255,87,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(MAP_RECT.x, MAP_RECT.y, MAP_RECT.w, MAP_RECT.h);
    }

    // 2. A/B/MID labels (map-relative positions, converted)
    ctx.fillStyle = 'rgba(184,255,87,0.55)';
    ctx.font = 'bold 11px "Space Mono", monospace';
    ctx.textAlign = 'center';
    const labelA = mapToCanvas([0.25, 0.28]);
    const labelB = mapToCanvas([0.32, 0.68]);
    const labelMid = mapToCanvas([0.50, 0.50]);
    ctx.fillText('A', labelA[0], labelA[1]);
    ctx.fillText('B', labelB[0], labelB[1]);
    ctx.font = '9px "Space Mono", monospace';
    ctx.fillStyle = 'rgba(184,255,87,0.4)';
    ctx.fillText('MID', labelMid[0], labelMid[1]);

    // 3. Radar sweep : centered on map center (not canvas center)
    const [sweepCx, sweepCy] = mapToCanvas([0.50, 0.50]);
    const sweepAngle = (elapsedMs / LOOP_MS) * Math.PI * 4;  // 2 rotations / loop
    const sweepRadius = Math.max(MAP_RECT.w, MAP_RECT.h) * 0.7;
    const sweepGrad = ctx.createConicGradient
      ? ctx.createConicGradient(sweepAngle, sweepCx, sweepCy)
      : null;
    if (sweepGrad) {
      sweepGrad.addColorStop(0, 'rgba(184,255,87,0.18)');
      sweepGrad.addColorStop(0.05, 'rgba(184,255,87,0)');
      sweepGrad.addColorStop(1, 'rgba(184,255,87,0)');
      ctx.fillStyle = sweepGrad;
      ctx.beginPath();
      ctx.arc(sweepCx, sweepCy, sweepRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Smoke events : expanding circles
    for (const ev of EVENTS) {
      if (ev.type !== 'smoke') continue;
      const localT = t - ev.t;
      if (localT < 0 || localT > ev.dur) continue;
      const k = localT / ev.dur;
      const radius = lerp(4, 28, k);
      const alpha = lerp(0.6, 0, k);
      const [ex, ey] = mapToCanvas(ev.pos);
      ctx.fillStyle = `rgba(220,230,235,${alpha * 0.4})`;
      ctx.strokeStyle = `rgba(220,230,235,${alpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ex, ey, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 5. Player dots (map-relative -> canvas)
    for (const p of PLAYERS) {
      const playerProg = (progress * p.speed * 10) % 1;
      const [px, py] = playerPos(p, playerProg);
      const [x, y] = mapToCanvas([px, py]);
      const grd = ctx.createRadialGradient(x, y, 0, x, y, 12);
      grd.addColorStop(0, p.color + 'cc');
      grd.addColorStop(1, p.color + '00');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Kill markers : X with flash + fade out
    for (const ev of EVENTS) {
      if (ev.type !== 'kill') continue;
      const localT = t - ev.t;
      if (localT < 0 || localT > ev.dur) continue;
      const k = localT / ev.dur;
      const alpha = 1 - k;
      const size = lerp(5, 12, k);
      ctx.strokeStyle = `rgba(255,107,107,${alpha})`;
      ctx.lineWidth = 2;
      const [x, y] = mapToCanvas(ev.pos);
      ctx.beginPath();
      ctx.moveTo(x - size, y - size); ctx.lineTo(x + size, y + size);
      ctx.moveTo(x + size, y - size); ctx.lineTo(x - size, y + size);
      ctx.stroke();
    }

    // 7. Round counter top-right
    const round = currentRound(t);
    ctx.fillStyle = 'rgba(184,255,87,0.65)';
    ctx.font = 'bold 11px "Space Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`R${round.r} · ${round.score}`, W * 0.92, H * 0.18);
    ctx.fillStyle = 'rgba(184,255,87,0.4)';
    ctx.font = '9px "Space Mono", monospace';
    ctx.fillText('● TACTICAL VIEW', W * 0.92, H * 0.215);

    requestAnimationFrame(render);
  }

  // Fade-in canvas once ready (avoid white flash at boot)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cv.classList.add('ready');
      requestAnimationFrame(render);
    });
  });
})();

// ════════ Motion design : Intersection Observer + count-up ════════
(function() {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // 1. Scroll-reveal : add .scroll-reveal class to sections, trigger
  // .is-visible when 15% of viewport is reached. Unobserve after reveal.
  const targets = document.querySelectorAll('section');
  targets.forEach(s => s.classList.add('scroll-reveal'));
  const heroEl = document.querySelector('.hero');
  if (heroEl) {
    heroEl.classList.remove('scroll-reveal');
    heroEl.classList.add('is-visible');
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -80px 0px' });
  targets.forEach(t => io.observe(t));

  // 2. Count-up animation for FV Rating cards in demo preview hero.
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  const valueEls = document.querySelectorAll('.demo-card-val');
  const countIo = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting || e.target.dataset.animated === '1') return;
      const el = e.target;
      el.dataset.animated = '1';
      const raw = (el.textContent || '').trim();
      const isPercent = /%$/.test(raw);
      const cleanNum = parseFloat(raw.replace('%', '').replace(',', '.'));
      if (isNaN(cleanNum)) return;
      const decimals = (raw.includes('.') || raw.includes(','))
        ? (raw.replace('%','').split('.')[1] || raw.replace('%','').split(',')[1] || '').length
        : 0;
      const renderValue = (v) => isPercent ? Math.round(v) + '%' : v.toFixed(decimals);
      const t0 = performance.now();
      const dur = 1100;
      function frame(now) {
        const t = Math.min((now - t0) / dur, 1);
        const eased = easeOutCubic(t);
        el.textContent = renderValue(0 + (cleanNum - 0) * eased);
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      countIo.unobserve(el);
    });
  }, { threshold: 0.5 });
  valueEls.forEach(el => countIo.observe(el));
})();
