import * as THREE from 'three';
import type { ReactiveState } from './arenaState';
import {
  applyArenaRole,
  forEachStandardMaterial,
  FLOOD_LIGHT_SETTINGS,
} from './arenaTheme';

export function logArenaRoleCounts(state: ReactiveState): void {
  if (!import.meta.env.DEV) return;
  console.log('[arena] role counts:', {
    coolTrim: state.v2CoolTrim.length,
    wallBody: state.v2WallBody.length,
    wallMarkers: state.v2WallMarkers.length,
    wallHazards: state.v2WallHazards.length,
    skylineEdges: state.v2SkylineEdges.length,
    buildingFaces: state.v2BuildingFaces.length,
    buildingAccentWindows: state.v2BuildingAccentWindows.length,
  });
}

export function applyArenaColorMap(state: ReactiveState): void {
  state.v2GlowBlue.forEach((mesh: THREE.Mesh) => applyArenaRole(mesh, 'glowBlue'));
  state.v2GlowCyan.forEach((mesh: THREE.Mesh) => {
    applyArenaRole(mesh, 'trimCyan');
    // Stands roof: halve opacity so the crowd stands read through.
    forEachStandardMaterial(mesh, (mat) => {
      mat.transparent = true;
      mat.opacity = mat.opacity * 0.5;
      mat.needsUpdate = true;
    });
  });
  state.v2WallBody.forEach((mesh: THREE.Mesh) => applyArenaRole(mesh, 'wallBodyDark'));
  state.v2ArenaWall.forEach((mesh: THREE.Mesh) => {
    applyArenaRole(mesh, 'heroWallWarm');
    forEachStandardMaterial(mesh, (mat) => {
      mat.roughness = Math.max(mat.roughness, 0.48);
    });
  });
  state.v2Windows.forEach((mesh: THREE.Mesh) => applyArenaRole(mesh, 'windowPanelsCool'));
  state.v2BuildingAccentWindows.forEach((mesh: THREE.Mesh, meshIndex: number) => {
    applyArenaRole(mesh, meshIndex % 10 === 0 ? 'accentWindowWarm' : 'buildingWindowCool');
  });
  state.v2FloodLights.forEach((mesh: THREE.Mesh, meshIndex: number) => {
    const roleId = meshIndex % 2 === 0 ? 'floodWarm' : 'floodCool';
    applyArenaRole(mesh, roleId);
    forEachStandardMaterial(mesh, (mat) => {
      // Flood lights should read like hero emissive signage and reliably bloom
      // under the current global bloom settings.
      const floodData = mat.userData as { _floodRoughnessBase?: number };
      if (floodData._floodRoughnessBase === undefined) floodData._floodRoughnessBase = mat.roughness;
      mat.toneMapped = FLOOD_LIGHT_SETTINGS.toneMapped;
      mat.roughness = Math.min(floodData._floodRoughnessBase, FLOOD_LIGHT_SETTINGS.roughnessMax);
      mat.emissiveIntensity = roleId === 'floodWarm'
        ? FLOOD_LIGHT_SETTINGS.warmBaseEmissive
        : FLOOD_LIGHT_SETTINGS.coolBaseEmissive;
    });
  });
  state.v2CrowdStands.forEach((mesh: THREE.Mesh) => applyArenaRole(mesh, 'standDark'));
  state.v2SkylineEdges.forEach((mesh: THREE.Mesh) => applyArenaRole(mesh, 'skylineEdges'));
  state.v2BuildingFaces.forEach((mesh: THREE.Mesh) => applyArenaRole(mesh, 'buildingFaceTeal'));
}
