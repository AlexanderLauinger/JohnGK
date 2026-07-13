// Web Audio sound effects — no audio files needed.
let ctx;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, type = 'sine', gain = 0.15) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export const sfx = {
  buzz: () => { tone(880, 0, 0.15, 'square', 0.12); tone(1320, 0.02, 0.12, 'square', 0.08); },
  correct: () => { tone(523, 0, 0.12); tone(659, 0.1, 0.12); tone(784, 0.2, 0.25); },
  wrong: () => { tone(220, 0, 0.25, 'sawtooth', 0.1); tone(185, 0.2, 0.35, 'sawtooth', 0.1); },
  select: () => tone(660, 0, 0.08, 'triangle', 0.1),
  dailyDouble: () => { [440, 554, 659, 880].forEach((f, i) => tone(f, i * 0.12, 0.2, 'triangle', 0.12)); },
  timeUp: () => { tone(392, 0, 0.15); tone(392, 0.2, 0.15); tone(311, 0.4, 0.4); },
  armed: () => tone(1200, 0, 0.06, 'sine', 0.08),
  tick: () => tone(1000, 0, 0.03, 'sine', 0.04),
  final: () => { [523, 494, 523, 392].forEach((f, i) => tone(f, i * 0.3, 0.28, 'sine', 0.1)); }
};
