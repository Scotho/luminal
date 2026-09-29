// ── Online Lockstep Setup ────────────────────────────────
// Extracted from onlineMode.startOnlineMatch — constructs the
// LockstepManager with AI sim integration, desync-recovery snapshot
// plumbing, and disconnect banner handling.

import { createAIState, cloneAIState, getAIInputSim } from '../ai';
import {
  createSimState,
  SIM_DT,
  serializeSimState,
  deserializeSimState,
  type SerializedSimState,
  type PlayerSpawn,
  type SimState,
  type InputFrame,
} from '../core/simulation';
import { SimSpatialGrid } from '../core/simSpatialGrid';
import { LockstepManager } from '../core/lockstepManager';
import { getVehiclePhysics } from '../vehicleConfig';
import { seededRandom, recreateRng } from '../core/seededRandom';
import { vibrate, VIBE } from '../vibrate';
import { playExplosion } from '../sfx';
import { net } from '../netLog';
import type { OnlineMatch } from '../onlineMatch';
import type { AIState, VehicleType } from '../types/index';

import type { IOnlineModeHost } from './onlineModeTypes';
import { _getLockstepPlayer } from './onlineModeHelpers';

interface AiSetupResult {
  aiVehicleTypes: VehicleType[];
  lockstepAiStates: AIState[];
  simGrid: SimSpatialGrid;
  aiEntries: Array<[string, { color: string; vehicle?: string }]>;
  spawnsForSim: PlayerSpawn[];
}

/**
 * Construct the LockstepManager (including AI sim integration,
 * desync recovery snapshot plumbing, and disconnect banner).
 *
 * Public entry point — call from startOnlineMatch when useLockstep is true.
 */
export function buildLockstepManager(
  host: IOnlineModeHost,
  onlineMatch: OnlineMatch,
  allSpawns: ReturnType<OnlineMatch['getSpawns']>,
  allUids: string[],
  cfgs: ReturnType<typeof getVehiclePhysics>[],
  humanCount: number,
  myIndex: number,
): void {
  const aiSetup = _buildAiSimSetup(onlineMatch, allSpawns, allUids, cfgs, humanCount);
  host._lockstepAiStates = aiSetup.lockstepAiStates;

  const { saveAiRngState, restoreAiRngState } = _buildAiRngRingBuffer(aiSetup.lockstepAiStates);

  const startState = createSimState(0, aiSetup.spawnsForSim);
  const totalPlayerCount = humanCount + aiSetup.aiEntries.length;
  const uidToIndex = new Map(allUids.map((uid, i) => [uid, i] as const));

  const aiInputProvider = _buildAiInputProvider(aiSetup, humanCount, myIndex);

  const nc = onlineMatch.netcode;
  host._lockstep = new LockstepManager(myIndex, totalPlayerCount, startState, cfgs, {
    onSendInputs: (packet) => nc.sendInputs(packet),
    onDeath: (playerIndex: number) => _handleSimDeath(onlineMatch, allUids, humanCount, playerIndex),
    aiInputProvider: aiSetup.aiEntries.length > 0 ? aiInputProvider : undefined,
    onSaveAiState: aiSetup.aiEntries.length > 0 ? saveAiRngState : undefined,
    onRestoreAiState: aiSetup.aiEntries.length > 0 ? restoreAiRngState : undefined,
    onSendHash: (tick, hash) => nc.sendHash(tick, hash),
    onDesync: (tick, local, remote) => {
      net.error(`sim diverged at tick ${tick}! local=0x${local.toString(16)} remote=0x${remote.toString(16)}`);
      onlineMatch.recordDesync();
    },
    onDesyncRecovery: (localState) => _handleDesyncRecovery(host, nc, myIndex, localState),
    onDisconnectLevel: (level, elapsedMs) => _handleDisconnectLevel(host, onlineMatch, level, elapsedMs),
    onTrailSegmentDestroyed: (trailOwner: number, segIdx: number) => {
      // Map lockstep player index → visual Player object and trigger fade
      const targetPlayer = _getLockstepPlayer(host, myIndex, humanCount, trailOwner);
      if (targetPlayer) {
        targetPlayer.trail.fadeSegment(segIdx);
      }
    },
  }, humanCount);

  _wireNetcodeListeners(host, nc, myIndex, uidToIndex);
}

/**
 * Append AI spawns + configs, create per-AI seeded AIState, build
 * the full PlayerSpawn list used by the deterministic sim.
 */
function _buildAiSimSetup(
  onlineMatch: OnlineMatch,
  allSpawns: ReturnType<OnlineMatch['getSpawns']>,
  allUids: string[],
  cfgs: ReturnType<typeof getVehiclePhysics>[],
  humanCount: number,
): AiSetupResult {
  const spawnsForSim: PlayerSpawn[] = allUids.map((_, i) => ({
    x: allSpawns[i].x,
    z: allSpawns[i].z,
    angle: allSpawns[i].angle,
    baseSpeed: cfgs[i].baseSpeed,
  }));

  const aiEntries = onlineMatch.lobbyAis
    ? Object.entries(onlineMatch.lobbyAis).sort(([a], [b]) => Number(a) - Number(b))
    : [];
  const aiVehicleTypes: VehicleType[] = [];
  const lockstepAiStates: AIState[] = [];
  const simGrid = new SimSpatialGrid();

  for (let i = 0; i < aiEntries.length; i++) {
    const [, aiData] = aiEntries[i];
    const aiSpawn = allSpawns[humanCount + i];
    const aiVehicle = (aiData.vehicle || 'bike') as VehicleType;
    aiVehicleTypes.push(aiVehicle);
    spawnsForSim.push({
      x: aiSpawn.x,
      z: aiSpawn.z,
      angle: aiSpawn.angle,
      baseSpeed: getVehiclePhysics(aiVehicle).baseSpeed,
    });
    cfgs.push(getVehiclePhysics(aiVehicle));
    const aiSeed = onlineMatch.seed ^ ((i + 1) * 0x9e3779b9);
    lockstepAiStates.push(createAIState(seededRandom(aiSeed), 'medium'));
  }

  return { aiVehicleTypes, lockstepAiStates, simGrid, aiEntries, spawnsForSim };
}

/**
 * Ring buffer for full AI state snapshots — restored during rollback so AI
 * behavior doesn't diverge from the peer that didn't roll back (fixes desync bug).
 * All mutable AIState fields (RNG, timers, maneuvers, etc.) must be restored.
 */
function _buildAiRngRingBuffer(lockstepAiStates: AIState[]): {
  saveAiRngState: (tick: number) => void;
  restoreAiRngState: (tick: number) => void;
} {
  const AI_STATE_BUFFER_SIZE = 120; // match SnapshotBuffer size (~2s of ticks)
  const aiStateBuffer = new Map<number, AIState[]>();

  const saveAiRngState = (tick: number): void => {
    if (lockstepAiStates.length === 0) return;
    aiStateBuffer.set(tick, lockstepAiStates.map(s => cloneAIState(s)));
    // Prune entries older than buffer size
    const oldest = tick - AI_STATE_BUFFER_SIZE;
    if (aiStateBuffer.has(oldest)) aiStateBuffer.delete(oldest);
  };

  const restoreAiRngState = (tick: number): void => {
    const saved = aiStateBuffer.get(tick);
    if (!saved || lockstepAiStates.length === 0) return;
    for (let i = 0; i < Math.min(saved.length, lockstepAiStates.length); i++) {
      // Replace entire AI state with the snapshot clone
      const clone = cloneAIState(saved[i]);
      Object.assign(lockstepAiStates[i], clone);
      lockstepAiStates[i].rng = clone.rng;
    }
    net.log(`[rollback] restored AI state to tick=${tick}`);
  };

  return { saveAiRngState, restoreAiRngState };
}

/**
 * Build the per-tick AI input provider closure. Deterministic: given
 * a SimState and tick, returns an InputFrame for the AI player index.
 */
function _buildAiInputProvider(
  aiSetup: AiSetupResult,
  humanCount: number,
  myIndex: number,
): (playerIndex: number, state: SimState, tick: number) => InputFrame {
  let _lastGridRebuildTick = -1;
  return (playerIndex: number, state: SimState, tick: number): InputFrame => {
    // Rebuild sim grid once per tick (not per-AI)
    if (tick !== _lastGridRebuildTick) {
      aiSetup.simGrid.rebuild(state.trails);
      _lastGridRebuildTick = tick;
    }
    const aiIdx = playerIndex - humanCount;
    const p = state.players[playerIndex];
    // Target trail: closest human player's trail (player 0 by default)
    const targetIdx = myIndex; // AI hunts the local player
    const aiInput = getAIInputSim(
      p, aiSetup.aiVehicleTypes[aiIdx], aiSetup.simGrid, playerIndex,
      state.trails, SIM_DT, aiSetup.lockstepAiStates[aiIdx], targetIdx,
    );
    // Convert AIInput to InputFrame (pass raw float turn for smooth AI steering)
    return { tick, turnDir: aiInput.turn, accelerate: aiInput.accelerate, dash: aiInput.dash, brake: aiInput.brake };
  };
}

/** Route a deterministic sim death to the correct OnlineMatch callback. */
function _handleSimDeath(
  onlineMatch: OnlineMatch,
  allUids: string[],
  humanCount: number,
  playerIndex: number,
): void {
  if (playerIndex >= humanCount) {
    // AI death — deterministic on both clients
    onlineMatch.registerAiDeath();
    setTimeout(playExplosion, 0);
    return;
  }
  const diedUid = allUids[playerIndex];
  if (diedUid === onlineMatch.myUid) {
    vibrate(VIBE.death);
    onlineMatch.reportLocalDeath(diedUid);
  } else {
    onlineMatch.registerLocalOpponentDeath(diedUid);
  }
}

/**
 * Desync recovery: Player 0 is authoritative — send a serialized
 * snapshot (sim + AI RNG state) for others to adopt. Snap own state
 * to serialized precision so both clients start the next tick from
 * identical floating-point values.
 */
function _handleDesyncRecovery(
  host: IOnlineModeHost,
  nc: OnlineMatch['netcode'],
  myIndex: number,
  localState: SimState,
): void {
  if (myIndex !== 0) return;
  const serialized = serializeSimState(localState);
  // Include AI RNG state so receiver can recreate deterministic AI
  const aiRngSnapshot = host._lockstepAiStates.map(s => ({
    originalSeed: (s.rng as { originalSeed?: number }).originalSeed ?? 0,
    callCount: (s.rng as { callCount?: number }).callCount ?? 0,
  }));
  nc.sendSnapshot({ sim: serialized, aiRng: aiRngSnapshot });
  net.info('[recovery] send-snapshot tick=' + localState.tick + ' aiRng=' + aiRngSnapshot.length);
  // Snap own state to serialized precision so both clients start
  // the next tick from identical floating-point values
  if (host._lockstep) {
    host._lockstep.receiveRecoverySnapshot(deserializeSimState(serialized));
  }
}

/** Update the disconnect banner UI in response to a netcode disconnect level change. */
function _handleDisconnectLevel(
  host: IOnlineModeHost,
  onlineMatch: OnlineMatch,
  level: 'connected' | 'warning' | 'critical' | 'forfeit',
  elapsedMs: number,
): void {
  if (host.mode !== 'online') return;
  net.warn('[disconnect] level=' + level + ' elapsed=' + elapsedMs + 'ms');
  const banner = document.getElementById('disconnect-banner');
  if (!banner) return;
  if (level === 'connected') {
    banner.classList.add('hidden');
  } else if (level === 'warning') {
    banner.textContent = 'Opponent connection unstable...';
    banner.className = 'disconnect-banner warning';
  } else if (level === 'critical') {
    const remaining = Math.max(0, Math.ceil((20000 - elapsedMs) / 1000));
    banner.textContent = `Opponent may have disconnected (${remaining}s)`;
    banner.className = 'disconnect-banner critical';
  } else if (level === 'forfeit') {
    banner.textContent = 'Opponent disconnected — claiming victory...';
    banner.className = 'disconnect-banner forfeit';
    onlineMatch.claimForfeit?.();
  }
}

/**
 * Wire up netcode listeners for remote inputs, hash, snapshot recovery.
 * Starts input and hash sync immediately; starts snapshot sync only for
 * non-authoritative players (myIndex !== 0).
 */
function _wireNetcodeListeners(
  host: IOnlineModeHost,
  nc: OnlineMatch['netcode'],
  myIndex: number,
  uidToIndex: Map<string, number>,
): void {
  // Listen for remote players' input packets + hash
  nc.onRemoteInputs((playerIndex, frames) => {
    host._lockstep?.receiveRemoteInputs(playerIndex, frames);
  });
  nc.onRemoteHash((tick, hash) => {
    host._lockstep?.receiveRemoteHash(tick, hash);
  });
  nc.startInputSync(uidToIndex);
  nc.startHashSync();

  // Desync recovery: non-authoritative players listen for snapshot from player 0
  if (myIndex !== 0) {
    nc.onRemoteSnapshot((data) => {
      if (host._lockstep && data) {
        _applyRecoverySnapshot(host, data);
      }
    });
    nc.startSnapshotSync();
  }
}

/**
 * Apply a recovery snapshot received from player 0. Supports both the
 * legacy bare-SerializedSimState format and the new { sim, aiRng } payload.
 */
function _applyRecoverySnapshot(
  host: IOnlineModeHost,
  data: unknown,
): void {
  // Support new format with AI RNG state alongside sim state
  const payload = data as { sim?: SerializedSimState; aiRng?: Array<{ originalSeed: number; callCount: number }> } | SerializedSimState;
  let simData: SerializedSimState;
  if ('sim' in payload && payload.sim) {
    simData = payload.sim;
    // Restore AI RNG states from snapshot
    if (payload.aiRng && host._lockstepAiStates.length > 0) {
      for (let i = 0; i < Math.min(payload.aiRng.length, host._lockstepAiStates.length); i++) {
        host._lockstepAiStates[i].rng = recreateRng(payload.aiRng[i].originalSeed, payload.aiRng[i].callCount);
      }
    }
  } else {
    simData = payload as SerializedSimState;
  }
  host._lockstep!.receiveRecoverySnapshot(deserializeSimState(simData));
  net.info('[recovery] recv-snapshot applying');
}
