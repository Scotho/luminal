import * as THREE from 'three';
import type { TrailDesign, TrailDesignInstance, TrailLabContext } from './types';

function buildWallSegments(
  path: THREE.Vector3[],
  width: number,
  height: number,
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
    const segLength = dir.length();
    if (segLength < 0.001) continue;

    const geo = new THREE.BoxGeometry(width, height, segLength);
    const mesh = new THREE.Mesh(geo, material);

    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mesh.position.set(mid.x, mid.y + yOffset, mid.z);
    mesh.lookAt(new THREE.Vector3(b.x, mid.y + yOffset, b.z));
    mesh.rotateX(Math.PI / 2);
    mesh.renderOrder = renderOrder;

    scene.add(mesh);
    out.push(mesh);
  }
}

function buildGroundSpill(
  path: THREE.Vector3[],
  spillWidth: number,
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

    const geo = new THREE.PlaneGeometry(spillWidth, segLength);
    const mesh = new THREE.Mesh(geo, material);

    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mesh.position.set(mid.x, 0.02, mid.z);
    mesh.rotation.x = -Math.PI / 2;
    // Re-orient along path direction in XZ
    const angle = Math.atan2(dir.x, dir.z);
    mesh.rotation.z = angle;
    mesh.renderOrder = renderOrder;

    scene.add(mesh);
    out.push(mesh);
  }
}

const design: TrailDesign = {
  name: 'Legacy Faithful',
  description:
    'Film-accurate decomposition: dark opaque wall + saturated emissive fill + additive top wire + additive ground spill',
  category: 'hybrid',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    // ── 1. Dark Wall ─────────────────────────────────────────────────────────
    const darkColor = color.clone().multiplyScalar(0.12);
    const darkEmissive = color.clone().multiplyScalar(0.05);
    const darkMat = new THREE.MeshStandardMaterial({
      color: darkColor,
      emissive: darkEmissive,
      emissiveIntensity: 0.5,
      roughness: 0.25,
      metalness: 0.6,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // ── 2. Emissive Fill ─────────────────────────────────────────────────────
    const fillColor = color.clone().multiplyScalar(0.5);
    const fillMat = new THREE.MeshStandardMaterial({
      color: fillColor,
      emissive: color.clone(),
      emissiveIntensity: 2.0,
      roughness: 0.1,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // ── 3. Top Wire ───────────────────────────────────────────────────────────
    const wireColor = color.clone().lerp(new THREE.Color(1, 1, 1), 0.25);
    const wireMat = new THREE.MeshBasicMaterial({
      color: wireColor,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // ── 4. Ground Spill ───────────────────────────────────────────────────────
    const spillMat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    const darkMeshes: THREE.Mesh[] = [];
    const fillMeshes: THREE.Mesh[] = [];
    const wireMeshes: THREE.Mesh[] = [];
    const spillMeshes: THREE.Mesh[] = [];

    // Wall center sits at wallHeight/2 above path y
    const wallCenterY = wallHeight / 2;
    // Top wire: height = wallHeight*0.15, crown center = wallHeight*0.425 + wallHeight/2
    const wireH = wallHeight * 0.15;
    const wireY = wallHeight * 0.425 + wallHeight / 2;

    buildWallSegments(path, wallWidth * 1.3, wallHeight, wallCenterY, darkMat, 8, scene, darkMeshes);
    buildWallSegments(path, wallWidth * 1.1, wallHeight, wallCenterY, fillMat, 9, scene, fillMeshes);
    buildWallSegments(path, wallWidth * 0.4, wireH, wireY, wireMat, 10, scene, wireMeshes);
    buildGroundSpill(path, wallWidth * 5, spillMat, 7, scene, spillMeshes);

    const params: TrailDesignInstance['params'] = {
      fillEmissive: {
        value: 2.0,
        min: 0.5,
        max: 5.0,
        step: 0.1,
        onChange(v: number) {
          fillMat.emissiveIntensity = v;
        },
      },
      wireOpacity: {
        value: 0.5,
        min: 0.1,
        max: 1.0,
        step: 0.05,
        onChange(v: number) {
          wireMat.opacity = v;
        },
      },
      groundSpill: {
        value: 0.08,
        min: 0.0,
        max: 0.3,
        step: 0.01,
        onChange(v: number) {
          spillMat.opacity = v;
        },
      },
      wallDarkness: {
        value: 0.12,
        min: 0.02,
        max: 0.4,
        step: 0.02,
        onChange(v: number) {
          darkMat.color.copy(color).multiplyScalar(v);
        },
      },
    };

    return {
      update(_dt: number): void { /* static geometry */ },
      dispose(): void {
        for (const mesh of darkMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
        for (const mesh of fillMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
        for (const mesh of wireMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
        for (const mesh of spillMeshes) { scene.remove(mesh); mesh.geometry.dispose(); }
        darkMat.dispose();
        fillMat.dispose();
        wireMat.dispose();
        spillMat.dispose();
        darkMeshes.length = 0;
        fillMeshes.length = 0;
        wireMeshes.length = 0;
        spillMeshes.length = 0;
      },
      params,
    };
  },
};
export default design;
