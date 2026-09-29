import { playExplosionSourced } from '../sfxAssets';
import { getCtx, getSfxOutput, getSfxVolume, noiseBuf } from '../sfxContext';

// ── Arena / Environmental Sounds ─────────────────────────
// Large-scale, spatially-routed effects: explosions from anywhere in the
// arena, round-outcome flourishes (victory/defeat), and streak-ceremony
// stingers that play during arena-wide moments.

// ── Victory Flourish ─────────────────────────────────────
// Short triumphant ascending arpeggio with harmonic shimmer
export function playVictory(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.14 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  master.connect(getSfxOutput(c));
  // Three-note ascending arpeggio (C5 → E5 → G5)
  const notes: number[] = [523, 659, 784];
  const spacing: number = 0.1;
  for (let i: number = 0; i < notes.length; i++) {
    const t: number = now + i * spacing;
    const osc: OscillatorNode = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(notes[i], t);
    const g: GainNode = c.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.setValueAtTime(0.7 - i * 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.3);
  }
  // Shimmer layer — high filtered noise for sparkle
  const shimBuf: AudioBuffer = noiseBuf(c, 0.6);
  const shim: AudioBufferSourceNode = c.createBufferSource();
  shim.buffer = shimBuf;
  const shimBP: BiquadFilterNode = c.createBiquadFilter();
  shimBP.type = 'bandpass';
  shimBP.frequency.setValueAtTime(4000, now);
  shimBP.frequency.exponentialRampToValueAtTime(8000, now + 0.4);
  shimBP.Q.value = 1;
  const shimG: GainNode = c.createGain();
  shimG.gain.setValueAtTime(0.001, now);
  shimG.gain.setValueAtTime(0.15, now + 0.15);
  shimG.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  shim.connect(shimBP);
  shimBP.connect(shimG);
  shimG.connect(master);
  shim.start(now);
}

// ── Defeat Sound ─────────────────────────────────────────
// Short descending tone — opposite of victory
export function playDefeat(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.10 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  master.connect(getSfxOutput(c));
  // Descending minor tone (E4 → C4)
  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(330, now);
  osc.frequency.exponentialRampToValueAtTime(200, now + 0.4);
  const g: GainNode = c.createGain();
  g.gain.setValueAtTime(0.7, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc.connect(g);
  g.connect(master);
  osc.start(now);
  osc.stop(now + 0.55);
  // Sub weight
  const sub: OscillatorNode = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, now);
  sub.frequency.exponentialRampToValueAtTime(40, now + 0.3);
  const sg: GainNode = c.createGain();
  sg.gain.setValueAtTime(0.4, now);
  sg.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  sub.connect(sg);
  sg.connect(master);
  sub.start(now);
  sub.stop(now + 0.45);
}

// ── Streak Sounds ─────────────────────────────────────────

export function playStreakTick(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.06 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  master.connect(getSfxOutput(c));
  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1000, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
  osc.connect(master);
  osc.start(now);
  osc.stop(now + 0.08);
}

export function playNewRecord(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.16 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
  master.connect(getSfxOutput(c));

  const notes: number[] = [523, 659, 784, 1047];
  const spacing: number = 0.12;
  for (let i: number = 0; i < notes.length; i++) {
    const t: number = now + i * spacing;
    const osc: OscillatorNode = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(notes[i], t);
    const g: GainNode = c.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.setValueAtTime(0.7 - i * 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  const shimBuf: AudioBuffer = noiseBuf(c, 0.6);
  const shim: AudioBufferSourceNode = c.createBufferSource();
  shim.buffer = shimBuf;
  const shimBP: BiquadFilterNode = c.createBiquadFilter();
  shimBP.type = 'bandpass';
  shimBP.frequency.setValueAtTime(3000, now);
  shimBP.frequency.exponentialRampToValueAtTime(10000, now + 0.6);
  shimBP.Q.value = 0.8;
  const shimG: GainNode = c.createGain();
  shimG.gain.setValueAtTime(0.001, now);
  shimG.gain.setValueAtTime(0.18, now + 0.2);
  shimG.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
  shim.connect(shimBP);
  shimBP.connect(shimG);
  shimG.connect(master);
  shim.start(now);

  const sub: OscillatorNode = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, now);
  sub.frequency.exponentialRampToValueAtTime(40, now + 0.2);
  const sg: GainNode = c.createGain();
  sg.gain.setValueAtTime(0.4, now);
  sg.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  sub.connect(sg);
  sg.connect(master);
  sub.start(now);
  sub.stop(now + 0.35);
}

export function playStreakLoss(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.08 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  master.connect(getSfxOutput(c));

  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(200, now + 0.6);
  const g: GainNode = c.createGain();
  g.gain.setValueAtTime(0.5, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  osc.connect(g);
  g.connect(master);
  osc.start(now);
  osc.stop(now + 0.75);

  const nBuf: AudioBuffer = noiseBuf(c, 0.6);
  const ns: AudioBufferSourceNode = c.createBufferSource();
  ns.buffer = nBuf;
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(3000, now);
  bp.frequency.exponentialRampToValueAtTime(200, now + 0.7);
  bp.Q.value = 1.5;
  const ng: GainNode = c.createGain();
  ng.gain.setValueAtTime(0.12, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  ns.connect(bp);
  bp.connect(ng);
  ng.connect(master);
  ns.start(now);
}

// ── Explosion / Demolition Sound ─────────────────────────
// Sub-bass impact + noise body (streamlined for performance)
export function playExplosion(dest?: AudioNode): void {
  playExplosionSourced(dest);
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;

  const master: GainNode = c.createGain();
  master.gain.value = getSfxVolume();
  master.connect(dest ?? getSfxOutput(c));

  // ── Sub impact: sine dropping from 80→25Hz
  const sub: OscillatorNode = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, now);
  sub.frequency.exponentialRampToValueAtTime(25, now + 0.8);
  const subGain: GainNode = c.createGain();
  subGain.gain.setValueAtTime(0.7, now);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
  sub.connect(subGain);
  subGain.connect(master);
  sub.start(now);
  sub.stop(now + 1.3);

  // ── Boom body: low-passed noise
  const boomSrc: AudioBufferSourceNode = c.createBufferSource();
  boomSrc.buffer = noiseBuf(c, 2.0);
  const boomLP: BiquadFilterNode = c.createBiquadFilter();
  boomLP.type = 'lowpass';
  boomLP.frequency.setValueAtTime(350, now);
  boomLP.frequency.exponentialRampToValueAtTime(40, now + 1.5);
  const boomGain: GainNode = c.createGain();
  boomGain.gain.setValueAtTime(0.5, now);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + 1.8);
  boomSrc.connect(boomLP);
  boomLP.connect(boomGain);
  boomGain.connect(master);
  boomSrc.start(now);
}
