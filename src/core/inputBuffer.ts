// ── Input Buffer for Lockstep Netcode ────────────────────
// Manages local + remote input streams with prediction and redundancy.

import type { InputFrame } from './simulation';

// ── Constants ───────────────────────────────────────────
const INPUT_REDUNDANCY = 6;         // send last N frames per packet (covers 2 send intervals)
const MAX_BUFFER_SIZE = 120;        // ~2 seconds at 60Hz

export const DEFAULT_INPUT_DELAY = 3; // ticks (~50ms at 60Hz)
export const MIN_INPUT_DELAY = 2;
export const MAX_INPUT_DELAY = 10;

/** Compute optimal input delay from measured RTT. */
export function computeInputDelay(rttMs: number): number {
  const SIM_DT_MS = 1000 / 60; // ~16.67ms
  const delay = Math.ceil(rttMs / 2 / SIM_DT_MS) + 1;
  return Math.max(MIN_INPUT_DELAY, Math.min(MAX_INPUT_DELAY, delay));
}

// ── Input prediction decay (Rocket League pattern) ───────
// Decay predicted input toward neutral over N ticks so corrections
// undershoot (looks natural) instead of overshoot (rubber-banding).
export const TURN_DECAY_TICKS = 3;   // turnDir → 0 after this many predicted ticks
export const BOOL_DECAY_TICKS = 5;   // accelerate/dash/brake → false after this many

// ── Empty input (no buttons pressed) ────────────────────
export function emptyInput(tick: number): InputFrame {
  return { tick, turnDir: 0, accelerate: false, dash: false, brake: false, special: false };
}

// ── Input Buffer ────────────────────────────────────────

export class InputBuffer {
  private _local: Map<number, InputFrame> = new Map();
  private _remotes: Map<number, Map<number, InputFrame>> = new Map(); // playerIndex → tick → input
  private _lastRemoteInputs: Map<number, InputFrame> = new Map();     // playerIndex → last input
  private _lastRemoteTicks: Map<number, number> = new Map();          // playerIndex → last tick
  private _currentSimTick = 0;  // track sim tick for safe pruning

  inputDelay: number = DEFAULT_INPUT_DELAY;

  // ── Local input management ────────────────────────────

  /** Update the current simulation tick (call each sim step for safe pruning). */
  setSimTick(tick: number): void {
    this._currentSimTick = tick;
  }

  /** Record local input for a given tick (called each sim step). */
  addLocal(input: InputFrame): void {
    this._local.set(input.tick, input);
    this._pruneOld(this._local);
  }

  /** Get local input for a specific tick. */
  getLocal(tick: number): InputFrame | null {
    return this._local.get(tick) || null;
  }

  /** Package the last N inputs for network transmission (redundancy). */
  getLocalPacket(currentTick: number): InputFrame[] {
    const frames: InputFrame[] = [];
    for (let t = currentTick - INPUT_REDUNDANCY + 1; t <= currentTick; t++) {
      const f = this._local.get(t);
      if (f) frames.push(f);
    }
    return frames;
  }

  // ── Remote input management ───────────────────────────

  /** Get or create the remote buffer for a given player index. */
  private _getRemoteMap(playerIndex: number): Map<number, InputFrame> {
    let map = this._remotes.get(playerIndex);
    if (!map) {
      map = new Map();
      this._remotes.set(playerIndex, map);
    }
    return map;
  }

  /** Receive a packet of remote inputs from a specific player (may contain redundant older frames). */
  receiveRemote(playerIndex: number, frames: InputFrame[]): void {
    const map = this._getRemoteMap(playerIndex);
    for (const f of frames) {
      if (!map.has(f.tick)) {
        map.set(f.tick, f);
      }
    }
    // Track latest for prediction
    const latest = frames[frames.length - 1];
    const lastTick = this._lastRemoteTicks.get(playerIndex) ?? -1;
    if (latest && latest.tick > lastTick) {
      this._lastRemoteInputs.set(playerIndex, latest);
      this._lastRemoteTicks.set(playerIndex, latest.tick);
    }
    this._pruneOld(map);
  }

  /** Get confirmed remote input for a specific player and tick. Returns null if not yet received. */
  getRemote(playerIndex: number, tick: number): InputFrame | null {
    const map = this._remotes.get(playerIndex);
    if (!map) return null;
    return map.get(tick) || null;
  }

  /** Predict remote input for a tick that hasn't arrived yet from a specific player.
   *  Smoothly decays turn toward neutral over TURN_DECAY_TICKS, then holds at 0.
   *  Bool inputs (accelerate/dash/brake) decay to false after BOOL_DECAY_TICKS.
   *  Smooth decay avoids the visible movement hiccup of a hard snap. */
  predictRemote(playerIndex: number, tick: number): InputFrame {
    const lastInput = this._lastRemoteInputs.get(playerIndex);
    if (!lastInput) return emptyInput(tick);

    const lastTick = this._lastRemoteTicks.get(playerIndex) ?? -1;
    const age = tick - lastTick;
    if (age < 0 || age >= BOOL_DECAY_TICKS) return emptyInput(tick);

    // Smooth turn decay: linearly fade from last turnDir to 0 over TURN_DECAY_TICKS
    let turnDir: number = lastInput.turnDir;
    if (age > 0 && turnDir !== 0) {
      const t = Math.min(1, age / TURN_DECAY_TICKS);
      // Quantize the decayed value back to -1/0/1 based on threshold
      const decayed = turnDir * (1 - t);
      turnDir = Math.abs(decayed) < 0.5 ? 0 : (decayed > 0 ? 1 : -1);
    }

    // TODO: booleans hold at last value for ticks 0–(BOOL_DECAY_TICKS-1) then hard-snap to false.
    // This is hold-then-snap, not gradual decay. The comment on BOOL_DECAY_TICKS is misleading.
    // Consider shortening the hold window or probability-decaying if rollback stutter is reported.
    return {
      tick,
      turnDir,
      accelerate: lastInput.accelerate,
      dash: lastInput.dash,
      brake: lastInput.brake,
    };
  }

  /** Check if a prediction for tick N was correct for a specific player (returns true if confirmed input matches prediction). */
  wasPredictionCorrect(playerIndex: number, tick: number, predicted: InputFrame): boolean {
    const map = this._remotes.get(playerIndex);
    if (!map) return true; // no buffer — assume correct
    const actual = map.get(tick);
    if (!actual) return true; // not yet confirmed — assume correct
    return actual.turnDir === predicted.turnDir &&
      actual.accelerate === predicted.accelerate &&
      actual.brake === predicted.brake &&
      actual.dash === predicted.dash;
  }

  /** Get the latest confirmed remote tick number for a specific player. */
  getLatestRemoteTick(playerIndex: number): number {
    return this._lastRemoteTicks.get(playerIndex) ?? -1;
  }

  // ── Utilities ─────────────────────────────────────────

  /** Clear all buffers (new round / match). */
  clear(): void {
    this._local.clear();
    this._remotes.clear();
    this._lastRemoteInputs.clear();
    this._lastRemoteTicks.clear();
  }

  /** Clear only remote buffers (desync recovery — keep local inputs intact). */
  clearRemote(): void {
    this._remotes.clear();
    this._lastRemoteInputs.clear();
    this._lastRemoteTicks.clear();
  }

  /** Remove inputs older than MAX_BUFFER_SIZE ticks behind current sim tick.
   *  Pruning relative to sim tick (not max key) prevents a burst of future
   *  inputs from deleting ticks that haven't been simulated yet. */
  private _pruneOld(map: Map<number, InputFrame>): void {
    if (map.size <= MAX_BUFFER_SIZE) return;
    const minTick = Math.max(0, this._currentSimTick - MAX_BUFFER_SIZE);
    for (const [tick] of map) {
      if (tick < minTick) map.delete(tick);
    }
  }
}

// ── RTT measurement for adaptive input delay ────────────

// ts-prune-ignore-next
export class RttTracker {
  private _samples: number[] = [];
  private _maxSamples = 20;

  addSample(rttMs: number): void {
    this._samples.push(rttMs);
    if (this._samples.length > this._maxSamples) this._samples.shift();
  }

  /** Get the recommended input delay in ticks based on measured RTT. */
  getRecommendedDelay(simDtMs: number): number {
    if (this._samples.length === 0) return DEFAULT_INPUT_DELAY;
    // Use 75th percentile RTT (not average — resilient to spikes)
    const sorted = [...this._samples].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    // Delay = half RTT in ticks + 1 safety margin
    const delay = Math.ceil(p75 / 2 / simDtMs) + 1;
    return Math.max(MIN_INPUT_DELAY, Math.min(MAX_INPUT_DELAY, delay));
  }

  clear(): void {
    this._samples = [];
  }
}

// ── Delay Advisor (between-round, telemetry-driven) ─────
// Uses late-input rate and peak predict-ahead from the previous round
// to adjust input delay, instead of relying only on RTT.

/** Previous-round telemetry fed into the advisor. */
export interface RoundDeliveryStats {
  lateInputCount: number;     // inputs that arrived after prediction
  totalTicks: number;          // round duration in sim ticks
  peakPredictAhead: number;    // high-water mark for predict-ahead gap
  stallCount: number;          // times sim stalled waiting for remote
  previousDelay: number;       // input delay used during the round
}

// Thresholds — kept as named constants so they're easy to tune.
const LATE_RATE_RAISE = 0.05;   // >5% late → raise delay
const LATE_RATE_SEVERE = 0.50;  // >50% late → aggressive raise
const LATE_RATE_LOWER = 0.01;   // <1% late → eligible to lower
const PREDICT_RATIO_RAISE = 2;  // peakPredictAhead > 2× delay → raise

export class DelayAdvisor {
  private _lastStats: RoundDeliveryStats | null = null;

  /** Feed in the just-finished round's delivery stats. */
  recordRound(stats: RoundDeliveryStats): void {
    this._lastStats = stats;
  }

  /**
   * Recommend input delay for the next round.
   * @param rttMs  Current estimated RTT in milliseconds.
   * @returns  Recommended input delay in ticks, clamped to [MIN, MAX].
   *
   * Policy:
   *   1. Start from RTT baseline (same formula as computeInputDelay).
   *   2. If previous round had high late-input rate OR stalls → +1.
   *   3. If peak predict-ahead exceeded 2× the delay used → +1 (additive with #2).
   *   4. If previous round was clean (low late rate, no stalls, predict-ahead
   *      stayed within the delay) → allow −1 from the *previous* delay to
   *      drift back down, but never below the RTT baseline.
   *   5. Clamp to [MIN_INPUT_DELAY, MAX_INPUT_DELAY].
   *
   * The result reacts to actual delivery quality rather than RTT alone,
   * while still anchoring to RTT so the first round (no telemetry) works.
   */
  recommend(rttMs: number): number {
    const rttBaseline = computeInputDelay(rttMs);

    if (!this._lastStats || this._lastStats.totalTicks === 0) {
      return rttBaseline;
    }

    const { lateInputCount, totalTicks, peakPredictAhead, stallCount, previousDelay } = this._lastStats;
    const lateRate = lateInputCount / totalTicks;

    let delay = rttBaseline;

    // Raise: late inputs arriving too often — tiered escalation for severe conditions
    if (lateRate > LATE_RATE_SEVERE && stallCount > 5) {
      delay += 3;
    } else if (lateRate > LATE_RATE_SEVERE) {
      delay += 2;
    } else if (lateRate > LATE_RATE_RAISE || stallCount > 0) {
      delay += 1;
    }

    // Raise: predict-ahead spiked well beyond the delay we were using
    if (peakPredictAhead > previousDelay * PREDICT_RATIO_RAISE) {
      delay += 1;
    }

    // Lower: previous round was clean — try shrinking toward RTT baseline.
    // Only lower relative to what we *used*, and never below RTT baseline,
    // so we don't oscillate on a stable connection.
    if (lateRate < LATE_RATE_LOWER && stallCount === 0 && peakPredictAhead <= previousDelay) {
      delay = Math.max(rttBaseline, previousDelay - 1);
    }

    return Math.max(MIN_INPUT_DELAY, Math.min(MAX_INPUT_DELAY, delay));
  }

  clear(): void {
    this._lastStats = null;
  }
}
