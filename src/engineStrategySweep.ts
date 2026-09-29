import { getCtx, getSfxOutput, getSfxVolume, noiseBuf } from './sfxContext';
import { getVehicleBuffer } from './vehicleSfxLoader';
import { interpolateKeyframes, smoothValue } from './audioUtils';
import type { VehicleType, VehicleAudioProfile, SweepConfig } from './types/index';

interface SweepNodes {
  idleSrc: AudioBufferSourceNode;
  idleGain: GainNode;
  sweepSrc: AudioBufferSourceNode;
  sweepGain: GainNode;
  lpFilter: BiquadFilterNode;
  noiseSrc: AudioBufferSourceNode;
  noiseBP: BiquadFilterNode;
  noiseGain: GainNode;
  master: GainNode;
}

const SMOOTHING = 0.08;

export class SweepEngine {
  private nodes: SweepNodes | null = null;
  private running = false;
  private config: SweepConfig;
  private vehicleType: VehicleType;

  // Smoothed state values
  private _idleGain = 1.0;
  private _sweepGain = 0.0;
  private _sweepPos = 0.0;
  private _lpFreq = 200;
  private _lpQ = 1.0;
  private _noiseGain = 0.01;

  constructor(profile: VehicleAudioProfile) {
    if (!profile.sweepConfig) {
      throw new Error(`SweepEngine: profile for '${profile.vehicleType}' has no sweepConfig`);
    }
    this.config = profile.sweepConfig;
    this.vehicleType = profile.vehicleType;
  }

  start(dest?: AudioNode): void {
    if (this.running) return;
    try {
      const c = getCtx();
      this.running = true;

      // ── Idle loop ────────────────────────────────────
      const idleSrc = c.createBufferSource();
      idleSrc.buffer = getVehicleBuffer(this.vehicleType, this.config.idleSample);
      idleSrc.loop = true;

      const idleGain = c.createGain();
      idleGain.gain.value = 1.0;

      // ── Speed sweep ──────────────────────────────────
      const sweepSrc = c.createBufferSource();
      sweepSrc.buffer = getVehicleBuffer(this.vehicleType, this.config.sweepSample);
      sweepSrc.loop = true;
      sweepSrc.playbackRate.value = 0.001;

      const sweepGain = c.createGain();
      sweepGain.gain.value = 0.0;

      // ── LP filter + master ───────────────────────────
      const lpFilter = c.createBiquadFilter();
      lpFilter.type = 'lowpass';
      const engCurve = this.config.engineFilterCurve ?? this.config.filterCurve;
      lpFilter.frequency.value = interpolateKeyframes(engCurve, 0);
      lpFilter.Q.value = this.config.engineFilterCurve ? 0.707 : interpolateKeyframes(this.config.boostQCurve, 0);

      const master = c.createGain();
      master.gain.value = getSfxVolume() * 1.089;

      // ── Noise layer ──────────────────────────────────
      const noiseSrc = c.createBufferSource();
      noiseSrc.buffer = noiseBuf(c, 3);
      noiseSrc.loop = true;

      const noiseBP = c.createBiquadFilter();
      noiseBP.type = 'bandpass';
      noiseBP.frequency.value = interpolateKeyframes(this.config.filterCurve, 0);
      noiseBP.Q.value = 0.3;

      const noiseGain = c.createGain();
      noiseGain.gain.value = interpolateKeyframes(this.config.noiseCurve, 0);

      // ── Connections ──────────────────────────────────
      const output = dest ?? getSfxOutput(c);

      idleSrc.connect(idleGain);
      idleGain.connect(lpFilter);
      sweepSrc.connect(sweepGain);
      sweepGain.connect(lpFilter);
      lpFilter.connect(master);

      noiseSrc.connect(noiseBP);
      noiseBP.connect(noiseGain);
      noiseGain.connect(master);

      master.connect(output);

      idleSrc.start();
      sweepSrc.start();
      noiseSrc.start();

      this.nodes = {
        idleSrc, idleGain,
        sweepSrc, sweepGain,
        lpFilter,
        noiseSrc, noiseBP, noiseGain,
        master,
      };

      // Reset smoothed state
      this._idleGain = 1.0;
      this._sweepGain = 0.0;
      this._sweepPos = 0.0;
      this._lpFreq = interpolateKeyframes(engCurve, 0);
      this._lpQ = this.config.engineFilterCurve ? 0.707 : interpolateKeyframes(this.config.boostQCurve, 0);
      this._noiseGain = interpolateKeyframes(this.config.noiseCurve, 0);
    } catch {
      this.running = false;
    }
  }

  update(speedFactor: number): void {
    if (!this.nodes) return;
    const n = this.nodes;
    const cfg = this.config;

    // ── Idle gain crossfade ──────────────────────────
    const targetIdleGain = speedFactor >= cfg.idleFadeEnd
      ? 0.0
      : 1.0 - (speedFactor / cfg.idleFadeEnd);
    this._idleGain = smoothValue(this._idleGain, targetIdleGain, SMOOTHING);
    n.idleGain.gain.value = this._idleGain;

    // ── Sweep gain crossfade ─────────────────────────
    const targetSweepGain = speedFactor <= cfg.sweepFadeStart
      ? 0.0
      : Math.min(1.0, (speedFactor - cfg.sweepFadeStart) / (cfg.idleFadeEnd - cfg.sweepFadeStart));
    this._sweepGain = smoothValue(this._sweepGain, targetSweepGain, SMOOTHING);
    n.sweepGain.gain.value = this._sweepGain;

    // ── Sweep playback position (steer via rate) ─────
    const targetPos = interpolateKeyframes(cfg.sweepPositionCurve, speedFactor);
    this._sweepPos = smoothValue(this._sweepPos, targetPos, SMOOTHING);
    // Rate > 1 moves forward, rate < 1 slows/reverses; use position delta to steer
    const [rateMin, rateMax] = cfg.playbackRateRange;
    const rateMid = (rateMin + rateMax) / 2;
    const posDelta = targetPos - this._sweepPos;
    // Positive delta → speed up slightly; negative → slow down
    const rate = Math.max(rateMin, Math.min(rateMax, rateMid + posDelta * 2));
    n.sweepSrc.playbackRate.value = rate;

    // ── LP filter ────────────────────────────────────
    const engCurve = cfg.engineFilterCurve ?? cfg.filterCurve;
    const targetLpFreq = interpolateKeyframes(engCurve, speedFactor);
    this._lpFreq = smoothValue(this._lpFreq, targetLpFreq, SMOOTHING);
    n.lpFilter.frequency.value = this._lpFreq;

    if (!cfg.engineFilterCurve) {
      const targetQ = interpolateKeyframes(cfg.boostQCurve, speedFactor);
      this._lpQ = smoothValue(this._lpQ, targetQ, SMOOTHING);
      n.lpFilter.Q.value = this._lpQ;
    }

    // ── Noise ────────────────────────────────────────
    const targetNoiseGain = interpolateKeyframes(cfg.noiseCurve, speedFactor);
    this._noiseGain = smoothValue(this._noiseGain, targetNoiseGain, SMOOTHING);
    n.noiseGain.gain.value = this._noiseGain;

    // ── Master volume (with optional speed-dependent curve) ──
    const volMul = cfg.volumeCurve
      ? interpolateKeyframes(cfg.volumeCurve, speedFactor)
      : 1.0;
    n.master.gain.value = getSfxVolume() * 1.089 * volMul;
  }

  stop(): void {
    if (!this.nodes) { this.running = false; return; }
    const n = this.nodes;
    // Stop each source independently so one failure doesn't skip others
    for (const src of [n.idleSrc, n.sweepSrc, n.noiseSrc]) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    for (const node of [n.idleSrc, n.idleGain, n.sweepSrc, n.sweepGain, n.lpFilter, n.noiseSrc, n.noiseBP, n.noiseGain, n.master]) {
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    this.nodes = null;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
