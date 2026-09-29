import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { GfxSettings, MapType } from '../types/index';
import { MAP_TUNING } from '../graphics';
import type { ReactiveState } from './arenaState';
import { FloorReflectorShader } from './arenaTheme';
import { requestNebulaSkyboxInstance } from '../nebulaSkybox';
import { registerArenaChild } from '../grid';
import { LAYER_REFLECTED } from '../renderLayers';

/** Build the floor reflector shared by both classic and arena_v2 builders.
 *  `geometry` is the shape to reflect — classic uses a plane, v2 uses a circle. */
export function buildFloorReflector(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  mapType: MapType,
  geometry: THREE.BufferGeometry,
): void {
  if (gfx.reflections === 'off') return;

  const resMult = gfx.reflections === 'ultra' ? 1.0 : 0.5;
  const texW = Math.floor(window.innerWidth * window.devicePixelRatio * resMult);
  const texH = Math.floor(window.innerHeight * window.devicePixelRatio * resMult);
  const mt = MAP_TUNING[mapType];
  const reflector = new Reflector(geometry, {
    clipBias: mt.reflectionsClipBias,
    textureWidth: texW,
    textureHeight: texH,
    color: 0xc8d2d8,
    shader: FloorReflectorShader,
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = mt.reflectionsYOffset;
  reflector.renderOrder = 0;
  const reflectorMat = reflector.material as THREE.ShaderMaterial;
  reflectorMat.depthWrite = true;
  reflectorMat.uniforms['uReflectStrength'].value = mt.floorReflectStrength;
  reflectorMat.uniforms['uFloorEmissiveIntensity'].value = mt.floorEmissiveIntensity;
  reflectorMat.uniforms['uRoughness'].value = mt.floorRoughness;
  reflectorMat.uniforms['color'].value.setScalar(mt.reflectionsIntensity);
  // Virtual camera only sees objects tagged with LAYER_REFLECTED.
  // The reflector mesh itself stays on layer 0 (visible to main camera).
  reflector.camera.layers.set(LAYER_REFLECTED);

  // forceUpdate = false by default — frame-skip logic in gameLoopFixedStep.ts
  // toggles it to true every Nth frame for temporal amortization.
  reflector.forceUpdate = false;

  reflector.name = 'floorReflector';
  scene.add(reflector);
  reactive.reflector = reflector;
}

/** Shared GLB skybox loader — fires-and-forgets, assigns to reactive.skyMesh. */
export function loadNebulaSkybox(scene: THREE.Scene, reactive: ReactiveState): void {
  requestNebulaSkyboxInstance((sky) => {
    scene.add(sky);
    registerArenaChild(sky);
    reactive.skyMesh = sky;
  }, { fog: false, scale: 700 });
}

/** Build main + fine grid helpers shared by both builders.
 *  `depthTestMain`: v2 uses true (reflector is opaque), classic uses false. */
export function buildArenaGrids(
  scene: THREE.Scene,
  reactive: ReactiveState,
  gfx: GfxSettings,
  gridFullSize: number,
  depthTestMain: boolean,
): void {
  const gridMain: THREE.GridHelper = new THREE.GridHelper(gridFullSize, 40, 0x0c2a2e, 0x061518);
  gridMain.position.y = 0.02;
  const gridMats = Array.isArray(gridMain.material) ? gridMain.material : [gridMain.material];
  for (const gm of gridMats) {
    gm.depthTest = depthTestMain;
    gm.depthWrite = false;
    gm.transparent = true;
    gm.opacity = 0.4;
  }
  gridMain.renderOrder = 1;
  scene.add(gridMain);
  reactive.gridMain = gridMain;

  if (gfx.arenaDetail !== 'minimal') {
    const gridFine: THREE.GridHelper = new THREE.GridHelper(gridFullSize, gfx.arenaDetail === 'reduced' ? 100 : 200, 0x061518, 0x030a0c);
    gridFine.position.y = 0.01;
    const fineMats = Array.isArray(gridFine.material) ? gridFine.material : [gridFine.material];
    for (const fm of fineMats) {
      fm.depthTest = depthTestMain;
      fm.depthWrite = false;
      fm.transparent = true;
      fm.opacity = 0.3;
    }
    gridFine.renderOrder = 1;
    scene.add(gridFine);
  }
}
