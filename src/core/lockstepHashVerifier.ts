// ── Lockstep Hash Verifier ────────────────────────────────
// Extracted from lockstepManager.ts for file size compliance.
// Owns hash verification state: local/remote hash maps, desync tracking,
// and recovery triggering. The LockstepManager delegates to this class.

import type { SnapshotBuffer } from './simulation';
import type { SimState, PlayerSim } from './simulation';
import type { LockstepTelemetryCollector } from './lockstepTelemetryCollector';
import { net } from '../netLog';

const DEBUG_DESYNC = true;

export interface HashVerifierCallbacks {
  onDesync?: (tick: number, localHash: number, remoteHash: number) => void;
  onDesyncRecovery?: (localState: SimState) => void;
}

export interface HashVerifierContext {
  readonly snapshots: SnapshotBuffer;
  readonly callbacks: HashVerifierCallbacks;
  readonly telemetry: LockstepTelemetryCollector;
  readonly quantizeInterval: number;
  getState(): SimState;
  getPredictedInputsSize(): number;
}

export class LockstepHashVerifier {
  private _localHashes: Map<number, number> = new Map();
  private _oldestHashTick = 0;
  private _pendingRemoteHashes: Map<number, number> = new Map();
  private _desyncCount = 0;
  private _desyncTimestamps: number[] = [];
  private _recoveryInProgress = false;

  constructor(private _ctx: HashVerifierContext) {}

  get desyncCount(): number { return this._desyncCount; }
  /** @internal Exposed for LockstepManager rollback hash reconciliation only. */
  get localHashes(): Map<number, number> { return this._localHashes; }
  get pendingRemoteHashes(): Map<number, number> { return this._pendingRemoteHashes; }
  get recoveryInProgress(): boolean { return this._recoveryInProgress; }
  set recoveryInProgress(v: boolean) { this._recoveryInProgress = v; }

  /** Record a newly computed local hash at the given tick. */
  recordLocalHash(tick: number, hash: number): void {
    if (this._localHashes.size === 0) this._oldestHashTick = tick;
    this._localHashes.set(tick, hash);

    // Check if remote hash arrived early for this tick (race condition fix)
    const pendingRemote = this._pendingRemoteHashes.get(tick);
    if (pendingRemote !== undefined) {
      this._pendingRemoteHashes.delete(tick);
      this._compareHashes(tick, hash, pendingRemote);
    }

    // Prune old hashes (keep last 30 — ~30s at 1 hash/sec)
    if (this._localHashes.size > 30) {
      this._localHashes.delete(this._oldestHashTick);
      let newMin = Infinity;
      for (const t of this._localHashes.keys()) {
        if (t < newMin) newMin = t;
      }
      this._oldestHashTick = newMin === Infinity ? this._oldestHashTick : newMin;
    }

    // Prune stale pending remote hashes that will never be matched
    for (const [t] of this._pendingRemoteHashes) {
      if (t < this._oldestHashTick) this._pendingRemoteHashes.delete(t);
    }
  }

  /** Called when opponent's hash arrives from the network. */
  receiveRemoteHash(tick: number, hash: number): void {
    const localHash = this._localHashes.get(tick);
    if (localHash === undefined) {
      this._pendingRemoteHashes.set(tick, hash);
      net.log('[hash] recv tick=' + tick + ' (pending, local not reached)');
      return;
    }
    if (localHash === hash) {
      net.log('[hash] recv tick=' + tick + ' match (ok)');
      return;
    }
    net.log('[hash] recv tick=' + tick + ' comparing');
    this._compareHashes(tick, localHash, hash);
  }

  /** Compare local vs remote hash for a tick; fires desync callbacks if they differ. */
  private _compareHashes(tick: number, localHash: number, remoteHash: number): void {
    if (localHash === remoteHash) return;

    this._desyncCount++;
    net.warn(
      `desync tick=${tick} local=0x${localHash.toString(16)} remote=0x${remoteHash.toString(16)} (desync #${this._desyncCount})`,
    );

    if (DEBUG_DESYNC) {
      const snap = this._ctx.snapshots.get(tick);
      if (snap) {
        const p = (s: PlayerSim): string =>
          `x=${(s.x).toFixed(2)} z=${(s.z).toFixed(2)} ang=${(s.angle).toFixed(4)} spd=${(s.speed).toFixed(2)} ` +
          `meter=${(s.meter).toFixed(1)} prox=${(s.proximityBoost).toFixed(4)} drift=${s.drifting} ` +
          `trailT=${s.trailTimer} brakeB=${(s.brakeBlend).toFixed(3)} alive=${s.alive} ` +
          `snap=${s.snapRecovery} snapT=${(s.snapRecoveryTimer).toFixed(4)} snapBoost=${s.snapRecoveryBoosted} snapFromAng=${(s.snapRecoveryFromAngle).toFixed(4)}`;
        for (let i = 0; i < snap.players.length; i++) {
          net.warn(`desync-diag tick=${tick} p${i}: ${p(snap.players[i])}`);
        }
        net.warn(`desync-diag trails: ${snap.trails.map((t, i) => `trail${i}.len=${t.length}`).join(' ')}`);
        const qi = this._ctx.quantizeInterval;
        const ticksSinceQuantize = tick % qi;
        const wasQuantizeTick = ticksSinceQuantize === 0;
        net.warn(`desync-diag quantize: tick%${qi}=${ticksSinceQuantize} wasQuantizeTick=${wasQuantizeTick} rollbacksPending=${this._ctx.getPredictedInputsSize() > 0}`);
        for (let i = 0; i < snap.trails.length; i++) {
          const trail = snap.trails[i];
          if (trail.length > 10) {
            const samples = [5, 10, 25, 55, 75].filter(j => j < trail.length);
            const coords = samples.map(j => `[${j}]=(${trail[j].x.toFixed(4)},${trail[j].z.toFixed(4)})`).join(' ');
            net.warn(`desync-diag trail${i} mid-samples: ${coords}`);
          }
        }
      }
    }

    if (this._ctx.callbacks.onDesync) {
      this._ctx.callbacks.onDesync(tick, localHash, remoteHash);
    }

    const now = Date.now();
    this._desyncTimestamps.push(now);
    this._desyncTimestamps = this._desyncTimestamps.filter(t => now - t < 10_000);
    if (this._desyncTimestamps.length >= 3 && !this._recoveryInProgress) {
      this._recoveryInProgress = true;
      this._ctx.telemetry.recordRecovery();
      net.warn(`desync recovery triggered — ${this._desyncTimestamps.length} desyncs in 10s`);
      if (this._ctx.callbacks.onDesyncRecovery) {
        this._ctx.callbacks.onDesyncRecovery(this._ctx.getState());
      }
    }
  }

  /** Reset all hash verification state for a new round. */
  reset(): void {
    this._localHashes.clear();
    this._oldestHashTick = 0;
    this._pendingRemoteHashes.clear();
    this._desyncCount = 0;
    this._desyncTimestamps = [];
    this._recoveryInProgress = false;
  }
}
