import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const d22SoftBloom: TrailDesign = {
  name: 'Soft Bloom Only',
  description: 'Minimal trail geometry + cranked bloom — let post-processing do all the glow work',
  category: 'postprocess',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, bloomPass, color, path, wallHeight, wallWidth } = ctx;

    // Save original bloom settings before overriding
    const origStrength  = bloomPass.strength;
    const origRadius    = bloomPass.radius;
    const origThreshold = bloomPass.threshold;

    // Crank bloom — this is the entire visual strategy
    bloomPass.strength  = 1.2;
    bloomPass.radius    = 0.8;
    bloomPass.threshold = 0.05;

    const mat = new THREE.MeshBasicMaterial({
      color,
      opacity: 1.0,
      transparent: false,
      depthWrite: false,
    });

    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];

    const segWidth = wallWidth * 0.3;
    const _mid = new THREE.Vector3();
    const _dir = new THREE.Vector3();

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];

      _dir.subVectors(b, a);
      const segLen = _dir.length();
      if (segLen < 0.0001) continue;

      _mid.addVectors(a, b).multiplyScalar(0.5);
      _mid.y = wallHeight / 2;

      const geo = new THREE.BoxGeometry(segWidth, wallHeight, segLen);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(_mid);
      mesh.rotation.y = Math.atan2(_dir.x, _dir.z);
      mesh.renderOrder = 10;
      scene.add(mesh);
      meshes.push(mesh);
      geometries.push(geo);
    }

    return {
      update(_dt: number): void { /* static — bloom does the work */ },

      dispose(): void {
        // Restore original bloom settings
        bloomPass.strength  = origStrength;
        bloomPass.radius    = origRadius;
        bloomPass.threshold = origThreshold;

        for (const mesh of meshes) scene.remove(mesh);
        for (const geo of geometries) geo.dispose();
        mat.dispose();
        meshes.length = 0;
        geometries.length = 0;
      },

      params: {
        bloomStrength: {
          value: 1.2, min: 0.2, max: 3.0, step: 0.05,
          onChange(v: number) { bloomPass.strength = v; },
        },
        bloomRadius: {
          value: 0.8, min: 0.1, max: 2.0, step: 0.05,
          onChange(v: number) { bloomPass.radius = v; },
        },
        bloomThreshold: {
          value: 0.05, min: 0.0, max: 0.5, step: 0.01,
          onChange(v: number) { bloomPass.threshold = v; },
        },
        trailWidth: {
          value: 0.3, min: 0.1, max: 1.5, step: 0.05,
          onChange(v: number) {
            for (let i = 0; i < meshes.length; i++) {
              meshes[i].scale.x = v / 0.3;
            }
          },
        },
      },
    };
  },
};

export default d22SoftBloom;
