/**
 * SPEC-89: Core FLOW scoring accumulator.
 *
 * Pure logic — no DOM, no Firebase. Fully unit-testable with deterministic output.
 * Accumulates in-match FLOW, applies streak multiplier at round end, enforces caps.
 */

import {
  FLOW_TICK_AMOUNT,
  FLOW_BONUS,
  FLOW_SOFT_CAP,
  FLOW_HARD_CAP,
} from './flowTuning';
import { getFlowMultiplier } from './flowMultiplier';
import type {
  PassiveSource,
  BankSource,
  CapState,
  FlowSnapshot,
  PendingBank,
  TrickLogEntry,
  RoundResult,
} from './flowTypes';

// ── Internal state ──────────────────────────────────────────────

interface TrickEvent {
  kind: TrickLogEntry['kind'];
  amount: number;
}

export interface FlowState {
  active: number;
  passiveSubtotal: number;
  bonusSubtotal: number;
  tierIndex: 0 | 1 | 2 | 3;
  multiplier: number;
  capState: CapState;
  lastGainAmount: number;
  lastGainAt: number;
  pendingBanks: PendingBank[];
  nextBankId: number;
  trickEvents: TrickEvent[];
  roundActive: boolean;
}

// ── Creation ────────────────────────────────────────────────────

export function createFlowState(): FlowState {
  return {
    active: 0,
    passiveSubtotal: 0,
    bonusSubtotal: 0,
    tierIndex: 0,
    multiplier: 1,
    capState: 'open',
    lastGainAmount: 0,
    lastGainAt: 0,
    pendingBanks: [],
    nextBankId: 1,
    trickEvents: [],
    roundActive: false,
  };
}

// ── Cap-aware gain helper ───────────────────────────────────────

function applyGain(state: FlowState, amount: number, now: number): number {
  if (amount <= 0) return 0;
  if (state.active >= FLOW_HARD_CAP) {
    state.capState = 'hard';
    return 0;
  }

  let gained: number;

  if (state.active + amount <= FLOW_SOFT_CAP) {
    gained = amount;
    state.active += amount;
  } else if (state.active < FLOW_HARD_CAP) {
    const over = (state.active + amount) - FLOW_SOFT_CAP;
    const compressed = Math.sqrt(over * (FLOW_HARD_CAP - FLOW_SOFT_CAP));
    const newActive = Math.min(FLOW_HARD_CAP, FLOW_SOFT_CAP + compressed);
    gained = newActive - state.active;
    state.active = newActive;
    state.capState = state.active >= FLOW_HARD_CAP ? 'hard' : 'soft';
  } else {
    gained = 0;
  }

  if (gained > 0) {
    state.lastGainAmount = gained;
    state.lastGainAt = now;
  }

  return gained;
}

// ── Round lifecycle ─────────────────────────────────────────────

export function beginRound(
  state: FlowState,
  matchStreakTier: 0 | 1 | 2 | 3,
  now: number,
): void {
  state.active = 0;
  state.passiveSubtotal = 0;
  state.bonusSubtotal = 0;
  state.capState = 'open';
  state.lastGainAmount = 0;
  state.lastGainAt = 0;
  state.pendingBanks = [];
  state.trickEvents = [];
  state.roundActive = true;

  // Lock multiplier from current streak
  const mult = getFlowMultiplier(matchStreakTier);
  state.tierIndex = mult.tier;
  state.multiplier = mult.multiplier;
}

export function endRound(
  state: FlowState,
  outcome: 'won' | 'died',
): RoundResult {
  state.roundActive = false;

  const subtotal = state.passiveSubtotal + state.bonusSubtotal;
  const died = outcome === 'died';

  let awarded: number;
  let capApplied: RoundResult['capApplied'] = 'none';

  if (died) {
    awarded = 0;
  } else {
    const raw = Math.floor(subtotal * state.multiplier);
    if (raw < FLOW_SOFT_CAP) {
      awarded = raw;
    } else if (raw < FLOW_HARD_CAP) {
      awarded = raw;
      capApplied = 'soft';
    } else {
      awarded = FLOW_HARD_CAP;
      capApplied = 'hard';
    }
  }

  return {
    passiveSubtotal: state.passiveSubtotal,
    bonusSubtotal: state.bonusSubtotal,
    subtotal,
    multiplier: state.multiplier,
    tierIndex: state.tierIndex,
    awarded,
    capApplied,
    died,
    trickLog: buildTrickLog(state.trickEvents),
  };
}

// ── Passive ticks ───────────────────────────────────────────────

export function tickPassive(
  state: FlowState,
  source: PassiveSource,
  now: number,
): void {
  if (!state.roundActive) return;
  const amount = FLOW_TICK_AMOUNT[source];
  const gained = applyGain(state, amount, now);
  if (gained > 0) {
    state.passiveSubtotal += gained;
    recordTrickEvent(state, sourceToKind(source), gained);
  }
}

// ── Bonus events ────────────────────────────────────────────────

export function tickSurvival(
  state: FlowState,
  dtSec: number,
  now: number,
): void {
  if (!state.roundActive) return;
  const amount = FLOW_BONUS.survivalPerSec * dtSec;
  const gained = applyGain(state, amount, now);
  if (gained > 0) {
    state.bonusSubtotal += gained;
    recordTrickEvent(state, 'survival', gained);
  }
}

export function tickBoost(
  state: FlowState,
  dtSec: number,
  now: number,
): void {
  if (!state.roundActive) return;
  const amount = FLOW_BONUS.boostPerSec * dtSec;
  const gained = applyGain(state, amount, now);
  if (gained > 0) {
    state.bonusSubtotal += gained;
    recordTrickEvent(state, 'boost', gained);
  }
}

export function awardElimination(state: FlowState, now: number): void {
  if (!state.roundActive) return;
  const gained = applyGain(state, FLOW_BONUS.elimination, now);
  if (gained > 0) {
    state.bonusSubtotal += gained;
    recordTrickEvent(state, 'elimination', gained);
  }
}

export function awardNearMiss(state: FlowState, now: number): void {
  if (!state.roundActive) return;
  const gained = applyGain(state, FLOW_BONUS.nearMiss, now);
  if (gained > 0) {
    state.bonusSubtotal += gained;
    recordTrickEvent(state, 'near-miss', gained);
  }
}

// ── Pending banks (visual replay, no double-counting) ──────────

export function spawnPendingBank(
  state: FlowState,
  source: BankSource,
  amount: number,
  now: number,
): number {
  const id = state.nextBankId++;
  state.pendingBanks.push({ id, amount, source, spawnedAt: now });
  return id;
}

export function commitPendingBank(
  state: FlowState,
  id: number,
  _now: number,
): void {
  // Banks are visual-only (tick already credited active), so just remove
  state.pendingBanks = state.pendingBanks.filter((b) => b.id !== id);
}

// ── Snapshot (read-only view for HUD) ───────────────────────────

export function getSnapshot(state: FlowState): Readonly<FlowSnapshot> {
  return {
    active: state.active,
    passiveSubtotal: state.passiveSubtotal,
    bonusSubtotal: state.bonusSubtotal,
    tierIndex: state.tierIndex,
    multiplier: state.multiplier,
    capState: state.capState,
    lastGainAmount: state.lastGainAmount,
    lastGainAt: state.lastGainAt,
    pendingBanks: state.pendingBanks,
  };
}

// ── Testing helper ──────────────────────────────────────────────

export function _resetForTesting(state: FlowState): void {
  state.active = 0;
  state.passiveSubtotal = 0;
  state.bonusSubtotal = 0;
  state.tierIndex = 0;
  state.multiplier = 1;
  state.capState = 'open';
  state.lastGainAmount = 0;
  state.lastGainAt = 0;
  state.pendingBanks = [];
  state.nextBankId = 1;
  state.trickEvents = [];
  state.roundActive = false;
}

// ── Private helpers ─────────────────────────────────────────────

function sourceToKind(source: PassiveSource): TrickLogEntry['kind'] {
  if (source === 'slipstream') return 'slipstream';
  if (source === 'grind') return 'grind';
  return 'drift'; // drift-low/med/high all map to 'drift'
}

function recordTrickEvent(
  state: FlowState,
  kind: TrickLogEntry['kind'],
  amount: number,
): void {
  state.trickEvents.push({ kind, amount });
}

function buildTrickLog(events: TrickEvent[]): TrickLogEntry[] {
  const buckets = new Map<string, { amount: number; count: number }>();

  for (const ev of events) {
    const existing = buckets.get(ev.kind);
    if (existing) {
      existing.amount += ev.amount;
      existing.count += 1;
    } else {
      buckets.set(ev.kind, { amount: ev.amount, count: 1 });
    }
  }

  // Order per SPEC-91: elimination, near-miss, slipstream, drift, grind, boost, survival
  const order: TrickLogEntry['kind'][] = [
    'elimination', 'near-miss', 'slipstream', 'drift', 'grind', 'boost', 'survival',
  ];

  const log: TrickLogEntry[] = [];
  for (const kind of order) {
    const bucket = buckets.get(kind);
    if (bucket && bucket.amount > 0) {
      const entry: TrickLogEntry = { kind, amount: Math.round(bucket.amount) };
      if ((kind === 'elimination' || kind === 'near-miss') && bucket.count > 0) {
        entry.count = bucket.count;
      }
      log.push(entry);
    }
  }

  return log;
}
