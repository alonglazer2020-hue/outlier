// Tiny synthesized sound effects (no audio files). Created on first use, which is always a tap or key press.
let ac = null;
let muted = (() => { try { return localStorage.getItem('oddity:muted') === '1'; } catch { return false; } })();
const ctx = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());

function tone(freq, start, dur, type = 'square', vol = 0.06) {
  const c = ctx(), o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(vol, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination); o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.02);
}
function noise(dur, vol = 0.08) {
  const c = ctx(), n = c.createBufferSource(), b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, c.currentTime); f.frequency.exponentialRampToValueAtTime(140, c.currentTime + dur);
  const g = c.createGain(); g.gain.value = vol;
  n.buffer = b; n.connect(f).connect(g).connect(c.destination); n.start();
}
const play = fn => { if (muted) return; try { fn(); } catch {} };

export const sfx = {
  get muted() { return muted; },
  toggle() { muted = !muted; try { localStorage.setItem('oddity:muted', muted ? '1' : '0'); } catch {} return muted; },
  accept: tier => play(() => { const notes = [392, 494, 587, 698, 880, 1047]; for (let i = 0; i <= tier; i++) tone(notes[i], i * 0.07, 0.14); noise(0.5 + tier * 0.15, 0.05); }),
  reject: () => play(() => { tone(150, 0, 0.12, 'sawtooth', 0.05); tone(110, 0.1, 0.18, 'sawtooth', 0.05); }),
  ask: () => play(() => { tone(523, 0, 0.09, 'triangle', 0.08); tone(784, 0.09, 0.14, 'triangle', 0.08); }),
  tick: () => play(() => tone(1200, 0, 0.04, 'square', 0.03)),
  launch: () => play(() => noise(1.4, 0.1)),
  pass: () => play(() => { tone(880, 0, 0.08, 'triangle', 0.06); tone(1319, 0.08, 0.2, 'triangle', 0.06); }),
};
