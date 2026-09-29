// Ambient audio layer — low-pass "dampen" bed applied when the player pauses
// or enters a settings/menu overlay. Lives between the master gain node and
// the audio context destination so it muffles every music source that feeds
// through the gain bus.
//
// State is module-local and owned by this file. audio.ts wires the chain
// during initAudio() via initAmbientChain() and toggles it via setAmbientDampen().

let _dampenFilter: BiquadFilterNode | null = null;
let _dampenGain: GainNode | null = null;
let _dampened: boolean = false;
let _audioCtx: AudioContext | null = null;

/**
 * Build the dampen (lowpass + gain) chain and splice it between the upstream
 * master gain and the context destination. Returns nothing — all handles are
 * stored as module-level state.
 *
 * Call once from initAudio(); reset by dropping the AudioContext reference.
 */
export function initAmbientChain(ctx: AudioContext, upstream: GainNode): void {
  _audioCtx = ctx;
  _dampenFilter = ctx.createBiquadFilter();
  _dampenFilter.type = 'lowpass';
  _dampenFilter.frequency.value = 22050; // wide open by default
  _dampenFilter.Q.value = 0.7;
  _dampenGain = ctx.createGain();
  _dampenGain.gain.value = 1.0;

  upstream.connect(_dampenFilter);
  _dampenFilter.connect(_dampenGain);
  _dampenGain.connect(ctx.destination);
  _dampened = false;
}

/** Engage or release the muffled low-pass dampen effect (settings / pause menus). */
export function setAmbientDampen(on: boolean): void {
  if (!_audioCtx || !_dampenFilter || !_dampenGain) return;
  if (on === _dampened) return;
  _dampened = on;
  const now = _audioCtx.currentTime;
  const ramp = 0.35;
  _dampenFilter.frequency.cancelScheduledValues(now);
  _dampenGain.gain.cancelScheduledValues(now);
  if (on) {
    _dampenFilter.frequency.setValueAtTime(_dampenFilter.frequency.value, now);
    _dampenFilter.frequency.exponentialRampToValueAtTime(2000, now + ramp);
    _dampenGain.gain.setValueAtTime(_dampenGain.gain.value, now);
    _dampenGain.gain.linearRampToValueAtTime(0.9, now + ramp);
  } else {
    _dampenFilter.frequency.setValueAtTime(_dampenFilter.frequency.value, now);
    _dampenFilter.frequency.exponentialRampToValueAtTime(22050, now + ramp);
    _dampenGain.gain.setValueAtTime(_dampenGain.gain.value, now);
    _dampenGain.gain.linearRampToValueAtTime(1.0, now + ramp);
  }
}

/** Test-only helper: true if the dampen filter chain has been installed. */
export function isAmbientChainReady(): boolean {
  return _dampenFilter !== null && _dampenGain !== null;
}
