// Shared game rules: used by the browser and by the server (which re-scores everything it records).
import { PROMPTS, GENRES, sixTiers } from './banks.js';
export { PROMPTS, GENRES };

export const TIERS = [
  { name: 'Ground Control', pts: 10, blurb: 'Everyone said this one.' },
  { name: 'Copycat', pts: 15, blurb: 'Felt clever. So did everyone else.' },
  { name: 'Low Orbit', pts: 30, blurb: 'Off the ground.' },
  { name: 'Deep Space', pts: 60, blurb: 'Not many went this far.' },
  { name: 'Far Out', pts: 85, blurb: 'Hardly anyone thinks of that.' },
  { name: 'True Oddity', pts: 100, blurb: 'One of a kind.' },
];
export const DAILY_COUNT = 7;
export const DAILY_SECONDS = 25;
export const LAUNCH = '2026-11-01';

// Points -> how far the rocket has flown. km values are real distances from Earth.
export const LANDMARKS = [
  { pts: 0, name: 'Launch pad', km: 0 },
  { pts: 25, name: 'the clouds', km: 12 },
  { pts: 55, name: 'the edge of space', km: 100 },
  { pts: 85, name: 'the Space Station', km: 408 },
  { pts: 125, name: 'the GPS satellites', km: 20200 },
  { pts: 170, name: 'the Moon', km: 384400 },
  { pts: 240, name: 'Mars', km: 2.25e8 },
  { pts: 300, name: 'the asteroid belt', km: 4.1e8 },
  { pts: 370, name: 'Jupiter', km: 7.8e8 },
  { pts: 440, name: 'Saturn', km: 1.43e9 },
  { pts: 510, name: 'Uranus', km: 2.87e9 },
  { pts: 580, name: 'Neptune', km: 4.5e9 },
  { pts: 640, name: 'Pluto', km: 5.9e9 },
  { pts: 700, name: 'Voyager 1', km: 2.5e10 },
  { pts: 850, name: 'the Oort Cloud', km: 1.5e12 },
  { pts: 1050, name: 'Proxima Centauri', km: 4.0e13 },
  { pts: 1400, name: 'the Pleiades', km: 4.2e15 },
  { pts: 1900, name: 'the centre of the Milky Way', km: 2.5e17 },
  { pts: 2600, name: 'Andromeda', km: 2.4e19 },
  { pts: 4000, name: 'the edge of the observable universe', km: 4.4e23 },
];
export function reached(pts) {
  let i = 0;
  while (i + 1 < LANDMARKS.length && LANDMARKS[i + 1].pts <= pts) i++;
  return LANDMARKS[i];
}
export function distanceKm(pts) {
  const i = LANDMARKS.indexOf(reached(pts)), a = LANDMARKS[i], b = LANDMARKS[i + 1];
  if (!b) return a.km;
  const t = (pts - a.pts) / (b.pts - a.pts), lo = Math.max(a.km, 1);
  return a.km === 0 ? b.km * t * t : lo * Math.pow(b.km / lo, t);
}
export function fmtDistance(km) {
  const ly = km / 9.461e12;
  if (ly >= 1e9) return `${(ly / 1e9).toFixed(1)} billion light-years`;
  if (ly >= 1e6) return `${(ly / 1e6).toFixed(1)} million light-years`;
  if (ly >= 1) return `${ly >= 100 ? Math.round(ly).toLocaleString('en') : ly.toFixed(1)} light-years`;
  if (km >= 1e9) return `${(km / 1e9).toFixed(1)} billion km`;
  if (km >= 1e6) return `${(km / 1e6).toFixed(1)} million km`;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${(km < 10 ? Math.round(km * 10) / 10 : Math.round(km)).toLocaleString('en')} km`;
}

// Custom packs (made by the AI on request) live apart from PROMPTS so they never reach the daily or "Everything".
export const CUSTOM = new Map(); // pack id -> { id, name, topic, prompts }
export const addPack = pack => (CUSTOM.set(pack.id, pack), pack);
const PACK_COLOR = '#ffd84a';
export const genreOf = id => {
  if (String(id).startsWith('pack:')) { const p = CUSTOM.get(id.slice(5)); return { id, name: p ? p.name : 'Custom pack', color: PACK_COLOR }; }
  return GENRES.find(g => g.id === id) || GENRES[0];
};
export const promptById = id => PROMPTS.find(p => p.id === id) || [...CUSTOM.values()].flatMap(p => p.prompts).find(p => p.id === id);

// Turns untrusted pack JSON (from the AI, or a browser restoring a saved pack) into playable prompts, or null.
export function cleanPack(raw, id, topic = '') {
  if (!/^[a-z0-9]{6,16}$/.test(String(id)) || !raw || !Array.isArray(raw.prompts)) return null;
  const prompts = raw.prompts.slice(0, 10).map((q, n) => {
    const text = String(q?.text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const seen = new Set();
    const groups = (Array.isArray(q?.tiers) ? q.tiers : []).slice(0, 8).map(g => (Array.isArray(g) ? g : []).slice(0, 80).map(a => {
      const aliases = String(a).toLowerCase().replace(/[|,]/g, ' ').split('/').map(s => s.replace(/\s+/g, ' ').trim().slice(0, 60)).filter(s => key(s));
      return aliases.length && !seen.has(key(aliases[0])) ? (seen.add(key(aliases[0])), aliases) : null;
    }).filter(Boolean)).filter(g => g.length);
    return { id: `pack-${id}-${n}`, genre: 'pack:' + id, text, people: false, tiers: groups };
  }).filter(q => q.text && q.tiers.flat().length >= 15).map(q => (sixTiers(q.tiers), q));
  if (prompts.length < 4) return null;
  return { id, name: String(raw.name || topic || 'Custom pack').replace(/\s+/g, ' ').trim().slice(0, 40), topic: String(topic || raw.topic || '').slice(0, 80), prompts };
}

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
  let pp = null, prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // swapped neighbours ("baskteball") count as one slip
      if (pp && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    pp = prev; prev = cur;
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

const hit = e => ({ ok: true, answer: e.answer, tier: e.tier, points: TIERS[e.tier].pts });

// Closest bank answer within a typo budget that grows with length, or null.
export function closest(p, raw) {
  const k = key(raw);
  const max = k.length >= 10 ? 3 : k.length >= 6 ? 2 : k.length >= 4 ? 1 : 0;
  if (!max) return null;
  let best = null, bestD = max + 1;
  for (const [mk, e] of index(p)) {
    const d = lev(k, mk, max);
    if (d < bestD || (d === bestD && best && e.tier < best.tier)) { best = e; bestD = d; }
  }
  return best;
}

// Judge one typed answer.
//   {ok:true, answer, tier, points}          accepted
//   {ok:false, reason:'suggest', suggest}    a close spelling exists: ask "Did you mean ...?"
//   {ok:false, reason:'multiple'|'unknown'|'empty'}
export function judge(p, input) {
  const raw = String(input || '').slice(0, 80);
  const words = norm(raw).split(' ').filter(Boolean);
  if (!words.length) return { ok: false, reason: 'empty' };
  const map = index(p);
  const whole = map.get(key(raw));
  if (whole) return hit(whole);
  // Several separate answers typed at once ("red blue green") are refused, not a lucky dip.
  const singles = new Set(words.map(w => map.get(key(w))).filter(Boolean));
  if (singles.size > 1) return { ok: false, reason: 'multiple' };
  // Extra words around a real answer: "los angeles lakers", "a golden retriever puppy".
  for (let len = words.length - 1; len >= 1; len--)
    for (let i = 0; i + len <= words.length; i++) {
      const e = map.get(key(words.slice(i, i + len).join(' ')));
      if (e && (i > 0 || len >= Math.ceil(words.length / 2))) return hit(e);
    }
  const near = closest(p, raw);
  if (near) return { ok: false, reason: 'suggest', suggest: near.answer };
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
export const missionNumber = k => Math.round((Date.parse(k) - Date.parse(LAUNCH)) / 864e5) + 1;
export const dateOfMission = n => new Date(Date.parse(LAUNCH) + (n - 1) * 864e5).toISOString().slice(0, 10);
export function msToNextDay(now = Date.now()) { const d = new Date(now); d.setUTCHours(24, 0, 0, 0); return d - now; }

// Each cycle is one shuffle of every prompt; days take the next 7 in turn, never more than one letter prompt and
// never two from the same pack, so nothing repeats within a cycle and every mission feels mixed.
export function dailyPrompts(k) {
  const perCycle = Math.floor(PROMPTS.length / DAILY_COUNT);
  const d = Math.floor(Date.parse(k) / 864e5);
  const cycle = Math.floor(d / perCycle);
  const order = shuffle(PROMPTS.map(p => p.id).sort(), rng('oddity-cycle-' + cycle)).map(promptById);
  // deal the cycle into days greedily so each day is varied
  const days = Array.from({ length: perCycle }, () => []);
  for (const p of order) {
    const day = days.find(ds => ds.length < DAILY_COUNT && !ds.some(q => q.genre === p.genre)) || days.find(ds => ds.length < DAILY_COUNT);
    if (day) day.push(p);
  }
  return days[d % perCycle];
}

export function pickPrompts(genre, n, avoid = [], rand = Math.random) {
  const pool = String(genre).startsWith('pack:') ? CUSTOM.get(genre.slice(5))?.prompts || [] : PROMPTS.filter(p => genre === 'mixed' || p.genre === genre);
  if (!pool.length) return [];
  const fresh = pool.filter(p => !avoid.includes(p.id));
  const picked = shuffle(fresh.length >= n ? fresh : pool, rand).slice(0, n);
  while (picked.length < n) picked.push(pool[Math.floor(rand() * pool.length)]);
  return picked;
}
