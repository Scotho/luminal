// ── Netcode Session ──────────────────────────────────────
// Handles real-time input/state sync between players via Firebase RTDB.
//
// Six sync mechanisms, grouped by activation mode:
//
// ALWAYS ACTIVE:
//   5. Heartbeat        — 3s interval, disconnect detection
//   6. Event stream     — death reports + round-end confirmations
//
// STATE-STREAMING MODE (!useLockstep):
//   1. sendState / getRemoteState — 20Hz position/velocity broadcast + interpolation
//
// LOCKSTEP MODE (useLockstep):
//   2. sendInputs       — input packets every 3 ticks (~20Hz), 6-frame redundancy
//   3. sendHash          — state hash every 60 ticks (~1Hz) for desync detection
//   4. sendSnapshot      — full state recovery on demand after 3+ desyncs in 10s
//
// Most per-snapshot logic lives in src/net/netcodeSession.ts to keep this
// class file under the 400-line hygiene budget. This file owns the class
// shell, public API, listener lifecycle, and round reset bookkeeping.
import { rtdb } from './firebase';
import { ref, set, push, onValue, onDisconnect, off } from 'firebase/database';
import type {
  RemoteState,
  NetcodeDeathEvent,
  NetcodeRoundEndEvent,
} from './types/index';
import type { DatabaseReference, Unsubscribe as FirebaseUnsubscribe } from 'firebase/database';
import type { InputFrame } from './core/simulation';
import type { MatchTransport } from './net/matchTransport';
import { type PacketTelemetry } from './net/packetTelemetry';
export type { PacketTelemetry } from './net/packetTelemetry';
import { RingBuffer } from './telemetry';
import { net } from './netLog';
import { LockstepInputSync, type SyncContext } from './net/lockstepInputSync';
import { LockstepHashSync } from './net/lockstepHashSync';
import { LockstepRecoverySync } from './net/lockstepRecoverySync';
import { NetcodeBarriers, type BarrierContext } from './net/netcodeBarriers';
import {
  buildSessionTelemetry,
  computeInputAckStats,
  interpolateRemoteState,
  measureRttViaServer,
  publishLocalState,
  resetSessionForNewRound,
  resolveInputAcks,
  startEventsListener,
  startHeartbeatListeners,
  startHeartbeatSender,
  startStateListeners,
  trackInputAcksForPacket,
  wireTransportCallbacks,
} from './net/netcodeSession';

interface ListenerEntry {
  ref: DatabaseReference;
  cb: FirebaseUnsubscribe;
}

export class NetcodeSession {
  matchId: string;
  myUid: string;
  allPlayerUids: string[];
  opponentUids: string[];

  _sendTimer: number;
  _seqNum: number;
  _listeners: ListenerEntry[];
  _processedEventKeys: Set<string>;
  currentRound: number;

  // Per-opponent remote state tracking
  _remoteStatesMap: Map<string, RingBuffer<RemoteState>>;
  _remoteDeadSet: Set<string>;
  _lastRemoteSeqMap: Map<string, number>;

  // Callbacks
  _onDeathCb: ((ev: NetcodeDeathEvent) => void) | null;
  _onRoundEndCb: ((ev: NetcodeRoundEndEvent) => void) | null;
  _onDisconnectCb: (() => void) | null;
  _onRemoteDeadCb: ((uid: string) => void) | null;

  // Heartbeat
  _heartbeatInterval: ReturnType<typeof setInterval> | null;
  _lastHeartbeats: Map<string, number>;

  // RTT estimation from state update inter-arrival times
  _lastStateArrival: number;
  _rttEstimateMs: number;

  // Packet loss + jitter telemetry (per-opponent aggregated)
  _packetLossCount: number;      // total detected seq gaps
  _packetReorderCount: number;   // out-of-order arrivals (seq <= lastSeq)
  _packetsReceived: number;      // total state updates received
  _jitterSamples = new RingBuffer<number>(30);
  _jitterMs: number;             // current jitter estimate (ms)
  // RTT sample history for percentile computation
  _rttSamples = new RingBuffer<number>(30);

  // Per-input ack tracking: sent tick → sendTimestamp
  _inputAckPending: Map<number, number> = new Map();
  _inputAckLatencies = new RingBuffer<number>(60);
  _inputAckCount = 0;                    // total acked inputs
  _inputAckMissCount = 0;                // inputs that were never acked (timed out)

  // Heartbeat miss tracking: count heartbeats that arrive >6s late (2x expected 3s interval)
  _heartbeatMissCount = 0;
  _heartbeatLateMs = new RingBuffer<number>(20);

  // Packet loss burst tracking: consecutive loss events (seq gaps)
  _packetLossStreak = 0;
  _packetLossBurstCount = 0;   // completed bursts (3+ consecutive losses)
  _packetLossPeakBurst = 0;    // longest burst streak

  // (per-round barrier listener refs are managed by NetcodeBarriers)

  // Server clock offset (ms): serverTime ≈ Date.now() + offset
  _serverTimeOffset: number;
  _lastLoggedRtt = 0;
  private _offsetUnsub: (() => void) | null;

  /** Optional live-packet transport. When set, inputs/hashes/snapshots use this instead of RTDB. */
  private _transport: MatchTransport | null = null;

  // Extracted lockstep sync modules
  private _inputSync = new LockstepInputSync();
  private _hashSync = new LockstepHashSync();
  private _recoverySync = new LockstepRecoverySync();
  private _barriers = new NetcodeBarriers();

  /** Build a SyncContext snapshot for delegating to sync modules. */
  private _syncCtx(): SyncContext {
    return {
      matchId: this.matchId,
      myUid: this.myUid,
      opponentUids: this.opponentUids,
      transport: this._transport,
      addListener: (entry) => { this._listeners.push(entry); },
      removeListener: (r) => { this._listeners = this._listeners.filter(l => l.ref !== r); },
    };
  }

  /** Build a BarrierContext for delegating to barrier module. */
  private _barrierCtx(): BarrierContext {
    return {
      matchId: this.matchId,
      myUid: this.myUid,
      allPlayerUids: this.allPlayerUids,
      serverTimeOffset: this._serverTimeOffset,
      addListener: (entry) => { this._listeners.push(entry); },
      removeListener: (r) => { this._listeners = this._listeners.filter(l => l.ref !== r); },
    };
  }

  constructor(matchId: string, myUid: string, allPlayerUids: string[]) {
    this.matchId = matchId;
    this.myUid = myUid;
    this.allPlayerUids = allPlayerUids;
    this.opponentUids = allPlayerUids.filter(uid => uid !== myUid);

    this._sendTimer = 0;
    this._seqNum = 0;
    this._listeners = [];
    this._processedEventKeys = new Set(); // track processed event keys to avoid replays
    this.currentRound = 1;

    // Per-opponent remote state tracking
    this._remoteStatesMap = new Map();
    this._remoteDeadSet = new Set();
    this._lastRemoteSeqMap = new Map();
    for (const uid of this.opponentUids) {
      this._remoteStatesMap.set(uid, new RingBuffer<RemoteState>(10));
      this._lastRemoteSeqMap.set(uid, -1);
    }

    // Callbacks
    this._onDeathCb = null;
    this._onRoundEndCb = null;
    this._onDisconnectCb = null;
    this._onRemoteDeadCb = null; // fired when remote state sync shows alive:false

    // Heartbeat
    this._heartbeatInterval = null;
    this._lastHeartbeats = new Map();
    for (const uid of this.opponentUids) {
      this._lastHeartbeats.set(uid, Date.now());
    }

    // RTT estimation
    this._lastStateArrival = 0;
    this._rttEstimateMs = 100; // conservative default

    // Packet loss + jitter + reorder telemetry
    this._packetLossCount = 0;
    this._packetReorderCount = 0;
    this._packetsReceived = 0;
    this._jitterSamples.clear();
    this._jitterMs = 0;

    // Server clock offset — keep live subscription so the estimate stays fresh.
    // A stale/zero offset causes sync barriers to compute wrong delays, desyncing
    // the countdown start by up to several seconds between clients.
    this._serverTimeOffset = 0;
    const offsetRef = ref(rtdb, '.info/serverTimeOffset');
    this._offsetUnsub = onValue(offsetRef, (snap) => {
      this._serverTimeOffset = snap.val() || 0;
    });
  }

  /**
   * Attach a MatchTransport for live lockstep packets.
   * When attached, sendInputs/sendHash/sendSnapshot delegate to the transport.
   * The transport also replaces startInputSync/startHashSync/startSnapshotSync listeners.
   * RTDB barriers, events, and heartbeat remain on NetcodeSession.
   */
  attachTransport(transport: MatchTransport): void {
    if (this._transport) {
      this._transport.disconnect();
      net.info('[transport] replacing previous transport');
    }
    this._transport = transport;
    net.info('[transport] attached', transport.constructor.name);

    // Wire transport callbacks to existing NetcodeSession callbacks.
    wireTransportCallbacks(
      transport,
      () => this._onRemoteInputsCb,
      () => this._onRemoteHashCb,
      () => this._onRemoteSnapshotCb,
    );
  }

  start(): void {
    net.info('[transport] session-start matchId=' + this.matchId + ' opponents=' + this.opponentUids.length);
    const base = `matches/${this.matchId}`;

    startStateListeners(this, base);
    startEventsListener(this, base);
    startHeartbeatListeners(this, base);
    startHeartbeatSender(this, base);

    // Set up onDisconnect for our state
    const myStateRef = ref(rtdb, `${base}/state/${this.myUid}`);
    onDisconnect(myStateRef).update({ alive: false });
  }

  stop(): void {
    net.info('[transport] session-stop');
    if (this._transport) {
      this._transport.disconnect();
      this._transport = null;
    }
    for (const { ref: r } of this._listeners) {
      off(r);
    }
    this._listeners = [];
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
    if (this._offsetUnsub) {
      this._offsetUnsub();
      this._offsetUnsub = null;
    }
    // Clear callbacks to release closures from match context
    this._onDeathCb = null;
    this._onRoundEndCb = null;
    this._onDisconnectCb = null;
    this._onRemoteDeadCb = null;
    this._onRemoteInputsCb = null;
    this._onRemoteHashCb = null;
    this._onRemoteSnapshotCb = null;
  }

  // Called every frame — throttles to 20Hz
  sendState(dt: number, x: number, z: number, angle: number, speed: number, meter: number, alive: boolean, boosting: boolean, dashing: boolean): void {
    publishLocalState(this, dt, x, z, angle, speed, meter, alive, boosting, dashing);
  }

  // Get interpolated remote player state for a specific opponent
  getRemoteState(uid: string, _dt: number): RemoteState | null {
    return interpolateRemoteState(this, uid);
  }

  // Report a death event
  async reportDeath(diedUid: string, roundTime: number): Promise<void> {
    net.info('[death] report uid=' + diedUid + ' round=' + this.currentRound);
    await push(ref(rtdb, `matches/${this.matchId}/events`), {
      type: 'death',
      uid: diedUid,
      reportedBy: this.myUid,
      round: this.currentRound,
      roundTime,
      ts: Date.now(),
    });
  }

  // Report round end — all clients write this for sync
  async writeRoundEnd(round: number, winner: string, stateDigest?: number): Promise<void> {
    const payload: Record<string, unknown> = { round, winner: winner || 'draw', ts: Date.now() };
    if (stateDigest !== undefined) payload.stateDigest = stateDigest;
    await set(ref(rtdb, `matches/${this.matchId}/roundEnd/${this.myUid}`), payload);
  }

  // ── Barriers (delegated to NetcodeBarriers) ─────────────

  onAllRoundEnd(callback: (val: Record<string, { round?: number; winner?: string; ts?: number }>) => void): void {
    this._barriers.onAllRoundEnd(this._barrierCtx(), callback);
  }

  async writeAccept(vehicleType: string = 'bike', protocolVersion: number = 1, transport?: { websocket: boolean; wsProtocol: number }): Promise<void> {
    await this._barriers.writeAccept(this._barrierCtx(), vehicleType, protocolVersion, transport);
  }

  onAllAccepted(callback: () => void): void {
    this._barriers.onAllAccepted(this._barrierCtx(), callback);
  }

  async writeNextRound(): Promise<void> {
    await this._barriers.writeNextRound(this._barrierCtx(), this.currentRound);
  }

  onAllNextRound(callback: (delayMs: number) => void): void {
    this._barriers.onAllNextRound(this._barrierCtx(), this.currentRound, callback);
  }

  async writeLoaded(): Promise<void> {
    await this._barriers.writeLoaded(this._barrierCtx(), this.currentRound);
  }

  onAllLoaded(callback: (delayMs: number) => void): void {
    this._barriers.onAllLoaded(this._barrierCtx(), this.currentRound, callback);
  }

  async writeRematch(): Promise<void> {
    await this._barriers.writeRematch(this._barrierCtx());
  }

  onAllRematch(callback: () => void): void {
    this._barriers.onAllRematch(this._barrierCtx(), callback);
  }

  async updateMeta(updates: Record<string, unknown>): Promise<void> {
    await this._barriers.updateMeta(this._barrierCtx(), updates);
  }

  // Per-player disconnect detection
  isPlayerConnected(uid: string): boolean {
    return Date.now() - (this._lastHeartbeats.get(uid) ?? 0) < 10000;
  }

  isAnyOpponentConnected(): boolean {
    return this.opponentUids.some(uid => this.isPlayerConnected(uid));
  }

  /** Backward-compat: returns true if any opponent is connected. */
  isOpponentConnected(): boolean {
    return this.isAnyOpponentConnected();
  }

  /** Estimated RTT in ms (derived from state update inter-arrival jitter). */
  get estimatedRttMs(): number { return Math.round(this._rttEstimateMs); }

  /** Estimated jitter in ms (inter-arrival variance, RFC 3550 style EMA). */
  get jitterMs(): number { return Math.round(this._jitterMs * 10) / 10; }

  /** Packet loss rate (0–1) based on detected seq number gaps. */
  get packetLossRate(): number {
    const total = this._packetsReceived + this._packetLossCount;
    return total > 0 ? this._packetLossCount / total : 0;
  }

  /** Raw packet loss count (seq gaps detected). */
  get packetLossCount(): number { return this._packetLossCount; }

  /** Total state update packets received. */
  get packetsReceived(): number { return this._packetsReceived; }

  /** Per-input ack stats: confirmation latencies and miss rate. */
  get inputAckStats(): { avgLatencyMs: number; missCount: number; ackCount: number; pendingCount: number } {
    return computeInputAckStats(this);
  }

  /** Combined packet-level telemetry snapshot. */
  getPacketTelemetry(): PacketTelemetry {
    return buildSessionTelemetry(this, this._transport);
  }

  /** Measure true RTT via Firebase server-time round-trip. Takes 3 samples, uses median. */
  async measureRtt(): Promise<number> {
    return measureRttViaServer(this);
  }

  /** Resolve pending input acks — called when opponent state update arrives. */
  private _resolveInputAcks(nowMs: number): void {
    resolveInputAcks(this, nowMs);
  }

  // Called between rounds to reset state
  resetForNewRound(round: number): void {
    resetSessionForNewRound(this, round);
  }

  // Callbacks
  onDeath(cb: (ev: NetcodeDeathEvent) => void): void { this._onDeathCb = cb; }
  onRoundEnd(cb: (ev: NetcodeRoundEndEvent) => void): void { this._onRoundEndCb = cb; }
  onDisconnect(cb: () => void): void { this._onDisconnectCb = cb; }
  onRemoteDead(cb: (uid: string) => void): void { this._onRemoteDeadCb = cb; }

  // ── Lockstep sync (delegated to extracted modules) ──────

  private _onRemoteInputsCb: ((playerIndex: number, frames: InputFrame[]) => void) | null = null;
  private _onRemoteHashCb: ((tick: number, hash: number) => void) | null = null;
  private _onRemoteSnapshotCb: ((data: unknown) => void) | null = null;

  onRemoteInputs(cb: (playerIndex: number, frames: InputFrame[]) => void): void { this._onRemoteInputsCb = cb; }
  onRemoteHash(cb: (tick: number, hash: number) => void): void { this._onRemoteHashCb = cb; }
  onRemoteSnapshot(cb: (data: unknown) => void): void { this._onRemoteSnapshotCb = cb; }

  startInputSync(uidToIndex: Map<string, number>): void {
    this._inputSync.startSync(this._syncCtx(), uidToIndex, (idx, frames) => {
      if (this._onRemoteInputsCb) this._onRemoteInputsCb(idx, frames);
    });
  }

  startHashSync(): void {
    this._hashSync.startSync(this._syncCtx(), (tick, hash) => {
      if (this._onRemoteHashCb) this._onRemoteHashCb(tick, hash);
    });
  }

  startSnapshotSync(): void {
    this._recoverySync.startSync(this._syncCtx(), (data) => {
      if (this._onRemoteSnapshotCb) this._onRemoteSnapshotCb(data);
    });
  }

  sendInputs(packet: InputFrame[]): void {
    // Track pending acks for per-input latency measurement
    trackInputAcksForPacket(this, packet.map(f => f.tick));
    this._inputSync.sendInputs(this._syncCtx(), packet);
  }

  sendHash(tick: number, hash: number): void {
    this._hashSync.sendHash(this._syncCtx(), tick, hash);
  }

  sendSnapshot(data: unknown): void {
    this._recoverySync.sendSnapshot(this._syncCtx(), data);
  }
}
