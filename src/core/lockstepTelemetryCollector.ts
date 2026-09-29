// ── Lockstep Telemetry Collector ───────────────────────────
// Extracted from LockstepManager to keep that file under 400 lines.
// Owns all per-round telemetry counters, ring buffers, and the build() snapshot.

import { RingBuffer } from '../telemetry';
import { buildRoundTelemetry, type RoundTelemetry, type RawTelemetryInput } from './lockstepTelemetry';

/** Collects per-round telemetry and builds snapshots via buildRoundTelemetry(). */
export class LockstepTelemetryCollector {
  // ── Per-round counters ──────────────────────────────────
  private _rollbackDepths = new RingBuffer<number>(200);
  private _lateInputCount = 0;
  private _recoveryCount = 0;
  private _stallCount = 0;
  private _stallStartMs = 0;
  private _stallDurationMs = new RingBuffer<number>(60);
  private _peakStallMs = 0;
  private _peakPredictAhead = 0;

  // Sim cost tracking
  private _simTickCostSamples = new RingBuffer<number>(120);
  private _rollbackCostMs = new RingBuffer<number>(60);
  private _peakRollbackMs = 0;
  private _recoveryCostMs = new RingBuffer<number>(30);
  private _peakRecoveryMs = 0;
  private _recoverySnapshotBytes = new RingBuffer<number>(30);
  private _peakSimTickMs = 0;
  private _inputLatencyBuckets: Record<number, number> = {};
  private _hashCostSamples = new RingBuffer<number>(30);
  private _mispredictionCount = 0;
  private _correctPredictionCount = 0;
  private _snapshotMissCount = 0;
  private _rollbackDepthCostPairs = new RingBuffer<{ depth: number; costMs: number }>(120);
  private _snapshotSerdeCostSamples = new RingBuffer<number>(30);
  private _quantizeCostSamples = new RingBuffer<number>(60);
  private _proximityCostSamples = new RingBuffer<number>(60);
  private _peakProximityCostMs = 0;

  // Late input burst tracking: consecutive late inputs form a "burst"
  private _lateInputStreak = 0;
  private _lateInputBurstCount = 0;  // streaks of 3+ consecutive late inputs
  private _lateInputPeakStreak = 0;

  // Visual correction magnitude tracking (rollback + recovery)
  private _visualCorrectionSamples = new RingBuffer<number>(120);
  private _peakVisualCorrectionDist = 0;

  /** Current stall count (used for log throttling in manager). */
  get stallCount(): number { return this._stallCount; }

  // ── Recording methods ───────────────────────────────────

  recordSimTickCost(costMs: number): void {
    this._simTickCostSamples.push(costMs);
    if (costMs > this._peakSimTickMs) this._peakSimTickMs = costMs;
  }

  recordLateInput(ticksLate: number): void {
    this._lateInputCount++;
    this._inputLatencyBuckets[ticksLate] = (this._inputLatencyBuckets[ticksLate] || 0) + 1;
    this._lateInputStreak++;
    if (this._lateInputStreak > this._lateInputPeakStreak) this._lateInputPeakStreak = this._lateInputStreak;
  }

  /** Called when an on-time input arrives, resetting the late streak. */
  recordOnTimeInput(): void {
    if (this._lateInputStreak >= 3) this._lateInputBurstCount++;
    this._lateInputStreak = 0;
  }

  recordMisprediction(): void { this._mispredictionCount++; }
  recordCorrectPrediction(): void { this._correctPredictionCount++; }

  recordPredictAhead(predictAhead: number): void {
    if (predictAhead > this._peakPredictAhead) this._peakPredictAhead = predictAhead;
  }

  /** Begin a stall (called when predict-ahead exceeds max). */
  recordStallStart(): void {
    if (this._stallStartMs === 0) {
      this._stallStartMs = performance.now();
    }
    this._stallCount++;
  }

  /** End a stall (called when predict-ahead returns within bounds). */
  recordStallEnd(): void {
    if (this._stallStartMs > 0) {
      const dur = performance.now() - this._stallStartMs;
      this._stallDurationMs.push(dur);
      if (dur > this._peakStallMs) this._peakStallMs = dur;
      this._stallStartMs = 0;
    }
  }

  /** Stall duration samples for telemetry builder. */
  get stallDurationSamples(): RingBuffer<number> { return this._stallDurationMs; }

  /** Peak stall duration (ms). */
  get peakStallMs(): number { return this._peakStallMs; }

  recordHashCost(costMs: number): void { this._hashCostSamples.push(costMs); }

  recordRecovery(): void { this._recoveryCount++; }

  recordRecoverySnapshot(bytes: number, serdeCostMs: number): void {
    this._recoverySnapshotBytes.push(bytes);
    this._snapshotSerdeCostSamples.push(serdeCostMs);
  }

  recordRecoveryDeserde(costMs: number): void {
    this._snapshotSerdeCostSamples.push(costMs);
  }

  recordRecoveryCost(costMs: number): void {
    this._recoveryCostMs.push(costMs);
    if (costMs > this._peakRecoveryMs) this._peakRecoveryMs = costMs;
  }

  recordRollback(costMs: number, depth: number): void {
    this._rollbackCostMs.push(costMs);
    if (costMs > this._peakRollbackMs) this._peakRollbackMs = costMs;
    this._rollbackDepthCostPairs.push({ depth, costMs });
    this._rollbackDepths.push(depth);
  }

  recordSnapshotMiss(): void { this._snapshotMissCount++; }

  recordQuantizeCost(costMs: number): void { this._quantizeCostSamples.push(costMs); }

  recordProximityCost(costMs: number): void {
    this._proximityCostSamples.push(costMs);
    if (costMs > this._peakProximityCostMs) this._peakProximityCostMs = costMs;
  }

  recordVisualCorrection(distUnits: number): void {
    this._visualCorrectionSamples.push(distUnits);
    if (distUnits > this._peakVisualCorrectionDist) this._peakVisualCorrectionDist = distUnits;
  }

  /** Reset all counters for a new round. */
  reset(): void {
    this._rollbackDepths.clear();
    this._lateInputCount = 0;
    this._recoveryCount = 0;
    this._stallCount = 0;
    this._stallStartMs = 0;
    this._stallDurationMs.clear();
    this._peakStallMs = 0;
    this._peakPredictAhead = 0;
    this._simTickCostSamples.clear();
    this._rollbackCostMs.clear();
    this._peakRollbackMs = 0;
    this._recoveryCostMs.clear();
    this._peakRecoveryMs = 0;
    this._recoverySnapshotBytes.clear();
    this._peakSimTickMs = 0;
    this._hashCostSamples.clear();
    this._mispredictionCount = 0;
    this._correctPredictionCount = 0;
    this._snapshotMissCount = 0;
    this._rollbackDepthCostPairs.clear();
    this._snapshotSerdeCostSamples.clear();
    this._quantizeCostSamples.clear();
    this._proximityCostSamples.clear();
    this._peakProximityCostMs = 0;
    this._lateInputStreak = 0;
    this._lateInputBurstCount = 0;
    this._lateInputPeakStreak = 0;
    this._visualCorrectionSamples.clear();
    this._peakVisualCorrectionDist = 0;
  }

  /** Build a RoundTelemetry snapshot from current counters. */
  build(rollbackCount: number, desyncCount: number, tick: number, predictAhead: number): RoundTelemetry {
    const raw: RawTelemetryInput = {
      rollbackDepths: this._rollbackDepths.toArray(),
      rollbackCount,
      peakPredictAhead: this._peakPredictAhead,
      lateInputCount: this._lateInputCount,
      desyncCount,
      recoveryCount: this._recoveryCount,
      stallCount: this._stallCount,
      totalTicks: tick,
      simTickCostSamples: this._simTickCostSamples,
      peakSimTickMs: this._peakSimTickMs,
      rollbackCostMs: this._rollbackCostMs,
      peakRollbackMs: this._peakRollbackMs,
      recoveryCostMs: this._recoveryCostMs,
      peakRecoveryMs: this._peakRecoveryMs,
      recoverySnapshotBytes: this._recoverySnapshotBytes,
      inputLatencyBuckets: this._inputLatencyBuckets,
      mispredictionCount: this._mispredictionCount,
      correctPredictionCount: this._correctPredictionCount,
      inputBufferDepth: predictAhead,
      hashCostSamples: this._hashCostSamples,
      snapshotMissCount: this._snapshotMissCount,
      rollbackDepthCostPairs: this._rollbackDepthCostPairs,
      snapshotSerdeCostSamples: this._snapshotSerdeCostSamples,
      stallDurationSamples: this._stallDurationMs,
      peakStallMs: this._peakStallMs,
      quantizeCostSamples: this._quantizeCostSamples,
      lateInputBurstCount: this._lateInputBurstCount + (this._lateInputStreak >= 3 ? 1 : 0),
      lateInputPeakStreak: this._lateInputPeakStreak,
      proximityCostSamples: this._proximityCostSamples,
      peakProximityCostMs: this._peakProximityCostMs,
      visualCorrectionSamples: this._visualCorrectionSamples,
      peakVisualCorrectionDist: this._peakVisualCorrectionDist,
    };
    return buildRoundTelemetry(raw);
  }
}
