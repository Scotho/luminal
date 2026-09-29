import * as THREE from 'three';
import type { TrailDesign, TrailLabContext, TrailDesignInstance } from '../trailDesigns/types';

const d01ClassicEmissive: TrailDesign = {
  name: 'Classic Emissive Wall',
  description: 'MeshStandardMaterial with high emissive, standard blending — the baseline Tron wall',
  category: 'material',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, color, path, wallHeight, wallWidth } = ctx;

    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: color.clone(),
      emissiveIntensity: 3.0,
      roughness: 0.08,
      metalness: 0.0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });

    const haloMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: color.clone().multiplyScalar(0.85),
      emissiveIntensity: 1.5,
      roughness: 0.14,
      metalness: 0.0,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
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

      const angle = Math.atan2(_dir.x, _dir.z);

      // Core segment
      const coreGeo = new THREE.BoxGeometry(wallWidth, wallHeight, segLen);
      const coreMesh = new THREE.Mesh(coreGeo, coreMat);
      coreMesh.position.copy(_mid);
      coreMesh.rotation.y = angle;
      scene.add(coreMesh);
      meshes.push(coreMesh);
      geometries.push(coreGeo);

      // Halo segment
      const haloGeo = new THREE.BoxGeometry(wallWidth * 1.6, wallHeight, segLen);
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.position.copy(_mid);
      haloMesh.rotation.y = angle;
      scene.add(haloMesh);
      meshes.push(haloMesh);
      geometries.push(haloGeo);
    }

    return {
      update(_dt: number): void {
        // Static trail — nothing to update each frame
      },

      dispose(): void {
        for (const mesh of meshes) scene.remove(mesh);
        for (const geo of geometries) geo.dispose();
        coreMat.dispose();
        haloMat.dispose();
        meshes.length = 0;
        geometries.length = 0;
      },

      params: {
        coreEmissive: {
          value: 3.0,
          min: 0.5,
          max: 8,
          step: 0.1,
          onChange(v: number) { coreMat.emissiveIntensity = v; },
        },
        haloEmissive: {
          value: 1.5,
          min: 0.2,
          max: 5,
          step: 0.1,
          onChange(v: number) { haloMat.emissiveIntensity = v; },
        },
        coreOpacity: {
          value: 0.5,
          min: 0.1,
          max: 1.0,
          step: 0.05,
          onChange(v: number) { coreMat.opacity = v; },
        },
        haloOpacity: {
          value: 0.35,
          min: 0.05,
          max: 0.8,
          step: 0.05,
          onChange(v: number) { haloMat.opacity = v; },
        },
      },
    };
  },
};

export default d01ClassicEmissive;
