// ── LockstepTelemetryCollector Tests ─────────────────────
// TASK-130: stall timing, reset, build flow-through, rollback depth ring buffer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LockstepTelemetryCollector } from './lockstepTelemetryCollector';

describe('LockstepTelemetryCollector', () => {
  let collector: LockstepTelemetryCollector;

  beforeEach(() => {
    collector = new LockstepTelemetryCollector();
    vi.restoreAllMocks();
  });

  // ── 1. recordStallStart / recordStallEnd timing ────────

  describe('recordStallStart / recordStallEnd', () => {
    it('records stall duration via performance.now timing', () => {
      const spy = vi.spyOn(performance, 'now');
      spy.mockReturnValueOnce(1000); // recordStallStart
      spy.mockReturnValueOnce(1050); // recordStallEnd

      collector.recordStallStart();
      collector.recordStallEnd();

      const samples = collector.stallDurationSamples.toArray();
      expect(samples).toHaveLength(1);
      expect(samples[0]).toBe(50);
    });

    it('tracks peakStallMs as the maximum duration', () => {
      const spy = vi.spyOn(performance, 'now');

      // First stall: 30ms
      spy.mockReturnValueOnce(100);
      spy.mockReturnValueOnce(130);
      collector.recordStallStart();
      collector.recordStallEnd();

      // Second stall: 80ms (new peak)
      spy.mockReturnValueOnce(200);
      spy.mockReturnValueOnce(280);
      collector.recordStallStart();
      collector.recordStallEnd();

      // Third stall: 20ms (not a new peak)
      spy.mockReturnValueOnce(300);
      spy.mockReturnValueOnce(320);
      collector.recordStallStart();
      collector.recordStallEnd();

      expect(collector.peakStallMs).toBe(80);
      expect(collector.stallDurationSamples.toArray()).toEqual([30, 80, 20]);
    });

    it('increments stallCount on recordStallStart only', () => {
      const spy = vi.spyOn(performance, 'now');
      spy.mockReturnValue(0);

      expect(collector.stallCount).toBe(0);

      collector.recordStallStart();
      expect(collector.stallCount).toBe(1);

      collector.recordStallEnd();
      expect(collector.stallCount).toBe(1); // no increment on end
    });
  });

  // ── 2. recordStallEnd when not stalled (no-op) ─────────

  describe('recordStallEnd when not stalled', () => {
    it('is a no-op when no stall is active', () => {
      const spy = vi.spyOn(performance, 'now');
      spy.mockReturnValue(9999);

      collector.recordStallEnd();

      expect(collector.stallDurationSamples.toArray()).toHaveLength(0);
      expect(collector.peakStallMs).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    });

    it('is a no-op when called twice after a single stall', () => {
      const spy = vi.spyOn(performance, 'now');
      spy.mockReturnValueOnce(100); // start
      spy.mockReturnValueOnce(150); // first end
      spy.mockReturnValueOnce(200); // second end (should not be reached)

      collector.recordStallStart();
      collector.recordStallEnd();
      collector.recordStallEnd(); // no-op

      expect(collector.stallDurationSamples.toArray()).toEqual([50]);
    });
  });

  // ── 3. Multiple recordStallStart without recordStallEnd ─

  describe('multiple recordStallStart without recordStallEnd', () => {
    it('only the first call sets the start time, but stallCount increments each call', () => {
      const spy = vi.spyOn(performance, 'now');
      spy.mockReturnValueOnce(100);  // first recordStallStart (sets _stallStartMs)
      // second recordStallStart: _stallStartMs !== 0, so no performance.now call
      spy.mockReturnValueOnce(250);  // recordStallEnd

      collector.recordStallStart();
      collector.recordStallStart(); // stallCount++, but start time stays at 100
      collector.recordStallStart(); // stallCount++, but start time stays at 100

      expect(collector.stallCount).toBe(3);

      collector.recordStallEnd();

      // Duration should be based on the first start (100), not later calls
      const samples = collector.stallDurationSamples.toArray();
      expect(samples).toHaveLength(1);
      expect(samples[0]).toBe(150); // 250 - 100
    });
  });

  // ── 4. reset() clears all counters ─────────────────────

  describe('reset', () => {
    it('clears all counters and ring buffers', () => {
      const spy = vi.spyOn(performance, 'now');
      spy.mockReturnValueOnce(1000);  // recordStallStart
      spy.mockReturnValueOnce(1042);  // recordStallEnd

      // Populate every counter/buffer
      collector.recordSimTickCost(5);
      collector.recordLateInput(2);
      collector.recordMisprediction();
      collector.recordCorrectPrediction();
      collector.recordPredictAhead(7);
      collector.recordStallStart();
      collector.recordStallEnd();
      collector.recordHashCost(1.5);
      collector.recordRecovery();
      collector.recordRecoverySnapshot(1024, 2.0);
      collector.recordRecoveryCost(3.0);
      collector.recordRollback(4.0, 3);
      collector.recordSnapshotMiss();
      collector.recordQuantizeCost(0.8);
      collector.recordProximityCost(1.5);

      // Verify something was recorded
      expect(collector.stallCount).toBeGreaterThan(0);
      expect(collector.peakStallMs).toBeGreaterThan(0);
      expect(collector.stallDurationSamples.toArray()).not.toHaveLength(0);

      collector.reset();

      // All counters should be zero
      expect(collector.stallCount).toBe(0);
      expect(collector.peakStallMs).toBe(0);
      expect(collector.stallDurationSamples.toArray()).toHaveLength(0);

      // build() with zeroed collector should produce zeroed telemetry
      const t = collector.build(0, 0, 0, 0);
      expect(t.stallCount).toBe(0);
      expect(t.peakStallDurationMs).toBe(0);
      expect(t.avgStallDurationMs).toBe(0);
      expect(t.rollbackCount).toBe(0);
      expect(t.lateInputCount).toBe(0);
      expect(t.recoveryCount).toBe(0);
      expect(t.mispredictionCount).toBe(0);
      expect(t.correctPredictionCount).toBe(0);
      expect(t.peakPredictAhead).toBe(0);
      expect(t.avgSimTickCostMs).toBe(0);
      expect(t.peakSimTickCostMs).toBe(0);
      expect(t.avgRollbackCostMs).toBe(0);
      expect(t.peakRollbackCostMs).toBe(0);
      expect(t.avgRecoveryCostMs).toBe(0);
      expect(t.peakRecoveryCostMs).toBe(0);
      expect(t.avgHashCostMs).toBe(0);
      expect(t.snapshotMissCount).toBe(0);
      expect(t.avgQuantizeCostMs).toBe(0);
      expect(t.avgProximityCostMs).toBe(0);
      expect(t.peakProximityCostMs).toBe(0);
      expect(t.avgVisualCorrectionDist).toBe(0);
      expect(t.peakVisualCorrectionDist).toBe(0);
    });
  });

  // ── 5. build() — stall fields flow through correctly ───

  describe('build', () => {
    it('passes stallDurationSamples and peakStallMs into RoundTelemetry', () => {
      const spy = vi.spyOn(performance, 'now');

      // Stall 1: 30ms
      spy.mockReturnValueOnce(100);
      spy.mockReturnValueOnce(130);
      collector.recordStallStart();
      collector.recordStallEnd();

      // Stall 2: 70ms
      spy.mockReturnValueOnce(200);
      spy.mockReturnValueOnce(270);
      collector.recordStallStart();
      collector.recordStallEnd();

      const t = collector.build(0, 0, 100, 2);

      expect(t.stallCount).toBe(2);
      // avgStallDurationMs = round((30 + 70) / 2 * 100) / 100 = 50
      expect(t.avgStallDurationMs).toBe(50);
      // peakStallDurationMs = round(70 * 100) / 100 = 70
      expect(t.peakStallDurationMs).toBe(70);
    });

    it('passes rollbackCount and desyncCount as provided args', () => {
      const t = collector.build(12, 3, 500, 4);

      expect(t.rollbackCount).toBe(12);
      expect(t.desyncCount).toBe(3);
      expect(t.totalTicks).toBe(500);
      expect(t.inputBufferDepth).toBe(4);
    });

    it('includes peakPredictAhead from recordPredictAhead calls', () => {
      collector.recordPredictAhead(3);
      collector.recordPredictAhead(8);
      collector.recordPredictAhead(5); // not a new peak

      const t = collector.build(0, 0, 100, 2);
      expect(t.peakPredictAhead).toBe(8);
    });

    it('includes lateInputCount and inputLatencyBuckets', () => {
      collector.recordLateInput(1);
      collector.recordLateInput(1);
      collector.recordLateInput(3);

      const t = collector.build(0, 0, 100, 0);
      expect(t.lateInputCount).toBe(3);
      expect(t.inputLatencyBuckets).toEqual({ 1: 2, 3: 1 });
    });

    it('includes misprediction and correct prediction counts', () => {
      collector.recordMisprediction();
      collector.recordMisprediction();
      collector.recordCorrectPrediction();
      collector.recordCorrectPrediction();
      collector.recordCorrectPrediction();

      const t = collector.build(0, 0, 100, 0);
      expect(t.mispredictionCount).toBe(2);
      expect(t.correctPredictionCount).toBe(3);
    });
  });

  // ── 6. recordProximityCost — proximity cost ring buffer ──

  describe('recordProximityCost', () => {
    it('records proximity cost samples and tracks peak', () => {
      collector.recordProximityCost(0.5);
      collector.recordProximityCost(1.2);
      collector.recordProximityCost(0.8);

      const t = collector.build(0, 0, 100, 0);
      // avg = (0.5 + 1.2 + 0.8) / 3 ≈ 0.83
      expect(t.avgProximityCostMs).toBeCloseTo(0.83, 1);
      expect(t.peakProximityCostMs).toBe(1.2);
    });

    it('appears in build() output with correct values', () => {
      collector.recordProximityCost(2.0);
      collector.recordProximityCost(3.5);

      const t = collector.build(0, 0, 50, 0);
      expect(t.avgProximityCostMs).toBeCloseTo(2.75, 1);
      expect(t.peakProximityCostMs).toBe(3.5);
    });
  });

  // ── 7. recordVisualCorrection — correction distance tracking ──

  describe('recordVisualCorrection', () => {
    it('records correction distance samples and tracks peak', () => {
      collector.recordVisualCorrection(0.5);
      collector.recordVisualCorrection(2.1);
      collector.recordVisualCorrection(1.0);

      const t = collector.build(0, 0, 100, 0);
      expect(t.avgVisualCorrectionDist).toBeCloseTo(1.2, 1);
      expect(t.peakVisualCorrectionDist).toBe(2.1);
    });

    it('resets on collector.reset()', () => {
      collector.recordVisualCorrection(3.0);
      collector.reset();

      const t = collector.build(0, 0, 0, 0);
      expect(t.avgVisualCorrectionDist).toBe(0);
      expect(t.peakVisualCorrectionDist).toBe(0);
    });
  });

  // ── 8. recordRollback — rollback depths ring buffer ────

  describe('recordRollback', () => {
    it('pushes depth into _rollbackDepths (capacity 200)', () => {
      // Record 5 rollbacks of varying depths
      collector.recordRollback(1.0, 2);
      collector.recordRollback(2.0, 4);
      collector.recordRollback(3.0, 6);
      collector.recordRollback(1.5, 1);
      collector.recordRollback(2.5, 3);

      const t = collector.build(5, 0, 100, 0);
      // rollbackDepths is depth -> count
      expect(t.rollbackDepths).toEqual({
        1: 1,
        2: 1,
        3: 1,
        4: 1,
        6: 1,
      });
      expect(t.rollbackMaxDepth).toBe(6);
      expect(t.rollbackAvgDepth).toBe((2 + 4 + 6 + 1 + 3) / 5);
    });

    it('tracks peakRollbackMs across calls', () => {
      collector.recordRollback(3.0, 1);
      collector.recordRollback(7.5, 2);
      collector.recordRollback(5.0, 3);

      const t = collector.build(3, 0, 100, 0);
      expect(t.peakRollbackCostMs).toBe(7.5);
    });

    it('populates rollbackCostByDepth aggregation', () => {
      collector.recordRollback(2.0, 1);
      collector.recordRollback(4.0, 1);
      collector.recordRollback(10.0, 3);

      const t = collector.build(3, 0, 100, 0);
      // depth 1: avg = (2+4)/2 = 3, peak = 4
      expect(t.rollbackCostByDepth[1].avgMs).toBe(3);
      expect(t.rollbackCostByDepth[1].peakMs).toBe(4);
      expect(t.rollbackCostByDepth[1].count).toBe(2);
      // depth 3: avg = 10/1 = 10, peak = 10
      expect(t.rollbackCostByDepth[3].avgMs).toBe(10);
      expect(t.rollbackCostByDepth[3].peakMs).toBe(10);
      expect(t.rollbackCostByDepth[3].count).toBe(1);
    });

    it('respects ring buffer capacity of 200 for rollback depths', () => {
      // Push 210 items — only the last 200 should survive
      for (let i = 0; i < 210; i++) {
        collector.recordRollback(1.0, i);
      }

      const t = collector.build(210, 0, 1000, 0);
      // Depths 0-9 should have been evicted; 10-209 remain
      const depthKeys = Object.keys(t.rollbackDepths).map(Number).sort((a, b) => a - b);
      expect(depthKeys).toHaveLength(200);
      expect(depthKeys[0]).toBe(10);
      expect(depthKeys[depthKeys.length - 1]).toBe(209);
    });
  });
});
