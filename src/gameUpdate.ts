// ── game.ts update() phase helpers ──
// Extracted from Game class methods _updateStandardMode, _updateOpponentSpatialAudio,
// and _updateGameover so game.ts stays under its file-size budget. Behaviour is
// unchanged — these are top-level functions that take the Game instance and
// mutate its state exactly like the original private methods. TASK-237.

import * as THREE from 'three';

import { clearEmissiveMapCache } from './carModel';
import { GrindAlertOverlay } from './ui/grindAlertOverlay';
import { destroyAllOpponents } from './spatialAudio';
import { resetPassByCooldowns } from './opponentPassBy';
import { stopVehicleEngine } from './vehicleAudioEngine';
import { getBands, isPlaying, setMusicDampen } from './audio';
import { setSfxDampen } from './sfxContext';
import { hideStreakDisplay, hideStreakEndInfo } from './ui/streakUI';
import { grid } from './spatialGrid';
import { clearEnemySlipstreamVFX } from './core/collisionSystem';
import { getLineAssistEnabled } from './ui/settingsUI';
import { getGamepadState } from './gamepad';
import { logLocal } from './localDiagnostics';
import { isAccelerate, isBrake, isDash, isDriftBrake, isLeft, isRight, isSpecial } from './input';
import { updateCamera, createCameraState, seedCameraState } from './scene';
import { ARENA_SIZE, getArenaReactive, isArenaChild, setSpectatorTargets, updateArenaAudio, updateWallGlow } from './grid';
import { updateAtmosphere } from './atmosphere';
import { getGfx } from './graphics';
import { FireworksSystem } from './fireworks/fireworksSystem';
import { setTouchDrifting } from './touch';
import { TOUCH_ENABLED } from './input';
import { getAIInput } from './ai';
import { vibrate, VIBE } from './vibrate';
import { applyWallRepulsion, updateEnemySlipstreamVFX, updateProximitySpeed, updateTrailProximityVFX } from './core/collisionSystem';
import {
  getCtx, playBoost, playDash, playGrindBail, playGrindEnter,
  playGrindExit, playGrindHop, playGrindLanding, playSputter, playTurnSwoosh,
  playTrailGrindedAlert, startGrindLoop, startProximitySpark, stopGrindLoop,
  stopProximitySpark, updateGrindLoop, updateProximitySpark,
} from './sfx';
import { playDriftEnter, playDriftExit, stopNearMiss } from './sfxAssets';
import { startVehicleEngine, updateVehicleEngine } from './vehicleAudioEngine';
import {
  playOpponentSound, SoundRange,
  startOpponentGrindLoop, stopOpponentGrindLoop, updateOpponentGrindLoop,
  playOpponentGrindEnter, playOpponentGrindBail,
  updateOpponentEngine, updateOpponentPosition, updateListener,
} from './spatialAudio';
import { getSfxVolume } from './sfxContext';
import { getVehicleAudioProfile } from './vehicleAudioProfiles';
import { shouldTriggerPassBy, selectPassByVariant } from './opponentPassBy';
import { getVehicleBuffer } from './vehicleSfxLoader';
import { buildLocalSimContext } from './core/simContext';
import { STREAK_MILESTONES, type SimState, type TrailPoint, type PlayerSim } from './core/simulation';
import type { AIInput, ColorEntry, ColorMap, FreeCamInput } from './types/index';
import type { Player } from './player';
import type { Trail } from './trail';
import type { Game } from './game';

export function updateStandardMode(
  game: Game,
  dt: number,
  turnDir: number,
  allTrails: Trail[],
): void {
  // ── Standard mode (state-sync online or local) ──
  // Course correction assist before update
  if (getLineAssistEnabled()) {
    game.player!.courseCorrect(allTrails, game.player!.trail);
  }
  const _wasBoosting = game.player!.boosting;
  const _wasDashing = game.player!.dashing;
  const _wasDrifting: boolean = game.player!.drifting;
  const _wasFumes: boolean = game.player!.fumes;
  const _wasGrinding: boolean = game.player!.isGrinding;
  const _wasGrindTrailOwner: number = game.player!.lastGrindTrailOwner;
  const _wasAirborne: boolean = game.player!.isAirborne;
  const _wasStreakCount: number = game.player!.grindStreakCount;

  // ── Build SimContext for single-player grind (hoverboard wiring) ──
  // Human is index 0, AIs start at index 1. The sim and trail arrays
  // reference each player's persistent data (not cloned) so advancePlayer's
  // shallow-copy-then-writeback model keeps state in sync.
  game._localTick++;
  const simPlayers: PlayerSim[] = [game.player!.sim];
  const simTrailArrays: TrailPoint[][] = [game.player!.trail.points];
  for (const ai of game.ais) {
    simPlayers.push(ai.player.sim);
    simTrailArrays.push(ai.player.trail.points);
  }
  const simContext: SimState = buildLocalSimContext(game._localTick, simPlayers, simTrailArrays);

  // Shift = dash (meter burst), Space = brake (triggers drift for Slingshot), W = accelerate
  game.player!.update(dt, turnDir, isAccelerate(), isDash(), isBrake(), isDriftBrake(), isSpecial(), simContext, 0, game.camera);
  if (game.player!.dashing && !_wasDashing) { vibrate(VIBE.dash); playDash(); }
  else if (game.player!.boosting && !_wasBoosting) { vibrate(VIBE.boost); playBoost(game.player!.speed / 40); }
  if (_wasFumes && !game.player!.fumes) playSputter();
  if (game.player!.drifting && !_wasDrifting) playDriftEnter();
  else if (!game.player!.drifting && _wasDrifting) playDriftExit();
  if (turnDir !== 0 && game.player!.speed > 20 && Date.now() - game._lastTurnSwooshTime > 200) {
    game._lastTurnSwooshTime = Date.now();
    playTurnSwoosh();
  }
  // Grind SFX transitions
  if (!_wasGrinding && game.player!.isGrinding) {
    playGrindEnter();
    startGrindLoop();
  } else if (_wasGrinding && !game.player!.isGrinding) {
    stopGrindLoop();
    if (game.player!.grindBailSideValue !== 0) playGrindBail();
    else playGrindExit();
  }
  if (game.player!.isGrinding) {
    updateGrindLoop(game.player!.speed / 40, game.player!.grindBalanceValue, game.player!.dashing);
    if (_wasGrinding && _wasGrindTrailOwner !== game.player!.lastGrindTrailOwner && game.player!.lastGrindTrailOwner >= 0) {
      playGrindHop();
    }
  }
  if (_wasAirborne && game.player!.isRecovery) {
    playGrindLanding();
  }

  // Grind streak milestone detection — trigger combo HUD animation
  const newStreak = game.player!.grindStreakCount;
  if (newStreak > _wasStreakCount) {
    for (let mi = 0; mi < STREAK_MILESTONES.length; mi++) {
      const [threshold, bonus] = STREAK_MILESTONES[mi];
      if (newStreak >= threshold && _wasStreakCount < threshold) {
        game.player!.triggerStreakMilestone(bonus);
        break;
      }
    }
  }

  // Screen-edge flash when an opponent grinds local player's trail
  if (game._grindAlertCooldown > 0) game._grindAlertCooldown -= dt;
  for (const ai of game.ais) {
    if (ai.player.isGrinding && ai.player.lastGrindTrailOwner === 0 && game._grindAlertCooldown <= 0) {
      game._grindAlertOverlay.flash(game.player!.colorHex, 0.5);
      playTrailGrindedAlert();
      game._grindAlertCooldown = 3;
      break;
    }
  }
  game._grindAlertOverlay.update(dt);

  // Continuous engine sound
  startVehicleEngine(game.player!.vehicleType);
  const speedFactor: number = game.player!.speed / 40;
  updateVehicleEngine(speedFactor, game.player!.boosting);

  if (game.mode === 'online' && game._onlineMatch) {
    game._onlineMode.updateOnlineSync(dt, allTrails);
  } else {
    // ── Local: Update all AIs (staggered — each AI computes every 3rd frame) ──
    if (!game.adminGodMode) {
      game._aiFrame = (game._aiFrame || 0) + 1;
      for (let idx = 0; idx < game.ais.length; idx++) {
        const ai = game.ais[idx];
        if (ai.player.alive) {
          if (game._aiFrame % 3 === idx % 3) {
            const aiInput: AIInput = getAIInput(ai.player, allTrails, dt, ai.aiState!, game.player!.trail, ai.player.trail);
            ai._lastInput = aiInput;
          }
          const input: AIInput = ai._lastInput || { turn: 0, accelerate: false, dash: false, brake: false };
          ai.player.update(
            dt,
            input.turn,
            input.accelerate,
            input.dash,
            input.brake,
            /* driftBrake */ false,
            input.special ?? false,
            simContext,
            idx + 1, // human is index 0, AIs start at 1
          );
        }
      }
    }
  }

  // Recharge meters — player recharges from all enemy trails, AIs from all other trails
  for (const ai of game.ais) {
    game.player!.rechargeMeter(ai.player.trail, dt);
    ai.player.rechargeMeter(game.player!.trail, dt);
  }
  // Arena wall recharge + glow — same mechanic as enemy trails
  const half: number = ARENA_SIZE / 2;
  let nearestWallDist: number = Infinity;
  const allPlayers: Player[] = game._scratchPlayers;
  allPlayers.length = 0;
  allPlayers.push(game.player!);
  for (const ai of game.ais) allPlayers.push(ai.player);
  for (const p of allPlayers) {
    if (!p.alive) continue;
    const pos = p.getPosition();
    const wallDist: number = Math.min(half - Math.abs(pos.x), half - Math.abs(pos.z));
    if (wallDist < nearestWallDist) nearestWallDist = wallDist;
    if (wallDist < 8 && !p.dashing) {
      const factor: number = 1 - wallDist / 8;
      p.meter = Math.min(100, p.meter + 104 * factor * dt);
      p.meterGaining = true;
    }
  }
  updateWallGlow(nearestWallDist);

  // Proximity speed boost
  updateProximitySpeed(game.player!);
  for (const ai of game.ais) {
    updateProximitySpeed(ai.player);
  }

  // Wall repulsion (skip remote opponent — their position comes from the network)
  applyWallRepulsion(game.player!, dt, game.mode);
  if (game.mode !== 'online') {
    for (const ai of game.ais) {
      applyWallRepulsion(ai.player, dt, game.mode);
    }
  }

  // ── Grind fade-dissolve (local/offline mode) ──
  // Process _grindDestroyQueue from each player's last update() call and
  // immediately trigger the visual fade (no rollback concern in local mode).
  if (game.mode !== 'online') {
    for (const p of allPlayers) {
      if (p.pendingGrindDestroys.length > 0) {
        // Resolve target trail owner — use lastGrindTrailOwner if valid
        const ownerIdx = p.lastGrindTrailOwner;
        const targetPlayer = ownerIdx >= 0 && ownerIdx < allPlayers.length
          ? allPlayers[ownerIdx]
          : p;
        for (const segIdx of p.pendingGrindDestroys) {
          targetPlayer.trail.fadeSegment(segIdx);
        }
      }
    }
  }
}

export function updateOpponentSpatialAudio(game: Game): void {
  // ── Opponent spatial audio ──────────────────────────────
  updateListener(game.camera);

  for (let idx = 0; idx < game.ais.length; idx++) {
    const ai = game.ais[idx];
    const oppId = ai.uid || `ai-${idx}`;
    if (!ai.player.alive) continue;

    const pos = ai.player.getPosition();
    updateOpponentPosition(oppId, pos.x, pos.z);
    updateOpponentEngine(oppId, ai.player.speed / 40);

    // Pass-by detection — radial velocity relative to player
    if (game.player) {
      const pp = game.player.getPosition();
      const dx = pos.x - pp.x;
      const dz = pos.z - pp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // Radial velocity: project opponent velocity onto the listener→opponent axis
      const vx = ai.player.speed * Math.sin(ai.player.angle);
      const vz = ai.player.speed * Math.cos(ai.player.angle);
      const radialV = dist > 0.01 ? (dx * vx + dz * vz) / dist : 0;
      const prevRV = ai._prevRadialV ?? radialV;
      const profile = getVehicleAudioProfile(ai.player.vehicleType);
      if (profile.passByConfig) {
        const ctx = getCtx();
        if (shouldTriggerPassBy(oppId, prevRV, radialV, dist, profile.passByConfig, ctx.currentTime)) {
          const sampleKey = selectPassByVariant(profile.passByConfig, ai.player.speed / 40);
          const passByBuf = getVehicleBuffer(ai.player.vehicleType, sampleKey);
          if (passByBuf) {
            playOpponentSound(oppId, SoundRange.MEDIUM, d => {
              const c = getCtx();
              const src = c.createBufferSource();
              src.buffer = passByBuf;
              const g = c.createGain();
              g.gain.value = 0.7 * getSfxVolume();
              src.connect(g);
              g.connect(d);
              src.start();
            });
          }
        }
      }
      ai._prevRadialV = radialV;
    }

    // State transitions → spatial one-shot sounds
    if (ai.player.boosting && !ai._wasBoosting)
      playOpponentSound(oppId, SoundRange.MEDIUM, d => playBoost(ai.player.speed / 40, d));
    if (ai.player.dashing && !ai._wasDashing)
      playOpponentSound(oppId, SoundRange.MEDIUM, d => playDash(d));
    if (ai.player.drifting && !ai._wasDrifting)
      playOpponentSound(oppId, SoundRange.MEDIUM, d => playDriftEnter(d));
    if (!ai.player.drifting && ai._wasDrifting)
      playOpponentSound(oppId, SoundRange.MEDIUM, d => playDriftExit(d));
    if (ai._wasFumes && !ai.player.fumes)
      playOpponentSound(oppId, SoundRange.SHORT, d => playSputter(d));
    // Grind transitions → spatial grind audio
    if (!ai._wasGrinding && ai.player.isGrinding) {
      playOpponentGrindEnter(oppId);
      startOpponentGrindLoop(oppId);
    } else if (ai._wasGrinding && !ai.player.isGrinding) {
      stopOpponentGrindLoop(oppId);
      if (ai.player.grindBailSideValue !== 0) playOpponentGrindBail(oppId);
    }
    if (ai.player.isGrinding) {
      updateOpponentGrindLoop(oppId, ai.player.speed / 40, ai.player.grindBalanceValue, ai.player.dashing);
    }
    // Turn swoosh — throttled per AI (same 200ms cooldown as local player)
    if (ai.player.speed > 20 && ai.player.angle !== ai._prevAngle) {
      const now = Date.now();
      if (!ai._lastSwooshTime || now - ai._lastSwooshTime > 200) {
        ai._lastSwooshTime = now;
        playOpponentSound(oppId, SoundRange.SHORT, d => playTurnSwoosh(d));
      }
    }
    ai._prevAngle = ai.player.angle;

    ai._wasBoosting = ai.player.boosting;
    ai._wasDashing = ai.player.dashing;
    ai._wasDrifting = ai.player.drifting;
    ai._wasFumes = ai.player.fumes;
    ai._wasGrinding = ai.player.isGrinding;
  }
}

export function updateGameover(game: Game, dt: number): void {
  game.gameOverTimer += dt;
  // Killcam: slow-mo phase then orbit around death point
  if (game._killcamActive && game._killcamPos) {
    if (!game._killcamScratch) game._killcamScratch = new THREE.Vector3();
    if (game._killcamPhase === 'slowmo') {
      // Slow-mo: advance real time but slow game time to ~20%
      game._killcamDelayTimer += dt;
      const slowDt: number = dt * 0.2;
      // Keep updating death animations at reduced speed
      if (game.player && !game.player.alive) game.player.updateDeath(slowDt);
      for (const ai of game.ais) {
        if (ai.player && !ai.player.alive) ai.player.updateDeath(slowDt);
      }
      // Drift camera toward death point — dt-based for frame-rate independence
      const progress: number = Math.min(game._killcamDelayTimer / game._killcamDelay, 1);
      const smoothT: number = progress * progress * (3 - 2 * progress); // smoothstep
      // Drift harder when camera is far from target (e.g. multiplayer win — camera
      // is behind player but target is opponent's death spot across the arena)
      const camToTarget: number = game.camera.position.distanceTo(game._killcamPos);
      const driftFactor: number = camToTarget > 30 ? 0.45 : 0.12;
      game._killcamScratch.copy(game._killcamStartCamPos!).lerp(game._killcamPos, smoothT * driftFactor);
      game.camera.position.lerp(game._killcamScratch, 1 - Math.pow(0.02, dt));
      game.camera.lookAt(game._killcamPos);
      if (game._killcamDelayTimer >= game._killcamDelay) {
        game._killcamPhase = 'orbit';
        game._killcamTimer = 0;
        game._killcamStartCamPos!.copy(game.camera.position);
      }
    } else {
      // Orbit phase — direct position set (no lerp chasing a moving target)
      // Keep death animations running so particles don't freeze mid-scatter
      if (game.player && !game.player.alive) game.player.updateDeath(dt);
      for (const ai of game.ais) {
        if (ai.player && !ai.player.alive) ai.player.updateDeath(dt);
      }
      game._killcamTimer += dt;
      const t: number = Math.min(game._killcamTimer / game._killcamDuration, 1);
      const ease: number = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const orbitAngle: number = game._killcamTimer * 0.864;
      const orbitDist: number = 9 - ease * 2.56;
      const orbitHeight: number = 7 - ease * 1.28;
      const targetX: number = game._killcamPos.x + Math.cos(orbitAngle) * orbitDist;
      const targetZ: number = game._killcamPos.z + Math.sin(orbitAngle) * orbitDist;
      const targetY: number = game._killcamPos.y + orbitHeight;
      game._killcamScratch.set(targetX, targetY, targetZ);
      // Blend from start position to orbit path, then follow directly
      const blend: number = Math.min(game._killcamTimer * 2.0, 1); // 0.5s transition
      game.camera.position.lerp(game._killcamScratch, 1 - Math.pow(1 - blend, dt * 60));
      game.camera.lookAt(game._killcamPos);
      if (game._streakCeremony && game._streakCeremony.phase !== 'done') {
        game._updateStreakCeremony(dt);
      }
      if (game._streakIncrementAnim && game._streakIncrementAnim.phase !== 'done') {
        game._updateStreakIncrement(dt);
      }
      if (game._killcamTimer >= game._killcamDuration) {
        // Online mode: wait for server confirmation before showing results
        if (game.mode === 'online' && !game._killcamData && !game._spectating) {
          // Keep orbiting — _killcamData will be set when roundOver fires
          game._killcamTimer = game._killcamDuration * 0.8; // loop back to keep orbiting
        } else if (game._spectating && !game._killcamData) {
          // Transition to spectator action camera
          game._killcamPhase = 'spectating';
          game._killcamActive = false;
          game._spectateTarget = game._spectatorMode.pickTarget();
          game._spectateCamState = createCameraState();
          game._spectateRetargetTimer = 0;
          if (game._spectateTarget) {
            seedCameraState(game.camera, game._spectateTarget.mesh.position, game._spectateCamState);
          }
          const label = document.getElementById('spectator-label');
          if (label) label.classList.remove('hidden');
        } else if (game._killcamData) {
          game._showResultScreen();
        }
      }
    }
  }

  // Spectator mode: AIs keep fighting, camera follows action
  if (game._spectating && game._killcamPhase === 'spectating') {
    game._spectatorMode.updateSim(dt);

    // Follow spectate target
    if (game.adminFreecam) {
      game._updateAdminFreecam(dt);
    } else if (game._spectateTarget && game._spectateTarget.alive) {
      const _gp = getGamepadState();
      updateCamera(game.camera, game._spectateTarget, dt, game._spectateCamState!, _gp?.rightStickX || 0, _gp?.rightStickY || 0);
    } else {
      // Target died — pick a new one
      game._spectateTarget = game._spectatorMode.pickTarget();
      if (game._spectateTarget) {
        seedCameraState(game.camera, game._spectateTarget.mesh.position, game._spectateCamState!);
      }
    }

    // Re-evaluate target every 4s for more dynamic viewing.
    // Hysteresis: only switch if the new target is a different AI — the
    // pickTarget heuristic already picks the "most exciting" one, but rapid
    // flipping between equally-close AIs caused visible camera snaps.
    // Reseeding the camera state on switch gives the rig a clean starting
    // point so the damping doesn't fight a stale heading vector.
    game._spectateRetargetTimer += dt;
    if (game._spectateRetargetTimer >= 4.0 && game._spectateTarget) {
      game._spectateRetargetTimer = 0;
      const better = game._spectatorMode.pickTarget();
      if (better && better !== game._spectateTarget) {
        game._spectateTarget = better;
        seedCameraState(game.camera, better.mesh.position, game._spectateCamState!);
      }
    }

    // Check if match truly ended
    const aliveAIs = game.ais.filter(ai => ai.player.alive).length;
    if (aliveAIs <= 1) {
      game._spectatorMode.endSpectating();
    }
  }

  // Victory fireworks — system runs autonomously once started
  const reactive = getArenaReactive();
  if (reactive) {
    if (game._victoryFireworks && !reactive.fireworks) {
      const system = new FireworksSystem();
      system.start(game.scene, game.camera);
      reactive.fireworks = system;
    } else if (!game._victoryFireworks && reactive.fireworks) {
      reactive.fireworks.dispose();
      reactive.fireworks = null;
    }
  }
  // Background replay on victory screen
  if (game._replayMode._bgReplayActive) {
    game._updateBgReplay(dt);
  }
}

// Input utility re-exports kept so game.ts can import through this module if it wants to.
export { isLeft, isRight };

// ── Game cleanup (extracted from Game.cleanup) ─────────────
export function cleanupGame(game: Game): void {
  game._teardownOnline();
  destroyAllOpponents();
  game._grindAlertOverlay.dispose();
  game._grindAlertOverlay = new GrindAlertOverlay();
  game._grindAlertCooldown = 0;
  grid.clear();
  if (game.player) game.player.destroy();
  for (const ai of game.ais) ai.player.destroy();
  game.player = null;
  game.ais = [];
  clearEmissiveMapCache();
  // Collect direct scene children that are NOT arena objects (players, trails,
  // VFX, etc.) — these are the only objects that should be removed and disposed.
  // IMPORTANT: Do NOT use scene.traverse() here. It recurses into arena child
  // subtrees (e.g. synth_city_root's 1000+ procgen buildings) and disposeChunk
  // would destroy their shared geometry/materials/textures, corrupting the GPU
  // state for the entire arena and tanking FPS from 120→20.
  const toRemove: THREE.Object3D[] = [];
  for (const child of [...game.scene.children]) {
    if (child === (game.camera as THREE.Object3D)) continue;
    if (isArenaChild(child)) continue;
    // Base lights (created once in scene.ts) must survive all cleanups.
    // On the first cleanup _arenaSceneChildren is empty so isArenaChild
    // won't protect them; after the first createArena they're captured in
    // the snapshot and protected automatically.
    if (child.name && child.name.startsWith('luminal_base_')) continue;
    toRemove.push(child);
    game.scene.remove(child);
  }
  const CHUNK = 20;
  let idx = 0;
  const disposeChunk = (): void => {
    const end = Math.min(idx + CHUNK, toRemove.length);
    for (; idx < end; idx++) {
      const obj = toRemove[idx];
      // Recursively dispose the removed subtree
      obj.traverse((descendant: THREE.Object3D) => {
        const mesh = descendant as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const mats: THREE.Material[] = Array.isArray(mesh.material)
            ? mesh.material as THREE.Material[]
            : [mesh.material as THREE.Material];
          for (const m of mats) {
            const std = m as THREE.MeshStandardMaterial;
            std.map?.dispose();
            std.emissiveMap?.dispose();
            std.normalMap?.dispose();
            std.roughnessMap?.dispose();
            m.dispose();
          }
        }
      });
    }
    if (idx < toRemove.length) requestAnimationFrame(disposeChunk);
  };
  if (toRemove.length > 0) requestAnimationFrame(disposeChunk);
}

// Retrieves the killcam streak overlay element — kept local to this module so
// returnToMenu() can clear the .visible class during menu return.
function getKillcamStreakOverlay(): HTMLElement | null {
  return document.getElementById('killcam-streak-overlay');
}

// ── Return-to-menu flow (extracted from Game.returnToMenu) ──
export function returnToMenu(game: Game): void {
  if (game._fading) return;
  game._fading = true;
  game._seriesReplayIds = [];
  stopProximitySpark();
  stopGrindLoop();
  stopNearMiss();
  clearEnemySlipstreamVFX();
  clearSlipstreamOverlayHere();
  stopVehicleEngine();
  destroyAllOpponents();
  resetPassByCooldowns();

  // Fade HUD out smoothly
  document.getElementById('pause-overlay')!.classList.add('hidden');
  document.getElementById('countdown')!.classList.add('hidden');
  document.getElementById('radar')!.classList.add('hidden');
  document.getElementById('series-score')!.classList.add('hidden');
  document.getElementById('series-result')!.classList.add('hidden');
  document.getElementById('meter-wrap')!.classList.add('menu-hidden');
  document.getElementById('flow-hud')?.classList.add('menu-hidden');
  document.getElementById('connecting-spinner')!.classList.add('hidden');
  hideStreakDisplay();
  document.getElementById('result-streak')?.classList.add('hidden');
  document.getElementById('result-streak-ended')?.classList.add('hidden');
  hideStreakEndInfo();

  // Fade to black, rebuild scene behind it, then reveal
  game._sceneFade(true, 'RETURNING TO MENU').then(async () => {
    const holdDone = new Promise<void>(r => setTimeout(r, 600));
    game.stopBgReplay(); // destroy ghosts behind black screen to avoid stutter
    game.cleanup();
    game.state = 'menu';
    setMusicDampen(false); setSfxDampen(false);
    game._streakCeremony = null;
    game._streakIncrementAnim = null;
    const streakOverlay = getKillcamStreakOverlay();
    if (streakOverlay) streakOverlay.classList.remove('visible');
    game.seriesPlayerWins = 0;
    game.seriesAiWins = [];
    game.seriesOver = false;
    game._lobbyOrigin = null;
    game._victoryFireworks = false;
    game._spectating = false;
    game._spectateTarget = null;
    game._spectateCamState = null;
    const sl = document.getElementById('spectator-label');
    if (sl) sl.classList.add('hidden');
    if (!game._skipMenuScreen) {
      if (window.showScreen) window.showScreen('main');
      else {
        document.getElementById('result')!.classList.add('hidden');
        document.getElementById('replay-overlay')!.classList.add('hidden');
        document.getElementById('overlay')!.classList.remove('hidden');
      }
    }
    game._skipMenuScreen = false;
    document.getElementById('bottom-bar')!.classList.remove('hidden');
    game._destroyGhosts();
    game._replayMode._replayGhosts = [];
    game._replayPlayer.playing = false;
    game._updateStreak();
    game._startMatchPreviewDemo();

    game._fading = false;
    await holdDone;
    game._sceneFade(false);
  });
}

// Local copy of clearSlipstreamOverlay so returnToMenu doesn't have to import
// the private module-level helper from game.ts.
function clearSlipstreamOverlayHere(): void {
  const el: HTMLElement | null = document.getElementById('slipstream-overlay');
  if (!el) return;
  el.classList.remove('slipstream--active');
  el.style.setProperty('--slip-alpha', '0');
  el.style.setProperty('--slip-chroma', '0');
  el.style.setProperty('--slip-offset', '0');
  document.body.classList.remove('slipstream-phase-entry', 'slipstream-phase-lockin', 'slipstream-phase-active');
}

// ── Audio reactivity + bloom (extracted from Game._updateAudioReactivity) ──
const SILENT_BANDS = { bass: 0, lowMid: 0, mid: 0, upperMid: 0, presence: 0, brilliance: 0, high: 0, air: 0, energy: 0, kick: 0 };

export function updateAudioReactivity(game: Game, dt: number): void {
  // Audio reactivity — palette cycling runs even without music
  const reactive = getArenaReactive();
  if (isPlaying()) {
    const bands = getBands();
    game._lastBands = bands;
    updateArenaAudio(bands, dt, game.state);
    // Atmosphere: fog density, mist animation, beam volumes
    if (reactive?.atmosphere) {
      updateAtmosphere(reactive.atmosphere, dt, bands, getGfx(), game.state);
    }
    if (game.bloomPass && !game.adminBloomFreeze) {
      const proxGlow: number = (game.player && game.player.alive) ? game.player.proximitySpeedBoost * 0.13 : 0;
      const bloomRadius: number = game._cachedBloomRadius;
      const bloomThreshold: number = game._cachedBloomThreshold;
      const bloomScale: number = 1 / (1 + (game.ais.length - 1) * 0.25);
      game.bloomPass.strength = (game.baseBloomStrength + bands.kick * 0.35 + proxGlow * 0.6) * bloomScale;
      game.bloomPass.radius = (bloomRadius + proxGlow * 0.05) * bloomScale;
      game.bloomPass.threshold = Math.max(0.18, bloomThreshold - proxGlow * 0.06);
    }
    // EQ bars on menu/gameover
    if (game.state === 'menu' || game.state === 'gameover') {
      const bars: number[] = [bands.bass, bands.lowMid, bands.mid, bands.upperMid, bands.presence];
      for (let i = 0; i < 5; i++) {
        if (game._eqBars[i]) game._eqBars[i]!.style.height = (3 + bars[i] * 11) + 'px';
      }
    }
  } else {
    updateArenaAudio(SILENT_BANDS, dt, game.state);
    // Still advance atmosphere time when no audio (mist drifts, fog persists)
    if (reactive?.atmosphere) {
      updateAtmosphere(reactive.atmosphere, dt, SILENT_BANDS, getGfx(), game.state);
    }
  }
}

// ── Slipstream DOM overlay driver ──
// Module-local mirror of the same helper in game.ts; kept here so extracted
// functions can update slipstream UI without re-importing game module state.
let _slipOverlay: HTMLElement | null = null;
function updateSlipstreamOverlay(prox: number): void {
  if (!_slipOverlay) _slipOverlay = document.getElementById('slipstream-overlay');
  if (!_slipOverlay) return;
  if (prox > 0.1) {
    _slipOverlay.classList.add('slipstream--active');
    _slipOverlay.style.setProperty('--slip-alpha', (prox * 0.15).toFixed(3));
    _slipOverlay.style.setProperty('--slip-chroma', Math.min(1, prox * 1.2).toFixed(2));
    _slipOverlay.style.setProperty('--slip-offset', (prox * 3).toFixed(1));
  } else if (prox < 0.05) {
    _slipOverlay.classList.remove('slipstream--active');
  }
}

function collectEnemyTrailsLocal(ais: { player: Player }[], self: Player): Trail[] {
  const trails: Trail[] = [];
  for (const ai of ais) {
    if (ai.player !== self && ai.player.alive) trails.push(ai.player.trail);
  }
  return trails;
}

// ── Proximity spark + slipstream VFX (extracted from Game._updateProximityAndSlipstream) ──
export function updateProximityAndSlipstream(game: Game, dt: number): void {
  // Proximity spark sound + trail VFX (player only for sound)
  // Guard: only run when player is alive — prevents restarting after death/killcam
  const prox: number = game.player!.alive ? game.player!.proximitySpeedBoost : 0;
  if (prox > 0.1) {
    const slipVol = game.player!.vehicleType === 'bike' ? 0.8 : 1.0;
    startProximitySpark();
    updateProximitySpark(prox, slipVol);
  } else if (prox === 0) {
    // Fully decayed — tear down nodes entirely
    stopProximitySpark(0.2);
  } else {
    // Ramping down but not zero — zero the volume, keep nodes alive to avoid restart oscillation
    updateProximitySpark(0);
  }

  // Trail proximity VFX — each player's own trail lights up when they get boost
  updateTrailProximityVFX(game.player!, game.player!.trail, prox * 0.4, dt);
  for (const ai of game.ais) {
    const aiProx: number = ai.player.proximitySpeedBoost;
    updateTrailProximityVFX(ai.player, ai.player.trail, aiProx * 0.4, dt);
  }
  // Slipstream: enemy trail glow + screen overlay
  if (prox > 0.1) {
    const enemyTrails = collectEnemyTrailsLocal(game.ais, game.player!);
    updateEnemySlipstreamVFX(game.player!, enemyTrails, dt);
  } else {
    clearEnemySlipstreamVFX();
  }
  // SPEC-93: For bikes, overlay is driven by phase system in game.ts
  if (game.player!.vehicleType !== 'bike') {
    updateSlipstreamOverlay(prox);
  }
}

// ── Main playing-state update (extracted from Game._updatePlaying) ──
export function updatePlaying(game: Game, dt: number): void {
  // Collect all trails for collision/raycast (reuse array to avoid per-frame allocation)
  const allTrails: Trail[] = game._scratchTrails;
  allTrails.length = 0;
  allTrails.push(game.player!.trail);
  for (const ai of game.ais) allTrails.push(ai.player.trail);

  let turnDir = 0;
  if (isLeft()) turnDir = 1;
  if (isRight()) turnDir = -1;

  if (game._lockstep && game._lockstep.started) {
    game._onlineMode.updateLockstepTick(dt, turnDir, allTrails);
  } else {
    updateStandardMode(game, dt, turnDir, allTrails);
  }

  // ── Tick fading trail segments (non-lockstep path only) ──
  // In lockstep mode this is handled inside updateLockstepTick via _tickAllFadingSegments.
  if (!(game._lockstep && game._lockstep.started)) {
    const fadePlayers: Player[] = game._scratchPlayers;
    // _scratchPlayers is populated inside the else-block above; rebuild here when empty.
    if (fadePlayers.length === 0 && game.player) {
      fadePlayers.push(game.player);
      for (const ai of game.ais) fadePlayers.push(ai.player);
    }
    for (const p of fadePlayers) {
      const completed = p.trail.tickFadingSegments(dt);
      for (const idx of completed) {
        p.trail.markSegmentDestroyed(idx);
        grid.removeSegment(p.trail, idx);
      }
    }
  }

  // Feed drift state to touch overlay for visual feedback
  if (TOUCH_ENABLED) setTouchDrifting(!!game.player!.drifting);

  updateProximityAndSlipstream(game, dt);
  updateOpponentSpatialAudio(game);

  // Spectator camera targets
  const targets: ({ x: number; z: number } | null)[] = [game.player!.alive ? game.player!.getPosition() : null];
  for (const ai of game.ais) {
    targets.push(ai.player.alive ? ai.player.getPosition() : null);
  }
  setSpectatorTargets(targets);

  // Match timer — only touch DOM when display seconds change
  game.matchTime += dt;
  const totalSecs: number = Math.floor(game.matchTime);
  if (totalSecs !== game._lastTimerSecs) {
    game._lastTimerSecs = totalSecs;
    const mins: number = Math.floor(totalSecs / 60);
    const sec: number = totalSecs % 60;
    game._elMatchTimer.textContent = `${mins}:${sec.toString().padStart(2, '0')}`;
  }

  // Radar
  if (game.radarEnabled) {
    game._drawRadar();
    // DEBUG: log radar DOM state once per second during playing
    const _now = performance.now();
    if (!(game as unknown as { _radarDebugLastLog?: number })._radarDebugLastLog || _now - (game as unknown as { _radarDebugLastLog: number })._radarDebugLastLog > 1000) {
      (game as unknown as { _radarDebugLastLog: number })._radarDebugLastLog = _now;
      const _re = document.getElementById('radar');
      if (_re) {
        const _cs = getComputedStyle(_re);
        logLocal('[RADAR-DEBUG] playing tick: className=', _re.className, 'visibility=', _cs.visibility, 'opacity=', _cs.opacity, 'display=', _cs.display, 'radarEnabled=', game.radarEnabled);
      }
    }
  }

  // Record replay data
  game._replayRecorder.record(dt, game.player!, game.ais, game.matchTime);

  // In lockstep mode, collisions are handled by the deterministic sim
  // (lobby AI collisions are handled inline in the lockstep branch above)
  if (!game._lockstep || !game._lockstep.started) {
    game._checkCollisions();
  }
  game._updateHUD();
}

// ── Admin freecam update (extracted from Game._updateAdminFreecam) ──
export function updateAdminFreecam(game: Game, dt: number): void {
  const cam = game.camera;
  const input: FreeCamInput = game.adminFreecamInput || {};
  const speed = input.fast ? 80 : 30;

  const cosP = Math.cos(game._freeCamPitch);
  const sinP = Math.sin(game._freeCamPitch);
  const sinY = Math.sin(game._freeCamYaw);
  const cosY = Math.cos(game._freeCamYaw);
  const fwdX = sinY * cosP, fwdY = -sinP, fwdZ = cosY * cosP;
  const rightX = -cosY, rightZ = sinY;

  const tgtX = ((input.forward ? fwdX : 0) + (input.backward ? -fwdX : 0)
    + (input.right ? rightX : 0) + (input.left ? -rightX : 0)) * speed;
  const tgtY = ((input.forward ? fwdY : 0) + (input.backward ? -fwdY : 0)
    + (input.up ? speed : 0) + (input.down ? -speed : 0));
  const tgtZ = ((input.forward ? fwdZ : 0) + (input.backward ? -fwdZ : 0)
    + (input.right ? rightZ : 0) + (input.left ? -rightZ : 0)) * speed;

  const blend = 1 - Math.pow(0.001, dt);
  game._freeCamVel.x += (tgtX - game._freeCamVel.x) * blend;
  game._freeCamVel.y += (tgtY - game._freeCamVel.y) * blend;
  game._freeCamVel.z += (tgtZ - game._freeCamVel.z) * blend;
  game._freeCamPos.addScaledVector(game._freeCamVel, dt);

  cam.position.copy(game._freeCamPos);
  const lookTarget = new THREE.Vector3(
    game._freeCamPos.x + sinY * cosP,
    game._freeCamPos.y - sinP,
    game._freeCamPos.z + cosY * cosP
  );
  cam.lookAt(lookTarget);
  cam.fov = 70;
  cam.updateProjectionMatrix();
}

// ── Series AI color selection (extracted from Game.startSeries) ────────
// Returns a list of {color, emissive} entries, one per opponent, maximising
// perceptual distance from the human player and other picked enemies.
export function pickSeriesAiColors(
  colorMap: ColorMap,
  playerColor: number,
  opponentCount: number,
): ColorEntry[] {
  const _rgbToHsl = (hex: number): { h: number; s: number; l: number } => {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
    return { h, s, l };
  };
  const _hueDistance = (h1: number, h2: number): number => {
    const d = Math.abs(h1 - h2) % 360;
    return d > 180 ? 360 - d : d;
  };
  // Combined perceptual distance in [0, 1]. Saturated colors weight hue;
  // desaturated colors (like white) fall back to luminance distance.
  const _colorDistance = (a: number, b: number): number => {
    const ha = _rgbToHsl(a), hb = _rgbToHsl(b);
    const satWeight = Math.min(ha.s, hb.s);
    const hueTerm = (_hueDistance(ha.h, hb.h) / 180) * satWeight;
    const lumTerm = Math.abs(ha.l - hb.l) * (1 - satWeight);
    return hueTerm + lumTerm;
  };

  const allColorKeys: string[] = Object.keys(colorMap);
  const usedColors: number[] = [playerColor];
  const out: ColorEntry[] = [];
  for (let i = 0; i < opponentCount; i++) {
    const available: string[] = allColorKeys.filter(k => !usedColors.includes(colorMap[k].color));
    if (available.length === 0) {
      // Palette exhausted — pick any non-player color (still avoids matching the human).
      const nonPlayer: string[] = allColorKeys.filter(k => colorMap[k].color !== playerColor);
      const pool: string[] = nonPlayer.length > 0 ? nonPlayer : allColorKeys;
      const fallback: string = pool[Math.floor(Math.random() * pool.length)];
      const { color, emissive } = colorMap[fallback];
      usedColors.push(color);
      out.push({ color, emissive });
      continue;
    }
    // Score each candidate: distance to the player is the primary driver
    // (so enemies look clearly different from the human), distance to other
    // already-picked enemies is a secondary variety bonus.
    const scored: { key: string; score: number }[] = available.map(k => {
      const c: number = colorMap[k].color;
      const distToPlayer: number = _colorDistance(c, usedColors[0]);
      const otherDists: number[] = usedColors.slice(1).map(u => _colorDistance(c, u));
      const minOther: number = otherDists.length > 0 ? Math.min(...otherDists) : 1;
      return { key: k, score: distToPlayer + minOther * 0.3 };
    });
    scored.sort((a, b) => b.score - a.score);
    // Pick randomly from top candidates (within 75% of best score) for variety.
    const best: number = scored[0].score;
    const threshold: number = best * 0.75;
    const top: { key: string; score: number }[] = scored.filter(s => s.score >= threshold);
    const pick: string = top[Math.floor(Math.random() * top.length)].key;
    const { color, emissive } = colorMap[pick];
    usedColors.push(color);
    out.push({ color, emissive });
  }
  return out;
}
