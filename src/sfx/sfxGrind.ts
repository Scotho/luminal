import { warnDev } from '../swallow';
import { getCtx, getSfxOutput, getSfxVolume, noiseBuf } from '../sfxContext';
import { scheduleDisconnect } from './sfxShared';

// ── Trail Grind Sounds ───────────────────────────────────
// Player-feedback suite for the grind system (enter, loop, bail, exit, hop,
// landing, alert). Split out from sfxPlayer to keep category files <500 LOC.

interface GrindLoopNodes {
  noise: AudioBufferSourceNode;
  bp: BiquadFilterNode;
  gain: GainNode;
  hum: OscillatorNode;
  humGain: GainNode;
}

let _grindLoopNodes: GrindLoopNodes | null = null;

/** Metallic clank: noise burst through bandpass ~2kHz + low sine thud at 80Hz */
export function playGrindEnter(): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;

  // Noise burst through bandpass ~2kHz
  const nSrc: AudioBufferSourceNode = c.createBufferSource();
  nSrc.buffer = noiseBuf(c, 0.15);
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2000, now);
  bp.Q.value = 3;
  const ng: GainNode = c.createGain();
  ng.gain.setValueAtTime(0.18 * vol, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  nSrc.connect(bp);
  bp.connect(ng);
  ng.connect(getSfxOutput(c));
  nSrc.start(now);
  scheduleDisconnect([nSrc, bp, ng], 200);

  // Low sine thud at 80Hz
  const thud: OscillatorNode = c.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(80, now);
  thud.frequency.exponentialRampToValueAtTime(40, now + 0.12);
  const tg: GainNode = c.createGain();
  tg.gain.setValueAtTime(0.22 * vol, now);
  tg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  thud.connect(tg);
  tg.connect(getSfxOutput(c));
  thud.start(now);
  thud.stop(now + 0.2);
  scheduleDisconnect([tg], 250);
}

/** Continuous loop: bandpass noise 1–3kHz + sawtooth hum at 120Hz */
export function startGrindLoop(): void {
  if (_grindLoopNodes) return;
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const out: AudioNode = getSfxOutput(c);

  // Looping noise through bandpass
  const noise: AudioBufferSourceNode = c.createBufferSource();
  noise.buffer = noiseBuf(c, 2.0);
  noise.loop = true;
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2000;
  bp.Q.value = 1.5;
  const gain: GainNode = c.createGain();
  gain.gain.value = 0.12 * vol;
  noise.connect(bp);
  bp.connect(gain);
  gain.connect(out);
  noise.start();

  // Sawtooth hum at 120Hz
  const hum: OscillatorNode = c.createOscillator();
  hum.type = 'sawtooth';
  hum.frequency.value = 120;
  const humGain: GainNode = c.createGain();
  humGain.gain.value = 0.06 * vol;
  hum.connect(humGain);
  humGain.connect(out);
  hum.start();

  _grindLoopNodes = { noise, bp, gain, hum, humGain };
}

/**
 * Update grind loop parameters each frame.
 * @param speed      0–2 speed factor
 * @param balance    -1..1 balance (|balance|>0.7 = danger zone)
 * @param dashing    true when player is dashing
 */
export function updateGrindLoop(speed: number, balance: number, dashing: boolean): void {
  if (!_grindLoopNodes) return;
  const n: GrindLoopNodes = _grindLoopNodes;
  const vol: number = getSfxVolume();
  const t: number = 0.05; // smoothing factor

  // Pitch rises with speed: bandpass 1kHz–3kHz
  const targetFreq: number = 1000 + speed * 1000;
  n.bp.frequency.value += (targetFreq - n.bp.frequency.value) * t;

  // Volume wobble in danger zone (|balance| > 0.7)
  const danger: number = Math.max(0, (Math.abs(balance) - 0.7) / 0.3);
  const wobble: number = danger > 0 ? 1 + 0.3 * Math.sin(Date.now() * 0.015) * danger : 1;
  const targetGain: number = 0.09 * vol * wobble;
  n.gain.gain.value += (targetGain - n.gain.gain.value) * t;

  // Hum: detunes in danger, boosts in dash
  const baseHumFreq: number = 120 + speed * 40;
  const dangerDetune: number = danger * 20 * Math.sin(Date.now() * 0.008);
  const dashFreqBoost: number = dashing ? 60 : 0;
  const targetHumFreq: number = baseHumFreq + dangerDetune + dashFreqBoost;
  n.hum.frequency.value += (targetHumFreq - n.hum.frequency.value) * t;

  const dashVolBoost: number = dashing ? 1.6 : 1.0;
  const targetHumGain: number = 0.05 * vol * dashVolBoost * (1 + speed * 0.3);
  n.humGain.gain.value += (targetHumGain - n.humGain.gain.value) * t;
}

/** Fade out and stop the grind loop */
export function stopGrindLoop(): void {
  if (!_grindLoopNodes) return;
  const n: GrindLoopNodes = _grindLoopNodes;
  _grindLoopNodes = null;

  try {
    const c: AudioContext = getCtx();
    if (c) {
      const now: number = c.currentTime;
      n.gain.gain.setValueAtTime(n.gain.gain.value, now);
      n.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      n.humGain.gain.setValueAtTime(n.humGain.gain.value, now);
      n.humGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      setTimeout(() => {
        try { n.noise.stop(); } catch { /* expected: noise source already stopped */ }
        try { n.hum.stop(); } catch { /* expected: hum oscillator already stopped */ }
        try {
          n.noise.disconnect();
          n.bp.disconnect();
          n.gain.disconnect();
          n.hum.disconnect();
          n.humGain.disconnect();
        } catch { /* expected: nodes already disconnected by teardown */ }
      }, 150);
    }
  } catch (e) { warnDev('sfx', e); }
}

/** Harsh bail: lowpass noise burst + detuned oscillator drop 300Hz→80Hz */
export function playGrindBail(): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;

  // Lowpass noise burst
  const nSrc: AudioBufferSourceNode = c.createBufferSource();
  nSrc.buffer = noiseBuf(c, 0.4);
  const lp: BiquadFilterNode = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(800, now);
  lp.frequency.exponentialRampToValueAtTime(100, now + 0.35);
  const ng: GainNode = c.createGain();
  ng.gain.setValueAtTime(0.2 * vol, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  nSrc.connect(lp);
  lp.connect(ng);
  ng.connect(getSfxOutput(c));
  nSrc.start(now);
  scheduleDisconnect([nSrc, lp, ng], 450);

  // Detuned oscillator drop 300Hz → 80Hz
  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + 0.3);
  const og: GainNode = c.createGain();
  og.gain.setValueAtTime(0.15 * vol, now);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  osc.connect(og);
  og.connect(getSfxOutput(c));
  osc.start(now);
  osc.stop(now + 0.38);
  scheduleDisconnect([og], 450);
}

/** Satisfying exit: upward pitch sweep 600Hz → 1200Hz */
export function playGrindExit(): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;

  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.18);
  const gain: GainNode = c.createGain();
  gain.gain.setValueAtTime(0.14 * vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
  osc.connect(gain);
  gain.connect(getSfxOutput(c));
  osc.start(now);
  osc.stop(now + 0.25);
  scheduleDisconnect([gain], 300);
}

/** Quick metallic tick at 1800Hz */
export function playGrindHop(): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;

  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1800, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.04);
  const gain: GainNode = c.createGain();
  gain.gain.setValueAtTime(0.10 * vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
  osc.connect(gain);
  gain.connect(getSfxOutput(c));
  osc.start(now);
  osc.stop(now + 0.08);
  scheduleDisconnect([gain], 120);
}

/** Soft thud: lowpass noise at 200Hz, fast decay */
export function playGrindLanding(): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;

  const nSrc: AudioBufferSourceNode = c.createBufferSource();
  nSrc.buffer = noiseBuf(c, 0.15);
  const lp: BiquadFilterNode = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(200, now);
  const ng: GainNode = c.createGain();
  ng.gain.setValueAtTime(0.16 * vol, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  nSrc.connect(lp);
  lp.connect(ng);
  ng.connect(getSfxOutput(c));
  nSrc.start(now);
  scheduleDisconnect([nSrc, lp, ng], 200);
}

/** Alert cue: bandpass noise at 3kHz, short */
export function playTrailGrindedAlert(): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;

  const nSrc: AudioBufferSourceNode = c.createBufferSource();
  nSrc.buffer = noiseBuf(c, 0.12);
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(3000, now);
  bp.Q.value = 2.5;
  const ng: GainNode = c.createGain();
  ng.gain.setValueAtTime(0.13 * vol, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
  nSrc.connect(bp);
  bp.connect(ng);
  ng.connect(getSfxOutput(c));
  nSrc.start(now);
  scheduleDisconnect([nSrc, bp, ng], 180);
}

/** Sweet-spot lock-in: ascending sine sweep 400→800Hz over 80ms. (SPEC-82) */
export function playGrindSweetLockIn(): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;
  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
  const gain: GainNode = c.createGain();
  gain.gain.setValueAtTime(0.10 * vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  osc.connect(gain);
  gain.connect(getSfxOutput(c));
  osc.start(now);
  osc.stop(now + 0.10);
  scheduleDisconnect([gain], 150);
}

/** Trick chain extend: two-tone 600+900Hz tick. (SPEC-82) */
export function playGrindChainExtend(): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;
  const o1: OscillatorNode = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.setValueAtTime(600, now);
  const g1: GainNode = c.createGain();
  g1.gain.setValueAtTime(0.08 * vol, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  o1.connect(g1); g1.connect(getSfxOutput(c));
  o1.start(now); o1.stop(now + 0.05);
  const o2: OscillatorNode = c.createOscillator();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(900, now + 0.04);
  const g2: GainNode = c.createGain();
  g2.gain.setValueAtTime(0, now);
  g2.gain.setValueAtTime(0.08 * vol, now + 0.04);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  o2.connect(g2); g2.connect(getSfxOutput(c));
  o2.start(now); o2.stop(now + 0.14);
  scheduleDisconnect([g1, g2], 200);
}

/** Milestone triad: rising major chord, pitch scales with tier (0..3). (SPEC-82) */
export function playGrindMilestone(tier: number): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;
  const root = 440 * (1 + tier * 0.15);
  const notes = [root, root * 1.25, root * 1.5];
  for (let i = 0; i < notes.length; i++) {
    const offset = i * 0.08;
    const osc: OscillatorNode = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(notes[i], now + offset);
    const gain: GainNode = c.createGain();
    gain.gain.setValueAtTime(0, now + offset);
    gain.gain.setValueAtTime(0.10 * vol, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.20);
    osc.connect(gain); gain.connect(getSfxOutput(c));
    osc.start(now + offset); osc.stop(now + offset + 0.22);
    scheduleDisconnect([osc, gain], 400);
  }
}

/** Cash out shimmer: 4-note arpeggio C-E-G-C2 scaled by score. (SPEC-82) */
export function playGrindCashOut(scoreMagnitude: number): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;
  const intensity = Math.min(1, Math.log(Math.max(1, scoreMagnitude) + 1) / 8);
  const base = 523;
  const ratios = [1, 1.26, 1.5, 2];
  for (let i = 0; i < ratios.length; i++) {
    const offset = i * 0.08;
    const osc: OscillatorNode = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(base * ratios[i], now + offset);
    const gain: GainNode = c.createGain();
    gain.gain.setValueAtTime(0, now + offset);
    gain.gain.setValueAtTime(0.12 * vol * (0.5 + intensity * 0.5), now + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.22);
    osc.connect(gain); gain.connect(getSfxOutput(c));
    osc.start(now + offset); osc.stop(now + offset + 0.24);
    scheduleDisconnect([osc, gain], 400);
  }
}

/** BUSTED! dissonant descending slur over 500ms. (SPEC-82) */
export function playGrindBust(): void {
  const c: AudioContext = getCtx();
  if (!c) return;
  const vol: number = getSfxVolume();
  const now: number = c.currentTime;
  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(180, now + 0.5);
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(900, now);
  bp.Q.value = 1.8;
  const gain: GainNode = c.createGain();
  gain.gain.setValueAtTime(0.14 * vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc.connect(bp); bp.connect(gain); gain.connect(getSfxOutput(c));
  osc.start(now); osc.stop(now + 0.52);
  const hum: OscillatorNode = c.createOscillator();
  hum.type = 'sine';
  hum.frequency.setValueAtTime(90, now);
  const hg: GainNode = c.createGain();
  hg.gain.setValueAtTime(0.08 * vol, now);
  hg.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  hum.connect(hg); hg.connect(getSfxOutput(c));
  hum.start(now); hum.stop(now + 0.52);
  scheduleDisconnect([osc, bp, gain, hum, hg], 600);
}
