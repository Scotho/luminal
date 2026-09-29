// ── playerLifecycle.ts ────────────────────────────────────
// Pure-extraction helpers for Player lifecycle (kill / updateDeath / destroy).
// These functions mutate the Player instance in place; no behavioural change
// from the original inline implementations in player.ts.

import * as THREE from 'three';
import type { Player } from './player';
import { _killColor } from './playerVFX';

/** Kill the player: hide meshes, flash light, spawn death particles. */
export function killPlayer(player: Player): void {
  player.alive = false;
  // SPEC-82: reset grind edge-tracking state so the next round's first cue fires
  player._prevRunActive = false;
  player._lastChainLength = 0;
  player._lastStreakCount = 0;
  player._lastSweetLockIn = false;
  const px: number = player.mesh.position.x;
  const py: number = player.mesh.position.y;
  const pz: number = player.mesh.position.z;

  // Hide visual meshes only — lights stay in scene graph at intensity 0
  // to prevent Three.js light-count hash change which triggers full shader
  // recompilation of every MeshStandardMaterial in the scene.
  player.mesh.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).visible = false;
  });
  // Zero all bike lights (they remain in the scene graph, just dark)
  if (player.bikeLight) player.bikeLight.intensity = 0;
  if (player.underGlow) player.underGlow.intensity = 0;
  if (player.proximityAura) player.proximityAura.intensity = 0;
  if (player._beam) player._beam.intensity = 0;
  // Reset any vibrating trail segments
  player.trail.resetGlowing();

  // Activate pre-created flash light (just set intensity, no scene graph changes)
  player._flashLight.position.set(px, py + 2, pz);
  player._flashLight.intensity = 0.96;

  player.deathTime = 0;
  player._deathX = px;
  player._deathY = py;
  player._deathZ = pz;

  // Populate pre-created death particles — no allocations, no scene.add()
  const count: number = player._debrisCount;
  const positions = player.deathParticles.geometry.attributes.position.array as Float32Array;
  const colors = player.deathParticles.geometry.attributes.color.array as Float32Array;
  for (let i = 0; i < count; i++) {
    const i3: number = i * 3;
    positions[i3] = px + (Math.random() - 0.5) * 2;
    positions[i3 + 1] = 0.5 + Math.random() * 1.5;
    positions[i3 + 2] = pz + (Math.random() - 0.5) * 2;
    // Spawn flash: start bright white-yellow, fades in updatePlayerDeath
    colors[i3] = 1.0;
    colors[i3 + 1] = 0.95;
    colors[i3 + 2] = 0.7;
    const a: number = Math.random() * Math.PI * 2;
    const force: number = 8 + Math.random() * 20;
    player._dvx[i] = Math.cos(a) * force;
    player._dvy[i] = 5 + Math.random() * 15;
    player._dvz[i] = Math.sin(a) * force;
  }
  player.deathParticles.geometry.attributes.position.needsUpdate = true;
  player.deathParticles.geometry.attributes.color.needsUpdate = true;
  player._deathMat.opacity = 1;
  player._deathMat.size = 0.7;
}

/** Advance death debris particles + flash decay. */
export function updatePlayerDeath(player: Player, dt: number): void {
  if (!player.alive) player.deathTime += dt;

  // Flash decay (just fade intensity, no visibility toggle)
  if (player._flashLight && player._flashLight.intensity > 0) {
    player._flashLight.intensity = Math.max(0, 1.44 * (1 - player.deathTime * 8));
  }

  // Skip particle update if not dead yet or already faded
  if (player._deathMat.opacity <= 0) return;

  // Debris — simple outward + gravity, no bounce
  const positions = player.deathParticles.geometry.attributes.position.array as Float32Array;
  const n: number = player._debrisCount;
  for (let i = 0; i < n; i++) {
    const i3: number = i * 3;
    positions[i3] += player._dvx[i] * dt;
    positions[i3 + 1] += player._dvy[i] * dt;
    positions[i3 + 2] += player._dvz[i] * dt;
    player._dvy[i] -= 12 * dt;
    // Ground bounce — reflect Y velocity with damping
    if (positions[i3 + 1] < 0.05 && player._dvy[i] < 0) {
      positions[i3 + 1] = 0.05;
      player._dvy[i] = -player._dvy[i] * 0.4;
      player._dvx[i] *= 0.85;
      player._dvz[i] *= 0.85;
    }
  }

  // Size shrink over lifetime
  player._deathMat.size = Math.max(0.15, 0.7 * (1 - player.deathTime * 0.4));

  // Color: fade from white-yellow flash to player color over first 0.15s
  if (player.deathTime < 0.15) {
    const colors = player.deathParticles.geometry.attributes.color.array as Float32Array;
    _killColor.set(player.color);
    const flashT = player.deathTime / 0.15;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const t = Math.random();
      const targetR = t * 1.0 + (1 - t) * _killColor.r;
      const targetG = t * 0.8 + (1 - t) * _killColor.g;
      const targetB = t * 0.5 + (1 - t) * _killColor.b;
      colors[i3] = 1.0 + (targetR - 1.0) * flashT;
      colors[i3 + 1] = 0.95 + (targetG - 0.95) * flashT;
      colors[i3 + 2] = 0.7 + (targetB - 0.7) * flashT;
    }
    player.deathParticles.geometry.attributes.color.needsUpdate = true;
  }

  player.deathParticles.geometry.attributes.position.needsUpdate = true;
  player._deathMat.opacity = Math.max(0, 1 - player.deathTime * 0.5);

  if (player.deathTime > 1.2) {
    // Move particles off-screen instead of removing from scene
    player._deathMat.opacity = 0;
  }
}

/** Dispose all geometry + materials inside a subtree (vehicle clones, glow meshes, etc.). */
function disposeSubtree(root: THREE.Object3D): void {
  root.traverse((child: THREE.Object3D) => {
    const mesh = child as THREE.Mesh;
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

/** Tear down scene-graph resources owned by this Player. */
export function destroyPlayer(player: Player): void {
  // Zero all lights before removing from scene to minimize light-count
  // hash changes (reduces shader recompilation during cleanup)
  if (player.bikeLight) player.bikeLight.intensity = 0;
  if (player.underGlow) player.underGlow.intensity = 0;
  if (player.proximityAura) player.proximityAura.intensity = 0;
  if (player._beam) player._beam.intensity = 0;
  if (player._flashLight) player._flashLight.intensity = 0;
  // Dispose vehicle clone geometry + materials before removing from scene.
  // .clone(true) deep-clones BufferGeometry, so these are owned by this
  // player instance and safe to dispose (template geometry is unaffected).
  disposeSubtree(player.mesh);
  if (player.mesh.parent) player.scene.remove(player.mesh);
  if (player.deathParticles) {
    player.scene.remove(player.deathParticles);
    player.deathParticles.geometry.dispose();
    player._deathMat.dispose();
  }
  if (player._flashLight && player._flashLight.parent) player.scene.remove(player._flashLight);
  if (player.groundFX) {
    player.scene.remove(player.groundFX.points);
    player.groundFX.geo.dispose();
    player.groundFX.mat.dispose();
    if (player.groundFX.groundArcs) {
      for (const a of player.groundFX.groundArcs) {
        player.scene.remove(a.line);
        a.geo.dispose();
        (a.line.material as THREE.Material).dispose();
      }
    }
  }
  if (player.speedLines) {
    player.scene.remove(player.speedLines.points);
    player.speedLines.geo.dispose();
    player.speedLines.mat.dispose();
  }
  if (player.snapSmoke) {
    player.scene.remove(player.snapSmoke.points);
    player.snapSmoke.geo.dispose();
    player.snapSmoke.mat.dispose();
  }
  if (player.electricArcs) {
    player.scene.remove(player.electricArcs.points);
    player.electricArcs.geo.dispose();
    player.electricArcs.mat.dispose();
    for (const a of player.electricArcs.arcs) {
      player.scene.remove(a.line);
      a.geo.dispose();
      (a.line.material as THREE.Material).dispose();
    }
  }
  player.trail.destroy();
  player._sparkEmitter?.dispose();
  player._grindHUD?.dispose();
  player._grindComboHUD?.dispose();
  player._grindBustOverlay?.dispose();
  player._grindAvailabilityHint?.dispose();
  if (player._tireStreaks) {
    player._tireStreaks.clear();
    player._tireStreaks.instancedMesh.geometry.dispose();
    (player._tireStreaks.instancedMesh.material as THREE.Material).dispose();
    player._tireStreaks.instancedMesh.removeFromParent();
    player._tireStreaks = null;
  }
}
