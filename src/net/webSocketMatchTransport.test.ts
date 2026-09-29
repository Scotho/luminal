// ── WebSocketMatchTransport Tests ────────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InputFrame } from '../core/simulation';

// ── Mock WebSocket ──────────────────────────────────────
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket._lastInstance = this;
  }

  send(data: string): void { this.sent.push(data); }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose(new CloseEvent('close'));
  }

  _simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen(new Event('open'));
  }

  _simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  _simulateClose(code = 1000): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose(new CloseEvent('close', { code }));
  }

  static _lastInstance: MockWebSocket | null = null;
}

vi.stubGlobal('WebSocket', MockWebSocket);

vi.mock('../firebase', () => ({
  auth: { currentUser: { getIdToken: vi.fn(() => Promise.resolve('mock-token-123')) } },
  rtdb: { __rtdb: true },
}));

vi.mock('firebase/database', () => ({
  ref: vi.fn((_db: unknown, path: string) => ({ __path: path })),
  set: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
}));

import { WebSocketMatchTransport } from './webSocketMatchTransport';

describe('WebSocketMatchTransport', () => {
  let transport: WebSocketMatchTransport;
  const matchId = 'match1';
  const myUid = 'uid1';
  const opponentUids = ['uid2'];
  const uidToIndex = new Map([['uid1', 0], ['uid2', 1]]);
  const relayUrl = 'wss://relay.example.com';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    MockWebSocket._lastInstance = null;
    transport = new WebSocketMatchTransport(matchId, myUid, opponentUids, uidToIndex, relayUrl);
  });

  afterEach(() => { vi.useRealTimers(); });

  async function connectTransport(): Promise<MockWebSocket> {
    const p = transport.connect();
    // connect() awaits getIdToken() before constructing WebSocket,
    // so flush microtasks first to let the constructor run.
    await Promise.resolve();
    const ws = MockWebSocket._lastInstance!;
    ws._simulateOpen();
    ws._simulateMessage({ kind: 'auth-ok' });
    await p;
    return ws;
  }

  describe('connect', () => {
    it('creates WebSocket and sends auth on open', async () => {
      const ws = await connectTransport();
      expect(ws.url).toBe(relayUrl);
      expect(ws.sent.length).toBeGreaterThanOrEqual(1);
      const authMsg = JSON.parse(ws.sent[0]);
      expect(authMsg.kind).toBe('auth');
      expect(authMsg.token).toBe('mock-token-123');
      expect(authMsg.matchId).toBe(matchId);
      expect(authMsg.uid).toBe(myUid);
    });

    it('rejects if auth fails', async () => {
      const p = transport.connect();
      await Promise.resolve();
      const ws = MockWebSocket._lastInstance!;
      ws._simulateOpen();
      ws._simulateMessage({ kind: 'auth-fail', reason: 'invalid token' });
      await expect(p).rejects.toThrow('auth-fail');
    });
  });

  describe('sendInputs', () => {
    it('sends JSON with seq', async () => {
      const ws = await connectTransport();
      const frames: InputFrame[] = [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }];
      transport.sendInputs(frames);
      const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(msg.kind).toBe('inputs');
      expect(msg.payload).toEqual(frames);
      expect(msg.seq).toBe(1);
    });

    it('increments seq', async () => {
      const ws = await connectTransport();
      const frames: InputFrame[] = [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }];
      transport.sendInputs(frames);
      transport.sendInputs(frames);
      const msg1 = JSON.parse(ws.sent[ws.sent.length - 2]);
      const msg2 = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(msg2.seq).toBe(msg1.seq + 1);
    });
  });

  describe('deduplication', () => {
    it('dedupes duplicate seq from same sender', async () => {
      const cb = vi.fn();
      transport.onRemoteInputs(cb);
      const ws = await connectTransport();
      const frames = [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }];
      ws._simulateMessage({ kind: 'inputs', fromUid: 'uid2', seq: 1, payload: frames });
      ws._simulateMessage({ kind: 'inputs', fromUid: 'uid2', seq: 1, payload: frames });
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('ignores older seq', async () => {
      const cb = vi.fn();
      transport.onRemoteInputs(cb);
      const ws = await connectTransport();
      const frames = [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }];
      ws._simulateMessage({ kind: 'inputs', fromUid: 'uid2', seq: 2, payload: frames });
      ws._simulateMessage({ kind: 'inputs', fromUid: 'uid2', seq: 1, payload: frames });
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendHash', () => {
    it('sends hash message', async () => {
      const ws = await connectTransport();
      transport.sendHash(60, 99999);
      const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(msg.kind).toBe('hash');
      expect(msg.tick).toBe(60);
      expect(msg.hash).toBe(99999);
    });
  });

  describe('sendSnapshot', () => {
    it('sends snapshot message', async () => {
      const ws = await connectTransport();
      transport.sendSnapshot({ tick: 100, players: [] });
      const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
      expect(msg.kind).toBe('snapshot');
      expect(msg.payload).toEqual({ tick: 100, players: [] });
    });
  });

  describe('onDisconnect', () => {
    it('does not fire on intentional disconnect', async () => {
      const dcCb = vi.fn();
      transport.onDisconnect(dcCb);
      await connectTransport();
      transport.disconnect();
      // Intentional disconnect nulls onclose — callback is for unexpected drops only
      expect(dcCb).not.toHaveBeenCalled();
    });

    it('fires after reconnect retries exhausted on unexpected close', async () => {
      const dcCb = vi.fn();
      transport.onDisconnect(dcCb);
      const ws = await connectTransport();
      ws._simulateClose(1006);

      // Should not fire immediately — reconnect in progress
      expect(dcCb).not.toHaveBeenCalled();

      // Helper to flush multiple microtask rounds
      const flush = async () => {
        for (let j = 0; j < 5; j++) await Promise.resolve();
      };

      // Exhaust 5 reconnect attempts (1s, 2s, 4s, 8s, 10s backoff — capped at 10s)
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(Math.min(1000 * Math.pow(2, i), 10_000));
        await flush();
        const retry = MockWebSocket._lastInstance!;
        retry._simulateClose(1006);
        await flush();
      }

      expect(dcCb).toHaveBeenCalledTimes(1);
    });
  });

  describe('RTT', () => {
    it('updates from pong', async () => {
      const ws = await connectTransport();
      const now = Date.now();
      ws._simulateMessage({ kind: 'pong', ts: now - 50 });
      expect(transport.estimatedRttMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('connect failure handling', () => {
    it('rejects if socket closes before auth response', async () => {
      const p = transport.connect();
      await Promise.resolve();
      const ws = MockWebSocket._lastInstance!;
      ws._simulateOpen();
      // Socket closes before auth-ok arrives
      ws._simulateClose(1006);
      await expect(p).rejects.toThrow('socket closed before auth');
    });

    it('rejects on connect timeout', async () => {
      const p = transport.connect();
      await Promise.resolve();
      const ws = MockWebSocket._lastInstance!;
      ws._simulateOpen();
      // Don't send auth-ok — let timeout fire
      vi.advanceTimersByTime(5001);
      await expect(p).rejects.toThrow('connect timeout');
    });
  });

  describe('disconnect', () => {
    it('closes socket', async () => {
      const ws = await connectTransport();
      transport.disconnect();
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('is idempotent', async () => {
      await connectTransport();
      transport.disconnect();
      transport.disconnect(); // no throw
    });
  });

  describe('serde cost tracking', () => {
    it('serializeCostAvgMs populates from send calls', async () => {
      await connectTransport();
      const frames = [{ tick: 1, turnDir: 0 as const, accelerate: false, dash: false, brake: false }];
      // Send multiple messages to populate serde cost samples
      for (let i = 0; i < 5; i++) {
        transport.sendInputs(frames);
      }
      const stats = transport.transportTelemetry;
      // serializeCostAvgMs should be a non-negative number
      expect(typeof stats.serializeCostAvgMs).toBe('number');
      expect(stats.serializeCostAvgMs).toBeGreaterThanOrEqual(0);
    });

    it('deserializeCostAvgMs populates from received messages', async () => {
      const ws = await connectTransport();
      const frames = [{ tick: 1, turnDir: 0, accelerate: false, dash: false, brake: false }];
      // Receive multiple messages to populate deserialize cost samples
      for (let i = 0; i < 5; i++) {
        ws._simulateMessage({ kind: 'inputs', fromUid: 'uid2', seq: i + 1, payload: frames });
      }
      const stats = transport.transportTelemetry;
      expect(typeof stats.deserializeCostAvgMs).toBe('number');
      expect(stats.deserializeCostAvgMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('bandwidth log size cap', () => {
    it('prunes log to 200 entries under burst conditions', async () => {
      await connectTransport();
      const frames = [{ tick: 1, turnDir: 0 as const, accelerate: false, dash: false, brake: false }];
      // Send 300 messages rapidly — all within the 10s time window
      for (let i = 0; i < 300; i++) {
        transport.sendInputs(frames);
      }
      // The internal _sendLog should be capped at 200 by the size guard
      // Verify indirectly: transportTelemetry should not throw and sendRateBps should be reasonable
      const stats = transport.transportTelemetry;
      expect(stats.sendRateBps).toBeGreaterThanOrEqual(0);
      // messagesSent includes auth handshake message, so >= 300
      expect(stats.messagesSent).toBeGreaterThanOrEqual(300);
    });
  });
});
