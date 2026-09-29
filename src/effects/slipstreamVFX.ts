/**
 * SPEC-93: SPECTRE slipstream visual phase state machine.
 *
 * Manages phased ramp-up for slipstream: idle → entry → lockIn → active → exit → idle.
 * FLOW ticks only in 'active' phase (after 1.0s in proximity).
 * Visual/audio/control changes driven by phase (handled by callers).
 */

export type SlipstreamPhase = 'idle' | 'entry' | 'lockIn' | 'active' | 'exit';

export interface SlipstreamPhaseState {
  phase: SlipstreamPhase;
  phaseStart: number;
  proximityBoost: number;
  active: boolean;
}

// ── Phase timing thresholds (seconds) ───────────────────────────
const ENTRY_DURATION = 0.3;
const LOCKIN_DURATION = 0.7;   // lockIn starts at 0.3s, active at 1.0s
const EXIT_DURATION = 0.25;
const PROXIMITY_THRESHOLD = 0.3;

// ── Creation ────────────────────────────────────────────────────

export function createSlipstreamPhaseState(): SlipstreamPhaseState {
  return {
    phase: 'idle',
    phaseStart: 0,
    proximityBoost: 0,
    active: false,
  };
}

// ── Phase update ────────────────────────────────────────────────

export function updateSlipstreamPhase(
  state: SlipstreamPhaseState,
  proximityBoost: number,
  now: number,
): SlipstreamPhase {
  state.proximityBoost = proximityBoost;
  const inProximity = proximityBoost > PROXIMITY_THRESHOLD;
  const elapsed = (now - state.phaseStart) / 1000;

  switch (state.phase) {
    case 'idle':
      if (inProximity) {
        state.phase = 'entry';
        state.phaseStart = now;
      }
      break;

    case 'entry':
      if (!inProximity) {
        state.phase = 'exit';
        state.phaseStart = now;
      } else if (elapsed >= ENTRY_DURATION) {
        state.phase = 'lockIn';
        state.phaseStart = now;
      }
      break;

    case 'lockIn':
      if (!inProximity) {
        state.phase = 'exit';
        state.phaseStart = now;
      } else if (elapsed >= LOCKIN_DURATION) {
        state.phase = 'active';
        state.phaseStart = now;
      }
      break;

    case 'active':
      if (!inProximity) {
        state.phase = 'exit';
        state.phaseStart = now;
      }
      break;

    case 'exit':
      if (inProximity) {
        // Re-entering proximity during exit → back to entry
        state.phase = 'entry';
        state.phaseStart = now;
      } else if (elapsed >= EXIT_DURATION) {
        state.phase = 'idle';
        state.phaseStart = now;
      }
      break;
  }

  state.active = state.phase === 'active';
  return state.phase;
}

// ── Selectors ───────────────────────────────────────────────────

export function shouldGeneratePassiveFlow(state: SlipstreamPhaseState): boolean {
  return state.phase === 'active';
}

/**
 * Returns speed-line intensity for the current phase.
 * Used to drive the existing SpeedLineSystem.
 */
export function getSlipstreamIntensity(state: SlipstreamPhaseState, now: number): number {
  const elapsed = (now - state.phaseStart) / 1000;

  switch (state.phase) {
    case 'idle': return 0;
    case 'entry': return Math.min(0.6, (elapsed / ENTRY_DURATION) * 0.6);
    case 'lockIn': return Math.min(1.0, 0.6 + (elapsed / LOCKIN_DURATION) * 0.4);
    case 'active': return 1.0;
    case 'exit': return Math.max(0, 1.0 - (elapsed / EXIT_DURATION) * 0.5);
    default: return 0;
  }
}

/**
 * Returns the CSS body class for the current phase.
 */
export function getSlipstreamBodyClass(state: SlipstreamPhaseState): string | null {
  switch (state.phase) {
    case 'entry': return 'slipstream-phase-entry';
    case 'lockIn': return 'slipstream-phase-lockin';
    case 'active': return 'slipstream-phase-active';
    default: return null;
  }
}

/**
 * Returns chromatic aberration strength (0-1) for the current phase.
 */
export function getChromaticStrength(state: SlipstreamPhaseState, now: number): number {
  const elapsed = (now - state.phaseStart) / 1000;

  switch (state.phase) {
    case 'idle':
    case 'entry': return 0;
    case 'lockIn': return Math.min(1.0, elapsed / LOCKIN_DURATION);
    case 'active': return 1.0;
    case 'exit': return Math.max(0, 1.0 - elapsed / EXIT_DURATION);
    default: return 0;
  }
}
