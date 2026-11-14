// BASTION PROTOCOL — audio.js
// All sound is synthesised with WebAudio: no audio files, no network.
// One AudioContext, lazily created on the first user gesture; every
// effect is a short burst of filtered noise or an oscillator sweep.

let ctx = null;
let master = null;
let muted = false;

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}
export function isMuted() { return muted; }

function noiseBuffer(dur) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function burst({ dur, freq, q = 1, gain = 0.4, type = 'bandpass', at = 0, sweepTo = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const filt = ctx.createBiquadFilter();
  filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
  if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filt); filt.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

function tone({ freq, freqEnd = 0, dur, gain = 0.2, type = 'sine', at = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type; osc.frequency.setValueAtTime(freq, t);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.02);
}

// distance 0..1 scales the shot loudness (1 = point blank).
export function playShot(kind, dist = 0) {
  if (!ctx) return;
  const v = Math.max(0.12, 1 - dist * 0.75);
  if (kind === 'pistol') { burst({ dur: 0.09, freq: 1800, gain: 0.35 * v }); tone({ freq: 220, freqEnd: 60, dur: 0.08, gain: 0.2 * v, type: 'square' }); }
  else if (kind === 'smg') { burst({ dur: 0.07, freq: 2400, gain: 0.3 * v }); }
  else if (kind === 'rifle') { burst({ dur: 0.12, freq: 1400, gain: 0.42 * v }); tone({ freq: 160, freqEnd: 50, dur: 0.1, gain: 0.22 * v, type: 'square' }); }
  else if (kind === 'sniper') { burst({ dur: 0.22, freq: 900, sweepTo: 200, gain: 0.5 * v }); tone({ freq: 110, freqEnd: 40, dur: 0.2, gain: 0.25 * v, type: 'square' }); }
  else if (kind === 'shotgun') { burst({ dur: 0.16, freq: 800, sweepTo: 150, gain: 0.5 * v }); }
}

export function playDryClick() { tone({ freq: 1400, dur: 0.04, gain: 0.15, type: 'square' }); }
export function playReload() {
  tone({ freq: 900, dur: 0.05, gain: 0.15, type: 'square' });
  tone({ freq: 700, dur: 0.05, gain: 0.15, type: 'square', at: 0.28 });
  tone({ freq: 1100, dur: 0.05, gain: 0.18, type: 'square', at: 0.55 });
}
export function playStep(run) { burst({ dur: 0.05, freq: 300, gain: run ? 0.12 : 0.07, type: 'lowpass' }); }
export function playHit(head) { tone({ freq: head ? 1500 : 1050, dur: 0.06, gain: 0.22, type: 'sine' }); }
export function playHurt() { tone({ freq: 180, freqEnd: 90, dur: 0.18, gain: 0.25, type: 'sawtooth' }); }
export function playExplosion() {
  burst({ dur: 0.7, freq: 400, sweepTo: 60, gain: 0.6, type: 'lowpass' });
  burst({ dur: 0.25, freq: 2000, gain: 0.3 });
}
export function playFlash() { tone({ freq: 2400, freqEnd: 2400, dur: 0.35, gain: 0.12, type: 'sine' }); }
export function playBeep(final = false) { tone({ freq: final ? 1500 : 950, dur: 0.12, gain: 0.2, type: 'sine' }); }
export function playPlant() { tone({ freq: 800, dur: 0.1, gain: 0.2 }); tone({ freq: 800, dur: 0.1, gain: 0.2, at: 0.18 }); }
export function playRoundWin() {
  tone({ freq: 523, dur: 0.16, gain: 0.22 }); tone({ freq: 659, dur: 0.16, gain: 0.22, at: 0.15 });
  tone({ freq: 784, dur: 0.3, gain: 0.25, at: 0.3 });
}
export function playRoundLose() {
  tone({ freq: 392, dur: 0.18, gain: 0.2 }); tone({ freq: 330, dur: 0.18, gain: 0.2, at: 0.16 });
  tone({ freq: 262, dur: 0.34, gain: 0.22, at: 0.32 });
}
export function playBuy() { tone({ freq: 1200, dur: 0.07, gain: 0.18 }); tone({ freq: 1600, dur: 0.09, gain: 0.18, at: 0.07 }); }
export function playDeny() { tone({ freq: 220, dur: 0.12, gain: 0.18, type: 'square' }); }
