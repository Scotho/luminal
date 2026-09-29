// ── Replay Ghosts ────────────────────────────────────────
// Extracted from replayMode.ts — ghost (replay bike/car/hoverboard) lifecycle,
// trail rebuild, destruction, and death-position lookup.

import * as THREE from 'three';
import { Trail } from '../trail';
import { cloneBikeModel, getBikeModelHeight } from '../bikeModel';
import { cloneCarModel } from '../carModel';
import { cloneHoverboardModel, getHoverboardModelHeight } from '../hoverboardModel';
import type {
  ReplaySnapshot, ReplayFrame, PlayerState, VehicleType,
} from '../types/index';
import type { ReplayMode, GhostEntry } from './replayMode';

export function createGhost(rm: ReplayMode, color: number, _emissive: number, vehicleType: VehicleType = 'bike'): GhostEntry {
  const modelClone: THREE.Group =
    vehicleType === 'car' ? cloneCarModel(color)
    : vehicleType === 'hoverboard' ? cloneHoverboardModel(color)
    : cloneBikeModel(color);
  modelClone.scale.setScalar(
    vehicleType === 'car' ? 2.0
    : vehicleType === 'hoverboard' ? 2.7 / getHoverboardModelHeight()
    : 2.7 / getBikeModelHeight()
  );

  const mesh = new THREE.Group();
  mesh.add(modelClone);
  rm.host.scene.add(mesh);

  const light = new THREE.PointLight(color, 1.2, 8);
  light.position.y = 0.2;
  mesh.add(light);

  const trail = new Trail(rm.host.scene, color);

  return { mesh, trail, light, lastTrailX: null, lastTrailZ: null, alive: true };
}

export function updateGhost(ghost: GhostEntry | null, state: PlayerState | null): void {
  if (!ghost || !state) return;
  if (!state.alive && ghost.alive) {
    ghost.mesh.visible = false;
    if (ghost.light) ghost.light.intensity = 0;
    ghost.alive = false;
  }
  if (!state.alive) return;

  ghost.mesh.position.x = state.x;
  ghost.mesh.position.z = state.z;
  ghost.mesh.rotation.y = state.angle;

  if (!ghost.trail) return;
  const dx: number = ghost.lastTrailX !== null ? state.x - ghost.lastTrailX : 999;
  const dz: number = ghost.lastTrailZ !== null ? state.z - ghost.lastTrailZ : 999;
  if (dx * dx + dz * dz > 0.25) {
    ghost.trail.addPoint(state.x, state.z);
    ghost.lastTrailX = state.x;
    ghost.lastTrailZ = state.z;
  }
  ghost.trail.updateHead(state.x, state.z);
  ghost.trail.updateSpeed(state.speed / 40);
}

export function rebuildGhostTrails(rm: ReplayMode, seekTime: number): void {
  const data: ReplaySnapshot | null = rm.host._replayPlayer.data;
  if (!data) return;
  for (let g = 0; g < rm._replayGhosts.length; g++) {
    const ghost: GhostEntry = rm._replayGhosts[g];
    const color: number = g === 0 ? data.playerColor : data.aiColors[g - 1].color;
    ghost.trail.destroy();
    ghost.trail = new Trail(rm.host.scene, color);
    ghost.lastTrailX = null; ghost.lastTrailZ = null;
    ghost.alive = true; ghost.mesh.visible = true;
  }
  for (const f of data.frames) {
    if (f.t > seekTime) break;
    if (rm._replayGhosts[0] && f.player.alive) {
      rm._replayGhosts[0].trail.addPoint(f.player.x, f.player.z);
      rm._replayGhosts[0].lastTrailX = f.player.x;
      rm._replayGhosts[0].lastTrailZ = f.player.z;
    }
    for (let a = 0; a < f.ais.length; a++) {
      if (rm._replayGhosts[a + 1] && f.ais[a].alive) {
        rm._replayGhosts[a + 1].trail.addPoint(f.ais[a].x, f.ais[a].z);
        rm._replayGhosts[a + 1].lastTrailX = f.ais[a].x;
        rm._replayGhosts[a + 1].lastTrailZ = f.ais[a].z;
      }
    }
  }
}

export function destroyGhosts(rm: ReplayMode): void {
  for (const ghost of rm._replayGhosts) {
    rm.host.scene.remove(ghost.mesh);
    ghost.mesh.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.Material).dispose();
    });
    ghost.trail.destroy();
  }
  rm._replayGhosts = [];
}

export function findLastAlivePos(rm: ReplayMode, frames: ReplayFrame[], deathFrameIdx: number, type: 'player' | 'ai', aiIdx?: number): { x: number; z: number } {
  for (let i = deathFrameIdx - 1; i >= 0; i--) {
    const state = type === 'player' ? frames[i].player : frames[i].ais?.[aiIdx!];
    if (state && state.alive) return { x: state.x, z: state.z };
  }
  const ghostIdx = type === 'player' ? 0 : (aiIdx! + 1);
  const ghost = rm._replayGhosts[ghostIdx];
  if (ghost) return { x: ghost.mesh.position.x, z: ghost.mesh.position.z };
  return { x: 0, z: 0 };
}

export function seekTo(rm: ReplayMode, progress: number): void {
  rm.host._replayPlayer.seekTo(progress);
  for (const ghost of rm._replayGhosts) ghost.trail.destroy();
  const data: ReplaySnapshot | null = rm.host._replayPlayer.data;
  if (!data) return;
  for (let g = 0; g < rm._replayGhosts.length; g++) {
    const ghost = rm._replayGhosts[g];
    const color: number = g === 0 ? data.playerColor : data.aiColors[g - 1].color;
    ghost.trail = new Trail(rm.host.scene, color);
    ghost.lastTrailX = null; ghost.lastTrailZ = null;
    ghost.alive = true; ghost.mesh.visible = true;
  }
  const frames: ReplayFrame[] = data.frames;
  const seekTime: number = progress * data.duration;
  for (const f of frames) {
    if (f.t > seekTime) break;
    if (rm._replayGhosts[0] && f.player.alive) {
      rm._replayGhosts[0].trail.addPoint(f.player.x, f.player.z);
      rm._replayGhosts[0].lastTrailX = f.player.x;
      rm._replayGhosts[0].lastTrailZ = f.player.z;
    }
    for (let a = 0; a < f.ais.length; a++) {
      if (rm._replayGhosts[a + 1] && f.ais[a].alive) {
        rm._replayGhosts[a + 1].trail.addPoint(f.ais[a].x, f.ais[a].z);
        rm._replayGhosts[a + 1].lastTrailX = f.ais[a].x;
        rm._replayGhosts[a + 1].lastTrailZ = f.ais[a].z;
      }
    }
  }
}
