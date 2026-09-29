// ── Admin Panel: QUICK MIX Master Controls ──────────────
// Master sliders that drive multiple underlying values at once for rapid
// scene iteration. Randomize / reset / expand / collapse all.

import * as THREE from 'three';
import {
  addHeader,
  addSlider,
  trackSlider,
  addMiniActionRow,
  addLabel,
  resetAll,
  expandAllSections,
  collapseAllSections,
} from './helpers';
import { getGfx, MAP_TUNING } from '../graphics';
import { getArenaReactive } from '../grid';
import { initAdminPanel } from '../adminPanel';
import type { GameLike } from '../adminPanel';

// ── Baseline snapshot ──────────────────────────────────
// Captured on first panel open so master sliders scale relative to the
// scene's current state rather than hard-coded defaults.

interface Baselines {
  floorReflectStrength: number;
  floorRoughness: number;
  reflectionsIntensity: number;
  bloomStrength: number;
  environmentMul: number;
  vehiclesMul: number;
  trailsMul: number;
  lightsMul: number;
  fogDensity: number;
}

let _baselines: Baselines | null = null;

function captureBaselines(gameRef: GameLike | null): Baselines {
  const reactive = getArenaReactive();
  const currentMap = reactive?.mapType ?? 'midtown_bowl';
  const mt = MAP_TUNING[currentMap];
  const gfx = getGfx();
  const fog = gameRef?.scene?.fog as THREE.FogExp2 | null;

  return {
    floorReflectStrength: mt.floorReflectStrength,
    floorRoughness: mt.floorRoughness,
    reflectionsIntensity: mt.reflectionsIntensity,
    bloomStrength: gameRef?.bloomPass?.strength ?? gfx.bloom.strength,
    environmentMul: gfx.bloom.environmentMul,
    vehiclesMul: gfx.bloom.vehiclesMul,
    trailsMul: gfx.bloom.trailsMul,
    lightsMul: gfx.bloom.lightsMul,
    fogDensity: fog?.density ?? 0.004,
  };
}

// ── Helpers ────────────────────────────────────────────

/** Linear remap: slider 0→0x, 50→1x, 100→2x */
function masterFactor(value: number): number {
  return value / 50;
}

function randRange(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

// ── Public entry ───────────────────────────────────────

export function addMasterControlsSection(
  _panel: HTMLDivElement,
  gameRef: GameLike | null,
): void {
  const reactive = getArenaReactive();
  const currentMap = reactive?.mapType ?? 'midtown_bowl';
  const mt = MAP_TUNING[currentMap];
  const gfx = getGfx();

  // Capture baselines once per panel lifecycle
  if (!_baselines) _baselines = captureBaselines(gameRef);
  const bl = _baselines;

  addHeader('QUICK MIX', 'quickmix');

  // ── Master Reflectivity (0-100, default 50) ──────────
  if (reactive?.reflector) {
    const rMat = reactive.reflector.material as THREE.ShaderMaterial;
    trackSlider('quickmix', 'reflectivity', addSlider('Reflectivity', 50, 0, 100, 1, (v) => {
      const f = masterFactor(v);
      const newStrength = Math.min(bl.floorReflectStrength * f, 1);
      const newIntensity = Math.min(bl.reflectionsIntensity * f, 1);
      // Roughness is inverse — higher reflectivity means lower roughness
      const newRoughness = Math.max(bl.floorRoughness * (2 - f), 0);

      mt.floorReflectStrength = newStrength;
      mt.reflectionsIntensity = newIntensity;
      mt.floorRoughness = Math.min(newRoughness, 1);

      rMat.uniforms['uReflectStrength'].value = newStrength;
      rMat.uniforms['uRoughness'].value = mt.floorRoughness;
      rMat.uniforms['color'].value.setScalar(newIntensity);
    }));
  } else {
    addLabel('(reflectivity: need high/ultra preset)');
  }

  // ── Master Bloom (0-100, default 50) ─────────────────
  trackSlider('quickmix', 'bloom', addSlider('Bloom', 50, 0, 100, 1, (v) => {
    const f = masterFactor(v);
    const newStrength = Math.min(bl.bloomStrength * f, 10);
    if (gameRef?.bloomPass) {
      gameRef.bloomPass.strength = newStrength;
    }
  }));

  // ── Master Emissive (0-100, default 50) ──────────────
  trackSlider('quickmix', 'emissive', addSlider('Emissive', 50, 0, 100, 1, (v) => {
    const f = masterFactor(v);
    gfx.bloom.environmentMul = bl.environmentMul * f;
    gfx.bloom.vehiclesMul = bl.vehiclesMul * f;
    gfx.bloom.trailsMul = bl.trailsMul * f;
    gfx.bloom.lightsMul = bl.lightsMul * f;
  }));

  // ── Master Atmosphere (0-100, default 50) ────────────
  const fog = gameRef?.scene?.fog as THREE.FogExp2 | null;
  if (fog && fog.density !== undefined) {
    trackSlider('quickmix', 'atmosphere', addSlider('Atmosphere', 50, 0, 100, 1, (v) => {
      const f = masterFactor(v);
      fog.density = Math.min(bl.fogDensity * f, 0.01);
    }));
  } else {
    addLabel('(atmosphere: no fog active)');
  }

  // ── Action buttons ───────────────────────────────────
  addMiniActionRow([
    {
      label: 'RANDOMIZE',
      color: '#e8a735',
      onClick: () => {
        // Randomize MAP_TUNING for current map
        mt.floorReflectStrength = randRange(0.3, 1.0);
        mt.floorRoughness = randRange(0.1, 0.95);
        mt.reflectionsIntensity = randRange(0.05, 0.9);
        mt.reflectionsClipBias = randRange(0.001, 0.01);

        // Randomize bloom strength
        if (gameRef?.bloomPass) {
          gameRef.bloomPass.strength = randRange(1, 8);
        }

        // Randomize bloom category multipliers
        gfx.bloom.environmentMul = randRange(0.5, 2.5);
        gfx.bloom.vehiclesMul = randRange(0.5, 2.5);
        gfx.bloom.trailsMul = randRange(0.5, 2.5);
        gfx.bloom.lightsMul = randRange(0.5, 2.5);

        // Clear baselines so next panel build re-captures
        _baselines = null;
        initAdminPanel();
      },
    },
    {
      label: 'RESET ALL',
      color: '#ff6666',
      onClick: () => {
        _baselines = null;
        resetAll();
      },
    },
    {
      label: 'EXPAND ALL',
      color: '#49A2B2',
      onClick: () => { expandAllSections(); },
    },
    {
      label: 'COLLAPSE ALL',
      color: '#49A2B2',
      onClick: () => { collapseAllSections(); },
    },
  ]);
}

/** Called by destroyAdminPanel to clear cached baselines. */
export function clearMasterBaselines(): void {
  _baselines = null;
}
