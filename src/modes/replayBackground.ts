// ── Replay Background ────────────────────────────────────
// Extracted from replayMode.ts — background replay (menu backdrop + victory
// screen) playback, death cam, slow-mo, shatter pool, and loop logic.

import * as THREE from 'three';
import { Trail } from '../trail';
import { setSpectatorTargets } from '../grid';
import { resetCamera } from '../scene';
import { FALLBACK_OPPONENT_COLOR_KEY, getPlayerColor } from '../playerColors';
import { getGfx } from '../graphics';
import type {
  ReplaySnapshot, InterpolatedReplayFrame, PlayerState,
} from '../types/index';
import type { ReplayMode, GhostEntry } from './replayMode';
import { updateReplayCamera } from './replayCamera';

export function updateBgReplay(rm: ReplayMode, dt: number): void {
  if (rm._bgShatter) {
    rm._bgShatterTime += dt;
    updateBgShatter(rm, dt);
    if (rm._bgDeathPos) {
      rm._bgSlowMoT += dt;
      updateBgDeathCamera(rm, dt);
    }
    if (rm._bgShatterTime > 2.5) {
      cleanupBgShatter(rm);
      loopBgReplay(rm);
    }
    return;
  }

  const rp = rm.host._replayPlayer;
  if (rp.data && rp.playing) {
    const timeLeft: number = rp.data.duration - rp.time;
    const SLOWMO_WINDOW = 1.8;
    if (timeLeft < SLOWMO_WINDOW && timeLeft > 0) {
      if (!rm._bgSlowMo) {
        rm._bgSlowMo = true;
        rm._bgSlowMoT = 0;
        rm._bgDeathPos = null;
        rm._bgDeathColor = null;
        rm._bgDeathGhostIdx = -1;
        const frames = rp.data.frames;
        for (let fi = rp.frameIndex; fi < frames.length; fi++) {
          const f = frames[fi];
          if (!f.player.alive && rm._replayGhosts[0]?.alive) {
            const lastAlive = rm._findLastAlivePos(frames, fi, 'player');
            rm._bgDeathPos = new THREE.Vector3(lastAlive.x, 0.7, lastAlive.z);
            rm._bgDeathColor = rp.data.playerColor;
            rm._bgDeathGhostIdx = 0;
            break;
          }
          for (let ai = 0; ai < (f.ais?.length ?? 0); ai++) {
            if (!f.ais[ai].alive && rm._replayGhosts[ai + 1]?.alive) {
              const lastAlive = rm._findLastAlivePos(frames, fi, 'ai', ai);
              rm._bgDeathPos = new THREE.Vector3(lastAlive.x, 0.7, lastAlive.z);
              rm._bgDeathColor = rp.data.aiColors[ai]?.color || getPlayerColor(FALLBACK_OPPONENT_COLOR_KEY).color;
              rm._bgDeathGhostIdx = ai + 1;
              break;
            }
          }
          if (rm._bgDeathPos) break;
        }
        if (rm._bgDeathPos) {
          rm._bgZoomTarget.copy(rm._bgDeathPos);
        }
      }
      const progress: number = 1 - (timeLeft / SLOWMO_WINDOW);
      const eased: number = progress * progress;
      rp.speed = 1.0 - eased * 0.88;
      rm._bgSlowMoT += dt;
    }
  }

  const frame: InterpolatedReplayFrame | null = rp.update(dt);
  if (!frame) {
    if (rm._bgDeathPos && !rm._bgShatter) {
      spawnBgShatter(rm, rm._bgDeathPos, rm._bgDeathColor!);
      if (rm._bgDeathGhostIdx >= 0 && rm._replayGhosts[rm._bgDeathGhostIdx]) {
        const g: GhostEntry = rm._replayGhosts[rm._bgDeathGhostIdx];
        g.mesh.visible = false;
        g.light.intensity = 0;
        g.alive = false;
      }
    } else {
      loopBgReplay(rm);
    }
    return;
  }

  const allStates: PlayerState[] = [frame.player, ...frame.ais];
  for (let i = 0; i < allStates.length; i++) {
    const ghost: GhostEntry | undefined = rm._replayGhosts[i];
    if (!ghost) continue;
    const state: PlayerState = allStates[i];
    if (!state.alive && ghost.alive && i === rm._bgDeathGhostIdx && rm._bgSlowMo) {
      spawnBgShatter(
        rm,
        new THREE.Vector3(ghost.mesh.position.x, 0.7, ghost.mesh.position.z),
        i === 0 ? rp.data!.playerColor : rp.data!.aiColors[i - 1]?.color || getPlayerColor(FALLBACK_OPPONENT_COLOR_KEY).color
      );
    }
    rm._updateGhost(ghost, state);
  }

  const ghostTargets: ({ x: number; z: number } | null)[] = [];
  for (const ghost of rm._replayGhosts) {
    ghostTargets.push(ghost.alive ? { x: ghost.mesh.position.x, z: ghost.mesh.position.z } : null);
  }
  setSpectatorTargets(ghostTargets);

  if (rm._bgSlowMo && rm._bgDeathPos) {
    updateBgDeathCamera(rm, dt);
  } else {
    rm._replayCamMode = 0;
    updateReplayCamera(rm, dt, frame);
  }
}

export function updateBgDeathCamera(rm: ReplayMode, dt: number): void {
  const cam: THREE.PerspectiveCamera = rm.host.camera;
  const target: THREE.Vector3 = rm._bgZoomTarget;
  const t: number = Math.min(1, rm._bgSlowMoT * 0.35);
  const eased: number = 1 - Math.pow(1 - t, 4);

  const orbitAngle: number = (rm._replayOrbitAngle || 0) + rm._bgSlowMoT * 0.12;

  const dist: number = 60 * (1 - eased) + 7.2 * eased;
  const height: number = 40 * (1 - eased) + 4.2 * eased;

  const goalX: number = target.x + Math.cos(orbitAngle) * dist;
  const goalZ: number = target.z + Math.sin(orbitAngle) * dist;
  const goalY: number = target.y + height;

  const lerpRate: number = 3.0 + eased * 4.0;
  cam.position.x += (goalX - cam.position.x) * lerpRate * dt;
  cam.position.z += (goalZ - cam.position.z) * lerpRate * dt;
  cam.position.y += (goalY - cam.position.y) * lerpRate * dt;
  cam.lookAt(target);

  const targetFov: number = 70 * (1 - eased) + 36 * eased;
  cam.fov += (targetFov - cam.fov) * 4.0 * dt;
  cam.updateProjectionMatrix();

  const overlay = document.getElementById('slowmo-overlay');
  if (overlay) {
    overlay.style.opacity = (eased * 0.9).toFixed(2);
    if (eased > 0.05) overlay.classList.add('slowmo--active');
  }

  if (rm.host.bloomPass && !rm.host.adminBloomFreeze) {
    const bloomRadius: number = getGfx().bloom.radius || 0.16;
    const bloomThreshold: number = getGfx().bloom.threshold || 0.7;
    const bloomTarget: number = rm.host.baseBloomStrength + eased * 1.5;
    rm.host.bloomPass.strength += (bloomTarget - rm.host.bloomPass.strength) * 3.0 * dt;
    rm.host.bloomPass.radius = bloomRadius + eased * 0.1;
    rm.host.bloomPass.threshold = Math.max(0.18, bloomThreshold - eased * 0.1);
  }
}

export function ensureBgShatterPool(_rm: ReplayMode): void {}

export function spawnBgShatter(rm: ReplayMode, pos: THREE.Vector3, _color: number): void {
  rm._bgShatter = { _stub: true };
  rm._bgShatterTime = 0;
  rm._bgZoomTarget.copy(pos);
}

export function updateBgShatter(_rm: ReplayMode, _dt: number): void {}

export function cleanupBgShatter(rm: ReplayMode): void {
  rm._bgShatter = null;
}

export function resetBgSlowMo(rm: ReplayMode): void {
  rm._bgSlowMo = false;
  rm._bgSlowMoT = 0;
  rm._bgDeathPos = null;
  rm._bgDeathColor = null;
  rm._bgDeathGhostIdx = -1;
  rm.host.camera.fov = 50;
  rm.host.camera.updateProjectionMatrix();
  const overlay = document.getElementById('slowmo-overlay');
  if (overlay) { overlay.classList.remove('slowmo--active'); overlay.style.opacity = '0'; }
  if (rm.host.bloomPass && !rm.host.adminBloomFreeze) {
    rm.host.bloomPass.strength = rm.host.baseBloomStrength;
    rm.host.bloomPass.radius = getGfx().bloom.radius || 0.16;
    rm.host.bloomPass.threshold = getGfx().bloom.threshold || 0.7;
  }
}

export function loopBgReplay(rm: ReplayMode): void {
  if (rm._menuReplayActive && rm._menuReplayDone) {
    resetBgSlowMo(rm);
    rm._menuReplayDone();
    return;
  }
  if (!rm.host._replayRecorder.hasData()) return;
  const snapshot: ReplaySnapshot = rm.host._replayRecorder.getSnapshot();
  rm.host._replayPlayer.load(snapshot);
  for (const ghost of rm._replayGhosts) {
    if (ghost.trail) ghost.trail.destroy();
    ghost.alive = true;
    ghost.mesh.visible = true;
    if (ghost.light) ghost.light.intensity = 1.2;
    ghost.lastTrailX = null;
    ghost.lastTrailZ = null;
  }
  for (let i = 0; i < rm._replayGhosts.length; i++) {
    const color: number = i === 0 ? snapshot.playerColor : (snapshot.aiColors[i - 1]?.color || getPlayerColor(FALLBACK_OPPONENT_COLOR_KEY).color);
    rm._replayGhosts[i].trail = new Trail(rm.host.scene, color);
  }
  resetBgSlowMo(rm);
  rm._bgReplayCamTimer = 0;
  rm._replayCamMode = 0;
  rm._replayOrbitAngle = 0;
  rm._replayZoom = 1;
  rm.host.camera.position.set(0, 100, 140);
  rm.host.camera.lookAt(0, 0, 0);
  rm.host.camera.fov = 50;
  rm.host.camera.updateProjectionMatrix();
  resetCamera();
}
