import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoopbackHub } from './loopbackTransport';
import type { InputFrame } from '../core/simulation';

const frame = (tick: number): InputFrame => ({
  tick,
  turnDir: 0,
  accelerate: false,
  dash: false,
  brake: false,
});

describe('LoopbackHub', () => {
  let hub: LoopbackHub;

  beforeEach(() => {
    hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 0 });
  });

  afterEach(() => {
    hub.dispose();
  });

  it('creates transports for N players', () => {
    const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
    const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
    expect(t0).toBeDefined();
    expect(t1).toBeDefined();
  });

  it('relays inputs between two transports', async () => {
    const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
    const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);

    await t0.connect();
    await t1.connect();

    const received: InputFrame[][] = [];
    t1.onRemoteInputs((_idx, frames) => received.push(frames));

    const packet: InputFrame[] = [{ tick: 1, turnDir: 1, accelerate: false, dash: false, brake: false }];
    t0.sendInputs(packet);

    // Synchronous delivery at 0 latency
    expect(received).toHaveLength(1);
    expect(received[0][0].turnDir).toBe(1);
  });

  it('relays hashes between transports', async () => {
    const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
    const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);

    await t0.connect();
    await t1.connect();

    let receivedTick = -1;
    let receivedHash = -1;
    t1.onRemoteHash((tick, hash) => { receivedTick = tick; receivedHash = hash; });

    t0.sendHash(60, 123456);

    expect(receivedTick).toBe(60);
    expect(receivedHash).toBe(123456);
  });

  it('supports packet loss', async () => {
    hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 1.0 }); // 100% loss
    const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
    const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);

    await t0.connect();
    await t1.connect();

    const received: InputFrame[][] = [];
    t1.onRemoteInputs((_idx, frames) => received.push(frames));

    t0.sendInputs([{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }]);

    expect(received).toHaveLength(0);
  });

  it('fans out to all peers in 3-player setup', async () => {
    const uids = ['uid-0', 'uid-1', 'uid-2'];
    const t0 = hub.createTransport(0, uids[0], [uids[1], uids[2]]);
    const t1 = hub.createTransport(1, uids[1], [uids[0], uids[2]]);
    const t2 = hub.createTransport(2, uids[2], [uids[0], uids[1]]);

    await Promise.all([t0.connect(), t1.connect(), t2.connect()]);

    const recv1: InputFrame[][] = [];
    const recv2: InputFrame[][] = [];
    t1.onRemoteInputs((_idx, frames) => recv1.push(frames));
    t2.onRemoteInputs((_idx, frames) => recv2.push(frames));

    t0.sendInputs([{ tick: 1, turnDir: 1, accelerate: false, dash: false, brake: false }]);

    expect(recv1).toHaveLength(1);
    expect(recv2).toHaveLength(1);
  });

  it('fires onDisconnect when transport disconnects', async () => {
    const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
    const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);

    await t0.connect();
    await t1.connect();

    const disconnected = vi.fn();
    t1.onDisconnect(disconnected);

    t0.disconnect();

    expect(disconnected).toHaveBeenCalledOnce();
  });

  // ── setBurstLoss ─────────────────────────────────────────────────

  describe('setBurstLoss', () => {
    it('drops exactly count consecutive packets after triggerBurstLoss', async () => {
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      hub.setBurstLoss(3);
      hub.triggerBurstLoss();

      // Send 5 packets — first 3 should be dropped
      for (let i = 0; i < 5; i++) {
        t0.sendInputs([frame(i)]);
      }

      expect(received).toHaveLength(2);
      expect(received[0][0].tick).toBe(3);
      expect(received[1][0].tick).toBe(4);
    });

    it('does not drop packets before trigger', async () => {
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      hub.setBurstLoss(2); // no trigger
      t0.sendInputs([frame(0)]);
      t0.sendInputs([frame(1)]);

      expect(received).toHaveLength(2);
    });

    it('auto-triggers on interval', async () => {
      vi.useFakeTimers();

      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      hub.setBurstLoss(2, 100);

      // First burst is already armed (remaining = count)
      t0.sendInputs([frame(0)]); // dropped
      t0.sendInputs([frame(1)]); // dropped
      t0.sendInputs([frame(2)]); // delivered
      expect(received).toHaveLength(1);

      // After interval, another burst triggers
      vi.advanceTimersByTime(100);
      t0.sendInputs([frame(3)]); // dropped
      t0.sendInputs([frame(4)]); // dropped
      t0.sendInputs([frame(5)]); // delivered
      expect(received).toHaveLength(2);

      vi.useRealTimers();
    });

    it('clearBurstLoss stops dropping', async () => {
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      hub.setBurstLoss(100);
      hub.triggerBurstLoss();
      hub.clearBurstLoss();

      t0.sendInputs([frame(0)]);
      expect(received).toHaveLength(1);
    });
  });

  // ── setAsymmetricLatency ─────────────────────────────────────────

  describe('setAsymmetricLatency', () => {
    it('applies different latency per direction', async () => {
      vi.useFakeTimers();

      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      hub.setAsymmetricLatency(50, 200); // uid-0→uid-1 = 50ms, uid-1→uid-0 = 200ms

      const recvAt1: InputFrame[][] = [];
      const recvAt0: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => recvAt1.push(frames));
      t0.onRemoteInputs((_idx, frames) => recvAt0.push(frames));

      t0.sendInputs([frame(0)]); // should arrive at t1 after 50ms
      t1.sendInputs([frame(1)]); // should arrive at t0 after 200ms

      // At 49ms nothing arrived
      vi.advanceTimersByTime(49);
      expect(recvAt1).toHaveLength(0);
      expect(recvAt0).toHaveLength(0);

      // At 50ms, A→B arrives
      vi.advanceTimersByTime(1);
      expect(recvAt1).toHaveLength(1);
      expect(recvAt0).toHaveLength(0);

      // At 200ms, B→A arrives
      vi.advanceTimersByTime(150);
      expect(recvAt0).toHaveLength(1);

      vi.useRealTimers();
    });

    it('allows specifying uidA explicitly', async () => {
      vi.useFakeTimers();

      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      // Reverse: designate uid-1 as A
      hub.setAsymmetricLatency(10, 90, 'uid-1');

      const recvAt0: InputFrame[][] = [];
      t0.onRemoteInputs((_idx, frames) => recvAt0.push(frames));

      t1.sendInputs([frame(0)]); // uid-1 is A, so A→B = 10ms
      vi.advanceTimersByTime(10);
      expect(recvAt0).toHaveLength(1);

      vi.useRealTimers();
    });

    it('clearAsymmetricLatency reverts to config latency', async () => {
      hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 0 });
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      hub.setAsymmetricLatency(100, 200);
      hub.clearAsymmetricLatency();

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      t0.sendInputs([frame(0)]);
      // With latencyMs=0 and no asymmetric, should be synchronous
      expect(received).toHaveLength(1);
    });
  });

  // ── setJitter ────────────────────────────────────────────────────

  describe('setJitter', () => {
    it('delivers packets with latency in [baseMs-variance, baseMs+variance]', async () => {
      vi.useFakeTimers();

      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      hub.setJitter(100, 50); // 50..150ms

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      // Seed Math.random to return 0 → jitter = -50 → latency = 50ms
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
      t0.sendInputs([frame(0)]);

      vi.advanceTimersByTime(49);
      expect(received).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(received).toHaveLength(1);

      // random returns 1 → jitter = +50 → latency = 150ms
      randomSpy.mockReturnValue(1);
      t0.sendInputs([frame(1)]);
      vi.advanceTimersByTime(149);
      expect(received).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(received).toHaveLength(2);

      randomSpy.mockRestore();
      vi.useRealTimers();
    });

    it('clamps negative latency to 0 (synchronous)', async () => {
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      hub.setJitter(10, 100); // min = 10-100 = -90, clamped to 0

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      vi.spyOn(Math, 'random').mockReturnValue(0); // jitter = -100
      t0.sendInputs([frame(0)]);
      // Clamped to 0 → synchronous
      expect(received).toHaveLength(1);

      vi.spyOn(Math, 'random').mockRestore();
    });

    it('clearJitter reverts to config latency', async () => {
      hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 0 });
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      hub.setJitter(100, 50);
      hub.clearJitter();

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      t0.sendInputs([frame(0)]);
      expect(received).toHaveLength(1); // 0 latency = synchronous
    });
  });

  // ── degradeOverTime ──────────────────────────────────────────────

  describe('degradeOverTime', () => {
    it('ramps latency linearly from start to end over durationTicks', async () => {
      vi.useFakeTimers();

      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      hub.degradeOverTime(0, 100, 10);

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      // First relay → tick auto-advances to 1 → latency = 0 + (100-0)*(1/10) = 10ms
      t0.sendInputs([frame(0)]);
      vi.advanceTimersByTime(9);
      expect(received).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(received).toHaveLength(1);

      // Second relay → tick=2 → latency = 20ms
      t0.sendInputs([frame(1)]);
      vi.advanceTimersByTime(19);
      expect(received).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(received).toHaveLength(2);

      vi.useRealTimers();
    });

    it('caps at endMs once durationTicks is reached', async () => {
      vi.useFakeTimers();

      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      hub.degradeOverTime(0, 50, 2);

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      // tick 1 → 25ms
      t0.sendInputs([frame(0)]);
      vi.advanceTimersByTime(25);
      expect(received).toHaveLength(1);

      // tick 2 → 50ms (at cap)
      t0.sendInputs([frame(1)]);
      vi.advanceTimersByTime(50);
      expect(received).toHaveLength(2);

      // tick still capped at 2 → still 50ms
      t0.sendInputs([frame(2)]);
      vi.advanceTimersByTime(50);
      expect(received).toHaveLength(3);

      vi.useRealTimers();
    });

    it('supports manual tick() advancement', async () => {
      vi.useFakeTimers();

      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      hub.degradeOverTime(0, 100, 10);

      // Manually advance 5 ticks before any relay
      for (let i = 0; i < 5; i++) hub.tick();

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      // tick is 5, then relay auto-increments to 6 → latency = 60ms
      t0.sendInputs([frame(0)]);
      vi.advanceTimersByTime(59);
      expect(received).toHaveLength(0);
      vi.advanceTimersByTime(1);
      expect(received).toHaveLength(1);

      vi.useRealTimers();
    });

    it('clearDegradeOverTime reverts to config latency', async () => {
      hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 0 });
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      hub.degradeOverTime(50, 200, 10);
      hub.clearDegradeOverTime();

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      t0.sendInputs([frame(0)]);
      expect(received).toHaveLength(1); // synchronous
    });
  });

  // ── getStats ─────────────────────────────────────────────────────

  describe('getStats', () => {
    it('counts relayed messages with zero loss', async () => {
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      t0.sendInputs([frame(0)]);
      t0.sendInputs([frame(1)]);
      t0.sendInputs([frame(2)]);

      const stats = hub.getStats();
      expect(stats.messagesRelayed).toBe(3);
      expect(stats.messagesDropped).toBe(0);
    });

    it('counts dropped messages from 100% packet loss', async () => {
      hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 1.0 });
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      t0.sendInputs([frame(0)]);
      t0.sendInputs([frame(1)]);

      const stats = hub.getStats();
      expect(stats.messagesRelayed).toBe(0);
      expect(stats.messagesDropped).toBe(2);
    });

    it('records delivery delays for latency > 0', async () => {
      vi.useFakeTimers();

      hub = new LoopbackHub({ latencyMs: 50, packetLossRate: 0 });
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      t0.sendInputs([frame(0)]);
      vi.advanceTimersByTime(100);

      const stats = hub.getStats();
      expect(stats.messagesRelayed).toBe(1);
      expect(stats.deliveryDelays).toHaveLength(1);
      expect(stats.deliveryDelays[0]).toBe(50);

      vi.useRealTimers();
    });

    it('counts burst-loss drops separately', async () => {
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      hub.setBurstLoss(2);
      hub.triggerBurstLoss();

      // 3 sends: first 2 dropped by burst, 3rd relayed
      t0.sendInputs([frame(0)]);
      t0.sendInputs([frame(1)]);
      t0.sendInputs([frame(2)]);

      const stats = hub.getStats();
      expect(stats.messagesRelayed).toBe(1);
      expect(stats.messagesDropped).toBe(2);
    });
  });

  // ── Composition ──────────────────────────────────────────────────

  describe('composition', () => {
    it('burstLoss composes with existing packetLossRate', async () => {
      hub = new LoopbackHub({ latencyMs: 0, packetLossRate: 0 });
      const t0 = hub.createTransport(0, 'uid-0', ['uid-1']);
      const t1 = hub.createTransport(1, 'uid-1', ['uid-0']);
      await t0.connect();
      await t1.connect();

      const received: InputFrame[][] = [];
      t1.onRemoteInputs((_idx, frames) => received.push(frames));

      // Burst drops first 2, then packetLossRate=0 lets the rest through
      hub.setBurstLoss(2);
      hub.triggerBurstLoss();

      for (let i = 0; i < 4; i++) t0.sendInputs([frame(i)]);

      expect(received).toHaveLength(2);
      expect(received[0][0].tick).toBe(2);
    });

    it('dispose cleans up all degradation state', () => {
      vi.useFakeTimers();

      hub.createTransport(0, 'uid-0', ['uid-1']);
      hub.setBurstLoss(5, 100);
      hub.setAsymmetricLatency(10, 20);
      hub.setJitter(50, 25);
      hub.degradeOverTime(0, 100, 10);

      hub.dispose();

      // No errors when creating a fresh setup on the same hub
      // (internal state is cleared)
      expect(() => hub.createTransport(0, 'uid-0', ['uid-1'])).not.toThrow();

      vi.useRealTimers();
    });
  });
});
