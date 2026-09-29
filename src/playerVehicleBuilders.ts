// ── playerVehicleBuilders.ts ──────────────────────────────
// Pure-extraction of the bike/car/hoverboard construction helpers
// originally in playerVFX.ts. These build the visible mesh hierarchy
// and attach lights per quality preset. Behaviour unchanged.

import * as THREE from 'three';
import { getGfx, VISUAL_TUNING } from './graphics';
import { applyRimLight } from './shaders/vehicleRimLight';
import { cloneBikeModel, getBikeModelHeight } from './bikeModel';
import { cloneCarModel } from './carModel';
import { cloneHoverboardModel, getHoverboardModelHeight } from './hoverboardModel';
import { computeEmissiveColor, computeVehicleVisibilityBoost } from './emissiveUtils';
import type { BikeParts } from './playerVFX';

/** Read the current preset's rim-light params and apply to a vehicle clone. */
function applyVehicleRim(clone: THREE.Object3D, color: number, isAI: boolean, rimScale = 1): void {
  const vt = VISUAL_TUNING[getGfx().preset] ?? VISUAL_TUNING.high;
  const rimStrength = vt.rimStrength ?? 0;
  if (rimStrength === 0) return;
  // Dark colors land flat on the rim because Fresnel * tint is already low
  // luminance — boost strength by visibilityBoost (1.0 bright → ~1.8 very dark)
  // and use the saturated/brightened emissive tint so they pop as hard as bright hues.
  const { visibilityBoost } = computeVehicleVisibilityBoost(color);
  const strength = rimStrength * rimScale * (isAI ? (vt.rimAIMult ?? 0.7) : 1.0) * visibilityBoost;
  applyRimLight(clone, {
    strength,
    power: vt.rimPower ?? 2.8,
    tint: computeEmissiveColor(color),
  });
}

// ── Bike Builder ─────────────────────────────────────────
export function buildBike(group: THREE.Group, color: number, _emissive: number, isAI: boolean): BikeParts {
  // ── GLB BIKE MODEL ──────────────────────────────
  // Scale model height to match trail height (2.7).
  const BIKE_SCALE: number = 2.7 / getBikeModelHeight();
  const bikeClone: THREE.Group = cloneBikeModel(color);
  bikeClone.scale.setScalar(BIKE_SCALE / 1.05 * 1.1);
  group.add(bikeClone);
  applyVehicleRim(bikeClone, color, isAI, 0.75);

  // Boost emissive for darker colors
  const _emCol: THREE.Color = computeEmissiveColor(color);

  // ── ENGINE EXHAUST (behind bike rear) ─────────────
  // Bike rear at Z = -1.427 * BIKE_SCALE/1.05 ≈ -2.90
  const exGlowGeo: THREE.BoxGeometry = new THREE.BoxGeometry(0.5, 0.3, 0.15);
  const exGlowMat: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
    color: color, emissive: _emCol, emissiveIntensity: 1.4,
  });
  const exGlow: THREE.Mesh = new THREE.Mesh(exGlowGeo, exGlowMat);
  exGlow.position.set(0, 0.5, -3.0);
  group.add(exGlow);

  // ── HEADLIGHT ───────────────────────────────────
  // Bike front at Z = 1.419 * BIKE_SCALE/1.05 ≈ 2.88
  const gfx = getGfx();
  let beam: THREE.SpotLight | null = null;
  if (!isAI && gfx.lighting === 'full') {
    beam = new THREE.SpotLight(color, 2, 20, 0.35, 0.6);
    beam.position.set(0, 1.1, 2.9);
    beam.target.position.set(0, 0, 8);
    group.add(beam);
    group.add(beam.target);
  }

  // ── LIGHTING (scaled by quality) ──────────────────
  let bikeLight: THREE.PointLight | null = null;
  let underGlow: THREE.PointLight | null = null;
  let proximityAura: THREE.PointLight | null = null;

  if (gfx.lighting === 'minimal') {
    // Minimal: one reduced light for player only
    if (!isAI) {
      bikeLight = new THREE.PointLight(color, 0, 12);
      bikeLight.position.set(0, 1.8, -1.5);
      group.add(bikeLight);
    }
  } else if (gfx.lighting === 'reduced') {
    bikeLight = new THREE.PointLight(color, 0, isAI ? 10 : 16);
    bikeLight.position.set(0, 1.8, -1.5);
    group.add(bikeLight);
    if (!isAI) {
      underGlow = new THREE.PointLight(color, 0, 12);
      underGlow.position.set(0, 0.15, 0);
      group.add(underGlow);
    }
  } else {
    // Full
    bikeLight = new THREE.PointLight(color, 0, isAI ? 12 : 18);
    bikeLight.position.set(0, 1.8, -1.5);
    group.add(bikeLight);
    underGlow = new THREE.PointLight(color, 0, isAI ? 8 : 12);
    underGlow.position.set(0, 0.15, 0);
    group.add(underGlow);
    if (!isAI) {
      proximityAura = new THREE.PointLight(0xffffff, 0, 18);
      proximityAura.position.set(0, 1.5, 0);
      group.add(proximityAura);
    }
  }

  return { glow: exGlow, bikeLight, underGlow, proximityAura, beam, vehicleClone: bikeClone };
}

// ── Car Builder ──────────────────────────────────────────
export function buildCar(group: THREE.Group, color: number, _emissive: number, isAI: boolean): BikeParts {
  const CAR_SCALE: number = 2.0;
  const carClone: THREE.Group = cloneCarModel(color);
  carClone.scale.setScalar(CAR_SCALE / 1.05);
  group.add(carClone);
  applyVehicleRim(carClone, color, isAI);

  const emColor: THREE.Color = computeEmissiveColor(color);
  const { darkBoost: _darkBoost, visibilityBoost } = computeVehicleVisibilityBoost(color);

  // Engine exhaust glow (centered rear)
  const glowMat: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
    color: emColor,
    transparent: true,
    opacity: Math.min(1.12, 0.66 + _darkBoost * 0.3 + (visibilityBoost - 1) * 0.18),
  });
  const exGlow: THREE.Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), glowMat);
  exGlow.position.set(0, 0.8, 6.0);
  group.add(exGlow);

  let bikeLight: THREE.PointLight | null = null;
  let underGlow: THREE.PointLight | null = null;
  let proximityAura: THREE.PointLight | null = null;
  let beam: THREE.SpotLight | null = null;

  const gfx = getGfx().lighting;

  if (gfx !== 'minimal' || !isAI) {
    bikeLight = new THREE.PointLight(color, isAI ? 0.8 : 2.6, isAI ? 7 : 11);
    bikeLight.position.set(0, 1.5, 4.0);
    group.add(bikeLight);
  }

  if (gfx === 'full') {
    beam = new THREE.SpotLight(color, (isAI ? 1.0 : 3.0) * (1 + (visibilityBoost - 1) * 0.2), 30, 0.45, 0.7);
    beam.position.set(0, 1.0, 2.9);
    const target = new THREE.Object3D();
    target.position.set(0, 0, 8);
    group.add(target);
    beam.target = target;
    group.add(beam);
  }

  if (gfx !== 'minimal') {
    // Main underglow — wide and subtle, matching trail ground glow feel
    underGlow = new THREE.PointLight(color, isAI ? 0.8 : 1.1, isAI ? 14 : 22);
    underGlow.position.set(0, 0.08, 0);
    group.add(underGlow);
    // Front underglow — slightly forward for a gradual spread
    const frontGlow = new THREE.PointLight(color, (isAI ? 0.45 : 0.8) * (1 + (visibilityBoost - 1) * 0.55), isAI ? 12 : 18);
    frontGlow.position.set(0, 0.05, 3.5);
    group.add(frontGlow);
    // Rear underglow — exhaust area
    const rearGlow = new THREE.PointLight(color, (isAI ? 0.35 : 0.7) * (1 + (visibilityBoost - 1) * 0.65), isAI ? 10 : 16);
    rearGlow.position.set(0, 0.05, -3.0);
    group.add(rearGlow);
    if (!isAI) {
      proximityAura = new THREE.PointLight(0xffffff, 0, 18);
      proximityAura.position.set(0, 1.5, 0);
      group.add(proximityAura);
    }
  }

  return { glow: exGlow, bikeLight, underGlow, proximityAura, beam, vehicleClone: carClone };
}

// ── Hoverboard Builder ──────────────────────────────────
export function buildHoverboard(group: THREE.Group, color: number, _emissive: number, isAI: boolean): BikeParts {
  const HOVER_SCALE: number = 2.7 / getHoverboardModelHeight();
  const hoverClone: THREE.Group = cloneHoverboardModel(color);
  hoverClone.scale.setScalar(HOVER_SCALE / 1.05);
  hoverClone.position.y = 0.15;
  group.add(hoverClone);
  applyVehicleRim(hoverClone, color, isAI);

  const emColor: THREE.Color = computeEmissiveColor(color);
  const { darkBoost: _darkBoost, visibilityBoost } = computeVehicleVisibilityBoost(color);

  const glowMat: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
    color: emColor, transparent: true, opacity: Math.min(1, 0.5 + _darkBoost * 0.24 + (visibilityBoost - 1) * 0.12),
  });
  const exGlow: THREE.Mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), glowMat);
  exGlow.position.set(0, 0.2, -2.0);
  group.add(exGlow);

  let bikeLight: THREE.PointLight | null = null;
  let underGlow: THREE.PointLight | null = null;
  let proximityAura: THREE.PointLight | null = null;
  let beam: THREE.SpotLight | null = null;

  const gfx = getGfx().lighting;

  if (gfx !== 'minimal' || !isAI) {
    bikeLight = new THREE.PointLight(color, isAI ? 0.6 : 2.0, isAI ? 6 : 10);
    bikeLight.position.set(0, 1.2, 0);
    group.add(bikeLight);
  }

  if (gfx === 'full' && !isAI) {
    beam = new THREE.SpotLight(color, 1.5 * (1 + (visibilityBoost - 1) * 0.18), 18, 0.4, 0.6);
    beam.position.set(0, 0.8, 1.5);
    const target = new THREE.Object3D();
    target.position.set(0, 0, 8);
    group.add(target);
    beam.target = target;
    group.add(beam);
  }

  if (gfx !== 'minimal') {
    underGlow = new THREE.PointLight(color, isAI ? 0.6 : 1.0, isAI ? 12 : 18);
    underGlow.position.set(0, 0.05, 0);
    group.add(underGlow);
    if (!isAI) {
      proximityAura = new THREE.PointLight(0xffffff, 0, 18);
      proximityAura.position.set(0, 1.2, 0);
      group.add(proximityAura);
    }
  }

  return { glow: exGlow, bikeLight, underGlow, proximityAura, beam, vehicleClone: hoverClone };
}
