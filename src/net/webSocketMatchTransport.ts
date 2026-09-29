// ── WebSocket Match Transport ────────────────────────────
// Thin WebSocket client for the latency-sensitive lockstep packet lane.
// Authenticates with Firebase ID token, dedupes by (fromUid, seq),
// mirrors heartbeat to RTDB for claimForfeit compatibility.

import { auth } from '../firebase';
import { rtdb } from '../firebase';
import { ref, set, serverTimestamp } from 'firebase/database';
import type { InputFrame } from '../core/simulation';
import type { MatchTransport, TransportTelemetry, MessageTypeStats } from './matchTransport';
import { net } from '../netLog';
import { RingBuffer } from '../telemetry';

const HEARTBEAT_MIRROR_INTERVAL = 3000;
const PING_INTERVAL = 5000;
const CONNECT_TIMEOUT_MS = 5000;

export class WebSocketMatchTransport implements MatchTransport {
  private _matchId: string;
  private _myUid: string;
  private _opponentUids: string[];
  private _uidToIndex: Map<string, number>;
  private _relayUrl: string;

  private _ws: WebSocket | null = null;
  private _outSeq = 0;
  private _lastSeqByUid: Map<string, number> = new Map();
  private _rttMs = 0;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _pingTimer: ReturnType<typeof setInterval> | null = null;
  private _lastPingSentAt = 0;
  private _intentionalClose = false;
  private _reconnectAttempts = 0;
  private _isReconnecting = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _maxReconnectAttempts = 5;
  /** Whether the initial auth handshake has completed at least once. */
  private _authCompleted = false;

  // Transport telemetry
  private _bytesSent = 0;
  private _bytesReceived = 0;
  private _messagesSent = 0;
  private _messagesReceived = 0;
  private _rttSamples = new RingBuffer<number>(20);
  private _jitterMs = 0;
  // Per-message size tracking (rolling 60-sample windows)
  private _outSizes = new RingBuffer<number>(60);
  private _inSizes = new RingBuffer<number>(60);
  private _peakOutSize = 0;
  private _peakInSize = 0;
  // Connect latency tracking
  private _connectStartMs = 0;
  private _connectLatencyMs = 0;
  // Per-message-type byte tracking
  private _msgTypeStats: Record<string, { bytesSent: number; bytesReceived: number; count: number }> = {};
  // Bandwidth rate tracking (rolling 10s window)
  private _sendLog: Array<{ ts: number; bytes: number }> = [];
  private _recvLog: Array<{ ts: number; bytes: number }> = [];
  // Serialization cost tracking (JSON.stringify / JSON.parse overhead)
  private _serializeCostSamples = new RingBuffer<number>(60);
  private _deserializeCostSamples = new RingBuffer<number>(60);
  // Connection state duration tracking
  private _disconnectedAtMs = 0;
  private _totalDowntimeMs = 0;
  private _reconnectDurations = new RingBuffer<number>(20);

  // Pending connect promise resolve/reject — cleared on auth-ok/auth-fail/close
  private _connectResolve: ((value: void) => void) | null = null;
  private _connectReject: ((reason: Error) => void) | null = null;
  private _connectTimer: ReturnType<typeof setTimeout> | null = null;

  private _onRemoteInputsCb: ((playerIndex: number, frames: InputFrame[]) => void) | null = null;
  private _onRemoteHashCb: ((tick: number, hash: number) => void) | null = null;
  private _onRemoteSnapshotCb: ((data: unknown) => void) | null = null;
  private _onDisconnectCb: (() => void) | null = null;

  constructor(
    matchId: string,
    myUid: string,
    opponentUids: string[],
    uidToIndex: Map<string, number>,
    relayUrl: string,
  ) {
    this._matchId = matchId;
    this._myUid = myUid;
    this._opponentUids = opponentUids;
    this._uidToIndex = uidToIndex;
    this._relayUrl = relayUrl;
  }

  async connect(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error('No authenticated user');
    const token = await user.getIdToken();
    net.info('[transport] ws-connecting relay=' + this._relayUrl);

    this._intentionalClose = false;
    if (!this._isReconnecting) this._reconnectAttempts = 0;

    return new Promise<void>((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject = reject;

      // Timeout — reject if auth doesn't complete within CONNECT_TIMEOUT_MS
      this._connectTimer = setTimeout(() => {
        net.error('[transport] ws-timeout after=' + CONNECT_TIMEOUT_MS + 'ms');
        this._settleConnect(undefined, new Error('connect timeout'));
        if (this._ws) {
          this._ws.onclose = null;
          this._ws.close();
          this._ws = null;
        }
        this._cleanup();
      }, CONNECT_TIMEOUT_MS);

      this._ws = new WebSocket(this._relayUrl);

      this._ws.onopen = () => {
        this._connectStartMs = performance.now();
        net.info('[transport] ws-open sending-auth');
        this._sendRaw({
          kind: 'auth',
          token,
          matchId: this._matchId,
          uid: this._myUid,
        });
      };

      this._ws.onmessage = (ev: MessageEvent) => {
        const raw = ev.data as string;
        const len = raw.length;
        this._bytesReceived += len;
        this._messagesReceived++;
        this._inSizes.push(len);
        if (len > this._peakInSize) this._peakInSize = len;
        // Bandwidth rate log
        const now = performance.now();
        this._recvLog.push({ ts: now, bytes: len });
        this._pruneBandwidthLog(this._recvLog, now);
        let msg: Record<string, unknown>;
        try {
          const t0 = performance.now();
          msg = JSON.parse(raw);
          this._deserializeCostSamples.push(performance.now() - t0);
        } catch {
          return;
        }
        // Per-message-type receive tracking
        const kind = (msg.kind as string) || 'unknown';
        if (kind === 'inputs' || kind === 'hash' || kind === 'snapshot') {
          const entry = this._msgTypeStats[kind] ??= { bytesSent: 0, bytesReceived: 0, count: 0 };
          entry.bytesReceived += len;
        }
        this._handleMessage(msg);
      };

      this._ws.onclose = () => {
        this._cleanup();
        // Reject pending connect promise if still waiting
        this._settleConnect(undefined, new Error('socket closed before auth'));
        if (this._intentionalClose) {
          net.info('[transport] ws-closed intentional');
          if (this._onDisconnectCb) this._onDisconnectCb();
          return;
        }
        // Only auto-reconnect if auth completed at least once (initial connect succeeded).
        // If the socket closes before auth-ok, this is a connect failure, not a reconnect case.
        if (!this._authCompleted) {
          net.warn('[transport] ws-closed before-auth');
          if (this._onDisconnectCb) this._onDisconnectCb();
          return;
        }
        // Track disconnection start time for downtime measurement
        if (this._disconnectedAtMs === 0) this._disconnectedAtMs = performance.now();
        // During reconnect, the .catch() chain in _attemptReconnect handles retries
        if (!this._isReconnecting) this._startReconnect();
        net.warn('[disconnect] ws-lost starting-reconnect');
      };

      this._ws.onerror = () => {
        // onclose will fire after onerror
      };
    });
  }

  disconnect(): void {
    this._intentionalClose = true;
    net.info('[transport] ws-disconnect intentional');
    this._isReconnecting = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.onmessage = null;
      this._ws.onerror = null;
      this._ws.close();
      this._ws = null;
    }
    this._cleanup();
    // Clear any pending connect
    this._settleConnect(undefined, new Error('disconnected'));
  }

  sendInputs(packet: InputFrame[]): void {
    this._sendRaw({ kind: 'inputs', payload: packet, seq: ++this._outSeq });
  }

  sendHash(tick: number, hash: number): void {
    this._sendRaw({ kind: 'hash', tick, hash, seq: ++this._outSeq });
  }

  sendSnapshot(data: unknown): void {
    this._sendRaw({ kind: 'snapshot', payload: data, seq: ++this._outSeq });
  }

  onRemoteInputs(cb: (playerIndex: number, frames: InputFrame[]) => void): void {
    this._onRemoteInputsCb = cb;
  }

  onRemoteHash(cb: (tick: number, hash: number) => void): void {
    this._onRemoteHashCb = cb;
  }

  onRemoteSnapshot(cb: (data: unknown) => void): void {
    this._onRemoteSnapshotCb = cb;
  }

  onDisconnect(cb: () => void): void {
    this._onDisconnectCb = cb;
  }

  get estimatedRttMs(): number {
    return this._rttMs;
  }

  get transportState(): 'connected' | 'reconnecting' | 'disconnected' {
    if (this._isReconnecting) return 'reconnecting';
    if (this._ws && this._ws.readyState === WebSocket.OPEN) return 'connected';
    return 'disconnected';
  }

  /** Jitter estimate in ms (mean absolute deviation of RTT samples). */
  get jitterMs(): number {
    return Math.round(this._jitterMs * 10) / 10;
  }

  /** Transport-level telemetry snapshot. */
  get transportTelemetry(): TransportTelemetry {
    const avgOut = this._outSizes.length > 0
      ? Math.round(this._outSizes.reduce((a: number, b: number) => a + b, 0) / this._outSizes.length)
      : 0;
    const avgIn = this._inSizes.length > 0
      ? Math.round(this._inSizes.reduce((a: number, b: number) => a + b, 0) / this._inSizes.length)
      : 0;
    // Compute bandwidth rates from rolling 10s window
    const now = performance.now();
    this._pruneBandwidthLog(this._sendLog, now);
    this._pruneBandwidthLog(this._recvLog, now);
    const sendWindow = this._sendLog.length > 0
      ? Math.max(1, (now - this._sendLog[0].ts) / 1000) : 1;
    const recvWindow = this._recvLog.length > 0
      ? Math.max(1, (now - this._recvLog[0].ts) / 1000) : 1;
    const sendRateBps = this._sendLog.reduce((sum, e) => sum + e.bytes, 0) / sendWindow;
    const recvRateBps = this._recvLog.reduce((sum, e) => sum + e.bytes, 0) / recvWindow;
    // Build per-message-type snapshot
    const messageTypes: Record<string, MessageTypeStats> = {};
    for (const [k, v] of Object.entries(this._msgTypeStats)) {
      messageTypes[k] = { ...v };
    }
    return {
      bytesSent: this._bytesSent,
      bytesReceived: this._bytesReceived,
      messagesSent: this._messagesSent,
      messagesReceived: this._messagesReceived,
      jitterMs: this.jitterMs,
      avgMessageSizeOut: avgOut,
      peakMessageSizeOut: this._peakOutSize,
      avgMessageSizeIn: avgIn,
      peakMessageSizeIn: this._peakInSize,
      reconnectAttempts: this._reconnectAttempts,
      connectLatencyMs: this._connectLatencyMs,
      state: this.transportState,
      messageTypes,
      sendRateBps: Math.round(sendRateBps),
      recvRateBps: Math.round(recvRateBps),
      serializeCostAvgMs: this._serializeCostSamples.length > 0
        ? Math.round(this._serializeCostSamples.reduce((a: number, b: number) => a + b, 0) / this._serializeCostSamples.length * 100) / 100
        : 0,
      deserializeCostAvgMs: this._deserializeCostSamples.length > 0
        ? Math.round(this._deserializeCostSamples.reduce((a: number, b: number) => a + b, 0) / this._deserializeCostSamples.length * 100) / 100
        : 0,
      bufferedBytes: this._ws?.bufferedAmount ?? 0,
      totalDowntimeMs: Math.round(this._totalDowntimeMs),
      reconnectAvgMs: 0,
      reconnectPeakMs: 0,
      backpressureTotalMs: 0,
      reconnectSuccessCount: 0,
      reconnectFailCount: 0,
    };
  }

  // ── Internals ──────────────────────────────────────────

  /** Settle the pending connect promise exactly once. */
  private _settleConnect(value?: void, error?: Error): void {
    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }
    if (error && this._connectReject) {
      const reject = this._connectReject;
      this._connectResolve = null;
      this._connectReject = null;
      reject(error);
    } else if (!error && this._connectResolve) {
      const resolve = this._connectResolve;
      this._connectResolve = null;
      this._connectReject = null;
      resolve(value as void);
    }
  }

  private _handleMessage(msg: Record<string, unknown>): void {
    const kind = msg.kind as string;

    if (kind === 'auth-ok') {
      this._authCompleted = true;
      if (this._connectStartMs > 0) {
        this._connectLatencyMs = Math.round(performance.now() - this._connectStartMs);
        net.info('[transport] ws-auth-ok connectLatency=' + this._connectLatencyMs + 'ms');
      } else {
        net.info('[transport] ws-auth-ok');
      }
      this._startHeartbeatMirror();
      this._startPingLoop();
      this._settleConnect();
      return;
    }
    if (kind === 'auth-fail') {
      net.error('[transport] ws-auth-fail reason=' + (msg.reason || 'unknown'));
      this._settleConnect(undefined, new Error(`auth-fail: ${msg.reason || 'unknown'}`));
      return;
    }

    const fromUid = msg.fromUid as string | undefined;
    const seq = msg.seq as number | undefined;

    if (fromUid && typeof seq === 'number') {
      const lastSeen = this._lastSeqByUid.get(fromUid) ?? 0;
      if (seq <= lastSeen) return;
      this._lastSeqByUid.set(fromUid, seq);
    }

    const playerIndex = fromUid ? this._uidToIndex.get(fromUid) : undefined;

    switch (kind) {
      case 'inputs':
        if (playerIndex !== undefined && this._onRemoteInputsCb && Array.isArray(msg.payload)) {
          this._onRemoteInputsCb(playerIndex, msg.payload as InputFrame[]);
        }
        break;
      case 'hash':
        if (typeof msg.tick === 'number' && typeof msg.hash === 'number' && this._onRemoteHashCb) {
          this._onRemoteHashCb(msg.tick, msg.hash);
        }
        break;
      case 'snapshot':
        if (this._onRemoteSnapshotCb) {
          this._onRemoteSnapshotCb(msg.payload);
        }
        break;
      case 'pong':
        if (typeof msg.ts === 'number') {
          this._rttMs = Date.now() - msg.ts;
          this._rttSamples.push(this._rttMs);
          // Jitter: mean absolute deviation of RTT samples
          if (this._rttSamples.length > 1) {
            const mean = this._rttSamples.reduce((a: number, b: number) => a + b, 0) / this._rttSamples.length;
            const mad = this._rttSamples.reduce((a: number, v: number) => a + Math.abs(v - mean), 0) / this._rttSamples.length;
            this._jitterMs = this._jitterMs * 0.875 + mad * 0.125;
          }
          net.log('[rtt] ws-pong rtt=' + this._rttMs + 'ms jitter=' + this._jitterMs.toFixed(1) + 'ms');
        }
        break;
      // resync-request: not implemented in this pass — ignored
    }
  }

  private _sendRaw(msg: Record<string, unknown>): void {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      const t0 = performance.now();
      const data = JSON.stringify(msg);
      this._serializeCostSamples.push(performance.now() - t0);
      const len = data.length;
      this._bytesSent += len;
      this._messagesSent++;
      this._outSizes.push(len);
      if (len > this._peakOutSize) this._peakOutSize = len;
      // Per-message-type tracking
      const kind = (msg.kind as string) || 'unknown';
      if (kind === 'inputs' || kind === 'hash' || kind === 'snapshot') {
        const entry = this._msgTypeStats[kind] ??= { bytesSent: 0, bytesReceived: 0, count: 0 };
        entry.bytesSent += len;
        entry.count++;
      }
      // Bandwidth rate log
      const now = performance.now();
      this._sendLog.push({ ts: now, bytes: len });
      this._pruneBandwidthLog(this._sendLog, now);
      this._ws.send(data);
    }
  }

  /** Prune bandwidth log entries older than 10s, with a hard cap of 200 entries. */
  private _pruneBandwidthLog(log: Array<{ ts: number; bytes: number }>, now: number): void {
    while (log.length > 0 && now - log[0].ts > 10_000) log.shift();
    if (log.length > 200) log.splice(0, log.length - 200);
  }

  private _startHeartbeatMirror(): void {
    this._stopHeartbeatMirror();
    const write = () => {
      set(ref(rtdb, `matches/${this._matchId}/heartbeat/${this._myUid}`), serverTimestamp()).catch(() => {});
    };
    write();
    this._heartbeatTimer = setInterval(write, HEARTBEAT_MIRROR_INTERVAL);
  }

  private _stopHeartbeatMirror(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  private _startPingLoop(): void {
    this._stopPingLoop();
    this._pingTimer = setInterval(() => {
      this._lastPingSentAt = Date.now();
      this._sendRaw({ kind: 'ping', ts: this._lastPingSentAt });
    }, PING_INTERVAL);
  }

  private _stopPingLoop(): void {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  private _startReconnect(): void {
    this._isReconnecting = true;
    this._reconnectAttempts = 0;
    this._attemptReconnect();
  }

  private _attemptReconnect(): void {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      net.error('[disconnect] ws-reconnect-exhausted attempts=' + this._maxReconnectAttempts);
      this._isReconnecting = false;
      if (this._onDisconnectCb) this._onDisconnectCb();
      return;
    }
    // Exponential backoff: 1s, 2s, 4s, 8s, 10s (capped)
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts), 10_000);
    this._reconnectAttempts++;
    net.warn('[disconnect] ws-reconnect attempt=' + this._reconnectAttempts + '/' + this._maxReconnectAttempts + ' delay=' + delay + 'ms');
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._intentionalClose) { this._isReconnecting = false; return; }
      this.connect()
        .then(() => {
          net.info('[disconnect] ws-reconnected');
          // Record downtime duration
          if (this._disconnectedAtMs > 0) {
            const downtime = performance.now() - this._disconnectedAtMs;
            this._totalDowntimeMs += downtime;
            this._reconnectDurations.push(downtime);
            this._disconnectedAtMs = 0;
          }
          this._reconnectAttempts = 0;
          this._isReconnecting = false;
        })
        .catch(() => { this._attemptReconnect(); });
    }, delay);
  }

  private _cleanup(): void {
    this._stopHeartbeatMirror();
    this._stopPingLoop();
  }
}
