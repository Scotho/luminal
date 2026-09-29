// ── LockstepHashVerifier Tests ───────────────────────────
// TASK-139: hash match, mismatch, recovery trigger at 3 desyncs in 10s.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LockstepHashVerifier, type HashVerifierContext } from './lockstepHashVerifier';
import { LockstepTelemetryCollector } from './lockstepTelemetryCollector';
import { SnapshotBuffer, createSimState, type SimState } from './simulation';

function makeContext(overrides: Partial<HashVerifierContext> = {}): HashVerifierContext {
  return {
    snapshots: new SnapshotBuffer(10),
    callbacks: {},
    telemetry: new LockstepTelemetryCollector(),
    quantizeInterval: 30,
    getState: () => createSimState([{ x: 0, z: 0, angle: 0 }], []),
    getPredictedInputsSize: () => 0,
    ...overrides,
  };
}

describe('LockstepHashVerifier', () => {
  let verifier: LockstepHashVerifier;
  let ctx: HashVerifierContext;

  beforeEach(() => {
    ctx = makeContext();
    verifier = new LockstepHashVerifier(ctx);
  });

  it('matching hashes produce no desync', () => {
    // Record a local hash, then receive matching remote hash
    verifier.recordLocalHash(60, 0xABCD);
    verifier.receiveRemoteHash(60, 0xABCD);

    expect(verifier.desyncCount).toBe(0);
  });

  it('mismatching hashes increment desync count and fire callback', () => {
    const onDesync = vi.fn();
    ctx = makeContext({ callbacks: { onDesync } });
    verifier = new LockstepHashVerifier(ctx);

    verifier.recordLocalHash(60, 0xABCD);
    verifier.receiveRemoteHash(60, 0x1234);

    expect(verifier.desyncCount).toBe(1);
    expect(onDesync).toHaveBeenCalledWith(60, 0xABCD, 0x1234);
  });

  it('triggers recovery after 3 desyncs within 10 seconds', () => {
    const onDesyncRecovery = vi.fn();
    const telemetry = new LockstepTelemetryCollector();
    const state = createSimState([{ x: 0, z: 0, angle: 0 }], []);
    ctx = makeContext({
      callbacks: { onDesyncRecovery },
      telemetry,
      getState: () => state,
    });
    verifier = new LockstepHashVerifier(ctx);

    // Simulate 3 desyncs in quick succession (all within 10s window)
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    verifier.recordLocalHash(60, 0x1111);
    verifier.receiveRemoteHash(60, 0x2222);
    expect(verifier.desyncCount).toBe(1);
    expect(onDesyncRecovery).not.toHaveBeenCalled();

    verifier.recordLocalHash(120, 0x3333);
    verifier.receiveRemoteHash(120, 0x4444);
    expect(verifier.desyncCount).toBe(2);
    expect(onDesyncRecovery).not.toHaveBeenCalled();

    verifier.recordLocalHash(180, 0x5555);
    verifier.receiveRemoteHash(180, 0x6666);
    expect(verifier.desyncCount).toBe(3);
    expect(onDesyncRecovery).toHaveBeenCalledWith(state);
    expect(verifier.recoveryInProgress).toBe(true);
  });
});
