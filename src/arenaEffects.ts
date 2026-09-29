import * as THREE from 'three';
import type { GfxSettings } from './types/index';
import { getGfx } from './graphics';
import { getArenaReactive } from './grid';
import {
  type ArenaAudioPass,
  updateFlowTexture,
  updateLaserBeams,
  updateGridColor,
  updateFloorKickV1,
  updateBarriers,
  updateV2FloodLights,
  updateV2GlowCyan,
  updateV2FloorKick,
  updateV2WallBody,
  updateAccentRings,
  updateTierStrips,
  updateStadiumLights,
  updateRaveSpots,
  updateV2Windows,
  updateV2Structures,
  updateSpectatorDrone,
  updateSatellites,
  updateFlyoverShips,
  updateFireworks,
  updateStarTwinkle,
} from './arenaAudio';

// ── Arena constants (local copies — avoids circular-import TDZ with grid.ts) ──
const ARENA_PANEL_TEAL = 0x0E161D;
const ARENA_TEAL_BRIGHT = 0x1C4350;
const ARENA_CYAN_HERO = 0x63E8FF;
const ARENA_ORANGE_DEEP = 0xD84E12;
const ARENA_GOLD = 0xFFB020;
const ARENA_ORANGE = 0xFF7A1A;
const ARENA_MIST = 0xE8F7FF;
const ARENA_SIZE = 384;
const HALF = ARENA_SIZE / 2;


// ── Curated Palette ──────────────────────────────────────
// Cool cinematic tones that cycle slowly. Each entry is [H, S, L] in 0-1 range.
// Deep Teal → Medium Teal → Blue-Teal → Gold → Orange → Cyan → back
const PALETTE: number[] = [
  ARENA_PANEL_TEAL,
  ARENA_TEAL_BRIGHT,
  ARENA_CYAN_HERO,
  ARENA_ORANGE_DEEP,
  ARENA_GOLD,
  ARENA_ORANGE,
  ARENA_PANEL_TEAL,
];
const CYCLE_DURATION: number = 45; // seconds per full palette loop

function _interpolatePalette(timeOffset: number): { from: number; to: number; mix: number } {
  const t: number = ((performance.now() / 1000 + timeOffset) % CYCLE_DURATION) / CYCLE_DURATION;
  const idx: number = t * PALETTE.length;
  const from: number = Math.floor(idx) % PALETTE.length;
  const to: number = (from + 1) % PALETTE.length;
  const mix: number = idx - Math.floor(idx);
  return { from, to, mix };
}

const _palTemp: THREE.Color = new THREE.Color();
const _palBrightTemp: THREE.Color = new THREE.Color();
const _palFromTemp: THREE.Color = new THREE.Color();
const _palToTemp: THREE.Color = new THREE.Color();

export function getPaletteColor(timeOffset: number): THREE.Color {
  const { from, to, mix } = _interpolatePalette(timeOffset);
  _palFromTemp.setHex(PALETTE[from]);
  _palToTemp.setHex(PALETTE[to]);
  return _palTemp.copy(_palFromTemp).lerp(_palToTemp, mix);
}

export function getPaletteColorBright(timeOffset: number): THREE.Color {
  return _palBrightTemp.copy(getPaletteColor(timeOffset)).lerp(_palToTemp.setHex(ARENA_MIST), 0.18);
}

// ── Interfaces ───────────────────────────────────────────

export interface AudioBands {
  bass: number;
  lowMid: number;
  mid: number;
  upperMid: number;
  presence: number;
  energy: number;
  kick: number;
}

export interface CountdownRing {
  mesh: THREE.Line;
  mat: THREE.LineBasicMaterial;
  geo: THREE.BufferGeometry;
  scene: THREE.Scene;
  t: number;
  maxRadius: number;
  speed: number;
  baseOpacity: number;
}

// ── Audio Reactivity Update ──────────────────────────────
export function updateArenaAudio(bands: AudioBands, dt: number = 0.016, _gameState: string = 'playing'): void {
  const reactive = getArenaReactive();
  if (!reactive) return;
  const gfx: GfxSettings = getGfx();

  const now: number = performance.now() / 1000;
  const pass: ArenaAudioPass = { reactive, gfx, bands, now, dt };

  // Scroll flow texture on barrier walls (always — cheap)
  updateFlowTexture(pass);

  // Off = only flow texture, skip all material updates
  if (gfx.audioReactivity === 'off') return;

  // Laser beams: pulse with music and cycle color
  updateLaserBeams(pass);

  // Cycling palette colors
  const accentColor: THREE.Color = getPaletteColor(0);

  // Grid: color shifts with palette + bass
  updateGridColor(pass, accentColor);

  // Floor: emissive pulse on kicks via reflector shader
  updateFloorKickV1(pass);

  // Barrier walls: gentle opacity pulse with mid
  updateBarriers(pass);

  // ── arena_v2 reduced-level reactivity ────────────────────
  updateV2FloodLights(pass);
  updateV2GlowCyan(pass);
  updateV2FloorKick(pass);
  updateV2WallBody(pass);

  // Tier strips + stadium lights: cheap emissive updates, always run
  updateTierStrips(pass);
  updateStadiumLights(pass);

  // Cheap emissive-only updates — just intensity changes, no geometry
  updateAccentRings(pass);
  updateV2Windows(pass);
  updateV2Structures(pass);
  updateStarTwinkle(pass);

  // Reduced reactivity stops here — everything below moves geometry or spawns particles
  if (gfx.audioReactivity !== 'full') return;

  // ── Full reactivity only ──────────────────────────────
  updateRaveSpots(pass);
  updateSpectatorDrone(pass);
  updateSatellites(pass);
  updateFlyoverShips(pass);
  updateFireworks(pass);
}

// ── Countdown Ground Pulse ──────────────────────────────
let countdownRings: CountdownRing[] = [];

// num: 3=first beat, 2=second, 1=third, 0=GO
export function triggerCountdownPulse(scene: THREE.Scene, num: number): void {
  const color: number = 0x49A2B2;
  // 3→1 ring, 2→2 rings, 1→3 rings, GO→3 rings
  const ringCount: number = num === 3 ? 1 : num === 2 ? 2 : 3;
  const baseOpacity: number = num === 0 ? 0.08 : 0.25;
  const maxR: number = HALF * 1.6;

  for (let i = 0; i < ringCount; i++) {
    // Circle line — clean thin ring, scaled up smoothly
    const segments: number = 128;
    const points: THREE.Vector3[] = [];
    for (let s = 0; s <= segments; s++) {
      const a: number = (s / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const geo: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const mat: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      linewidth: 1,
    });
    const line: THREE.Line = new THREE.Line(geo, mat);
    line.position.y = 0.05;
    line.scale.set(0.01, 0.01, 0.01);
    scene.add(line);
    countdownRings.push({
      mesh: line, mat, geo, scene,
      t: -i * 0.12,
      maxRadius: maxR,
      speed: 0.95,
      baseOpacity,
    });
  }

  // (floor flash removed — too bright with bloom)
}

export function clearCountdownPulses(): void {
  for (const r of countdownRings) {
    r.scene.remove(r.mesh);
    r.geo.dispose();
    r.mat.dispose();
  }
  countdownRings = [];
}

export function updateCountdownPulses(dt: number): void {
  for (let i = countdownRings.length - 1; i >= 0; i--) {
    const r: CountdownRing = countdownRings[i];
    r.t += dt * r.speed;
    if (r.t < 0) { r.mesh.visible = false; continue; }

    r.mesh.visible = true;
    const frac: number = Math.min(r.t, 1);
    // Ease-out for smooth expansion
    const eased: number = 1 - (1 - frac) * (1 - frac);
    const scale: number = eased * r.maxRadius;
    r.mesh.scale.set(scale, scale, scale);

    // Fade: full opacity near center, gone by arena walls
    const wallFade: number = Math.max(0, 1 - (eased * r.maxRadius) / (HALF * 0.85));
    r.mat.opacity = wallFade * r.baseOpacity;

    if (r.t >= 1) {
      r.scene.remove(r.mesh);
      r.geo.dispose();
      r.mat.dispose();
      countdownRings.splice(i, 1);
    }
  }
}
