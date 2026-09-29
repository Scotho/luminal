// ── Input Buffer Tests ───────────────────────────────────
import { describe, it, expect } from 'vitest';
import { InputBuffer, RttTracker, DelayAdvisor, computeInputDelay, emptyInput, DEFAULT_INPUT_DELAY, MIN_INPUT_DELAY, MAX_INPUT_DELAY, TURN_DECAY_TICKS, BOOL_DECAY_TICKS } from './inputBuffer';
import type { InputFrame } from './simulation';

const makeInput = (tick: number, turnDir: -1 | 0 | 1 = 0): InputFrame => ({
  tick, turnDir, accelerate: false, dash: false, brake: false,
});

describe('InputBuffer', () => {
  it('stores and retrieves local inputs', () => {
    const buf = new InputBuffer();
    const input: InputFrame = { tick: 5, turnDir: -1, accelerate: true, dash: false, brake: false };
    buf.addLocal(input);
    expect(buf.getLocal(5)).toEqual(input);
    expect(buf.getLocal(6)).toBeNull();
  });

  it('stores and retrieves remote inputs by player index', () => {
    const buf = new InputBuffer();
    const frames: InputFrame[] = [
      { tick: 10, turnDir: 0, accelerate: false, dash: false, brake: false },
      { tick: 11, turnDir: 1, accelerate: false, dash: false, brake: false },
    ];
    buf.receiveRemote(1, frames);
    expect(buf.getRemote(1, 10)!.turnDir).toBe(0);
    expect(buf.getRemote(1, 11)!.turnDir).toBe(1);
    expect(buf.getRemote(1, 12)).toBeNull();
    expect(buf.getRemote(0, 10)).toBeNull(); // different player
  });

  it('predicts remote input from last known (within decay window)', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [{ tick: 5, turnDir: -1, accelerate: true, dash: false, brake: false }]);
    const predicted = buf.predictRemote(1, 6); // age = 1 (within TURN_DECAY_TICKS)
    expect(predicted.tick).toBe(6);
    expect(predicted.turnDir).toBe(-1); // holds last known
    expect(predicted.accelerate).toBe(true);
  });

  it('predicts empty input when no remote received', () => {
    const buf = new InputBuffer();
    const predicted = buf.predictRemote(1, 5);
    expect(predicted.turnDir).toBe(0);
    expect(predicted.accelerate).toBe(false);
  });

  it('getLocalPacket returns last N inputs for redundancy', () => {
    const buf = new InputBuffer();
    for (let t = 0; t < 10; t++) {
      buf.addLocal({ tick: t, turnDir: 0, accelerate: false, dash: false, brake: false });
    }
    const packet = buf.getLocalPacket(9);
    expect(packet.length).toBe(6); // redundancy = 6 (covers 2 send intervals)
    expect(packet[0].tick).toBe(4);
    expect(packet[5].tick).toBe(9);
  });

  it('wasPredictionCorrect checks all input fields', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [{ tick: 5, turnDir: -1, accelerate: false, dash: false, brake: false }]);

    const correctPrediction: InputFrame = { tick: 5, turnDir: -1, accelerate: false, dash: false, brake: false };
    expect(buf.wasPredictionCorrect(1, 5, correctPrediction)).toBe(true);

    const wrongTurn: InputFrame = { tick: 5, turnDir: 1, accelerate: false, dash: false, brake: false };
    expect(buf.wasPredictionCorrect(1, 5, wrongTurn)).toBe(false);

    const wrongAccel: InputFrame = { tick: 5, turnDir: -1, accelerate: true, dash: false, brake: false };
    expect(buf.wasPredictionCorrect(1, 5, wrongAccel)).toBe(false);

    const wrongBrake: InputFrame = { tick: 5, turnDir: -1, accelerate: false, dash: false, brake: true };
    expect(buf.wasPredictionCorrect(1, 5, wrongBrake)).toBe(false);

    const wrongDash: InputFrame = { tick: 5, turnDir: -1, accelerate: false, dash: true, brake: false };
    expect(buf.wasPredictionCorrect(1, 5, wrongDash)).toBe(false);
  });

  it('clear resets all buffers', () => {
    const buf = new InputBuffer();
    buf.addLocal(emptyInput(5));
    buf.receiveRemote(1, [emptyInput(5)]);
    buf.clear();
    expect(buf.getLocal(5)).toBeNull();
    expect(buf.getRemote(1, 5)).toBeNull();
    expect(buf.getLatestRemoteTick(1)).toBe(-1);
  });

  it('clearRemote clears only remote buffer and preserves local', () => {
    const buf = new InputBuffer();
    buf.addLocal(emptyInput(5));
    buf.addLocal(emptyInput(6));
    buf.receiveRemote(1, [emptyInput(5), emptyInput(6)]);
    expect(buf.getRemote(1, 5)).not.toBeNull();
    expect(buf.getLatestRemoteTick(1)).toBe(6);

    buf.clearRemote();

    // Remote should be gone
    expect(buf.getRemote(1, 5)).toBeNull();
    expect(buf.getRemote(1, 6)).toBeNull();
    expect(buf.getLatestRemoteTick(1)).toBe(-1);
    // Local should still exist
    expect(buf.getLocal(5)).not.toBeNull();
    expect(buf.getLocal(6)).not.toBeNull();
  });

  it('predictRemote returns empty after clearRemote', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [{ tick: 5, turnDir: -1, accelerate: true, dash: false, brake: false }]);
    expect(buf.predictRemote(1, 6).turnDir).toBe(-1);

    buf.clearRemote();

    const predicted = buf.predictRemote(1, 7);
    expect(predicted.turnDir).toBe(0);
    expect(predicted.accelerate).toBe(false);
  });
});

describe('InputBuffer multi-remote', () => {
  it('stores and retrieves remote inputs by player index', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [makeInput(5)]);
    buf.receiveRemote(2, [makeInput(5, 1)]);
    expect(buf.getRemote(1, 5)).toBeTruthy();
    expect(buf.getRemote(2, 5)!.turnDir).toBe(1);
    expect(buf.getRemote(0, 5)).toBeNull();
  });

  it('predicts remote per player index', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [makeInput(10, -1)]);
    const predicted = buf.predictRemote(1, 11);
    expect(predicted).toBeTruthy();
    expect(predicted.turnDir).toBe(-1);
  });

  it('getLatestRemoteTick returns per-player tick', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [makeInput(10)]);
    buf.receiveRemote(2, [makeInput(15)]);
    expect(buf.getLatestRemoteTick(1)).toBe(10);
    expect(buf.getLatestRemoteTick(2)).toBe(15);
  });

  it('clear wipes all remote player buffers', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [makeInput(5)]);
    buf.clear();
    expect(buf.getRemote(1, 5)).toBeNull();
  });

  it('handles 3 remote players simultaneously', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [makeInput(5, 1)]);
    buf.receiveRemote(2, [makeInput(5, -1)]);
    buf.receiveRemote(3, [makeInput(5, 0)]);
    expect(buf.getRemote(1, 5)!.turnDir).toBe(1);
    expect(buf.getRemote(2, 5)!.turnDir).toBe(-1);
    expect(buf.getRemote(3, 5)!.turnDir).toBe(0);
  });

  it('prediction is independent per player', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [makeInput(10, 1)]);
    buf.receiveRemote(2, [makeInput(10, -1)]);
    const p1 = buf.predictRemote(1, 11);
    const p2 = buf.predictRemote(2, 11);
    expect(p1.turnDir).toBe(1);
    expect(p2.turnDir).toBe(-1);
  });

  it('clearRemote clears all player buffers', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [makeInput(5)]);
    buf.receiveRemote(2, [makeInput(5)]);
    buf.clearRemote();
    expect(buf.getRemote(1, 5)).toBeNull();
    expect(buf.getRemote(2, 5)).toBeNull();
    expect(buf.getLatestRemoteTick(1)).toBe(-1);
  });

  it('local methods still work unchanged', () => {
    const buf = new InputBuffer();
    buf.addLocal(makeInput(5, 1));
    expect(buf.getLocal(5)!.turnDir).toBe(1);
    expect(buf.getLocal(6)).toBeNull();
  });
});

describe('predictRemote decay', () => {
  it('holds turnDir at age=1, then smoothly decays', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [{ tick: 10, turnDir: -1, accelerate: true, dash: false, brake: false }]);

    // age = 1: t=1/3, decayed=-0.67, |0.67|>0.5 -> -1
    const p1 = buf.predictRemote(1, 11);
    expect(p1.turnDir).toBe(-1);
    expect(p1.accelerate).toBe(true);

    // age = 2: t=2/3, decayed=-0.33, |0.33|<0.5 -> 0 (smooth decay)
    const p2 = buf.predictRemote(1, 12);
    expect(p2.turnDir).toBe(0);
    expect(p2.accelerate).toBe(true);
  });

  it('turnDir fully decayed at TURN_DECAY_TICKS', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [{ tick: 10, turnDir: -1, accelerate: true, dash: false, brake: false }]);

    // age = 3 = TURN_DECAY_TICKS: t=1.0, decayed=0 -> 0
    const p = buf.predictRemote(1, 13);
    expect(p.turnDir).toBe(0);
    expect(p.accelerate).toBe(true); // booleans still held
  });

  it('keeps booleans between TURN_DECAY and BOOL_DECAY', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [{ tick: 10, turnDir: 1, accelerate: true, dash: true, brake: true }]);

    // age = 4 (between 3 and 5)
    const p = buf.predictRemote(1, 14);
    expect(p.turnDir).toBe(0);
    expect(p.accelerate).toBe(true);
    expect(p.dash).toBe(true);
    expect(p.brake).toBe(true);
  });

  it('decays everything to empty at BOOL_DECAY_TICKS', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [{ tick: 10, turnDir: -1, accelerate: true, dash: true, brake: true }]);

    // age = 5 = BOOL_DECAY_TICKS
    const p = buf.predictRemote(1, 15);
    expect(p.turnDir).toBe(0);
    expect(p.accelerate).toBe(false);
    expect(p.dash).toBe(false);
    expect(p.brake).toBe(false);
  });

  it('stays empty beyond BOOL_DECAY_TICKS', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [{ tick: 10, turnDir: 1, accelerate: true, dash: false, brake: false }]);

    const p = buf.predictRemote(1, 20); // age = 10
    expect(p.turnDir).toBe(0);
    expect(p.accelerate).toBe(false);
  });

  it('returns empty input when no remote ever received', () => {
    const buf = new InputBuffer();
    const p = buf.predictRemote(1, 5);
    expect(p.turnDir).toBe(0);
    expect(p.accelerate).toBe(false);
  });

  it('is a no-op when last input was already neutral', () => {
    const buf = new InputBuffer();
    buf.receiveRemote(1, [{ tick: 10, turnDir: 0, accelerate: false, dash: false, brake: false }]);

    const p = buf.predictRemote(1, 11);
    expect(p.turnDir).toBe(0);
    expect(p.accelerate).toBe(false);
  });
});

describe('RttTracker', () => {
  it('recommends default delay with no samples', () => {
    const tracker = new RttTracker();
    expect(tracker.getRecommendedDelay(16.67)).toBe(DEFAULT_INPUT_DELAY);
  });

  it('increases delay for high RTT', () => {
    const tracker = new RttTracker();
    for (let i = 0; i < 10; i++) tracker.addSample(200); // 200ms RTT
    const delay = tracker.getRecommendedDelay(16.67);
    expect(delay).toBeGreaterThanOrEqual(4); // ceil(200/2/16.67) + 1 = 7, clamped to 6
  });

  it('keeps delay low for low RTT', () => {
    const tracker = new RttTracker();
    for (let i = 0; i < 10; i++) tracker.addSample(30); // 30ms RTT
    const delay = tracker.getRecommendedDelay(16.67);
    expect(delay).toBe(2); // ceil(30/2/16.67) + 1 = 2
  });

  it('clamps to min/max', () => {
    const tracker = new RttTracker();
    for (let i = 0; i < 10; i++) tracker.addSample(5); // very low
    expect(tracker.getRecommendedDelay(16.67)).toBeGreaterThanOrEqual(2);

    const tracker2 = new RttTracker();
    for (let i = 0; i < 10; i++) tracker2.addSample(500); // very high
    expect(tracker2.getRecommendedDelay(16.67)).toBeLessThanOrEqual(10);
  });
});

describe('DelayAdvisor', () => {
  const LOW_RTT = 30;   // computeInputDelay(30) = 2
  const MED_RTT = 100;  // computeInputDelay(100) = 4

  it('returns RTT baseline with no previous round', () => {
    const advisor = new DelayAdvisor();
    expect(advisor.recommend(LOW_RTT)).toBe(computeInputDelay(LOW_RTT));
    expect(advisor.recommend(MED_RTT)).toBe(computeInputDelay(MED_RTT));
  });

  it('raises delay when late-input rate is high', () => {
    const advisor = new DelayAdvisor();
    const baseline = computeInputDelay(MED_RTT);
    advisor.recordRound({
      lateInputCount: 60,   // 10% of 600 ticks — above 5% threshold
      totalTicks: 600,
      peakPredictAhead: baseline,  // within bounds
      stallCount: 0,
      previousDelay: baseline,
    });
    expect(advisor.recommend(MED_RTT)).toBe(baseline + 1);
  });

  it('raises delay when stalls occurred', () => {
    const advisor = new DelayAdvisor();
    const baseline = computeInputDelay(MED_RTT);
    advisor.recordRound({
      lateInputCount: 0,
      totalTicks: 600,
      peakPredictAhead: baseline,
      stallCount: 3,
      previousDelay: baseline,
    });
    expect(advisor.recommend(MED_RTT)).toBe(baseline + 1);
  });

  it('raises delay further when predict-ahead spiked beyond 2x delay', () => {
    const advisor = new DelayAdvisor();
    const baseline = computeInputDelay(MED_RTT);
    advisor.recordRound({
      lateInputCount: 60,           // high late rate → +1
      totalTicks: 600,
      peakPredictAhead: baseline * 3, // spike → +1 more
      stallCount: 0,
      previousDelay: baseline,
    });
    expect(advisor.recommend(MED_RTT)).toBe(baseline + 2);
  });

  it('lowers delay when previous round was clean', () => {
    const advisor = new DelayAdvisor();
    const prevDelay = 6; // higher than RTT baseline
    const baseline = computeInputDelay(LOW_RTT); // 2
    advisor.recordRound({
      lateInputCount: 2,    // <1% of 600
      totalTicks: 600,
      peakPredictAhead: 3,  // within prevDelay
      stallCount: 0,
      previousDelay: prevDelay,
    });
    // Should lower from prevDelay but not below baseline
    expect(advisor.recommend(LOW_RTT)).toBe(prevDelay - 1);
  });

  it('never lowers below RTT baseline', () => {
    const advisor = new DelayAdvisor();
    const baseline = computeInputDelay(LOW_RTT); // 2
    advisor.recordRound({
      lateInputCount: 0,
      totalTicks: 600,
      peakPredictAhead: 1,
      stallCount: 0,
      previousDelay: baseline, // already at baseline
    });
    // Can't go below baseline
    expect(advisor.recommend(LOW_RTT)).toBe(baseline);
  });

  it('clamps to MAX_INPUT_DELAY', () => {
    const advisor = new DelayAdvisor();
    advisor.recordRound({
      lateInputCount: 500,
      totalTicks: 600,
      peakPredictAhead: 30,
      stallCount: 10,
      previousDelay: MAX_INPUT_DELAY,
    });
    // Even with all signals elevated, can't exceed max
    expect(advisor.recommend(500)).toBeLessThanOrEqual(MAX_INPUT_DELAY);
  });

  it('clamps to MIN_INPUT_DELAY', () => {
    const advisor = new DelayAdvisor();
    advisor.recordRound({
      lateInputCount: 0,
      totalTicks: 600,
      peakPredictAhead: 0,
      stallCount: 0,
      previousDelay: MIN_INPUT_DELAY,
    });
    expect(advisor.recommend(5)).toBeGreaterThanOrEqual(MIN_INPUT_DELAY);
  });

  it('resets to RTT baseline after clear()', () => {
    const advisor = new DelayAdvisor();
    advisor.recordRound({
      lateInputCount: 500,
      totalTicks: 600,
      peakPredictAhead: 20,
      stallCount: 5,
      previousDelay: 4,
    });
    advisor.clear();
    expect(advisor.recommend(MED_RTT)).toBe(computeInputDelay(MED_RTT));
  });

  it('raises delay by +2 for severe late-input rate (>50%)', () => {
    const advisor = new DelayAdvisor();
    const baseline = computeInputDelay(MED_RTT);
    advisor.recordRound({
      lateInputCount: 350,  // 58% of 600 ticks — above 50% threshold
      totalTicks: 600,
      peakPredictAhead: baseline,  // within bounds (no predict spike)
      stallCount: 0,
      previousDelay: baseline,
    });
    expect(advisor.recommend(MED_RTT)).toBe(baseline + 2);
  });

  it('raises delay by +3 for severe late rate with stalls', () => {
    const advisor = new DelayAdvisor();
    const baseline = computeInputDelay(MED_RTT);
    advisor.recordRound({
      lateInputCount: 350,  // 58% — severe
      totalTicks: 600,
      peakPredictAhead: baseline,
      stallCount: 8,         // >5 stalls
      previousDelay: baseline,
    });
    expect(advisor.recommend(MED_RTT)).toBe(baseline + 3);
  });

  it('severe late rate + predict spike gives +3 (2 for late + 1 for predict)', () => {
    const advisor = new DelayAdvisor();
    const baseline = computeInputDelay(MED_RTT);
    advisor.recordRound({
      lateInputCount: 400,          // 67% — severe → +2
      totalTicks: 600,
      peakPredictAhead: baseline * 3, // spike → +1 more
      stallCount: 0,
      previousDelay: baseline,
    });
    expect(advisor.recommend(MED_RTT)).toBe(baseline + 3);
  });
});
