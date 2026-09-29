// ── Online Lockstep Tick ─────────────────────────────────
// Extracted from onlineMode.ts. Per-tick logic for online matches:
// input capture → sim advance → apply sim state → reaction SFX/VFX
// → collision fallback (non-lockstep) → fading trail segments.
//
// TIMING-CRITICAL: Any reordering will cause desyncs in online play.
// Preserve the exact order of operations from the original method.

import { ARENA_SIZE, updateWallGlow } from '../grid';
import { getAIInput } from '../ai';
import { SIM_DT } from '../core/simulation';
import { vibrate, VIBE } from '../vibrate';
import {
  playExplosion,
  startProximitySpark,
  updateProximitySpark,
  stopProximitySpark,
  playBoost,
  playDash,
  playSputter,
  playTurnSwoosh,
  playGrindEnter,
  playGrindBail,
  playGrindExit,
  playGrindLanding,
  playGrindHop,
  startGrindLoop,
  updateGrindLoop,
  stopGrindLoop,
} from '../sfx';
import { startVehicleEngine, updateVehicleEngine, stopVehicleEngine } from '../vehicleAudioEngine';
import { playDriftEnter, playDriftExit } from '../sfxAssets';
import { isAccelerate, isDash, isBrake, isSpecial } from '../input';
import { net } from '../netLog';
import { updateTrailProximityVFX, updateEnemySlipstreamVFX, clearEnemySlipstreamVFX } from '../core/collisionSystem';
import { Trail } from '../trail';
import type { AIInput } from '../types/index';
import * as THREE from 'three';
import type { IOnlineModeHost } from './onlineModeTypes';
import {
  _tickAllFadingSegments,
  _updateSlipstreamOverlay,
  _clearSlipstreamOverlay,
  _collectEnemyTrails,
} from './onlineModeHelpers';

/**
 * Block 1: Lockstep tick — sim tick, apply states, SFX reactions,
 * AI update (non-lockstep fallback) + AI collision + human-vs-AI collision.
 *
 * Extracted verbatim from OnlineMode.updateLockstepTick.
 */
export function updateLockstepTick(
  host: IOnlineModeHost,
  dt: number,
  turnDir: number,
  allTrails: Trail[],
): void {
  const lockstep = host._lockstep!;
  const player = host.player!;

  // ── BUG-18 diagnostic: log first few ticks ──
  if (import.meta.env.DEV && lockstep.tick < 3) {
    const mySim = lockstep.getMyPlayer();
    net.warn(`[BUG-18] tick=${lockstep.tick} mySim=(${mySim.x.toFixed(1)},${mySim.z.toFixed(1)}) alive=${mySim.alive}`);
    for (let di = 0; di < host._lockstepHumanCount; di++) {
      if (di === host._lockstepMyIndex) continue;
      const rs = lockstep.getPlayerByIndex(di);
      net.warn(`[BUG-18] tick=${lockstep.tick} remote[${di}]=(${rs.x.toFixed(1)},${rs.z.toFixed(1)}) alive=${rs.alive} speed=${rs.speed.toFixed(1)}`);
    }
    // Check mesh visibility
    for (const ai of host.ais) {
      if (ai.aiState) continue;
      let meshCount = 0;
      ai.player.mesh.traverse((c: THREE.Object3D) => { if ((c as THREE.Mesh).isMesh) meshCount++; });
      const vis = ai.player.mesh.visible;
      net.warn(`[BUG-18] remote meshCount=${meshCount} visible=${vis} pos=(${ai.player.mesh.position.x.toFixed(1)},${ai.player.mesh.position.z.toFixed(1)})`);
    }
  }

  // ── Lockstep mode: deterministic sim drives both players ──
  const _wasBoosting = player.boosting;
  const _wasDashing = player.dashing;
  const _wasDrifting: boolean = player.drifting;
  const _wasGrinding: boolean = player.isGrinding;
  const _wasGrindTrailOwner: number = player.lastGrindTrailOwner;
  const _wasAirborne: boolean = player.isAirborne;

  // Feed raw input into lockstep sim
  lockstep.update(
    dt,
    turnDir,
    isAccelerate(), isDash(), isBrake(), isSpecial(),
  );

  // Decay visual smoothing offsets from rollback corrections
  lockstep.decayVisualOffsets(dt);

  // Apply sim state to all players for rendering (N-player lockstep support)
  const mySim = lockstep.getMyPlayer();
  player.applySimState(mySim, dt, turnDir, host.camera, true);
  let rIdx = 0;
  for (let i = 0; i < host._lockstepHumanCount; i++) {
    if (i === host._lockstepMyIndex) continue;
    const remoteSim = lockstep.getPlayerByIndex(i);
    const aiEntry = host.ais[rIdx++];
    if (aiEntry && !aiEntry.aiState) {
      aiEntry.player.applySimState(remoteSim, dt, 0);
    }
  }

  // Apply sim state to lobby AI bots from lockstep sim
  const lockstepTotalCount = lockstep.playerCount;
  const remoteHumanCount = host._lockstepHumanCount - 1; // humans in ais[] (excluding local player)
  for (let i = host._lockstepHumanCount; i < lockstepTotalCount; i++) {
    const aiIdx = i - host._lockstepHumanCount;
    const aiEntry = host.ais[remoteHumanCount + aiIdx];
    if (aiEntry && aiEntry.aiState) {
      const aiSim = lockstep.getPlayerByIndex(i);
      aiEntry.player.applySimState(aiSim, dt, 0);
    }
  }

  // NOTE: Visual smoothing offsets are applied AFTER camera update (below)
  // to prevent camera jitter during rollback corrections.

  _applyReactionSfx(host, player, turnDir, _wasBoosting, _wasDashing, _wasDrifting, _wasGrinding, _wasGrindTrailOwner, _wasAirborne);

  // Wall glow (visual only)
  const half: number = ARENA_SIZE / 2;
  const pos = player.getPosition();
  const nearestWallDist: number = Math.min(half - Math.abs(pos.x), half - Math.abs(pos.z));
  updateWallGlow(nearestWallDist);

  _applyProximityVFX(host, player, dt);

  // ── Update lobby AI bots ──
  // In lockstep mode, AIs are part of SimState and updated by the sim — skip visual-layer AI
  if (host._lockstep) {
    // AI update + collision handled by lockstep sim (Phase 2E)
  } else {
    _updateLegacyAiPath(host, player, allTrails);
  }

  // ── Tick fading trail segments (grind fade-dissolve) ──
  // Advance dissolve animations and complete destruction once fade finishes.
  _tickAllFadingSegments(host, dt);
}

/**
 * Reaction SFX — dash/boost/sputter/drift/grind/landing.
 * Extracted from updateLockstepTick for readability.
 */
function _applyReactionSfx(
  host: IOnlineModeHost,
  player: NonNullable<IOnlineModeHost['player']>,
  turnDir: number,
  _wasBoosting: boolean,
  _wasDashing: boolean,
  _wasDrifting: boolean,
  _wasGrinding: boolean,
  _wasGrindTrailOwner: number,
  _wasAirborne: boolean,
): void {
  if (player.dashing && !_wasDashing) { vibrate(VIBE.dash); playDash(); }
  else if (player.boosting && !_wasBoosting) { vibrate(VIBE.boost); playBoost(player.speed / 40); }
  if (player.sputterSFX) playSputter();
  if (player.drifting && !_wasDrifting) playDriftEnter();
  else if (!player.drifting && _wasDrifting) playDriftExit();
  if (turnDir !== 0 && player.speed > 20 && Date.now() - host._lastTurnSwooshTime > 200) {
    host._lastTurnSwooshTime = Date.now();
    playTurnSwoosh();
  }
  // Grind SFX transitions
  if (!_wasGrinding && player.isGrinding) {
    playGrindEnter();
    startGrindLoop();
  } else if (_wasGrinding && !player.isGrinding) {
    stopGrindLoop();
    if (player.grindBailSideValue !== 0) playGrindBail();
    else playGrindExit();
  }
  if (player.isGrinding) {
    updateGrindLoop(player.speed / 40, player.grindBalanceValue, player.dashing);
    if (_wasGrinding && _wasGrindTrailOwner !== player.lastGrindTrailOwner && player.lastGrindTrailOwner >= 0) {
      playGrindHop();
    }
  }
  if (_wasAirborne && player.isRecovery) {
    playGrindLanding();
  }

  // Engine sound
  startVehicleEngine(player.vehicleType);
  updateVehicleEngine(player.speed / 40, player.boosting);
}

/**
 * Proximity spark SFX + trail proximity VFX + slipstream enemy glow.
 */
function _applyProximityVFX(
  host: IOnlineModeHost,
  player: NonNullable<IOnlineModeHost['player']>,
  dt: number,
): void {
  const prox: number = player.proximitySpeedBoost;
  if (prox > 0.1) {
    const slipVol = player.vehicleType === 'bike' ? 0.8 : 1.0;
    startProximitySpark();
    updateProximitySpark(prox, slipVol);
  } else if (prox === 0) {
    stopProximitySpark(0.2);
  } else {
    updateProximitySpark(0);
  }
  updateTrailProximityVFX(player, player.trail, prox * 0.4, dt);
  if (host.opponent) {
    updateTrailProximityVFX(host.opponent, host.opponent.trail, host.opponent.proximitySpeedBoost * 0.4, dt);
  }
  // N-player: update trail VFX for additional remote humans (not already handled as this.opponent)
  for (const ai of host.ais) {
    if (ai.uid && !ai.aiState && ai.player !== host.opponent && ai.player.alive) {
      updateTrailProximityVFX(ai.player, ai.player.trail, ai.player.proximitySpeedBoost * 0.4, dt);
    }
  }
  // Slipstream: enemy trail glow + screen overlay
  if (prox > 0.1) {
    const enemyTrails = _collectEnemyTrails(host.ais, host.opponent, player);
    updateEnemySlipstreamVFX(player, enemyTrails, dt);
  } else {
    clearEnemySlipstreamVFX();
  }
  _updateSlipstreamOverlay(prox);
}

/**
 * Legacy (non-lockstep) AI update + collision + human-vs-AI collision.
 * Only used when host._lockstep is null.
 */
function _updateLegacyAiPath(
  host: IOnlineModeHost,
  player: NonNullable<IOnlineModeHost['player']>,
  allTrails: Trail[],
): void {
  // Legacy (non-lockstep) AI update path:
  host._aiFrame = (host._aiFrame || 0) + 1;
  if (!host.adminGodMode) {
    for (let idx = 0; idx < host.ais.length; idx++) {
      const ai = host.ais[idx];
      if (!ai.aiState || !ai.player.alive) continue; // skip remote opponent (aiState null)
      if (host._aiFrame % 3 === idx % 3) {
        const aiInput: AIInput = getAIInput(ai.player, allTrails, SIM_DT, ai.aiState, player.trail, ai.player.trail);
        ai._lastInput = aiInput;
      }
      const input: AIInput = ai._lastInput || { turn: 0, accelerate: false, dash: false, brake: false };
      ai.player.update(SIM_DT, input.turn, input.accelerate, input.dash, input.brake);
    }
  }

  // ── AI collision detection (deterministic) ──
  if (!host.adminGodMode) {
    const arenaHalf: number = ARENA_SIZE / 2;
    for (let idx = 0; idx < host.ais.length; idx++) {
      const ai = host.ais[idx];
      if (!ai.aiState || !ai.player.alive) continue;
      const wasAlive = ai.player.alive;
      const aip = ai.player.getPosition();
      // Out of bounds
      if (Math.abs(aip.x) >= arenaHalf || Math.abs(aip.z) >= arenaHalf) {
        ai.player.kill();
      }
      // AI vs all trails (human + other AI), skip own trail here
      if (ai.player.alive) {
        for (const trail of allTrails) {
          if (trail === ai.player.trail) continue;
          const pts = trail.points;
          for (let j = 0; j < pts.length - 1; j++) {
            const ax2 = pts[j].x, az2 = pts[j].z, bx = pts[j + 1].x, bz = pts[j + 1].z;
            const dx2 = bx - ax2, dz2 = bz - az2;
            const len2 = dx2 * dx2 + dz2 * dz2;
            if (len2 < 0.001) continue;
            const t2 = Math.max(0, Math.min(1, ((aip.x - ax2) * dx2 + (aip.z - az2) * dz2) / len2));
            const cx = ax2 + t2 * dx2, cz = az2 + t2 * dz2;
            if (Math.hypot(aip.x - cx, aip.z - cz) < 1.2) {
              ai.player.kill();
              break;
            }
          }
          if (!ai.player.alive) break;
        }
      }
      // AI own trail (skip last 10 segments)
      if (ai.player.alive) {
        const ownPts = ai.player.trail.points;
        for (let j = 0; j < ownPts.length - 11; j++) {
          const ax2 = ownPts[j].x, az2 = ownPts[j].z, bx = ownPts[j + 1].x, bz = ownPts[j + 1].z;
          const dx2 = bx - ax2, dz2 = bz - az2;
          const len2 = dx2 * dx2 + dz2 * dz2;
          if (len2 < 0.001) continue;
          const t2 = Math.max(0, Math.min(1, ((aip.x - ax2) * dx2 + (aip.z - az2) * dz2) / len2));
          const cx = ax2 + t2 * dx2, cz = az2 + t2 * dz2;
          if (Math.hypot(aip.x - cx, aip.z - cz) < 1.2) {
            ai.player.kill();
            break;
          }
        }
      }
      // Report AI death to OnlineMatch for round-end tracking
      if (wasAlive && !ai.player.alive && host._onlineMatch) {
        host._onlineMatch.registerAiDeath();
        setTimeout(playExplosion, 0);
      }
    }
  } // end adminGodMode guard (AI collision)

  // ── Human player vs AI trail collision ──
  // Lockstep only checks human-vs-human trails; check AI trails here
  if (player.alive && !host.adminGodMode) {
    _checkHumanVsAiCollision(host, player);
  }
}

/**
 * Human player collision against lobby AI trails + head-on crashes.
 * Triggers killcam + death side-effects.
 */
function _checkHumanVsAiCollision(
  host: IOnlineModeHost,
  player: NonNullable<IOnlineModeHost['player']>,
): void {
  const pp = player.getPosition();
  let hitAiTrail = false;
  for (let idx = 0; idx < host.ais.length; idx++) {
    const ai = host.ais[idx];
    if (!ai.aiState) continue; // skip remote opponent
    const pts = ai.player.trail.points;
    for (let j = 0; j < pts.length - 1; j++) {
      const ax2 = pts[j].x, az2 = pts[j].z, bx = pts[j + 1].x, bz = pts[j + 1].z;
      const dx2 = bx - ax2, dz2 = bz - az2;
      const len2 = dx2 * dx2 + dz2 * dz2;
      if (len2 < 0.001) continue;
      const t2 = Math.max(0, Math.min(1, ((pp.x - ax2) * dx2 + (pp.z - az2) * dz2) / len2));
      const cx = ax2 + t2 * dx2, cz = az2 + t2 * dz2;
      if (Math.hypot(pp.x - cx, pp.z - cz) < 0.8) {
        hitAiTrail = true;
        break;
      }
    }
    if (hitAiTrail) break;
  }
  // Head-on collision with lobby AIs
  if (!hitAiTrail) {
    for (let idx = 0; idx < host.ais.length; idx++) {
      const ai = host.ais[idx];
      if (!ai.aiState || !ai.player.alive) continue;
      const ap = ai.player.getPosition();
      if (Math.hypot(pp.x - ap.x, pp.z - ap.z) < 2.0) {
        hitAiTrail = true;
        ai.player.kill();
        if (host._onlineMatch) host._onlineMatch.registerAiDeath();
        setTimeout(playExplosion, 0);
        break;
      }
    }
  }
  if (hitAiTrail) {
    player.kill();
    if (host._lockstep) host._lockstep.killMyPlayer();
    vibrate(VIBE.death);
    setTimeout(playExplosion, 0);
    setTimeout(stopProximitySpark, 0);
    clearEnemySlipstreamVFX();
    _clearSlipstreamOverlay();
    setTimeout(stopVehicleEngine, 0);
    if (host._onlineMatch) {
      Promise.resolve().then(() => host._onlineMatch!.reportLocalDeath(host._onlineMatch!.myUid));
    }

    // Enter killcam → spectate remaining AIs
    const aliveAIs = host.ais.filter(a => a.player.alive && a.aiState).length;
    if (!host._killcamPos) host._killcamPos = new THREE.Vector3();
    if (!host._killcamStartCamPos) host._killcamStartCamPos = new THREE.Vector3();
    const dp = player.mesh.position;
    host._killcamPos.set(dp.x, 0.7, dp.z);
    host._killcamActive = true;
    host._killcamTimer = 0;
    host._killcamDelayTimer = 0;
    host._killcamPhase = 'slowmo';
    host._killcamStartCamPos.copy(host.camera.position);
    host.state = 'gameover';
    if (aliveAIs >= 2) {
      host._spectating = true;
    }
    requestAnimationFrame(() => {
      document.getElementById('meter-wrap')!.classList.add('menu-hidden');
      document.getElementById('flow-hud')?.classList.add('menu-hidden');
      document.getElementById('radar')!.classList.add('hidden');
    });
  }
}
