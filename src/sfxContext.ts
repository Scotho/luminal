// ── Shared SFX AudioContext + Volume + Output Chain ──────
// Single source of truth for SFX context, volume, and dampen.
// Extracted to break the circular sfx<->sfxAssets import.


declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

let ctx: AudioContext | null = null;
let _sfxVolume: number = 0.5;
let _sfxDampenFilter: BiquadFilterNode | null = null;
let _sfxDampenGain: GainNode | null = null;
let _sfxOutputNode: AudioNode | null = null;
let _sfxDampened: boolean = false;

export function setSfxVolume(v: number): void { _sfxVolume = Math.max(0, Math.min(1, v)); }
export function getSfxVolume(): number { return _sfxVolume; }

/** Shared SFX output node — routes through dampen filter when active. */
export function getSfxOutput(c: AudioContext): AudioNode {
  if (_sfxOutputNode) return _sfxOutputNode;
  _sfxDampenFilter = c.createBiquadFilter();
  _sfxDampenFilter.type = 'lowpass';
  _sfxDampenFilter.frequency.value = 22050;
  _sfxDampenFilter.Q.value = 0.7;
  _sfxDampenGain = c.createGain();
  _sfxDampenGain.gain.value = 1.0;
  _sfxDampenFilter.connect(_sfxDampenGain);
  _sfxDampenGain.connect(c.destination);
  _sfxOutputNode = _sfxDampenFilter;
  return _sfxOutputNode;
}

/** Engage muffled low-pass dampen effect on SFX. */
export function setSfxDampen(on: boolean): void {
  if (!ctx || !_sfxDampenFilter || !_sfxDampenGain) return;
  if (on === _sfxDampened) return;
  _sfxDampened = on;
  const now = ctx.currentTime;
  const ramp = 0.35;
  _sfxDampenFilter.frequency.cancelScheduledValues(now);
  _sfxDampenGain.gain.cancelScheduledValues(now);
  if (on) {
    _sfxDampenFilter.frequency.setValueAtTime(_sfxDampenFilter.frequency.value, now);
    _sfxDampenFilter.frequency.exponentialRampToValueAtTime(2200, now + ramp);
    _sfxDampenGain.gain.setValueAtTime(_sfxDampenGain.gain.value, now);
    _sfxDampenGain.gain.linearRampToValueAtTime(0.85, now + ramp);
  } else {
    _sfxDampenFilter.frequency.setValueAtTime(_sfxDampenFilter.frequency.value, now);
    _sfxDampenFilter.frequency.exponentialRampToValueAtTime(22050, now + ramp);
    _sfxDampenGain.gain.setValueAtTime(_sfxDampenGain.gain.value, now);
    _sfxDampenGain.gain.linearRampToValueAtTime(1.0, now + ramp);
  }
}

// Utility: cached noise buffers by duration (avoids re-generating)
const _noiseCache: Record<string, AudioBuffer> = {};
export function noiseBuf(c: AudioContext, duration: number): AudioBuffer {
  const key: string = duration.toFixed(2);
  if (_noiseCache[key]) return _noiseCache[key];
  const buf: AudioBuffer = c.createBuffer(1, c.sampleRate * duration, c.sampleRate);
  const data: Float32Array = buf.getChannelData(0);
  for (let i: number = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  _noiseCache[key] = buf;
  return buf;
}

export function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext!)();
    noiseBuf(ctx, 0.08);
    noiseBuf(ctx, 0.6);
    noiseBuf(ctx, 1.0);
    noiseBuf(ctx, 2.0);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
