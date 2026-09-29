// ── Lockstep Simulation Engine ─────────────────────────────
// Extracted from lockstepManager.ts for file size compliance.
// Owns the forward simulation pipeline: input collection, sim step
// execution (snapshot/advance/quantize), and network state send.

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

const SEND_INTERVAL = 3;          // send inputs every 3 ticks (~20Hz)
const HASH_INTERVAL = 60;         // exchange state hash every 60 ticks (~1s)
const MAX_PREDICT_AHEAD = 18;     // max ticks to advance with predicted remote input (~300ms)
const DEATH_GRACE_TICKS = 3;
const MAX_ROLLBACK_TICKS = 14;

/** Composite key for predicted inputs: (tick, playerIndex). */
export function predictionKey(tick: number, playerIndex: number): number {
  return tick * 100 + playerIndex; // supports up to 100 players per tick
}

/** Mutable state surface that the sim engine reads/writes via the manager. */
export interface SimContext {
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
  sendCounter: number;
  hashSendCounter: number;
  predictAhead: number;
  predictedInputs: Map<number, InputFrame>;
  resimulating: boolean;
  prevAlive: boolean[];
  pendingDeaths: Array<{ playerIndex: number; commitTick: number }>;
  pendingDestroys: Array<{ trailOwner: number; segIdx: number; tick: number }>;

  computeProximityAndMeter(): void;
}

/** Input snapshot passed to simTick each frame. */
export interface TickInput {
  turnDir: number;
  accelerate: boolean;
  dash: boolean;
  brake: boolean;
  special: boolean;
}

/** Forward simulation engine: input collection -> sim step -> network send. */
export class LockstepSimEngine {
  constructor(private _ctx: SimContext) {}

  /** Update context (called if LockstepManager replaces context after reset). */
  setContext(ctx: SimContext): void {
    this._ctx = ctx;
  }

  /**
   * Run one simulation tick with the given local input.
   * Returns false if the tick was stalled (predict-ahead limit).
   */
  simTick(lastInput: TickInput): boolean {
    const ctx = this._ctx;
    const nextTick = ctx.state.tick + 1;
    const inputDelay = ctx.inputBuffer.inputDelay;

    // Update sim tick for safe pruning
    ctx.inputBuffer.setSimTick(nextTick);

    // Store local input with delay: current raw input applies at tick + delay
    const delayedTick = nextTick + inputDelay;
    ctx.inputBuffer.addLocal({
      tick: delayedTick,
      turnDir: lastInput.turnDir,
      accelerate: lastInput.accelerate,
      dash: lastInput.dash,
      brake: lastInput.brake,
      special: lastInput.special,
    });

    // Get local input for this tick (was stored inputDelay ticks ago)
    const myInput = ctx.inputBuffer.getLocal(nextTick) || emptyInput(nextTick);

    // Phase 1: Collect inputs from all players (with prediction for missing remote)
    const inputs = this._collectTickInputs(nextTick, myInput);

    // Track peak predict-ahead
    ctx.telemetry.recordPredictAhead(ctx.predictAhead);

    // Don't run too far ahead of confirmed remote data
    if (ctx.predictAhead > MAX_PREDICT_AHEAD) {
      ctx.telemetry.recordStallStart();
      if (ctx.telemetry.stallCount % 10 === 1) {
        net.warn('[input] stall predictAhead=' + ctx.predictAhead + ' max=' + MAX_PREDICT_AHEAD);
      }
      return false; // stalled — caller sets accumulator = 0
    }

    // End stall if we were previously stalled
    ctx.telemetry.recordStallEnd();

    // Phase 2: Snapshot, proximity, advance simulation, and quantize
    const prevAlive = this._executeSimStep(inputs);

    // Detect deaths — buffer with grace window to allow rollback to cancel false deaths
    if (!ctx.resimulating) {
      for (let i = 0; i < ctx.playerCount; i++) {
        if (prevAlive[i] && !ctx.state.players[i].alive) {
          ctx.pendingDeaths.push({ playerIndex: i, commitTick: ctx.state.tick + DEATH_GRACE_TICKS });
          net.info('[death] pending player=' + i + ' commitTick=' + (ctx.state.tick + DEATH_GRACE_TICKS));
        }
      }
      // Commit deaths that have survived past the grace window
      for (let i = ctx.pendingDeaths.length - 1; i >= 0; i--) {
        if (ctx.state.tick >= ctx.pendingDeaths[i].commitTick) {
          ctx.callbacks.onDeath(ctx.pendingDeaths[i].playerIndex);
          net.info('[death] committed player=' + ctx.pendingDeaths[i].playerIndex);
          ctx.pendingDeaths.splice(i, 1);
        }
      }

      // Collect grind destroy requests from this tick
      for (let i = 0; i < ctx.state.players.length; i++) {
        const p = ctx.state.players[i];
        for (const segIdx of p._grindDestroyQueue) {
          ctx.pendingDestroys.push({
            trailOwner: p.grindTrailOwner >= 0 ? p.grindTrailOwner : i,
            segIdx,
            tick: ctx.state.tick,
          });
        }
      }

      // Commit destroys that are old enough to be past the rollback window
      const safeTickCutoff = ctx.state.tick - MAX_ROLLBACK_TICKS;
      const toCommit: typeof ctx.pendingDestroys = [];
      ctx.pendingDestroys = ctx.pendingDestroys.filter(d => {
        if (d.tick <= safeTickCutoff) {
          toCommit.push(d);
          return false;
        }
        return true;
      });
      for (const d of toCommit) {
        ctx.callbacks.onTrailSegmentDestroyed?.(d.trailOwner, d.segIdx);
      }
    }

    // Phase 3: Send input packets and state hashes
    this._sendNetworkState(delayedTick);
    return true;
  }

  // ── Input collection (Phase 1 of simTick) ─────────────

  private _collectTickInputs(nextTick: number, myInput: InputFrame): InputFrame[] {
    const ctx = this._ctx;
    const inputs: InputFrame[] = [];
    ctx.predictAhead = 0;
    for (let i = 0; i < ctx.playerCount; i++) {
      if (i >= ctx.humanCount && ctx.callbacks.aiInputProvider) {
        // AI player — deterministic input computed locally on both clients
        inputs.push(ctx.callbacks.aiInputProvider(i, ctx.state, nextTick));
      } else if (i === ctx.myIndex) {
        inputs.push(myInput);
      } else {
        let remoteInput = ctx.inputBuffer.getRemote(i, nextTick);
        if (!remoteInput) {
          remoteInput = ctx.inputBuffer.predictRemote(i, nextTick);
          ctx.predictedInputs.set(predictionKey(nextTick, i), remoteInput);
          const remoteTick = ctx.inputBuffer.getLatestRemoteTick(i);
          if (remoteTick >= 0) {
            ctx.predictAhead = Math.max(ctx.predictAhead, nextTick - remoteTick);
          }
        } else {
          ctx.predictedInputs.delete(predictionKey(nextTick, i));
        }
        inputs.push(remoteInput);
      }
    }
    return inputs;
  }

  // ── Simulation advance (Phase 2 of simTick) ──────────

  private _executeSimStep(inputs: InputFrame[]): boolean[] {
    const ctx = this._ctx;
    // Save snapshot BEFORE proximity/meter computation — rollback restores this
    // pre-computation state so proximity/meter are computed exactly once in both
    // forward sim and rollback paths (fixes double-application desync bug).
    ctx.snapshots.save(ctx.state);
    // Snapshot external AI RNG state at same tick so rollback can restore it
    ctx.callbacks.onSaveAiState?.(ctx.state.tick);

    // Compute trail distances + proximity boost + meter recharge (N-player loop)
    const prox0 = performance.now();
    ctx.computeProximityAndMeter();
    ctx.telemetry.recordProximityCost(performance.now() - prox0);

    // Save previous alive states before simStep (in-place to avoid per-tick allocation)
    for (let i = 0; i < ctx.playerCount; i++) {
      ctx.prevAlive[i] = ctx.state.players[i].alive;
    }

    // Advance simulation
    ctx.state = simStep(ctx.state, inputs, ctx.cfgs);

    // Quantize players every tick (cheap: ~40 Math.round) to prevent float divergence.
    // Full state quantization (including trails) every QUANTIZE_INTERVAL ticks.
    const qt0 = performance.now();
    if (ctx.state.tick % ctx.quantizeInterval === 0) {
      ctx.state = quantizeSimState(ctx.state);
    } else {
      ctx.state = quantizePlayers(ctx.state);
    }
    ctx.telemetry.recordQuantizeCost(performance.now() - qt0);

    return ctx.prevAlive;
  }

  // ── Network state send (Phase 3 of simTick) ──────────

  private _sendNetworkState(delayedTick: number): void {
    const ctx = this._ctx;
    // Send input packet every SEND_INTERVAL ticks (~20Hz)
    ctx.sendCounter++;
    if (ctx.sendCounter >= SEND_INTERVAL) {
      ctx.sendCounter = 0;
      const packet = ctx.inputBuffer.getLocalPacket(delayedTick);
      if (packet.length > 0) {
        ctx.callbacks.onSendInputs(packet);
      }
    }

    // Send state hash every HASH_INTERVAL ticks (~1s) for desync detection
    if (!ctx.resimulating) {
      ctx.hashSendCounter++;
      if (ctx.hashSendCounter >= HASH_INTERVAL) {
        ctx.hashSendCounter = 0;
        const hashStart = performance.now();
        const hash = hashSimState(ctx.state);
        ctx.telemetry.recordHashCost(performance.now() - hashStart);
        ctx.hashVerifier.recordLocalHash(ctx.state.tick, hash);
        if (ctx.callbacks.onSendHash) {
          ctx.callbacks.onSendHash(ctx.state.tick, hash);
        }
        net.log('[hash] local tick=' + ctx.state.tick + ' hash=0x' + hash.toString(16));
      }
    }
  }
}
