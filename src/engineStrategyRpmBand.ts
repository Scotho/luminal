import { getCtx, getSfxOutput, getSfxVolume } from './sfxContext';
import { getVehicleBuffer } from './vehicleSfxLoader';
import { interpolateKeyframes, smoothValue } from './audioUtils';
import { warnDev } from './swallow';
import type { VehicleAudioProfile, RpmBandConfig } from './types/index';

// ── Internal types ────────────────────────────────────────

interface BandLayer {
  src: AudioBufferSourceNode;
  gain: GainNode;
  currentKey: string;  // track which sample is loaded
}

interface RpmBandNodes {
  layerA: BandLayer;
  layerB: BandLayer;
  windSrc: AudioBufferSourceNode;
  windGain: GainNode;
  aggroGain: GainNode;
  lpFilter: BiquadFilterNode;
  master: GainNode;
  /** Destination node for wind source swaps. */
  windDest: GainNode;
}

interface BandResult {
  lower: number;
  upper: number;
  frac: number;
}

const SMOOTHING = 0.08;

// ── RpmBandEngine ─────────────────────────────────────────

export class RpmBandEngine {
  private nodes: RpmBandNodes | null = null;
  private running = false;
  private config: RpmBandConfig;
  private vehicleType: 'bike' | 'car' | 'hoverboard';

  // Smoothed state
  private _gainA = 1.0;
  private _gainB = 0.0;
  private _windGain = 0.0;
  private _lpFreq = 400;
  private _rate = 1.0;

  // Wind sample tracking
  private _currentWindIdx = 0;

  // Aggressiveness state
  private _boosting = false;
  private _aggroSrc: AudioBufferSourceNode | null = null;
  private _aggroFading = false;

  constructor(profile: VehicleAudioProfile) {
    if (!profile.rpmBandConfig) {
      throw new Error(`RpmBandEngine: profile for '${profile.vehicleType}' has no rpmBandConfig`);
    }
    this.config = profile.rpmBandConfig;
    this.vehicleType = profile.vehicleType;
  }

  /** Resolve which two adjacent band-boundaries straddle speedFactor. */
  private resolveBands(speedFactor: number): BandResult {
    const bounds = this.config.bandBoundaries;

    // Below first boundary — pin to first segment
    if (speedFactor <= bounds[0]) {
      return { lower: 0, upper: Math.min(1, bounds.length - 1), frac: 0 };
    }

    // Above last boundary — pin to last segment
    if (speedFactor >= bounds[bounds.length - 1]) {
      const upper = bounds.length - 1;
      const lower = Math.max(0, upper - 1);
      return { lower, upper, frac: 1 };
    }

    for (let i = 1; i < bounds.length; i++) {
      if (speedFactor <= bounds[i]) {
        const lower = i - 1;
        const upper = i;
        const frac = (speedFactor - bounds[lower]) / (bounds[upper] - bounds[lower]);
        return { lower, upper, frac };
      }
    }

    // Fallback (should not reach here)
    return { lower: 0, upper: 1, frac: 0 };
  }

  /** Start the aggro layer with fade-in. */
  private startAggroLayer(c: AudioContext, _dest: AudioNode): void {
    if (this._aggroSrc) return; // already running

    const buf = getVehicleBuffer(
      this.vehicleType,
      this.config.aggroOnSample,
    );
    if (!buf || !this.nodes) return;

    try {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.nodes.aggroGain);
      src.start();

      const now = c.currentTime;
      this.nodes.aggroGain.gain.setValueAtTime(0, now);
      this.nodes.aggroGain.gain.linearRampToValueAtTime(1.0, now + this.config.aggroFadeIn);

      this._aggroSrc = src;
      this._aggroFading = false;
    } catch (e) {
      warnDev('rpmBandEngine aggroStart', e);
    }
  }

  /** Fade out the aggro layer and stop it. */
  private fadeAggroLayer(c: AudioContext): void {
    if (!this._aggroSrc || !this.nodes || this._aggroFading) return;
    this._aggroFading = true;

    try {
      const now = c.currentTime;
      const fadeEnd = now + this.config.aggroFadeOut;
      this.nodes.aggroGain.gain.cancelScheduledValues(now);
      this.nodes.aggroGain.gain.setValueAtTime(this.nodes.aggroGain.gain.value, now);
      this.nodes.aggroGain.gain.linearRampToValueAtTime(0, fadeEnd);

      const src = this._aggroSrc;
      this._aggroSrc = null;

      // Stop after fade completes
      src.stop(fadeEnd);
      src.addEventListener('ended', () => {
        try { src.disconnect(); } catch { /* already disconnected */ }
      });
    } catch (e) {
      warnDev('rpmBandEngine aggroFade', e);
    }
  }

  /** Resolve which wind sample index to use for the given speed factor. */
  private resolveWindIndex(speedFactor: number): number {
    const bounds = this.config.windBoundaries;
    for (let i = 1; i < bounds.length; i++) {
      if (speedFactor <= bounds[i]) return i - 1;
    }
    return bounds.length - 2;
  }

  /** Swap wind source to a different sample. */
  private swapWindIfNeeded(targetIdx: number, c: AudioContext): void {
    if (targetIdx === this._currentWindIdx || !this.nodes) return;
    const key = this.config.windSamples[Math.min(targetIdx, this.config.windSamples.length - 1)];
    const buf = getVehicleBuffer(this.vehicleType, key);
    if (!buf) return;

    try { this.nodes.windSrc.stop(); this.nodes.windSrc.disconnect(); } catch { /* already stopped */ }

    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.nodes.windDest);
    src.start();

    this.nodes.windSrc = src;
    this._currentWindIdx = targetIdx;
  }

  /** Replace a layer's AudioBufferSourceNode if the sample key changed. */
  private swapLayerIfNeeded(layer: BandLayer, targetKey: string, c: AudioContext): void {
    if (layer.currentKey === targetKey) return;
    const buf = getVehicleBuffer(this.vehicleType, targetKey);
    if (!buf) return;

    // Stop old source
    try { layer.src.stop(); layer.src.disconnect(); } catch { /* already stopped */ }

    // Create new source routed through the same gain node
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(layer.gain);
    src.start();

    layer.src = src;
    layer.currentKey = targetKey;
  }

  start(dest?: AudioNode): void {
    if (this.running) return;

    try {
      const c = getCtx();
      this.running = true;

      const output = dest ?? getSfxOutput(c);
      const cfg = this.config;

      // ── LP filter + master ────────────────────────────
      const lpFilter = c.createBiquadFilter();
      lpFilter.type = 'lowpass';
      lpFilter.frequency.value = interpolateKeyframes(cfg.filterCurve, 0);
      lpFilter.Q.value = 0.707; // Butterworth — flat response, no resonance

      const master = c.createGain();
      master.gain.value = getSfxVolume() * 1.089;

      // ── Band layers (both start on idle band) ─────────
      const makeLayer = (sampleKey: string, initialGain: number): BandLayer => {
        const src = c.createBufferSource();
        src.buffer = getVehicleBuffer(this.vehicleType, sampleKey);
        src.loop = true;

        const gain = c.createGain();
        gain.gain.value = initialGain;

        src.connect(gain);
        gain.connect(lpFilter);
        src.start();
        return { src, gain, currentKey: sampleKey };
      };

      const idleSample = cfg.bandSamples[0].loopSample;
      const layerA = makeLayer(idleSample, 1.0);
      const layerB = makeLayer(idleSample, 0.0);

      // ── Wind layer (first wind sample) ───────────────
      const windSrc = c.createBufferSource();
      windSrc.buffer = getVehicleBuffer(
        this.vehicleType,
        cfg.windSamples[0],
      );
      windSrc.loop = true;

      const windGain = c.createGain();
      windGain.gain.value = 0;
      windSrc.connect(windGain);
      windGain.connect(master);
      windSrc.start();

      // ── Aggro gain (source started on demand) ─────────
      const aggroGain = c.createGain();
      aggroGain.gain.value = 0;
      aggroGain.connect(master);

      // ── Connect LP → master → output ─────────────────
      lpFilter.connect(master);
      master.connect(output);

      this.nodes = { layerA, layerB, windSrc, windGain, windDest: windGain, aggroGain, lpFilter, master };

      // Reset smoothed state
      this._gainA = 1.0;
      this._gainB = 0.0;
      this._windGain = 0;
      this._lpFreq = interpolateKeyframes(cfg.filterCurve, 0);
      this._rate = 1.0;
      this._currentWindIdx = 0;
      this._boosting = false;
      this._aggroSrc = null;
      this._aggroFading = false;
    } catch {
      this.running = false;
    }
  }

  update(speedFactor: number, accelDir: number, boosting = false): void {
    if (!this.nodes) return;
    const n = this.nodes;
    const cfg = this.config;

    const c = getCtx();

    // ── Band crossfade ────────────────────────────────
    const { lower, upper, frac } = this.resolveBands(speedFactor);

    // Always use the sustained loop sample for each band.
    // on/off samples are transition one-shots (future: play as overlays).
    const lowerSample = cfg.bandSamples[lower].loopSample;
    const upperSample = cfg.bandSamples[upper].loopSample;

    // Hot-swap band sources when the target band changes.
    // AudioBufferSourceNode.buffer is read-only after start(), so we
    // stop the old source and create a new one routed through the same gain.
    this.swapLayerIfNeeded(n.layerA, lowerSample, c);
    this.swapLayerIfNeeded(n.layerB, upperSample, c);

    // ── Crossfade with narrow overlap zone ─────────
    const cw = cfg.crossfadeWidth;
    let targetGainA: number;
    let targetGainB: number;

    if (frac <= 1.0 - cw) {
      // Plateau zone — lower band only
      targetGainA = 1.0;
      targetGainB = 0.0;
    } else {
      // Crossfade zone near upper boundary
      const crossfadeFrac = (frac - (1.0 - cw)) / cw;
      targetGainA = 1.0 - crossfadeFrac;
      targetGainB = crossfadeFrac;
    }

    this._gainA = smoothValue(this._gainA, targetGainA, SMOOTHING);
    this._gainB = smoothValue(this._gainB, targetGainB, SMOOTHING);
    n.layerA.gain.gain.value = this._gainA;
    n.layerB.gain.gain.value = this._gainB;

    // ── Playback rate modulation within band ─────
    const [rateMin, rateMax] = cfg.playbackRateRange;
    const targetRate = rateMin + frac * (rateMax - rateMin);
    this._rate = smoothValue(this._rate, targetRate, SMOOTHING);
    n.layerA.src.playbackRate.value = this._rate;
    n.layerB.src.playbackRate.value = this._rate;

    // ── LP filter ────────────────────────────────────
    const targetLpFreq = interpolateKeyframes(cfg.filterCurve, speedFactor);
    this._lpFreq = smoothValue(this._lpFreq, targetLpFreq, SMOOTHING);
    n.lpFilter.frequency.value = this._lpFreq;

    // ── Wind (cycle samples by speed band) ────────
    const windIdx = this.resolveWindIndex(speedFactor);
    this.swapWindIfNeeded(windIdx, c);

    const targetWind = interpolateKeyframes(cfg.windGainCurve, speedFactor);
    this._windGain = smoothValue(this._windGain, targetWind, SMOOTHING);
    n.windGain.gain.value = this._windGain;

    // ── Aggressiveness ────────────────────────────────
    const wasBoost = this._boosting;
    this._boosting = boosting;

    if (boosting && !wasBoost) {
      this.startAggroLayer(c, n.master);
    } else if (!boosting && wasBoost) {
      this.fadeAggroLayer(c);
    }

    // ── Master volume ─────────────────────────────────
    n.master.gain.value = getSfxVolume() * 1.089;
  }

  stop(): void {
    if (!this.nodes) return;
    const n = this.nodes;

    // Stop aggro source if active
    if (this._aggroSrc) {
      try { this._aggroSrc.stop(); } catch { /* already stopped */ }
      try { this._aggroSrc.disconnect(); } catch { /* already disconnected */ }
      this._aggroSrc = null;
    }

    try {
      n.layerA.src.stop();
      n.layerB.src.stop();
      n.windSrc.stop();
    } catch (e) {
      warnDev('rpmBandEngine stop sources', e);
    }

    try {
      n.layerA.src.disconnect();
      n.layerA.gain.disconnect();
      n.layerB.src.disconnect();
      n.layerB.gain.disconnect();
      n.windSrc.disconnect();
      n.windGain.disconnect();
      n.aggroGain.disconnect();
      n.lpFilter.disconnect();
      n.master.disconnect();
    } catch (e) {
      warnDev('rpmBandEngine stop disconnect', e);
    }

    this.nodes = null;
    this.running = false;
    this._boosting = false;
    this._aggroFading = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
