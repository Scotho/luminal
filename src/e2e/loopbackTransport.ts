import type { MatchTransport } from '../net/matchTransport';
import type { InputFrame } from '../core/simulation';
import type { HubStats } from './perfTypes';

export interface LoopbackConfig {
  /** One-way latency in ms. 0 = synchronous delivery. */
  latencyMs: number;
  /** Packet loss rate 0-1. 0 = no loss, 1 = drop everything. */
  packetLossRate: number;
  /** Jitter range in ms. Actual latency = latencyMs +/- random(jitterMs). */
  jitterMs?: number;
}

export interface BurstLossState {
  /** Remaining packets to drop in the current burst. */
  remaining: number;
  /** Total burst size (reset value). */
  count: number;
  /** If set, auto-trigger burst every intervalMs. */
  intervalMs?: number;
  /** Timer handle for auto-trigger. */
  timer?: ReturnType<typeof setInterval>;
}

export interface AsymmetricLatency {
  /** Latency from the first-created transport to the second, in ms. */
  aToB_ms: number;
  /** Latency from the second-created transport to the first, in ms. */
  bToA_ms: number;
  /** UID of player A (first argument to setAsymmetricLatency or first created transport). */
  uidA: string;
}

export interface DegradeOverTimeState {
  startMs: number;
  endMs: number;
  durationTicks: number;
  currentTick: number;
}

/**
 * In-process message hub that connects N LoopbackTransports.
 * Each transport sends to all other transports in the hub.
 */
export class LoopbackHub {
  private _config: LoopbackConfig;
  private _transports = new Map<string, LoopbackTransportImpl>();
  private _timers: ReturnType<typeof setTimeout>[] = [];
  private _stats: HubStats = { messagesRelayed: 0, messagesDropped: 0, deliveryDelays: [] };

  private _burstLoss: BurstLossState | null = null;
  private _asymmetricLatency: AsymmetricLatency | null = null;
  private _jitterConfig: { baseMs: number; varianceMs: number } | null = null;
  private _degradeState: DegradeOverTimeState | null = null;

  constructor(config: LoopbackConfig) {
    this._config = config;
  }

  createTransport(
    playerIndex: number,
    uid: string,
    opponentUids: string[],
  ): MatchTransport {
    const transport = new LoopbackTransportImpl(uid, playerIndex, opponentUids, this);
    this._transports.set(uid, transport);
    return transport;
  }

  /** Returns a frozen snapshot of message relay/drop/delay counters. */
  getStats(): Readonly<HubStats> {
    return Object.freeze({
      messagesRelayed: this._stats.messagesRelayed,
      messagesDropped: this._stats.messagesDropped,
      deliveryDelays: [...this._stats.deliveryDelays],
    });
  }

  // ── Network degradation API ──────────────────────────────────────

  /**
   * Drop `count` consecutive packets in one burst.
   * If `intervalMs` is provided, bursts auto-trigger on that interval.
   * Otherwise call `triggerBurstLoss()` manually.
   */
  setBurstLoss(count: number, intervalMs?: number): void {
    this.clearBurstLoss();
    this._burstLoss = { remaining: 0, count, intervalMs };
    if (intervalMs !== undefined) {
      this._burstLoss.remaining = count;
      this._burstLoss.timer = setInterval(() => {
        if (this._burstLoss) this._burstLoss.remaining = this._burstLoss.count;
      }, intervalMs);
    }
  }

  /** Manually trigger a burst loss (only needed when no intervalMs). */
  triggerBurstLoss(): void {
    if (this._burstLoss) this._burstLoss.remaining = this._burstLoss.count;
  }

  clearBurstLoss(): void {
    if (this._burstLoss?.timer) clearInterval(this._burstLoss.timer);
    this._burstLoss = null;
  }

  /**
   * Set different latency per direction. `uidA` is resolved from the first
   * uid registered with the hub, or you can pass it explicitly.
   */
  setAsymmetricLatency(aToB_ms: number, bToA_ms: number, uidA?: string): void {
    const resolvedA = uidA ?? this._transports.keys().next().value;
    if (!resolvedA) throw new Error('setAsymmetricLatency: no transports registered yet');
    this._asymmetricLatency = { aToB_ms, bToA_ms, uidA: resolvedA };
  }

  clearAsymmetricLatency(): void {
    this._asymmetricLatency = null;
  }

  /**
   * Each packet gets `baseMs ± random(varianceMs)` latency.
   * Overrides the config-level jitterMs for the duration.
   */
  setJitter(baseMs: number, varianceMs: number): void {
    this._jitterConfig = { baseMs, varianceMs };
  }

  clearJitter(): void {
    this._jitterConfig = null;
  }

  /**
   * Linearly ramp latency from `startMs` to `endMs` over `durationTicks`.
   * Call `tick()` to advance, or it auto-increments on each relay.
   */
  degradeOverTime(startMs: number, endMs: number, durationTicks: number): void {
    this._degradeState = { startMs, endMs, durationTicks, currentTick: 0 };
  }

  /** Advance the degrade-over-time counter manually. */
  tick(): void {
    if (this._degradeState && this._degradeState.currentTick < this._degradeState.durationTicks) {
      this._degradeState.currentTick++;
    }
  }

  clearDegradeOverTime(): void {
    this._degradeState = null;
  }

  // ── Internal relay / latency logic ───────────────────────────────

  /** @internal Deliver a message from `fromUid` to all peers. */
  _relay(
    fromUid: string,
    fromIndex: number,
    type: 'inputs' | 'hash' | 'snapshot',
    data: unknown,
  ): void {
    // Auto-increment degrade tick on each relay call
    if (this._degradeState && this._degradeState.currentTick < this._degradeState.durationTicks) {
      this._degradeState.currentTick++;
    }

    for (const [uid, transport] of this._transports) {
      if (uid === fromUid) continue;

      // Burst loss check (per-packet)
      if (this._burstLoss && this._burstLoss.remaining > 0) {
        this._burstLoss.remaining--;
        this._stats.messagesDropped++;
        continue;
      }

      // Probabilistic packet loss
      if (this._config.packetLossRate > 0 && Math.random() < this._config.packetLossRate) {
        this._stats.messagesDropped++;
        continue;
      }

      const deliver = () => transport._receive(fromIndex, type, data);

      const latency = this._computeLatency(fromUid);
      if (latency <= 0) {
        this._stats.messagesRelayed++;
        this._stats.deliveryDelays.push(0);
        deliver();
      } else {
        this._stats.messagesRelayed++;
        this._stats.deliveryDelays.push(latency);
        const timer = setTimeout(deliver, latency);
        this._timers.push(timer);
      }
    }
  }

  /** @internal Notify peers that a transport disconnected. */
  _notifyDisconnect(fromUid: string): void {
    for (const [uid, transport] of this._transports) {
      if (uid === fromUid) continue;
      transport._peerDisconnected();
    }
  }

  private _computeLatency(fromUid?: string): number {
    // 1) Degrade-over-time takes priority for base latency
    if (this._degradeState) {
      const { startMs, endMs, durationTicks, currentTick } = this._degradeState;
      const t = Math.min(currentTick / durationTicks, 1);
      return Math.max(0, startMs + (endMs - startMs) * t);
    }

    // 2) Asymmetric latency
    if (this._asymmetricLatency && fromUid) {
      const { aToB_ms, bToA_ms, uidA } = this._asymmetricLatency;
      return fromUid === uidA ? aToB_ms : bToA_ms;
    }

    // 3) setJitter overrides config-level jitter
    if (this._jitterConfig) {
      const { baseMs, varianceMs } = this._jitterConfig;
      const jitter = (Math.random() * 2 - 1) * varianceMs;
      return Math.max(0, baseMs + jitter);
    }

    // 4) Default: config latency + config jitter
    let lat = this._config.latencyMs;
    if (this._config.jitterMs && this._config.jitterMs > 0) {
      lat += (Math.random() * 2 - 1) * this._config.jitterMs;
    }
    return Math.max(0, lat);
  }

  /** Clean up all pending timers. Call in afterEach. */
  dispose(): void {
    this.clearBurstLoss();
    for (const t of this._timers) clearTimeout(t);
    this._timers.length = 0;
    this._transports.clear();
    this._asymmetricLatency = null;
    this._jitterConfig = null;
    this._degradeState = null;
    this._stats = { messagesRelayed: 0, messagesDropped: 0, deliveryDelays: [] };
  }
}

class LoopbackTransportImpl implements MatchTransport {
  private _uid: string;
  private _playerIndex: number;
  private _opponentUids: string[];
  private _hub: LoopbackHub;
  private _connected = false;

  private _onInputsCb: ((playerIndex: number, frames: InputFrame[]) => void) | null = null;
  private _onHashCb: ((tick: number, hash: number) => void) | null = null;
  private _onSnapshotCb: ((data: unknown) => void) | null = null;
  private _onDisconnectCb: (() => void) | null = null;

  constructor(uid: string, playerIndex: number, opponentUids: string[], hub: LoopbackHub) {
    this._uid = uid;
    this._playerIndex = playerIndex;
    this._opponentUids = opponentUids;
    this._hub = hub;
  }

  async connect(): Promise<void> {
    this._connected = true;
  }

  disconnect(): void {
    if (!this._connected) return;
    this._connected = false;
    this._hub._notifyDisconnect(this._uid);
  }

  sendInputs(packet: InputFrame[]): void {
    if (!this._connected) return;
    this._hub._relay(this._uid, this._playerIndex, 'inputs', packet);
  }

  sendHash(tick: number, hash: number): void {
    if (!this._connected) return;
    this._hub._relay(this._uid, this._playerIndex, 'hash', { tick, hash });
  }

  sendSnapshot(data: unknown): void {
    if (!this._connected) return;
    this._hub._relay(this._uid, this._playerIndex, 'snapshot', data);
  }

  onRemoteInputs(cb: (playerIndex: number, frames: InputFrame[]) => void): void {
    this._onInputsCb = cb;
  }

  onRemoteHash(cb: (tick: number, hash: number) => void): void {
    this._onHashCb = cb;
  }

  onRemoteSnapshot(cb: (data: unknown) => void): void {
    this._onSnapshotCb = cb;
  }

  onDisconnect(cb: () => void): void {
    this._onDisconnectCb = cb;
  }

  get estimatedRttMs(): number {
    return this._hub['_config'].latencyMs * 2;
  }

  /** @internal Called by hub to deliver a message. */
  _receive(fromIndex: number, type: 'inputs' | 'hash' | 'snapshot', data: unknown): void {
    if (!this._connected) return;
    switch (type) {
      case 'inputs':
        this._onInputsCb?.(fromIndex, data as InputFrame[]);
        break;
      case 'hash': {
        const { tick, hash } = data as { tick: number; hash: number };
        this._onHashCb?.(tick, hash);
        break;
      }
      case 'snapshot':
        this._onSnapshotCb?.(data);
        break;
    }
  }

  /** @internal Called by hub when a peer disconnects. */
  _peerDisconnected(): void {
    this._onDisconnectCb?.();
  }
}
