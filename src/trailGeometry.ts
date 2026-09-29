import * as THREE from 'three';

const TOP_INSET_FRACTION = 0.09;       // top edge is (1 - 0.09)x wallWidth
const BEVEL_HEIGHT_FRACTION = 0.085;   // shallow crown bevel for the flatter Legacy wall
const BEVEL_SEGMENTS = 2;              // keep low - just enough to soften the cap

/**
 * Build a tapered-prism wall geometry to replace BoxGeometry for trail walls.
 *
 * Shape (side view, X = length):
 *   Bottom (Y=-h/2): full wallWidth
 *   Body (Y=-h/2 .. h/2*0.8): straight walls at full wallWidth
 *   Bevel (Y=h/2*0.8 .. h/2): wallWidth tapers to wallWidth*(1-TOP_INSET)
 *   Top ridge: rounded bevel with BEVEL_SEGMENTS steps
 *
 * Extruded along X with unit length [-0.5, 0.5]. Only the two long side
 * faces and the top ridge bevel are emitted (no bottom face, no end caps).
 *
 * Bounding box matches the BoxGeometry it replaces on X and Y extents, so
 * per-instance matrix math in trail.ts is unchanged.
 */
export function buildTrailWallGeometry(
  wallHeight: number,
  wallWidth: number,
): THREE.BufferGeometry {
  const halfH = wallHeight / 2;
  const halfW = wallWidth / 2;
  const bevelStartY = halfH - wallHeight * BEVEL_HEIGHT_FRACTION;

  const slices: Array<{ y: number; z: number }> = [];
  slices.push({ y: -halfH, z: halfW });
  slices.push({ y: bevelStartY, z: halfW });
  for (let i = 1; i <= BEVEL_SEGMENTS; i++) {
    const t = i / BEVEL_SEGMENTS;
    const ease = Math.sin(t * Math.PI / 2);
    const y = bevelStartY + (halfH - bevelStartY) * t;
    const z = halfW * (1 - TOP_INSET_FRACTION * ease);
    slices.push({ y, z });
  }

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const side of [+1, -1]) {
    for (let i = 0; i < slices.length - 1; i++) {
      const s0 = slices[i];
      const s1 = slices[i + 1];
      const z0 = side * s0.z;
      const z1 = side * s1.z;
      const base = vertices.length / 3;

      vertices.push(-0.5, s0.y, z0);
      vertices.push(0.5, s0.y, z0);
      vertices.push(0.5, s1.y, z1);
      vertices.push(-0.5, s1.y, z1);

      const dy = s1.y - s0.y;
      const dz = z1 - z0;
      const len = Math.hypot(dy, dz) || 1;
      const nx = 0;
      const ny = -dz / len * side;
      const nz = dy / len * side;
      for (let k = 0; k < 4; k++) normals.push(nx, ny, nz);

      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const topZ = halfW * (1 - TOP_INSET_FRACTION);
  const baseTop = vertices.length / 3;
  vertices.push(-0.5, halfH, topZ);
  vertices.push(0.5, halfH, topZ);
  vertices.push(0.5, halfH, -topZ);
  vertices.push(-0.5, halfH, -topZ);
  for (let k = 0; k < 4; k++) normals.push(0, 1, 0);
  indices.push(baseTop, baseTop + 1, baseTop + 2, baseTop, baseTop + 2, baseTop + 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
