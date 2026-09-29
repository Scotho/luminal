import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import {
  cloneNebulaSkyboxInstance,
  configureNebulaSkyboxObject,
  NEBULA_SKY_RENDER_ORDER,
  sanitizeNebulaSkyGeometry,
} from './nebulaSkybox';

function makeIndexedGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
    0.01, 0, 0,
  ], 3));
  geometry.setIndex([
    0, 1, 2,
    0, 1, 3,
  ]);
  return geometry;
}

describe('sanitizeNebulaSkyGeometry', () => {
  it('removes shell-to-origin triangles and keeps shell triangles', () => {
    const geometry = makeIndexedGeometry();

    const removed = sanitizeNebulaSkyGeometry(geometry);

    expect(removed).toBe(1);
    expect(Array.from(geometry.getIndex()!.array)).toEqual([0, 1, 2]);
  });

  it('returns 0 when the geometry is not indexed', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ], 3));

    expect(sanitizeNebulaSkyGeometry(geometry)).toBe(0);
  });
});

describe('cloneNebulaSkyboxInstance', () => {
  it('clones materials and applies the shared sky render settings', () => {
    const template = new THREE.Group();
    const geometry = makeIndexedGeometry();
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(geometry, material);
    template.add(mesh);

    const sky = cloneNebulaSkyboxInstance(template, { fog: false, scale: 42 });
    const clonedMesh = sky.children[0] as THREE.Mesh;
    const clonedMaterial = clonedMesh.material as THREE.MeshBasicMaterial;

    expect(clonedMaterial).not.toBe(material);
    expect(clonedMaterial.side).toBe(THREE.DoubleSide);
    expect(clonedMaterial.depthWrite).toBe(false);
    expect(clonedMaterial.fog).toBe(false);
    expect(clonedMesh.renderOrder).toBe(NEBULA_SKY_RENDER_ORDER);
    expect(sky.renderOrder).toBe(NEBULA_SKY_RENDER_ORDER);
    expect(sky.scale.x).toBeCloseTo(42);
    expect(sky.scale.y).toBeCloseTo(42);
    expect(sky.scale.z).toBeCloseTo(42);
  });

  it('can configure an existing sky object in place', () => {
    const sky = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    sky.add(mesh);

    configureNebulaSkyboxObject(sky, { fog: true, scale: 3 });

    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(true);
    expect(mesh.renderOrder).toBe(NEBULA_SKY_RENDER_ORDER);
    expect(sky.scale.x).toBeCloseTo(3);
  });
});
