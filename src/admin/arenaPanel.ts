// ── Admin Panel: Arena Section ───────────────────────────
// Arena visual roles, arena lights (v1/v2), arena trace debugging.

import * as THREE from 'three';
import {
  addHeader,
  addLabel,
  addSlider,
  trackSlider,
  addToggle,
  trackToggle,
  addColorPicker,
  trackColorPicker,
  addMiniActionRow,
} from './helpers';
import {
  getArenaReactive,
  ARENA_VISUAL_ROLES,
  FLOOD_LIGHT_SETTINGS,
  forEachStandardMaterial,
  applyArenaRole,
  saveColorProfile,
  getActiveColorProfile,
  type ArenaVisualRoleId,
} from '../grid';
import { MAPS } from '../types/index';
import type { GameLike } from '../adminPanel';

// ── Module-level state ──────────────────────────────────
const _hiddenMeshes = new Set<THREE.Object3D>();
const _flashTimers = new WeakMap<THREE.Material, number>();

// ── Constants ───────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  glowBlue: 'Glow Blue',
  wallBodyDark: 'ARENA MARKERS',
  standDark: 'Crowd Stands',
  floorBase: 'Arena Floor',
  buildingFaceTeal: 'OUTSIDE ARENA FLOOR',
  trimCyan: 'STANDS ROOF',
  floodCool: 'Flood Lights (cool)',
  skylineEdges: 'BUILDING SOLID',
  floodWarm: 'Flood Lights (warm)',
  heroWallWarm: 'Hero Wall Accents',
  windowPanelsCool: 'Window Panels',
  buildingWindowCool: 'Building Windows',
  accentWindowWarm: 'Accent Windows (warm)',
};

type ArenaTraceGroupId =
  | 'v2GlowBlue'
  | 'v2GlowCyan'
  | 'v2CrowdStands'
  | 'v2ArenaWall'
  | 'v2WallBody'
  | 'v2WallMarkers'
  | 'v2WallHazards'
  | 'v2SkylineEdges'
  | 'v2BuildingFaces'
  | 'v2BuildingAccentWindows'
  | 'v2Windows'
  | 'v2FloodLights'
  | 'v2ArenaFloor';

const TRACE_GROUP_LABELS: Record<ArenaTraceGroupId, string> = {
  v2GlowBlue: 'Glow Blue',
  v2GlowCyan: 'Glow Cyan',
  v2CrowdStands: 'Crowd Stands',
  v2ArenaWall: 'Arena Wall',
  v2WallBody: 'Wall Body',
  v2WallMarkers: 'Wall Markers',
  v2WallHazards: 'Wall Hazards',
  v2SkylineEdges: 'Skyline Edges',
  v2BuildingFaces: 'Building Faces',
  v2BuildingAccentWindows: 'Accent Windows',
  v2Windows: 'Windows',
  v2FloodLights: 'Flood Lights',
  v2ArenaFloor: 'Arena Floor',
};

const TRACE_GROUP_ORDER: ArenaTraceGroupId[] = [
  'v2GlowBlue',
  'v2GlowCyan',
  'v2CrowdStands',
  'v2ArenaWall',
  'v2WallBody',
  'v2WallMarkers',
  'v2WallHazards',
  'v2SkylineEdges',
  'v2BuildingFaces',
  'v2BuildingAccentWindows',
  'v2Windows',
  'v2FloodLights',
  'v2ArenaFloor',
];

// ── Public API ──────────────────────────────────────────

export function addArenaSection(panel: HTMLDivElement, _gameRef: GameLike | null): void {
  const reactive = getArenaReactive();

  // ── Backdrop ─────────────────────────────────────────────
  addHeader('BACKDROP');
  addLabel('Milky Way (default)');

  // ── Arena Visual Roles ──────────────────────────────────
  const activeProfile = getActiveColorProfile();
  const profileMapLabel = (MAPS.find(m => m.id === activeProfile)?.label ?? activeProfile).toUpperCase();
  addHeader('ARENA COLOR MAP (' + profileMapLabel + ')', 'roles');
  addMiniActionRow([
    { label: 'SAVE PROFILE', color: '#e8a735', onClick: () => { saveColorProfile(activeProfile); } },
  ]);
  const roleIds = Object.keys(ARENA_VISUAL_ROLES) as ArenaVisualRoleId[];
  for (const roleId of roleIds) {
    const role = ARENA_VISUAL_ROLES[roleId];
    addRoleSection(panel, roleId, role);
  }
  addArenaTraceSection(panel);

  // ── Arena Lights (classic map only) ─────────────────────
  const hasArenaLights = reactive && (reactive.stadLights.length || reactive.baseStripMat || reactive.raveSpots.length);
  if (hasArenaLights) {
    addHeader('ARENA LIGHTS (classic)', 'arenaLights');
    if (reactive!.stadLights.length) {
      trackSlider('arenaLights', 'stadLightInt', addSlider('stadLights', reactive!.stadLights[0].intensity, 0, 5, 0.1, (v) => {
        reactive!.stadLights.forEach((l) => { l.intensity = v; });
      }));
    }
    if (reactive!.baseStripMat) {
      trackSlider('arenaLights', 'baseStripEmissive', addSlider('wallStrip', reactive!.baseStripMat.emissiveIntensity, 0, 4, 0.05, (v) => {
        reactive!.baseStripMat!.emissiveIntensity = v;
      }));
    }
    if (reactive!.raveSpots.length) {
      const rs = reactive!.raveSpots[0];
      trackSlider('arenaLights', 'raveSpotInt', addSlider('raveSpots', rs.light.intensity, 0, 10, 0.1, (v) => {
        reactive!.raveSpots.forEach((s: { light: THREE.SpotLight }) => { s.light.intensity = v; });
      }));
    }
  }

  if (reactive?.v2FloodLights.length) {
    addHeader('ARENA LIGHTS (v2)', 'arenaLightsV2');
    const floodMats: THREE.MeshStandardMaterial[] = [];
    reactive.v2FloodLights.forEach((mesh) => {
      forEachStandardMaterial(mesh, (mat) => {
        if (!floodMats.includes(mat)) floodMats.push(mat);
      });
    });
    trackToggle('arenaLightsV2', 'floodToneMapped', addToggle('toneMapped', FLOOD_LIGHT_SETTINGS.toneMapped, (checked) => {
      FLOOD_LIGHT_SETTINGS.toneMapped = checked;
      floodMats.forEach((mat) => { mat.toneMapped = checked; mat.needsUpdate = true; });
    }));
    trackSlider('arenaLightsV2', 'floodRoughMax', addSlider('roughMax', FLOOD_LIGHT_SETTINGS.roughnessMax, 0, 1, 0.01, (v) => {
      FLOOD_LIGHT_SETTINGS.roughnessMax = v;
      floodMats.forEach((mat) => {
        const base = (mat.userData as { _floodRoughnessBase?: number })._floodRoughnessBase ?? mat.roughness;
        mat.roughness = Math.min(base, v);
        mat.needsUpdate = true;
      });
    }));
    trackSlider('arenaLightsV2', 'warmBase', addSlider('warmBase', FLOOD_LIGHT_SETTINGS.warmBaseEmissive, 0, 3, 0.01, (v) => {
      FLOOD_LIGHT_SETTINGS.warmBaseEmissive = v;
      reactive.v2FloodLights.forEach((mesh, i) => {
        if (i % 2 !== 0) return;
        forEachStandardMaterial(mesh, (mat) => { mat.emissiveIntensity = v; });
      });
    }));
    trackSlider('arenaLightsV2', 'coolBase', addSlider('coolBase', FLOOD_LIGHT_SETTINGS.coolBaseEmissive, 0, 3, 0.01, (v) => {
      FLOOD_LIGHT_SETTINGS.coolBaseEmissive = v;
      reactive.v2FloodLights.forEach((mesh, i) => {
        if (i % 2 === 0) return;
        forEachStandardMaterial(mesh, (mat) => { mat.emissiveIntensity = v; });
      });
    }));
    trackSlider('arenaLightsV2', 'warmPulseBase', addSlider('warmPulse', FLOOD_LIGHT_SETTINGS.warmPulseBase, 0, 3, 0.01, (v) => { FLOOD_LIGHT_SETTINGS.warmPulseBase = v; }));
    trackSlider('arenaLightsV2', 'warmKick', addSlider('warmKick', FLOOD_LIGHT_SETTINGS.warmPulseKick, 0, 2, 0.01, (v) => { FLOOD_LIGHT_SETTINGS.warmPulseKick = v; }));
    trackSlider('arenaLightsV2', 'warmBass', addSlider('warmBass', FLOOD_LIGHT_SETTINGS.warmPulseBass, 0, 1, 0.01, (v) => { FLOOD_LIGHT_SETTINGS.warmPulseBass = v; }));
    trackSlider('arenaLightsV2', 'coolPulseBase', addSlider('coolPulse', FLOOD_LIGHT_SETTINGS.coolPulseBase, 0, 3, 0.01, (v) => { FLOOD_LIGHT_SETTINGS.coolPulseBase = v; }));
    trackSlider('arenaLightsV2', 'coolKick', addSlider('coolKick', FLOOD_LIGHT_SETTINGS.coolPulseKick, 0, 2, 0.01, (v) => { FLOOD_LIGHT_SETTINGS.coolPulseKick = v; }));
    trackSlider('arenaLightsV2', 'coolBass', addSlider('coolBass', FLOOD_LIGHT_SETTINGS.coolPulseBass, 0, 1, 0.01, (v) => { FLOOD_LIGHT_SETTINGS.coolPulseBass = v; }));
  }
}

/** Restore any meshes hidden by SOLO trace actions. Called by destroyAdminPanel. */
export function restoreHiddenArenaMeshes(): void {
  _hiddenMeshes.forEach((obj) => { obj.visible = true; });
  _hiddenMeshes.clear();
}

// ── Role Section (internal) ─────────────────────────────

function addRoleSection(panel: HTMLDivElement, roleId: ArenaVisualRoleId, role: { colorHex: number; emissiveHex: number; baseIntensity: number; reactiveMax: number }): void {
  const reactive = getArenaReactive();
  const meshes = getMeshesForRole(roleId, reactive);
  const count = meshes.length;

  const label = document.createElement('div');
  label.textContent = (ROLE_LABELS[roleId] || roleId) + (count ? ` [${count}]` : ' [0]');
  Object.assign(label.style, {
    fontSize: '10px', color: count ? '#7ec8d8' : '#555', padding: '6px 0 2px',
    borderTop: '1px solid rgba(255,255,255,0.05)', marginTop: '4px',
  });
  panel.appendChild(label);

  const cp1 = addColorPicker('color', role.colorHex, (hex) => { role.colorHex = hex; applyToMeshes(meshes, roleId); });
  trackColorPicker('roles.' + roleId, 'colorHex', role.colorHex, cp1.picker);

  const cp2 = addColorPicker('emissive', role.emissiveHex, (hex) => { role.emissiveHex = hex; applyToMeshes(meshes, roleId); });
  trackColorPicker('roles.' + roleId, 'emissiveHex', role.emissiveHex, cp2.picker);

  trackSlider('roles.' + roleId, 'baseIntensity', addSlider('intensity', role.baseIntensity, 0, 2, 0.01, (v) => { role.baseIntensity = v; applyToMeshes(meshes, roleId); }));
  trackSlider('roles.' + roleId, 'reactiveMax', addSlider('reactMax', role.reactiveMax, 0, 3, 0.01, (v) => { role.reactiveMax = v; }));
}

function addArenaTraceSection(panel: HTMLDivElement): void {
  const reactive = getArenaReactive();
  if (!reactive) return;

  addHeader('ARENA SOURCE TRACE');
  addLabel('Debug-only raw mesh buckets. Use SOLO/FLASH/LOG to isolate a suspect blue without changing palette values.');
  addMiniActionRow([
    { label: 'RESET VIS', color: '#e8a735', onClick: () => { restoreHiddenArenaMeshes(); } },
    { label: 'LOG COUNTS', color: '#49A2B2', onClick: () => { console.log('[arena-trace] counts', getArenaTraceCounts(reactive)); } },
  ]);

  for (const groupId of TRACE_GROUP_ORDER) {
    const meshes = getArenaTraceMeshes(groupId, reactive);
    if (!meshes.length) continue;
    addArenaTraceGroup(panel, groupId, meshes);
  }
}

function addArenaTraceGroup(panel: HTMLDivElement, groupId: ArenaTraceGroupId, meshes: THREE.Mesh[]): void {
  const label = document.createElement('div');
  label.textContent = `${TRACE_GROUP_LABELS[groupId]} [${meshes.length}]`;
  Object.assign(label.style, {
    fontSize: '10px',
    color: '#7ec8d8',
    padding: '6px 0 2px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
    marginTop: '4px',
  });
  panel.appendChild(label);

  const summary = summarizeMeshMaterials(meshes);
  addLabel(`mat:${summary.materialCount} color:${summary.topColor ?? '-'} emissive:${summary.topEmissive ?? '-'} ei:${summary.topIntensity ?? '-'}`);
  addLabel(`names: ${summary.sampleNames.join(', ')}`);

  addMiniActionRow([
    { label: 'SOLO', color: '#49A2B2', onClick: () => { soloArenaTraceGroup(meshes); } },
    { label: 'FLASH', color: '#ff66cc', onClick: () => { flashArenaTraceGroup(meshes); } },
    { label: 'LOG', color: '#7ec8d8', onClick: () => { logArenaTraceGroup(groupId, meshes); } },
  ]);
}

// ── Helper functions ────────────────────────────────────

function getMeshesForRole(roleId: ArenaVisualRoleId, reactive: ReturnType<typeof getArenaReactive>): THREE.Mesh[] {
  if (!reactive) return [];

  const map: Record<string, THREE.Mesh[]> = {
    glowBlue: [...reactive.v2GlowBlue],
    wallBodyDark: [...reactive.v2WallBody],
    standDark: [...reactive.v2CrowdStands],
    floorBase: [...reactive.v2ArenaFloor],
    buildingFaceTeal: [...reactive.v2BuildingFaces],
    trimCyan: [...reactive.v2GlowCyan],
    floodCool: [...reactive.v2FloodLights.filter((_, i) => i % 2 !== 0)],
    skylineEdges: [...reactive.v2SkylineEdges],
    floodWarm: [...reactive.v2FloodLights.filter((_, i) => i % 2 === 0)],
    heroWallWarm: [...reactive.v2ArenaWall.filter((_, i) => i % 10 === 0)],
    windowPanelsCool: [...reactive.v2Windows],
    buildingWindowCool: [...reactive.v2BuildingAccentWindows.filter((_, i) => i % 10 !== 0)],
    accentWindowWarm: [...reactive.v2BuildingAccentWindows.filter((_, i) => i % 10 === 0)],
  };
  return map[roleId] || [];
}

function applyToMeshes(meshes: THREE.Mesh[], roleId: ArenaVisualRoleId): void {
  meshes.forEach((mesh) => applyArenaRole(mesh, roleId));
}

function getArenaTraceMeshes(groupId: ArenaTraceGroupId, reactive: NonNullable<ReturnType<typeof getArenaReactive>>): THREE.Mesh[] {
  return [...(reactive[groupId] as THREE.Mesh[])];
}

function getArenaTraceCounts(reactive: NonNullable<ReturnType<typeof getArenaReactive>>): Record<string, number> {
  return Object.fromEntries(TRACE_GROUP_ORDER.map((groupId) => [groupId, getArenaTraceMeshes(groupId, reactive).length]));
}

function soloArenaTraceGroup(targetMeshes: THREE.Mesh[]): void {
  const reactive = getArenaReactive();
  if (!reactive) return;
  restoreHiddenArenaMeshes();
  const keep = new Set(targetMeshes);
  TRACE_GROUP_ORDER.forEach((groupId) => {
    getArenaTraceMeshes(groupId, reactive).forEach((mesh) => {
      if (keep.has(mesh)) {
        mesh.visible = true;
        return;
      }
      mesh.visible = false;
      _hiddenMeshes.add(mesh);
    });
  });
}

function flashArenaTraceGroup(meshes: THREE.Mesh[]): void {
  meshes.forEach((mesh) => {
    forEachStandardMaterial(mesh, (mat) => {
      const originalEmissive = mat.emissive.clone();
      const originalIntensity = mat.emissiveIntensity;
      const originalToneMapped = mat.toneMapped;
      const existingTimer = _flashTimers.get(mat);
      if (existingTimer) window.clearTimeout(existingTimer);
      mat.emissive.setHex(0xFFFFFF);
      mat.emissiveIntensity = Math.max(2.2, originalIntensity + 1.5);
      mat.toneMapped = false;
      mat.needsUpdate = true;
      const timer = window.setTimeout(() => {
        mat.emissive.copy(originalEmissive);
        mat.emissiveIntensity = originalIntensity;
        mat.toneMapped = originalToneMapped;
        mat.needsUpdate = true;
        _flashTimers.delete(mat);
      }, 1200);
      _flashTimers.set(mat, timer);
    });
  });
}

function logArenaTraceGroup(groupId: ArenaTraceGroupId, meshes: THREE.Mesh[]): void {
  console.group(`[arena-trace] ${groupId}`);
  console.log('count', meshes.length);
  console.log('summary', summarizeMeshMaterials(meshes));
  console.table(meshes.slice(0, 40).map((mesh) => ({
    name: mesh.name,
    label: getArenaMeshLabel(mesh),
    materialCount: Array.isArray(mesh.material) ? mesh.material.length : 1,
    materials: collectMeshMaterialDebug(mesh).join(' | '),
  })));
  console.groupEnd();
}

function summarizeMeshMaterials(meshes: THREE.Mesh[]): {
  materialCount: number;
  topColor: string | null;
  topEmissive: string | null;
  topIntensity: string | null;
  sampleNames: string[];
} {
  const colorCounts = new Map<string, number>();
  const emissiveCounts = new Map<string, number>();
  const intensityCounts = new Map<string, number>();
  let materialCount = 0;

  meshes.forEach((mesh) => {
    forEachStandardMaterial(mesh, (mat) => {
      materialCount++;
      const color = '#' + mat.color.getHexString();
      const emissive = '#' + mat.emissive.getHexString();
      const intensity = mat.emissiveIntensity.toFixed(3);
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
      emissiveCounts.set(emissive, (emissiveCounts.get(emissive) ?? 0) + 1);
      intensityCounts.set(intensity, (intensityCounts.get(intensity) ?? 0) + 1);
    });
  });

  return {
    materialCount,
    topColor: getMostCommonKey(colorCounts),
    topEmissive: getMostCommonKey(emissiveCounts),
    topIntensity: getMostCommonKey(intensityCounts),
    sampleNames: meshes.slice(0, 3).map((mesh) => mesh.name || '(unnamed)'),
  };
}

function getMostCommonKey(map: Map<string, number>): string | null {
  let bestKey: string | null = null;
  let bestCount = -1;
  map.forEach((count, key) => {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  });
  return bestKey;
}

function collectMeshMaterialDebug(mesh: THREE.Mesh): string[] {
  const out: string[] = [];
  forEachStandardMaterial(mesh, (mat, materialIndex) => {
    out.push(
      [
        `m${materialIndex}`,
        `c=#${mat.color.getHexString()}`,
        `e=#${mat.emissive.getHexString()}`,
        `ei=${mat.emissiveIntensity.toFixed(3)}`,
        `map=${!!mat.map}`,
        `emap=${!!mat.emissiveMap}`,
        `tm=${mat.toneMapped}`,
      ].join(' ')
    );
  });
  return out;
}

function getArenaMeshLabel(mesh: THREE.Mesh): string {
  const data = mesh.userData as { arenaLabel?: string };
  return typeof data.arenaLabel === 'string' ? data.arenaLabel : '';
}
