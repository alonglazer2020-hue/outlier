import { GENRES, PROMPTS, TIERS, judge, rarer, dailyPrompts, todayKey, dayNumber, msToNextDay, pickPrompts, genreOf, promptById, sigma, DAILY_COUNT, DAILY_SECONDS } from './engine.js';

// ---------- utilities ----------
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('outlier:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('outlier:' + k, JSON.stringify(v)); } catch {} },
};
const clientId = store.get('id') || (() => {
  const id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9-]/gi, '');
  store.set('id', id); return id;
})();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const title = s => s.replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const ICON = {
  back: '<svg class="icon" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  close: '<svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  arrow: '<svg class="icon" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  share: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5"/></svg>',
  people: '<svg class="icon" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 010 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/></svg>',
  bolt: '<svg class="icon" viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  plus: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  chev: '<svg class="icon" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  copy: '<svg class="icon" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>',
};
const squares = tiers => `<span class="sq" aria-label="${tiers.map(t => (t < 0 ? 'miss' : TIERS[t].name)).join(', ')}">${tiers.map(t => `<i class="${t < 0 ? 'x' : 't' + t}"></i>`).join('')}</span>`;
const SHARE_SQ = ['⬜', '🟦', '🟩', '🟨', '🟧', '🟥'];
function banner(msg, ms = 2600) {
  const b = $('#banner'); b.textContent = msg; b.hidden = !msg;
  clearTimeout(banner.t); if (msg && ms) banner.t = setTimeout(() => (b.hidden = true), ms);
}
async function share(text, url) {
  try { if (navigator.share) { await navigator.share({ text, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url ? `${text}\n${url}` : text); banner('Copied to clipboard'); } catch { banner('Could not copy. Long-press to select instead.'); }
}
const fmtTime = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return [s / 3600, (s % 3600) / 60, s % 60].map(n => String(Math.floor(n)).padStart(2, '0')).join(':'); };
let name = store.get('name', '');
const saveName = v => { name = v.replace(/[<>]/g, '').trim().slice(0, 16); store.set('name', name); };

// ---------- theme ----------
function setGenre(id) {
  const color = id === 'mixed' ? GENRES[0].color : genreOf(id).color;
  document.body.style.setProperty('--field', color);
  document.documentElement.style.setProperty('--field', color);
  $('meta[name=theme-color]').content = color;
}

// ---------- the field: crowd + your dots ----------
const field = (() => {
  const cv = $('#field'), ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1, center = [0.5, 0.62], scale = 1;
  const crowd = Array.from({ length: 240 }, () => {
    const r = Math.abs(gauss()) * 0.45, a = Math.random() * Math.PI * 2;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, s: 1 + Math.random() * 1.8 };
  });
  let dots = [], rings = 0, raf = 0;
  function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scale = Math.min(W, H * 1.1);
  }
  const radiusFor = t => scale * (0.13 + t * 0.068);
  function frame(now) {
    ctx.clearRect(0, 0, W, H);
    const cx = W * center[0], cy = H * center[1], base = scale * 0.11;
    ctx.strokeStyle = 'rgba(255,247,232,.13)'; ctx.lineWidth = 1;
    for (let t = 0; t < rings; t++) { ctx.beginPath(); ctx.arc(cx, cy, radiusFor(t), 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,247,232,.34)';
    for (const p of crowd) {
      if (!reduced) { p.vx += (Math.random() - .5) * 0.0009 - p.x * 0.0004; p.vy += (Math.random() - .5) * 0.0009 - p.y * 0.0004; p.vx *= .96; p.vy *= .96; p.x += p.vx; p.y += p.vy; }
      ctx.beginPath(); ctx.arc(cx + p.x * base * 2, cy + p.y * base * 2, p.s, 0, Math.PI * 2); ctx.fill();
    }
    for (const d of dots) {
      const k = reduced ? 1 : Math.min(1, (now - d.born) / 1100), e = 1 - Math.pow(1 - k, 4);
      const r = d.tier < 0 ? scale * 0.02 : radiusFor(d.tier) * e;
      const x = cx + Math.cos(d.a) * r, y = cy + Math.sin(d.a) * r;
      if (d.tier >= 0) {
        ctx.strokeStyle = d.latest ? 'rgba(255,216,74,.55)' : 'rgba(255,216,74,.22)'; ctx.lineWidth = d.latest ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(d.a) * base * .5, cy + Math.sin(d.a) * base * .5); ctx.lineTo(x, y); ctx.stroke();
      }
      ctx.fillStyle = d.tier < 0 ? 'rgba(255,247,232,.5)' : '#ffd84a';
      ctx.beginPath(); ctx.arc(x, y, d.latest ? 8 : 5, 0, Math.PI * 2); ctx.fill();
      if (d.latest && d.tier >= 0) { ctx.strokeStyle = 'rgba(255,216,74,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 14 + (reduced ? 0 : Math.sin(now / 300) * 2), 0, Math.PI * 2); ctx.stroke(); }
    }
    raf = requestAnimationFrame(frame);
  }
  addEventListener('resize', resize); resize();
  document.addEventListener('visibilitychange', () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); });
  raf = requestAnimationFrame(frame);
  return {
    focus(x, y, showRings) { center = [x, y]; rings = showRings ? TIERS.length : 0; },
    clear() { dots = []; },
    add(tier) { dots.forEach(d => (d.latest = false)); // sideways, slightly upward: lands in the open space beside the crowd, not under the prompt text
      const side = Math.random() < 0.5 ? 0 : Math.PI;
      dots.push({ tier, a: side + (side ? 1 : -1) * Math.random() * 0.45, born: performance.now(), latest: true }); },
  };
})();
const placeField = (mode) => {
  const wide = innerWidth >= 900;
  if (mode === 'home') field.focus(wide ? 0.8 : 1.02, wide ? 0.42 : 0.3, false); // phones: crowd tucked half off the right edge
  else if (mode === 'results' && wide) field.focus(0.86, 0.55, true);
  else field.focus(0.5, wide ? 0.78 : 0.8, true);
};

// ---------- home ----------
function home() {
  stopTimer();
  setGenre('general'); field.clear(); placeField('home');
  const k = todayKey(), done = store.get('daily:' + k), streak = store.get('streak', { n: 0, last: '' });
  const live = streak.last === k || streak.last === prevDay(k) ? streak.n : 0;
  const prog = store.get('dailyprog:' + k);
  app.innerHTML = `
  <header class="top">
    <div class="mark" aria-label="Outlier">outlier<i></i></div>
    <div class="who"><label for="nm" class="visually-hidden">Your name</label><input id="nm" class="field-input" placeholder="Your name" maxlength="16" autocomplete="nickname" value="${esc(name)}"></div>
  </header>
  <div class="home">
    <section class="daily" aria-labelledby="dh">
      <div class="meta"><span>Daily <b class="num">#${dayNumber(k)}</b></span><span>${new Date(k + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>${live ? `<span>Streak <b class="num">${live}</b></span>` : ''}</div>
      <h1 id="dh">Name something nobody else would.</h1>
      <p class="lede">Seven prompts, the same for everyone today. Every right answer counts, but the rarer it is, the farther you drift from the crowd.</p>
      ${done ? `
        <div class="done-score num">${sigma(done.score)}σ<small>from the crowd today</small></div>
        <div>${squares(done.picks.map(p => (p.ok ? p.tier : -1)))}</div>
        <div class="actions"><button class="btn btn-primary btn-big" id="see">See results ${ICON.arrow}</button><span class="muted">Next daily in <b class="num" id="cd">${fmtTime(msToNextDay())}</b></span></div>`
      : `<div class="actions"><button class="btn btn-primary btn-big" id="play">${prog ? 'Continue today' : 'Play today'} ${ICON.arrow}</button><span class="muted">${DAILY_COUNT} prompts · ${DAILY_SECONDS} seconds each</span></div>`}
      <details class="how">
        <summary>${ICON.chev} How scoring works</summary>
        <ol>
          <li>Type any answer that fits the prompt. If it isn't on our list, try another before the clock runs out.</li>
          <li>Answers are graded by how many people would say them. Rarer means more points; speed earns nothing.</li>
          <li>100 points is 1σ (one sigma) from the crowd. A perfect daily is 7σ.</li>
          <li>In multiplayer, if two players give the same answer, both get half.</li>
        </ol>
        <div class="tierkey">${TIERS.map((t, i) => `<span>${squares([i])} ${t.name} <span class="muted num">${t.pts}</span></span>`).join('')}</div>
      </details>
    </section>
    <section class="block" aria-labelledby="uh">
      <h2 id="uh">Unlimited</h2>
      <p>Pick a world and play as many rounds as you like.</p>
      <div class="genres">
        <button class="genre" data-g="mixed"><span class="swatch" style="background:conic-gradient(${GENRES.map(g => g.color).join(',')})"></span><span>Everything<small>${PROMPTS.length} prompts</small></span></button>
        ${GENRES.map(g => `<button class="genre" data-g="${g.id}"><span class="swatch" style="background:${g.color}"></span><span>${esc(g.name)}<small>${PROMPTS.filter(p => p.genre === g.id).length} prompts</small></span></button>`).join('')}
      </div>
    </section>
    <section class="block" aria-labelledby="mh">
      <h2 id="mh">Play together</h2>
      <p>Everyone gets the same prompt at the same moment. Up to 16 players, free.</p>
      <div class="mp-row">
        <button class="btn btn-primary" id="create">${ICON.plus} Create a room</button>
        <button class="btn" id="quick">${ICON.bolt} Quick match</button>
      </div>
      <form class="join" id="joinf"><label for="code" class="visually-hidden">Room code</label><input id="code" class="field-input" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="6-digit code" value="${esc(new URLSearchParams(location.search).get('room') || '')}"><button class="btn">Join</button></form>
      <p class="error" id="mperr" role="alert"></p>
    </section>
  </div>
  <p class="foot">Outlier · answer lists are hand-made, so a few real answers may be missing.</p>`;
  $('#nm').addEventListener('input', e => saveName(e.target.value));
  $('#play')?.addEventListener('click', startDaily);
  $('#see')?.addEventListener('click', () => results({ mode: 'daily', date: k, ...done }));
  app.querySelectorAll('.genre').forEach(b => b.addEventListener('click', () => startUnlimited(b.dataset.g)));
  const needName = () => { if (!name) { saveName('Player ' + Math.floor(100 + Math.random() * 900)); $('#nm').value = name; } };
  $('#create').addEventListener('click', () => { needName(); mpStart({ t: 'create', name, settings: { genre: 'mixed', rounds: 7, seconds: 30 } }); });
  $('#quick').addEventListener('click', () => { needName(); mpStart({ t: 'quick', name }); });
  $('#joinf').addEventListener('submit', e => {
    e.preventDefault(); const code = $('#code').value.replace(/\D/g, '');
    if (code.length !== 6) { $('#mperr').textContent = 'Room codes are 6 digits.'; return; }
    needName(); mpStart({ t: 'join', code, name });
  });
  if (done) tick(() => { const el = $('#cd'); if (!el) return false; el.textContent = fmtTime(msToNextDay()); if (msToNextDay() < 1000) setTimeout(home, 1500); });
}
const prevDay = k => new Date(Date.parse(k) - 864e5).toISOString().slice(0, 10);
let tickT = 0;
function tick(fn) { clearInterval(tickT); tickT = setInterval(() => { if (fn() === false) clearInterval(tickT); }, 1000); }

// ---------- single player ----------
let S = null; // current single-player session
let timer = { raf: 0, end: 0 };
function stopTimer() { cancelAnimationFrame(timer.raf); timer.end = 0; clearInterval(tickT); }
function runTimer(endAt, onEnd) {
  stopTimer(); timer.end = endAt;
  const bar = $('.clock i'), secs = $('.secs'), clock = $('.clock'), total = endAt - Date.now();
  const step = () => {
    const left = timer.end - Date.now();
    if (bar) bar.style.transform = `scaleX(${Math.max(0, left / total)})`;
    if (secs) secs.textContent = Math.max(0, Math.ceil(left / 1000));
    clock?.classList.toggle('low', left < 5000);
    if (left <= 0) { stopTimer(); onEnd(); return; }
    timer.raf = requestAnimationFrame(step);
  };
  step();
}

function startDaily() {
  const k = todayKey();
  if (store.get('daily:' + k)) return home();
  const prog = store.get('dailyprog:' + k, { picks: [] });
  S = { mode: 'daily', date: k, prompts: dailyPrompts(k), picks: prog.picks, seconds: DAILY_SECONDS };
  field.clear(); S.picks.forEach(p => field.add(p.ok ? p.tier : -1));
  showPrompt();
}
function startUnlimited(genre) {
  const recent = store.get('recent', []);
  S = { mode: 'unlimited', genre, prompts: pickPrompts(genre, 7, recent), picks: [], seconds: 30 };
  store.set('recent', [...S.prompts.map(p => p.id), ...recent].slice(0, Math.max(14, Math.floor(PROMPTS.length * 0.6))));
  field.clear(); showPrompt();
}
const totalOf = picks => picks.reduce((s, p) => s + (p.ok ? p.points : 0), 0);

function showPrompt() {
  const i = S.picks.length, p = S.prompts[i], g = genreOf(p.genre);
  setGenre(p.genre); placeField('play');
  const where = S.mode === 'daily' ? `Daily <b class="num">#${dayNumber(S.date)}</b>` : `<b>${esc(S.genre === 'mixed' ? 'Everything' : genreOf(S.genre).name)}</b>`;
  app.innerHTML = `
  <div class="play">
    <div class="bar"><button class="btn iconbtn" id="quit" aria-label="Back to home">${ICON.close}</button><span class="where">${where} · <span class="num">${i + 1}/${S.prompts.length}</span></span><span class="total num" aria-label="Score">${sigma(totalOf(S.picks))}σ</span><span class="secs" aria-hidden="true">${S.seconds}</span></div>
    <div class="clock" aria-hidden="true"><i></i></div>
    <span class="genre-tag"><span class="swatch" style="background:${g.color}"></span>${esc(g.name)}</span>
    <h1 class="prompt">${esc(p.text)}</h1>
    <div id="stage">
      <form class="answer" id="af" autocomplete="off"><label for="ans" class="visually-hidden">Your answer</label><input id="ans" class="field-input" enterkeyhint="send" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="60" placeholder="Your answer"><button class="btn btn-primary" aria-label="Submit answer">${ICON.arrow}</button></form>
      <p class="feedback" id="fb" aria-live="polite"></p>
    </div>
  </div>`;
  $('#quit').addEventListener('click', () => { if (S.mode === 'daily' || confirm('Leave this round?')) home(); });
  const input = $('#ans');
  input.focus({ preventScroll: true });
  $('#af').addEventListener('submit', e => {
    e.preventDefault();
    const res = judge(p, input.value);
    if (!res.ok) {
      const fb = $('#fb'); fb.className = 'feedback bad';
      fb.textContent = res.reason === 'empty' ? 'Type an answer first.' : `“${input.value.trim().slice(0, 40)}” isn't on our list. Try another.`;
      $('#af').classList.remove('shake'); void $('#af').offsetWidth; $('#af').classList.add('shake');
      input.select(); return;
    }
    lockIn(p, { ...res, input: input.value.trim(), promptId: p.id });
  });
  runTimer(Date.now() + S.seconds * 1000, () => lockIn(p, { ok: false, promptId: p.id }));
}

function lockIn(p, pick) {
  stopTimer();
  S.picks.push(pick);
  if (S.mode === 'daily') store.set('dailyprog:' + S.date, { picks: S.picks });
  field.add(pick.ok ? pick.tier : -1);
  try { if (pick.ok && pick.tier >= 3) navigator.vibrate?.(40); } catch {}
  $('.total').textContent = sigma(totalOf(S.picks)) + 'σ';
  const last = S.picks.length === S.prompts.length;
  const more = rarer(p, pick.ok ? pick.tier : -1, 3);
  $('#stage').innerHTML = `
    <div class="reveal" aria-live="polite">
      ${pick.ok
        ? `<div class="tier ${pick.tier >= 3 ? 'hot' : ''}">${TIERS[pick.tier].name}</div><p class="said">You said <b>${esc(title(pick.answer))}</b> <span class="pts num">+${pick.points}</span></p>`
        : `<div class="tier">Time's up</div><p class="said">No answer this time. <span class="pts num">+0</span></p>`}
      ${more.length ? `<p class="others">${pick.ok && pick.tier === 5 ? '' : 'Rarer answers out there: '}${more.map(m => `<b>${esc(title(m))}</b>`).join(', ')}</p>` : `<p class="others">Nothing on our list is rarer than that.</p>`}
      <div class="actions"><button class="btn btn-primary btn-big" id="next">${last ? 'See results' : 'Next prompt'} ${ICON.arrow}</button></div>
    </div>`;
  if (pick.ok && pick.tier === 5) $('.others').textContent = 'Nothing on our list is rarer than that.';
  const next = $('#next'); next.focus({ preventScroll: true });
  next.addEventListener('click', () => (last ? finish() : showPrompt()));
}

function finish() {
  const score = totalOf(S.picks);
  const best = store.get('best', 0); if (score > best) store.set('best', score);
  if (S.mode === 'daily') {
    const rec = { picks: S.picks, score, submitted: false };
    store.set('daily:' + S.date, rec);
    const st = store.get('streak', { n: 0, last: '' });
    store.set('streak', { n: st.last === prevDay(S.date) ? st.n + 1 : st.last === S.date ? st.n : 1, last: S.date });
    return results({ mode: 'daily', date: S.date, ...rec });
  }
  results({ mode: 'unlimited', genre: S.genre, picks: S.picks, score });
}

// ---------- results ----------
function results(r) {
  stopTimer();
  setGenre(r.mode === 'daily' ? 'general' : r.genre); placeField('results');
  field.clear(); r.picks.forEach(p => field.add(p.ok ? p.tier : -1));
  const tiers = r.picks.map(p => (p.ok ? p.tier : -1));
  const label = r.mode === 'daily' ? `Outlier daily #${dayNumber(r.date)}` : `Outlier · ${r.genre === 'mixed' ? 'Everything' : genreOf(r.genre).name}`;
  app.innerHTML = `
  <div class="results">
    <div class="bar"><button class="btn iconbtn" id="back" aria-label="Back to home">${ICON.back}</button><span class="where">${esc(label)}</span></div>
    <div class="big num">${sigma(r.score)}σ<small>from the crowd · ${r.score} points · ${squares(tiers)}</small></div>
    <div class="actions-row">
      <button class="btn btn-primary" id="share">${ICON.share} Share</button>
      ${r.mode === 'unlimited' ? `<button class="btn" id="again">Play again ${ICON.arrow}</button>` : ''}
      <button class="btn btn-ghost" id="home">Home</button>
    </div>
    <section class="rows" aria-label="Your answers">
      ${r.picks.map(pk => { const p = promptById(pk.promptId); return `<div class="row"><span class="q">${esc(p.text)}</span><span class="p num">${pk.ok ? '+' + pk.points : '0'}<small>${pk.ok ? TIERS[pk.tier].name : 'Missed'}</small></span><span class="a ${pk.ok ? '' : 'miss'}">${pk.ok ? esc(title(pk.answer)) : 'No answer'}</span></div>`; }).join('')}
    </section>
    ${r.mode === 'daily' ? `<section class="block" id="world"><h2>Today's board</h2><p class="muted" id="wmsg">Sending your dive…</p></section>` : ''}
  </div>`;
  $('#back').addEventListener('click', home); $('#home').addEventListener('click', home);
  $('#again')?.addEventListener('click', () => startUnlimited(r.genre));
  $('#share').addEventListener('click', () => share(`${label} — ${sigma(r.score)}σ from the crowd\n${tiers.map(t => (t < 0 ? '⬛' : SHARE_SQ[t])).join('')}`, location.origin));
  if (r.mode === 'daily') loadBoard(r);
}

async function loadBoard(r, attempt = 0) {
  const msg = $('#wmsg'); if (!msg) return;
  try {
    let data;
    if (!r.submitted) {
      const res = await fetch('/api/daily', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: r.date, clientId, name: name || 'Anonymous', answers: r.picks.map(p => (p.ok ? p.answer : '')) }) });
      data = await res.json();
      if (!res.ok) { msg.textContent = data.error || 'The board could not take your dive.'; return; }
      r.submitted = true; store.set('daily:' + r.date, { picks: r.picks, score: r.score, submitted: true });
    } else {
      const res = await fetch(`/api/daily/stats?clientId=${encodeURIComponent(clientId)}`);
      data = await res.json();
      if (!res.ok) { msg.textContent = r.date === todayKey() ? data.error : 'That daily has ended.'; return; }
    }
    renderBoard(r, data);
  } catch {
    if (attempt < 12) { msg.textContent = 'Waking the server, this can take up to a minute…'; setTimeout(() => loadBoard(r, attempt + 1), 5000); }
    else msg.textContent = 'Could not reach the server. Your score is saved on this device.';
  }
}
function renderBoard(r, d) {
  const prompts = dailyPrompts(r.date), w = $('#world'); if (!w) return;
  w.innerHTML = `
    <h2>Today's board</h2>
    <p class="muted">You're <b class="num">#${d.rank}</b> of <b class="num">${d.players}</b> ${d.players === 1 ? 'player' : 'players'} today.</p>
    <ol class="board">${d.top.map((e, i) => `<li class="${e.you ? 'me' : ''}"><span class="r num">${i + 1}</span><span class="n">${esc(e.name)}</span>${squares(e.tiers)}<span class="s num">${sigma(e.score)}σ</span></li>`).join('')}</ol>
    <h2 style="margin-top:20px">What everyone said</h2>
    ${d.stats.map((s, i) => `<div class="stat"><span class="q">${esc(prompts[i].text)}</span><div class="bars">
      ${s.top.map(a => `<div class="${s.yours?.answer === a.answer ? 'me' : ''}"><span>${esc(title(a.answer))}</span><em style="width:${Math.max(2, (a.count / s.total) * 100)}%"></em><span>${Math.round((a.count / s.total) * 100)}%</span></div>`).join('')}
      ${s.yours && !s.top.some(a => a.answer === s.yours.answer) ? `<div class="me"><span>${esc(title(s.yours.answer))}</span><em style="width:${Math.max(2, (s.yours.count / s.total) * 100)}%"></em><span>${Math.round((s.yours.count / s.total) * 100)}%</span></div>` : ''}
    </div></div>`).join('')}`;
}

// ---------- multiplayer ----------
const M = { ws: null, snap: null, key: '', seat: JSON.parse(sessionStorage.getItem('outlier:seat') || 'null'), first: null, retries: 0, offset: 0, wanted: false };
function mpStart(firstMsg) { M.first = firstMsg; M.wanted = true; M.retries = 0; banner('Connecting…', 0); mpConnect(); }
function mpConnect() {
  try { M.ws?.close(); } catch {}
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  M.ws = ws;
  const slow = setTimeout(() => banner('Waking the server, this can take up to a minute…', 0), 3000);
  ws.onopen = () => {
    clearTimeout(slow); banner(''); M.retries = 0;
    ws.send(JSON.stringify(M.seat ? { t: 'rejoin', ...M.seat } : M.first));
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'joined') { M.seat = { code: m.code, token: m.token }; sessionStorage.setItem('outlier:seat', JSON.stringify(M.seat)); history.replaceState(null, '', '/?room=' + m.code); }
    else if (m.t === 'gone') { M.seat = null; sessionStorage.removeItem('outlier:seat'); if (M.first && M.first.t !== 'rejoin') ws.send(JSON.stringify(M.first)); else { mpQuit('That room has closed.'); } }
    else if (m.t === 'error') { mpQuit(); const el = $('#mperr'); if (el) el.textContent = m.msg; }
    else if (m.t === 'rejected') { const fb = $('#fb'); if (fb) { fb.className = 'feedback bad'; fb.textContent = m.reason === 'empty' ? 'Type an answer first.' : `“${m.text.trim().slice(0, 40)}” isn't on our list. Try another.`; const f = $('#af'); f?.classList.remove('shake'); void f?.offsetWidth; f?.classList.add('shake'); $('#ans')?.select(); } }
    else if (m.t === 'room') { M.offset = m.now - Date.now(); M.snap = m; renderMp(); }
  };
  ws.onclose = ev => {
    clearTimeout(slow);
    if (!M.wanted || M.ws !== ws) return;
    if (ev.code === 4000) { M.wanted = false; banner('This room is open in another tab.', 0); return; }
    if (M.retries++ > 20) { mpQuit('Lost connection to the room.'); return; }
    banner('Reconnecting…', 0);
    setTimeout(() => M.wanted && mpConnect(), Math.min(8000, 600 * M.retries));
  };
}
function mpSend(m) { if (M.ws?.readyState === 1) M.ws.send(JSON.stringify(m)); }
function mpQuit(msg) {
  M.wanted = false; mpSend({ t: 'leave' }); try { M.ws?.close(); } catch {}
  M.ws = null; M.seat = null; M.snap = null; M.key = ''; sessionStorage.removeItem('outlier:seat');
  history.replaceState(null, '', '/'); banner(msg || ''); home();
}
const serverNow = () => Date.now() + M.offset;
const me = s => s.players.find(p => p.id === s.you);
const inviteUrl = s => `${location.origin}/?room=${s.code}`;

function renderMp() {
  const s = M.snap; if (!s) return;
  const key = s.phase + ':' + s.round;
  const fresh = key !== M.key; M.key = key;
  if (s.phase === 'lobby') return lobby(s, fresh);
  if (s.phase === 'prompt') return mpPrompt(s, fresh);
  if (s.phase === 'reveal') return mpReveal(s, fresh);
  if (s.phase === 'final') return mpFinal(s, fresh);
}
function peopleList(s) {
  return s.players.map(p => `<li class="${p.online ? '' : 'off'}"><span>${esc(p.name)}${p.id === s.you ? ' <span class="tag">(you)</span>' : ''}</span><span class="tag">${p.id === s.hostId ? 'Host' : p.online ? '' : 'Away'}</span></li>`).join('');
}
function lobby(s, fresh) {
  stopTimer(); setGenre(s.settings.genre === 'mixed' ? 'general' : s.settings.genre); placeField('home'); field.clear();
  const host = s.hostId === s.you;
  const auto = s.autoStartAt ? Math.max(0, Math.ceil((s.autoStartAt - serverNow()) / 1000)) : 0;
  if (!fresh && $('.lobby')) {
    $('#people').innerHTML = peopleList(s);
    $('#lstatus').textContent = lobbyStatus(s, host, auto);
    if (host) for (const k of ['genre', 'rounds', 'seconds']) { const el = $('#s-' + k); if (el && document.activeElement !== el) el.value = s.settings[k]; }
    else $('#sumset').textContent = setSummary(s);
    $('#start') && ($('#start').disabled = !s.players.some(p => p.online));
    return;
  }
  app.innerHTML = `
  <div class="bar" style="margin-bottom:28px"><button class="btn iconbtn" id="leave" aria-label="Leave room">${ICON.close}</button><span class="where">${s.public ? 'Quick match' : 'Private room'}</span></div>
  <div class="lobby">
    <section class="code-wrap">
      <span class="muted">Room code</span>
      <div class="code num" aria-label="Room code ${s.code.split('').join(' ')}">${s.code}</div>
      <div class="actions-row"><button class="btn btn-primary" id="invite">${ICON.share} Invite friends</button><button class="btn" id="copy">${ICON.copy} Copy link</button></div>
      <p class="muted" id="lstatus" aria-live="polite">${lobbyStatus(s, host, auto)}</p>
      ${host ? `<button class="btn btn-primary btn-big" id="start">Start game ${ICON.arrow}</button>` : ''}
    </section>
    <section class="block">
      <h2>${ICON.people} Players</h2>
      <ul class="people" id="people">${peopleList(s)}</ul>
      <h2 style="margin-top:12px">Game</h2>
      ${host ? `<div class="settings">
        <div class="wide"><label class="lbl" for="s-genre">Genre</label><select id="s-genre" class="field-input"><option value="mixed">Everything</option>${GENRES.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></div>
        <div><label class="lbl" for="s-rounds">Prompts</label><select id="s-rounds" class="field-input">${[3, 5, 7, 10, 15].map(n => `<option>${n}</option>`).join('')}</select></div>
        <div><label class="lbl" for="s-seconds">Seconds each</label><select id="s-seconds" class="field-input">${[15, 20, 30, 45, 60].map(n => `<option>${n}</option>`).join('')}</select></div>
      </div>` : `<p class="muted" id="sumset">${setSummary(s)}</p>`}
    </section>
  </div>`;
  $('#leave').addEventListener('click', () => mpQuit());
  $('#invite').addEventListener('click', () => share(`Join my Outlier room: ${s.code}`, inviteUrl(s)));
  $('#copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl(s)); banner('Invite link copied'); } catch { banner(inviteUrl(s), 6000); } });
  if (host) {
    for (const k of ['genre', 'rounds', 'seconds']) { const el = $('#s-' + k); el.value = s.settings[k]; el.addEventListener('change', () => mpSend({ t: 'settings', settings: { [k]: el.value } })); }
    $('#start').addEventListener('click', () => mpSend({ t: 'start' }));
  }
  if (s.autoStartAt) tick(() => { if (!$('.lobby') || !M.snap || M.snap.phase !== 'lobby') return false; const a = Math.max(0, Math.ceil((M.snap.autoStartAt - serverNow()) / 1000)); $('#lstatus').textContent = lobbyStatus(M.snap, M.snap.hostId === M.snap.you, a); });
}
const setSummary = s => `${s.settings.genre === 'mixed' ? 'Everything' : genreOf(s.settings.genre).name} · ${s.settings.rounds} prompts · ${s.settings.seconds} seconds each`;
function lobbyStatus(s, host, auto) {
  const n = s.players.filter(p => p.online).length;
  if (s.autoStartAt) return `Starting in ${auto}s… ${n} players in.`;
  if (s.public) return n < 2 ? 'Waiting for another player to join…' : `${n} players in.`;
  return host ? (n < 2 ? 'Share the code, or start solo to try it out.' : `${n} players in. Start when everyone's here.`) : 'Waiting for the host to start…';
}
function strip(s) {
  return s.players.filter(p => p.online || p.answered).map(p => `<span class="chip ${p.answered ? 'ok' : ''} ${p.online ? '' : 'off'}"><span class="dot"></span>${esc(p.name)}</span>`).join('');
}
function mpPrompt(s, fresh) {
  const p = promptById(s.prompt.id), g = genreOf(p.genre), mine = me(s);
  if (!fresh && $('#mpplay')) {
    $('#strip').innerHTML = strip(s);
    if (mine.answer && !$('.reveal')) lockedView(mine.answer, s);
    return;
  }
  setGenre(p.genre); placeField('play');
  if (s.round === 0) { field.clear(); }
  app.innerHTML = `
  <div class="play" id="mpplay">
    <div class="bar"><button class="btn iconbtn" id="leave" aria-label="Leave room">${ICON.close}</button><span class="where">Room <b class="num">${s.code}</b> · <span class="num">${s.round + 1}/${s.rounds}</span></span><span class="total num">${sigma(mine.score)}σ</span><span class="secs" aria-hidden="true"></span></div>
    <div class="clock" aria-hidden="true"><i></i></div>
    <span class="genre-tag"><span class="swatch" style="background:${g.color}"></span>${esc(g.name)}</span>
    <h1 class="prompt">${esc(p.text)}</h1>
    <div id="stage">
      <form class="answer" id="af" autocomplete="off"><label for="ans" class="visually-hidden">Your answer</label><input id="ans" class="field-input" enterkeyhint="send" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="60" placeholder="Your answer"><button class="btn btn-primary" aria-label="Submit answer">${ICON.arrow}</button></form>
      <p class="feedback" id="fb" aria-live="polite"></p>
    </div>
    <div class="strip" id="strip" aria-label="Who has answered">${strip(s)}</div>
  </div>`;
  $('#leave').addEventListener('click', () => { if (confirm('Leave this game?')) mpQuit(); });
  $('#af').addEventListener('submit', e => { e.preventDefault(); const v = $('#ans').value; if (!v.trim()) { $('#fb').className = 'feedback bad'; $('#fb').textContent = 'Type an answer first.'; return; } mpSend({ t: 'answer', text: v }); });
  if (mine.answer) lockedView(mine.answer, s); else $('#ans').focus({ preventScroll: true });
  runTimer(s.endsAt - M.offset, () => { const fb = $('#fb'); if (fb && !me(M.snap).answer) { fb.className = 'feedback'; fb.textContent = "Time's up."; } });
}
function lockedView(a, s) {
  $('#stage').innerHTML = `<div class="reveal"><div class="tier ${a.tier >= 3 ? 'hot' : ''}">${TIERS[a.tier].name}</div><p class="said">Locked in <b>${esc(title(a.answer))}</b> <span class="pts num">+${a.points}</span></p><p class="others">Waiting for the others. Same answer as someone else? You both get half.</p></div>`;
}
function mpReveal(s, fresh) {
  const mine = me(s);
  if (fresh) field.add(mine.answer ? mine.answer.tier : -1);
  const p = promptById(s.prompt.id);
  const ranked = [...s.players].filter(x => x.online || x.answer).sort((a, b) => (b.answer?.gained ?? -1) - (a.answer?.gained ?? -1));
  const host = s.hostId === s.you;
  app.innerHTML = `
  <div class="play">
    <div class="bar"><button class="btn iconbtn" id="leave" aria-label="Leave room">${ICON.close}</button><span class="where">Room <b class="num">${s.code}</b> · <span class="num">${s.round + 1}/${s.rounds}</span></span><span class="total num">${sigma(mine.score)}σ</span><span class="secs" aria-hidden="true"></span></div>
    <div class="clock" aria-hidden="true"><i></i></div>
    <h1 class="prompt" style="font-size:clamp(1.4rem,4vw,2rem)">${esc(p.text)}</h1>
    <ul class="answers">${ranked.map(x => `<li class="${x.id === s.you ? 'me' : ''} ${x.answer?.shared ? 'shared' : ''}"><span class="n">${esc(x.name)}</span><span class="p num">${x.answer ? '+' + x.answer.gained : '0'}<small>${x.answer ? (x.answer.shared ? 'Shared · half' : TIERS[x.answer.tier].name) : 'No answer'}</small></span><span class="a">${x.answer ? esc(title(x.answer.answer)) : '—'}</span></li>`).join('')}</ul>
    <p class="others muted">Rarest on our list: ${rarer(p, 4, 3).map(m => `<b>${esc(title(m))}</b>`).join(', ')}</p>
    ${host ? `<div class="actions-row"><button class="btn btn-primary btn-big" id="next">${s.round + 1 >= s.rounds ? 'Final scores' : 'Next prompt'} ${ICON.arrow}</button></div>` : `<p class="muted">Next prompt in a few seconds…</p>`}
  </div>`;
  $('#leave').addEventListener('click', () => { if (confirm('Leave this game?')) mpQuit(); });
  $('#next')?.addEventListener('click', () => mpSend({ t: 'next' }));
  $('#next')?.focus({ preventScroll: true });
  runTimer(s.endsAt - M.offset, () => {});
}
function mpFinal(s, fresh) {
  stopTimer(); setGenre('general'); placeField('results');
  const ranked = [...s.players].sort((a, b) => b.score - a.score);
  const host = s.hostId === s.you, mine = me(s), place = ranked.findIndex(p => p.id === s.you) + 1;
  app.innerHTML = `
  <div class="results">
    <div class="bar"><button class="btn iconbtn" id="leave" aria-label="Leave room">${ICON.close}</button><span class="where">Room <b class="num">${s.code}</b> · final</span></div>
    <div class="big num">${place === 1 ? 'You win' : '#' + place}<small>${sigma(mine.score)}σ from the crowd · ${mine.score} points</small></div>
    <ol class="board podium">${ranked.map((p, i) => `<li class="${p.id === s.you ? 'me' : ''}"><span class="r num">${i + 1}</span><span class="n">${esc(p.name)}</span>${squares((p.history || []).map(t => (t == null ? -1 : t)))}<span class="s num">${sigma(p.score)}σ</span></li>`).join('')}</ol>
    <div class="actions-row">
      ${host ? `<button class="btn btn-primary btn-big" id="again">Play again ${ICON.arrow}</button>` : '<p class="muted">Waiting for the host to start another game…</p>'}
      <button class="btn btn-ghost" id="out">Leave room</button>
    </div>
  </div>`;
  $('#leave').addEventListener('click', () => mpQuit());
  $('#out').addEventListener('click', () => mpQuit());
  $('#again')?.addEventListener('click', () => mpSend({ t: 'again' }));
}

// ---------- boot ----------
fetch('/health').catch(() => {}); // start waking a sleeping server early
if (M.seat) { M.wanted = true; mpConnect(); banner('Rejoining your room…', 0); app.innerHTML = '<p class="boot">Rejoining…</p>'; }
else home();
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom && !M.seat && name) mpStart({ t: 'join', code: urlRoom, name });
