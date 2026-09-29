import * as THREE from 'three';
import type { GfxSettings } from './types/index';
import { bloomMul } from './graphics';
import { PLAYER_COLORS } from './playerColors';
import {
  type TierStrip,
  type SatelliteEntry,
  type FlyoverShipEntry,
  type SpectatorDrone,
  type RaveSpot,
  type ReactiveState,
  forEachStandardMaterial,
  setArenaRoleReactiveIntensity,
  FLOOD_LIGHT_SETTINGS,
} from './grid';
import { getPaletteColor, getPaletteColorBright, type AudioBands } from './arenaEffects';
export { updateSpectatorDrone } from './arena/spectatorDroneAnim';

// ── Arena constants (local copies — keep in sync with arenaEffects.ts) ──
const ARENA_TEAL_BRIGHT = 0x1C4350;
const ARENA_CYAN_HERO = 0x63E8FF;
const ARENA_ORANGE = 0xFF7A1A;

const STAND_COLORS: THREE.Color[] = PLAYER_COLORS
  .filter(c => c.key !== 'green' && c.key !== 'white')
  .map(c => new THREE.Color(c.color));

// Scratch temps (module-local to avoid interfering with arenaEffects temps)
const _palTemp: THREE.Color = new THREE.Color();
const _palBrightTemp: THREE.Color = new THREE.Color();

/**
 * Per-frame audio-reactive context passed to each layer helper.
 * All values are computed once at the start of the pass by updateArenaAudio().
 */
export interface ArenaAudioPass {
  reactive: ReactiveState;
  gfx: GfxSettings;
  bands: AudioBands;
  now: number;
  dt: number;
}

// ── Always-on layer ──────────────────────────────────────
export function updateFlowTexture(pass: ArenaAudioPass): void {
  const { reactive, bands } = pass;
  if (reactive.flowTexture) {
    reactive.flowTexture.offset.x += 0.004 + bands.bass * 0.004;
  }
}

// ── Full-level layers that run before reduced cutoff ─────
export function updateLaserBeams(pass: ArenaAudioPass): void {
  const { reactive, gfx, bands, now } = pass;
  if (gfx.audioReactivity === 'full' && reactive.laserBeams) {
    const laserColor: THREE.Color = getPaletteColorBright(2);
    const laserOp: number = 0.12 + bands.energy * 0.15;
    reactive.laserBeams.forEach((line: THREE.Line, i: number) => {
      (line.material as THREE.LineBasicMaterial).color.copy(laserColor);
      (line.material as THREE.LineBasicMaterial).opacity = laserOp + Math.sin(now * 2 + i * 0.3) * 0.03;
    });
  }
}

export function updateGridColor(pass: ArenaAudioPass, accentColor: THREE.Color): void {
  const { reactive, bands } = pass;
  if (reactive.gridMain) {
    // GridHelper always uses LineBasicMaterial; .material is Material | Material[],
    // so we take the first entry (center-line) which carries the color property.
    const gridMatRaw = Array.isArray(reactive.gridMain.material)
      ? reactive.gridMain.material[0]
      : reactive.gridMain.material;
    (gridMatRaw as THREE.LineBasicMaterial).color.copy(accentColor).multiplyScalar(0.5 + bands.bass * 0.3);
  }
}

export function updateFloorKickV1(pass: ArenaAudioPass): void {
  const { reactive, bands } = pass;
  if (reactive.reflector) {
    const rMat = reactive.reflector.material as THREE.ShaderMaterial;
    if (rMat.uniforms['uFloorEmissiveIntensity']) {
      // Only modulate intensity on kicks — don't copy accentColor into floor emissive
      rMat.uniforms['uFloorEmissiveIntensity'].value = (0.3 + bands.kick * 0.4) * bloomMul.environment;
    }
  }
}

export function updateBarriers(pass: ArenaAudioPass): void {
  const { reactive, bands } = pass;
  reactive.barriers.forEach((wall: THREE.Mesh) => {
    (wall.material as THREE.MeshBasicMaterial).opacity = 0.8 + bands.mid * 0.2;
  });
}

// ── arena_v2 reduced-level layers ────────────────────────
export function updateV2FloodLights(pass: ArenaAudioPass): void {
  const { reactive, bands } = pass;
  if (reactive.v2FloodLights.length) {
    reactive.v2FloodLights.forEach((mesh: THREE.Mesh, i: number) => {
      const c: THREE.Color = i % 2 === 0 ? _palTemp.setHex(ARENA_ORANGE) : _palBrightTemp.setHex(ARENA_TEAL_BRIGHT);
      forEachStandardMaterial(mesh, (mat) => {
        mat.emissive.copy(c);
      });
      setArenaRoleReactiveIntensity(
        mesh,
        i % 2 === 0 ? 'floodWarm' : 'floodCool',
        (i % 2 === 0
          ? FLOOD_LIGHT_SETTINGS.warmPulseBase + bands.kick * FLOOD_LIGHT_SETTINGS.warmPulseKick + bands.bass * FLOOD_LIGHT_SETTINGS.warmPulseBass
          : FLOOD_LIGHT_SETTINGS.coolPulseBase + bands.kick * FLOOD_LIGHT_SETTINGS.coolPulseKick + bands.bass * FLOOD_LIGHT_SETTINGS.coolPulseBass
        ) * bloomMul.lights,
      );
    });
  }
}

export function updateV2GlowCyan(pass: ArenaAudioPass): void {
  const { reactive, bands } = pass;
  if (reactive.v2GlowCyan.length) {
    reactive.v2GlowCyan.forEach((mesh: THREE.Mesh) => {
      setArenaRoleReactiveIntensity(mesh, 'trimCyan', (0.12 + bands.bass * 0.05) * bloomMul.environment);
    });
  }
}

export function updateV2FloorKick(pass: ArenaAudioPass): void {
  const { reactive, bands } = pass;
  if (reactive.reflector) {
    const rMat = reactive.reflector.material as THREE.ShaderMaterial;
    if (rMat.uniforms['uFloorEmissiveIntensity']) {
      rMat.uniforms['uFloorEmissiveIntensity'].value = (0.42 + bands.kick * 0.12) * bloomMul.environment;
    }
  }
}

export function updateV2WallBody(pass: ArenaAudioPass): void {
  const { reactive, bands } = pass;
  if (reactive.v2WallBody.length) {
    reactive.v2WallBody.forEach((mesh: THREE.Mesh) => {
      setArenaRoleReactiveIntensity(mesh, 'wallBodyDark', (0.03 + bands.bass * 0.015) * bloomMul.environment);
    });
  }
}

// ── Full-level layers (gated by audioReactivity === 'full') ──
export function updateAccentRings(pass: ArenaAudioPass): void {
  const { reactive, bands } = pass;
  if (reactive.accentRings.length) {
    reactive.accentRings.forEach((ring: THREE.Mesh, i: number) => {
      const c: THREE.Color = getPaletteColor(i * 5);
      (ring.material as THREE.MeshStandardMaterial).color.copy(c);
      (ring.material as THREE.MeshStandardMaterial).emissive.copy(c);
      (ring.material as THREE.MeshStandardMaterial).emissiveIntensity = (0.6 + bands.energy * 1.0 + bands.kick * 0.5) * bloomMul.environment;
    });
  }
}

export function updateTierStrips(pass: ArenaAudioPass): void {
  const { reactive, bands, now } = pass;
  reactive.tierStrips.forEach(({ mesh, tier, baseIntensity, phase, drift }: TierStrip) => {
    const bandMap: number[] = [bands.bass, bands.lowMid, bands.mid, bands.upperMid, bands.presence, bands.energy];
    const bandVal: number = bandMap[tier % bandMap.length];
    const stripColor: THREE.Color = STAND_COLORS[tier % STAND_COLORS.length];
    (mesh.material as THREE.MeshStandardMaterial).color.copy(stripColor);
    (mesh.material as THREE.MeshStandardMaterial).emissive.copy(stripColor);
    (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = (baseIntensity * 0.6 + bandVal * 1.0) * bloomMul.environment;
    const randomDrift: number = 0.15 + Math.sin(now * drift + phase) * 0.08;
    mesh.scale.y = randomDrift + bandVal * 3.0;
  });
}

export function updateStadiumLights(pass: ArenaAudioPass): void {
  const { reactive, bands } = pass;
  reactive.stadLights.forEach((l: THREE.PointLight, i: number) => {
    l.color.copy(getPaletteColor(i * 7 + 3));
    const bandMap: number[] = [bands.bass, bands.mid, bands.upperMid, bands.energy];
    l.intensity = (1.0 + bandMap[i % 4] * 2.0) * bloomMul.lights;
  });
}

// ── Rave Spotlights (sweep-to-center, pulse, hold) ──────
// Each spot sweeps from its side toward center, pulses in place,
// returns to side — twice — then holds at rest.  BLUE↔ORANGE by position.
//
// Timeline per cycle:
//   pulse1: side → center → side     (PULSE_DUR)
//   pulse2: side → center → side     (PULSE_DUR)
//   hold:   ease to rest → dwell     (EASE_DUR + HOLD_DUR)
//   return: ease back to side        (EASE_DUR)
//   → seamless loop (starts at side again)
export function updateRaveSpots(pass: ArenaAudioPass): void {
  const { reactive, bands, now } = pass;
  if (!reactive.raveSpots.length) return;

  const PULSE_DUR: number = 3.0;   // one full side→center→side pulse
  const EASE_DUR: number = 1.2;    // transition side ↔ rest
  const HOLD_DUR: number = 3.0;    // dwell at rest angle
  const CYCLE_T: number = PULSE_DUR * 2 + EASE_DUR + HOLD_DUR + EASE_DUR;
  const SWEEP_ARC: number = 0.6;   // radians from center to side

  const _blue: THREE.Color = new THREE.Color(ARENA_CYAN_HERO);
  const _orange: THREE.Color = new THREE.Color(ARENA_ORANGE);
  const _spotMix: THREE.Color = new THREE.Color();

  reactive.raveSpots.forEach((spot: RaveSpot) => {
    const side: number = spot.sweepDir * SWEEP_ARC;
    const raw: number = (now * spot.speed + spot.phase) % CYCLE_T;
    let sweepAngle: number;

    const t1: number = PULSE_DUR;                      // end pulse 1
    const t2: number = t1 + PULSE_DUR;                 // end pulse 2
    const t3: number = t2 + EASE_DUR;                  // end ease to rest
    const t4: number = t3 + HOLD_DUR;                  // end hold
    // t4..CYCLE_T = ease back to side

    if (raw < t1) {
      // Pulse 1: side → center → side (cosine — starts & ends at side)
      const p: number = raw / PULSE_DUR;
      sweepAngle = side * (0.5 + 0.5 * Math.cos(p * Math.PI * 2));
    } else if (raw < t2) {
      // Pulse 2: same pattern
      const p: number = (raw - t1) / PULSE_DUR;
      sweepAngle = side * (0.5 + 0.5 * Math.cos(p * Math.PI * 2));
    } else if (raw < t3) {
      // Ease: side → rest angle
      const p: number = (raw - t2) / EASE_DUR;
      const ease: number = 0.5 - 0.5 * Math.cos(p * Math.PI);
      sweepAngle = side + (spot.restAngle - side) * ease;
    } else if (raw < t4) {
      // Hold at rest
      sweepAngle = spot.restAngle;
    } else {
      // Ease: rest → side (ready for next loop)
      const p: number = (raw - t4) / EASE_DUR;
      const ease: number = 0.5 - 0.5 * Math.cos(p * Math.PI);
      sweepAngle = spot.restAngle + (side - spot.restAngle) * ease;
    }

    const a: number = spot.baseAngle + sweepAngle;
    const tx: number = Math.sin(a) * spot.radius;
    const tz: number = Math.cos(a) * spot.radius;
    spot.light.target.position.set(tx, 0, tz);
    spot.light.intensity = (2.0 + bands.energy * 3.0 + bands.bass * 1.5) * bloomMul.lights;

    // Color: BLUE at center (0), ORANGE at extremes (±SWEEP_ARC)
    const colorT: number = Math.min(1, Math.abs(sweepAngle) / SWEEP_ARC);
    _spotMix.copy(_blue).lerp(_orange, colorT);
    spot.light.color.copy(_spotMix);
  });
}

// ── arena_v2 full-level layers ──────────────────────────
export function updateV2Windows(pass: ArenaAudioPass): void {
  const { reactive, bands, now } = pass;
  if (reactive.v2Windows.length) {
    reactive.v2Windows.forEach((mesh: THREE.Mesh, i: number) => {
      const band: number = i % 2 === 0 ? bands.presence : bands.upperMid;
      const flicker: number = Math.sin(now * 4 + i * 2.5) * 0.5 + 0.5;
      setArenaRoleReactiveIntensity(mesh, 'windowPanelsCool', (0.4 + band * 0.04 * (0.55 + flicker * 0.45)) * bloomMul.environment);
    });
  }
}

export function updateV2Structures(pass: ArenaAudioPass): void {
  const { reactive, bands } = pass;

  // Arena wall: subtle energy pulse (don't override color)
  if (reactive.v2ArenaWall.length) {
    reactive.v2ArenaWall.forEach((mesh: THREE.Mesh) => {
      setArenaRoleReactiveIntensity(mesh, 'heroWallWarm', (0.20 + bands.energy * 0.08) * bloomMul.environment);
    });
  }

  // Crowd stands: very subtle energy pulse (don't override color)
  if (reactive.v2CrowdStands.length) {
    reactive.v2CrowdStands.forEach((mesh: THREE.Mesh) => {
      setArenaRoleReactiveIntensity(mesh, 'standDark', (0.02 + bands.energy * 0.015) * bloomMul.environment);
    });
  }

  // Buildings/facades: very subtle energy pulse (don't override color)
  if (reactive.v2SkylineEdges.length) {
    reactive.v2SkylineEdges.forEach((mesh: THREE.Mesh) => {
      setArenaRoleReactiveIntensity(mesh, 'skylineEdges', (0.3 + bands.energy * 0.08) * bloomMul.environment);
    });
  }
  if (reactive.v2BuildingFaces.length) {
    reactive.v2BuildingFaces.forEach((mesh: THREE.Mesh) => {
      setArenaRoleReactiveIntensity(mesh, 'buildingFaceTeal', (0.08 + bands.energy * 0.03) * bloomMul.environment);
    });
  }
  if (reactive.v2BuildingAccentWindows.length) {
    reactive.v2BuildingAccentWindows.forEach((mesh: THREE.Mesh, i: number) => {
      setArenaRoleReactiveIntensity(mesh, i % 10 === 0 ? 'accentWindowWarm' : 'buildingWindowCool', ((i % 10 === 0 ? 0.20 : 0.16) + bands.energy * 0.05) * bloomMul.environment);
    });
  }
}

// ── Animate Satellites ──────────────────────────────────
export function updateSatellites(pass: ArenaAudioPass): void {
  const { reactive, now } = pass;
  if (reactive.satellites) {
    reactive.satellites.forEach(({ mesh, orbitR, orbitY, orbitSpeed, startAngle, blink }: SatelliteEntry) => {
      const a: number = startAngle + now * orbitSpeed;
      mesh.position.set(Math.cos(a) * orbitR, orbitY, Math.sin(a) * orbitR);
      mesh.rotation.y = a;
      // Blinking light
      blink.intensity = Math.sin(now * 3 + startAngle) > 0.8 ? 1.5 : 0.1;
    });
  }
}

// ── Animate Flyover Ships ─────────────────────────────
export function updateFlyoverShips(pass: ArenaAudioPass): void {
  const { reactive, now } = pass;
  if (reactive.flyoverShips) {
    reactive.flyoverShips.forEach(({ mesh, orbitR, orbitY, orbitSpeed, startAngle }: FlyoverShipEntry) => {
      const a: number = startAngle + now * orbitSpeed;
      mesh.position.set(
        Math.cos(a) * orbitR,
        orbitY + Math.sin(now * 0.2 + startAngle) * 3,
        Math.sin(a) * orbitR
      );
      mesh.rotation.y = -a + Math.PI / 2;
    });
  }
}

// ── Animate Fireworks ──────────────────────────────────
export function updateFireworks(pass: ArenaAudioPass): void {
  pass.reactive.fireworks?.step(pass.dt);
}

// ── Star Twinkle (GPU-driven via ShaderMaterial uTime) ──
export function updateStarTwinkle(pass: ArenaAudioPass): void {
  const { reactive, gfx } = pass;
  if (reactive.starMaterial && gfx.arenaDetail !== 'minimal') {
    reactive.starMaterial.uniforms.uTime.value = performance.now() * 0.001;
  }
}
