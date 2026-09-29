import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { getGfx, VISUAL_TUNING } from './graphics';

interface GLTFResult {
  scene: THREE.Group;
  scenes: THREE.Group[];
  animations: THREE.AnimationClip[];
  cameras: THREE.Camera[];
  asset: Record<string, unknown>;
  parser: unknown;
  userData: Record<string, unknown>;
}

let _template: GLTFResult | null = null;
let _modelHeight: number = 1.0; // fallback — updated on load from bounding box
let _animationClips: THREE.AnimationClip[] = [];

// Deferred clones: placeholder groups that need the real mesh once the model loads
const _deferred: { group: THREE.Group; color: number; preview: boolean }[] = [];

/** Material names that belong to the board (not the rider). */
const BOARD_MATERIALS = new Set(['M_HoverB_Body', 'M_HoverB_Plates', 'M_HoverB_Lights', 'M_HoverB_Mid']);

/** Rider material — the Mixamo character skin. */
const RIDER_MATERIAL = 'ely_vanguardsoldier_kerwinatienza_M2';

/** Clockwise facing correction applied to hoverboard clone in-game. */
export const HOVER_FACING_OFFSET = -20 * (Math.PI / 180);

function _recolorClone(clone: THREE.Group, color: number, neonIntensity: number): void {
  clone.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = materials.map((mat: THREE.Material) => {
      const m = (mat as THREE.MeshStandardMaterial).clone();
      if (m.name === 'M_HoverB_Lights') {
        m.emissive = new THREE.Color(color);
        m.emissiveIntensity = neonIntensity;
        m.color.setScalar(0);
      } else if (m.name === 'M_HoverB_Body' || m.name === 'M_HoverB_Plates' || m.name === 'M_HoverB_Mid') {
        m.emissive.setScalar(0);
        m.emissiveIntensity = 0;
        m.metalness = 0.9;
        m.roughness = 0.3;
      } else if (m.name === RIDER_MATERIAL) {
        // Rider: match bike/car neon-glow pattern so player color reads on the figure.
        m.emissive = new THREE.Color(color);
        m.emissiveIntensity = neonIntensity;
        m.color.setScalar(0);
      }
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
}

function _applyHoverboardClone(group: THREE.Group, color: number, preview: boolean): void {
  const clone = skeletonClone(_template!.scene) as THREE.Group;
  const neonIntensity: number = (VISUAL_TUNING[getGfx().preset] ?? VISUAL_TUNING.high).neonEmissive;

  _recolorClone(clone, color, neonIntensity);

  if (preview) {
    // Preview mode: keep original GLTF hierarchy intact so SkinnedMesh
    // bones rotate properly on the turntable — no proxy reparenting.
    group.add(clone);
    return;
  }

  // ── In-game mode: separate board/rider into proxies for HoverboardAnimator ──
  // Reparent with identity rotation so SkinnedMesh bone hierarchy is preserved.
  // Rotation is applied on the clone AFTER reparenting (parent-level, like lobby).
  clone.updateMatrixWorld(true);

  const boardProxy = new THREE.Group();
  const riderProxy = new THREE.Group();
  boardProxy.name = 'boardProxy';
  riderProxy.name = 'riderProxy';

  const boardMeshes: THREE.Object3D[] = [];
  const riderMeshes: THREE.Object3D[] = [];

  clone.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const isBoard = mats.some((m: THREE.Material) => BOARD_MATERIALS.has(m.name));
    (isBoard ? boardMeshes : riderMeshes).push(mesh);
  });

  for (const m of boardMeshes) _reparent(m, boardProxy);
  for (const m of riderMeshes) _reparent(m, riderProxy);

  clone.add(boardProxy);
  clone.add(riderProxy);

  // Apply facing rotation AFTER reparenting — keeps it in the parent hierarchy
  // so SkinnedMesh bones are rotated correctly (same pattern as lobby preview).
  // Negative offset = clockwise from above = turn right.
  clone.rotation.y = Math.PI + HOVER_FACING_OFFSET;

  group.userData.boardProxy = boardProxy;
  group.userData.riderProxy = riderProxy;

  group.add(clone);
}

// Reusable math objects for reparenting (only called during clone, not per-frame)
const _tmpPos = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpScale = new THREE.Vector3();

/** Move a child to a new parent while preserving its world-space transform. */
function _reparent(child: THREE.Object3D, newParent: THREE.Group): void {
  child.updateWorldMatrix(true, false);
  child.matrixWorld.decompose(_tmpPos, _tmpQuat, _tmpScale);
  child.removeFromParent();
  child.position.copy(_tmpPos);
  child.quaternion.copy(_tmpQuat);
  child.scale.copy(_tmpScale);
  newParent.add(child);
}

export function loadHoverboardModel(): Promise<void> {
  if (_template) return Promise.resolve();
  if (import.meta.env.DEV) console.log('[HOVERBOARD] loadHoverboardModel() called — fetching GLB');
  return new Promise<void>((resolve, reject) => {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
    loader.load('/models/sci_fi_hoverboard.glb', (gltf: GLTFResult) => {
      if (import.meta.env.DEV) console.log('[HOVERBOARD] GLB loaded OK, scene children:', gltf.scene.children.length, 'animations:', gltf.animations.length);
      _template = gltf;
      _animationClips = gltf.animations;

      // Compute actual model height for accurate scaling
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      _modelHeight = size.y || 1.0;

      // Fill in any placeholder groups that were created before the model loaded
      for (const d of _deferred) {
        _applyHoverboardClone(d.group, d.color, d.preview);
      }
      _deferred.length = 0;
      resolve();
    }, undefined, (err: unknown) => {
      console.error('[HOVERBOARD] GLB load FAILED:', err);
      reject(err);
    });
  });
}

export function isHoverboardModelLoaded(): boolean {
  return _template !== null;
}

/** Returns the measured model height (for scale calculations in player.ts). */
export function getHoverboardModelHeight(): number {
  return _modelHeight;
}

export function cloneHoverboardModel(color: number, preview = false): THREE.Group {
  const group = new THREE.Group();
  if (_template) {
    _applyHoverboardClone(group, color, preview);
  } else {
    // Model not ready — register for deferred fill-in when it loads
    if (import.meta.env.DEV) console.warn('[BUG-18] hoverboard model DEFERRED — not yet loaded at clone time');
    _deferred.push({ group, color, preview });
  }
  return group;
}

/**
 * Clear deferred clone queue — call when switching away from hoverboard vehicle
 * type to prevent orphaned placeholder groups from leaking.
 */
// ts-prune-ignore-next
export function clearHoverboardDeferredQueue(): void {
  _deferred.length = 0;
}
