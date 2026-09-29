// ── Netcode Session helpers ──────────────────────────────
// Module-level helpers split out of src/netcode.ts to keep the class file
// under 500 LOC. These functions operate on a `NetcodeSessionInternals`
// shape — a structural alias for the private/public fields of the
// NetcodeSession class. Consumers must preserve these field names for
// the helpers to work (the test suite also inspects several of them
// via the same structural pattern).
//
// No behavioral changes — this is pure extraction.

import { rtdb } from '../firebase';
import {
  ref,
  set,
  get,
  onValue,
  onDisconnect,
  serverTimestamp,
} from 'firebase/database';
import { lerpAngle } from '../utils';
import type {
  DatabaseReference,
  Unsubscribe as FirebaseUnsubscribe,
} from 'firebase/database';
import type {
  RemoteState,
  NetcodeEvent,
  NetcodeDeathEvent,
  NetcodeRoundEndEvent,
} from '../types/index';
import type { MatchTransport } from './matchTransport';
import { RingBuffer } from '../telemetry';
import { net } from '../netLog';
import { buildPacketTelemetry, type PacketTelemetry } from './packetTelemetry';

const SEND_RATE: number = 1 / 20; // 20Hz — tighter updates for fast-paced gameplay

// ── Constants (mirrored from netcode.ts) ─────────────────
const MIN_INTERPOLATION_DELAY = 30;
const MAX_INTERPOLATION_DELAY = 150;

// Client-side validation bounds
const ARENA_LIMIT = 197;
const MAX_SPEED = 115;
const MAX_METER = 100;

// ── Listener type (mirrored from netcode.ts) ─────────────
export interface ListenerEntry {
  ref: DatabaseReference;
  cb: FirebaseUnsubscribe;
}

// ── Structural shape of a NetcodeSession used by the helpers ─
// Intentionally loose — we access only the fields the helpers need.
// Keeping this typed (no `any`) preserves strict mode compliance.
export interface NetcodeSessionInternals {
  matchId: string;
  myUid: string;
  allPlayerUids: string[];
  opponentUids: string[];
  currentRound: number;

  _sendTimer: number;
  _seqNum: number;
  _listeners: ListenerEntry[];
  _processedEventKeys: Set<string>;

  _remoteStatesMap: Map<string, RingBuffer<RemoteState>>;
  _remoteDeadSet: Set<string>;
  _lastRemoteSeqMap: Map<string, number>;

  _onDeathCb: ((ev: NetcodeDeathEvent) => void) | null;
  _onRoundEndCb: ((ev: NetcodeRoundEndEvent) => void) | null;
  _onRemoteDeadCb: ((uid: string) => void) | null;

  _heartbeatInterval: ReturnType<typeof setInterval> | null;
  _lastHeartbeats: Map<string, number>;
  _heartbeatMissCount: number;
  _heartbeatLateMs: RingBuffer<number>;

  _lastStateArrival: number;
  _rttEstimateMs: number;
  _lastLoggedRtt: number;

  _packetLossCount: number;
  _packetReorderCount: number;
  _packetsReceived: number;
  _jitterSamples: RingBuffer<number>;
  _jitterMs: number;
  _rttSamples: RingBuffer<number>;
  _packetLossStreak: number;
  _packetLossBurstCount: number;
  _packetLossPeakBurst: number;

  _inputAckPending: Map<number, number>;
  _inputAckLatencies: RingBuffer<number>;
  _inputAckCount: number;
  _inputAckMissCount: number;

  _serverTimeOffset: number;
}

// ── Validators ────────────────────────────────────────────
export function isValidRemoteState(val: unknown): val is RemoteState {
  if (!val || typeof val !== 'object') return false;
  const v = val as Record<string, unknown>;
  return (
    typeof v.x === 'number' && Math.abs(v.x as number) <= ARENA_LIMIT &&
    typeof v.z === 'number' && Math.abs(v.z as number) <= ARENA_LIMIT &&
    typeof v.angle === 'number' && isFinite(v.angle as number) &&
    typeof v.speed === 'number' && (v.speed as number) >= 0 && (v.speed as number) <= MAX_SPEED &&
    typeof v.meter === 'number' && (v.meter as number) >= 0 && (v.meter as number) <= MAX_METER &&
    typeof v.alive === 'boolean' &&
    typeof v.boosting === 'boolean' &&
    typeof v.dashing === 'boolean'
  );
}

export function isValidDeathEvent(
  ev: Record<string, unknown>,
  opponentUids: string[],
  allPlayerUids: string[],
): boolean {
  return (
    ev.type === 'death' &&
    typeof ev.uid === 'string' &&
    typeof ev.reportedBy === 'string' &&
    typeof ev.round === 'number' &&
    // Only accept death reports from opponents
    opponentUids.includes(ev.reportedBy as string) &&
    // Anticheat: reporter must be reporting their own death
    ev.uid === ev.reportedBy &&
    // Reported uid must be a valid match participant
    allPlayerUids.includes(ev.uid as string)
  );
}

export function isValidRoundEndEvent(ev: Record<string, unknown>): boolean {
  return ev.type === 'roundEnd';
}

// ── start() phase helpers ────────────────────────────────
/** Phase 1: subscribe to each opponent's state node. */
export function startStateListeners(s: NetcodeSessionInternals, base: string): void {
  for (const oppUid of s.opponentUids) {
    const stateRef = ref(rtdb, `${base}/state/${oppUid}`);
    const stateCb = onValue(stateRef, (snap) => {
      handleRemoteStateSnapshot(s, oppUid, snap.val());
    });
    s._listeners.push({ ref: stateRef, cb: stateCb });
  }
}

/** Phase 2: subscribe to the shared events node (deaths, round ends). */
export function startEventsListener(s: NetcodeSessionInternals, base: string): void {
  const eventsRef = ref(rtdb, `${base}/events`);
  const eventsCb = onValue(eventsRef, (snap) => {
    const val = snap.val() as Record<string, NetcodeEvent & { ts?: number }> | null;
    if (!val) return;
    const entries = Object.entries(val).sort((a, b) => ((a[1].ts || 0) - (b[1].ts || 0)));
    for (const [key, ev] of entries) {
      if (s._processedEventKeys.has(key)) continue;
      s._processedEventKeys.add(key);
      if (ev.type === 'death' && s._onDeathCb && isValidDeathEvent(ev as unknown as Record<string, unknown>, s.opponentUids, s.allPlayerUids)) {
        s._onDeathCb(ev);
        net.info('[death] event uid=' + (ev as NetcodeDeathEvent).uid + ' round=' + (ev as NetcodeDeathEvent).round);
      } else if (ev.type === 'death') {
        net.warn('[death] invalid-event rejected key=' + key);
      }
      if (ev.type === 'roundEnd' && s._onRoundEndCb && isValidRoundEndEvent(ev as unknown as Record<string, unknown>)) {
        s._onRoundEndCb(ev);
        net.info('[barrier] roundEnd-event received');
      }
    }
  });
  s._listeners.push({ ref: eventsRef, cb: eventsCb });
}

/** Phase 3: subscribe to each opponent's heartbeat node for disconnect detection. */
export function startHeartbeatListeners(s: NetcodeSessionInternals, base: string): void {
  for (const oppUid of s.opponentUids) {
    const hbRef = ref(rtdb, `${base}/heartbeat/${oppUid}`);
    const hbCb = onValue(hbRef, (snap) => {
      if (snap.val()) {
        const now = Date.now();
        const prev = s._lastHeartbeats.get(oppUid) ?? now;
        const age = now - prev;
        s._lastHeartbeats.set(oppUid, now);
        // Track heartbeat arrival timing (skip first sample)
        if (prev !== now) {
          s._heartbeatLateMs.push(age);
          // >6s gap = missed heartbeat (2x the 3s expected interval)
          if (age > 6000) s._heartbeatMissCount++;
        }
      }
    });
    s._listeners.push({ ref: hbRef, cb: hbCb });
  }
}

/** Phase 4: start our own heartbeat writer with onDisconnect cleanup. */
export function startHeartbeatSender(s: NetcodeSessionInternals, base: string): void {
  const myHbRef = ref(rtdb, `${base}/heartbeat/${s.myUid}`);
  s._heartbeatInterval = setInterval(() => {
    set(myHbRef, serverTimestamp());
  }, 3000);
  set(myHbRef, serverTimestamp());
  onDisconnect(myHbRef).remove();
}

// ── Remote state snapshot processing ─────────────────────
/** Process a single remote-state snapshot: validation, seq gating, telemetry, death detection. */
export function handleRemoteStateSnapshot(
  s: NetcodeSessionInternals,
  oppUid: string,
  val: unknown,
): void {
  // Handle partial disconnect payload ({ alive: false }) before full validation.
  // onDisconnect writes only { alive: false } which fails isValidRemoteState,
  // but we still need to detect it as a remote death.
  if (val && typeof val === 'object' && (val as { alive?: unknown }).alive === false && !isValidRemoteState(val)) {
    if (!s._remoteDeadSet.has(oppUid) && s._onRemoteDeadCb) {
      s._remoteDeadSet.add(oppUid);
      s._onRemoteDeadCb(oppUid);
      net.warn('[death] remote partial-disconnect uid=' + oppUid);
    }
    return;
  }
  if (!val || !isValidRemoteState(val)) return;

  // Reject out-of-order state updates using seq number
  const seq = typeof val.seq === 'number' ? val.seq : -1;
  const lastSeq = s._lastRemoteSeqMap.get(oppUid) ?? -1;
  if (seq >= 0 && seq <= lastSeq) {
    s._packetReorderCount++;
    net.log('[reorder] uid=' + oppUid + ' seq=' + seq + ' lastSeq=' + lastSeq);
    return;
  }
  // Detect packet loss: seq gap > 1 means intermediate packets were lost
  if (seq >= 0 && lastSeq >= 0 && seq > lastSeq + 1) {
    const lost = seq - lastSeq - 1;
    s._packetLossCount += lost;
    s._packetLossStreak++;
    if (s._packetLossStreak > s._packetLossPeakBurst) s._packetLossPeakBurst = s._packetLossStreak;
    net.warn('[packet-loss] uid=' + oppUid + ' gap=' + lost + ' seq=' + seq + ' lastSeq=' + lastSeq);
  } else {
    // Consecutive delivery — close any active loss burst
    if (s._packetLossStreak >= 3) s._packetLossBurstCount++;
    s._packetLossStreak = 0;
  }
  s._lastRemoteSeqMap.set(oppUid, seq);
  s._packetsReceived++;

  const now = Date.now();
  val._receivedAt = now;

  // Resolve per-input acks: opponent state update implies they processed our inputs
  resolveInputAcks(s, now);

  updateRttAndJitter(s, now);

  s._remoteStatesMap.get(oppUid)!.push(val);

  // Detect opponent death from state sync as a backup signal
  if (val.alive === false && !s._remoteDeadSet.has(oppUid) && s._onRemoteDeadCb) {
    s._remoteDeadSet.add(oppUid);
    s._onRemoteDeadCb(oppUid);
    net.warn('[death] remote-dead-state uid=' + oppUid);
  }
}

/** Update RTT estimate and jitter EMA from state update inter-arrival timing. */
export function updateRttAndJitter(s: NetcodeSessionInternals, now: number): void {
  // Estimate RTT from state update inter-arrival times.
  // Send rate is 50ms (20Hz). Arrival gaps beyond that indicate network delay.
  // Use exponential moving average for stability.
  if (s._lastStateArrival > 0) {
    const gap = now - s._lastStateArrival;
    // Gap minus expected interval ≈ one-way jitter; double for RTT estimate
    const jitterMs = Math.max(0, gap - 50) * 2;
    const sample = 50 + jitterMs; // baseline 50ms + jitter-derived RTT
    s._rttEstimateMs = s._rttEstimateMs * 0.8 + sample * 0.2;
    s._rttSamples.push(sample);
    if (Math.abs(s._rttEstimateMs - s._lastLoggedRtt) > 5) {
      s._lastLoggedRtt = s._rttEstimateMs;
      net.log('[rtt] estimate=' + Math.round(s._rttEstimateMs) + 'ms sample=' + Math.round(sample) + 'ms');
    }

    // Track jitter variance (RFC 3550 style: running mean of |delta - mean_delta|)
    const delta = Math.abs(gap - 50); // deviation from expected 50ms interval
    s._jitterSamples.push(delta);
    const mean = s._jitterSamples.reduce((a: number, b: number) => a + b, 0) / s._jitterSamples.length;
    s._jitterMs = s._jitterMs * 0.9375 + Math.abs(delta - mean) * 0.0625; // 1/16 EMA
  }
  s._lastStateArrival = now;
}

/** Resolve pending input acks — called when opponent state update arrives. */
export function resolveInputAcks(s: NetcodeSessionInternals, nowMs: number): void {
  // Each state update confirms bidirectional connectivity.
  // Resolve the oldest pending ack and record the latency.
  const oldest = s._inputAckPending.keys().next().value;
  if (oldest !== undefined) {
    const sentAt = s._inputAckPending.get(oldest);
    if (sentAt !== undefined) {
      const latency = nowMs - sentAt;
      s._inputAckLatencies.push(latency);
      s._inputAckCount++;
    }
    s._inputAckPending.delete(oldest);
  }
}

/** Track outgoing input packet acks and expire any stale pending entries. */
export function trackInputAcksForPacket(
  s: NetcodeSessionInternals,
  ticks: Iterable<number>,
): void {
  const now = Date.now();
  for (const tick of ticks) {
    if (!s._inputAckPending.has(tick)) {
      s._inputAckPending.set(tick, now);
    }
  }
  // Expire old pending acks (> 5s = lost)
  const expiry = now - 5000;
  for (const [tick, ts] of s._inputAckPending) {
    if (ts < expiry) {
      s._inputAckPending.delete(tick);
      s._inputAckMissCount++;
    }
  }
}

// ── Remote state interpolation ───────────────────────────
/** Interpolated render state for a remote player, with dead-reckoning fallback. */
export function interpolateRemoteState(
  s: NetcodeSessionInternals,
  uid: string,
): RemoteState | null {
  const remoteStates = s._remoteStatesMap.get(uid);
  if (!remoteStates || remoteStates.length === 0) return null;

  const now = Date.now();
  // Adaptive delay: scale with RTT estimate to absorb network jitter
  const adaptiveDelay = Math.max(MIN_INTERPOLATION_DELAY,
    Math.min(MAX_INTERPOLATION_DELAY, s._rttEstimateMs * 0.5));
  const renderTime = now - adaptiveDelay;

  // Find two states to interpolate between
  let s0: RemoteState | null = null, s1: RemoteState | null = null;
  for (let i = 0; i < remoteStates.length - 1; i++) {
    const cur = remoteStates.get(i);
    const nxt = remoteStates.get(i + 1);
    if (cur._receivedAt! <= renderTime && nxt._receivedAt! >= renderTime) {
      s0 = cur;
      s1 = nxt;
      break;
    }
  }

  if (s0 && s1) {
    // Interpolate between the two states
    const range = s1._receivedAt! - s0._receivedAt!;
    const t = range > 0 ? (renderTime - s0._receivedAt!) / range : 0;
    return {
      x: s0.x + (s1.x - s0.x) * t,
      z: s0.z + (s1.z - s0.z) * t,
      angle: lerpAngle(s0.angle, s1.angle, t),
      speed: s0.speed + (s1.speed - s0.speed) * t,
      meter: s1.meter,
      alive: s1.alive,
      boosting: t < 0.5 ? s0.boosting : s1.boosting,
      dashing: t < 0.5 ? s0.dashing : s1.dashing,
    };
  }

  // Fallback: dead reckoning from last known state
  const last = remoteStates.length > 0 ? remoteStates.get(remoteStates.length - 1) : null;
  if (last && last.alive) {
    const elapsed = (now - last._receivedAt!) / 1000;
    // Cap dead reckoning to 300ms
    const drTime = Math.min(elapsed, 0.3);
    return {
      x: last.x + (-Math.sin(last.angle) * last.speed * drTime),
      z: last.z + (-Math.cos(last.angle) * last.speed * drTime),
      angle: last.angle,
      speed: last.speed,
      meter: last.meter,
      alive: last.alive,
      boosting: last.boosting,
      dashing: last.dashing,
    };
  }

  return last || null;
}

// ── RTT measurement ──────────────────────────────────────
/** Measure true RTT via Firebase server-time round-trip. Takes 3 samples, uses median. */
export async function measureRttViaServer(
  s: NetcodeSessionInternals,
): Promise<number> {
  const rttRef = ref(rtdb, `matches/${s.matchId}/rtt/${s.myUid}`);
  const samples: number[] = [];

  for (let i = 0; i < 3; i++) {
    const before = Date.now();
    await set(rttRef, serverTimestamp());
    const snap = await get(rttRef);
    const serverTs = snap.val();
    const after = Date.now();

    if (typeof serverTs === 'number') {
      samples.push(after - before);
    }
  }

  // Clean up the measurement node
  set(rttRef, null).catch(() => {});

  if (samples.length > 0) {
    // Use median to reject outliers (e.g., GC pause during one sample)
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    s._rttEstimateMs = median;
    net.info('[rtt] measured samples=[' + samples.join(',') + '] median=' + median + 'ms');
    return Math.round(s._rttEstimateMs);
  }
  return Math.round(s._rttEstimateMs); // fallback to current estimate
}

// ── 20Hz state publisher ─────────────────────────────────
/** Throttled state publisher. Returns true if a packet was written. */
export function publishLocalState(
  s: NetcodeSessionInternals,
  dt: number,
  x: number,
  z: number,
  angle: number,
  speed: number,
  meter: number,
  alive: boolean,
  boosting: boolean,
  dashing: boolean,
): boolean {
  s._sendTimer += dt;
  if (s._sendTimer < SEND_RATE) return false;
  s._sendTimer -= SEND_RATE;

  s._seqNum++;
  set(ref(rtdb, `matches/${s.matchId}/state/${s.myUid}`), {
    x: Math.round(x * 10) / 10,
    z: Math.round(z * 10) / 10,
    angle: Math.round(angle * 1000) / 1000,
    speed: Math.round(speed),
    meter: Math.round(meter),
    alive,
    boosting,
    dashing,
    seq: s._seqNum,
    ts: Date.now(),
  });
  return true;
}

// ── Round reset ──────────────────────────────────────────
/** Called between rounds to reset per-round telemetry and tracking state. */
export function resetSessionForNewRound(s: NetcodeSessionInternals, round: number): void {
  net.info('[barrier] round-reset round=' + round);
  s.currentRound = round;
  s._sendTimer = 0;
  s._seqNum = 0;
  s._lastStateArrival = 0;
  // Reset per-opponent maps
  s._remoteDeadSet.clear();
  for (const uid of s.opponentUids) {
    s._remoteStatesMap.set(uid, new RingBuffer<RemoteState>(10));
    s._lastRemoteSeqMap.set(uid, -1);
  }
  // Reset packet telemetry
  s._packetLossCount = 0;
  s._packetReorderCount = 0;
  s._packetsReceived = 0;
  s._jitterSamples.clear();
  s._jitterMs = 0;
  // Flush in-flight burst before zeroing (defensive: prevents silent data loss
  // if reset ordering changes — matches flush-before-reset pattern in telemetry collector)
  if (s._packetLossStreak >= 3) s._packetLossBurstCount++;
  s._packetLossStreak = 0;
  s._packetLossBurstCount = 0;
  s._packetLossPeakBurst = 0;
  // Reset per-input ack tracking
  s._inputAckPending.clear();
  s._inputAckLatencies.clear();
  s._inputAckCount = 0;
  s._inputAckMissCount = 0;
  // Reset heartbeat tracking
  s._heartbeatMissCount = 0;
  s._heartbeatLateMs.clear();
}

// ── Telemetry snapshot ───────────────────────────────────
/** Per-input ack stats: confirmation latencies and miss rate. */
export function computeInputAckStats(s: NetcodeSessionInternals): {
  avgLatencyMs: number; missCount: number; ackCount: number; pendingCount: number;
} {
  const latencies = s._inputAckLatencies;
  const avg = latencies.length > 0
    ? Math.round(latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length)
    : 0;
  return {
    avgLatencyMs: avg,
    missCount: s._inputAckMissCount,
    ackCount: s._inputAckCount,
    pendingCount: s._inputAckPending.size,
  };
}

/** Combined packet-level telemetry snapshot. */
export function buildSessionTelemetry(
  s: NetcodeSessionInternals,
  transport: MatchTransport | null,
): PacketTelemetry {
  const packetLossRate = (() => {
    const total = s._packetsReceived + s._packetLossCount;
    return total > 0 ? s._packetLossCount / total : 0;
  })();
  const jitterMs = Math.round(s._jitterMs * 10) / 10;
  const ack = computeInputAckStats(s);
  return buildPacketTelemetry({
    packetLossRate,
    packetLossCount: s._packetLossCount,
    packetReorderCount: s._packetReorderCount,
    packetsReceived: s._packetsReceived,
    jitterMs,
    jitterSamples: s._jitterSamples,
    rttSamples: s._rttSamples,
    inputAckLatencies: s._inputAckLatencies,
    heartbeatLateMs: s._heartbeatLateMs,
    inputAckAvgMs: ack.avgLatencyMs,
    inputAckMissCount: s._inputAckMissCount,
    heartbeatMissCount: s._heartbeatMissCount,
    transportTelemetry: transport?.transportTelemetry,
    packetLossBurstCount: s._packetLossBurstCount + (s._packetLossStreak >= 3 ? 1 : 0),
    packetLossPeakBurst: s._packetLossPeakBurst,
    serverTimeOffsetMs: s._serverTimeOffset,
    stuckInputCount: 0,
  });
}

// ── Transport wiring ─────────────────────────────────────
/** Wire a MatchTransport's remote callbacks through to session callback props. */
export function wireTransportCallbacks(
  transport: MatchTransport,
  getOnRemoteInputs: () => ((playerIndex: number, frames: import('../core/simulation').InputFrame[]) => void) | null,
  getOnRemoteHash: () => ((tick: number, hash: number) => void) | null,
  getOnRemoteSnapshot: () => ((data: unknown) => void) | null,
): void {
  // These closures read the getters at call time, so callbacks registered
  // later by game.ts are picked up automatically.
  transport.onRemoteInputs((playerIndex, frames) => {
    const cb = getOnRemoteInputs();
    if (cb) cb(playerIndex, frames);
    else console.warn('[netcode] remote inputs arrived before callback registered');
  });
  transport.onRemoteHash((tick, hash) => {
    const cb = getOnRemoteHash();
    if (cb) cb(tick, hash);
  });
  transport.onRemoteSnapshot((data) => {
    const cb = getOnRemoteSnapshot();
    if (cb) cb(data);
  });
}
