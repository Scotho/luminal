import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader, type Font } from 'three/addons/loaders/FontLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import type { Shell, FireworksSystemHandle } from './fireworkParticles';
import { Spark } from './fireworkParticles';

const BOMB_TEXT = 'LUMINAL';
const BOMB_SPARK_COUNT = 300;
const FONT_URL = 'https://threejs.org/examples/fonts/helvetiker_regular.typeface.json';

/**
 * Lazy-loaded text-mesh bomb. Samples 300 surface points on a TextGeometry
 * of the word "LUMINAL" and emits sparks at those sampled offsets, rotated
 * to face the camera. Silent no-op if the font fails to load.
 */
export class FireworkTextBomb {
  private sampler: MeshSurfaceSampler | null = null;
  private loading = false;
  private failed = false;

  constructor() {
    void this.loadFont();
  }

  private async loadFont(): Promise<void> {
    if (this.loading || this.sampler || this.failed) return;
    this.loading = true;
    try {
      const loader = new FontLoader();
      const font: Font = await new Promise((resolve, reject) => {
        loader.load(FONT_URL, resolve, undefined, reject);
      });
      const geometry = new TextGeometry(BOMB_TEXT, {
        font,
        size: 16,
        depth: 1,
        curveSegments: 2,
        bevelEnabled: true,
        bevelThickness: 0.1,
        bevelSize: 0.1,
        bevelOffset: 0,
        bevelSegments: 1,
      });

      // Normalize to unit x-width so it fits in the sampled scale.
      const bounds = new THREE.Box3().setFromBufferAttribute(
        geometry.attributes.position as THREE.BufferAttribute,
      );
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      bounds.getCenter(center);
      bounds.getSize(size);
      geometry.translate(-center.x, -center.y, -center.z);
      const sc = 1 / Math.max(0.001, size.x);
      geometry.scale(sc, sc, sc);

      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      this.sampler = new MeshSurfaceSampler(mesh).setWeightAttribute(null).build();
    } catch {
      this.failed = true;
    } finally {
      this.loading = false;
    }
  }

  emit(system: FireworksSystemHandle, shell: Shell, camera: THREE.Camera): void {
    if (!this.sampler) return;
    const sample = new THREE.Vector3();
    const scale = 30; // arena-scale text explosion radius
    for (let i = 0; i < BOMB_SPARK_COUNT; i++) {
      this.sampler.sample(sample);
      sample.applyQuaternion(camera.quaternion);
      const spark = new Spark();
      spark.position.copy(shell.position).addScaledVector(sample, 1);
      spark.velocity.copy(sample).multiplyScalar(scale).add(shell.velocity);
      spark.color.copy(shell.color);
      spark.life = 1.5 + Math.random() * 1.5;
      spark.mass = 1.2;
      spark.drag = 0.99;
      system.emit(spark);
    }
  }

  dispose(): void {
    // Intentional no-op: the mesh/geometry used to build the sampler are
    // local in loadFont() and are already GC'd. The MeshSurfaceSampler
    // holds no GPU resources — it's a CPU sampling helper over vertex data
    // that lives with the sampler instance itself.
  }
}
