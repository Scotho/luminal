// ── Lockstep Simulation Manager ───────────────────────────
// Runs deterministic fixed-timestep simulation with input delay and prediction.
// Both clients run identical sim steps to produce identical state.

import {
  cloneSimState, hashSimState,
  SnapshotBuffer, SIM_DT,
  type SimState, type InputFrame, type PlayerSim, type TrailPoint,
} from './simulation';
import { InputBuffer, MIN_INPUT_DELAY, MAX_INPUT_DELAY } from './inputBuffer';
import { DisconnectPolicy, CASUAL_POLICY, type DisconnectLevel } from '../net/disconnectPolicy';
import type { VehiclePhysics } from '../vehicleConfig';
import { net } from '../netLog';
import { LockstepTelemetryCollector } from './lockstepTelemetryCollector';
import type { RoundTelemetry } from './lockstepTelemetry';
import { computeTrailDistances, computeProximityBoost, computeMeterRecharge } from './lockstepProximity';
import { LockstepHashVerifier } from './lockstepHashVerifier';
import { LockstepRollbackEngine } from './lockstepRollback';
import { LockstepSimEngine, predictionKey, type SimContext } from './lockstepSimEngine';
export { classifyHealth } from './lockstepTelemetry';
export type { RoundTelemetry, HealthSignal, ExtendedHealthSignals } from './lockstepTelemetry';
// Re-export proximity functions/constants for determinism.test.ts
// ts-prune-ignore-next
export { computeTrailDistances, computeProximityBoost, computeMeterRecharge } from './lockstepProximity';

// ── Constants ───────────────────────────────────────────
const MAX_ROLLBACK_TICKS = 14;    // max ticks to rollback (~233ms); covers 2 missed SEND_INTERVAL cycles + jitter
const SNAP_THRESHOLD = 4;         // teleport if correction exceeds this (units)
export const QUANTIZE_INTERVAL = 30;     // round all state to fixed precision every 30 ticks (~0.5s) to prevent float divergence

// ── Lockstep Manager ────────────────────────────────────

// ts-prune-ignore-next
export type PlayerRole = number; // 0-based player index

export interface LockstepCallbacks {
  /** Called when input packet is ready to send (every ~20Hz). */
  onSendInputs: (packet: InputFrame[]) => void;
  /** Called when a player dies in the sim. */
  onDeath: (playerIndex: number) => void;
  /** Called when state hash is ready to send (every ~1s). */
  onSendHash?: (tick: number, hash: number) => void;
  /** Called when desync is detected (local and remote hashes differ). */
  onDesync?: (tick: number, localHash: number, remoteHash: number) => void;
  /** Called when desync recovery is triggered (3+ desyncs in 10s). Player 0 sends snapshot. */
  onDesyncRecovery?: (localState: SimState) => void;
  /** Called when opponent disconnect level changes. */
  onDisconnectLevel?: (level: DisconnectLevel, elapsedMs: number) => void;
  /** Compute deterministic AI input for a given player index. Called inside simTick for AI indices (>= humanCount). */
  aiInputProvider?: (playerIndex: number, state: SimState, tick: number) => InputFrame;
  /** Called after each forward sim tick so external AI RNG state can be snapshotted for rollback. */
  onSaveAiState?: (tick: number) => void;
  /** Called before rollback re-simulation so external AI RNG state can be restored to the snapshot tick. */
  onRestoreAiState?: (tick: number) => void;
  /** Called when a grind trail segment is confirmed destroyed (past rollback window). */
  onTrailSegmentDestroyed?: (trailOwner: number, segIdx: number) => void;
}

export class LockstepManager {
  private _state: SimState;
  private _inputBuffer: InputBuffer;
  private _snapshots: SnapshotBuffer;
  private _cfgs: VehiclePhysics[];
  private _myIndex: number;
  private _playerCount: number;     // total (humans + AIs)
  private _humanCount: number;      // number of human players (indices 0..humanCount-1)
  private _accumulator = 0;
  private _sendCounter = 0;
  private _callbacks: LockstepCallbacks;
  private _predictAhead = 0;         // how many ticks ahead of confirmed remote
  private _lastInputTurnDir: number = 0;
  private _lastInputAccelerate = false;
  private _lastInputDash = false;
  private _lastInputBrake = false;
  private _lastInputSpecial = false;
  private _started = false;

  // Hash verification (delegated to LockstepHashVerifier)
  private _hashSendCounter = 0;
  private _hashVerifier!: LockstepHashVerifier;

  // Death confirmation deferral
  private _pendingDeaths: { playerIndex: number; commitTick: number }[] = [];

  // Grind trail destruction deferral — held until past rollback window
  private _pendingDestroys: Array<{ trailOwner: number; segIdx: number; tick: number }> = [];

  // Rollback + visual smoothing
  private _rollbackCount = 0;         // number of rollbacks performed (stats)
  private _predictedInputs: Map<number, InputFrame> = new Map(); // predictionKey -> predicted remote input
  private _resimulating = false;       // true during rollback re-simulation (suppress callbacks)
  private _visualOffsets: Array<{ x: number; z: number }>; // one per player
  private _prevAlive: boolean[]; // pre-allocated to avoid per-tick GC

  // ── Per-round telemetry (delegated to collector) ─────────
  private _telemetry = new LockstepTelemetryCollector();

  // Disconnect detection
  private _disconnectPolicy: DisconnectPolicy;

  // Rollback engine (extracted for file size compliance)
  private _rollbackEngine!: LockstepRollbackEngine;
  // Forward sim engine (extracted for file size compliance)
  private _simEngine!: LockstepSimEngine;

  constructor(
    myIndex: number,
    playerCount: number,
    startState: SimState,
    cfgs: VehiclePhysics[],
    callbacks: LockstepCallbacks,
    humanCount?: number,
  ) {
    this._myIndex = myIndex;
    this._playerCount = playerCount;
    this._humanCount = humanCount ?? playerCount;
    this._state = cloneSimState(startState);
    this._cfgs = cfgs;
    this._callbacks = callbacks;
    this._inputBuffer = new InputBuffer();
    this._snapshots = new SnapshotBuffer(120); // ~2s of snapshots
    this._started = false;
    this._visualOffsets = Array.from({ length: playerCount }, () => ({ x: 0, z: 0 }));
    this._prevAlive = new Array<boolean>(playerCount).fill(false);
    this._hashVerifier = new LockstepHashVerifier({
      snapshots: this._snapshots,
      callbacks: this._callbacks,
      telemetry: this._telemetry,
      quantizeInterval: QUANTIZE_INTERVAL,
      getState: () => this._state,
      getPredictedInputsSize: () => this._predictedInputs.size,
    });
    this._rollbackEngine = new LockstepRollbackEngine(this._buildRollbackContext());
    this._simEngine = new LockstepSimEngine(this._buildSimContext());
    // TODO: accept policy as a constructor param when ranked matches are wired up.
    // Ranked policy uses forfeitMs=30_000 (vs casual 20_000). Currently only the
    // OnlineMatch-level heartbeat check uses the ranked policy.
    this._disconnectPolicy = new DisconnectPolicy(CASUAL_POLICY);
    if (callbacks.onDisconnectLevel) {
      this._disconnectPolicy.onLevelChange((level, elapsedMs) => {
        net.warn('[disconnect] level=' + level + ' elapsed=' + elapsedMs + 'ms');
        callbacks.onDisconnectLevel!(level, elapsedMs);
      });
    }
  }

  /** Update input delay from measured RTT. Call before gameplay starts. */
  setInputDelay(delay: number): void {
    this._inputBuffer.inputDelay = Math.max(MIN_INPUT_DELAY, Math.min(MAX_INPUT_DELAY, delay));
    net.info('[input] delay=' + this._inputBuffer.inputDelay);
  }

  // ── Public API ──────────────────────────────────────────

  get state(): SimState { return this._state; }
  get tick(): number { return this._state.tick; }
  get inputBuffer(): InputBuffer { return this._inputBuffer; }
  get started(): boolean { return this._started; }
  get isResimulating(): boolean { return this._resimulating; }
  get humanCount(): number { return this._humanCount; }
  get playerCount(): number { return this._playerCount; }
  get myIndex(): number { return this._myIndex; }

  /** Compact hash of current simulation state for ranked death verification. */
  getStateDigest(): number {
    return hashSimState(this._state);
  }

  /** Call once when gameplay begins (after countdown). */
  start(): void {
    this._started = true;
    net.info('[barrier] lockstep-started');
    this._accumulator = 0;
    this._sendCounter = 0;
    this._predictAhead = 0;
    // Reset disconnect clock to now — construction happens before the countdown,
    // so without this reset the elapsed time already exceeds warningMs on the
    // very first update() call, causing a spurious banner flash at round start.
    this._disconnectPolicy.reset();
    // Save initial snapshot so rollback to tick 1 is possible
    this._snapshots.save(this._state);
  }

  /** Called each frame with raw input and frame delta. */
  update(
    dt: number,
    turnDir: number,
    accelerate: boolean,
    dash: boolean,
    brake: boolean,
    special?: boolean,
  ): void {
    if (!this._started) return;

    // Cache latest input for delayed application
    this._lastInputTurnDir = turnDir;
    this._lastInputAccelerate = accelerate;
    this._lastInputDash = dash;
    this._lastInputBrake = brake;
    this._lastInputSpecial = special ?? false;

    // Fixed timestep accumulator
    this._accumulator += dt;
    while (this._accumulator >= SIM_DT) {
      this._accumulator -= SIM_DT;
      const t0 = performance.now();
      const advanced = this._simEngine.simTick({
        turnDir: this._lastInputTurnDir,
        accelerate: this._lastInputAccelerate,
        dash: this._lastInputDash,
        brake: this._lastInputBrake,
        special: this._lastInputSpecial,
      });
      const costMs = performance.now() - t0;
      this._telemetry.recordSimTickCost(costMs);
      if (!advanced) {
        this._accumulator = 0;
        break;
      }
    }

    // Check opponent connectivity each frame
    this._disconnectPolicy.update();
  }

  /** Feed remote input packet from network. Triggers rollback if misprediction detected. */
  receiveRemoteInputs(playerIndex: number, frames: InputFrame[]): void {
    net.log('[input] recv player=' + playerIndex + ' frames=' + frames.length + ' ticks=' + frames[0]?.tick + '-' + frames[frames.length - 1]?.tick);
    // Check for mispredictions: compare incoming input against what we predicted
    let rollbackTick = -1;
    for (const frame of frames) {
      if (frame.tick > this._state.tick) { this._telemetry.recordOnTimeInput(); continue; } // future tick, not yet simulated
      if (frame.tick <= this._state.tick - MAX_ROLLBACK_TICKS) {
        this._telemetry.recordOnTimeInput(); // flush late streak: arrival beyond rollback window is a boundary
        continue;
      }

      const key = predictionKey(frame.tick, playerIndex);
      const predicted = this._predictedInputs.get(key);
      if (predicted !== undefined) {
        const ticksLate = this._state.tick - frame.tick;
        this._telemetry.recordLateInput(ticksLate);
        const mismatch = predicted.turnDir !== frame.turnDir ||
          predicted.accelerate !== frame.accelerate ||
          predicted.brake !== frame.brake ||
          predicted.dash !== frame.dash ||
          (predicted.special ?? false) !== (frame.special ?? false);
        if (mismatch) {
          this._telemetry.recordMisprediction();
          if (rollbackTick < 0 || frame.tick < rollbackTick) {
            rollbackTick = frame.tick;
          }
        } else {
          this._telemetry.recordCorrectPrediction();
        }
      } else {
        // No prediction existed — input arrived before we needed to predict it.
        // Reset the late streak so non-predicted frames don't extend burst counts.
        this._telemetry.recordOnTimeInput();
      }
    }

    // Store confirmed inputs and clean up predictions
    this._inputBuffer.receiveRemote(playerIndex, frames);
    for (const frame of frames) {
      this._predictedInputs.delete(predictionKey(frame.tick, playerIndex));
    }
    // Record input for disconnect detection
    if (frames.length > 0) this._disconnectPolicy.recordInput();
    // Recompute how far ahead we are based on actual confirmed remote tick
    const latestRemote = this._inputBuffer.getLatestRemoteTick(playerIndex);
    this._predictAhead = Math.max(0, this._state.tick - latestRemote);

    // Perform rollback if misprediction found
    if (rollbackTick >= 0 && this._started) {
      net.warn('[rollback] misprediction player=' + playerIndex + ' tick=' + rollbackTick);
      this._rollback(rollbackTick);
    }
  }

  /** Reset for a new round. */
  reset(startState: SimState): void {
    net.info('[barrier] lockstep-reset');
    this._state = cloneSimState(startState);
    this._inputBuffer.clear();
    this._snapshots = new SnapshotBuffer(120);
    this._accumulator = 0;
    this._sendCounter = 0;
    this._predictAhead = 0;
    this._predictedInputs.clear();
    this._hashSendCounter = 0;
    this._hashVerifier.reset();
    this._pendingDeaths = [];
    this._pendingDestroys = [];
    this._visualOffsets = Array.from({ length: this._playerCount }, () => ({ x: 0, z: 0 }));
    this._prevAlive = new Array<boolean>(this._playerCount).fill(false);
    this._telemetry.reset();
    this._disconnectPolicy.reset();
    this._started = false;
  }

  // ── N-player proximity + meter computation ─────────────

  private _computeProximityAndMeter(): void {
    for (let i = 0; i < this._playerCount; i++) {
      const p = this._state.players[i];
      if (!p.alive) continue;

      let minDist = Infinity;
      let minEnemyDist = Infinity;

      // Compute distances to each enemy trail and accumulate minimums
      for (let j = 0; j < this._state.trails.length; j++) {
        if (j === i) continue;
        const result = computeTrailDistances(p.x, p.z, this._state.trails[i], this._state.trails[j]);
        minDist = Math.min(minDist, result.minDist);
        minEnemyDist = Math.min(minEnemyDist, result.minEnemyDist);
      }

      p.proximityBoost = computeProximityBoost(minEnemyDist, p.proximityBoost, SIM_DT);
      p.meter = computeMeterRecharge(
        p.x, p.z, minEnemyDist, p.meter, p.dashing, SIM_DT,
      );
    }
  }

  // ── SimEngine context builder ────────────────────────────

  private _buildSimContext(): SimContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const mgr = this;
    return {
      get myIndex() { return mgr._myIndex; },
      get playerCount() { return mgr._playerCount; },
      get humanCount() { return mgr._humanCount; },
      get cfgs() { return mgr._cfgs; },
      get callbacks() { return mgr._callbacks; },
      get inputBuffer() { return mgr._inputBuffer; },
      get telemetry() { return mgr._telemetry; },
      get hashVerifier() { return mgr._hashVerifier; },
      get quantizeInterval() { return QUANTIZE_INTERVAL; },

      get state() { return mgr._state; },
      set state(v) { mgr._state = v; },
      get snapshots() { return mgr._snapshots; },
      set snapshots(v) { mgr._snapshots = v; },
      get sendCounter() { return mgr._sendCounter; },
      set sendCounter(v) { mgr._sendCounter = v; },
      get hashSendCounter() { return mgr._hashSendCounter; },
      set hashSendCounter(v) { mgr._hashSendCounter = v; },
      get predictAhead() { return mgr._predictAhead; },
      set predictAhead(v) { mgr._predictAhead = v; },
      get predictedInputs() { return mgr._predictedInputs; },
      set predictedInputs(v) { mgr._predictedInputs = v; },
      get resimulating() { return mgr._resimulating; },
      set resimulating(v) { mgr._resimulating = v; },
      get prevAlive() { return mgr._prevAlive; },
      set prevAlive(v) { mgr._prevAlive = v; },
      get pendingDeaths() { return mgr._pendingDeaths; },
      set pendingDeaths(v) { mgr._pendingDeaths = v; },
      get pendingDestroys() { return mgr._pendingDestroys; },
      set pendingDestroys(v) { mgr._pendingDestroys = v; },

      computeProximityAndMeter: () => mgr._computeProximityAndMeter(),
    };
  }

  // ── Rollback context builder ────────────────────────────

  private _buildRollbackContext(): import('./lockstepRollback').RollbackContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const mgr = this;
    return {
      get myIndex() { return mgr._myIndex; },
      get playerCount() { return mgr._playerCount; },
      get humanCount() { return mgr._humanCount; },
      get cfgs() { return mgr._cfgs; },
      get callbacks() { return mgr._callbacks; },
      get inputBuffer() { return mgr._inputBuffer; },
      get telemetry() { return mgr._telemetry; },
      get hashVerifier() { return mgr._hashVerifier; },
      get quantizeInterval() { return QUANTIZE_INTERVAL; },

      get state() { return mgr._state; },
      set state(v) { mgr._state = v; },
      get snapshots() { return mgr._snapshots; },
      set snapshots(v) { mgr._snapshots = v; },
      get resimulating() { return mgr._resimulating; },
      set resimulating(v) { mgr._resimulating = v; },
      get predictedInputs() { return mgr._predictedInputs; },
      set predictedInputs(v) { mgr._predictedInputs = v; },
      get visualOffsets() { return mgr._visualOffsets; },
      set visualOffsets(v) { mgr._visualOffsets = v; },
      get pendingDeaths() { return mgr._pendingDeaths; },
      set pendingDeaths(v) { mgr._pendingDeaths = v; },
      get pendingDestroys() { return mgr._pendingDestroys; },
      set pendingDestroys(v) { mgr._pendingDestroys = v; },
      get rollbackCount() { return mgr._rollbackCount; },
      set rollbackCount(v) { mgr._rollbackCount = v; },

      computeProximityAndMeter: () => mgr._computeProximityAndMeter(),
    };
  }

  // ── Hash Verification (delegated to LockstepHashVerifier) ──

  /** Called when opponent's hash arrives from the network. */
  receiveRemoteHash(tick: number, hash: number): void {
    this._hashVerifier.receiveRemoteHash(tick, hash);
  }

  /** Number of desync events detected. */
  get desyncCount(): number { return this._hashVerifier.desyncCount; }

  /** Apply authoritative state snapshot from player 0 during desync recovery. */
  receiveRecoverySnapshot(state: SimState): void {
    const recStart = performance.now();
    // Measure snapshot payload size + serialization cost for telemetry
    try {
      const serdeT0 = performance.now();
      const bytes = JSON.stringify(state).length;
      this._telemetry.recordRecoverySnapshot(bytes, performance.now() - serdeT0);
    } catch (err) {
      net.warn('lockstep: recovery snapshot telemetry serialize failed', err);
    }

    // Visual smoothing for position correction
    const oldMy = this._state.players[this._myIndex];

    const cloneT0 = performance.now();
    this._state = cloneSimState(state);
    this._telemetry.recordRecoveryDeserde(performance.now() - cloneT0);
    this._snapshots = new SnapshotBuffer(120);
    this._snapshots.save(this._state);
    this._inputBuffer.clearRemote();
    this._predictedInputs.clear();
    this._hashVerifier.reset();
    this._hashSendCounter = 0;
    this._predictAhead = 0;
    this._pendingDeaths = [];
    this._pendingDestroys = [];

    const newMy = this._state.players[this._myIndex];
    const dx = oldMy.x - newMy.x;
    const dz = oldMy.z - newMy.z;
    const recoveryDist = Math.hypot(dx, dz);
    this._telemetry.recordVisualCorrection(recoveryDist);
    if (recoveryDist > SNAP_THRESHOLD) {
      this._visualOffsets[this._myIndex] = { x: 0, z: 0 };
    } else {
      this._visualOffsets[this._myIndex] = {
        x: this._visualOffsets[this._myIndex].x + dx,
        z: this._visualOffsets[this._myIndex].z + dz,
      };
    }

    const recCostMs = performance.now() - recStart;
    this._telemetry.recordRecoveryCost(recCostMs);
    net.info(`desync recovery snapshot applied at tick ${state.tick} cost=${recCostMs.toFixed(2)}ms`);
  }

  // ── Rollback (delegated to LockstepRollbackEngine) ──────

  private _rollback(mispredictedTick: number): void {
    this._rollbackEngine.rollback(mispredictedTick);
  }

  /** Decay visual smoothing offsets toward zero. Call once per frame.
   *  Uses frame-rate-independent exponential decay (Rory Driscoll method). */
  decayVisualOffsets(dt: number): void {
    this._rollbackEngine.decayVisualOffsets(dt);
  }

  /** Get visual smoothing offset for local player. */
  get myVisualOffset(): { x: number; z: number } {
    return this._rollbackEngine.myVisualOffset;
  }

  /** Get visual smoothing offset for a player by index. */
  getVisualOffset(playerIndex: number): { x: number; z: number } {
    return this._rollbackEngine.getVisualOffset(playerIndex);
  }

  /** Number of rollbacks performed (for debugging). */
  get rollbackCount(): number { return this._rollbackCount; }

  /** How many ticks ahead of confirmed remote data we are (current value). */
  get predictAhead(): number { return this._predictAhead; }

  // ── Helpers ─────────────────────────────────────────────

  /** Get the current player state (mine). */
  getMyPlayer(): PlayerSim {
    return this._state.players[this._myIndex];
  }

  /** Get a player state by index. */
  getPlayerByIndex(i: number): PlayerSim {
    return this._state.players[i];
  }

  /** Get my trail. */
  getMyTrail(): TrailPoint[] {
    return this._state.trails[this._myIndex];
  }

  /** Get a trail by player index. */
  getTrailByIndex(i: number): TrailPoint[] {
    return this._state.trails[i];
  }

  /** Kill the local player in the sim (e.g. lobby AI trail collision). */
  killMyPlayer(): void {
    this._state.players[this._myIndex] = { ...this._state.players[this._myIndex], alive: false };
  }

  /** Interpolation alpha for smooth rendering between sim ticks. */
  get renderAlpha(): number {
    return this._accumulator / SIM_DT;
  }

  // ── Telemetry ─────────────────────────────────────────────

  /** Snapshot of per-round netcode telemetry. */
  getTelemetry(): RoundTelemetry {
    return this._telemetry.build(this._rollbackCount, this._hashVerifier.desyncCount, this._state.tick, this._predictAhead);
  }
}
