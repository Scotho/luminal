import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

vi.mock('three', () => ({
  Group: vi.fn(function (this: object) {
    (this as { traverse: ReturnType<typeof vi.fn> }).traverse = vi.fn();
  }),
  Box3: vi.fn(function (this: object) {
    Object.assign(this, {
      setFromObject: vi.fn().mockReturnThis(),
      getSize: vi.fn().mockReturnValue({ x: 384, y: 10, z: 384 }),
      getCenter: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    });
  }),
  Vector3: vi.fn(function (this: object) {
    Object.assign(this, { x: 0, y: 0, z: 0 });
  }),
}));

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: vi.fn(function (this: object) {
    (this as { load: ReturnType<typeof vi.fn> }).load = vi.fn();
  }),
}));

import { disposeArenaClone } from './arenaModel';

/** Build a minimal mock Group whose traverse visits the given children. */
function makeGroup(children: object[] = []): THREE.Group {
  const g = new THREE.Group();
  (g as unknown as { traverse: (fn: (o: object) => void) => void }).traverse =
    (fn: (o: object) => void) => children.forEach(fn);
  return g;
}

/** Build a mock mesh with dispose spies on geometry and material(s). */
function makeMesh(opts: { matIsArray?: boolean; hasTextures?: boolean } = {}) {
  const geoDispose = vi.fn();
  const matDispose1 = vi.fn();
  const matDispose2 = vi.fn();
  const mapDispose = vi.fn();
  const emissiveDispose = vi.fn();
  const normalDispose = vi.fn();
  const roughnessDispose = vi.fn();

  const baseMat = (dispose: ReturnType<typeof vi.fn>) => ({
    map: opts.hasTextures ? { dispose: mapDispose } : null,
    emissiveMap: opts.hasTextures ? { dispose: emissiveDispose } : null,
    normalMap: opts.hasTextures ? { dispose: normalDispose } : null,
    roughnessMap: opts.hasTextures ? { dispose: roughnessDispose } : null,
    dispose,
  });

  const mesh = {
    isMesh: true,
    geometry: { dispose: geoDispose },
    material: opts.matIsArray
      ? [baseMat(matDispose1), baseMat(matDispose2)]
      : baseMat(matDispose1),
  };

  return { mesh, geoDispose, matDispose1, matDispose2, mapDispose, emissiveDispose, normalDispose, roughnessDispose };
}

describe('disposeArenaClone', () => {
  it('is exported and is a function', () => {
    expect(typeof disposeArenaClone).toBe('function');
  });

  it('does not throw on a group with no children', () => {
    const group = makeGroup([]);
    expect(() => disposeArenaClone(group)).not.toThrow();
  });

  it('calls traverse on the provided group', () => {
    const traverseSpy = vi.fn();
    const group = makeGroup();
    (group as unknown as { traverse: typeof traverseSpy }).traverse = traverseSpy;
    disposeArenaClone(group);
    expect(traverseSpy).toHaveBeenCalledOnce();
  });

  it('disposes geometry and single material on a mesh child', () => {
    const { mesh, geoDispose, matDispose1 } = makeMesh();
    const group = makeGroup([mesh]);
    disposeArenaClone(group);
    expect(geoDispose).toHaveBeenCalledOnce();
    expect(matDispose1).toHaveBeenCalledOnce();
  });

  it('disposes all materials when mesh.material is an array', () => {
    const { mesh, geoDispose, matDispose1, matDispose2 } = makeMesh({ matIsArray: true });
    const group = makeGroup([mesh]);
    disposeArenaClone(group);
    expect(geoDispose).toHaveBeenCalledOnce();
    expect(matDispose1).toHaveBeenCalledOnce();
    expect(matDispose2).toHaveBeenCalledOnce();
  });

  it('disposes texture maps when present', () => {
    const { mesh, matDispose1, mapDispose, emissiveDispose, normalDispose, roughnessDispose } =
      makeMesh({ hasTextures: true });
    const group = makeGroup([mesh]);
    disposeArenaClone(group);
    expect(mapDispose).toHaveBeenCalledOnce();
    expect(emissiveDispose).toHaveBeenCalledOnce();
    expect(normalDispose).toHaveBeenCalledOnce();
    expect(roughnessDispose).toHaveBeenCalledOnce();
    expect(matDispose1).toHaveBeenCalledOnce();
  });

  it('skips non-mesh children without throwing', () => {
    const nonMesh = { isMesh: false };
    const group = makeGroup([nonMesh]);
    expect(() => disposeArenaClone(group)).not.toThrow();
  });

  it('handles a mix of mesh and non-mesh children', () => {
    const { mesh, geoDispose, matDispose1 } = makeMesh();
    const nonMesh = { isMesh: false };
    const group = makeGroup([nonMesh, mesh, nonMesh]);
    disposeArenaClone(group);
    expect(geoDispose).toHaveBeenCalledOnce();
    expect(matDispose1).toHaveBeenCalledOnce();
  });
});
