import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket from 'ws';
import { dailyPrompts, todayKey, promptById, judge } from '../public/engine.js';

const PORT = 3999, BASE = `http://localhost:${PORT}`;
let proc;
before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlier-'));
  proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dataDir }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => proc.kill());

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const queue = [], waiters = [];
  ws.on('message', d => { const m = JSON.parse(d); const w = waiters.findIndex(x => x.pred(m)); if (w >= 0) waiters.splice(w, 1)[0].res(m); else queue.push(m); });
  return {
    ws,
    send: m => ws.send(JSON.stringify(m)),
    until: pred => { const i = queue.findIndex(pred); if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]); return new Promise((res, rej) => { waiters.push({ pred, res }); setTimeout(() => rej(new Error('timeout')), 4000); }); },
    open: () => new Promise(r => ws.on('open', r)),
  };
}

test('static files and path traversal guard', async () => {
  assert.equal((await fetch(BASE + '/')).status, 200);
  assert.match(await (await fetch(BASE + '/engine.js')).text(), /export function judge/);
  assert.notEqual((await fetch(BASE + '/..%2fserver.js')).status, 200);
});

test('daily: server re-scores, one entry per player, stats gated', async () => {
  const k = todayKey(), prompts = dailyPrompts(k);
  const answers = prompts.map(p => p.tiers[5][0][0]); // the rarest answer for each prompt
  assert.equal((await fetch(`${BASE}/api/daily/stats?clientId=abcdef12`)).status, 403);
  const post = body => fetch(BASE + '/api/daily', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  const r1 = await post({ date: k, clientId: 'abcdef12', name: 'Ada', answers });
  assert.equal(r1.score, 700);
  assert.equal(r1.rank, 1);
  const r2 = await post({ date: k, clientId: 'abcdef12', name: 'Ada', answers: answers.map(() => 'nonsense') });
  assert.equal(r2.score, 700, 'second submission ignored');
  const r3 = await post({ date: k, clientId: 'zzzzzz99', name: '<b>Bob</b>', answers: ['x'] });
  assert.equal(r3.score, 0);
  assert.equal(r3.players, 2);
  assert.ok(!r3.top.some(e => /[<>]/.test(e.name)));
  assert.equal(r1.stats[0].yours.count, 1);
});

test('multiplayer: create, join, answer, shared answers halve, final', async () => {
  const a = client(), b = client();
  await Promise.all([a.open(), b.open()]);
  a.send({ t: 'create', name: 'Ann', settings: { genre: 'geography', rounds: 5, seconds: 10 } });
  const joined = await a.until(m => m.t === 'joined');
  b.send({ t: 'join', code: joined.code, name: 'Ben' });
  await b.until(m => m.t === 'joined');
  await a.until(m => m.t === 'room' && m.players.length === 2);
  b.send({ t: 'start' }); // not host: ignored
  a.send({ t: 'start' });
  const r1 = await a.until(m => m.t === 'room' && m.phase === 'prompt');
  const p = promptById(r1.prompt.id);
  assert.equal(p.genre, 'geography');
  a.send({ t: 'answer', text: 'definitely not an answer' });
  assert.equal((await a.until(m => m.t === 'rejected')).reason, 'unknown');
  const top = p.tiers[0][0][0], rare = p.tiers[5][0][0];
  a.send({ t: 'answer', text: top });
  const mid = await b.until(m => m.t === 'room' && m.players.some(x => x.answered));
  assert.equal(mid.players.find(x => x.name === 'Ann').answer, null, 'answers hidden until reveal');
  b.send({ t: 'answer', text: top });
  const rev = await a.until(m => m.t === 'room' && m.phase === 'reveal');
  for (const pl of rev.players) { assert.equal(pl.answer.shared, true); assert.equal(pl.score, 5); } // 10 -> 5
  a.send({ t: 'next' });
  await a.until(m => m.t === 'room' && m.phase === 'prompt' && m.round === 1);
  // reconnect mid-game keeps the seat
  const tok = joined.token;
  a.ws.close();
  const a2 = client(); await a2.open();
  a2.send({ t: 'rejoin', code: joined.code, token: tok });
  const back = await a2.until(m => m.t === 'room');
  assert.equal(back.players.find(x => x.id === back.you).score, 5);
  const p2 = promptById(back.prompt.id);
  a2.send({ t: 'answer', text: p2.tiers[5][0][0] });
  b.send({ t: 'answer', text: p2.tiers[0][0][0] });
  const rev2 = await a2.until(m => m.t === 'room' && m.phase === 'reveal' && m.round === 1);
  assert.equal(rev2.players.find(x => x.name === 'Ann').score, 105);
  a2.ws.close(); b.ws.close();
});

test('multiplayer: misspelling asks, and is taken as meant when the clock runs out', async () => {
  const a = client(); await a.open();
  a.send({ t: 'create', name: 'Solo', settings: { genre: 'sports', rounds: 5, seconds: 5 } });
  await a.until(m => m.t === 'joined');
  a.send({ t: 'start' });
  const r = await a.until(m => m.t === 'room' && m.phase === 'prompt');
  const p = promptById(r.prompt.id);
  // a word whose swapped letters differ, and whose typo is not itself another answer
  const word = p.tiers.flat().map(x => x[0]).find(w => w.length >= 7 && !w.includes(' ') && w[2] !== w[3] && !judge(p, w.slice(0, 2) + w[3] + w[2] + w.slice(4)).ok);
  const typo = word.slice(0, 2) + word[3] + word[2] + word.slice(4); // swap two letters
  a.send({ t: 'answer', text: typo });
  const rej = await a.until(m => m.t === 'rejected');
  assert.equal(rej.reason, 'suggest');
  assert.equal(rej.suggest, word);
  a.send({ t: 'answer', text: typo, final: true });
  const got = await a.until(m => m.t === 'room' && m.players[0].answer);
  assert.equal(got.players[0].answer.answer, word);
  a.ws.close();
});

test('custom packs: refused without a key; a host can bring one into a room', async () => {
  const r = await fetch(BASE + '/api/pack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'cats' }) });
  assert.equal(r.status, 503);
  const words = Array.from({ length: 30 }, (_, i) => 'cat word ' + i);
  const pack = { id: 'feedcafe01', name: 'Cats', topic: 'cats', prompts: Array.from({ length: 5 }, (_, i) => ({ text: 'Name a cat thing ' + i, tiers: [words] })) };
  const a = client(); await a.open();
  a.send({ t: 'create', name: 'Host', settings: { rounds: 5, seconds: 10 } });
  await a.until(m => m.t === 'joined');
  a.send({ t: 'settings', settings: { genre: 'pack:feedcafe01' }, pack });
  const lob = await a.until(m => m.t === 'room' && m.settings.genre === 'pack:feedcafe01');
  assert.equal(lob.settings.genre, 'pack:feedcafe01');
  assert.equal((await (await fetch(BASE + '/api/pack/feedcafe01')).json()).pack.name, 'Cats');
  a.send({ t: 'start' });
  const pr = await a.until(m => m.t === 'room' && m.phase === 'prompt');
  assert.match(pr.prompt.text, /^Name a cat thing/);
  a.send({ t: 'answer', text: 'cat word 0' });
  const got = await a.until(m => m.t === 'room' && m.players[0].answer);
  assert.equal(got.players[0].answer.tier, 0);
  a.send({ t: 'settings', settings: { genre: 'pack:nothere99' }, pack: { prompts: [{ text: 'x', tiers: [] }] } }); // junk pack is ignored
  a.ws.close();
});

test('quick match pairs two strangers into one public room', async () => {
  const a = client(), b = client();
  await Promise.all([a.open(), b.open()]);
  a.send({ t: 'quick', name: 'A' });
  const ja = await a.until(m => m.t === 'joined');
  b.send({ t: 'quick', name: 'B' });
  const jb = await b.until(m => m.t === 'joined');
  assert.equal(ja.code, jb.code);
  const r = await a.until(m => m.t === 'room' && m.autoStartAt > 0);
  assert.ok(r.public);
  a.ws.close(); b.ws.close();
});
