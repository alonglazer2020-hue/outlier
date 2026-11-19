// Optional AI (Google Gemini, free key from aistudio.google.com/apikey). Off unless GEMINI_API_KEY is set.
//  - judge(): rules on answers that are not in a bank; every ruling is cached so the same answer always scores the same.
//  - makePack(): writes a whole custom pack from a topic.
import fs from 'node:fs';
import path from 'node:path';
import { key, TIERS } from './public/engine.js';

// Tried in order: Google retires and overloads models often, so a busy/retired/slow one falls through to the next.
const MODELS = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-flash-latest').split(',');

export function makeAiJudge({ apiKey = process.env.GEMINI_API_KEY, models = MODELS, file } = {}) {
  const model = models[0];
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.mkdir(path.dirname(file), { recursive: true }, () => fs.writeFile(file, JSON.stringify(cache), () => {})), 1000); };

  // One call to Gemini that must answer with JSON. Returns the parsed object, or null on any failure.
  let lastError = '';
  async function ask(text, opts = {}) {
    if (opts.use) return askOne(text, opts);
    for (const use of models) { const out = await askOne(text, { ...opts, use }); if (out !== null) return out; }
    return null;
  }
  async function askOne(text, { schema, timeout = 8000, use = model } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${use}:generateContent?key=${apiKey}`, {
        method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { temperature: schema ? 0.7 : 0, responseMimeType: 'application/json', ...(schema && { responseSchema: schema }) } }),
      });
      if (!res.ok) { lastError = `${res.status} ${(await res.text()).slice(0, 300)}`; console.error('gemini', lastError); return null; }
      const data = await res.json();
      return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || 'null');
    } catch (e) { lastError = `${e.name} ${e.message}`; console.error('gemini', lastError); return null; } finally { clearTimeout(t); }
  }

  // Diagnostics without exposing the key: which flash models the key can use, and how one tiny call goes.
  async function status(use = model) {
    let models = [];
    try { const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${apiKey}`); models = (await r.json()).models?.map(m => m.name.replace('models/', '')).filter(n => /flash/.test(n)) || []; } catch {}
    lastError = '';
    const t0 = Date.now();
    const out = await ask('Reply with JSON {"ok": true}', { use, timeout: 30000 });
    return { model: use, ok: out?.ok === true, ms: Date.now() - t0, error: lastError.replace(apiKey, '***'), models };
  }

  async function rule(p, text) {
    const common = p.tiers[0].map(a => a[0]).slice(0, 3).join(', ');
    const rare = p.tiers[5].map(a => a[0]).slice(0, 4).join(', ');
    const out = await ask(`You referee a party game. Players get a prompt and type one answer. Decide if the answer truly fits the prompt (real thing, correct category; small typos are fine).
Prompt: "${p.text}"
Player's answer: "${text}"
For calibration, the most common answers are: ${common}. Very rare but valid answers include: ${rare}.
Reply with JSON only: {"valid": true|false, "answer": "<the correct spelling of what they meant, lowercase>", "rarity": 2|3|4|5}
rarity: 2 = fairly well known, 3 = uncommon, 4 = rare, 5 = almost nobody would say it. If unsure it is real or correct, valid=false.`);
    if (!out) return null;
    if (out.valid !== true) return { ok: false, reason: 'unknown' };
    const tier = Math.min(5, Math.max(2, Math.round(Number(out.rarity) || 3)));
    const answer = String(out.answer || text).toLowerCase().slice(0, 60).trim() || text;
    return { ok: true, answer, tier, points: TIERS[tier].pts, ai: true };
  }

  const PACK_SCHEMA = {
    type: 'OBJECT', required: ['name', 'prompts'],
    properties: {
      name: { type: 'STRING' },
      prompts: { type: 'ARRAY', items: { type: 'OBJECT', required: ['text', 'tiers'], properties: {
        text: { type: 'STRING' },
        tiers: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } },
      } } },
    },
  };

  return {
    enabled: !!apiKey,
    status: use => (apiKey ? status(use) : { ok: false, error: 'no key' }),
    async judge(p, text) {
      if (!apiKey) return null;
      const k = p.id + '|' + key(text);
      if (cache[k]) return cache[k];
      const r = await rule(p, String(text).slice(0, 60));
      if (r) { cache[k] = r; save(); } // network failures are not cached
      return r;
    },
    // Raw pack JSON for a topic (the caller validates it with cleanPack), or null.
    async makePack(topic) {
      if (!apiKey) return null;
      return ask(`You write question packs for ODDITY, a party game where players must name the RAREST correct answer.
Topic: "${topic}"
Write 8 prompts about this topic. Rules:
- Each prompt is one full, clear sentence starting with "Name", e.g. "Name a character who appears in the Harry Potter books or films".
- Each prompt must be OPEN: at least 40 different correct answers exist. Never ask for one specific fact.
- Mix easy and harder prompts, all clearly about the topic.
- For each prompt give 40 to 80 correct answers, sorted into exactly 6 tiers by how many people would think of them:
  tier 1: the 2-4 answers almost everyone says first; tier 2: the obvious second thoughts; tiers 3-5: progressively less known; tier 6: true deep cuts that fans or experts know.
- Only real, verifiable answers. Lowercase. No duplicates. If an answer has a common alternative spelling or short name, write both joined with "/", e.g. "the boy who lived/harry potter".
- "name" is a short pack title (2-4 words).
If the topic is hateful, sexual or unsafe for a family party game, return {"name":"","prompts":[]}.`, { schema: PACK_SCHEMA, timeout: 40000 });
    },
  };
}
