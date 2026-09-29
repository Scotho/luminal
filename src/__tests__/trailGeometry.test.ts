import { describe, it, expect } from 'vitest';

// Use real THREE here — trailGeometry needs real BufferGeometry math.
// This runs in jsdom which supports THREE's math classes.
import * as THREE from 'three';
import { buildTrailWallGeometry } from '../trailGeometry';

describe('buildTrailWallGeometry', () => {
  it('produces a BufferGeometry with position and normal attributes', () => {
    const geo = buildTrailWallGeometry(2.7, 0.32);
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute('position')).toBeDefined();
    expect(geo.getAttribute('normal')).toBeDefined();
  });

  it('has a bounding box that matches the unit-length box it replaces', () => {
    const wallHeight = 2.7;
    const wallWidth = 0.32;
    const geo = buildTrailWallGeometry(wallHeight, wallWidth);
    geo.computeBoundingBox();
    const bbox = geo.boundingBox!;
    expect(bbox.min.x).toBeCloseTo(-0.5, 3);
    expect(bbox.max.x).toBeCloseTo(0.5, 3);
    // Y: centered like BoxGeometry, so [-h/2, +h/2]
    expect(bbox.min.y).toBeCloseTo(-wallHeight / 2, 3);
    expect(bbox.max.y).toBeCloseTo(wallHeight / 2, 3);
    // Z: bottom is full width
    expect(bbox.min.z).toBeCloseTo(-wallWidth / 2, 3);
    expect(bbox.max.z).toBeCloseTo(wallWidth / 2, 3);
  });

  it('has a slightly narrower top than bottom for the flattened crown', () => {
    const wallWidth = 0.32;
    const geo = buildTrailWallGeometry(2.7, wallWidth);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    let maxZAtTop = 0;
    let maxZAtBottom = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const absZ = Math.abs(pos.getZ(i));
      if (y > 2.7 * 0.475) maxZAtTop = Math.max(maxZAtTop, absZ);
      if (y < -2.7 * 0.4) maxZAtBottom = Math.max(maxZAtBottom, absZ);
    }
    expect(maxZAtBottom).toBeCloseTo(wallWidth / 2, 3);
    // Top should still be inset, but only lightly for the flatter Legacy wall.
    expect(maxZAtTop).toBeLessThan((wallWidth / 2) * 0.94);
    expect(maxZAtTop).toBeGreaterThan((wallWidth / 2) * 0.88);
  });

  it('emits at least two side faces plus the top ridge (vertex count > 12)', () => {
    const geo = buildTrailWallGeometry(2.7, 0.32);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    // Two quads (12 verts) minimum for a pure rectangular side layer;
    // adding a beveled top ridge pushes it higher.
    expect(pos.count).toBeGreaterThanOrEqual(18);
  });

  it('has outward-facing normals on the two long side faces (nZ non-zero)', () => {
    const geo = buildTrailWallGeometry(2.7, 0.32);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    let foundLeftSide = false, foundRightSide = false;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) < -0.1 && nrm.getZ(i) < -0.5) foundLeftSide = true;
      if (pos.getZ(i) >  0.1 && nrm.getZ(i) >  0.5) foundRightSide = true;
    }
    expect(foundLeftSide).toBe(true);
    expect(foundRightSide).toBe(true);
  });
});
