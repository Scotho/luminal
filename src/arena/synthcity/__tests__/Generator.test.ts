import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Generator, type GeneratorItem } from '../Generator';

// Minimal stub item — records what it was constructed with and logs remove/update calls.
class StubItem implements GeneratorItem {
  static constructed: number = 0;
  static removed: number = 0;
  static updated: number = 0;

  constructor(public x: number, public z: number) {
    StubItem.constructed++;
  }
  remove(): void { StubItem.removed++; }
  update(): void { StubItem.updated++; }

  static reset(): void {
    StubItem.constructed = 0;
    StubItem.removed = 0;
    StubItem.updated = 0;
  }
}

function makeCameraRef(x: number, z: number) {
  const pos = new THREE.Vector3(x, 0, z);
  const reader = (out: THREE.Vector3): void => out.copy(pos);
  return {
    pos,
    reader,
    move: (nx: number, nz: number): void => { pos.set(nx, 0, nz); },
  };
}

describe('Generator', () => {
  it('populates an initial grid on construction', () => {
    StubItem.reset();
    const cam = makeCameraRef(0, 0);
    const gen = new Generator<StubItem>({
      readCameraPosition: cam.reader,
      cell_size: 10,
      cell_count: 6,
      spawn_obj: StubItem,
    });
    // 6×6 = 36 cells, circular cull keeps roughly π/4 of them.
    expect(StubItem.constructed).toBeGreaterThan(0);
    expect(StubItem.constructed).toBeLessThanOrEqual(36);
    expect(gen).toBeDefined();
  });

  it('ticking update() without movement only updates existing items', () => {
    StubItem.reset();
    const cam = makeCameraRef(0, 0);
    const gen = new Generator<StubItem>({
      readCameraPosition: cam.reader,
      cell_size: 10,
      cell_count: 6,
      spawn_obj: StubItem,
    });
    const constructedAfterInit = StubItem.constructed;
    gen.update();
    // No new cells, existing ones ticked.
    expect(StubItem.constructed).toBe(constructedAfterInit);
    expect(StubItem.updated).toBeGreaterThan(0);
  });

  it('small movement removes and spawns incrementally (no crash)', () => {
    StubItem.reset();
    const cam = makeCameraRef(0, 0);
    const gen = new Generator<StubItem>({
      readCameraPosition: cam.reader,
      cell_size: 10,
      cell_count: 8,
      spawn_obj: StubItem,
    });
    // Move one full cell to the right.
    cam.move(10, 0);
    expect(() => gen.update()).not.toThrow();
    expect(StubItem.removed).toBeGreaterThan(0);
  });

  it('large teleport (>cell_count/2) does not crash — snapshotted bug from standalone', () => {
    StubItem.reset();
    const cam = makeCameraRef(0, 0);
    const gen = new Generator<StubItem>({
      readCameraPosition: cam.reader,
      cell_size: 152,
      cell_count: 8,
      spawn_obj: StubItem,
    });
    // Teleport 18 cells away (like the (-12, 0) → (976, 2800) spawn jump).
    cam.move(976, 2800);
    expect(() => gen.update()).not.toThrow();
    // Everything from the old grid position was disposed.
    expect(StubItem.removed).toBeGreaterThan(0);
    // New cells were added around the new position.
    expect(StubItem.constructed).toBeGreaterThan(0);
  });

  it('teleport exactly at the cell_count/2 boundary still reinits safely', () => {
    StubItem.reset();
    const cam = makeCameraRef(0, 0);
    const gen = new Generator<StubItem>({
      readCameraPosition: cam.reader,
      cell_size: 10,
      cell_count: 8,
      spawn_obj: StubItem,
    });
    // 4 cells away (= cell_count/2 exactly) — should take the reinit path.
    cam.move(40, 0);
    expect(() => gen.update()).not.toThrow();
  });

  it('disposeAll() removes every cell and calls their remove() hook', () => {
    StubItem.reset();
    const cam = makeCameraRef(0, 0);
    const gen = new Generator<StubItem>({
      readCameraPosition: cam.reader,
      cell_size: 10,
      cell_count: 6,
      spawn_obj: StubItem,
    });
    const initial = StubItem.constructed;
    gen.disposeAll();
    expect(StubItem.removed).toBe(initial);
  });

  it('item update() is called on each tick for all live cells', () => {
    StubItem.reset();
    const cam = makeCameraRef(0, 0);
    const gen = new Generator<StubItem>({
      readCameraPosition: cam.reader,
      cell_size: 10,
      cell_count: 4,
      spawn_obj: StubItem,
    });
    const alive = StubItem.constructed;
    StubItem.updated = 0;
    gen.update();
    expect(StubItem.updated).toBe(alive);
  });
});
