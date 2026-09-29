// ── playerArcFX.ts ────────────────────────────────────────
// Pure-extraction helper for electric-arc / lightning VFX around the
// player body (boost/dash). Split out of playerVFX.ts so that file
// stays under the LOC budget. Behaviour unchanged.

import * as THREE from 'three';
import type { ElectricArcSystem, ElectricArc } from './playerVFX';
import { hasFiniteTrackPose } from './playerVFXUtil';

export function updateElectricArcsImpl(
  ea: ElectricArcSystem,
  bikePos: THREE.Vector3,
  bikeAngle: number,
  active: boolean,
  dashJustPressed: boolean,
  dt: number,
): void {
  if (!hasFiniteTrackPose(bikePos, bikeAngle)) {
    ea.mat.opacity = 0;
    ea.arcs.forEach((arc: ElectricArc) => {
      (arc.line.material as THREE.LineBasicMaterial).opacity = 0;
    });
    return;
  }
  // Burst on every dash press — event-driven, retriggers reliably on re-press
  if (dashJustPressed && active) {
    ea._burstTimer = 0.35;
    ea.mat.opacity = 1.0; // instant flash
  }
  if (ea._burstTimer && ea._burstTimer > 0) ea._burstTimer -= dt;

  const burstFactor: number = (ea._burstTimer && ea._burstTimer > 0) ? ea._burstTimer / 0.35 : 0;
  const targetOp: number = active ? 0.85 + burstFactor * 0.5 : 0;
  ea.mat.opacity += (targetOp - ea.mat.opacity) * (active ? 18 : 8) * dt;

  // Scale up particles during burst
  ea.mat.size = 0.14 + burstFactor * 0.22;

  const positions = ea.geo.attributes.position.array as Float32Array;
  const bx: number = bikePos.x;
  const bz: number = bikePos.z;

  if (active) {
    // Particles jitter around bike body — no gravity, no flying away
    for (let i = 0; i < ea.count; i++) {
      const i3: number = i * 3;
      // Anchor near bike with rapid random offset (electric jitter)
      const burstSpread: number = burstFactor * 2.0;
      const spread: number = 2.0 + burstSpread;
      const zOff: number = (Math.random() - 0.5) * 5; // along bike length
      const fwd: number = -Math.sin(bikeAngle);
      const side: number = Math.cos(bikeAngle);
      const fwdZ: number = -Math.cos(bikeAngle);
      const sideZ: number = -Math.sin(bikeAngle);

      positions[i3] = bx + fwd * zOff + side * (Math.random() - 0.5) * spread + (Math.random() - 0.5) * 0.3;
      positions[i3 + 1] = 0.2 + Math.random() * 2.2;
      positions[i3 + 2] = bz + fwdZ * zOff + sideZ * (Math.random() - 0.5) * spread + (Math.random() - 0.5) * 0.3;
    }
    ea.geo.attributes.position.needsUpdate = true;

    // Update arc lines — zigzag from random point on bike to another
    ea.arcs.forEach((arc: ElectricArc) => {
      arc.timer -= dt;
      (arc.line.material as THREE.LineBasicMaterial).opacity = active ? (0.5 + burstFactor * 0.4) : 0;
      if (arc.timer <= 0) {
        arc.timer = 0.03 + Math.random() * 0.08; // rapid re-zap
        const ap = arc.geo.attributes.position.array as Float32Array;
        const startOff: number = (Math.random() - 0.5) * 4;
        const endOff: number = (Math.random() - 0.5) * 4;
        const fwd: number = -Math.sin(bikeAngle);
        const fwdZ: number = -Math.cos(bikeAngle);
        const side: number = Math.cos(bikeAngle);
        const sideZ: number = -Math.sin(bikeAngle);
        const sideOff1: number = (Math.random() - 0.5) * 1.5;
        const sideOff2: number = (Math.random() - 0.5) * 1.5;
        const y1: number = 0.3 + Math.random() * 2;
        const y2: number = 0.3 + Math.random() * 2;

        // Start point
        ap[0] = bx + fwd * startOff + side * sideOff1;
        ap[1] = y1;
        ap[2] = bz + fwdZ * startOff + sideZ * sideOff1;
        // Mid points — jagged
        ap[3] = (ap[0] + bx + fwd * endOff) / 2 + (Math.random() - 0.5) * 1.5;
        ap[4] = (y1 + y2) / 2 + (Math.random() - 0.5) * 1.0;
        ap[5] = (ap[2] + bz + fwdZ * endOff) / 2 + (Math.random() - 0.5) * 1.5;
        ap[6] = ap[3] + (Math.random() - 0.5) * 1.0;
        ap[7] = ap[4] + (Math.random() - 0.5) * 0.8;
        ap[8] = ap[5] + (Math.random() - 0.5) * 1.0;
        // End point
        ap[9] = bx + fwd * endOff + side * sideOff2;
        ap[10] = y2;
        ap[11] = bz + fwdZ * endOff + sideZ * sideOff2;

        arc.geo.attributes.position.needsUpdate = true;
      }
    });
  } else {
    ea.arcs.forEach((arc: ElectricArc) => {
      (arc.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, (arc.line.material as THREE.LineBasicMaterial).opacity - 5 * dt);
    });
  }
}
