// Oddity server: static files, daily leaderboard API, optional AI judge, multiplayer rooms over WebSocket.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { judge, dailyPrompts, todayKey, pickPrompts, promptById, GENRES, DAILY_COUNT } from './public/engine.js';
import { makeAiJudge } from './ai.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;
fs.mkdirSync(DATA, { recursive: true });
const ai = makeAiJudge({ file: path.join(DATA, 'ai-cache.json') });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Anonymous';

// Bank first, then the AI (when enabled). `final` = the clock ran out, so a close spelling is taken as meant.
async function fullJudge(p, text, final = false) {
  const r = judge(p, text);
  if (r.ok) return r;
  if (r.reason === 'suggest' && final) return judge(p, r.suggest);
  if (r.reason === 'unknown' || r.reason === 'suggest') {
    const a = await ai.judge(p, text);
    if (a?.ok) return a;
  }
  return r;
}

// ---------- Daily leaderboard ----------
// shortcut: one JSON file per day on local disk; Render's free disk is wiped on redeploy/restart. Upgrade to a database if boards must survive restarts.
const days = new Map();
function day(k) {
  if (!days.has(k)) {
    const ids = dailyPrompts(k).map(p => p.id);
    let d = { ids, entries: {}, counts: Array.from({ length: DAILY_COUNT }, () => ({})) };
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(DATA, `daily-${k}.json`), 'utf8'));
      if (String(saved.ids) === String(ids)) d = saved; // prompts changed in a deploy: old answers no longer line up
    } catch {}
    days.set(k, d);
    for (const old of days.keys()) if (old < k && days.size > 3) days.delete(old);
  }
  return days.get(k);
}
const saveTimers = {};
function saveDay(k) {
  clearTimeout(saveTimers[k]);
  saveTimers[k] = setTimeout(() => fs.writeFile(path.join(DATA, `daily-${k}.json`), JSON.stringify(days.get(k)), () => {}), 1000);
}
function board(k, clientId) {
  const d = day(k);
  const list = Object.entries(d.entries).map(([id, e]) => ({ id, ...e })).sort((a, b) => b.score - a.score || a.at - b.at);
  const rank = clientId ? list.findIndex(e => e.id === clientId) + 1 : 0;
  return { date: k, players: list.length, rank, top: list.slice(0, 25).map(e => ({ name: e.name, score: e.score, tiers: e.tiers, you: e.id === clientId })) };
}
function stats(k, answers) {
  const d = day(k), n = Object.keys(d.entries).length;
  return d.counts.map((c, i) => {
    const sorted = Object.entries(c).sort((a, b) => b[1] - a[1]);
    const mine = answers?.[i];
    return { total: n, top: sorted.slice(0, 5).map(([answer, count]) => ({ answer, count })), yours: mine ? { answer: mine, count: c[mine] || 0 } : null };
  });
}
async function submitDaily(body) {
  const k = todayKey();
  if (body.date !== k) return { status: 409, json: { error: 'That mission has ended. A new one is live.' } };
  const clientId = String(body.clientId || '').slice(0, 64);
  if (!/^[a-z0-9-]{8,64}$/i.test(clientId)) return { status: 400, json: { error: 'Missing player id.' } };
  const d = day(k), prompts = dailyPrompts(k);
  if (!d.entries[clientId]) {
    const raw = Array.isArray(body.answers) ? body.answers : [];
    const judged = await Promise.all(prompts.map((p, i) => (typeof raw[i] === 'string' && raw[i] ? fullJudge(p, raw[i]) : { ok: false })));
    if (d.entries[clientId]) return { status: 200, json: { ...board(k, clientId), score: d.entries[clientId].score, stats: stats(k, d.entries[clientId].answers) } };
    d.entries[clientId] = { name: cleanName(body.name), score: judged.reduce((s, j) => s + (j.ok ? j.points : 0), 0), tiers: judged.map(j => (j.ok ? j.tier : -1)), answers: judged.map(j => (j.ok ? j.answer : null)), at: Date.now() };
    judged.forEach((j, i) => { if (j.ok) d.counts[i][j.answer] = (d.counts[i][j.answer] || 0) + 1; });
    saveDay(k);
  }
  return { status: 200, json: { ...board(k, clientId), score: d.entries[clientId].score, stats: stats(k, d.entries[clientId].answers) } };
}

// ---------- HTTP ----------
function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const send = (res, status, json) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(json)); };
const hits = new Map(); // per-IP rate limit for the AI judge
function limited(req, max = 40) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0];
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 60e3);
  h.push(now); hits.set(ip, h);
  return h.length > max;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true, rooms: rooms.size, ai: ai.enabled });
    if (url.pathname === '/api/daily' && req.method === 'GET') return send(res, 200, board(todayKey(), url.searchParams.get('clientId')));
    if (url.pathname === '/api/daily' && req.method === 'POST') { const r = await submitDaily(await readJson(req)); return send(res, r.status, r.json); }
    if (url.pathname === '/api/daily/stats' && req.method === 'GET') {
      const k = todayKey(), e = day(k).entries[url.searchParams.get('clientId')];
      if (!e) return send(res, 403, { error: 'Fly today’s mission first.' }); // no spoilers before playing
      return send(res, 200, { ...board(k, url.searchParams.get('clientId')), score: e.score, stats: stats(k, e.answers) });
    }
    if (url.pathname === '/api/judge' && req.method === 'POST') {
      if (!ai.enabled) return send(res, 200, { ok: false, reason: 'unknown' });
      if (limited(req)) return send(res, 429, { ok: false, reason: 'busy' });
      const body = await readJson(req, 1024), p = promptById(String(body.promptId || ''));
      if (!p) return send(res, 400, { ok: false, reason: 'unknown' });
      return send(res, 200, await fullJudge(p, String(body.text || '').slice(0, 80), !!body.final));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
    if (!path.extname(file)) file = path.join(PUBLIC, 'index.html'); // SPA routes
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
  } catch {
    send(res, 400, { error: 'Bad request' });
  }
});

// ---------- Multiplayer ----------
const rooms = new Map();
const MAX_PLAYERS = 40, REVEAL_MS = 9000, AUTOSTART_MS = 15000, GRACE_MS = 1500;
const newCode = () => { let c; do c = String(crypto.randomInt(100000, 1000000)); while (rooms.has(c)); return c; };
const clampInt = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
function settingsFrom(s = {}) {
  return {
    genre: s.genre === 'mixed' || GENRES.some(g => g.id === s.genre) ? s.genre : 'mixed',
    rounds: clampInt(s.rounds, 5, 50, 7),
    seconds: clampInt(s.seconds, 5, 60, 25),
  };
}
function createRoom(isPublic, settings) {
  const room = { code: newCode(), public: !!isPublic, hostId: null, settings: settingsFrom(settings), players: new Map(), phase: 'lobby', round: 0, prompts: [], endsAt: 0, timer: null, autoStartAt: 0, emptySince: 0 };
  rooms.set(room.code, room);
  return room;
}
const connected = room => [...room.players.values()].filter(p => p.ws);

function snapshot(room, forId) {
  const p = room.prompts[room.round];
  return {
    t: 'room', you: forId, code: room.code, public: room.public, hostId: room.hostId, settings: room.settings, phase: room.phase,
    round: room.round, rounds: room.settings.rounds, endsAt: room.endsAt, autoStartAt: room.autoStartAt, now: Date.now(),
    prompt: p && room.phase !== 'lobby' ? { id: p.id, text: p.text, genre: p.genre } : null,
    players: [...room.players.values()].map(pl => ({
      id: pl.id, name: pl.name, score: pl.score, online: !!pl.ws, answered: !!pl.answer, history: pl.history,
      // your own answer is visible to you; everyone's shows once the round is revealed
      answer: room.phase === 'reveal' || room.phase === 'final' || pl.id === forId ? pl.answer : null,
    })),
  };
}
function broadcast(room) {
  for (const pl of room.players.values()) if (pl.ws?.readyState === 1) pl.ws.send(JSON.stringify(snapshot(room, pl.id)));
}
function setTimer(room, ms, fn) { clearTimeout(room.timer); room.timer = setTimeout(fn, ms); }

function startGame(room) {
  if (room.phase !== 'lobby' || connected(room).length < 1) return;
  room.prompts = pickPrompts(room.settings.genre, room.settings.rounds);
  for (const pl of room.players.values()) { pl.score = 0; pl.answer = null; pl.history = []; }
  room.round = -1; room.autoStartAt = 0;
  nextRound(room);
}
function nextRound(room) {
  room.round++;
  if (room.round >= room.prompts.length) {
    room.phase = 'final'; room.endsAt = 0;
    clearTimeout(room.timer);
    return broadcast(room);
  }
  for (const pl of room.players.values()) pl.answer = null;
  room.phase = 'prompt';
  room.endsAt = Date.now() + room.settings.seconds * 1000;
  setTimer(room, room.settings.seconds * 1000 + GRACE_MS, () => endRound(room));
  broadcast(room);
}
function endRound(room) {
  if (room.phase !== 'prompt') return;
  // Copycat rule: the same answer as another player scores half for both.
  const tally = {};
  for (const pl of room.players.values()) if (pl.answer) tally[pl.answer.answer] = (tally[pl.answer.answer] || 0) + 1;
  for (const pl of room.players.values()) {
    if (!pl.answer) { pl.history.push(null); continue; }
    pl.answer.shared = tally[pl.answer.answer] > 1;
    pl.answer.gained = pl.answer.shared ? Math.floor(pl.answer.points / 2) : pl.answer.points;
    pl.score += pl.answer.gained;
    pl.history.push(pl.answer.tier);
  }
  room.phase = 'reveal';
  room.endsAt = Date.now() + REVEAL_MS;
  setTimer(room, REVEAL_MS, () => nextRound(room));
  broadcast(room);
}
function maybeEndEarly(room) {
  const live = connected(room);
  if (room.phase === 'prompt' && live.length && live.every(p => p.answer)) endRound(room);
}
function checkAutoStart(room) {
  if (!room.public || room.phase !== 'lobby') return;
  if (connected(room).length >= 2 && !room.autoStartAt) {
    room.autoStartAt = Date.now() + AUTOSTART_MS;
    setTimer(room, AUTOSTART_MS, () => startGame(room));
  } else if (connected(room).length < 2 && room.autoStartAt) {
    room.autoStartAt = 0; clearTimeout(room.timer);
  }
}

function addPlayer(room, ws, name) {
  if (room.players.size >= MAX_PLAYERS) {
    const gone = [...room.players.values()].find(p => !p.ws); // free a seat held by someone who left
    if (!gone) return null;
    room.players.delete(gone.id);
  }
  const pl = { id: crypto.randomUUID().slice(0, 8), token: crypto.randomUUID(), name: cleanName(name), score: 0, answer: null, history: [], ws, judging: false };
  if (room.phase !== 'lobby') pl.history = Array(Math.max(0, room.round)).fill(null);
  room.players.set(pl.id, pl);
  if (!room.hostId || !room.players.get(room.hostId)?.ws) room.hostId = pl.id;
  room.emptySince = 0;
  return pl;
}
function leave(ws) {
  const { room, player } = ws.ctx || {};
  if (!room || !player) return;
  if (player.ws === ws) player.ws = null;
  ws.ctx = {};
  if (room.hostId === player.id) { const next = connected(room)[0]; if (next) room.hostId = next.id; }
  if (!connected(room).length) room.emptySince = Date.now();
  checkAutoStart(room);
  maybeEndEarly(room);
  broadcast(room);
}
function attach(ws, room, pl) {
  if (ws.ctx?.player && ws.ctx.player !== pl) leave(ws);
  if (pl.ws && pl.ws !== ws) try { pl.ws.close(4000, 'Opened in another tab'); } catch {}
  pl.ws = ws;
  ws.ctx = { room, player: pl };
  ws.send(JSON.stringify({ t: 'joined', code: room.code, id: pl.id, token: pl.token }));
  checkAutoStart(room);
  broadcast(room);
}
const err = (ws, msg) => ws.send(JSON.stringify({ t: 'error', msg }));

async function onMessage(ws, msg) {
  const { room, player } = ws.ctx || {};
  switch (msg.t) {
    case 'create': { const r = createRoom(false, msg.settings); return attach(ws, r, addPlayer(r, ws, msg.name)); }
    case 'quick': {
      let r = [...rooms.values()].find(x => x.public && x.phase === 'lobby' && connected(x).length > 0 && connected(x).length < MAX_PLAYERS);
      if (!r) r = createRoom(true, { genre: 'mixed', rounds: 7, seconds: 25 });
      return attach(ws, r, addPlayer(r, ws, msg.name));
    }
    case 'join': {
      const r = rooms.get(String(msg.code || '').replace(/\D/g, ''));
      if (!r) return err(ws, 'No room with that code. Check the number with your host.');
      const pl = addPlayer(r, ws, msg.name);
      if (!pl) return err(ws, 'That room is full (40 players).');
      return attach(ws, r, pl);
    }
    case 'rejoin': {
      const r = rooms.get(String(msg.code || ''));
      const pl = r && [...r.players.values()].find(p => p.token === msg.token);
      if (!pl) return ws.send(JSON.stringify({ t: 'gone' }));
      return attach(ws, r, pl);
    }
  }
  if (!room || !player) return err(ws, 'You are not in a room.');
  const isHost = room.hostId === player.id;
  switch (msg.t) {
    case 'settings':
      if (isHost && room.phase === 'lobby') { room.settings = settingsFrom({ ...room.settings, ...msg.settings }); broadcast(room); }
      break;
    case 'start':
      if (isHost) startGame(room);
      break;
    case 'answer': {
      if (room.phase !== 'prompt' || player.answer || player.judging) return;
      const round = room.round, text = String(msg.text || '').slice(0, 80);
      player.judging = true;
      const res = await fullJudge(room.prompts[round], text, !!msg.final).finally(() => (player.judging = false));
      if (room.phase !== 'prompt' || room.round !== round || player.answer) return;
      if (!res.ok) return ws.send(JSON.stringify({ t: 'rejected', reason: res.reason, suggest: res.suggest, text }));
      player.answer = { answer: res.answer, tier: res.tier, points: res.points };
      broadcast(room);
      maybeEndEarly(room);
      break;
    }
    case 'next':
      if (isHost && room.phase === 'reveal') nextRound(room);
      break;
    case 'again':
      if (isHost && room.phase === 'final') {
        room.phase = 'lobby'; room.round = 0;
        for (const [id, pl] of room.players) { if (!pl.ws) room.players.delete(id); else { pl.score = 0; pl.answer = null; pl.history = []; } }
        checkAutoStart(room); broadcast(room);
      }
      break;
    case 'leave':
      room.players.delete(player.id);
      leave(ws);
      break;
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', ws => {
  ws.ctx = {};
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg && typeof msg.t === 'string') onMessage(ws, msg).catch(() => {});
  });
  ws.on('close', () => leave(ws));
});

// Heartbeat (mobile networks drop sockets silently) + sweep empty rooms.
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
  for (const [code, r] of rooms) if (r.emptySince && Date.now() - r.emptySince > 5 * 60e3) { clearTimeout(r.timer); rooms.delete(code); }
}, 25000).unref();

server.listen(PORT, () => console.log(`Oddity on http://localhost:${PORT}`));
export { server };
