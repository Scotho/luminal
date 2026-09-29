import { warnDev } from '../swallow';
import { getCtx, getSfxOutput, getSfxVolume, noiseBuf } from '../sfxContext';
import { scheduleDisconnect } from './sfxShared';

// ── Player Vehicle / Feedback Sounds ─────────────────────
// Per-player procedural feedback: engine wrappers, slipstream (proximity
// spark), boost/dash/sputter, turn swoosh. The grind-trail suite lives in
// ./sfxGrind (split out to keep this file under the 500-LOC budget).

// ── Engine Sound — delegated to vehicleAudioEngine ─────────
// Thin wrappers for backward compatibility. New code should import
// from vehicleAudioEngine directly.
import { startVehicleEngine, updateVehicleEngine, stopVehicleEngine } from '../vehicleAudioEngine';

// ts-prune-ignore-next
export function startEngine(vehicleType: string = 'bike'): void {
  startVehicleEngine(vehicleType as import('../types/index').VehicleType);
}
export function updateEngine(speedFactor: number, boosting: boolean = false): void {
  updateVehicleEngine(speedFactor, boosting);
}
// ts-prune-ignore-next
export { stopVehicleEngine as stopEngine };


// ── Slipstream Sound — Procedural Energy Siphon ─────────
// Band-passed wind + sine hum + sparse crackle. Scales with proximity intensity.
interface SlipstreamNodes {
  noiseSrc: AudioBufferSourceNode;
  noiseBP: BiquadFilterNode;
  noiseGain: GainNode;
  hum: OscillatorNode;
  humLFO: OscillatorNode;
  lfoGain: GainNode;
  humGain: GainNode;
  crackleSrc: AudioBufferSourceNode;
  crackleHP: BiquadFilterNode;
  crackleGain: GainNode;
  master: GainNode;
}

let _slipNodes: SlipstreamNodes | null = null;

export function startProximitySpark(): void {
  if (_slipNodes) return;
  const c: AudioContext = getCtx();
  const out: AudioNode = getSfxOutput(c);

  // Master gain
  const master: GainNode = c.createGain();
  master.gain.value = 0;
  master.connect(out);

  // Wind whoosh: looping noise → bandpass → gain
  const noiseSrc: AudioBufferSourceNode = c.createBufferSource();
  noiseSrc.buffer = noiseBuf(c, 2.0);
  noiseSrc.loop = true;
  const noiseBP: BiquadFilterNode = c.createBiquadFilter();
  noiseBP.type = 'bandpass';
  noiseBP.frequency.value = 200;
  noiseBP.Q.value = 1.5;
  const noiseGain: GainNode = c.createGain();
  noiseGain.gain.value = 0;
  noiseSrc.connect(noiseBP);
  noiseBP.connect(noiseGain);
  noiseGain.connect(master);
  noiseSrc.start();

  // Energy hum: sine oscillator with LFO wobble (pitched down from 80 Hz to reduce buzz)
  const hum: OscillatorNode = c.createOscillator();
  hum.type = 'sine';
  hum.frequency.value = 55;
  const humLFO: OscillatorNode = c.createOscillator();
  humLFO.type = 'sine';
  humLFO.frequency.value = 2.2;
  const lfoGain: GainNode = c.createGain();
  lfoGain.gain.value = 3; // wobble depth (reduced from 5 to tame buzz)
  humLFO.connect(lfoGain);
  lfoGain.connect(hum.frequency);
  const humGain: GainNode = c.createGain();
  humGain.gain.value = 0;
  hum.connect(humGain);
  humGain.connect(master);
  hum.start();
  humLFO.start();

  // Crackle: looping short noise → highpass → gain
  const crackleSrc: AudioBufferSourceNode = c.createBufferSource();
  crackleSrc.buffer = noiseBuf(c, 0.08);
  crackleSrc.loop = true;
  const crackleHP: BiquadFilterNode = c.createBiquadFilter();
  crackleHP.type = 'highpass';
  crackleHP.frequency.value = 1400;
  const crackleGain: GainNode = c.createGain();
  crackleGain.gain.value = 0;
  crackleSrc.connect(crackleHP);
  crackleHP.connect(crackleGain);
  crackleGain.connect(master);
  crackleSrc.start();

  _slipNodes = { noiseSrc, noiseBP, noiseGain, hum, humLFO, lfoGain, humGain, crackleSrc, crackleHP, crackleGain, master };
}

export function updateProximitySpark(intensity: number, vehicleVolume: number = 1.0): void {
  if (!_slipNodes) return;
  const vol: number = getSfxVolume();
  const p: number = Math.min(1, intensity);

  // Master envelope — smooth ramp (reduced 20% from 0.15)
  _slipNodes.master.gain.value = p * 0.12 * vol * vehicleVolume;

  // Wind: center frequency rises with intensity, gain scales
  _slipNodes.noiseBP.frequency.value = 200 + p * 400;
  _slipNodes.noiseGain.gain.value = p * 0.48;

  // Hum: pitch rises slightly (pitched down from 80 to reduce buzz)
  _slipNodes.hum.frequency.value = 55 + p * 35;
  _slipNodes.humGain.gain.value = p * 0.16;

  // Crackle: subtle at higher intensity
  _slipNodes.crackleGain.gain.value = p * 0.08;
}

export function stopProximitySpark(fadeDuration: number = 0): void {
  if (!_slipNodes) return;
  const nodes = _slipNodes;
  _slipNodes = null;

  const teardown = (): void => {
    try {
      nodes.noiseSrc.stop();
      nodes.hum.stop();
      nodes.humLFO.stop();
      nodes.crackleSrc.stop();
    } catch (e) { warnDev('sfx', e); }
    try {
      nodes.noiseSrc.disconnect();
      nodes.noiseBP.disconnect();
      nodes.noiseGain.disconnect();
      nodes.hum.disconnect();
      nodes.humLFO.disconnect();
      nodes.lfoGain.disconnect();
      nodes.humGain.disconnect();
      nodes.crackleSrc.disconnect();
      nodes.crackleHP.disconnect();
      nodes.crackleGain.disconnect();
      nodes.master.disconnect();
    } catch (e) { warnDev('sfx', e); }
  };

  if (fadeDuration > 0) {
    try {
      const c: AudioContext = getCtx();
      const now = c.currentTime;
      nodes.master.gain.cancelScheduledValues(now);
      nodes.master.gain.setValueAtTime(nodes.master.gain.value, now);
      nodes.master.gain.linearRampToValueAtTime(0, now + fadeDuration);
    } catch { /* expected: ctx unavailable — teardown still runs after timeout */ }
    setTimeout(teardown, fadeDuration * 1000 + 50);
  } else {
    teardown();
  }
}

// ── Boost Activation (W key) ────────────────────────────
// Electric surge: sine sweep + filtered noise burst + sub thump
export function playBoost(speedFactor: number = 1.0, dest?: AudioNode): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.12 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  master.connect(dest ?? getSfxOutput(c));
  // Sine sweep — pitch scales slightly with speed
  const pitchMul: number = 0.8 + speedFactor * 0.4;
  const sweep: OscillatorNode = c.createOscillator();
  sweep.type = 'sine';
  sweep.frequency.setValueAtTime(200 * pitchMul, now);
  sweep.frequency.exponentialRampToValueAtTime(600 * pitchMul, now + 0.15);
  sweep.frequency.exponentialRampToValueAtTime(400 * pitchMul, now + 0.3);
  const sweepG: GainNode = c.createGain();
  sweepG.gain.setValueAtTime(0.6, now);
  sweepG.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  sweep.connect(sweepG);
  sweepG.connect(master);
  sweep.start(now);
  sweep.stop(now + 0.35);
  // Noise burst — filtered air rush
  const buf: AudioBuffer = noiseBuf(c, 0.08);
  const nSrc: AudioBufferSourceNode = c.createBufferSource();
  nSrc.buffer = buf;
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1500, now);
  bp.frequency.exponentialRampToValueAtTime(4000, now + 0.06);
  bp.Q.value = 1.5;
  const nG: GainNode = c.createGain();
  nG.gain.setValueAtTime(0.25, now);
  nG.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  nSrc.connect(bp);
  bp.connect(nG);
  nG.connect(master);
  nSrc.start(now);
  // Sub thump for weight
  const sub: OscillatorNode = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(60, now);
  sub.frequency.exponentialRampToValueAtTime(35, now + 0.15);
  const subG: GainNode = c.createGain();
  subG.gain.setValueAtTime(0.4, now);
  subG.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  sub.connect(subG);
  subG.connect(master);
  sub.start(now);
  sub.stop(now + 0.25);
  scheduleDisconnect([sweep, sweepG, nSrc, bp, nG, sub, subG, master], 400);
}

// ── Dash Activation (Shift key) ─────────────────────────
// More aggressive than boost: sawtooth sweep + wider noise + sub impact
export function playDash(dest?: AudioNode): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.14 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  master.connect(dest ?? getSfxOutput(c));
  // Sawtooth sweep — harsher harmonics
  const saw: OscillatorNode = c.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.setValueAtTime(300, now);
  saw.frequency.exponentialRampToValueAtTime(900, now + 0.1);
  saw.frequency.exponentialRampToValueAtTime(500, now + 0.2);
  const sawLP: BiquadFilterNode = c.createBiquadFilter();
  sawLP.type = 'lowpass';
  sawLP.frequency.setValueAtTime(1200, now);
  sawLP.frequency.exponentialRampToValueAtTime(400, now + 0.2);
  const sawG: GainNode = c.createGain();
  sawG.gain.setValueAtTime(0.5, now);
  sawG.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  saw.connect(sawLP);
  sawLP.connect(sawG);
  sawG.connect(master);
  saw.start(now);
  saw.stop(now + 0.25);
  // Wider noise burst
  const buf: AudioBuffer = noiseBuf(c, 0.08);
  const nSrc: AudioBufferSourceNode = c.createBufferSource();
  nSrc.buffer = buf;
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2000, now);
  bp.frequency.exponentialRampToValueAtTime(6000, now + 0.05);
  bp.Q.value = 0.8;
  const nG: GainNode = c.createGain();
  nG.gain.setValueAtTime(0.3, now);
  nG.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  nSrc.connect(bp);
  bp.connect(nG);
  nG.connect(master);
  nSrc.start(now);
  // Sub impact
  const sub: OscillatorNode = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(50, now);
  sub.frequency.exponentialRampToValueAtTime(25, now + 0.1);
  const subG: GainNode = c.createGain();
  subG.gain.setValueAtTime(0.5, now);
  subG.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  sub.connect(subG);
  subG.connect(master);
  sub.start(now);
  sub.stop(now + 0.2);
  scheduleDisconnect([saw, sawLP, sawG, nSrc, bp, nG, sub, subG, master], 300);
}

// ── Boost Sputter (meter depleted — fumes expired) ──────
// Descending engine choke with crackle tail — signals "you're out"
export function playSputter(dest?: AudioNode): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.13 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
  master.connect(dest ?? getSfxOutput(c));
  // Descending sine sweep — engine dying
  const sweep: OscillatorNode = c.createOscillator();
  sweep.type = 'sine';
  sweep.frequency.setValueAtTime(400, now);
  sweep.frequency.exponentialRampToValueAtTime(80, now + 0.3);
  sweep.frequency.exponentialRampToValueAtTime(40, now + 0.45);
  const sweepG: GainNode = c.createGain();
  sweepG.gain.setValueAtTime(0.5, now);
  sweepG.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  sweep.connect(sweepG);
  sweepG.connect(master);
  sweep.start(now);
  sweep.stop(now + 0.5);
  // Crackle noise burst — sputtering tail
  const buf: AudioBuffer = noiseBuf(c, 0.08);
  const nSrc: AudioBufferSourceNode = c.createBufferSource();
  nSrc.buffer = buf;
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(800, now + 0.1);
  bp.frequency.exponentialRampToValueAtTime(200, now + 0.4);
  bp.Q.value = 2.0;
  const nG: GainNode = c.createGain();
  nG.gain.setValueAtTime(0.001, now);
  nG.gain.linearRampToValueAtTime(0.3, now + 0.15);
  nG.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  nSrc.connect(bp);
  bp.connect(nG);
  nG.connect(master);
  nSrc.start(now);
  // Sub drop — weight of cutoff
  const sub: OscillatorNode = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, now);
  sub.frequency.exponentialRampToValueAtTime(20, now + 0.3);
  const subG: GainNode = c.createGain();
  subG.gain.setValueAtTime(0.35, now);
  subG.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  sub.connect(subG);
  subG.connect(master);
  sub.start(now);
  sub.stop(now + 0.4);
  scheduleDisconnect([sweep, sweepG, nSrc, bp, nG, sub, subG, master], 550);
}

// ── Turn Swoosh ─────────────────────────────────────────
// Subtle bandpass noise sweep — short, quiet tactile feedback
export function playTurnSwoosh(dest?: AudioNode): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const buf: AudioBuffer = noiseBuf(c, 0.08);
  const src: AudioBufferSourceNode = c.createBufferSource();
  src.buffer = buf;
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(1200, now);
  bp.frequency.exponentialRampToValueAtTime(3500, now + 0.04);
  bp.frequency.exponentialRampToValueAtTime(1800, now + 0.1);
  bp.Q.value = 1.2;
  const gain: GainNode = c.createGain();
  gain.gain.setValueAtTime(0.03 * getSfxVolume(), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  src.connect(bp);
  bp.connect(gain);
  gain.connect(dest ?? getSfxOutput(c));
  src.start(now);
  scheduleDisconnect([src, bp, gain], 150);
}

// Trail grind sounds live in ./sfxGrind — re-exported via the src/sfx.ts barrel.
