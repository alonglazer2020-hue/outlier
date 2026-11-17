import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, GENRES, judge, dailyPrompts, key, pickPrompts, TIERS } from '../public/engine.js';

const P = text => PROMPTS.find(p => p.text === text);

test('banks parse into well-formed prompts', () => {
  assert.ok(GENRES.length >= 10);
  for (const p of PROMPTS) {
    assert.equal(p.tiers.length, TIERS.length, `${p.id} "${p.text}" has ${p.tiers.length} tiers`);
    assert.ok(p.tiers.every(t => t.length), `${p.id} has an empty tier`);
    assert.ok(p.tiers.flat().length >= 15, `${p.id} has too few answers`);
  }
  const count = t => new Set(P(t).tiers.flat().map(a => a[0])).size;
  assert.equal(count('Name a chemical element'), 118);
  assert.equal(count('Name a US state'), 50);
  assert.equal(count('Name a first-generation (Kanto) Pokemon'), 150); // both Nidoran share a name

  assert.equal(count('Name an NBA team'), 30);
});

test('judge: exact, alias, plural, case, accents, articles', () => {
  const dogs = P('Name a dog breed');
  assert.equal(judge(dogs, 'Labrador').tier, 0);
  assert.equal(judge(dogs, 'lab').answer, 'labrador');
  assert.equal(judge(dogs, '  The Beagles ').answer, 'beagle');
  assert.equal(judge(P('Name a cheese'), 'Gruyère').answer, 'gruyere');
  assert.equal(judge(P('Name a vegetable'), 'Brussel sprout').answer, 'brussels sprouts');
});

test('judge: typos, leading words, surnames', () => {
  assert.equal(judge(P('Name a country'), 'Kazakstan').answer, 'kazakhstan');
  assert.equal(judge(P('Name an NBA team'), 'Los Angeles Lakers').answer, 'lakers');
  assert.equal(judge(P('~Name a famous painter'.slice(1)), 'Warhol').answer, 'andy warhol');
  assert.equal(judge(P('Name a US president'), 'Lincoln').answer, 'abraham lincoln');
  assert.equal(judge(P('Name a famous explorer'), 'Shackleton').tier, 2);
});

test('judge: rejects unknown, empty and short near-misses', () => {
  const c = P('Name a colour');
  assert.deepEqual(judge(c, 'dog'), { ok: false, reason: 'unknown' });
  assert.deepEqual(judge(c, '   '), { ok: false, reason: 'empty' });
  assert.equal(judge(c, 'rad').ok, false);
});

test('daily is deterministic, 7 distinct prompts, and changes day to day', () => {
  const a = dailyPrompts('2026-11-17'), b = dailyPrompts('2026-11-17'), c = dailyPrompts('2026-11-18');
  assert.deepEqual(a.map(p => p.id), b.map(p => p.id));
  assert.equal(new Set(a.map(p => p.id)).size, 7);
  assert.notDeepEqual(a.map(p => p.id), c.map(p => p.id));
  // no repeats inside one cycle
  const per = Math.floor(PROMPTS.length / 7), seen = new Set();
  const d0 = Math.floor(Date.parse('2026-11-17') / 864e5), first = d0 - (d0 % per);
  for (let i = 0; i < per; i++) for (const p of dailyPrompts(new Date((first + i) * 864e5).toISOString().slice(0, 10))) {
    assert.ok(!seen.has(p.id), 'repeat ' + p.id); seen.add(p.id);
  }
});

test('pickPrompts respects genre and avoids recent', () => {
  const got = pickPrompts('music', 3, ['music-0', 'music-1']);
  assert.ok(got.every(p => p.genre === 'music' && p.id !== 'music-0' && p.id !== 'music-1'));
  assert.equal(key('Spider-Man'), key('spiderman'));
});
