// ── Sourced Sound Effects (audio file playback via Web Audio API) ──
// Loads .webm/.mp3 files into AudioBuffers for low-latency playback.
// Shares AudioContext with sfx.ts via getCtx().

import { getCtx, getSfxOutput, getSfxVolume } from './sfxContext';
import { getVehicleBuffer } from './vehicleSfxLoader';
import { getVehicleAudioProfile } from './vehicleAudioProfiles';
import type { VehicleType } from './types/index';

// ── Sound manifest ──────────────────────────────────────
// Each entry: name → path (relative to public root).
// .webm (Opus) preferred; .mp3 fallback for Safari < 16.4.
const MANIFEST: Record<string, string[]> = {
  driftEnter: ['/sfx/drift-enter.webm', '/sfx/drift-enter.mp3'],
  driftExit:  ['/sfx/drift-exit.webm', '/sfx/drift-exit.mp3'],
  nearMiss:   ['/sfx/near-miss.webm', '/sfx/near-miss.mp3'],
  explosion:  ['/sfx/explosion.webm', '/sfx/explosion.mp3'],
  achievement:['/sfx/achievement.webm', '/sfx/achievement.mp3'],
  winScreen:  ['/sfx/win-screen.webm', '/sfx/win-screen.mp3'],
  gameOver:   ['/sfx/game-over.webm', '/sfx/game-over.mp3'],
  matchPause: ['/sfx/match-pause.webm', '/sfx/match-pause.mp3'],
  bikeStart:  ['/sfx/bike-start.webm', '/sfx/bike-start.mp3'],
  carStart:   ['/sfx/car-start.webm', '/sfx/car-start.mp3'],
  // ── UI sounds (PremiumBeat Sci-Fi UI) ──
  uiBlip:       ['/sfx/ui/ui-blip.webm', '/sfx/ui/ui-blip.mp3'],
  uiBack:       ['/sfx/ui/ui-back.webm', '/sfx/ui/ui-back.mp3'],
  uiCtxAction:  ['/sfx/ui/ui-ctx-action.webm', '/sfx/ui/ui-ctx-action.mp3'],
  uiJoin:       ['/sfx/ui/ui-join.webm', '/sfx/ui/ui-join.mp3'],
  uiTab:        ['/sfx/ui/ui-tab.webm', '/sfx/ui/ui-tab.mp3'],
  uiToggle:     ['/sfx/ui/ui-toggle.webm', '/sfx/ui/ui-toggle.mp3'],
  uiForward:    ['/sfx/ui/ui-forward.webm', '/sfx/ui/ui-forward.mp3'],
  uiReadout:    ['/sfx/ui/ui-readout.webm', '/sfx/ui/ui-readout.mp3'],
  uiMatchmaking:['/sfx/ui/ui-matchmaking.webm', '/sfx/ui/ui-matchmaking.mp3'],
  uiMatchFound: ['/sfx/ui/ui-match-found.webm', '/sfx/ui/ui-match-found.mp3'],
  uiSettings:   ['/sfx/ui/ui-settings.webm', '/sfx/ui/ui-settings.mp3'],
  uiSlipstream: ['/sfx/ui/ui-slipstream.webm', '/sfx/ui/ui-slipstream.mp3'],
  // ── Reward reveal sounds (TASK-305) ──
  rewardTally:  ['/sfx/ui/reward-tally.webm', '/sfx/ui/reward-tally.mp3'],
  rewardTotal:  ['/sfx/ui/reward-total.webm', '/sfx/ui/reward-total.mp3'],
  rewardLevelUp:['/sfx/ui/reward-levelup.webm', '/sfx/ui/reward-levelup.mp3'],
};

// ── State ───────────────────────────────────────────────
const _buffers: Map<string, AudioBuffer> = new Map();
let _loaded = false;
// ts-prune-ignore-next
export function isLoaded(): boolean { return _loaded; }

// ── Preload ─────────────────────────────────────────────
// Call once at game init. Non-blocking — game starts immediately.
export async function preloadSfx(): Promise<void> {
  if (_loaded) return;
  const ctx = getCtx();
  const entries = Object.entries(MANIFEST);
  await Promise.allSettled(
    entries.map(async ([name, paths]) => {
      for (const path of paths) {
        try {
          const resp = await fetch(path);
          if (!resp.ok) continue;
          const arrayBuf = await resp.arrayBuffer();
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          _buffers.set(name, audioBuf);
          return;
        } catch {
          continue;
        }
      }
      // All paths failed — sound will no-op
    })
  );
  _loaded = true;
}

// ── Generic buffer playback ─────────────────────────────
export function playSfxBuffer(
  name: string,
  opts: { volume?: number; pitch?: number; dest?: AudioNode } = {}
): void {
  const buf = _buffers.get(name);
  if (!buf) return;
  const ctx = getCtx();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  if (opts.pitch) src.playbackRate.value = opts.pitch;
  const gain = ctx.createGain();
  gain.gain.value = (opts.volume ?? 1.0) * getSfxVolume();
  src.connect(gain);
  gain.connect(opts.dest ?? getSfxOutput(ctx));
  src.start();
}

// ── Individual sound exports ────────────────────────────
export function playDriftEnter(dest?: AudioNode): void {
  playSfxBuffer('driftEnter', { volume: 0.392, dest });
}

export function playDriftExit(dest?: AudioNode): void {
  playSfxBuffer('driftExit', { volume: 0.476, dest });
}

export function playExplosionSourced(dest?: AudioNode): void {
  playSfxBuffer('explosion', { dest });
}

export function playWinScreen(): void {
  playSfxBuffer('winScreen', { volume: 0.9 });
}

export function playGameOver(): void {
  playSfxBuffer('gameOver', { volume: 0.9 });
}

export function playMatchPause(): void {
  playSfxBuffer('matchPause', { volume: 0.8 });
}

export function playVehicleStart(vehicleType: VehicleType): void {
  // Try vehicle-specific startup sound from the new loader
  try {
    const profile = getVehicleAudioProfile(vehicleType);
    if (profile.startup) {
      const buf = getVehicleBuffer(vehicleType, profile.startup);
      if (buf) {
        const ctx = getCtx();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = 0.85 * getSfxVolume();
        src.connect(gain);
        gain.connect(getSfxOutput(ctx));
        src.start();
        return;
      }
    }
  } catch { /* fall through to legacy */ }
  // Fallback to existing sounds
  playSfxBuffer(vehicleType === 'car' ? 'carStart' : 'bikeStart', { volume: 0.85 });
}

// ── Near-miss crackle (looping) ─────────────────────────
// Legacy near-miss crackle was removed; stopNearMiss is kept as a no-op
// because game.ts still calls it defensively on state transitions.
export function stopNearMiss(): void { /* no-op */ }

// ── UI Sound Exports (PremiumBeat Sci-Fi UI) ────────────

export function playUiBlip(): void {
  playSfxBuffer('uiBlip', { volume: 0.5 });
}

export function playUiBack(): void {
  playSfxBuffer('uiBack', { volume: 0.55 });
}

export function playUiCtxAction(): void {
  playSfxBuffer('uiCtxAction', { volume: 0.6 });
}

export function playUiJoin(): void {
  playSfxBuffer('uiJoin', { volume: 0.7 });
}

export function playUiTab(): void {
  playSfxBuffer('uiTab', { volume: 0.5 });
}

export function playUiToggle(): void {
  playSfxBuffer('uiToggle', { volume: 0.55 });
}

export function playUiForward(): void {
  playSfxBuffer('uiForward', { volume: 0.55 });
}

export function playUiReadout(): void {
  playSfxBuffer('uiReadout', { volume: 0.4 });
}

export function playUiMatchmaking(): void {
  playSfxBuffer('uiMatchmaking', { volume: 0.3 });
}

export function playUiMatchFound(): void {
  playSfxBuffer('uiMatchFound', { volume: 0.6 });
}

export function playUiSettings(): void {
  playSfxBuffer('uiSettings', { volume: 0.4 });
}

// ts-prune-ignore-next
export function playUiSlipstream(): void {
  playSfxBuffer('uiSlipstream', { volume: 0.45 });
}

// ── Reward Reveal SFX (TASK-305) ────────────────────────

/**
 * Start the continuous tally sound. Returns a stop function that fades out
 * over `fadeMs` milliseconds. The sound plays from the beginning each call.
 */
export function startRewardTally(opts: { volume?: number; fadeMs?: number } = {}): () => void {
  const buf = _buffers.get('rewardTally');
  if (!buf) return () => {};
  const ctx = getCtx();
  const gain = ctx.createGain();
  const vol = (opts.volume ?? 0.35) * getSfxVolume();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.connect(getSfxOutput(ctx));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.start();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const fadeMs = opts.fadeMs ?? 250;
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeMs / 1000);
    setTimeout(() => { try { src.stop(); } catch { /* already stopped */ } }, fadeMs + 50);
  };
}

export function playRewardTotal(): void {
  playSfxBuffer('rewardTotal', { volume: 0.55 });
}

export function playRewardLevelUp(): void {
  playSfxBuffer('rewardLevelUp', { volume: 0.6 });
}
