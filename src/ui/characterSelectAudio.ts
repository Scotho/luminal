// ── Character Select Showroom Audio ─────────────────────
// Pure audio module for the loadout screen's engine rev preview.
// No DOM access — only Web Audio API + vehicle engine APIs.

import type { VehicleType } from '../types/index';
import { preloadVehicleAudio } from '../vehicleSfxLoader';
import { startVehicleEngine, updateVehicleEngine, stopVehicleEngine } from '../vehicleAudioEngine';
import { getCtx, getSfxOutput } from '../sfxContext';

const SHOWROOM_VOLUME = 0.9; // 10% quieter than normal SFX
const SHOWROOM_MAX_DURATION = 5; // seconds — hard cap on showroom playback
const SHOWROOM_FADE_DURATION = 0.75; // seconds — fade-out ramp time
const SHOWROOM_SWITCH_FADE = 0.25; // seconds — quick crossfade when switching vehicles

let _showroomGain: GainNode | null = null;
let _outgoingGain: GainNode | null = null; // tracks gain being crossfaded out so exit can disconnect it
let _revTimer: ReturnType<typeof setTimeout> | null = null;
let _revRafId = 0;
let _revPhase: 'idle' | 'rev-up' | 'rev-hold' | 'rev-down' | 'done' = 'done';
let _revT = 0;
let _revCount = 0;
let _showroomGeneration = 0; // cancellation guard for async preload
let _showroomMaxTimer: ReturnType<typeof setTimeout> | null = null;
let _crossfadeTimer: ReturnType<typeof setTimeout> | null = null;
let _revLastTime = 0;

function _stopShowroomEngine(): void {
  const gen = ++_showroomGeneration; // invalidate any in-flight preload callbacks
  if (import.meta.env.DEV) console.log(`[SHOWROOM] _stopShowroomEngine gen=${gen} gainNode=${!!_showroomGain} strategy=${!!_revPhase}`);
  if (_revTimer) { clearTimeout(_revTimer); _revTimer = null; }
  if (_showroomMaxTimer) { clearTimeout(_showroomMaxTimer); _showroomMaxTimer = null; }
  if (_crossfadeTimer) { clearTimeout(_crossfadeTimer); _crossfadeTimer = null; }
  if (_revRafId) { cancelAnimationFrame(_revRafId); _revRafId = 0; }
  _revPhase = 'done';
  stopVehicleEngine(true);
  if (_showroomGain) {
    _showroomGain.disconnect();
    _showroomGain = null;
  }
}

/** Fade out the showroom gain over SHOWROOM_FADE_DURATION, then fully stop. */
function _fadeOutShowroom(): void {
  if (!_showroomGain) { _stopShowroomEngine(); return; }
  try {
    const ctx = getCtx();
    const now = ctx.currentTime;
    _showroomGain.gain.cancelScheduledValues(now);
    _showroomGain.gain.setValueAtTime(_showroomGain.gain.value, now);
    _showroomGain.gain.linearRampToValueAtTime(0, now + SHOWROOM_FADE_DURATION);
  } catch { /* expected: audio ctx may be closed during showroom fade */ }
  // Stop fully after the fade completes
  _showroomMaxTimer = setTimeout(() => _stopShowroomEngine(), SHOWROOM_FADE_DURATION * 1000 + 50);
}

function _beginRevSequence(): void {
  _revCount = 0;
  _nextRev();
}

function _nextRev(): void {
  if (_revCount >= 3) {
    // Settle back to idle
    _revPhase = 'idle';
    _revRafId = requestAnimationFrame(_revLoop);
    return;
  }
  _revCount++;
  _revPhase = 'rev-up';
  _revT = 0;
  _revRafId = requestAnimationFrame(_revLoop);
}

function _revLoop(now: number): void {
  if (_revPhase === 'done') return;
  const dt = _revLastTime ? Math.min(0.05, (now - _revLastTime) / 1000) : 1 / 60;
  _revLastTime = now;
  _revT += dt;

  switch (_revPhase) {
    case 'rev-up': {
      // Snappy ramp from idle to rev peak over 0.2s
      const progress = Math.min(1, _revT / 0.2);
      const factor = 1.0 + progress * 1.5; // idle(1.0) → rev peak(2.5)
      updateVehicleEngine(factor, true);
      if (progress >= 1) {
        _revPhase = 'rev-hold';
        _revT = 0;
      }
      break;
    }
    case 'rev-hold': {
      // Brief hold at peak (0.1s)
      updateVehicleEngine(2.5, true);
      if (_revT >= 0.1) {
        _revPhase = 'rev-down';
        _revT = 0;
      }
      break;
    }
    case 'rev-down': {
      // Quick decel back to idle over 0.25s
      const progress = Math.min(1, _revT / 0.25);
      const factor = 2.5 - progress * 1.5; // rev peak(2.5) → idle(1.0)
      updateVehicleEngine(factor, false);
      if (progress >= 1) {
        _revPhase = 'done';
        // Short pause before next rev
        _revTimer = setTimeout(() => _nextRev(), 150);
        // don't request another frame
        return;
      }
      break;
    }
    case 'idle': {
      updateVehicleEngine(1.0, false);
      break;
    }
  }
  _revRafId = requestAnimationFrame(_revLoop);
}

/** Start the showroom engine for the given vehicle. Crossfades if one is already playing. */
export function startShowroomEngine(vehicle: VehicleType): void {
  const wasRunning = _showroomGain !== null;
  const gen = ++_showroomGeneration;
  if (import.meta.env.DEV) console.log(`[SHOWROOM] startShowroomEngine vehicle=${vehicle} gen=${gen} wasRunning=${wasRunning}`);
  if (_revTimer) { clearTimeout(_revTimer); _revTimer = null; }
  if (_showroomMaxTimer) { clearTimeout(_showroomMaxTimer); _showroomMaxTimer = null; }
  if (_crossfadeTimer) { clearTimeout(_crossfadeTimer); _crossfadeTimer = null; }
  if (_revRafId) { cancelAnimationFrame(_revRafId); _revRafId = 0; }
  _revPhase = 'done';

  const startNew = () => {
    if (gen !== _showroomGeneration) {
      if (import.meta.env.DEV) console.log(`[SHOWROOM] startNew SKIPPED — stale gen=${gen} current=${_showroomGeneration}`);
      return;
    }
    preloadVehicleAudio(vehicle).then(() => {
      if (gen !== _showroomGeneration) {
        if (import.meta.env.DEV) console.log(`[SHOWROOM] preload callback SKIPPED — stale gen=${gen} current=${_showroomGeneration}`);
        return;
      }
      if (import.meta.env.DEV) console.log(`[SHOWROOM] engine START vehicle=${vehicle} gen=${gen}`);
      const ctx = getCtx();
      _showroomGain = ctx.createGain();
      _showroomGain.gain.value = SHOWROOM_VOLUME;
      _showroomGain.connect(getSfxOutput(ctx));
      startVehicleEngine(vehicle, _showroomGain);
      updateVehicleEngine(0, false);
      const revDelay = vehicle === 'car' ? 1600 : vehicle === 'bike' ? 900 : 300;
      _revTimer = setTimeout(() => {
        if (gen !== _showroomGeneration) return;
        _beginRevSequence();
      }, revDelay);
      _showroomMaxTimer = setTimeout(() => {
        if (gen !== _showroomGeneration) return;
        _fadeOutShowroom();
      }, SHOWROOM_MAX_DURATION * 1000);
    });
  };

  // If a showroom engine is currently running, fade it out first.
  // If not, just clean up timers and proceed immediately.
  if (wasRunning) {
    const oldGain = _showroomGain!;
    _showroomGain = null; // detach so _stopShowroomEngine doesn't double-disconnect
    if (_outgoingGain) { try { _outgoingGain.disconnect(); } catch { /* already disconnected */ } }
    // Track outgoing gain so onCharacterSelectExit can disconnect if crossfade is cancelled
    _outgoingGain = oldGain;
    try {
      const ctx = getCtx();
      const now = ctx.currentTime;
      oldGain.gain.cancelScheduledValues(now);
      oldGain.gain.setValueAtTime(oldGain.gain.value, now);
      oldGain.gain.linearRampToValueAtTime(0, now + SHOWROOM_SWITCH_FADE);
    } catch { /* expected: audio ctx may be closed during crossfade */ }
    // Stop old engine after fade, then start new
    _crossfadeTimer = setTimeout(() => {
      _crossfadeTimer = null;
      stopVehicleEngine(true);
      try { oldGain.disconnect(); } catch { /* already disconnected */ }
      _outgoingGain = null;
      startNew();
    }, SHOWROOM_SWITCH_FADE * 1000 + 20);
  } else {
    // No engine running — stop any lingering state and start immediately
    stopVehicleEngine(true);
    startNew();
  }
}

/** Immediate hard-stop for screen exit — no async fade. */
export function stopShowroomEngineHard(): void {
  const gen = ++_showroomGeneration;
  if (import.meta.env.DEV) console.log(`[SHOWROOM] EXIT gen=${gen} gainNode=${!!_showroomGain} outgoing=${!!_outgoingGain} crossfade=${!!_crossfadeTimer} revPhase=${_revPhase}`);
  // Kill all pending timers / RAF so nothing re-triggers after we leave
  if (_crossfadeTimer) { clearTimeout(_crossfadeTimer); _crossfadeTimer = null; }
  if (_revTimer) { clearTimeout(_revTimer); _revTimer = null; }
  if (_showroomMaxTimer) { clearTimeout(_showroomMaxTimer); _showroomMaxTimer = null; }
  if (_revRafId) { cancelAnimationFrame(_revRafId); _revRafId = 0; }
  _revPhase = 'done';
  // Disconnect ALL gain nodes immediately — both active and any orphaned by crossfade
  if (_showroomGain) { try { _showroomGain.disconnect(); } catch { /* already disconnected */ } }
  _showroomGain = null;
  if (_outgoingGain) { try { _outgoingGain.disconnect(); } catch { /* already disconnected */ } }
  _outgoingGain = null;
  // Hard-stop engine immediately (no async fade — we're leaving the screen)
  stopVehicleEngine(true);
  if (import.meta.env.DEV) console.log(`[SHOWROOM] EXIT complete — engine stopped`);
}

// ── For testing ──────────────────────────────────────────

/** Reset all module-level state. Call between tests to prevent state leakage. */
export function _resetForTesting(): void {
  stopShowroomEngineHard();
  _revT = 0;
  _revCount = 0;
  _showroomGeneration = 0;
  _revLastTime = 0;
}
