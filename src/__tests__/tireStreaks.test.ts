import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock three.js for unit testing without WebGL
vi.mock('three', () => {
  const Matrix4 = class {
    elements = new Float32Array(16);
    makeScale() { return this; }
    compose() { return this; }
  };
  const Quaternion = class {
    setFromAxisAngle() { return this; }
  };
  const Vector3 = class {
    x = 0; y = 0; z = 0;
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  };
  const PlaneGeometry = class {
    rotateX() { return this; }
  };
  const MeshStandardMaterial = class {};
  const InstancedMesh = class {
    instanceMatrix = { setUsage: vi.fn(), needsUpdate: false };
    instanceColor: unknown = null;
    count = 0;
    frustumCulled = true;
    setMatrixAt = vi.fn();
  };
  const InstancedBufferAttribute = class {
    needsUpdate = false;
    constructor(public array: Float32Array, public itemSize: number) {}
  };
  const Object3D = { DEFAULT_UP: { x: 0, y: 1, z: 0 } };

  return {
    Matrix4,
    Quaternion,
    Vector3,
    PlaneGeometry,
    MeshStandardMaterial,
    InstancedMesh,
    InstancedBufferAttribute,
    Object3D,
    AdditiveBlending: 2,
    DynamicDrawUsage: 35048,
  };
});

import { TireStreakSystem, getDriftIntensity } from '../effects/tireStreaks';

describe('TireStreakSystem', () => {
  let system: TireStreakSystem;

  beforeEach(() => {
    system = new TireStreakSystem({ maxInstances: 16 });
  });

  it('fresh system has 0 active, maxInstances free', () => {
    expect(system.activeCount).toBe(0);
    expect(system.freeCount).toBe(16);
  });

  it('spawnStreak adds active instances', () => {
    system.spawnStreak(0, 0, 0, 'low', 0);
    system.spawnStreak(1, 1, 0.5, 'med', 0);
    expect(system.activeCount).toBe(2);
    expect(system.freeCount).toBe(14);
  });

  it('tickFade releases instances after fade duration', () => {
    system.spawnStreak(0, 0, 0, 'low', 0);
    system.spawnStreak(1, 0, 0, 'high', 0);
    expect(system.activeCount).toBe(2);

    system.tickFade(1600); // past 1500ms default fade
    expect(system.activeCount).toBe(0);
    expect(system.freeCount).toBe(16);
  });

  it('clear() releases all instances', () => {
    for (let i = 0; i < 10; i++) {
      system.spawnStreak(i, 0, 0, 'med', 0);
    }
    expect(system.activeCount).toBe(10);

    system.clear();
    expect(system.activeCount).toBe(0);
    expect(system.freeCount).toBe(16);
  });

  it('spawn past cap reclaims oldest instance', () => {
    for (let i = 0; i < 16; i++) {
      system.spawnStreak(i, 0, 0, 'low', i);
    }
    expect(system.activeCount).toBe(16);
    expect(system.freeCount).toBe(0);

    // Age first few instances
    system.tickFade(500);

    // Spawn one more — should reclaim one
    system.spawnStreak(99, 0, 0, 'high', 1000);
    expect(system.activeCount).toBe(16);
  });

  it('tickFade with partial time keeps some instances active', () => {
    for (let i = 0; i < 5; i++) {
      system.spawnStreak(i, 0, 0, 'low', 0);
    }
    system.tickFade(750); // half the fade duration
    expect(system.activeCount).toBe(5); // none released yet
  });
});

describe('getDriftIntensity', () => {
  it('returns low for small slip/speed', () => {
    expect(getDriftIntensity(0.1, 30, 110)).toBe('low');
  });

  it('returns med for moderate slip/speed', () => {
    expect(getDriftIntensity(0.4, 80, 110)).toBe('med');
  });

  it('returns high for large slip/speed', () => {
    expect(getDriftIntensity(0.7, 90, 110)).toBe('high');
  });
});
