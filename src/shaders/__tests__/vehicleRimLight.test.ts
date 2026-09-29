import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyRimLight, patchMaterial } from '../vehicleRimLight';

function makeMesh(mat: THREE.Material | THREE.Material[]): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  return new THREE.Mesh(geo, mat);
}

describe('applyRimLight', () => {
  it('patches a MeshStandardMaterial on a single mesh', () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const mesh = makeMesh(mat);

    applyRimLight(mesh, { strength: 1.2, power: 2.6, tint: new THREE.Color(0xff0000) });

    expect(mat.onBeforeCompile).toBeTypeOf('function');
    expect(typeof mat.customProgramCacheKey).toBe('function');
  });

  it('short-circuits when strength is 0', () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const originalCb = mat.onBeforeCompile;
    const mesh = makeMesh(mat);

    applyRimLight(mesh, { strength: 0, power: 2.6, tint: new THREE.Color(0xff0000) });

    expect(mat.onBeforeCompile).toBe(originalCb);
  });

  it('skips transparent materials (exhaust glows)', () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
    const originalCb = mat.onBeforeCompile;
    const mesh = makeMesh(mat);

    applyRimLight(mesh, { strength: 1.2, power: 2.6, tint: new THREE.Color(0xff0000) });

    expect(mat.onBeforeCompile).toBe(originalCb);
  });

  it('patches multi-material meshes (array) — all entries', () => {
    const a = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const b = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const mesh = makeMesh([a, b]);

    applyRimLight(mesh, { strength: 1.2, power: 2.6, tint: new THREE.Color(0xff0000) });

    expect(a.onBeforeCompile).toBeTypeOf('function');
    expect(b.onBeforeCompile).toBeTypeOf('function');
  });

  it('traverses nested Object3D hierarchies', () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const mesh = makeMesh(mat);
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(mesh);
    outer.add(inner);

    applyRimLight(outer, { strength: 1.2, power: 2.6, tint: new THREE.Color(0xff0000) });

    expect(mat.onBeforeCompile).toBeTypeOf('function');
  });

  it('customProgramCacheKey is stable for the same params', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    patchMaterial(a, { strength: 1.2, power: 2.6, tint: new THREE.Color(0xff0000) });
    patchMaterial(b, { strength: 1.2, power: 2.6, tint: new THREE.Color(0x00ff00) });

    const keyA = (a.customProgramCacheKey as () => string)();
    const keyB = (b.customProgramCacheKey as () => string)();

    expect(keyA).toBe(keyB); // tint doesn't change program shape, only uniform value
  });

  it('customProgramCacheKey stays stable across strength/power changes (they are uniforms, not shader-shape)', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    patchMaterial(a, { strength: 1.2, power: 2.6, tint: new THREE.Color(0xff0000) });
    patchMaterial(b, { strength: 0.8, power: 3.0, tint: new THREE.Color(0xff0000) });

    const keyA = (a.customProgramCacheKey as () => string)();
    const keyB = (b.customProgramCacheKey as () => string)();

    // The key is just a namespace marker — strength/power are uniforms, not
    // shader-shape changes. Both return the same rimLight namespace.
    // This test locks in that behavior so a future refactor doesn't accidentally
    // bust the cache on every frame.
    expect(keyA).toBe(keyB);
    expect(keyA).toContain('rimLight');
  });

  it('injects uniforms and shader code when onBeforeCompile runs', () => {
    const mat = new THREE.MeshStandardMaterial();
    patchMaterial(mat, { strength: 1.2, power: 2.6, tint: new THREE.Color(0xff0000) });

    // Fake the shader object three.js would pass to onBeforeCompile
    const fake = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <worldpos_vertex>\n',
      fragmentShader: '#include <common>\n#include <tonemapping_fragment>\n',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mat.onBeforeCompile as (s: any) => void)(fake);

    // Uniforms set
    expect(fake.uniforms.uRimStrength.value).toBe(1.2);
    expect(fake.uniforms.uRimPower.value).toBe(2.6);

    // Vertex shader injection
    expect(fake.vertexShader).toContain('varying vec3 vRimNormal');
    expect(fake.vertexShader).toContain('vRimNormal = normalize(transformedNormal)');

    // Fragment shader injection — uses vViewPosition (unconditional), not worldPosition
    expect(fake.fragmentShader).toContain('varying vec3 vRimNormal');
    expect(fake.fragmentShader).toContain('uniform float uRimStrength');
    expect(fake.fragmentShader).toContain('gl_FragColor.rgb += uRimTint * rim * uRimStrength');
    expect(fake.fragmentShader).toContain('dot(normalize(vRimNormal), normalize(vViewPosition))');

    // Regression guard: make sure we never reintroduce the worldPosition-based math
    expect(fake.fragmentShader).not.toContain('worldPosition');
    expect(fake.fragmentShader).not.toContain('vRimViewDir');
    expect(fake.vertexShader).not.toContain('vRimViewDir');
  });
});
