import * as THREE from 'three';
import type { TrailDesign, TrailDesignInstance, TrailLabContext } from './types';

function buildBoxSegments(
  path: THREE.Vector3[],
  width: number,
  height: number,
  material: THREE.Material,
  renderOrder: number,
  scene: THREE.Scene,
  out: THREE.Mesh[],
): void {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const length = new THREE.Vector3().subVectors(b, a).length();
    if (length < 0.001) continue;
    const geo = new THREE.BoxGeometry(width, height, length);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
    mesh.lookAt(b);
    mesh.rotateX(Math.PI / 2);
    mesh.renderOrder = renderOrder;
    scene.add(mesh);
    out.push(mesh);
  }
}

function buildSpillSegments(
  path: THREE.Vector3[],
  width: number,
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
    const geo = new THREE.PlaneGeometry(width, length);
    const mesh = new THREE.Mesh(geo, material);
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mesh.position.set(mid.x, 0.02, mid.z);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(dir.x, dir.z);
    mesh.renderOrder = renderOrder;
    scene.add(mesh);
    out.push(mesh);
  }
}

const design: TrailDesign = {
  name: 'Kitchen Sink',
  description: 'Everything combined: dark metal body + emissive fill + additive crown + fresnel + ground spill + noise pulse',
  category: 'hybrid',

  create(ctx: TrailLabContext): TrailDesignInstance {
    const { scene, path, color, wallHeight, wallWidth } = ctx;

    // Layer 1 — Dark body: metallic physical wall
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      metalness: 0.7,
      roughness: 0.08,
      emissive: color.clone().multiplyScalar(0.1),
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Layer 2 — Emissive fill: semi-transparent saturated neon
    const fillMat = new THREE.MeshStandardMaterial({
      emissive: color.clone(),
      emissiveIntensity: 1.8,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Layer 3 — Additive crown: thin bright cap
    const crownMat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Layer 4 — Ground spill: flat additive floor glow
    const spillMat = new THREE.MeshBasicMaterial({
      color: color.clone(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
    });

    const bodyMeshes: THREE.Mesh[] = [];
    const fillMeshes: THREE.Mesh[] = [];
    const crownMeshes: THREE.Mesh[] = [];
    const spillMeshes: THREE.Mesh[] = [];

    buildBoxSegments(path, wallWidth * 1.3, wallHeight, bodyMat,  8, scene, bodyMeshes);
    buildBoxSegments(path, wallWidth * 1.0, wallHeight, fillMat,  9, scene, fillMeshes);
    buildBoxSegments(path, wallWidth * 0.5, wallHeight, crownMat, 10, scene, crownMeshes);
    buildSpillSegments(path, wallWidth * 6,             spillMat, 7, scene, spillMeshes);

    let elapsed = 0;
    let baseFillEmissive = 1.8;

    return {
      update(dt: number): void {
        elapsed += dt;
        // Noise pulse: gently modulate fill emissive intensity with a sine wave
        fillMat.emissiveIntensity = baseFillEmissive * (0.85 + 0.15 * Math.sin(elapsed * 3.7));
      },
      dispose(): void {
        for (const m of bodyMeshes)  { scene.remove(m); m.geometry.dispose(); }
        for (const m of fillMeshes)  { scene.remove(m); m.geometry.dispose(); }
        for (const m of crownMeshes) { scene.remove(m); m.geometry.dispose(); }
        for (const m of spillMeshes) { scene.remove(m); m.geometry.dispose(); }
        bodyMat.dispose();
        fillMat.dispose();
        crownMat.dispose();
        spillMat.dispose();
        bodyMeshes.length = 0;
        fillMeshes.length = 0;
        crownMeshes.length = 0;
        spillMeshes.length = 0;
      },
      params: {
        bodyOpacity: {
          value: 0.85, min: 0.1, max: 1.0, step: 0.05,
          onChange(v: number) { bodyMat.opacity = v; },
        },
        fillEmissive: {
          value: 1.8, min: 0.3, max: 5, step: 0.1,
          onChange(v: number) { baseFillEmissive = v; fillMat.emissiveIntensity = v; },
        },
        crownOpacity: {
          value: 0.4, min: 0.05, max: 1.0, step: 0.05,
          onChange(v: number) { crownMat.opacity = v; },
        },
        spillOpacity: {
          value: 0.06, min: 0.0, max: 0.25, step: 0.01,
          onChange(v: number) { spillMat.opacity = v; },
        },
        metalness: {
          value: 0.7, min: 0.0, max: 1.0, step: 0.05,
          onChange(v: number) { bodyMat.metalness = v; },
        },
      },
    };
  },
};

export default design;
