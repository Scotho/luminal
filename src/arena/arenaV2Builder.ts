import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { GfxSettings, MapType } from '../types/index';
import { cloneArenaModel } from '../arenaModel';
import { setArenaShape } from '../core/simulation';
import type { ReactiveState } from './arenaState';
import { ARENA_SIZE, setGridArenaShape } from './arenaShape';
import { ARENA_TEAL_BRIGHT, getArenaMeshLabel } from './arenaTheme';
import { applyArenaColorMap, logArenaRoleCounts } from './arenaV2ColorMap';
import { buildArenaGrids, buildFloorReflector, loadNebulaSkybox } from './arenaSharedPieces';
import { registerArenaChild } from '../grid';
import { logLocal } from '../localDiagnostics';
import { enableReflection } from '../renderLayers';

export interface ArenaV2BuildResult {
  portholeR: number;
  roofY: number;
}

const ARENA_FLOOR_NATIVE = 31.5;
const FLOOR_WORLD_OFFSET = 0.12;
const FLOOR_DETAIL_WORLD_LIFT = 0.03;
const WALL_BARRIER_NATIVE = 30.0;

/** Entry point for arena_v2 (midtown_bowl). Orchestrates model load +
 *  ring wall + mesh categorization + color pass + reflector + decor. */
export function buildArenaV2(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  mapType: MapType,
  cachedWallTexture: THREE.CanvasTexture,
): ArenaV2BuildResult {
  const arenaModel = loadArenaV2Model();
  const arenaScale = ARENA_SIZE / ARENA_FLOOR_NATIVE;
  arenaModel.scale.setScalar(arenaScale);

  alignArenaV2ToGround(arenaModel);
  patchArenaV2FloorMaterials(arenaModel, arenaScale);

  scene.add(arenaModel);
  enableReflection(arenaModel);
  if (import.meta.env.DEV) {
    const finalBox = new THREE.Box3().setFromObject(arenaModel);
    logLocal('[midtown_bowl] final bbox min:', finalBox.min, 'max:', finalBox.max);
    logLocal('[midtown_bowl] scale:', arenaScale, 'arenaR:', (WALL_BARRIER_NATIVE / 2) * arenaScale);
  }

  buildArenaV2RingWall(scene, reactive, cachedWallTexture);
  for (const b of reactive.barriers) enableReflection(b);
  collectArenaV2Meshes(arenaModel, reactive);

  // Wall barrier mesh is ~30 units native → ~305 scaled; use as collision radius
  logArenaRoleCounts(reactive);
  applyArenaColorMap(reactive);

  freezeArenaV2Statics(reactive);

  const arenaR = (WALL_BARRIER_NATIVE / 2) * arenaScale;
  setGridArenaShape(true, arenaR);
  setArenaShape(true, arenaR);

  // ── Planar floor reflector ──────────────────────────────
  const reflectorGeo = new THREE.CircleGeometry(arenaR, 64);
  buildFloorReflector(scene, reactive, gfx, mapType, reflectorGeo);

  // ── Grid lines (V2 arena) ─────────────────────────────
  // Must sit ABOVE the reflector plane (y=0) or the reflector's depth buffer
  // occludes the grid wherever the circle covers the floor.
  buildArenaGrids(scene, reactive, gfx, arenaR * 2, true);

  // ── GLB skybox (renders behind everything including stars) ──
  loadNebulaSkybox(scene, reactive);

  // ── Moon (meshopt-compressed GLB) ──
  loadArenaV2Moon(scene, reactive);

  // Subtle fog — fades distant skybox/stars into darkness
  // Fog handled by atmosphere module

  reactive._outerWallR = arenaR * 2.5;
  reactive._rimTopY = 120;

  return {
    portholeR: arenaR * 2.5,
    roofY: 120,
  };
}

/** Clone the GLB model and remove the embedded sky sphere + unwanted layers. */
function loadArenaV2Model(): THREE.Group {
  const arenaModel = cloneArenaModel();
  // Remove the model's built-in sky sphere (we use our own skybox)
  const toRemove: THREE.Object3D[] = [];
  arenaModel.traverse((child: THREE.Object3D) => {
    if (child.name === 'Sphere_Sky_0' || child.name === 'Sphere_Sky'
      || child.name.startsWith('Sphere_')
      || child.name.includes('Ramp')
      || child.name.includes('NewArrow')
      || child.name.includes('Reflection')
      || child.name.includes('Glow_White')
      || child.name.includes('Spawn_Rings')
      || child.name.includes('Circle_Rings') ) {
      toRemove.push(child);
    }
  });
  toRemove.forEach(obj => obj.removeFromParent());
  return arenaModel;
}

/** Align the arena floor to y=0 and center on origin. */
function alignArenaV2ToGround(arenaModel: THREE.Group): void {
  let floorY = 0;
  arenaModel.traverse((child: THREE.Object3D) => {
    if (child.name === 'polygon56_Arena_Floor_0') {
      const fb = new THREE.Box3().setFromObject(child);
      floorY = fb.getCenter(new THREE.Vector3()).y;
    }
  });
  const box = new THREE.Box3().setFromObject(arenaModel);
  const center = box.getCenter(new THREE.Vector3());
  arenaModel.position.set(-center.x, -floorY, -center.z);
}

/** Fix z-fighting between floor and embedded detail meshes (rings, lines). */
function patchArenaV2FloorMaterials(arenaModel: THREE.Group, arenaScale: number): void {
  arenaModel.traverse((child: THREE.Object3D) => {
    if (child.name === 'polygon56_Arena_Floor_0') {
      child.position.y -= FLOOR_WORLD_OFFSET / arenaScale;
      const floorMesh = child as THREE.Mesh;
      floorMesh.renderOrder = 0;
      floorMesh.visible = false;  // Reflector is the visible floor now
      const materials = Array.isArray(floorMesh.material)
        ? floorMesh.material
        : [floorMesh.material];
      for (const material of materials) {
        const floorMat = material as THREE.MeshStandardMaterial;
        floorMat.transparent = true;
        floorMat.opacity = 0.55;
        floorMat.metalness = 0.15;
        floorMat.roughness = 0.14;
        floorMat.depthWrite = false;
        floorMat.depthTest = true;
        floorMat.alphaTest = 0;
        floorMat.color.setHex(0x05080C);
        floorMat.emissive = floorMat.emissive || new THREE.Color();
        floorMat.emissive.setHex(0x0D1820);
        floorMat.emissiveIntensity = 2.0;
        floorMat.polygonOffset = true;
        floorMat.polygonOffsetFactor = 1;
        floorMat.polygonOffsetUnits = 2;
        floorMat.needsUpdate = true;
        if (import.meta.env.DEV) {
          logLocal('[midtown_bowl] floor material flags:', {
            transparent: floorMat.transparent,
            opacity: floorMat.opacity,
            depthWrite: floorMat.depthWrite,
            depthTest: floorMat.depthTest,
            alphaTest: floorMat.alphaTest,
            polygonOffset: floorMat.polygonOffset,
            polygonOffsetFactor: floorMat.polygonOffsetFactor,
            polygonOffsetUnits: floorMat.polygonOffsetUnits,
          });
        }
      }
      if (import.meta.env.DEV) {
        logLocal('[midtown_bowl] floor world offset:', FLOOR_WORLD_OFFSET);
      }
    } else if (child.name === 'Circle_Rings_0') {
      child.position.y += FLOOR_DETAIL_WORLD_LIFT / arenaScale;
      const ringMesh = child as THREE.Mesh;
      const materials = Array.isArray(ringMesh.material)
        ? ringMesh.material
        : [ringMesh.material];
      for (const material of materials) {
        const ringMat = material as THREE.MeshStandardMaterial;
        ringMat.transparent = false;
        ringMat.depthWrite = false;
        // The embedded white floor lines sit almost exactly on top of the
        // black floor surface in the GLB. Depth-testing them against the
        // floor still lets shallow camera angles flicker, so treat them like
        // a decal layer that always renders above the floor.
        ringMat.depthTest = false;
        ringMat.alphaTest = 0;
        ringMat.color.setHex(0x18323C);
        ringMat.emissive = ringMat.emissive || new THREE.Color();
        ringMat.emissive.setHex(ARENA_TEAL_BRIGHT);
        ringMat.emissiveIntensity = 0.035;
        ringMat.toneMapped = false;
        ringMat.polygonOffset = true;
        ringMat.polygonOffsetFactor = -2;
        ringMat.polygonOffsetUnits = -4;
        ringMat.needsUpdate = true;
      }
      ringMesh.renderOrder = 2;
      if (import.meta.env.DEV) {
        logLocal('[midtown_bowl] floor detail lift:', {
          name: child.name,
          worldLift: FLOOR_DETAIL_WORLD_LIFT,
          renderOrder: ringMesh.renderOrder,
        });
      }
    } else if (import.meta.env.DEV && (child.name.includes('Floor') || child.name.includes('Line') || child.name.includes('Arrow'))) {
      const mesh = child as THREE.Mesh;
      const materials = mesh.material
        ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        : [];
      if (import.meta.env.DEV) {
      logLocal('[midtown_bowl] nearby floor/detail mesh:', {
        name: child.name,
        materials: materials.map(m => m.name || m.type),
      });
      }
    }
  });
}

/** Full-ring shooting-star wall (OG v1 style): backing + textured cylinder + top/bottom strips. */
function buildArenaV2RingWall(
  scene: THREE.Scene,
  reactive: ReactiveState,
  cachedWallTexture: THREE.CanvasTexture,
): void {
  const wallRingR = 181; // arena boundary radius
  const wallRingH = 12;
  // Bottom of wall sits at ground level (reflector plane)
  const wallRingY = -0.43 + wallRingH / 2;

  // Dark backing cylinder (slightly outside the textured wall)
  const backingGeo = new THREE.CylinderGeometry(
    wallRingR + 0.3, wallRingR + 0.3, wallRingH,
    64, 1, true, 0, Math.PI * 2
  );
  const backingMat = new THREE.MeshBasicMaterial({
    color: 0x020305,
    side: THREE.DoubleSide,
  });
  const backing = new THREE.Mesh(backingGeo, backingMat);
  backing.position.set(0, wallRingY, 0);
  backing.name = 'wallRingBacking';
  scene.add(backing);
  reactive.barriers.push(backing);

  // Shooting-star textured wall
  const wallRingGeo = new THREE.CylinderGeometry(
    wallRingR, wallRingR, wallRingH,
    64, 1, true, 0, Math.PI * 2
  );
  const wallRingMat = new THREE.MeshBasicMaterial({
    map: cachedWallTexture,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wallRing = new THREE.Mesh(wallRingGeo, wallRingMat);
  wallRing.position.set(0, wallRingY, 0);
  wallRing.name = 'wallRing';
  scene.add(wallRing);
  reactive.barriers.push(wallRing);

  // Emissive orange strips (top + bottom)
  const stripH = 1.5;
  const stripMat = new THREE.MeshStandardMaterial({
    color: 0xFC741E,
    emissive: new THREE.Color(0xFC741E),
    emissiveIntensity: 1.2,
    toneMapped: false,
    transparent: false,
    side: THREE.DoubleSide,
  });
  const bottomStripGeo = new THREE.CylinderGeometry(
    wallRingR - 0.2, wallRingR - 0.2, stripH,
    64, 1, true, 0, Math.PI * 2
  );
  const bottomStrip = new THREE.Mesh(bottomStripGeo, stripMat);
  bottomStrip.position.set(0, wallRingY - wallRingH / 2 + stripH / 2, 0);
  bottomStrip.name = 'wallRingBaseStrip';
  bottomStrip.renderOrder = 10;
  scene.add(bottomStrip);
  reactive.barriers.push(bottomStrip);

  const topStripH = 0.4;
  const topStripGeo = new THREE.CylinderGeometry(
    wallRingR - 0.2, wallRingR - 0.2, topStripH,
    64, 1, true, 0, Math.PI * 2
  );
  const topStrip = new THREE.Mesh(topStripGeo, stripMat);
  topStrip.position.set(0, wallRingY + wallRingH / 2 - topStripH / 2, 0);
  topStrip.name = 'wallRingTopStrip';
  scene.add(topStrip);
  reactive.barriers.push(topStrip);
}

/** Walk the arena GLB and bucket meshes into the reactive state v2* arrays. */
function collectArenaV2Meshes(arenaModel: THREE.Group, reactive: ReactiveState): void {
  arenaModel.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const name = mesh.name;
    // Ensure emissive is initialized on standard materials
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (mat.isMeshStandardMaterial && !mat.emissive) mat.emissive = new THREE.Color(0x000000);
    }
    const label = getArenaMeshLabel(mesh);
    if (name.includes('Flood_Lights')) reactive.v2FloodLights.push(mesh);
    else if (name.includes('Glow_Cyan')) reactive.v2GlowCyan.push(mesh);
    else if (name.includes('Glow_Blue')) {
      reactive.v2GlowBlue.push(mesh);
      reactive.v2CoolTrim.push(mesh);
    }
    else if (name.includes('Windows')) {
      reactive.v2Windows.push(mesh);
    }
    else if (name.includes('Arena_Wall_Barrier')) {
      reactive.v2WallBarrier.push(mesh);
      if (/(tooth|teeth|hazard|spike|bollard|cone|warning)/.test(label)) reactive.v2WallHazards.push(mesh);
      else if (/(marker|panel|strip|stripe|chevron|insert|screen|sign|yellow|orange)/.test(label)) reactive.v2WallMarkers.push(mesh);
      else reactive.v2WallBody.push(mesh);
    }
    else if (name.includes('Arena_Wall') && !name.includes('Barrier')) {
      if (/(marker|panel|strip|stripe|chevron|insert|screen|sign|yellow|orange|warning)/.test(label)) reactive.v2WallMarkers.push(mesh);
      else if (/(tooth|teeth|hazard|spike|bollard|cone)/.test(label)) reactive.v2WallHazards.push(mesh);
      else reactive.v2ArenaWall.push(mesh);
    }
    else if (name.includes('Arena_Floor')) reactive.v2ArenaFloor.push(mesh);
    else if (name.includes('Crowd_Stands')) reactive.v2CrowdStands.push(mesh);
    else if (name.includes('Buildings') || name.includes('Towers') || name.includes('Facade')) {
      reactive.v2Buildings.push(mesh);
      const hasDetailMap = mats.some((material) => {
        const mat = material as THREE.MeshStandardMaterial;
        return !!(mat.map || mat.emissiveMap);
      });
      if (/(window|portal|pane|light)/.test(label)) reactive.v2BuildingAccentWindows.push(mesh);
      else if (/(line|edge|outline|frame|trim|glow|neon|rim)/.test(label) || hasDetailMap) reactive.v2SkylineEdges.push(mesh);
      else reactive.v2BuildingFaces.push(mesh);
    }
    else if (name.includes('City')) {
      // City floor / skyline backdrop behind the arena
      reactive.v2Buildings.push(mesh);
      reactive.v2BuildingFaces.push(mesh);
    }
    else if (import.meta.env.DEV) {
      logLocal('[midtown_bowl] UNCATEGORIZED mesh:', name, '| label:', label);
    }
  });
}

/** Freeze world matrices on static V2 meshes so Three.js skips matrix recompute each frame. */
function freezeArenaV2Statics(reactive: ReactiveState): void {
  const staticGroups: THREE.Mesh[][] = [
    reactive.v2WallBarrier, reactive.v2ArenaWall, reactive.v2WallBody,
    reactive.v2WallMarkers, reactive.v2WallHazards, reactive.v2ArenaFloor,
    reactive.v2CrowdStands, reactive.v2Buildings, reactive.v2BuildingFaces,
    reactive.v2BuildingAccentWindows, reactive.v2SkylineEdges,
    reactive.v2FloodLights, reactive.v2GlowCyan, reactive.v2GlowBlue,
    reactive.v2CoolTrim, reactive.v2Windows,
  ];
  for (const group of staticGroups) {
    for (const mesh of group) {
      mesh.updateMatrixWorld(true);
      mesh.matrixAutoUpdate = false;
    }
  }
}

/** Load and orient the meshopt-compressed moon GLB above the arena. */
function loadArenaV2Moon(scene: THREE.Scene, reactive: ReactiveState): void {
  const moonLoader = new GLTFLoader();
  moonLoader.setMeshoptDecoder(MeshoptDecoder);
  moonLoader.load('/models/moon.glb', (gltf) => {
    const moon = gltf.scene;
    moon.scale.setScalar(0.6);
    moon.position.set(400, 350, 450);
    // Face toward the arena center so the textured side is visible
    moon.lookAt(0, 0, 0);
    moon.renderOrder = -90;
    moon.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.renderOrder = -90;
        // Swap to BasicMaterial — self-lit, no lighting needed, low brightness
        // stays below bloom threshold so it won't bleed light into the scene
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial;
          const basic = new THREE.MeshBasicMaterial({
            map: std.map ?? undefined,
            color: std.map ? 0x8888aa : 0x667788,
            depthWrite: false,
            fog: false,
            toneMapped: false, // bypass ACES — prevents bloom amplification
            side: std.side,
          });
          basic.transparent = true;
          basic.opacity = 0.95;
          if (Array.isArray(mesh.material)) {
            const idx = mats.indexOf(m);
            mesh.material[idx] = basic;
          } else {
            mesh.material = basic;
          }
          std.dispose();
        }
      }
    });
    scene.add(moon);
    registerArenaChild(moon);
    reactive.moonMesh = moon;
    enableReflection(moon);
  });
}
