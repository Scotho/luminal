import * as THREE from 'three';
import { getCtx, getSfxOutput, noiseBuf } from '../sfxContext';

type SoundName = 'launch0' | 'pop0' | 'boom0';

/**
 * Procedural launch/pop/boom SFX for the fireworks system.
 * Reuses Luminal's existing Web Audio chain (sfxContext + spatialAudio's
 * PannerNode pattern). No THREE.AudioListener / THREE.PositionalAudio.
 * Master SFX volume, mute, and dampen are applied by getSfxOutput automatically.
 */
export class FireworkAudio {
  private readonly ctx: AudioContext;
  private readonly output: AudioNode;
  private readonly buffers: Record<SoundName, AudioBuffer>;
  private readonly active: Record<SoundName, number> = { launch0: 0, pop0: 0, boom0: 0 };
  private readonly maxInstances = 6;

  // SoundRange.LONG tier — matches spatialAudio.ts RANGE_CONFIG[LONG]
  private readonly refDistance = 30;
  private readonly maxDistance = 384;
  private readonly rolloffFactor = 1.0;

  constructor() {
    this.ctx = getCtx();
    this.output = getSfxOutput(this.ctx);
    this.buffers = {
      launch0: this.renderLaunch(),
      pop0: this.renderPop(),
      boom0: this.renderBoom(),
    };
  }

  play(name: SoundName, position: THREE.Vector3, gain: number, detune: number): void {
    if (this.active[name] >= this.maxInstances) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.detune.value = detune;

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = gain;

    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = this.refDistance;
    panner.maxDistance = this.maxDistance;
    panner.rolloffFactor = this.rolloffFactor;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;

    src.connect(gainNode).connect(panner).connect(this.output);

    this.active[name]++;
    src.onended = (): void => {
      src.disconnect();
      gainNode.disconnect();
      panner.disconnect();
      this.active[name]--;
    };
    try {
      src.start();
    } catch {
      // Rollback — start() failed, nothing will fire onended.
      this.active[name]--;
      src.disconnect();
      gainNode.disconnect();
      panner.disconnect();
    }
  }

  // ── Procedural renders ────────────────────────────────────────────
  // Each render* returns a cached AudioBuffer synthesized directly
  // into the shared ctx (fast enough to do at construction time).

  private renderLaunch(): AudioBuffer {
    const dur = 0.12;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Band-limited noise sweep 800→4000Hz simulated via filtered white noise,
    // plus a 200Hz resonant ping. Envelope: sharp attack, exponential decay.
    const noise = noiseBuf(this.ctx, dur).getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const env = Math.exp(-t * 6);
      const n = noise[i % noise.length] * (0.5 + t * 0.5);
      const ping = Math.sin(2 * Math.PI * 200 * (i / this.ctx.sampleRate)) * 0.4 * env;
      data[i] = (n * 0.6 + ping) * env;
    }
    return buf;
  }

  private renderPop(): AudioBuffer {
    const dur = 0.18;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    const noise = noiseBuf(this.ctx, dur).getChannelData(0);
    // Sine chirp 1200→400Hz over the first 45% of the buffer, plus noise burst.
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const env = Math.exp(-t * 5);
      const chirpT = Math.min(t, 0.45) / 0.45;
      const freq = 1200 - 800 * chirpT;
      const tone = Math.sin(2 * Math.PI * freq * (i / this.ctx.sampleRate));
      const n = noise[i % noise.length];
      data[i] = (tone * 0.5 + n * 0.5) * env;
    }
    return buf;
  }

  private renderBoom(): AudioBuffer {
    const dur = 0.6;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    const noise = noiseBuf(this.ctx, dur).getChannelData(0);
    // Low sine thump 80→40Hz + filtered noise tail. Slow exponential release.
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const env = Math.exp(-t * 3.5);
      const freq = 80 - 40 * t;
      const thump = Math.sin(2 * Math.PI * freq * (i / this.ctx.sampleRate));
      // Simple one-pole lowpass of the noise
      const n = noise[i % noise.length] * (1 - t * 0.6);
      let mixed = thump * 0.7 + n * 0.4;
      // Soft saturation for body
      mixed = Math.tanh(mixed * 1.5);
      data[i] = mixed * env;
    }
    return buf;
  }

  dispose(): void {
    // Intentional no-op: persistent nodes are only the cached AudioBuffers,
    // which are garbage-collected with the FireworkAudio instance. Active
    // source nodes clean themselves up via onended.
  }
}
