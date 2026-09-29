import type * as THREE from 'three';

/** Layer 0 is the default — all objects and all cameras use it. Unchanged. */
export const LAYER_DEFAULT = 0;

/** Objects on this layer are visible to the floor Reflector's virtual camera.
 *  The main game camera sees all layers, so this is additive — tagged objects
 *  appear in both the main view and the reflection. */
export const LAYER_REFLECTED = 1;

/** Traverse `obj` and all descendants, enabling LAYER_REFLECTED on each.
 *  Safe to call on groups, meshes, lights — anything extending Object3D. */
export function enableReflection(obj: THREE.Object3D): void {
  obj.traverse(child => child.layers.enable(LAYER_REFLECTED));
}
