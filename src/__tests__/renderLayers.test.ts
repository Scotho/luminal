import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { LAYER_REFLECTED, enableReflection } from '../renderLayers';

describe('renderLayers', () => {
  it('LAYER_REFLECTED is 1', () => {
    expect(LAYER_REFLECTED).toBe(1);
  });

  it('enableReflection tags a single mesh', () => {
    const mesh = new THREE.Mesh();
    enableReflection(mesh);
    expect(mesh.layers.isEnabled(LAYER_REFLECTED)).toBe(true);
  });

  it('enableReflection traverses a group hierarchy', () => {
    const group = new THREE.Group();
    const child1 = new THREE.Mesh();
    const child2 = new THREE.Mesh();
    const nested = new THREE.Group();
    const deep = new THREE.Mesh();
    nested.add(deep);
    group.add(child1, child2, nested);

    enableReflection(group);

    expect(group.layers.isEnabled(LAYER_REFLECTED)).toBe(true);
    expect(child1.layers.isEnabled(LAYER_REFLECTED)).toBe(true);
    expect(child2.layers.isEnabled(LAYER_REFLECTED)).toBe(true);
    expect(deep.layers.isEnabled(LAYER_REFLECTED)).toBe(true);
  });

  it('enableReflection preserves layer 0', () => {
    const mesh = new THREE.Mesh();
    enableReflection(mesh);
    expect(mesh.layers.isEnabled(0)).toBe(true);
    expect(mesh.layers.isEnabled(LAYER_REFLECTED)).toBe(true);
  });
});
