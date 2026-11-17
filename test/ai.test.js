import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { makeAiJudge } from '../ai.js';
import { PROMPTS } from '../public/engine.js';

const p = PROMPTS.find(x => x.text.startsWith('Name a bird'));
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oddity-ai-')), 'cache.json');
const reply = obj => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });

test('AI judge is off without a key', async () => {
  const ai = makeAiJudge({ apiKey: '', file });
  assert.equal(ai.enabled, false);
  assert.equal(await ai.judge(p, 'anything'), null);
});

test('AI judge accepts, clamps rarity, caches, and refuses invalid', async () => {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push(JSON.parse(opts.body).contents[0].parts[0].text); return calls.length === 1 ? reply({ valid: true, answer: 'Rufous Hornero', rarity: 9 }) : reply({ valid: false }); };
  try {
    const ai = makeAiJudge({ apiKey: 'test', file });
    const a = await ai.judge(p, 'rufous hornero');
    assert.deepEqual(a, { ok: true, answer: 'rufous hornero', tier: 5, points: 100, ai: true });
    assert.deepEqual(await ai.judge(p, 'Rufous  Hornero'), a, 'same key served from cache');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /Name a bird/);
    assert.deepEqual(await ai.judge(p, 'toaster'), { ok: false, reason: 'unknown' });
  } finally { globalThis.fetch = real; }
});
