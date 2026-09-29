import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { enableReflection } from './renderLayers';

const NEBULA_SKYBOX_URL = '/models/space_skybox_nebula.glb';
const COLLAPSED_TRIANGLE_MIN_RADIUS_FRACTION = 0.3;
const COLLAPSED_TRIANGLE_MAX_RADIUS_FRACTION = 0.8;

export const NEBULA_SKY_RENDER_ORDER = -100;

export interface NebulaSkyboxOptions {
  fog?: boolean;
  scale?: number;
}

type PendingNebulaSkyRequest = {
  onReady: (sky: THREE.Group) => void;
  options: NebulaSkyboxOptions;
};

let _nebulaSkyTemplate: THREE.Group | null = null;
let _nebulaSkyLoading = false;
const _pendingNebulaSkyRequests: PendingNebulaSkyRequest[] = [];

export function requestNebulaSkyboxInstance(
  onReady: (sky: THREE.Group) => void,
  options: NebulaSkyboxOptions = {},
): void {
  if (_nebulaSkyTemplate) {
    onReady(cloneNebulaSkyboxInstance(_nebulaSkyTemplate, options));
    return;
  }

  _pendingNebulaSkyRequests.push({ onReady, options });
  if (_nebulaSkyLoading) return;

  _nebulaSkyLoading = true;
  new GLTFLoader().load(
    NEBULA_SKYBOX_URL,
    (gltf) => {
      _nebulaSkyTemplate = gltf.scene;
      const strippedTriangles = prepareNebulaSkyboxTemplate(_nebulaSkyTemplate);
      if (import.meta.env.DEV && strippedTriangles > 0) {
        console.warn(
          `[nebulaSkybox] stripped ${strippedTriangles} malformed sky triangles from ${NEBULA_SKYBOX_URL}`,
        );
      }
      _nebulaSkyLoading = false;
      flushPendingNebulaSkyRequests();
    },
    undefined,
    (err) => {
      _nebulaSkyLoading = false;
      _pendingNebulaSkyRequests.length = 0;
      if (import.meta.env.DEV) {
        console.warn('[nebulaSkybox] failed to load shared nebula skybox:', err);
      }
    },
  );
}

export function cloneNebulaSkyboxInstance(
  template: THREE.Group,
  options: NebulaSkyboxOptions = {},
): THREE.Group {
  const sky = template.clone(true);
  cloneNebulaSkyMaterials(sky);
  configureNebulaSkyboxObject(sky, options);
  return sky;
}

export function configureNebulaSkyboxObject(
  root: THREE.Object3D,
  options: NebulaSkyboxOptions = {},
): void {
  // Fog must be off on the skybox — FogExp2 darkens from camera center outward,
  // creating a black circle that moves with the camera.
  const fog = options.fog ?? false;
  root.renderOrder = NEBULA_SKY_RENDER_ORDER;
  if (options.scale !== undefined) {
    root.scale.setScalar(options.scale);
  }

  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;

    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      material.side = THREE.DoubleSide;
      material.depthWrite = false;
      (material as THREE.Material & { fog?: boolean }).fog = fog;
    }
    mesh.renderOrder = NEBULA_SKY_RENDER_ORDER;
  });
  enableReflection(root);
}

export function sanitizeNebulaSkyGeometry(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!position || !index) return 0;

  const shellRadius = computeMedianVertexRadius(position);
  if (!Number.isFinite(shellRadius) || shellRadius <= 0) return 0;

  const keepIndices: number[] = [];
  const indexArray = index.array;
  let removedTriangles = 0;

  for (let i = 0; i < indexArray.length; i += 3) {
    const a = Number(indexArray[i]);
    const b = Number(indexArray[i + 1]);
    const c = Number(indexArray[i + 2]);

    const ra = getVertexRadius(position, a);
    const rb = getVertexRadius(position, b);
    const rc = getVertexRadius(position, c);
    const minRadius = Math.min(ra, rb, rc);
    const maxRadius = Math.max(ra, rb, rc);

    if (
      minRadius < shellRadius * COLLAPSED_TRIANGLE_MIN_RADIUS_FRACTION
      && maxRadius > shellRadius * COLLAPSED_TRIANGLE_MAX_RADIUS_FRACTION
    ) {
      removedTriangles += 1;
      continue;
    }

    keepIndices.push(a, b, c);
  }

  if (removedTriangles === 0) return 0;

  geometry.setIndex(keepIndices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return removedTriangles;
}

function flushPendingNebulaSkyRequests(): void {
  if (!_nebulaSkyTemplate) return;

  const pending = _pendingNebulaSkyRequests.splice(0);
  for (const request of pending) {
    request.onReady(cloneNebulaSkyboxInstance(_nebulaSkyTemplate, request.options));
  }
}

function prepareNebulaSkyboxTemplate(template: THREE.Group): number {
  template.renderOrder = NEBULA_SKY_RENDER_ORDER;

  let strippedTriangles = 0;
  template.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;

    const mesh = child as THREE.Mesh;
    strippedTriangles += sanitizeNebulaSkyGeometry(mesh.geometry);
    mesh.renderOrder = NEBULA_SKY_RENDER_ORDER;
  });

  return strippedTriangles;
}

function cloneNebulaSkyMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;

    const mesh = child as THREE.Mesh;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => material.clone());
      return;
    }

    mesh.material = mesh.material.clone();
  });
}

function computeMedianVertexRadius(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): number {
  const radii = new Array<number>(position.count);
  for (let i = 0; i < position.count; i += 1) {
    radii[i] = getVertexRadius(position, i);
  }

  radii.sort((a, b) => a - b);
  const mid = Math.floor(radii.length / 2);
  if (radii.length % 2 === 0) {
    return (radii[mid - 1] + radii[mid]) * 0.5;
  }
  return radii[mid];
}

function getVertexRadius(
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
): number {
  return Math.hypot(position.getX(index), position.getY(index), position.getZ(index));
}
