import * as THREE from 'three';

/**
 * Pooled LineSegments primitive for the fireworks module. One draw call.
 * Each "slot" owns a 2-vertex line segment — endpoints and per-vertex colors.
 * Slots are allocated sequentially and wrap once the budget is exhausted.
 */
export class FireworkLineBuffer {
  readonly mesh: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly segmentBudget: number;
  private top = 0;

  constructor(segmentBudget = 12_000) {
    this.segmentBudget = segmentBudget;
    const vertexCount = segmentBudget * 2;

    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);

    this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);

    this.colorAttr = new THREE.BufferAttribute(this.colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('color', this.colorAttr);

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    this.mesh = new THREE.LineSegments(geometry, material);
    this.mesh.frustumCulled = false;
  }

  /** Reserve a segment slot. Wraps once the budget is exhausted. */
  reserveSlot(): number {
    const slot = this.top;
    this.top = (this.top + 1) % this.segmentBudget;
    return slot;
  }

  /** Write both endpoints + both vertex colors for a slot. */
  writeSegment(
    slot: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    r: number, g: number, b: number,
  ): void {
    const v = slot * 6;
    this.positions[v + 0] = ax;
    this.positions[v + 1] = ay;
    this.positions[v + 2] = az;
    this.positions[v + 3] = bx;
    this.positions[v + 4] = by;
    this.positions[v + 5] = bz;
    this.colors[v + 0] = r;
    this.colors[v + 1] = g;
    this.colors[v + 2] = b;
    this.colors[v + 3] = r;
    this.colors[v + 4] = g;
    this.colors[v + 5] = b;
  }

  /** Zero a slot's positions and colors so the segment collapses to origin and contributes nothing. */
  clearSlot(slot: number): void {
    const v = slot * 6;
    this.positions.fill(0, v, v + 6);
    this.colors.fill(0, v, v + 6);
  }

  /** Mark the buffer dirty so the GPU uploads changes. Call once per frame. */
  markDirty(): void {
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  /** Zero both attribute arrays and reset the ring cursor. Use when tearing down a system between victory screens. */
  reset(): void {
    this.positions.fill(0);
    this.colors.fill(0);
    this.top = 0;
    this.markDirty();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
