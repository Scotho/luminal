// ── Lockstep Rollback Engine ─────────────────────────────
// Extracted from lockstepManager.ts for file size compliance.
// Owns rollback orchestration: snapshot retrieval, re-simulation,
// visual corrections, death/destroy reconciliation, and visual offset decay.

import {
  simStep, hashSimState, quantizePlayers, quantizeSimState,
  type SimState, type InputFrame,
} from './simulation';
import type { SnapshotBuffer } from './simulation';
import type { InputBuffer } from './inputBuffer';
import { emptyInput } from './inputBuffer';
import type { LockstepCallbacks } from './lockstepManager';
import type { LockstepHashVerifier } from './lockstepHashVerifier';
import type { LockstepTelemetryCollector } from './lockstepTelemetryCollector';
import type { VehiclePhysics } from '../vehicleConfig';
import { net } from '../netLog';

const MAX_ROLLBACK_TICKS = 14;
const CORRECTION_DECAY = 12;
const SNAP_THRESHOLD = 4;
const DEATH_GRACE_TICKS = 3;

/** Mutable state surface that the rollback engine reads/writes via the manager. */
export interface RollbackContext {
  readonly myIndex: number;
  readonly playerCount: number;
  readonly humanCount: number;
  readonly cfgs: VehiclePhysics[];
  readonly callbacks: LockstepCallbacks;
  readonly inputBuffer: InputBuffer;
  readonly telemetry: LockstepTelemetryCollector;
  readonly hashVerifier: LockstepHashVerifier;
  readonly quantizeInterval: number;

  // Mutable state accessed by reference
  state: SimState;
  snapshots: SnapshotBuffer;
  resimulating: boolean;
  predictedInputs: Map<number, InputFrame>;
  visualOffsets: Array<{ x: number; z: number }>;
  pendingDeaths: Array<{ playerIndex: number; commitTick: number }>;
  pendingDestroys: Array<{ trailOwner: number; segIdx: number; tick: number }>;
  rollbackCount: number;

  computeProximityAndMeter(): void;
}

/** Handles rollback orchestration: snapshot restore, re-simulation, and post-correction. */
export class LockstepRollbackEngine {
  constructor(private _ctx: RollbackContext) {}

  /** Update context (called if LockstepManager replaces context after reset). */
  setContext(ctx: RollbackContext): void {
    this._ctx = ctx;
  }

  // ── Rollback ─────────────────────────────────────────────

  rollback(mispredictedTick: number): void {
    const ctx = this._ctx;
    const targetTick = ctx.state.tick;
    const rbStart = performance.now();
    net.info('[rollback] start from=' + mispredictedTick + ' to=' + targetTick + ' depth=' + (targetTick - mispredictedTick + 1));

    // Phase 1: Retrieve snapshot and restore state
    const oldPositions = this._prepareRollback(mispredictedTick);
    if (!oldPositions) return;

    // Phase 2: Re-simulate from mispredicted tick to current tick
    const resimHashes = this._resimulateRange(mispredictedTick, targetTick);
    const rbCostMs = performance.now() - rbStart;
    const rbDepth = targetTick - mispredictedTick + 1;
    ctx.telemetry.recordRollback(rbCostMs, rbDepth);
    net.info('[rollback] complete ticks=' + rbDepth + ' cost=' + rbCostMs.toFixed(2) + 'ms');

    // Phase 3: Apply visual corrections, prune stale state, reconcile deaths
    this._applyRollbackCorrections(oldPositions, resimHashes, mispredictedTick, targetTick);
  }

  // ── Rollback Phase 1: Snapshot retrieval ────────────────

  private _prepareRollback(mispredictedTick: number): { x: number; z: number }[] | null {
    const ctx = this._ctx;
    // Retrieve snapshot from BEFORE the mispredicted tick
    const snapshot = ctx.snapshots.get(mispredictedTick - 1);
    if (!snapshot) {
      ctx.telemetry.recordSnapshotMiss();
      net.warn('[rollback] snapshot-missing tick=' + (mispredictedTick - 1));
      return null;
    }

    // Save pre-rollback positions for visual smoothing
    const oldPositions = ctx.state.players.map(p => ({ x: p.x, z: p.z }));

    // Restore to snapshot and re-simulate forward
    ctx.state = snapshot;
    // Restore external AI RNG state to match snapshot tick — without this,
    // rollback re-simulation consumes RNG values a second time, causing AI
    // inputs to diverge from the peer that didn't roll back (desync bug).
    ctx.callbacks.onRestoreAiState?.(mispredictedTick - 1);
    ctx.resimulating = true;

    // Discard pending destroys from ticks that are being rolled back — they
    // may not occur in the corrected timeline and must not be committed.
    ctx.pendingDestroys = ctx.pendingDestroys.filter(d => d.tick < mispredictedTick);

    return oldPositions;
  }

  // ── Rollback Phase 2: Re-simulation loop ────────────────

  private _resimulateRange(from: number, to: number): Map<number, number> {
    const ctx = this._ctx;
    // Collect post-simStep hashes during resim (matches forward sim exactly)
    const resimHashes: Map<number, number> = new Map();

    for (let t = from; t <= to; t++) {
      const inputs: InputFrame[] = [];
      for (let i = 0; i < ctx.playerCount; i++) {
        if (i >= ctx.humanCount && ctx.callbacks.aiInputProvider) {
          // AI player — deterministic (RNG restored via onRestoreAiState before resim loop)
          inputs.push(ctx.callbacks.aiInputProvider(i, ctx.state, t));
        } else if (i === ctx.myIndex) {
          inputs.push(ctx.inputBuffer.getLocal(t) || emptyInput(t));
        } else {
          inputs.push(ctx.inputBuffer.getRemote(i, t) || ctx.inputBuffer.predictRemote(i, t));
        }
      }

      // Save snapshot BEFORE proximity computation (matches forward sim ordering)
      ctx.snapshots.save(ctx.state);
      ctx.callbacks.onSaveAiState?.(ctx.state.tick);

      // Recompute trail distances + proximity boost + meter recharge (N-player)
      const rprox0 = performance.now();
      ctx.computeProximityAndMeter();
      ctx.telemetry.recordProximityCost(performance.now() - rprox0);

      ctx.state = simStep(ctx.state, inputs, ctx.cfgs);

      // Quantization must match forward sim exactly
      const rqt0 = performance.now();
      if (ctx.state.tick % ctx.quantizeInterval === 0) {
        ctx.state = quantizeSimState(ctx.state);
      } else {
        ctx.state = quantizePlayers(ctx.state);
      }
      ctx.telemetry.recordQuantizeCost(performance.now() - rqt0);

      // Collect correct post-simStep hash at hash-check ticks
      // (forward sim hashes this._state AFTER simStep — resim must match)
      if (ctx.hashVerifier.localHashes.has(ctx.state.tick)) {
        resimHashes.set(ctx.state.tick, hashSimState(ctx.state));
      }
    }

    ctx.resimulating = false;
    return resimHashes;
  }

  // ── Rollback Phase 3: Post-rollback corrections ─────────

  private _applyRollbackCorrections(
    oldPositions: { x: number; z: number }[],
    resimHashes: Map<number, number>,
    _mispredictedTick: number,
    _targetTick: number,
  ): void {
    const ctx = this._ctx;
    // Compute visual correction offsets (old position - new position) for all players
    for (let i = 0; i < ctx.playerCount; i++) {
      const dx = oldPositions[i].x - ctx.state.players[i].x;
      const dz = oldPositions[i].z - ctx.state.players[i].z;
      const dist = Math.hypot(dx, dz);
      ctx.telemetry.recordVisualCorrection(dist);

      if (dist > SNAP_THRESHOLD) {
        net.log('[rollback] snap player=' + i + ' dist=' + dist.toFixed(2));
        ctx.visualOffsets[i] = { x: 0, z: 0 };
      } else {
        ctx.visualOffsets[i] = {
          x: ctx.visualOffsets[i].x + dx,
          z: ctx.visualOffsets[i].z + dz,
        };
      }
    }

    // Prune old prediction entries (collect-then-delete to avoid mutation during iteration)
    const stalePredictions: number[] = [];
    for (const [key] of ctx.predictedInputs) {
      // Keys are tick*100+playerIndex; tick = Math.floor(key/100)
      const tick = Math.floor(key / 100);
      if (tick <= ctx.state.tick - MAX_ROLLBACK_TICKS) stalePredictions.push(key);
    }
    for (const k of stalePredictions) ctx.predictedInputs.delete(k);

    // Apply corrected post-simStep hashes from re-simulation
    // (old code used snapshots which are PRE-proximity — off by one sim step)
    const hashes = ctx.hashVerifier.localHashes;
    for (const [t, h] of resimHashes) {
      const oldHash = hashes.get(t);
      hashes.set(t, h);
      // Re-send corrected hash if rollback changed it — the original was already
      // sent to the remote peer and is now stale, causing false desync detection.
      if (oldHash !== undefined && oldHash !== h && ctx.callbacks.onSendHash) {
        ctx.callbacks.onSendHash(t, h);
        net.info('[rollback] re-sent corrected hash tick=' + t + ' old=0x' + oldHash.toString(16) + ' new=0x' + h.toString(16));
      }
    }

    // Prune pending deaths that were undone by rollback (player is alive in corrected state)
    ctx.pendingDeaths = ctx.pendingDeaths.filter(d => {
      return !ctx.state.players[d.playerIndex].alive; // keep only if player is still dead after correction
    });

    // Add pending deaths for players who died DURING resimulation but had no pending entry.
    // Without this, deaths caused by rollback correction are silently lost:
    //   1. Forward sim: player alive → no pending death
    //   2. Rollback resim: corrected inputs kill the player
    //   3. _resimulating=true suppressed death detection during resim
    //   4. Next forward tick: prevAlive is already false → death never fires
    const pendingPlayerIndices = new Set(ctx.pendingDeaths.map(d => d.playerIndex));
    for (let i = 0; i < ctx.playerCount; i++) {
      if (!ctx.state.players[i].alive && !pendingPlayerIndices.has(i)) {
        // Player is dead after rollback but has no pending death — add one
        ctx.pendingDeaths.push({ playerIndex: i, commitTick: ctx.state.tick + DEATH_GRACE_TICKS });
      }
    }

    // Dedup: if re-simulation re-detected the same death, prevent duplicate entries
    const seen = new Set<number>();
    ctx.pendingDeaths = ctx.pendingDeaths.filter(d => {
      if (seen.has(d.playerIndex)) return false;
      seen.add(d.playerIndex);
      return true;
    });

    ctx.rollbackCount++;
  }

  // ── Visual offset helpers ──────────────────────────────

  /** Decay visual smoothing offsets toward zero. Call once per frame.
   *  Uses frame-rate-independent exponential decay (Rory Driscoll method). */
  decayVisualOffsets(dt: number): void {
    const offsets = this._ctx.visualOffsets;
    const decay = Math.exp(-CORRECTION_DECAY * dt);
    for (let i = 0; i < offsets.length; i++) {
      offsets[i].x *= decay;
      offsets[i].z *= decay;
      // Snap to zero when negligible
      if (Math.abs(offsets[i].x) < 0.01) offsets[i].x = 0;
      if (Math.abs(offsets[i].z) < 0.01) offsets[i].z = 0;
    }
  }

  /** Get visual smoothing offset for local player. */
  get myVisualOffset(): { x: number; z: number } {
    return this._ctx.visualOffsets[this._ctx.myIndex];
  }

  /** Get visual smoothing offset for a player by index. */
  getVisualOffset(playerIndex: number): { x: number; z: number } {
    return this._ctx.visualOffsets[playerIndex];
  }
}
