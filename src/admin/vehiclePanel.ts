// ── Admin Panel: Vehicle/Loadout Section ─────────────────
// Neon/body materials, engine glow, point lights, beam, proximity aura.

import * as THREE from 'three';
import {
  addHeader,
  addLabel,
  addSlider,
  trackSlider,
} from './helpers';
import { adminOverrides } from '../player';
import type { PlayerLike } from '../adminPanel';

export function addVehicleSection(allPlayers: PlayerLike[]): void {
  const player = allPlayers[0] ?? null;

  addHeader('LOADOUT', 'vehicle');
  if (!player) {
    addLabel('(no active player — start a game)');
    return;
  }

  const neonMats: THREE.MeshStandardMaterial[] = [];
  const bodyMats: THREE.MeshStandardMaterial[] = [];
  const allBodyMats: THREE.MeshStandardMaterial[] = []; // includes non-emissive body
  allPlayers.forEach((p) => {
    p.mesh.traverse((child: THREE.Object3D) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mats = Array.isArray((child as THREE.Mesh).material)
        ? ((child as THREE.Mesh).material as THREE.Material[])
        : [(child as THREE.Mesh).material];
      for (const mat of mats) {
        const m = mat as THREE.MeshStandardMaterial;
        if (!m.isMeshStandardMaterial) continue;
        if (m.name === 'Blue Neon' || m.name === 'Scene_-_Root' || m.name === 'Scene - Root') {
          neonMats.push(m);
        } else if (m.emissiveMap && m.emissiveIntensity > 1) {
          if (!neonMats.includes(m)) neonMats.push(m);
        } else if (m.emissiveIntensity > 0 && m.emissiveIntensity < 1 && m.metalness > 0.5) {
          bodyMats.push(m);
        } else if (m.metalness > 0.5) {
          allBodyMats.push(m);
        }
      }
    });
  });

  if (neonMats.length) {
    trackSlider('vehicle', 'neonEmissive', addSlider('neonEmissive', neonMats[0].emissiveIntensity, 0, 6, 0.05, (v) => {
      neonMats.forEach((m) => { m.emissiveIntensity = v; });
    }));
  }
  if (bodyMats.length) {
    trackSlider('vehicle', 'bodyEmissive', addSlider('bodyEmissive', bodyMats[0].emissiveIntensity, 0, 2, 0.01, (v) => {
      bodyMats.forEach((m) => { m.emissiveIntensity = v; });
    }));
  }

  // Engine glow
  const engineMat = player.engineGlow?.material as THREE.MeshStandardMaterial | undefined;
  if (engineMat?.isMeshStandardMaterial) {
    trackSlider('vehicle', 'engineGlow', addSlider('engineGlow', engineMat.emissiveIntensity, 0, 5, 0.05, (v) => {
      adminOverrides.engineGlow = v;
      allPlayers.forEach((p) => {
        const m = p.engineGlow?.material as THREE.MeshStandardMaterial;
        if (m?.isMeshStandardMaterial) m.emissiveIntensity = v;
      });
    }));
  }

  // Point lights
  if (player.bikeLight) {
    trackSlider('vehicle', 'bikeLightInt', addSlider('bikeLight', player.bikeLight.intensity, 0, 8, 0.1, (v) => {
      adminOverrides.bikeLight = v;
      allPlayers.forEach((p) => { if (p.bikeLight) p.bikeLight.intensity = v; });
    }));
  }
  if (player.underGlow) {
    trackSlider('vehicle', 'underGlowInt', addSlider('underGlow', player.underGlow.intensity, 0, 5, 0.1, (v) => {
      adminOverrides.underGlow = v;
      allPlayers.forEach((p) => { if (p.underGlow) p.underGlow.intensity = v; });
    }));
  }

  // Car front/rear glow lights (children of mesh group, not stored as properties)
  const extraGlows: THREE.PointLight[] = [];
  allPlayers.forEach((p) => {
    p.mesh.traverse((child: THREE.Object3D) => {
      if ((child as THREE.PointLight).isPointLight) {
        const pl = child as THREE.PointLight;
        // Skip bikeLight and underGlow which are already controlled
        if (pl === p.bikeLight || pl === p.underGlow) return;
        extraGlows.push(pl);
      }
    });
  });
  if (extraGlows.length) {
    trackSlider('vehicle', 'extraGlowInt', addSlider('frontRearGlow', extraGlows[0].intensity, 0, 5, 0.1, (v) => {
      extraGlows.forEach((l) => { l.intensity = v; });
    }));
  }

  // Beam spotlight
  const beam = player._beam;
  if (beam) {
    trackSlider('vehicle', 'beamInt', addSlider('beam', beam.intensity, 0, 8, 0.1, (v) => {
      allPlayers.forEach((p) => { if (p._beam) p._beam.intensity = v; });
    }));
    trackSlider('vehicle', 'beamDist', addSlider('beamDist', beam.distance, 0, 60, 1, (v) => {
      allPlayers.forEach((p) => { if (p._beam) p._beam.distance = v; });
    }));
  }

  // Proximity aura
  if (player.proximityAura) {
    trackSlider('vehicle', 'proxAuraDist', addSlider('proxDist', player.proximityAura.distance, 0, 30, 0.5, (v) => {
      allPlayers.forEach((p) => { if (p.proximityAura) p.proximityAura.distance = v; });
    }));
  }
}
