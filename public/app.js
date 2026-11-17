import { GENRES, PROMPTS, TIERS, judge, rarer, dailyPrompts, todayKey, missionNumber, dateOfMission, msToNextDay, pickPrompts, genreOf, promptById, reached, distanceKm, fmtDistance, DAILY_COUNT, DAILY_SECONDS } from './engine.js';
import { createScene } from './scene.js';
import { sfx } from './sound.js';

// ---------- utilities ----------
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('oddity:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('oddity:' + k, JSON.stringify(v)); } catch {} },
};
const clientId = store.get('id') || (() => {
  const id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^a-z0-9-]/gi, '');
  store.set('id', id); return id;
})();
const cap = s => s.replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const total = picks => picks.reduce((s, p) => s + (p.ok ? p.points : 0), 0);
const dist = pts => fmtDistance(distanceKm(pts));
const fmtDate = k => new Date(k + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return [s / 3600, (s % 3600) / 60, s % 60].map(n => String(Math.floor(n)).padStart(2, '0')).join(':'); };
const prevDay = k => new Date(Date.parse(k) - 864e5).toISOString().slice(0, 10);
let name = store.get('name', '');
const saveName = v => { name = v.replace(/[<>]/g, '').trim().slice(0, 16); store.set('name', name); };
const ensureName = () => { if (!name) saveName('Pilot ' + Math.floor(100 + Math.random() * 900)); return name; };

// Pixel icons drawn from 8x8 maps.
const pxIcon = rows => `<svg class="icon" viewBox="0 0 8 8" aria-hidden="true">${rows.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ''))).join('')}</svg>`;
const ICON = {
  back: pxIcon(['....#...', '...#....', '..#.....', '.#######', '..#.....', '...#....', '....#...', '........']),
  close: pxIcon(['#......#', '.#....#.', '..#..#..', '...##...', '...##...', '..#..#..', '.#....#.', '#......#']),
  up: pxIcon(['...##...', '..####..', '.######.', '...##...', '...##...', '...##...', '...##...', '........']),
  sound: pxIcon(['....#...', '...##.#.', '####..#.', '####.#.#', '####.#.#', '####..#.', '...##.#.', '....#...']),
  mute: pxIcon(['....#...', '...##...', '####.#.#', '####..#.', '####..#.', '####.#.#', '...##...', '....#...']),
  share: pxIcon(['...##...', '..####..', '...##...', '...##...', '#..##..#', '#......#', '#......#', '########']),
  copy: pxIcon(['..######', '..#....#', '###....#', '#.#....#', '#.######', '#....#..', '######..', '........']),
  people: pxIcon(['.##...##', '.##...##', '........', '####.###', '####.###', '####.###', '........', '........']),
  loop: pxIcon(['........', '.##..##.', '#..##..#', '#..##..#', '.##..##.', '........', '........', '........']),
  clock: pxIcon(['..####..', '.#....#.', '#..#...#', '#..##..#', '#......#', '.#....#.', '..####..', '........']),
  help: pxIcon(['..####..', '.#....#.', '.....#..', '....#...', '...#....', '........', '...#....', '........']),
  skip: pxIcon(['#...#...', '##..##..', '###.###.', '########', '###.###.', '##..##..', '#...#...', '........']),
};
const LOGO = `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true"><rect x="7" y="1" width="2" height="1" fill="#ff5f7e"/><rect x="6" y="2" width="4" height="8" fill="#fff3dc"/><rect x="7" y="3" width="2" height="2" fill="#8fd3ff"/><rect x="5" y="7" width="1" height="4" fill="#ff5f7e"/><rect x="10" y="7" width="1" height="4" fill="#ff5f7e"/><rect x="7" y="10" width="2" height="2" fill="#ffb347"/><rect x="7" y="12" width="2" height="2" fill="#ff5f7e"/></svg>`;
const squares = tiers => `<span class="sq" aria-label="${tiers.map(t => (t < 0 ? 'miss' : TIERS[t].name)).join(', ')}">${tiers.map(t => `<i class="${t < 0 ? 'x' : 't' + t}"></i>`).join('')}</span>`;
const planet = id => `<span class="planet" style="--c:${id === 'mixed' ? '#fff3dc' : genreOf(id).color}"></span>`;
const SHARE_SQ = ['⬜', '🟥', '🟩', '🟦', '🟪', '🟨'];

function banner(msg, ms = 2400) {
  const b = $('#banner'); b.textContent = msg; b.hidden = !msg;
  clearTimeout(banner.t); if (msg && ms) banner.t = setTimeout(() => (b.hidden = true), ms);
}
async function share(text, url) {
  try { if (navigator.share) { await navigator.share({ text, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url ? `${text}\n${url}` : text); banner('Copied!'); } catch { banner('Could not copy'); }
}
const topbar = () => `<header class="top"><button class="mark" data-go="">${LOGO}ODDITY</button><div class="top-r"><button class="btn iconbtn small" id="snd" aria-label="${sfx.muted ? 'Turn sound on' : 'Turn sound off'}">${sfx.muted ? ICON.mute : ICON.sound}</button></div></header>`;
function wire() {
  app.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  $('#snd')?.addEventListener('click', e => { const m = sfx.toggle(); e.currentTarget.innerHTML = m ? ICON.mute : ICON.sound; e.currentTarget.setAttribute('aria-label', m ? 'Turn sound on' : 'Turn sound off'); });
}

// ---------- scene ----------
const scene = createScene($('#sky'));
let announce = false;
scene.onPass = L => { if (announce && L.pts > 0) { banner(`Passed ${L.name}!`, 1800); sfx.pass(); } };
let serverAI = false;
fetch('/health').then(r => r.json()).then(j => (serverAI = !!j.ai)).catch(() => {}); // also wakes a sleeping server early

// ---------- router (menu screens only; play screens are not in history) ----------
const ROUTES = { '': home, unlimited, friends, archive, how };
function go(r) { if (('#/' + r) === location.hash || (!r && !location.hash)) route(); else location.hash = '#/' + r; }
function route() {
  if (M.snap || M.wanted) return;
  stopTimer(); S = null; announce = false;
  (ROUTES[location.hash.replace(/^#\/?/, '')] || home)();
  scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ---------- home ----------
function home() {
  scene.layout('home'); scene.reset();
  const k = todayKey(), done = store.get('daily:' + k), prog = store.get('dailyprog:' + k);
  const streak = store.get('streak', { n: 0, last: '' }), live = streak.last === k || streak.last === prevDay(k) ? streak.n : 0;
  app.innerHTML = `${topbar()}
  <div class="home">
    <h1 class="title">ODDITY</h1>
    <p class="tag">Name the answer nobody else would. The rarer it is, the farther your rocket flies.</p>
    <section class="px panel" aria-label="Today's mission">
      <div class="mission-meta"><span>Mission <b>#${missionNumber(k)}</b></span><span>${fmtDate(k)}</span>${live ? `<span>Streak <b>${live}</b></span>` : ''}</div>
      ${done ? `
        <div class="reach">${esc(dist(done.score).toUpperCase())}<small>You flew past ${esc(reached(done.score).name)} today.</small></div>
        <div>${squares(done.picks.map(p => (p.ok ? p.tier : -1)))}</div>
        <div class="row-actions"><button class="btn primary" id="see">Mission report</button><span class="muted pixel">Next mission in <b class="num" id="cd">${fmtTime(msToNextDay())}</b></span></div>`
      : `<p class="muted">${DAILY_COUNT} prompts, ${DAILY_SECONDS} seconds each, the same for everyone on Earth today. One flight per day.</p>
        <div class="row-actions"><button class="btn primary big" id="launch">${ICON.up} ${prog ? 'Resume flight' : 'Launch'}</button></div>`}
    </section>
    <nav class="menu" aria-label="More ways to play">
      <button class="btn" data-go="unlimited">${ICON.loop}<span>Unlimited<small>Any pack, any time</small></span></button>
      <button class="btn" data-go="friends">${ICON.people}<span>Friends<small>Rooms up to 40, free</small></span></button>
      <button class="btn" data-go="archive">${ICON.clock}<span>Archive<small>Fly past missions</small></span></button>
      <button class="btn" data-go="how">${ICON.help}<span>How to play<small>Tiers and tips</small></span></button>
    </nav>
  </div>
  <p class="foot">Answer lists are hand-made, so a real but very obscure answer can be missing. Spelling slips get a “Did you mean…?”.</p>`;
  wire();
  $('#launch')?.addEventListener('click', () => startMission(k, 'daily'));
  $('#see')?.addEventListener('click', () => results({ mode: 'daily', date: k, ...done }, true));
  if (done) tick(() => { const el = $('#cd'); if (!el) return false; el.textContent = fmtTime(msToNextDay()); if (msToNextDay() < 1500) setTimeout(route, 1600); });
  const room = new URLSearchParams(location.search).get('room');
  if (room) { history.replaceState(null, '', '/#/friends'); friends(room); }
}
let tickT = 0;
function tick(fn) { clearInterval(tickT); tickT = setInterval(() => { if (fn() === false) clearInterval(tickT); }, 1000); }

// ---------- menu pages ----------
function page(titleText, body) {
  scene.layout('home'); scene.reset();
  app.innerHTML = `${topbar()}<div class="page"><div class="page-h"><button class="btn iconbtn small" data-go="" aria-label="Back">${ICON.back}</button><h1>${titleText}</h1></div>${body}</div>`;
  wire();
}
function unlimited() {
  const mode = store.get('umode', 'classic');
  page('Unlimited', `
    <div class="seg" role="group" aria-label="Mode">
      <button class="btn" data-mode="classic" aria-pressed="${mode === 'classic'}">Classic<small>7 prompts, then land</small></button>
      <button class="btn" data-mode="endless" aria-pressed="${mode === 'endless'}">Endless<small>3 fuel cells. Miss = lose one</small></button>
    </div>
    <section class="px panel"><h2 class="pixel">Pick a pack</h2>
      <div class="packs">
        <button class="btn" data-g="mixed">${planet('mixed')}<span>Everything<small>${PROMPTS.length} prompts</small></span></button>
        ${GENRES.map(g => `<button class="btn" data-g="${g.id}">${planet(g.id)}<span>${esc(g.name)}<small>${PROMPTS.filter(p => p.genre === g.id).length} prompts</small></span></button>`).join('')}
      </div>
    </section>`);
  app.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { store.set('umode', b.dataset.mode); app.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b)); }));
  app.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => startUnlimited(b.dataset.g, store.get('umode', 'classic'))));
}
function friends(code = '') {
  page('Play with friends', `
    <section class="px panel">
      <label class="lbl" for="nm">Your name</label>
      <input id="nm" class="field" maxlength="16" autocomplete="nickname" placeholder="Pilot name" value="${esc(name)}">
      <div class="row-actions"><button class="btn primary" id="create">Create a room</button><button class="btn" id="quick">Quick match</button></div>
      <p class="muted">Everyone gets the same prompt at the same moment. Give the same answer as someone else and you both get half.</p>
    </section>
    <section class="px panel">
      <label class="lbl" for="code">Join with a code</label>
      <form class="join" id="joinf"><input id="code" class="field num" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="123456" value="${esc(code)}"><button class="btn primary">Join</button></form>
      <p class="error" id="mperr" role="alert"></p>
    </section>`);
  $('#nm').addEventListener('input', e => saveName(e.target.value));
  $('#create').addEventListener('click', () => mpStart({ t: 'create', name: ensureName(), settings: { genre: 'mixed', rounds: 7, seconds: 25 } }));
  $('#quick').addEventListener('click', () => mpStart({ t: 'quick', name: ensureName() }));
  $('#joinf').addEventListener('submit', e => {
    e.preventDefault(); const c = $('#code').value.replace(/\D/g, '');
    if (c.length !== 6) { $('#mperr').textContent = 'Room codes are 6 digits.'; return; }
    mpStart({ t: 'join', code: c, name: ensureName() });
  });
  if (code && name) mpStart({ t: 'join', code, name });
}
function archive() {
  const today = missionNumber(todayKey());
  const rows = [];
  for (let n = today - 1; n >= 1; n--) {
    const k = dateOfMission(n), rec = store.get('daily:' + k);
    rows.push(`<li><button class="btn" data-date="${k}"><span>Mission #${n} · ${fmtDate(k)}</span><span>${rec ? esc(dist(rec.score)) : 'Not flown'}</span></button></li>`);
  }
  page('Archive', `<p class="muted">Every past mission, the same prompts everyone got that day. Archive flights don't go on the board.</p><ul class="list">${rows.join('') || '<li class="muted">No past missions yet.</li>'}</ul>`);
  app.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => { const rec = store.get('daily:' + b.dataset.date); rec ? results({ mode: 'archive', date: b.dataset.date, ...rec }, true) : startMission(b.dataset.date, 'archive'); }));
}
function how() {
  page('How to play', `
    <section class="px panel">
      <ol class="rules">
        <li>Each prompt has hundreds of right answers. Type one before the ${DAILY_SECONDS}-second clock runs out.</li>
        <li>If it isn't accepted, try another. A small spelling slip gets “Did you mean…?”; press Enter or Yes to take it.</li>
        <li>Rarer answers score more and fly your rocket farther. Speed earns nothing.</li>
        <li>Anything still in the box when time runs out is submitted for you.</li>
        <li>Skip the first two answers that come to mind. Everyone else thinks of them too.</li>
      </ol>
    </section>
    <section class="px panel"><h2 class="pixel">The tiers</h2>
      <div class="tiers">${TIERS.map((t, i) => `<div class="t${i}">${squares([i])}<span><b style="color:var(--tc)">${t.name}</b> <span class="muted">${t.blurb}</span></span><span>${t.pts}</span></div>`).join('')}</div>
    </section>
    <section class="px panel"><h2 class="pixel">Modes</h2>
      <p><b class="pixel">Daily mission</b>: 7 prompts, the same for everyone, once a day. <b class="pixel">Unlimited</b>: Classic (7 prompts) or Endless (3 fuel cells; a miss or skip costs one, a True Oddity refills one). <b class="pixel">Friends</b>: rooms of up to 40 with a code or link, 5 to 50 prompts.</p>
    </section>`);
}

// ---------- single player ----------
let S = null; // current flight
let timer = { raf: 0, end: 0, lastSec: 0 };
function stopTimer() { cancelAnimationFrame(timer.raf); timer.end = 0; clearInterval(tickT); }
function runTimer(endAt, onEnd) {
  stopTimer(); timer.end = endAt;
  const bar = $('.timer i'), secs = $('.secs'), box = $('.timer'), span = Math.max(1, endAt - Date.now());
  const step = () => {
    const left = timer.end - Date.now(), sec = Math.max(0, Math.ceil(left / 1000));
    if (bar) bar.style.transform = `scaleX(${Math.max(0, left / span)})`;
    if (secs) { secs.textContent = sec; secs.classList.toggle('low', left < 5000); }
    box?.classList.toggle('low', left < 5000);
    if (sec !== timer.lastSec) { if (sec <= 5 && sec > 0) sfx.tick(); timer.lastSec = sec; }
    if (left <= 0) { stopTimer(); onEnd(); return; }
    timer.raf = requestAnimationFrame(step);
  };
  step();
}

function startMission(date, mode) {
  if (store.get('daily:' + date)) return route();
  const prog = store.get('dailyprog:' + date, { picks: [] });
  S = { mode, date, prompts: dailyPrompts(date), picks: prog.picks, seconds: DAILY_SECONDS };
  begin();
}
function startUnlimited(genre, mode) {
  const recent = store.get('recent', []);
  const n = mode === 'endless' ? 1 : 7;
  S = { mode, genre, prompts: pickPrompts(genre, n, recent), picks: [], seconds: 25, fuel: 3, recent };
  begin();
}
function begin() {
  if (location.hash !== '#/play') history.pushState(null, '', '#/play');
  scene.layout('flight'); scene.reset(); scene.fly(total(S.picks), true);
  sfx.launch(); announce = true;
  showPrompt();
}
function remember(p) { const r = store.get('recent', []); store.set('recent', [p.id, ...r.filter(x => x !== p.id)].slice(0, Math.floor(PROMPTS.length * 0.7))); }

function hud() {
  const i = S.picks.length;
  const where = S.mode === 'daily' ? `Mission #${missionNumber(S.date)} · ${i + 1}/${S.prompts.length}`
    : S.mode === 'archive' ? `Archive #${missionNumber(S.date)} · ${i + 1}/${S.prompts.length}`
    : S.mode === 'endless' ? `Endless · ${i + 1}` : `${S.genre === 'mixed' ? 'Everything' : genreOf(S.genre).name} · ${i + 1}/7`;
  const fuel = S.mode === 'endless' ? `<span class="fuel" aria-label="${S.fuel} fuel cells left">${[0, 1, 2].map(n => `<i class="${n < S.fuel ? '' : 'empty'}"></i>`).join('')}</span>` : '';
  return `<div class="hud"><button class="btn iconbtn small" id="quit" aria-label="Leave flight">${ICON.close}</button><span class="where">${esc(where)}</span>${fuel}<span class="alt num" id="alt">${esc(dist(total(S.picks)))}</span><span class="secs" aria-hidden="true">${S.seconds}</span></div><div class="timer" aria-hidden="true"><i></i></div>`;
}
const answerForm = () => `<form class="answer" id="af" autocomplete="off"><label for="ans" class="visually-hidden">Your answer</label><input id="ans" class="field" enterkeyhint="send" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="60" placeholder="Type your answer"><button class="btn primary" aria-label="Fire answer">Fire</button></form><div class="fb" id="fb" aria-live="polite"></div>`;

function showPrompt() {
  const p = S.prompts[S.picks.length], g = genreOf(p.genre);
  app.innerHTML = `<div class="play">${hud()}
    <section class="px panel" id="stage">
      <span class="pack-tag">${planet(p.genre)}${esc(g.name)}</span>
      <h1 class="prompt">${esc(p.text)}</h1>
      ${answerForm()}
      ${S.mode === 'endless' ? `<div><button class="btn ghost small" id="skip">${ICON.skip} Skip (costs fuel)</button></div>` : ''}
    </section></div>`;
  $('#quit').addEventListener('click', () => { if (S.mode === 'daily' || S.mode === 'archive' || confirm('Leave this flight?')) { history.back(); } });
  $('#skip')?.addEventListener('click', () => lockIn(p, { ok: false, promptId: p.id, skipped: true }));
  const ctl = answerBox(p, res => lockIn(p, { ...res, promptId: p.id }));
  runTimer(Date.now() + S.seconds * 1000, async () => { const r = await ctl.final(); if (r) lockIn(p, r.ok ? { ...r, promptId: p.id } : { ok: false, promptId: p.id }); });
}

// The answer box: local bank first, then "did you mean", then the server AI if it is switched on.
function answerBox(p, onAccept, { remote } = {}) {
  const input = $('#ans'), form = $('#af'), fb = $('#fb');
  let pending = null, busy = false, done = false;
  input.focus({ preventScroll: true });
  const say = (html, bad) => { fb.className = 'fb' + (bad ? ' bad' : ''); fb.innerHTML = html; };
  const shake = () => { form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake'); };
  const accept = r => { if (done) return; done = true; onAccept(r); };
  input.addEventListener('input', () => { if (pending) { pending = null; say(''); } });
  async function check(text, final) {
    if (remote) return remote(text, final);
    const r = judge(p, text);
    if (r.ok) return r;
    if (r.reason === 'suggest' && final) return judge(p, r.suggest);
    if ((r.reason === 'unknown' || r.reason === 'suggest') && serverAI) {
      try {
        say('Checking with mission control…');
        const res = await fetch('/api/judge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ promptId: p.id, text, final }) });
        const a = await res.json();
        if (a.ok) return a;
      } catch {}
    }
    return r;
  }
  function refuse(r, text) {
    sfx[r.reason === 'suggest' ? 'ask' : 'reject']();
    if (r.reason === 'suggest') {
      pending = { text, answer: r.suggest };
      say(`<span class="ask">Did you mean <b>${esc(cap(r.suggest))}</b>?</span><button type="button" class="btn small primary" id="yes">Yes</button><button type="button" class="btn small ghost" id="no">No</button>`);
      $('#yes').addEventListener('click', () => confirmPending());
      $('#no').addEventListener('click', () => { pending = null; say(''); input.select(); input.focus(); });
      return;
    }
    shake(); input.select();
    say(r.reason === 'empty' ? 'Type an answer first.' : r.reason === 'multiple' ? 'One answer at a time.' : r.reason === 'busy' ? 'Mission control is busy. Try again.' : `“${esc(text.trim().slice(0, 40))}” isn't on our list. Try another.`, true);
  }
  async function confirmPending() {
    const r = await check(pending.answer, false);
    pending = null;
    if (r.ok) accept(r); else refuse(r, input.value);
  }
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || done) return;
    const text = input.value;
    if (pending && text === pending.text) return confirmPending(); // Enter again = yes
    busy = true;
    try { const r = await check(text, false); if (r.ok) accept(r); else refuse(r, text); } finally { busy = false; }
  });
  return {
    // time's up: whatever is in the box is submitted, and a close spelling counts as meant
    async final() {
      if (done) return null;
      const text = (pending && input.value === pending.text) ? pending.answer : input.value;
      done = true;
      return text.trim() ? check(text, true) : { ok: false };
    },
  };
}

function lockIn(p, pick) {
  if (!S || S.picks.length >= S.prompts.length && S.mode !== 'endless') return;
  stopTimer();
  S.picks.push(pick);
  if (S.mode === 'daily' || S.mode === 'archive') store.set('dailyprog:' + S.date, { picks: S.picks });
  if (S.mode === 'classic' || S.mode === 'endless') remember(p);
  const sum = total(S.picks);
  scene.fly(sum);
  if (pick.ok) { sfx.accept(pick.tier); try { if (pick.tier >= 3) navigator.vibrate?.(40); } catch {} } else sfx.reject();
  if (S.mode === 'endless') { if (!pick.ok) S.fuel--; else if (pick.tier === 5 && S.fuel < 3) S.fuel++; }
  const last = S.mode === 'endless' ? S.fuel <= 0 : S.picks.length === S.prompts.length;
  const more = rarer(p, pick.ok ? pick.tier : -1, 3);
  $('#alt').textContent = dist(sum);
  if (S.mode === 'endless') $('.fuel').innerHTML = [0, 1, 2].map(n => `<i class="${n < S.fuel ? '' : 'empty'}"></i>`).join('');
  $('#stage').innerHTML = `
    <span class="pack-tag">${planet(p.genre)}${esc(p.text)}</span>
    <div class="reveal ${pick.ok ? 't' + pick.tier : ''}">
      ${pick.ok
        ? `<div class="stamp">${TIERS[pick.tier].name}</div><p class="said">You said <b>${esc(cap(pick.answer))}</b> <span class="pts">+${pick.points}</span></p><p class="blurb">${TIERS[pick.tier].blurb}</p>`
        : `<div class="stamp" style="--tc:var(--ink-3)">${pick.skipped ? 'Skipped' : 'No fuel'}</div><p class="said">${pick.skipped ? 'You skipped this one.' : 'Time ran out before an answer was accepted.'}${S.mode === 'endless' ? ' One fuel cell lost.' : ''}</p>`}
      <p class="others">${pick.ok && pick.tier === 5 ? 'Nothing on our list is rarer than that.' : `Rarer answers out there: ${more.map(m => `<b>${esc(cap(m))}</b>`).join(', ')}`}</p>
      <div class="row-actions"><button class="btn primary big" id="next">${last ? 'Land' : 'Next'} ${ICON.up}</button></div>
    </div>`;
  const next = $('#next'); next.focus({ preventScroll: true });
  next.addEventListener('click', () => {
    if (last) return finish();
    if (S.mode === 'endless') S.prompts.push(...pickPrompts(S.genre, 1, store.get('recent', [])));
    showPrompt();
  });
}

function finish() {
  const score = total(S.picks);
  if (S.mode === 'daily' || S.mode === 'archive') {
    const rec = { picks: S.picks, score, submitted: S.mode === 'archive' };
    store.set('daily:' + S.date, rec);
    if (S.mode === 'daily') {
      const st = store.get('streak', { n: 0, last: '' });
      store.set('streak', { n: st.last === prevDay(S.date) ? st.n + 1 : st.last === S.date ? st.n : 1, last: S.date });
    }
    return results({ mode: S.mode, date: S.date, ...rec });
  }
  results({ mode: S.mode, genre: S.genre, picks: S.picks, score });
}

// ---------- results ----------
function results(r, replay) {
  stopTimer(); announce = false;
  scene.layout('results');
  if (replay) { scene.reset(); setTimeout(() => scene.fly(r.score), 250); } else scene.fly(r.score);
  const tiers = r.picks.map(p => (p.ok ? p.tier : -1));
  const label = r.mode === 'daily' ? `Mission #${missionNumber(r.date)}` : r.mode === 'archive' ? `Archive mission #${missionNumber(r.date)}`
    : r.mode === 'endless' ? `Endless · ${r.genre === 'mixed' ? 'Everything' : genreOf(r.genre).name}` : r.genre === 'mixed' ? 'Everything' : genreOf(r.genre).name;
  const L = reached(r.score);
  S = null;
  app.innerHTML = `
  <div class="results">
    <div class="hud"><button class="btn iconbtn small" id="home" aria-label="Back to home">${ICON.back}</button><span class="where">${esc(label)} · report</span></div>
    <section class="px panel">
      <div class="headline">${esc(L.pts ? L.name.replace(/^the /, '') : 'The pad')}</div>
      <p class="pixel" style="font-size:1.2rem">${L.pts ? `${esc(dist(r.score))} from Earth, past ${esc(L.name)}.` : 'Still on the launch pad.'} <span class="muted">${r.score} points</span></p>
      <div>${squares(tiers)}</div>
      <div class="row-actions">
        <button class="btn primary" id="share">${ICON.share} Share</button>
        ${r.mode === 'classic' || r.mode === 'endless' ? `<button class="btn" id="again">Fly again</button>` : ''}
        <button class="btn ghost" id="home2">Home</button>
      </div>
    </section>
    <section class="px panel rows" aria-label="Your answers">
      ${r.picks.map(pk => { const p = promptById(pk.promptId); return `<div class="row ${pk.ok ? 't' + pk.tier : ''}"><span class="q">${esc(p?.text || '')}</span><span class="p">${pk.ok ? '+' + pk.points : '0'}<small>${pk.ok ? TIERS[pk.tier].name : pk.skipped ? 'Skipped' : 'Missed'}</small></span><span class="a ${pk.ok ? '' : 'miss'}">${pk.ok ? esc(cap(pk.answer)) : '—'}</span></div>`; }).join('')}
    </section>
    ${r.mode === 'daily' ? `<section class="px panel" id="world"><h2 class="pixel">Today's board</h2><p class="muted" id="wmsg">Sending your flight log…</p></section>` : ''}
  </div>`;
  const back = () => (location.hash === '#/play' ? history.back() : go(''));
  $('#home').addEventListener('click', back); $('#home2').addEventListener('click', back);
  $('#again')?.addEventListener('click', () => startUnlimited(r.genre, r.mode));
  $('#share').addEventListener('click', () => share(`ODDITY · ${label}\n${dist(r.score)}${L.pts ? `, past ${L.name}` : ''}\n${tiers.map(t => (t < 0 ? '⬛' : SHARE_SQ[t])).join('')}`, location.origin));
  if (r.mode === 'daily') loadBoard(r);
}
async function loadBoard(r, attempt = 0) {
  const msg = $('#wmsg'); if (!msg) return;
  try {
    let data;
    if (!r.submitted) {
      const res = await fetch('/api/daily', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: r.date, clientId, name: name || 'Anonymous pilot', answers: r.picks.map(p => (p.ok ? p.answer : '')) }) });
      data = await res.json();
      if (!res.ok) { msg.textContent = data.error || 'The board could not take your flight.'; return; }
      r.submitted = true; store.set('daily:' + r.date, { picks: r.picks, score: r.score, submitted: true });
    } else {
      const res = await fetch(`/api/daily/stats?clientId=${encodeURIComponent(clientId)}`);
      data = await res.json();
      if (!res.ok) { msg.textContent = r.date === todayKey() ? data.error : 'That mission has ended.'; return; }
    }
    renderBoard(r, data);
  } catch {
    if (attempt < 12) { msg.textContent = 'Waking the server, this can take up to a minute…'; setTimeout(() => loadBoard(r, attempt + 1), 5000); }
    else msg.textContent = 'Could not reach the server. Your flight is saved on this device.';
  }
}
function renderBoard(r, d) {
  const prompts = dailyPrompts(r.date), w = $('#world'); if (!w) return;
  w.innerHTML = `
    <h2 class="pixel">Today's board</h2>
    <p class="muted">You're <b class="num">#${d.rank}</b> of <b class="num">${d.players}</b> ${d.players === 1 ? 'pilot' : 'pilots'} today.${name ? '' : ' Set your name in Friends to show it here.'}</p>
    <ol class="board">${d.top.map((e, i) => `<li class="${e.you ? 'me' : ''}"><span class="r">${i + 1}</span><span class="n">${esc(e.name)}</span><span class="s">${esc(dist(e.score))}</span><span></span>${squares(e.tiers)}</li>`).join('')}</ol>
    <h2 class="pixel" style="margin-top:8px">What everyone said</h2>
    ${d.stats.map((s, i) => `<div class="stat"><span class="q">${esc(prompts[i].text)}</span><div class="bars">
      ${s.top.map(a => `<div class="${s.yours?.answer === a.answer ? 'me' : ''}"><span>${esc(cap(a.answer))}</span><em style="width:${Math.max(2, (a.count / s.total) * 100)}%"></em><span>${Math.round((a.count / s.total) * 100)}%</span></div>`).join('')}
      ${s.yours && !s.top.some(a => a.answer === s.yours.answer) ? `<div class="me"><span>${esc(cap(s.yours.answer))}</span><em style="width:${Math.max(2, (s.yours.count / s.total) * 100)}%"></em><span>${Math.round((s.yours.count / s.total) * 100)}%</span></div>` : ''}
    </div></div>`).join('')}`;
}

// ---------- multiplayer ----------
const M = { ws: null, snap: null, key: '', seat: JSON.parse(sessionStorage.getItem('oddity:seat') || 'null'), first: null, retries: 0, offset: 0, wanted: false, judge: null };
function mpStart(firstMsg) { M.first = firstMsg; M.wanted = true; M.retries = 0; banner('Connecting…', 0); mpConnect(); }
function mpConnect() {
  try { M.ws?.close(); } catch {}
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  M.ws = ws;
  const slow = setTimeout(() => banner('Waking the server, up to a minute…', 0), 3000);
  ws.onopen = () => { clearTimeout(slow); banner(''); M.retries = 0; ws.send(JSON.stringify(M.seat ? { t: 'rejoin', ...M.seat } : M.first)); };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'joined') { M.seat = { code: m.code, token: m.token }; sessionStorage.setItem('oddity:seat', JSON.stringify(M.seat)); history.replaceState(null, '', '/?room=' + m.code + '#/room'); }
    else if (m.t === 'gone') { M.seat = null; sessionStorage.removeItem('oddity:seat'); if (M.first) ws.send(JSON.stringify(M.first)); else mpQuit('That room has closed.'); }
    else if (m.t === 'error') { const msg = m.msg; mpQuit(); go('friends'); setTimeout(() => { const el = $('#mperr'); if (el) el.textContent = msg; }, 0); }
    else if (m.t === 'rejected') M.judge?.(m);
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
  M.ws = null; M.seat = null; M.snap = null; M.key = ''; M.first = null; sessionStorage.removeItem('oddity:seat');
  history.replaceState(null, '', '/#/'); banner(msg || ''); route();
}
const serverNow = () => Date.now() + M.offset;
const me = s => s.players.find(p => p.id === s.you);
const inviteUrl = s => `${location.origin}/?room=${s.code}`;
function renderMp() {
  const s = M.snap; if (!s) return;
  const key = s.phase + ':' + s.round, fresh = key !== M.key; M.key = key;
  if (s.phase === 'lobby') return lobby(s, fresh);
  if (s.phase === 'prompt') return mpPrompt(s, fresh);
  if (s.phase === 'reveal') return mpReveal(s, fresh);
  if (s.phase === 'final') return mpFinal(s, fresh);
}
const setSummary = s => `${s.settings.genre === 'mixed' ? 'Everything' : genreOf(s.settings.genre).name} · ${s.settings.rounds} prompts · ${s.settings.seconds} s each`;
function lobbyStatus(s, host) {
  const n = s.players.filter(p => p.online).length;
  if (s.autoStartAt) return `Launching in ${Math.max(0, Math.ceil((s.autoStartAt - serverNow()) / 1000))}s… ${n} pilots aboard.`;
  if (s.public) return n < 2 ? 'Waiting for another pilot to join…' : `${n} pilots aboard.`;
  return host ? (n < 2 ? 'Share the code, or start solo to try it.' : `${n} pilots aboard. Launch when everyone's in.`) : 'Waiting for the host to launch…';
}
const people = s => s.players.map(p => `<li class="${p.online ? '' : 'off'}"><span>${esc(p.name)}${p.id === s.you ? ' <span class="tag">(you)</span>' : ''}</span><span class="tag">${p.id === s.hostId ? 'Host' : p.online ? '' : 'Away'}</span></li>`).join('');
function lobby(s, fresh) {
  stopTimer(); announce = false; scene.layout('home'); scene.reset();
  const host = s.hostId === s.you;
  if (!fresh && $('.lobby')) {
    $('#people').innerHTML = people(s); $('#lstatus').textContent = lobbyStatus(s, host);
    if (host) for (const k of ['genre', 'rounds', 'seconds']) { const el = $('#s-' + k); if (el && document.activeElement !== el) el.value = s.settings[k]; }
    else $('#sumset').textContent = setSummary(s);
    return;
  }
  const opt = (arr, v) => arr.map(n => `<option ${n == v ? 'selected' : ''}>${n}</option>`).join('');
  app.innerHTML = `${topbar()}
  <div class="lobby">
    <section class="px panel">
      <div class="page-h"><button class="btn iconbtn small" id="leave" aria-label="Leave room">${ICON.close}</button><span class="pixel muted">${s.public ? 'QUICK MATCH' : 'PRIVATE ROOM'} · CODE</span></div>
      <div class="code" aria-label="Room code ${s.code.split('').join(' ')}">${s.code}</div>
      <div class="row-actions"><button class="btn primary" id="invite">${ICON.share} Invite</button><button class="btn" id="copy">${ICON.copy} Copy link</button></div>
      <p class="muted" id="lstatus" aria-live="polite">${lobbyStatus(s, host)}</p>
      ${host ? `<button class="btn primary big" id="start">${ICON.up} Launch game</button>` : ''}
    </section>
    <section class="px panel">
      <h2 class="pixel">Pilots</h2>
      <ul class="people" id="people">${people(s)}</ul>
      <h2 class="pixel">Game</h2>
      ${host ? `<div class="settings">
        <div class="wide"><label class="lbl" for="s-genre">Pack</label><select id="s-genre" class="field"><option value="mixed">Everything</option>${GENRES.map(g => `<option value="${g.id}" ${g.id === s.settings.genre ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>
        <div><label class="lbl" for="s-rounds">Prompts</label><select id="s-rounds" class="field">${opt([5, 7, 10, 15, 20, 30, 50], s.settings.rounds)}</select></div>
        <div><label class="lbl" for="s-seconds">Seconds</label><select id="s-seconds" class="field">${opt([5, 10, 15, 20, 25, 30, 45, 60], s.settings.seconds)}</select></div>
      </div>` : `<p class="muted" id="sumset">${setSummary(s)}</p>`}
    </section>
  </div>`;
  wire();
  $('#leave').addEventListener('click', () => mpQuit());
  $('#invite').addEventListener('click', () => share(`Join my ODDITY room: ${s.code}`, inviteUrl(s)));
  $('#copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(inviteUrl(s)); banner('Invite link copied'); } catch { banner(inviteUrl(s), 6000); } });
  if (host) {
    for (const k of ['genre', 'rounds', 'seconds']) $('#s-' + k).addEventListener('change', e => mpSend({ t: 'settings', settings: { [k]: e.target.value } }));
    $('#start').addEventListener('click', () => mpSend({ t: 'start' }));
  }
  if (s.autoStartAt) tick(() => { if (!$('.lobby') || M.snap?.phase !== 'lobby') return false; $('#lstatus').textContent = lobbyStatus(M.snap, M.snap.hostId === M.snap.you); });
}
const strip = s => s.players.filter(p => p.online || p.answered).map(p => `<span class="chip ${p.answered ? 'ok' : ''} ${p.online ? '' : 'off'}"><span class="dot"></span>${esc(p.name)}</span>`).join('');
function mpHud(s, mine) {
  return `<div class="hud"><button class="btn iconbtn small" id="leave" aria-label="Leave room">${ICON.close}</button><span class="where">Room ${s.code} · ${s.round + 1}/${s.rounds}</span><span class="alt num">${esc(dist(mine.score))}</span><span class="secs" aria-hidden="true"></span></div><div class="timer" aria-hidden="true"><i></i></div>`;
}
function mpLocked(a) {
  $('#stage').innerHTML = `<div class="reveal t${a.tier}"><div class="stamp">${TIERS[a.tier].name}</div><p class="said">Locked in <b>${esc(cap(a.answer))}</b> <span class="pts">+${a.points}</span></p><p class="others">Waiting for the others. Same answer as another pilot? You both get half.</p></div>`;
}
function mpPrompt(s, fresh) {
  const p = promptById(s.prompt.id), mine = me(s);
  if (!fresh && $('#mpplay')) { $('#strip').innerHTML = strip(s); if (mine.answer && !$('.reveal')) { mpLocked(mine.answer); sfx.accept(mine.answer.tier); scene.fly(mine.score + mine.answer.points); } return; }
  announce = true; scene.layout('flight');
  if (s.round === 0) { scene.reset(); }
  scene.fly(mine.score, s.round === 0);
  app.innerHTML = `<div class="play" id="mpplay">${mpHud(s, mine)}
    <section class="px panel" id="stage"><span class="pack-tag">${planet(p.genre)}${esc(genreOf(p.genre).name)}</span><h1 class="prompt">${esc(p.text)}</h1>${answerForm()}</section>
    <div class="strip" id="strip" aria-label="Who has answered">${strip(s)}</div></div>`;
  $('#leave').addEventListener('click', () => { if (confirm('Leave this game?')) mpQuit(); });
  if (mine.answer) return mpLocked(mine.answer);
  // remote judge: the server rules; the answer box shows its replies
  let waiting = null;
  M.judge = m => { waiting?.(m); waiting = null; };
  const ctl = answerBox(p, () => {}, {
    remote: (text, final) => new Promise(res => {
      waiting = m => res({ ok: false, reason: m.reason, suggest: m.suggest });
      mpSend({ t: 'answer', text, final });
      if (final) res({ ok: true }); // the server takes it from here
    }),
  });
  runTimer(s.endsAt - M.offset, () => { ctl.final(); });
}
function mpReveal(s, fresh) {
  const mine = me(s), p = promptById(s.prompt.id), host = s.hostId === s.you;
  if (fresh) scene.fly(mine.score);
  const ranked = [...s.players].filter(x => x.online || x.answer).sort((a, b) => (b.answer?.gained ?? -1) - (a.answer?.gained ?? -1));
  app.innerHTML = `<div class="play">${mpHud(s, mine)}
    <section class="px panel">
      <span class="pack-tag">${planet(p.genre)}${esc(p.text)}</span>
      <ul class="answers">${ranked.map(x => `<li class="${x.id === s.you ? 'me' : ''} ${x.answer ? 't' + x.answer.tier : ''}"><span class="n">${esc(x.name)}</span><span class="p">${x.answer ? '+' + x.answer.gained : '0'}<small>${x.answer ? (x.answer.shared ? 'Copycat · half' : TIERS[x.answer.tier].name) : 'No answer'}</small></span><span class="a">${x.answer ? esc(cap(x.answer.answer)) : '—'}</span></li>`).join('')}</ul>
      <p class="others">Rarest on our list: ${rarer(p, 4, 3).map(m => `<b>${esc(cap(m))}</b>`).join(', ')}</p>
      ${host ? `<div class="row-actions"><button class="btn primary big" id="next">${s.round + 1 >= s.rounds ? 'Final scores' : 'Next'} ${ICON.up}</button></div>` : '<p class="muted">Next prompt in a few seconds…</p>'}
    </section></div>`;
  $('#leave').addEventListener('click', () => { if (confirm('Leave this game?')) mpQuit(); });
  $('#next')?.addEventListener('click', () => mpSend({ t: 'next' }));
  $('#next')?.focus({ preventScroll: true });
  runTimer(s.endsAt - M.offset, () => {});
}
function mpFinal(s) {
  stopTimer(); announce = false;
  const ranked = [...s.players].sort((a, b) => b.score - a.score), host = s.hostId === s.you, mine = me(s), place = ranked.findIndex(p => p.id === s.you) + 1;
  scene.layout('results'); scene.fly(mine.score);
  app.innerHTML = `<div class="results">
    <div class="hud"><button class="btn iconbtn small" id="leave" aria-label="Leave room">${ICON.close}</button><span class="where">Room ${s.code} · final</span></div>
    <section class="px panel">
      <div class="headline">${place === 1 ? 'You win!' : '#' + place}</div>
      <p class="pixel" style="font-size:1.2rem">${esc(dist(mine.score))}, past ${esc(reached(mine.score).name)} <span class="muted">${mine.score} points</span></p>
      <ol class="board">${ranked.map((p, i) => `<li class="${p.id === s.you ? 'me' : ''}"><span class="r">${i + 1}</span><span class="n">${esc(p.name)}</span><span class="s">${p.score} pts</span><span></span>${squares((p.history || []).map(t => (t == null ? -1 : t)))}</li>`).join('')}</ol>
      <div class="row-actions">${host ? `<button class="btn primary big" id="again">Play again</button>` : '<p class="muted">Waiting for the host to start another game…</p>'}<button class="btn ghost" id="out">Leave room</button></div>
    </section></div>`;
  $('#leave').addEventListener('click', () => mpQuit()); $('#out').addEventListener('click', () => mpQuit());
  $('#again')?.addEventListener('click', () => mpSend({ t: 'again' }));
}

// ---------- boot ----------
if (M.seat) { M.wanted = true; mpConnect(); banner('Rejoining your room…', 0); app.innerHTML = '<p class="boot">Rejoining…</p>'; }
else if (location.hash === '#/play' || location.hash === '#/room') { history.replaceState(null, '', '/#/'); route(); }
else route();
