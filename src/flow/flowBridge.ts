/**
 * SPEC-89/90: Bridge between game state and the FLOW scoring system.
 *
 * Reads player state each frame to drive passive ticks, bonus accumulation,
 * and pending bank spawning. Keeps the flow module decoupled from game internals.
 */

import {
  tickPassive,
  tickSurvival,
  tickBoost,
  awardElimination,
  awardNearMiss,
  beginRound as flowBeginRound,
  endRound as flowEndRound,
  spawnPendingBank,
  type FlowState,
} from './flowState';
import { FLOW_TICK_INTERVAL_SEC } from './flowTuning';
import type { PassiveSource } from './flowTypes';
import type { RoundResult } from './flowTypes';

// ── Per-source passive accumulators (seconds since last tick) ────

interface FlowAccumulators {
  slipstream: number;
  grind: number;
  drift: number;
  survival: number;
  boost: number;
}

let accum: FlowAccumulators = createAccumulators();
let driftTallyThisStretch = 0;
let slipstreamTallyThisStretch = 0;
let grindTallyThisStretch = 0;
let wasDrifting = false;
let wasSlipstreaming = false;
let wasGrinding = false;

// ── Near-miss detection state ───────────────────────────────────

/** Death distance — must match HIT_RADIUS in simulation.ts */
const NEAR_MISS_HIT_RADIUS = 0.8;
/** Near-miss triggers when distance is between HIT_RADIUS and this value */
const NEAR_MISS_RANGE = 2.5;
/** Cooldown between near-miss awards (ms) */
const NEAR_MISS_COOLDOWN_MS = 1000;
/** Minimum speed to qualify for near-miss (prevents stationary cheese) */
const NEAR_MISS_MIN_SPEED = 20;

let lastNearMissAt = 0;
let wasInNearMissZone = false;

function createAccumulators(): FlowAccumulators {
  return { slipstream: 0, grind: 0, drift: 0, survival: 0, boost: 0 };
}

// ── Public API ──────────────────────────────────────────────────

/** Max vehicle speed used for drift intensity normalization */
const DRIFT_MAX_SPEED = 110;

export interface PlayerFlowState {
  alive: boolean;
  drifting: boolean;
  grinding: boolean;
  dashing: boolean;
  proximitySpeedBoost: number;
  slipAngle: number;
  speed: number;
  vehicleType: 'bike' | 'car' | 'hoverboard';
  /** Nearest trail distance (any trail, including own). -1 if unavailable. */
  nearestTrailDist: number;
}

/**
 * Called when a round begins. Resets accumulators and initializes flow state.
 */
export function bridgeBeginRound(
  flowState: FlowState,
  matchStreak: number,
  now: number,
): void {
  flowBeginRound(flowState, matchStreak as 0 | 1 | 2 | 3, now);
  accum = createAccumulators();
  driftTallyThisStretch = 0;
  slipstreamTallyThisStretch = 0;
  grindTallyThisStretch = 0;
  wasDrifting = false;
  wasSlipstreaming = false;
  wasGrinding = false;
  lastNearMissAt = 0;
  wasInNearMissZone = false;
}

/**
 * Called when a round ends.
 */
export function bridgeEndRound(
  flowState: FlowState,
  outcome: 'won' | 'died',
): RoundResult {
  return flowEndRound(flowState, outcome);
}

/**
 * Called when player eliminates an opponent.
 */
export function bridgeElimination(flowState: FlowState, now: number): void {
  awardElimination(flowState, now);
}

/**
 * Called every frame while playing. Reads player state and drives flow ticks.
 */
export function bridgeFrameTick(
  flowState: FlowState,
  player: PlayerFlowState,
  dtSec: number,
  now: number,
): void {
  if (!player.alive) return;

  // ── Passive: Drift (SLINGSHOT car) ────────────────────────
  if (player.drifting && player.vehicleType === 'car') {
    accum.drift += dtSec;
    const source = getDriftSource(player);
    while (accum.drift >= FLOW_TICK_INTERVAL_SEC) {
      accum.drift -= FLOW_TICK_INTERVAL_SEC;
      tickPassive(flowState, source, now);
      driftTallyThisStretch += 1; // track for bank display
    }
    wasDrifting = true;
  } else {
    if (wasDrifting && driftTallyThisStretch > 0) {
      // Drift ended — spawn visual bank
      spawnPendingBank(flowState, 'drift', driftTallyThisStretch * 4, now); // approx value
      driftTallyThisStretch = 0;
    }
    accum.drift = 0;
    wasDrifting = false;
  }

  // ── Passive: Slipstream (SPECTRE bike) ────────────────────
  const isSlipstreaming = player.proximitySpeedBoost > 0.3 && player.vehicleType === 'bike';
  if (isSlipstreaming) {
    accum.slipstream += dtSec;
    while (accum.slipstream >= FLOW_TICK_INTERVAL_SEC) {
      accum.slipstream -= FLOW_TICK_INTERVAL_SEC;
      tickPassive(flowState, 'slipstream', now);
      slipstreamTallyThisStretch += 1;
    }
    wasSlipstreaming = true;
  } else {
    if (wasSlipstreaming && slipstreamTallyThisStretch > 0) {
      spawnPendingBank(flowState, 'slipstream', slipstreamTallyThisStretch * 5, now);
      slipstreamTallyThisStretch = 0;
    }
    accum.slipstream = 0;
    wasSlipstreaming = false;
  }

  // ── Passive: Grind (VECTOR hoverboard) ────────────────────
  if (player.grinding && player.vehicleType === 'hoverboard') {
    accum.grind += dtSec;
    while (accum.grind >= FLOW_TICK_INTERVAL_SEC) {
      accum.grind -= FLOW_TICK_INTERVAL_SEC;
      tickPassive(flowState, 'grind', now);
      grindTallyThisStretch += 1;
    }
    wasGrinding = true;
  } else {
    if (wasGrinding && grindTallyThisStretch > 0) {
      spawnPendingBank(flowState, 'grind', grindTallyThisStretch * 5, now);
      grindTallyThisStretch = 0;
    }
    accum.grind = 0;
    wasGrinding = false;
  }

  // ── Bonus: Survival (always while alive) ──────────────────
  tickSurvival(flowState, dtSec, now);

  // ── Bonus: Boost (while dashing) ──────────────────────────
  if (player.dashing) {
    tickBoost(flowState, dtSec, now);
  }

  // ── Bonus: Near-miss (+40) ────────────────────────────────
  // Triggers when player passes through the danger zone (just outside kill
  // radius) at speed, then exits it alive. Awards on *exit* so grinding
  // along a wall doesn't spam awards — you only get it when you survive
  // the close call.
  if (player.nearestTrailDist >= 0 && player.speed >= NEAR_MISS_MIN_SPEED) {
    const inZone = player.nearestTrailDist > NEAR_MISS_HIT_RADIUS
                && player.nearestTrailDist < NEAR_MISS_RANGE;
    if (wasInNearMissZone && !inZone && (now - lastNearMissAt) >= NEAR_MISS_COOLDOWN_MS) {
      // Exited the near-miss zone alive — award!
      awardNearMiss(flowState, now);
      lastNearMissAt = now;
    }
    wasInNearMissZone = inZone;
  }
}

// ── Testing helper ──────────────────────────────────────────────

export function _resetBridgeForTesting(): void {
  accum = createAccumulators();
  driftTallyThisStretch = 0;
  slipstreamTallyThisStretch = 0;
  grindTallyThisStretch = 0;
  wasDrifting = false;
  wasSlipstreaming = false;
  wasGrinding = false;
  lastNearMissAt = 0;
  wasInNearMissZone = false;
}

// ── Private helpers ─────────────────────────────────────────────

function getDriftSource(player: PlayerFlowState): PassiveSource {
  const slipAngle = Math.abs(player.slipAngle);
  const speedNorm = player.speed / DRIFT_MAX_SPEED;
  const score = slipAngle * speedNorm;
  if (score > 0.45) return 'drift-high';
  if (score > 0.25) return 'drift-med';
  return 'drift-low';
}
