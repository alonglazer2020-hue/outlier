// Optional AI judge for answers that are not in the bank. Off unless GEMINI_API_KEY is set (free key from aistudio.google.com).
// Every ruling is cached so the same answer always gets the same verdict.
import fs from 'node:fs';
import path from 'node:path';
import { key, TIERS } from './public/engine.js';

export function makeAiJudge({ apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || 'gemini-2.5-flash', file } = {}) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.mkdir(path.dirname(file), { recursive: true }, () => fs.writeFile(file, JSON.stringify(cache), () => {})), 1000); };

  async function ask(p, text) {
    const common = p.tiers[0].map(a => a[0]).slice(0, 3).join(', ');
    const rare = p.tiers[5].map(a => a[0]).slice(0, 4).join(', ');
    const instructions = `You referee a party game. Players get a prompt and type one answer. Decide if the answer truly fits the prompt (real thing, correct category; small typos are fine).
Prompt: "${p.text}"
Player's answer: "${text}"
For calibration, the most common answers are: ${common}. Very rare but valid answers include: ${rare}.
Reply with JSON only: {"valid": true|false, "answer": "<the correct spelling of what they meant, lowercase>", "rarity": 2|3|4|5}
rarity: 2 = fairly well known, 3 = uncommon, 4 = rare, 5 = almost nobody would say it. If unsure it is real or correct, valid=false.`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: instructions }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const out = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
      if (out.valid !== true) return { ok: false, reason: 'unknown' };
      const tier = Math.min(5, Math.max(2, Math.round(Number(out.rarity) || 3)));
      const answer = String(out.answer || text).toLowerCase().slice(0, 60).trim() || text;
      return { ok: true, answer, tier, points: TIERS[tier].pts, ai: true };
    } catch { return null; } finally { clearTimeout(t); }
  }

  return {
    enabled: !!apiKey,
    async judge(p, text) {
      if (!apiKey) return null;
      const k = p.id + '|' + key(text);
      if (cache[k]) return cache[k];
      const r = await ask(p, String(text).slice(0, 60));
      if (r) { cache[k] = r; save(); } // network failures are not cached
      return r;
    },
  };
}
