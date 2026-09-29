import * as THREE from 'three';
import type { TrailDesign, TrailDesignInstance, TrailLabContext } from './types';

function buildRibbonSegments(
  path: THREE.Vector3[],
  width: number,
  yPos: number,
  material: THREE.Material,
  renderOrder: number,
  scene: THREE.Scene,
  out: THREE.Mesh[],
): void {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dir = new THREE.Vector3().subVectors(b, a);
    const segLength = dir.length();
    if (segLength < 0.001) continue;

    const geo = new THREE.PlaneGeometry(width, segLength);
    const mesh = new THREE.Mesh(geo, material);

    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mesh.position.set(mid.x, yPos, mid.z);
    mesh.rotation.x = -Math.PI / 2;
    const angle = Math.atan2(dir.x, dir.z);
    mesh.rotation.z = angle;
    mesh.renderOrder = renderOrder;

    scene.add(mesh);
    out.push(mesh);
  }
}

const design: TrailDesign = {
  name: 'Flat Ribbon',
  description: 'Horizontal flat ribbon instead of vertical wall — top-down racing game style',
  category: 'geometry',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallWidth } = ctx;

    let ribbonWidth = 2.0;
    let glowSpread = 8.0;
    let coreOpacity = 0.6;

    const glowMat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const coreMat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: coreOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const glowMeshes: THREE.Mesh[] = [];
    const coreMeshes: THREE.Mesh[] = [];

    function rebuild(): void {
      for (const m of glowMeshes) { scene.remove(m); m.geometry.dispose(); }
      for (const m of coreMeshes) { scene.remove(m); m.geometry.dispose(); }
      glowMeshes.length = coreMeshes.length = 0;
      buildRibbonSegments(path, wallWidth * glowSpread, 0.05, glowMat, 9, scene, glowMeshes);
      buildRibbonSegments(path, wallWidth * ribbonWidth, 0.06, coreMat, 10, scene, coreMeshes);
    }
    rebuild();

    const params: TrailDesignInstance['params'] = {
      ribbonWidth: {
        value: ribbonWidth, min: 0.5, max: 6, step: 0.1,
        onChange(v: number) { ribbonWidth = v; rebuild(); },
      },
      glowSpread: {
        value: glowSpread, min: 2, max: 15, step: 0.5,
        onChange(v: number) { glowSpread = v; rebuild(); },
      },
      coreOpacity: {
        value: coreOpacity, min: 0.1, max: 1.0, step: 0.05,
        onChange(v: number) { coreOpacity = v; coreMat.opacity = v; },
      },
    };

    return {
      update(_dt: number): void {
        // Static geometry — no per-frame updates required.
      },
      dispose(): void {
        for (const m of glowMeshes) { scene.remove(m); m.geometry.dispose(); }
        for (const m of coreMeshes) { scene.remove(m); m.geometry.dispose(); }
        glowMat.dispose();
        coreMat.dispose();
        glowMeshes.length = 0;
        coreMeshes.length = 0;
      },
      params,
    };
  },
};

export default design;
