import * as THREE from 'three';
import { PLAYER_COLORS } from '../playerColors';
import type { MapType } from '../types/index';

// ── Stand Colors — fixed subset from vehicle palette (no green), in rainbow order ──
export const STAND_COLORS: THREE.Color[] = PLAYER_COLORS
  .filter(c => c.key !== 'green' && c.key !== 'white')
  .map(c => new THREE.Color(c.color));

export const ARENA_BLACK = 0x04070B;
export const ARENA_PANEL_TEAL = 0x0E161D;
export const ARENA_TEAL = 0x14232D;
export const ARENA_TEAL_BRIGHT = 0x1C4350;
export const ARENA_CYAN_HERO = 0x63E8FF;
export const ARENA_ORANGE = 0xFF7A1A;
export const ARENA_ORANGE_DEEP = 0xD84E12;
export const ARENA_GOLD = 0xFFB020;
// ts-prune-ignore-next
export const ARENA_GOLD_DEEP = 0xB96E16;
export const ARENA_MIST = 0xE8F7FF;

export function forEachStandardMaterial(
  mesh: THREE.Mesh,
  fn: (mat: THREE.MeshStandardMaterial, materialIndex: number) => void,
): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material, materialIndex) => {
    const mat = material as THREE.MeshStandardMaterial;
    if (!mat.isMeshStandardMaterial) return;
    fn(mat, materialIndex);
    mat.needsUpdate = true;
  });
}

/** Custom Reflector shader that adds floor base-color and emissive tint
 *  so the Reflector can serve as the visible floor surface. */
export const FloorReflectorShader = {
  name: 'FloorReflectorShader',
  uniforms: {
    'color': { value: null },
    'tDiffuse': { value: null },
    'textureMatrix': { value: null },
    'uFloorBase': { value: new THREE.Color(0x05080C) },
    'uFloorEmissive': { value: new THREE.Color(0x0D1820) },
    'uFloorEmissiveIntensity': { value: 1.33 },
    'uReflectStrength': { value: 1.0 },
    'uRoughness': { value: 0.93 },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform vec3 uFloorBase;
    uniform vec3 uFloorEmissive;
    uniform float uFloorEmissiveIntensity;
    uniform float uReflectStrength;
    uniform float uRoughness;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>

    void main() {
      #include <logdepthbuf_fragment>
      vec4 reflectSample = texture2DProj( tDiffuse, vUv );
      // Multiply tint — never amplifies, keeps natural colors
      vec3 reflected = reflectSample.rgb * color;
      // Roughness dims reflection — 0 = mirror, 1 = fully matte
      reflected *= (1.0 - uRoughness);
      vec3 floor = uFloorBase + uFloorEmissive * uFloorEmissiveIntensity;
      gl_FragColor = vec4( mix( floor, reflected, uReflectStrength ), 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export const FLOOD_LIGHT_SETTINGS = {
  toneMapped: true,
  roughnessMax: 0.42,
  warmBaseEmissive: 1.49,
  coolBaseEmissive: 1.70,
  warmPulseBase: 1.54,
  warmPulseKick: 1.5,
  warmPulseBass: 0.55,
  coolPulseBase: 1.57,
  coolPulseKick: 1.03,
  coolPulseBass: 0.51,
};

export type ArenaVisualRoleId =
  | 'glowBlue'
  | 'wallBodyDark'
  | 'standDark'
  | 'floorBase'
  | 'buildingFaceTeal'
  | 'trimCyan'
  | 'floodCool'
  | 'skylineEdges'
  | 'floodWarm'
  | 'heroWallWarm'
  | 'windowPanelsCool'
  | 'buildingWindowCool'
  | 'accentWindowWarm';

interface ArenaVisualRole {
  colorHex: number;
  emissiveHex: number;
  baseIntensity: number;
  reactiveMax: number;
}

export const ARENA_VISUAL_ROLES: Record<ArenaVisualRoleId, ArenaVisualRole> = {
  glowBlue: { colorHex: 0xFFFFFF, emissiveHex: 0xd84e12, baseIntensity: 2, reactiveMax: 0 },
  wallBodyDark: { colorHex: ARENA_BLACK, emissiveHex: 0x925920, baseIntensity: 0.27, reactiveMax: 0.03 },
  standDark: { colorHex: ARENA_BLACK, emissiveHex: 0x000000, baseIntensity: 1.45, reactiveMax: 1.43 },
  floorBase: { colorHex: ARENA_BLACK, emissiveHex: 0x808b93, baseIntensity: 0, reactiveMax: 0.77 },
  buildingFaceTeal: { colorHex: ARENA_PANEL_TEAL, emissiveHex: 0xaf8664, baseIntensity: 0.08, reactiveMax: 0.16 },
  trimCyan: { colorHex: ARENA_TEAL, emissiveHex: 0x9d0b0b, baseIntensity: 0.12, reactiveMax: 0.24 },
  floodCool: { colorHex: ARENA_PANEL_TEAL, emissiveHex: 0xFFFFFF, baseIntensity: 0.16, reactiveMax: 0.65 },
  skylineEdges: { colorHex: ARENA_PANEL_TEAL, emissiveHex: 0x2b4036, baseIntensity: 0.3, reactiveMax: 0.36 },
  floodWarm: { colorHex: ARENA_ORANGE_DEEP, emissiveHex: ARENA_GOLD, baseIntensity: 0.94, reactiveMax: 2.12 },
  heroWallWarm: { colorHex: ARENA_ORANGE_DEEP, emissiveHex: 0x000000, baseIntensity: 0.20, reactiveMax: 0.40 },
  windowPanelsCool: { colorHex: ARENA_PANEL_TEAL, emissiveHex: 0x0a5636, baseIntensity: 0.4, reactiveMax: 0.24 },
  buildingWindowCool: { colorHex: 0x99AFC2, emissiveHex: 0x40776a, baseIntensity: 0.16, reactiveMax: 0.28 },
  accentWindowWarm: { colorHex: ARENA_ORANGE_DEEP, emissiveHex: 0xffffff, baseIntensity: 0.18, reactiveMax: 0.34 },
};

// ── Per-map color profiles ──────────────────────────────
// Each map gets its own copy of the 13 visual roles. On map switch,
// loadColorProfile() copies the map's stored values into the live
// ARENA_VISUAL_ROLES object (which the admin panel reads/writes in place).

function cloneRoles(): Record<ArenaVisualRoleId, ArenaVisualRole> {
  const out = {} as Record<ArenaVisualRoleId, ArenaVisualRole>;
  for (const id of Object.keys(ARENA_VISUAL_ROLES) as ArenaVisualRoleId[]) {
    const r = ARENA_VISUAL_ROLES[id];
    out[id] = { colorHex: r.colorHex, emissiveHex: r.emissiveHex, baseIntensity: r.baseIntensity, reactiveMax: r.reactiveMax };
  }
  return out;
}

export const MAP_COLOR_PROFILES: Record<MapType, Record<ArenaVisualRoleId, ArenaVisualRole>> = {
  synth_pit: cloneRoles(),
  midtown_bowl: cloneRoles(),
  synth_city: cloneRoles(),
};

let _activeProfile: MapType = 'midtown_bowl';

/** Copy stored profile values into the live ARENA_VISUAL_ROLES object. */
export function loadColorProfile(mapType: MapType): void {
  _activeProfile = mapType;
  const profile = MAP_COLOR_PROFILES[mapType];
  for (const id of Object.keys(profile) as ArenaVisualRoleId[]) {
    const src = profile[id];
    const dst = ARENA_VISUAL_ROLES[id];
    dst.colorHex = src.colorHex;
    dst.emissiveHex = src.emissiveHex;
    dst.baseIntensity = src.baseIntensity;
    dst.reactiveMax = src.reactiveMax;
  }
}

/** Persist current live ARENA_VISUAL_ROLES back to the stored profile. */
export function saveColorProfile(mapType: MapType): void {
  const profile = MAP_COLOR_PROFILES[mapType];
  for (const id of Object.keys(ARENA_VISUAL_ROLES) as ArenaVisualRoleId[]) {
    const src = ARENA_VISUAL_ROLES[id];
    const dst = profile[id];
    dst.colorHex = src.colorHex;
    dst.emissiveHex = src.emissiveHex;
    dst.baseIntensity = src.baseIntensity;
    dst.reactiveMax = src.reactiveMax;
  }
}

export function getActiveColorProfile(): MapType { return _activeProfile; }

export function applyArenaRole(mesh: THREE.Mesh, roleId: ArenaVisualRoleId): void {
  const role = ARENA_VISUAL_ROLES[roleId];
  forEachStandardMaterial(mesh, (mat) => {
    const hasBakedDetailMap = !!(mat.map || mat.emissiveMap);
    const shouldPromoteDetailMap =
      !!mat.map &&
      !mat.emissiveMap &&
      (
        roleId === 'skylineEdges' ||
        roleId === 'windowPanelsCool' ||
        roleId === 'buildingWindowCool' ||
        roleId === 'buildingFaceTeal'
      );
    if (shouldPromoteDetailMap) {
      // Some arena building/window detail appears to exist only in the base color map.
      // Reuse it as emissive so the distant skyline patterns remain visible at night.
      mat.emissiveMap = mat.map;
    }
    if (hasBakedDetailMap && (roleId === 'skylineEdges' || roleId === 'windowPanelsCool' || roleId === 'buildingWindowCool')) {
      // Keep the authored skyline/window patterns readable instead of crushing
      // them through a dark teal multiply.
      mat.color.setHex(ARENA_MIST);
    } else if (hasBakedDetailMap && roleId === 'glowBlue') {
      // Preserve the authored glow texture while letting the dedicated role
      // tint and amplify it without affecting unrelated cyan trim.
      mat.color.setHex(role.colorHex);
    } else if (hasBakedDetailMap && roleId === 'buildingFaceTeal') {
      mat.color.setHex(ARENA_TEAL_BRIGHT);
    } else if (hasBakedDetailMap && (roleId === 'wallBodyDark' || roleId === 'standDark')) {
      mat.color.setHex(ARENA_PANEL_TEAL);
    } else {
      mat.color.setHex(role.colorHex);
    }
    mat.emissive.setHex(role.emissiveHex);
    if (roleId === 'skylineEdges' && shouldPromoteDetailMap) {
      mat.emissiveIntensity = role.baseIntensity + 0.12;
    } else if ((roleId === 'windowPanelsCool' || roleId === 'buildingWindowCool') && shouldPromoteDetailMap) {
      mat.emissiveIntensity = role.baseIntensity + 0.1;
    } else if (roleId === 'buildingFaceTeal' && shouldPromoteDetailMap) {
      mat.emissiveIntensity = role.baseIntensity + 0.05;
    } else if (hasBakedDetailMap && (roleId === 'skylineEdges' || roleId === 'windowPanelsCool' || roleId === 'buildingWindowCool')) {
      mat.emissiveIntensity = role.baseIntensity + 0.04;
    } else {
      mat.emissiveIntensity = role.baseIntensity;
    }
  });
}

export function setArenaRoleReactiveIntensity(mesh: THREE.Mesh, roleId: ArenaVisualRoleId, targetIntensity: number): void {
  const role = ARENA_VISUAL_ROLES[roleId];
  const nextIntensity = Math.min(role.reactiveMax, targetIntensity);
  forEachStandardMaterial(mesh, (mat) => {
    mat.emissiveIntensity = nextIntensity;
  });
}

export function getArenaMeshLabel(mesh: THREE.Mesh): string {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const materialNames = mats
    .map((material) => ((material as THREE.Material).name || ''))
    .filter(Boolean)
    .join(' ');
  return `${mesh.name} ${materialNames}`.toLowerCase();
}
