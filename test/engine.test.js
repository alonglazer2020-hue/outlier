import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROMPTS, GENRES, judge, dailyPrompts, key, pickPrompts, TIERS, distanceKm, reached, fmtDistance, missionNumber } from '../public/engine.js';

const P = start => { const p = PROMPTS.find(x => x.text.startsWith(start)); assert.ok(p, 'no prompt ' + start); return p; };

test('banks parse into well-formed prompts', () => {
  assert.ok(GENRES.length >= 12);
  assert.ok(PROMPTS.length >= 130);
  assert.equal(new Set(PROMPTS.map(p => p.id)).size, PROMPTS.length, 'ids unique');
  for (const p of PROMPTS) {
    assert.equal(p.tiers.length, TIERS.length, `${p.id} "${p.text}" has ${p.tiers.length} tiers`);
    assert.ok(p.tiers.every(t => t.length), `${p.id} has an empty tier`);
    assert.equal(p.tiers[5].length, 1, `${p.id} must have exactly one True Oddity answer`);
    assert.ok(p.tiers.flat().length >= 15, `${p.id} has too few answers`);
    assert.ok(!p.tiers.flat().flat().some(a => /\?\s*no$|\bdup$/.test(a)), `${p.id} has an authoring note`);
  }
  const count = t => new Set(P(t).tiers.flat().map(a => a[0])).size;
  assert.equal(count('Name a chemical element'), 118);
  assert.equal(count('Name one of the 50 US states'), 50);
  assert.equal(count('Name one of the original 151'), 150); // both Nidoran share a name
  assert.equal(count('Name one of the 30 NBA'), 30);
});

test('judge: exact, alias, plural, case, accents, articles', () => {
  const dogs = P('Name a breed of dog');
  assert.equal(judge(dogs, 'Labrador').tier, 0);
  assert.equal(judge(dogs, 'lab').answer, 'labrador');
  assert.equal(judge(dogs, '  The Beagles ').answer, 'beagle');
  assert.equal(judge(P('Name a type of cheese'), 'Gruyère').answer, 'gruyere');
  assert.equal(judge(P('Name a vegetable'), 'Brussels sprout').answer, 'brussels sprouts');
});

test('judge: misspellings ask "did you mean", never silently accept', () => {
  const sport = P('Name a sport');
  assert.deepEqual(judge(sport, 'baskEtbell'), { ok: false, reason: 'suggest', suggest: 'basketball' });
  assert.equal(judge(sport, 'baksetball').suggest, 'basketball'); // swapped letters
  assert.equal(judge(P('Name a country'), 'Kazakstan').suggest, 'kazakhstan');
  assert.equal(judge(sport, 'basketball').ok, true); // confirming the suggestion
});

test('judge: extra words, surnames, several answers at once', () => {
  assert.equal(judge(P('Name one of the 30 NBA'), 'Los Angeles Lakers').answer, 'lakers');
  assert.equal(judge(P('Name a breed of dog'), 'a golden retriever puppy').answer, 'golden retriever');
  assert.equal(judge(P('Name a famous painter'), 'Warhol').answer, 'andy warhol');
  assert.equal(judge(P('Name a president'), 'Lincoln').answer, 'abraham lincoln');
  assert.equal(judge(P('Name a colour'), 'red blue green').reason, 'multiple');
});

test('judge: rejects unknown, empty and short nonsense', () => {
  const c = P('Name a colour');
  assert.equal(judge(c, 'dog').reason, 'unknown');
  assert.equal(judge(c, '   ').reason, 'empty');
  assert.equal(judge(c, 'xq').ok, false);
});

test('letter prompts only contain matching answers', () => {
  const lp = PROMPTS.filter(p => /starts with the letter/.test(p.text));
  assert.ok(lp.length >= 10);
  for (const p of lp) { const L = p.text.slice(-1).toLowerCase(); assert.ok(p.tiers.flat().every(a => a.every(x => x[0] === L)), p.id); }
});

test('daily: deterministic, 7 distinct prompts from different packs, no repeats in a cycle', () => {
  const a = dailyPrompts('2026-11-17'), b = dailyPrompts('2026-11-17'), c = dailyPrompts('2026-11-18');
  assert.deepEqual(a.map(p => p.id), b.map(p => p.id));
  assert.equal(a.length, 7);
  assert.equal(new Set(a.map(p => p.genre)).size, 7);
  assert.notDeepEqual(a.map(p => p.id), c.map(p => p.id));
  const per = Math.floor(PROMPTS.length / 7), seen = new Set();
  const d0 = Math.floor(Date.parse('2026-11-17') / 864e5), first = d0 - (d0 % per);
  for (let i = 0; i < per; i++) for (const p of dailyPrompts(new Date((first + i) * 864e5).toISOString().slice(0, 10))) {
    assert.ok(!seen.has(p.id), 'repeat ' + p.id); seen.add(p.id);
  }
  assert.equal(missionNumber('2026-11-17'), 17);
});

test('distance grows with points and names landmarks', () => {
  let last = -1;
  for (let pts = 0; pts <= 4000; pts += 5) { const d = distanceKm(pts); assert.ok(d >= last, 'monotonic at ' + pts); last = d; }
  assert.equal(reached(700).name, 'Voyager 1');
  assert.equal(reached(175).name, 'the Moon');
  assert.match(fmtDistance(distanceKm(170)), /384,400 km/);
});

test('pickPrompts respects pack and avoids recent', () => {
  const got = pickPrompts('music', 3, ['music-0', 'music-1']);
  assert.ok(got.every(p => p.genre === 'music' && p.id !== 'music-0' && p.id !== 'music-1'));
  assert.equal(key('Spider-Man'), key('spiderman'));
});

test('cleanPack: validates, dedupes, makes 6 tiers, rejects junk', async () => {
  const { cleanPack, addPack, pickPrompts, promptById, genreOf, PROMPTS: ALL } = await import('../public/engine.js');
  const answers = n => Array.from({ length: n }, (_, i) => 'answer ' + i);
  const good = { name: 'Test   Pack', prompts: Array.from({ length: 5 }, (_, i) => ({ text: `Name   thing ${i}`, tiers: [answers(10), ['Answer 0', 'Extra/alt name'], answers(30).slice(10)] })) };
  assert.equal(cleanPack(good, 'BAD ID'), null, 'bad id');
  assert.equal(cleanPack({ prompts: [] }, 'abcdef12'), null, 'empty');
  assert.equal(cleanPack({ prompts: good.prompts.slice(0, 3) }, 'abcdef12'), null, 'too few prompts');
  const p = cleanPack(good, 'abcdef12', 'my topic');
  assert.equal(p.name, 'Test Pack');
  assert.equal(p.prompts.length, 5);
  assert.equal(p.prompts[0].text, 'Name thing 0');
  assert.equal(p.prompts[0].tiers.length, 6);
  assert.equal(p.prompts[0].tiers[5].length, 1, 'one True Oddity answer; the other rare ones became Far Out');
  assert.ok(p.prompts[0].tiers.every(t => t.length));
  assert.equal(p.prompts[0].tiers.flat().length, 31, 'duplicate "Answer 0" dropped, extra kept');
  assert.ok(p.prompts[0].tiers.flat().some(a => a.join('/') === 'extra/alt name'), 'aliases kept');
  addPack(p);
  assert.equal(pickPrompts('pack:abcdef12', 3).every(q => q.genre === 'pack:abcdef12'), true);
  assert.equal(promptById('pack-abcdef12-2').text, 'Name thing 2');
  assert.equal(genreOf('pack:abcdef12').name, 'Test Pack');
  assert.ok(!ALL.some(q => q.genre.startsWith('pack:')), 'custom prompts never join the built-in list');
});
