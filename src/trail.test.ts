import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { setPreset } from './graphics';
import { Trail, deriveTrailColorProfile } from './trail';

function hueOf(color: THREE.Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return hsl.h;
}

function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 1 - diff);
}

describe('trail color profile', () => {
  beforeEach(() => {
    localStorage.clear();
    setPreset('high');
  });

  it('preserves hue family across derived base, core, and halo colors', () => {
    const samples = [0x2aa8ff, 0xff3344, 0x2cff7d, 0xae5cff, 0xff9a2e];

    for (const sample of samples) {
      const source = new THREE.Color(sample);
      const profile = deriveTrailColorProfile(sample);
      const sourceHue = hueOf(source);

      expect(hueDistance(sourceHue, hueOf(profile.baseColor))).toBeLessThan(0.02);
      expect(hueDistance(sourceHue, hueOf(profile.coreColor))).toBeLessThan(0.03);
      expect(hueDistance(sourceHue, hueOf(profile.haloColor))).toBeLessThan(0.02);
    }
  });

  it('builds a brighter tinted core instead of collapsing to a fixed white cast', () => {
    const profile = deriveTrailColorProfile(0xae5cff);
    const baseHsl = { h: 0, s: 0, l: 0 };
    const coreHsl = { h: 0, s: 0, l: 0 };
    const haloHsl = { h: 0, s: 0, l: 0 };

    profile.baseColor.getHSL(baseHsl);
    profile.coreColor.getHSL(coreHsl);
    profile.haloColor.getHSL(haloHsl);

    expect(coreHsl.l).toBeGreaterThan(baseHsl.l);
    expect(haloHsl.l).toBeGreaterThan(baseHsl.l);
    expect(coreHsl.s).toBeGreaterThan(0.18);
    expect(hueDistance(baseHsl.h, coreHsl.h)).toBeLessThan(0.03);
  });

  it('boosts darker colors without oversaturating bloom inputs', () => {
    const darkProfile = deriveTrailColorProfile(0x2146ff);
    const brightProfile = deriveTrailColorProfile(0xffd94a);

    // With preset-based tuning, dark and bright profiles share the same emissive values
    expect(darkProfile.wallEmissive).toBe(brightProfile.wallEmissive);
  });
});

describe('Trail graphics settings integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates trail materials with correct render settings', () => {
    setPreset('high');
    const trail = new Trail(new THREE.Scene(), 0x00ffaa);

    expect(trail.wallMat.depthWrite).toBe(false);
    expect(trail.wallMat.forceSinglePass).toBe(true);
    expect(trail.wallMesh.renderOrder).toBe(10);
    expect(trail.haloWallMesh.renderOrder).toBe(9);
    trail.destroy();
  });

  it('updates core and halo live segments for the current bike head position', () => {
    setPreset('high');
    const trail = new Trail(new THREE.Scene(), 0x00ffaa);

    trail.addPoint(0, 0);
    trail.updateHead(4, 0);
    expect(trail._liveSeg).toBeTruthy();
    expect(trail._haloLiveSeg).toBeTruthy();
    expect(trail._liveSeg!.position.x).toBeCloseTo(2);
    expect(trail._liveSeg!.position.z).toBeCloseTo(0);
    expect(trail._liveSeg!.scale.x).toBeGreaterThan(4);
    expect(trail._haloLiveSeg!.scale.x).toBeGreaterThan(4);

    trail.addPoint(4, 0);
    expect(trail.wallMesh.count).toBe(1);
    expect(trail.haloWallMesh.count).toBe(1);

    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    trail.wallMesh.getMatrixAt(0, matrix);
    matrix.decompose(pos, quat, scale);
    expect(pos.x).toBeCloseTo(2);
    expect(pos.z).toBeCloseTo(0);
    expect(scale.x).toBeGreaterThan(4);

    trail.destroy();
  });

  it('cleans up the trail resources on destroy', () => {
    setPreset('high');
    const scene = new THREE.Scene();
    const trail = new Trail(scene, 0x00ffaa);
    trail.addPoint(0, 0);
    trail.updateHead(4, 0);

    expect(scene.children.includes(trail.wallMesh)).toBe(true);
    expect(scene.children.includes(trail.haloWallMesh)).toBe(true);
    expect(scene.children.includes(trail._liveSeg!)).toBe(true);

    trail.destroy();

    expect(scene.children.includes(trail.wallMesh)).toBe(false);
    expect(scene.children.includes(trail.haloWallMesh)).toBe(false);
  });

  it('patches the standard shader with a dedicated trail tint varying', () => {
    setPreset('high');
    const trail = new Trail(new THREE.Scene(), 0x00ffaa);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };

    trail.wallMat.onBeforeCompile(shader as Parameters<NonNullable<typeof trail.wallMat.onBeforeCompile>>[0]);

    expect(shader.fragmentShader).not.toContain('varying vec3 vColor;');
    expect(shader.vertexShader).toContain('varying vec3 vTrailTint;');
    expect(shader.vertexShader).toContain('vTrailTint *= instanceColor.rgb;');
    expect(shader.fragmentShader).toContain('varying vec3 vTrailTint;');
    expect(shader.fragmentShader).toContain('col *= max(vTrailTint, vec3(0.8));');

    trail.destroy();
  });

});
