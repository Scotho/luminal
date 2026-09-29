import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { FireworkLineBuffer } from '../fireworkLineBuffer';

describe('FireworkLineBuffer', () => {
  let buf: FireworkLineBuffer;

  beforeEach(() => {
    buf = new FireworkLineBuffer(10); // 10 segment budget
  });

  it('exposes a THREE.LineSegments mesh', () => {
    expect(buf.mesh).toBeInstanceOf(THREE.LineSegments);
  });

  it('reserveSlot returns sequential indices starting at 0', () => {
    expect(buf.reserveSlot()).toBe(0);
    expect(buf.reserveSlot()).toBe(1);
    expect(buf.reserveSlot()).toBe(2);
  });

  it('reserveSlot wraps after exceeding segment budget', () => {
    for (let i = 0; i < 10; i++) buf.reserveSlot();
    expect(buf.reserveSlot()).toBe(0);
    expect(buf.reserveSlot()).toBe(1);
  });

  it('writeSegment stores both endpoint positions and both vertex colors', () => {
    const slot = buf.reserveSlot();
    buf.writeSegment(slot, 1, 2, 3, 4, 5, 6, 0.1, 0.2, 0.3);
    const positions = buf.mesh.geometry.attributes.position.array as Float32Array;
    const colors = buf.mesh.geometry.attributes.color.array as Float32Array;
    const v = slot * 6;
    expect(positions[v + 0]).toBe(1);
    expect(positions[v + 1]).toBe(2);
    expect(positions[v + 2]).toBe(3);
    expect(positions[v + 3]).toBe(4);
    expect(positions[v + 4]).toBe(5);
    expect(positions[v + 5]).toBe(6);
    expect(colors[v + 0]).toBeCloseTo(0.1);
    expect(colors[v + 1]).toBeCloseTo(0.2);
    expect(colors[v + 2]).toBeCloseTo(0.3);
    expect(colors[v + 3]).toBeCloseTo(0.1);
    expect(colors[v + 4]).toBeCloseTo(0.2);
    expect(colors[v + 5]).toBeCloseTo(0.3);
  });

  it('clearSlot zeros both endpoint positions', () => {
    const slot = buf.reserveSlot();
    buf.writeSegment(slot, 1, 2, 3, 4, 5, 6, 1, 1, 1);
    buf.clearSlot(slot);
    const positions = buf.mesh.geometry.attributes.position.array as Float32Array;
    const v = slot * 6;
    for (let i = 0; i < 6; i++) expect(positions[v + i]).toBe(0);
  });

  it('mesh material is AdditiveBlending with vertexColors', () => {
    const mat = buf.mesh.material as THREE.LineBasicMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.vertexColors).toBe(true);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });

  it('dispose calls dispose on geometry and material', () => {
    const geoDispose = vi.spyOn(buf.mesh.geometry, 'dispose');
    const matDispose = vi.spyOn(buf.mesh.material as THREE.Material, 'dispose');
    buf.dispose();
    expect(geoDispose).toHaveBeenCalled();
    expect(matDispose).toHaveBeenCalled();
  });
});
