import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from './types';

const d25HdrOverexpose: TrailDesign = {
  name: 'HDR Overexpose',
  description: 'Extreme emissiveIntensity (10-20x) — push past tone mapping into overexposed HDR territory',
  category: 'material',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: color,
      emissiveIntensity: 15.0,
      roughness: 0.0,
      metalness: 0.0,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];

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

      const geo = new THREE.BoxGeometry(wallWidth * 1.0, wallHeight, segLen);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(_mid);
      mesh.rotation.y = Math.atan2(_dir.x, _dir.z);
      mesh.renderOrder = 10;
      scene.add(mesh);
      meshes.push(mesh);
      geometries.push(geo);
    }

    return {
      update(_dt: number): void { /* static — tone mapping does the work */ },

      dispose(): void {
        for (const mesh of meshes) scene.remove(mesh);
        for (const geo of geometries) geo.dispose();
        mat.dispose();
        meshes.length = 0;
        geometries.length = 0;
      },

      params: {
        emissiveIntensity: {
          value: 15,
          min: 1,
          max: 30,
          step: 0.5,
          onChange(v: number) { mat.emissiveIntensity = v; },
        },
        opacity: {
          value: 0.8,
          min: 0.1,
          max: 1.0,
          step: 0.05,
          onChange(v: number) { mat.opacity = v; },
        },
        roughness: {
          value: 0.0,
          min: 0.0,
          max: 1.0,
          step: 0.05,
          onChange(v: number) { mat.roughness = v; },
        },
      },
    };
  },
};

export default d25HdrOverexpose;
