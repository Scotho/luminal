import { playUiForward, playUiBack, playUiJoin } from '../sfxAssets';
import { getCtx, getSfxOutput, getSfxVolume, noiseBuf } from '../sfxContext';

// ── Procedural UI Sounds ─────────────────────────────────
// Menu clicks, confirmations, tooltip chimes, navigation, lobby chimes,
// map-wheel feedback, countdown, notifications, chat blips.

// Re-export sample-based UI sounds so consumers can import from the UI module.
export {
  playUiBlip,
  playUiTab,
  playUiToggle,
  playUiCtxAction,
  playUiReadout,
  playUiMatchmaking,
  playUiMatchFound,
  playUiSettings,
  startRewardTally,
  playRewardTotal,
  playRewardLevelUp,
} from '../sfxAssets';

// ── Hover / Tick / Confirm ───────────────────────────────
export function playHover(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  // Soft sheen — quick filtered noise sweep
  const buf: AudioBuffer = noiseBuf(c, 0.08);
  const src: AudioBufferSourceNode = c.createBufferSource();
  src.buffer = buf;
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2000, now);
  bp.frequency.exponentialRampToValueAtTime(5000, now + 0.06);
  bp.Q.value = 2;
  const gain: GainNode = c.createGain();
  gain.gain.setValueAtTime(0.06 * getSfxVolume(), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  src.connect(bp);
  bp.connect(gain);
  gain.connect(getSfxOutput(c));
  src.start(now);
}

export function playTick(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  // Short subtle tick for timer countdown
  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(520, now);
  const gain: GainNode = c.createGain();
  gain.gain.setValueAtTime(0.08 * getSfxVolume(), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  osc.connect(gain);
  gain.connect(getSfxOutput(c));
  osc.start(now);
  osc.stop(now + 0.12);
}

export function playConfirm(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  // Quick two-tone boop
  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.setValueAtTime(900, now + 0.06);
  const gain: GainNode = c.createGain();
  gain.gain.setValueAtTime(0.12 * getSfxVolume(), now);
  gain.gain.setValueAtTime(0.1 * getSfxVolume(), now + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(gain);
  gain.connect(getSfxOutput(c));
  osc.start(now);
  osc.stop(now + 0.15);
}

// ── Navigate Sound (screen transitions) ──────────────────
// Swooshy filtered noise — like air moving past
export function playNavigate(): void {
  playUiForward();
}

export function playNavigateBack(): void {
  playUiBack();
}

// ── Notification Chime ───────────────────────────────────
// Two-note ascending chime — gentle alert
export function playNotif(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.10 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  master.connect(getSfxOutput(c));
  // First note
  const osc1: OscillatorNode = c.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(880, now);
  const g1: GainNode = c.createGain();
  g1.gain.setValueAtTime(0.8, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc1.connect(g1);
  g1.connect(master);
  osc1.start(now);
  osc1.stop(now + 0.18);
  // Second note (higher, slightly delayed)
  const osc2: OscillatorNode = c.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1320, now + 0.08);
  const g2: GainNode = c.createGain();
  g2.gain.setValueAtTime(0.001, now);
  g2.gain.setValueAtTime(0.6, now + 0.08);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.30);
  osc2.connect(g2);
  g2.connect(master);
  osc2.start(now + 0.08);
  osc2.stop(now + 0.35);
}

// ── Countdown Sound ──────────────────────────────────────
// Race-style: short punchy rev blip (3,2,1) + aggressive GO rev-up
export function playCountdown(isGo: boolean = false): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.35 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 1.0 : 0.3));
  master.connect(getSfxOutput(c));

  if (!isGo) {
    // 3, 2, 1: Clean beep tone (similar to button confirm) + sub thump
    // Beep tone
    const beep: OscillatorNode = c.createOscillator();
    beep.type = 'sine';
    beep.frequency.setValueAtTime(680, now);
    const beepG: GainNode = c.createGain();
    beepG.gain.setValueAtTime(0.18, now);
    beepG.gain.setValueAtTime(0.15, now + 0.05);
    beepG.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    beep.connect(beepG);
    beepG.connect(master);
    beep.start(now);
    beep.stop(now + 0.2);

    // Sub thump for weight
    const thud: OscillatorNode = c.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(90, now);
    thud.frequency.exponentialRampToValueAtTime(50, now + 0.15);
    const thudG: GainNode = c.createGain();
    thudG.gain.setValueAtTime(0.3, now);
    thudG.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    thud.connect(thudG);
    thudG.connect(master);
    thud.start(now);
    thud.stop(now + 0.25);
  } else {
    // GO: Aggressive engine rev-up with sci-fi layer
    // Rev sweep — sawtooth through low-pass for engine growl
    const rev: OscillatorNode = c.createOscillator();
    rev.type = 'sawtooth';
    rev.frequency.setValueAtTime(60, now);
    rev.frequency.exponentialRampToValueAtTime(180, now + 0.3);
    rev.frequency.exponentialRampToValueAtTime(250, now + 0.6);
    const revLP: BiquadFilterNode = c.createBiquadFilter();
    revLP.type = 'lowpass';
    revLP.frequency.setValueAtTime(400, now);
    revLP.frequency.exponentialRampToValueAtTime(1200, now + 0.4);
    revLP.frequency.exponentialRampToValueAtTime(600, now + 0.8);
    const revG: GainNode = c.createGain();
    revG.gain.setValueAtTime(0.2, now);
    revG.gain.setValueAtTime(0.25, now + 0.3);
    revG.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    rev.connect(revLP);
    revLP.connect(revG);
    revG.connect(master);
    rev.start(now);
    rev.stop(now + 1.0);

    // Sub bass body
    const sub: OscillatorNode = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(40, now);
    sub.frequency.exponentialRampToValueAtTime(80, now + 0.4);
    const subG: GainNode = c.createGain();
    subG.gain.setValueAtTime(0.35, now);
    subG.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    sub.connect(subG);
    subG.connect(master);
    sub.start(now);
    sub.stop(now + 0.8);

    // Sci-fi accent: quick filtered sweep
    const sci: OscillatorNode = c.createOscillator();
    sci.type = 'square';
    sci.frequency.setValueAtTime(150, now);
    sci.frequency.exponentialRampToValueAtTime(500, now + 0.15);
    sci.frequency.exponentialRampToValueAtTime(300, now + 0.3);
    const sciLP: BiquadFilterNode = c.createBiquadFilter();
    sciLP.type = 'lowpass';
    sciLP.frequency.value = 800;
    const sciG: GainNode = c.createGain();
    sciG.gain.setValueAtTime(0.06, now);
    sciG.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    sci.connect(sciLP);
    sciLP.connect(sciG);
    sciG.connect(master);
    sci.start(now);
    sci.stop(now + 0.4);

    // Noise whoosh for the rush feeling
    const whooshSrc: AudioBufferSourceNode = c.createBufferSource();
    whooshSrc.buffer = noiseBuf(c, 0.6);
    const whooshLP: BiquadFilterNode = c.createBiquadFilter();
    whooshLP.type = 'lowpass';
    whooshLP.frequency.setValueAtTime(200, now);
    whooshLP.frequency.exponentialRampToValueAtTime(600, now + 0.3);
    whooshLP.frequency.exponentialRampToValueAtTime(150, now + 0.6);
    const whooshG: GainNode = c.createGain();
    whooshG.gain.setValueAtTime(0.12, now);
    whooshG.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    whooshSrc.connect(whooshLP);
    whooshLP.connect(whooshG);
    whooshG.connect(master);
    whooshSrc.start(now);
  }
}

// ── Chat Message Blip ───────────────────────────────────
// Quick soft blip — lower pitch than notif, very short
export function playChat(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, now);
  osc.frequency.exponentialRampToValueAtTime(520, now + 0.04);
  const gain: GainNode = c.createGain();
  gain.gain.setValueAtTime(0.07 * getSfxVolume(), now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  osc.connect(gain);
  gain.connect(getSfxOutput(c));
  osc.start(now);
  osc.stop(now + 0.1);
}

// ── Lobby Join ──────────────────────────────────────────
export function playLobbyJoin(): void {
  playUiJoin();
}

// ── Lobby Leave ─────────────────────────────────────────
// Descending mirror of join
export function playLobbyLeave(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.08 * getSfxVolume(), now);
  master.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  master.connect(getSfxOutput(c));
  const osc1: OscillatorNode = c.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(800, now);
  const g1: GainNode = c.createGain();
  g1.gain.setValueAtTime(0.6, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  osc1.connect(g1);
  g1.connect(master);
  osc1.start(now);
  osc1.stop(now + 0.12);
  const osc2: OscillatorNode = c.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(500, now + 0.06);
  const g2: GainNode = c.createGain();
  g2.gain.setValueAtTime(0.001, now);
  g2.gain.setValueAtTime(0.5, now + 0.06);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc2.connect(g2);
  g2.connect(master);
  osc2.start(now + 0.06);
  osc2.stop(now + 0.25);
}

// ── Error / Rejected ────────────────────────────────────
// Short buzzy rejected tone
// ts-prune-ignore-next
export function playError(): void {
  playUiBack();
}

// ── Map Wheel Sounds ────────────────────────────────────

/** Rising filtered noise sweep — hologram boot-up. */
export function playWheelBoot(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.15 * getSfxVolume(), now);
  master.connect(getSfxOutput(c));

  // Noise sweep 200Hz → 2kHz
  const buf: AudioBuffer = noiseBuf(c, 1.0);
  const src: AudioBufferSourceNode = c.createBufferSource();
  src.buffer = buf;
  const bp: BiquadFilterNode = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(200, now);
  bp.frequency.exponentialRampToValueAtTime(2000, now + 0.8);
  bp.Q.value = 1.5;
  const nG: GainNode = c.createGain();
  nG.gain.setValueAtTime(0.8, now);
  nG.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
  src.connect(bp);
  bp.connect(nG);
  nG.connect(master);
  src.start(now);

  // Digital ping
  const ping: OscillatorNode = c.createOscillator();
  ping.type = 'sine';
  ping.frequency.setValueAtTime(3000, now + 0.6);
  ping.frequency.exponentialRampToValueAtTime(2800, now + 0.7);
  const pG: GainNode = c.createGain();
  pG.gain.setValueAtTime(0, now);
  pG.gain.setValueAtTime(0.3, now + 0.6);
  pG.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
  ping.connect(pG);
  pG.connect(master);
  ping.start(now + 0.6);
  ping.stop(now + 0.8);
}

/** Tiny metallic click — one per slice boundary during spin. */
export function playWheelTick(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const osc: OscillatorNode = c.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1500, now);
  const g: GainNode = c.createGain();
  g.gain.setValueAtTime(0.08 * getSfxVolume(), now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
  osc.connect(g);
  g.connect(getSfxOutput(c));
  osc.start(now);
  osc.stop(now + 0.025);
}

/** Resonant metallic clunk — wheel locks into place. */
export function playWheelLock(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.2 * getSfxVolume(), now);
  master.connect(getSfxOutput(c));

  // Two detuned oscillators
  const o1: OscillatorNode = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.setValueAtTime(800, now);
  const g1: GainNode = c.createGain();
  g1.gain.setValueAtTime(0.6, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  o1.connect(g1);
  g1.connect(master);
  o1.start(now);
  o1.stop(now + 0.2);

  const o2: OscillatorNode = c.createOscillator();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(820, now);
  const g2: GainNode = c.createGain();
  g2.gain.setValueAtTime(0.4, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  o2.connect(g2);
  g2.connect(master);
  o2.start(now);
  o2.stop(now + 0.15);

  // Sub thud
  const sub: OscillatorNode = c.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(60, now);
  sub.frequency.exponentialRampToValueAtTime(30, now + 0.1);
  const sG: GainNode = c.createGain();
  sG.gain.setValueAtTime(0.5, now);
  sG.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  sub.connect(sG);
  sG.connect(master);
  sub.start(now);
  sub.stop(now + 0.2);
}

/** Short ascending two-note chord — winner revealed. */
export function playWheelReveal(): void {
  const c: AudioContext = getCtx();
  const now: number = c.currentTime;
  const master: GainNode = c.createGain();
  master.gain.setValueAtTime(0.12 * getSfxVolume(), now);
  master.connect(getSfxOutput(c));

  // Note 1
  const o1: OscillatorNode = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.setValueAtTime(523, now); // C5
  const g1: GainNode = c.createGain();
  g1.gain.setValueAtTime(0.5, now);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  o1.connect(g1);
  g1.connect(master);
  o1.start(now);
  o1.stop(now + 0.35);

  // Note 2 (delayed)
  const o2: OscillatorNode = c.createOscillator();
  o2.type = 'sine';
  o2.frequency.setValueAtTime(659, now + 0.1); // E5
  const g2: GainNode = c.createGain();
  g2.gain.setValueAtTime(0, now);
  g2.gain.setValueAtTime(0.5, now + 0.1);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  o2.connect(g2);
  g2.connect(master);
  o2.start(now);
  o2.stop(now + 0.45);
}
