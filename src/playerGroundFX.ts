// ── playerGroundFX.ts ─────────────────────────────────────
// Pure-extraction helper for ground-contact VFX under the player:
// dust, sparks, and skid/zap lightning arcs. Split out of playerVFX.ts
// so that file stays under the LOC budget. Behaviour unchanged.

import * as THREE from 'three';
import type { GroundFXSystem, GroundArc } from './playerVFX';
import { hasFiniteTrackPose } from './playerVFXUtil';

export function updateGroundFXImpl(
  gfx: GroundFXSystem,
  bikePos: THREE.Vector3,
  bikeAngle: number,
  speed: number,
  wBoosting: boolean,
  dashing: boolean,
  dashJustPressed: boolean,
  dt: number,
): void {
  if (!hasFiniteTrackPose(bikePos, bikeAngle)) {
    gfx.mat.opacity = 0;
    gfx.geo.attributes.position.needsUpdate = true;
    if (gfx.groundArcs) {
      gfx.groundArcs.forEach((arc: GroundArc) => {
        (arc.line.material as THREE.LineBasicMaterial).opacity = 0;
      });
    }
    return;
  }
  const positions = gfx.geo.attributes.position.array as Float32Array;
  const speedFactor: number = speed / 40; // normalized to base speed
  const anyBoost: boolean = wBoosting || dashing;

  // ── Sparks (dash only) ──────────────────────────────────
  if (!dashing) {
    // Fade sparks out when not dashing
    gfx.mat.opacity = Math.max(0, gfx.mat.opacity - dt * 2);
    for (let i = 0; i < gfx.count; i++) {
      if (gfx.lifetimes[i] > 0) {
        const i3: number = i * 3;
        const i2: number = i * 2;
        gfx.lifetimes[i] -= dt;
        positions[i3] += gfx.vels[i2] * dt;
        positions[i3 + 2] += gfx.vels[i2 + 1] * dt;
        positions[i3 + 1] *= 0.95;
      }
    }
    gfx.geo.attributes.position.needsUpdate = true;
  } else {
    // Dash sparks — bright and visible
    gfx.mat.opacity = Math.min(0.7, 0.3 + speedFactor * 0.2);
    gfx.mat.size = 0.25;
    // Hot-spark color: bright yellow-white for metal-spark look
    gfx.mat.color.setRGB(0.95, 0.85, 0.45);

    // Burst spawn on dash re-press — immediate visual feedback
    const burstCount: number = dashJustPressed ? 8 : 0;
    if (dashJustPressed) gfx.mat.opacity = 0.9; // flash brighter

    // Spawn sparks from under the bike — every frame while dashing
    gfx.spawnTimer += dt;
    const spawnRate: number = 0.016; // ~60Hz, spawn every frame
    let spawnsLeft: number = burstCount;
    if (gfx.spawnTimer > spawnRate || spawnsLeft > 0) {
      if (gfx.spawnTimer > spawnRate) { gfx.spawnTimer = 0; spawnsLeft = Math.max(spawnsLeft, 3); }
      const fwd: number = -Math.sin(bikeAngle);
      const fwdZ: number = -Math.cos(bikeAngle);
      const rx: number = Math.cos(bikeAngle);
      const rz: number = -Math.sin(bikeAngle);
      for (let i = 0; i < gfx.count && spawnsLeft > 0; i++) {
        if (gfx.lifetimes[i] <= 0) {
          const i3: number = i * 3;
          const i2: number = i * 2;
          const side: number = (Math.random() - 0.5) * 1.0;
          const behind: number = -0.3 - Math.random() * 1.2;
          positions[i3] = bikePos.x + fwd * behind + rx * side;
          positions[i3 + 1] = 0.03 + Math.random() * 0.1;
          positions[i3 + 2] = bikePos.z + fwdZ * behind + rz * side;
          gfx.vels[i2] = rx * side * 5 + (Math.random() - 0.5) * 3;
          gfx.vels[i2 + 1] = rz * side * 5 + (Math.random() - 0.5) * 3;
          gfx.lifetimes[i] = 0.12 + Math.random() * 0.2;
          spawnsLeft--;
        }
      }
    }

    // Update live spark particles
    for (let i = 0; i < gfx.count; i++) {
      if (gfx.lifetimes[i] > 0) {
        const i3: number = i * 3;
        const i2: number = i * 2;
        gfx.lifetimes[i] -= dt;
        positions[i3] += gfx.vels[i2] * dt;
        positions[i3 + 2] += gfx.vels[i2 + 1] * dt;
        positions[i3 + 1] *= 0.95;
      }
    }
    gfx.geo.attributes.position.needsUpdate = true;
  }

  // ── Ground lightning arcs (any boost: W or dash) ────────
  if (gfx.groundArcs) {
    // Force immediate re-zap on dash re-press
    if (dashJustPressed && dashing) {
      gfx.groundArcs.forEach((arc: GroundArc) => { arc.timer = 0; });
    }
    if (!anyBoost) {
      // Fade arcs when not boosting at all
      gfx.groundArcs.forEach((arc: GroundArc) => {
        (arc.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, (arc.line.material as THREE.LineBasicMaterial).opacity - 6 * dt);
      });
    } else {
      const fwd: number = -Math.sin(bikeAngle);
      const fwdZ: number = -Math.cos(bikeAngle);
      const rx: number = Math.cos(bikeAngle);
      const rz: number = -Math.sin(bikeAngle);
      const arcOpacity: number = dashing ? 0.35 : 0.25;
      gfx.groundArcs.forEach((arc: GroundArc) => {
        // Reset stale arcs when boost resumes — positions are from old location
        if ((arc.line.material as THREE.LineBasicMaterial).opacity < 0.01) {
          arc.timer = 0;
        }
        arc.timer -= dt;
        (arc.line.material as THREE.LineBasicMaterial).opacity = arcOpacity;
        if (arc.timer <= 0) {
          arc.timer = 0.08 + Math.random() * 0.14;
          const ap = arc.geo.attributes.position.array as Float32Array;
          const startAlong: number = (Math.random() - 0.5) * 4;
          const startSide: number = (Math.random() - 0.5) * 2.0;
          const sx: number = bikePos.x + fwd * startAlong + rx * startSide;
          const sz: number = bikePos.z + fwdZ * startAlong + rz * startSide;
          for (let j = 0; j < 5; j++) {
            const j3: number = j * 3;
            const t: number = j / 4;
            ap[j3] = sx + rx * (Math.random() - 0.5) * 3.5 * t + fwd * (Math.random() - 0.5) * 2.0;
            ap[j3 + 1] = 0.12 + Math.random() * 0.2;
            ap[j3 + 2] = sz + rz * (Math.random() - 0.5) * 3.5 * t + fwdZ * (Math.random() - 0.5) * 2.0;
          }
          arc.geo.attributes.position.needsUpdate = true;
        }
      });
    }
  }
}
