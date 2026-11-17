// Shared game rules: used by the browser and by the server (which re-scores everything it records).
import { PROMPTS, GENRES } from './banks.js';
export { PROMPTS, GENRES };

export const TIERS = [
  { name: 'Herd', pts: 5 },
  { name: 'Common', pts: 15 },
  { name: 'Uncommon', pts: 30 },
  { name: 'Rare', pts: 55 },
  { name: 'Fringe', pts: 80 },
  { name: 'Outlier', pts: 100 },
];
export const DAILY_COUNT = 7;
export const DAILY_SECONDS = 30;
export const LAUNCH = '2026-11-17';

export const genreOf = id => GENRES.find(g => g.id === id) || GENRES[0];
export const promptById = id => PROMPTS.find(p => p.id === id);

// Normalised text as a player would mean it: accents, case, punctuation and leading articles ignored.
export function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^(the|a|an) /, '');
}
// Comparison key: singularise each word, then drop spaces ("Brussels Sprouts" == "brussel sprout" == "brusselsprouts").
export function key(s) {
  return norm(s).split(' ').map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join('');
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

function index(p) {
  if (p._idx) return p._idx;
  const map = new Map(), surnames = new Map();
  p.tiers.forEach((group, tier) => group.forEach(aliases => {
    const entry = { answer: aliases[0], tier };
    for (const a of aliases) {
      const k = key(a);
      if (k && !map.has(k)) map.set(k, entry);
      const words = norm(a).split(' ');
      if (p.people && words.length > 1) {
        const last = key(words[words.length - 1]);
        if (last.length >= 4) surnames.set(last, surnames.has(last) && surnames.get(last) !== entry ? null : entry);
      }
    }
  }));
  for (const [k, e] of surnames) if (e && !map.has(k)) map.set(k, e); // ambiguous surnames (two Roosevelts) stay out
  return (p._idx = map);
}

// Judge one typed answer. Returns {ok, answer, tier, points} or {ok:false, reason}.
export function judge(p, input) {
  const raw = String(input || '').slice(0, 80);
  if (!norm(raw)) return { ok: false, reason: 'empty' };
  const map = index(p);
  const hit = e => ({ ok: true, answer: e.answer, tier: e.tier, points: TIERS[e.tier].pts });
  const words = norm(raw).split(' ');
  // Exact, then without leading words ("los angeles lakers" -> "lakers").
  for (let i = 0; i < words.length; i++) {
    const e = map.get(key(words.slice(i).join(' ')));
    if (e) return hit(e);
  }
  // Typo tolerance scales with length; very short answers must be exact.
  const k = key(raw);
  const max = k.length >= 9 ? 2 : k.length >= 5 ? 1 : 0;
  if (max) {
    let best = null, bestD = max + 1;
    for (const [mk, e] of map) {
      const d = lev(k, mk, max);
      if (d < bestD) { best = e; bestD = d; }
    }
    if (best) return hit(best);
  }
  return { ok: false, reason: 'unknown' };
}

// A few rarer answers than the one given, to show what was out there.
export function rarer(p, tier, n = 3, rand = Math.random) {
  const pool = p.tiers.slice(tier + 1).flat().map(a => a[0]);
  const out = [];
  while (pool.length && out.length < n) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

export function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Daily is one UTC day for the whole world.
export const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);
export const dayNumber = k => Math.round((Date.parse(k) - Date.parse(LAUNCH)) / 864e5) + 1;
export function msToNextDay(now = Date.now()) { const d = new Date(now); d.setUTCHours(24, 0, 0, 0); return d - now; }

// Each "cycle" is one shuffle of every prompt; consecutive days take the next 7, so nothing repeats within a cycle.
export function dailyPrompts(k) {
  const perCycle = Math.floor(PROMPTS.length / DAILY_COUNT);
  const d = Math.floor(Date.parse(k) / 864e5);
  const order = shuffle(PROMPTS.map(p => p.id).sort(), rng('outlier-cycle-' + Math.floor(d / perCycle)));
  const start = (d % perCycle) * DAILY_COUNT;
  return order.slice(start, start + DAILY_COUNT).map(promptById);
}

export function pickPrompts(genre, n, avoid = [], rand = Math.random) {
  const pool = PROMPTS.filter(p => genre === 'mixed' || p.genre === genre);
  const fresh = pool.filter(p => !avoid.includes(p.id));
  const picked = shuffle(fresh.length >= n ? fresh : pool, rand).slice(0, n);
  while (picked.length < n) picked.push(pool[Math.floor(rand() * pool.length)]);
  return picked;
}

export const sigma = pts => (pts / 100).toFixed(2);
