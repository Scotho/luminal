// ── Firebase Match Transport ─────────────────────────────
// Extracted from NetcodeSession's lockstep packet delivery.
// Exact same RTDB semantics: write to own path, listen to opponents.
// This is the fallback transport and the default for legacy clients.

import { rtdb } from '../firebase';
import { ref, set, onValue } from 'firebase/database';
import type { InputFrame } from '../core/simulation';
import type { MatchTransport, TransportTelemetry, MessageTypeStats } from './matchTransport';
import { net } from '../netLog';

interface ListenerEntry {
  unsub: () => void;
}

export class FirebaseMatchTransport implements MatchTransport {
  private _matchId: string;
  private _myUid: string;
  private _opponentUids: string[];
  private _uidToIndex: Map<string, number>;
  private _listeners: ListenerEntry[] = [];

  private _onRemoteInputsCb: ((playerIndex: number, frames: InputFrame[]) => void) | null = null;
  private _onRemoteHashCb: ((tick: number, hash: number) => void) | null = null;
  private _onRemoteSnapshotCb: ((data: unknown) => void) | null = null;
  private _onDisconnectCb: (() => void) | null = null;

  // Telemetry counters
  private _bytesSent = 0;
  private _bytesReceived = 0;
  private _messagesSent = 0;
  private _messagesReceived = 0;
  private _peakOutSize = 0;
  private _peakInSize = 0;
  private _connectStartMs = 0;
  private _connectLatencyMs = 0;
  private _firstDataReceived = false;
  private _msgTypeStats: Record<string, { bytesSent: number; bytesReceived: number; count: number }> = {};

  constructor(
    matchId: string,
    myUid: string,
    opponentUids: string[],
    uidToIndex: Map<string, number>,
  ) {
    this._matchId = matchId;
    this._myUid = myUid;
    this._opponentUids = opponentUids;
    this._uidToIndex = uidToIndex;
  }

  async connect(): Promise<void> {
    this.disconnect();
    this._connectStartMs = performance.now();
    this._firstDataReceived = false;

    for (const oppUid of this._opponentUids) {
      const inputRef = ref(rtdb, `matches/${this._matchId}/inputs/${oppUid}`);
      const inputUnsub = onValue(inputRef, (snap) => {
        const val = snap.val();
        if (!val || !Array.isArray(val)) return;
        this._trackInbound('inputs', val);
        const idx = this._uidToIndex.get(oppUid);
        if (idx !== undefined && this._onRemoteInputsCb) {
          this._onRemoteInputsCb(idx, val as InputFrame[]);
        }
      });
      this._listeners.push({ unsub: inputUnsub });

      const hashRef = ref(rtdb, `matches/${this._matchId}/hashes/${oppUid}`);
      const hashUnsub = onValue(hashRef, (snap) => {
        const val = snap.val();
        if (!val || typeof val.tick !== 'number' || typeof val.hash !== 'number') return;
        this._trackInbound('hash', val);
        if (this._onRemoteHashCb) {
          this._onRemoteHashCb(val.tick, val.hash);
        }
      });
      this._listeners.push({ unsub: hashUnsub });

      const snapRef = ref(rtdb, `matches/${this._matchId}/snapshot/${oppUid}`);
      const snapUnsub = onValue(snapRef, (snap) => {
        const val = snap.val();
        if (!val || typeof val.tick !== 'number') return;
        this._trackInbound('snapshot', val);
        if (this._onRemoteSnapshotCb) {
          this._onRemoteSnapshotCb(val);
        }
      });
      this._listeners.push({ unsub: snapUnsub });
    }
  }

  disconnect(): void {
    for (const entry of this._listeners) {
      entry.unsub();
    }
    this._listeners = [];
  }

  sendInputs(packet: InputFrame[]): void {
    this._trackOutbound('inputs', packet);
    set(ref(rtdb, `matches/${this._matchId}/inputs/${this._myUid}`), packet).catch((err) => net.warn('[transport] sendInputs failed:', err));
  }

  sendHash(tick: number, hash: number): void {
    const payload = { tick, hash };
    this._trackOutbound('hash', payload);
    set(ref(rtdb, `matches/${this._matchId}/hashes/${this._myUid}`), payload).catch((err) => net.warn('[transport] sendHash failed:', err));
  }

  sendSnapshot(data: unknown): void {
    this._trackOutbound('snapshot', data);
    set(ref(rtdb, `matches/${this._matchId}/snapshot/${this._myUid}`), data).catch((err) => net.warn('[transport] sendSnapshot failed:', err));
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
    return 0;
  }

  get transportTelemetry(): TransportTelemetry {
    const messageTypes: Record<string, MessageTypeStats> = {};
    for (const [k, v] of Object.entries(this._msgTypeStats)) {
      messageTypes[k] = { ...v };
    }
    return {
      bytesSent: this._bytesSent,
      bytesReceived: this._bytesReceived,
      messagesSent: this._messagesSent,
      messagesReceived: this._messagesReceived,
      jitterMs: 0,
      avgMessageSizeOut: this._messagesSent > 0 ? Math.round(this._bytesSent / this._messagesSent) : 0,
      peakMessageSizeOut: this._peakOutSize,
      avgMessageSizeIn: this._messagesReceived > 0 ? Math.round(this._bytesReceived / this._messagesReceived) : 0,
      peakMessageSizeIn: this._peakInSize,
      reconnectAttempts: 0,
      connectLatencyMs: this._connectLatencyMs,
      state: this._listeners.length > 0 ? 'connected' : 'disconnected',
      messageTypes,
      sendRateBps: 0,
      recvRateBps: 0,
      serializeCostAvgMs: 0,
      deserializeCostAvgMs: 0,
      bufferedBytes: 0,
      totalDowntimeMs: 0,
      reconnectAvgMs: 0,
      reconnectPeakMs: 0,
      backpressureTotalMs: 0,
      reconnectSuccessCount: 0,
      reconnectFailCount: 0,
    };
  }

  // ── Telemetry helpers ─────────────────────────────────

  private _trackOutbound(kind: string, payload: unknown): void {
    const bytes = JSON.stringify(payload).length;
    this._bytesSent += bytes;
    this._messagesSent++;
    if (bytes > this._peakOutSize) this._peakOutSize = bytes;
    const entry = this._msgTypeStats[kind] ??= { bytesSent: 0, bytesReceived: 0, count: 0 };
    entry.bytesSent += bytes;
    entry.count++;
  }

  private _trackInbound(kind: string, payload: unknown): void {
    const bytes = JSON.stringify(payload).length;
    this._bytesReceived += bytes;
    this._messagesReceived++;
    if (bytes > this._peakInSize) this._peakInSize = bytes;
    const entry = this._msgTypeStats[kind] ??= { bytesSent: 0, bytesReceived: 0, count: 0 };
    entry.bytesReceived += bytes;
    // Track time to first data as connect latency
    if (!this._firstDataReceived && this._connectStartMs > 0) {
      this._connectLatencyMs = Math.round(performance.now() - this._connectStartMs);
      this._firstDataReceived = true;
    }
  }
}
