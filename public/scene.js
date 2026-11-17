// The pixel-art flight: a rocket climbing from a dusk launch pad through real landmarks into deep space.
// Everything is drawn into a small offscreen buffer and scaled up with smoothing off, so it stays crisp pixels.
import { LANDMARKS, distanceKm, fmtDistance } from './engine.js';

const K = 6;                 // buffer pixels of altitude per point
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SKY = [                // [altitude in points, colour]
  [-10, '#ff9c6b'], [12, '#ff8a7a'], [35, '#e0628f'], [70, '#8e3f95'], [120, '#4b2a7c'], [200, '#26185a'], [320, '#170f3c'], [700, '#0d0826'], [4000, '#05030f'],
];
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => { const x = hex(a), y = hex(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`; };
function skyAt(pts) {
  for (let i = 0; i < SKY.length - 1; i++) if (pts < SKY[i + 1][0]) return mix(SKY[i][1], SKY[i + 1][1], Math.max(0, (pts - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0])));
  return SKY[SKY.length - 1][1];
}
function seeded(n) { let s = n * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }

// sprite maps: each char is a colour key, '.' is empty
const ROCKET = [
  '....r....',
  '...rrr...',
  '...rcr...',
  '..ccccc..',
  '..cwwwc..',
  '..cwbwc..',
  '..cwwwc..',
  '..ccccc..',
  '..ccccc..',
  '..crrrc..',
  '.rcccccr.',
  'rrcccccrr',
  'rr.ccc.rr',
  'r..ddd..r',
];
const ROCKET_COL = { r: '#ff5f7e', c: '#fff3dc', w: '#8fd3ff', b: '#3b6fd8', d: '#5a3a6e' };

export function createScene(canvas) {
  const ctx = canvas.getContext('2d');
  const buf = document.createElement('canvas'), b = buf.getContext('2d');
  let W = 0, H = 0, S = 3, bw = 0, bh = 0;
  let alt = 0, target = 0, anchor = 0.86, anchorT = 0.86, rx = 0.5, rxT = 0.5, boost = 0, shake = 0, last = performance.now();
  let passed = 0, onPass = null, labels = false;
  const rand = seeded(7);
  const stars = Array.from({ length: 1400 }, () => ({ x: rand(), y: 40 + rand() * 4200, s: rand() < 0.1 ? 2 : 1, tw: rand() * 6 })).sort((a, c) => a.y - c.y);
  const clouds = Array.from({ length: 16 }, () => ({ x: rand(), y: 10 + rand() * 40, w: 14 + rand() * 26, v: 0.002 + rand() * 0.004 }));
  const rocks = Array.from({ length: 70 }, () => ({ x: rand(), y: 285 + rand() * 30, r: 1 + Math.floor(rand() * 3) }));
  const smoke = [];
  const mesas = Array.from({ length: 40 }, (_, i) => 6 + Math.floor(Math.abs(Math.sin(i * 1.7) * 10 + Math.sin(i * 0.37) * 8)));

  function resize() {
    W = innerWidth; H = innerHeight;
    S = W < 700 ? 3 : 4;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bw = Math.ceil(W / S); bh = Math.ceil(H / S);
    buf.width = bw; buf.height = bh;
  }
  const sy = wy => Math.round(bh * anchor - (wy - alt * K)); // world y (buffer px above ground) -> buffer y

  function disc(cx, cy, r, col, shade) {
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy));
      b.fillStyle = col; b.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
      if (shade) { b.fillStyle = shade; const sw = Math.max(1, Math.floor(w * 0.45)); b.fillRect(cx + w - sw + 1, cy + dy, sw, 1); }
    }
  }
  function sprite(map, cols, x, y) {
    map.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') { b.fillStyle = cols[ch]; b.fillRect(x + i, y + j, 1, 1); } }));
  }

  // landmark painters: (centre x in buffer px, centre y) -> draws; return label anchor
  const PAINT = {
    'the edge of space': (x, y) => { b.fillStyle = 'rgba(255,243,220,.35)'; for (let i = 0; i < bw; i += 4) b.fillRect(i, y, 2, 1); },
    'the Space Station': (x, y) => { b.fillStyle = '#4b4f8f'; b.fillRect(x - 11, y - 2, 8, 4); b.fillRect(x + 4, y - 2, 8, 4); b.fillStyle = '#c9c3dd'; b.fillRect(x - 3, y - 1, 7, 3); b.fillRect(x, y - 3, 1, 7); },
    'the GPS satellites': (x, y) => { b.fillStyle = '#4b4f8f'; b.fillRect(x - 7, y - 1, 5, 3); b.fillRect(x + 3, y - 1, 5, 3); b.fillStyle = '#e8c36a'; b.fillRect(x - 2, y - 2, 5, 5); },
    'the Moon': (x, y) => { disc(x, y, 16, '#ddd6ea', '#a99fc2'); [[-6, -5, 3], [4, 3, 4], [-3, 7, 2], [6, -8, 2]].forEach(([a, c, r]) => disc(x + a, y + c, r, '#bfb5d4')); },
    'Mars': (x, y) => { disc(x, y, 11, '#e2673b', '#9c3a24'); disc(x - 3, y - 2, 3, '#c4532f'); b.fillStyle = '#ffe3d1'; b.fillRect(x - 3, y - 11, 6, 2); },
    'the asteroid belt': () => { for (const r of rocks) { const yy = sy(r.y * K); if (yy > -5 && yy < bh + 5) disc(Math.round(r.x * bw), yy, r.r, '#8e7f9e', '#5d5070'); } },
    'Jupiter': (x, y) => { disc(x, y, 28, '#f1d7b4', '#b98b63'); ['#d29f72', '#c47f55', '#e8bd92', '#c47f55'].forEach((c, i) => { const yy = y - 16 + i * 9; for (let dy = 0; dy < 3; dy++) { const w = Math.floor(Math.sqrt(784 - (yy + dy - y) ** 2)); b.fillStyle = c; b.fillRect(x - w, yy + dy, w * 2 + 1, 1); } }); disc(x + 9, y + 7, 3, '#b8483a'); },
    'Saturn': (x, y) => { disc(x, y, 18, '#ecd59a', '#b99a5c'); b.fillStyle = '#d8bf86'; for (let t = 0; t < 360; t += 2) { const a = t * Math.PI / 180, px = Math.round(x + Math.cos(a) * 34), py = Math.round(y + Math.sin(a) * 8); if (!(Math.sin(a) < 0 && Math.abs(px - x) < 18)) b.fillRect(px, py, 2, 1); } },
    'Uranus': (x, y) => { disc(x, y, 14, '#a7ece8', '#6fb5b8'); b.fillStyle = 'rgba(220,250,250,.6)'; b.fillRect(x - 1, y - 22, 2, 44); },
    'Neptune': (x, y) => { disc(x, y, 14, '#5b84f2', '#3552b3'); disc(x - 4, y + 2, 2, '#26388a'); },
    'Pluto': (x, y) => { disc(x, y, 7, '#d8b89a', '#a78468'); b.fillStyle = '#f4e3cf'; b.fillRect(x - 2, y, 4, 3); b.fillRect(x - 3, y - 1, 2, 2); b.fillRect(x + 1, y - 1, 2, 2); },
    'Voyager 1': (x, y) => { disc(x, y, 6, '#e8e1f2', '#a99fc2'); b.fillStyle = '#c9c3dd'; b.fillRect(x - 1, y + 6, 2, 5); b.fillRect(x - 12, y + 9, 24, 1); b.fillStyle = '#ffd84a'; b.fillRect(x + 11, y + 8, 2, 3); },
    'the Oort Cloud': (x, y) => { for (let i = 0; i < 60; i++) { b.fillStyle = 'rgba(200,220,255,.5)'; b.fillRect(Math.round((i * 37 % 100) / 100 * bw), y - 20 + (i * 13 % 40), 1, 1); } },
    'Proxima Centauri': (x, y) => { disc(x, y, 9, '#ff9a6b'); disc(x, y, 5, '#ffd0a8'); },
    'the Pleiades': (x, y) => { [[0, 0], [8, -5], [-7, -3], [4, 7], [-4, 9], [12, 4], [-11, 6]].forEach(([a, c]) => { b.fillStyle = '#bcd6ff'; b.fillRect(x + a - 1, y + c, 3, 1); b.fillRect(x + a, y + c - 1, 1, 3); }); },
    'the centre of the Milky Way': (x, y) => { for (let i = -60; i < 60; i++) { b.fillStyle = `rgba(255,236,200,${0.35 - Math.abs(i) / 220})`; b.fillRect(x + i * 2, y + Math.round(i * 0.35), 2, 2); } disc(x, y, 5, '#fff1c9'); },
    'Andromeda': (x, y) => { for (let t = 0; t < 8 * Math.PI; t += 0.12) { const r = t * 2.2; b.fillStyle = 'rgba(214,196,255,.7)'; b.fillRect(Math.round(x + Math.cos(t) * r), Math.round(y + Math.sin(t) * r * 0.45), 1, 1); } disc(x, y, 3, '#fff3dc'); },
    'the edge of the observable universe': (x, y) => { b.fillStyle = 'rgba(255,243,220,.25)'; for (let i = 0; i < bw; i += 3) b.fillRect(i, y + ((i * 7) % 5), 1, 1); },
  };
  const SIDE = { 'the Space Station': 0.72, 'the GPS satellites': 0.25, 'the Moon': 0.76, 'Mars': 0.22, 'Jupiter': 0.78, 'Saturn': 0.24, 'Uranus': 0.76, 'Neptune': 0.26, 'Pluto': 0.72, 'Voyager 1': 0.3, 'Proxima Centauri': 0.74, 'the Pleiades': 0.26, 'the centre of the Milky Way': 0.5, 'Andromeda': 0.72 };

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    // ease altitude toward target; the gap decides thrust
    const gap = target - alt;
    alt += reduced ? gap : gap * Math.min(1, dt * 2.4) + Math.sign(gap) * Math.min(Math.abs(gap), dt * 8);
    if (Math.abs(target - alt) < 0.05) alt = target;
    boost = Math.max(0, Math.min(1, Math.abs(target - alt) / 20));
    anchor += (anchorT - anchor) * Math.min(1, dt * 3);
    rx += (rxT - rx) * Math.min(1, dt * 3);
    shake = boost > 0.05 && !reduced ? (Math.random() - 0.5) * 2 : 0;
    while (passed + 1 < LANDMARKS.length && LANDMARKS[passed + 1].pts <= alt) { passed++; onPass?.(LANDMARKS[passed]); }

    // sky, two rows at a time
    for (let y = 0; y < bh; y += 2) { b.fillStyle = skyAt(alt + (bh * anchor - y) / K); b.fillRect(0, y, bw, 2); }
    // stars
    const top = alt + (bh * anchor) / K, bottom = alt - (bh * (1 - anchor)) / K;
    for (const s of stars) {
      if (s.y < bottom || s.y > top) continue;
      const a = Math.min(1, Math.max(0, (s.y - 45) / 120)) * (reduced ? 0.8 : 0.55 + 0.45 * Math.sin(now / 700 + s.tw));
      if (a <= 0.02) continue;
      b.fillStyle = `rgba(255,243,220,${a})`; b.fillRect(Math.round(s.x * bw), sy(s.y * K), s.s, s.s);
    }
    // clouds
    for (const c of clouds) {
      c.x = (c.x + (reduced ? 0 : c.v * dt)) % 1.2;
      const x = Math.round((c.x - 0.1) * bw), y = sy(c.y * K), w = Math.round(c.w);
      if (y < -12 || y > bh + 12) continue;
      b.fillStyle = 'rgba(255,214,200,.85)'; b.fillRect(x, y - 3, w, 4); b.fillRect(x + 3, y - 6, w - 9, 3); b.fillRect(x + 8, y - 8, Math.max(4, w - 20), 2);
      b.fillStyle = 'rgba(214,120,150,.7)'; b.fillRect(x + 1, y + 1, w - 2, 2);
    }
    // landmarks
    for (const L of LANDMARKS) {
      const paint = PAINT[L.name]; if (!paint) continue;
      const y = sy(L.pts * K);
      if (L.name !== 'the asteroid belt' && (y < -60 || y > bh + 60)) continue;
      paint(Math.round((SIDE[L.name] ?? 0.5) * bw), y);
    }
    // ground: horizon glow, mesas, launch tower
    const g = sy(0);
    if (g < bh + 40) {
      b.fillStyle = '#ffcf8a'; b.fillRect(0, g - 22, bw, 1);
      b.fillStyle = '#5b2d6e'; mesas.forEach((h, i) => { const w = Math.ceil(bw / mesas.length) + 1; b.fillRect(i * w - 2, g - h - 4, w, h + 4); });
      b.fillStyle = '#3a1d4f'; for (let i = 0; i < bw; i += 9) { const h = 3 + ((i * 7) % 6); b.fillRect(i, g - h, 11, h); }
      b.fillStyle = '#2a1340'; b.fillRect(0, g, bw, bh - g + 2);
      b.fillStyle = '#41205a'; for (let i = 0; i < bw; i += 5) b.fillRect(i, g + 3 + ((i * 3) % 4), 2, 1);
      const px = Math.round(rx * bw);
      b.fillStyle = '#6b4a86'; b.fillRect(px - 14, g - 2, 28, 3);                       // pad
      b.fillStyle = '#c96a5a'; for (let y = g - 34; y < g - 2; y += 1) b.fillRect(px - 11, y, 1, 1), b.fillRect(px - 8, y, 1, 1);
      for (let y = g - 34; y < g - 2; y += 4) { b.fillRect(px - 11, y, 4, 1); }
      b.fillStyle = (Math.floor(now / 600) % 2) ? '#ff5f7e' : '#5a2a40'; b.fillRect(px - 10, g - 36, 2, 2); // blinking beacon
      b.fillStyle = '#c96a5a'; b.fillRect(px - 8, g - 22, 5, 1);                         // service arm
    }
    // rocket + exhaust + smoke
    const rwx = Math.round(rx * bw) - 4 + Math.round(shake), rwy = Math.round(bh * anchor) - 15 - 2;
    if (boost > 0.02 || g > bh) {
      const len = 3 + Math.round(boost * 10) + (reduced ? 0 : Math.round(Math.random() * 2));
      for (let i = 0; i < len; i++) { b.fillStyle = i < 2 ? '#fff3b0' : i < len * 0.6 ? '#ffb347' : '#ff5f7e'; const w = Math.max(1, 3 - Math.floor(i / 3)); b.fillRect(rwx + 4 - Math.floor(w / 2), rwy + 14 + i, w, 1); }
      if (!reduced && boost > 0.1 && Math.random() < 0.6) smoke.push({ x: rwx + 3 + Math.random() * 3, y: rwy + 16 + len, life: 1 });
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i]; p.life -= dt * 0.9; p.y += dt * 30; p.x += (Math.random() - 0.5) * 0.6;
      if (p.life <= 0) { smoke.splice(i, 1); continue; }
      b.fillStyle = `rgba(230,200,225,${p.life * 0.6})`; const s = 1 + Math.round((1 - p.life) * 3); b.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
    sprite(ROCKET, ROCKET_COL, rwx, rwy);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, 0, 0, bw * S, bh * S);
    // landmark labels at full resolution
    if (labels) {
    ctx.font = '600 13px "Pixelify Sans", monospace';
    ctx.textBaseline = 'middle';
    for (const L of LANDMARKS) {
      if (!L.pts || !PAINT[L.name] && L.name !== 'the clouds') continue;
      const y = sy(L.pts * K) * S;
      if (y < 30 || y > H - 10) continue;
      const side = SIDE[L.name] ?? 0.5, label = `${L.name.replace(/^the /, '').toUpperCase()} · ${fmtDistance(L.km)}`;
      const tw = ctx.measureText(label).width;
      const x = side > 0.55 ? Math.min(W - tw - 12, side * W - tw - 70) : side < 0.45 ? Math.max(12, side * W + 70) : W / 2 - tw / 2;
      const ly = L.name === 'the edge of space' ? y - 12 : y;
      ctx.fillStyle = 'rgba(20,11,46,.7)'; ctx.fillRect(Math.round(x - 6), Math.round(ly - 10), Math.round(tw + 12), 20);
      ctx.fillStyle = alt >= L.pts ? '#ffd84a' : 'rgba(255,243,220,.85)'; ctx.fillText(label, Math.round(x), Math.round(ly + 1));
    }
    }
    raf = requestAnimationFrame(frame);
  }
  let raf = 0;
  addEventListener('resize', resize); resize();
  document.addEventListener('visibilitychange', () => { cancelAnimationFrame(raf); if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } });
  raf = requestAnimationFrame(frame);

  return {
    // where the rocket sits on screen: home = on the pad, flight = higher up so landmarks above are visible
    layout(mode) {
      const wide = innerWidth >= 900;
      labels = mode !== 'home';
      anchorT = mode === 'home' ? 0.9 : wide ? 0.72 : 0.8;
      rxT = mode === 'home' && wide ? 0.74 : mode === 'results' && wide ? 0.78 : 0.5;
    },
    fly(points, instant) { target = Math.max(0, points); if (instant) { alt = target; passed = LANDMARKS.findLastIndex(l => l.pts <= alt); } },
    reset() { target = alt = 0; passed = 0; },
    set onPass(fn) { onPass = fn; },
    get altitude() { return alt; },
    distance: pts => fmtDistance(distanceKm(pts)),
  };
}
