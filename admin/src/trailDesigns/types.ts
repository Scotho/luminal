import type * as THREE from 'three';
import type { BloomPassLike } from '@main/viewerExports';

/** Context provided to each trail design by the Trail Lab shell. */
export interface TrailLabContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  bloomPass: BloomPassLike;
  /** Trail color chosen by user. */
  color: THREE.Color;
  /** Pre-computed path the trail follows — array of world-space positions. */
  path: THREE.Vector3[];
  /** Height of the trail wall (units). */
  wallHeight: number;
  /** Width of the trail wall (units). */
  wallWidth: number;
}

/** Instance returned by a design's create() — manages one active trail visual. */
export interface TrailDesignInstance {
  /** Called every frame. dt is in seconds. */
  update(dt: number): void;
  /** Remove all scene objects and free GPU resources. */
  dispose(): void;
  /** Optional live-tunable parameters exposed as sliders. */
  params?: Record<string, { value: number; min: number; max: number; step: number; onChange: (v: number) => void }>;
}

/** A trail design definition. */
export interface TrailDesign {
  /** Short unique name shown in selector. */
  name: string;
  /** One-line description of the technique. */
  description: string;
  /** Category tag for filtering. */
  category: 'shader' | 'geometry' | 'postprocess' | 'hybrid' | 'material';
  /** Create the trail visual in the scene. */
  create(ctx: TrailLabContext): TrailDesignInstance;
}
