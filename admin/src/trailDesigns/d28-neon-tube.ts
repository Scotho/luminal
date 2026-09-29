import * as THREE from 'three';
import type { TrailDesign, TrailDesignInstance, TrailLabContext } from './types';

function buildTubeSegments(
  path: THREE.Vector3[],
  radius: number,
  yOffset: number,
  material: THREE.Material,
  renderOrder: number,
  scene: THREE.Scene,
  out: THREE.Mesh[],
): void {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dir = new THREE.Vector3().subVectors(b, a);
    const length = dir.length();
    if (length < 0.001) continue;

    const geo = new THREE.CylinderGeometry(radius, radius, length, 8, 1, false);
    const mesh = new THREE.Mesh(geo, material);

    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mesh.position.set(mid.x, mid.y + yOffset, mid.z);

    // Align cylinder (default Y-axis) to segment direction
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize(),
    );

    mesh.renderOrder = renderOrder;
    scene.add(mesh);
    out.push(mesh);
  }
}

const design: TrailDesign = {
  name: 'Neon Tube',
  description: 'CylinderGeometry instead of BoxGeometry — round cross-section like an actual neon tube',
  category: 'geometry',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    const tubeRadiusMult = 0.6;
    const coreRadiusMult = 0.25;
    const emissiveIntensity = 2.0;
    const coreOpacityVal = 0.5;
    const yOffset = wallHeight * 0.5;

    const tubeColor = color.clone().multiplyScalar(0.3);

    const tubeMat = new THREE.MeshStandardMaterial({
      color: tubeColor,
      emissive: color,
      emissiveIntensity,
      roughness: 0.1,
      metalness: 0.1,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const coreMat = new THREE.MeshBasicMaterial({
      color: color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: coreOpacityVal,
      depthWrite: false,
    });

    const tubeMeshes: THREE.Mesh[] = [];
    const coreMeshes: THREE.Mesh[] = [];

    buildTubeSegments(path, wallWidth * tubeRadiusMult, yOffset, tubeMat, 9, scene, tubeMeshes);
    buildTubeSegments(path, wallWidth * coreRadiusMult, yOffset, coreMat, 10, scene, coreMeshes);

    return {
      update(_dt: number) { /* static geometry — no per-frame update needed */ },

      dispose() {
        for (const mesh of tubeMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
        for (const mesh of coreMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
        tubeMat.dispose();
        coreMat.dispose();
        tubeMeshes.length = 0;
        coreMeshes.length = 0;
      },

      params: {
        tubeRadius: {
          value: 0.6,
          min: 0.2,
          max: 1.5,
          step: 0.05,
          onChange(v: number) {
            for (const mesh of tubeMeshes) {
              mesh.scale.x = v / tubeRadiusMult;
              mesh.scale.z = v / tubeRadiusMult;
            }
          },
        },
        emissive: {
          value: 2.0,
          min: 0.5,
          max: 6,
          step: 0.1,
          onChange(v: number) { tubeMat.emissiveIntensity = v; },
        },
        coreOpacity: {
          value: 0.5,
          min: 0.1,
          max: 1.0,
          step: 0.05,
          onChange(v: number) { coreMat.opacity = v; },
        },
      },
    };
  },
};

export default design;
