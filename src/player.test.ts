import { describe, it, expect, vi } from 'vitest';

// ── Mock heavy dependencies before importing ────────────────

vi.mock('three', () => {
  const fn = vi.fn;
  const vec3 = () => ({ x: 0, y: 0, z: 0, set: fn(), copy: fn(), addScaledVector: fn(), normalize: fn(), multiplyScalar: fn(), setScalar: fn() });
  return {
    Color: fn().mockImplementation(function () {
      return {
        r: 0.5, g: 0.5, b: 0.5,
        setScalar: fn(),
        getHexString: fn().mockReturnValue('ff0000'),
        clone: fn(),
        getHSL: fn().mockImplementation(function (target: { h: number; s: number; l: number }) {
          target.h = 0; target.s = 0; target.l = 0.5;
          return target;
        }),
      };
    }),
    Group: fn().mockImplementation(function () {
      return {
        add: fn(), remove: fn(), traverse: fn(), position: vec3(), rotation: { x: 0, y: 0, z: 0 },
        scale: vec3(), children: [], layers: { enable: fn(), set: fn() },
      };
    }),
    Mesh: fn().mockImplementation(function () {
      return {
        position: vec3(), rotation: { x: 0, y: 0, z: 0 }, scale: vec3(),
        layers: { enable: fn(), set: fn() }, material: {},
      };
    }),
    MeshStandardMaterial: fn().mockImplementation(function () { return { dispose: fn() }; }),
    MeshBasicMaterial: fn().mockImplementation(function () { return { dispose: fn() }; }),
    PointLight: fn().mockImplementation(function () {
      return { position: vec3(), layers: { enable: fn(), set: fn() }, color: { setHex: fn() } };
    }),
    SpotLight: fn().mockImplementation(function () {
      return {
        position: vec3(), target: { position: vec3() },
        layers: { enable: fn(), set: fn() }, color: { setHex: fn() },
      };
    }),
    Points: fn().mockImplementation(function () {
      return { position: vec3(), geometry: { attributes: { position: { array: new Float32Array(0) } }, dispose: fn() }, visible: false };
    }),
    PointsMaterial: fn().mockImplementation(function () { return { dispose: fn(), color: { setHex: fn() } }; }),
    BufferGeometry: fn().mockImplementation(function () {
      return { setAttribute: fn(), attributes: { position: { array: new Float32Array(0) } }, dispose: fn() };
    }),
    Float32BufferAttribute: fn().mockImplementation(function () { return {}; }),
    Vector3: fn().mockImplementation(function () { return vec3(); }),
    Box3: fn().mockImplementation(function () {
      return { setFromObject: fn().mockReturnThis(), getSize: fn() };
    }),
    Scene: fn().mockImplementation(function () {
      return { add: fn(), remove: fn() };
    }),
    Object3D: fn().mockImplementation(function () {
      return { position: vec3(), rotation: { x: 0, y: 0, z: 0 } };
    }),
    CylinderGeometry: fn().mockImplementation(function () { return { dispose: fn() }; }),
    SphereGeometry: fn().mockImplementation(function () { return { dispose: fn() }; }),
    BoxGeometry: fn().mockImplementation(function () { return { dispose: fn() }; }),
    MathUtils: { clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)), lerp: (a: number, b: number, t: number) => a + (b - a) * t },
    BufferAttribute: fn().mockImplementation(function () { return {}; }),
    AdditiveBlending: 2,
  };
});

vi.mock('./trail', () => ({
  Trail: vi.fn().mockImplementation(function () {
    return {
      getPoints: vi.fn().mockReturnValue([]),
      addPoint: vi.fn(),
      mesh: { visible: false },
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('./utils', () => ({
  pointToSegmentDist: vi.fn().mockReturnValue(999),
}));

vi.mock('./graphics', () => ({
  getGfx: vi.fn().mockReturnValue({ preset: 'high' }),
  bloomMul: { vehicles: 1, trails: 1, environment: 1, lights: 1 },
  VISUAL_TUNING: { high: { neonEmissive: 1.5 } },
}));

vi.mock('./spatialGrid', () => ({
  grid: {
    insert: vi.fn(),
    remove: vi.fn(),
    query: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('./vehicleConfig', async () => {
  const actual = await vi.importActual<typeof import('./vehicleConfig')>('./vehicleConfig');
  return actual;
});

vi.mock('./core/simulation', () => ({
  advancePlayer: vi.fn(),
  finalizeGrindCashOut: vi.fn(),
  consumeGrindBustScore: vi.fn().mockReturnValue(0),
  GRIND_SWEET_SPOT: 0.30,
  GRIND_SCORE_METER_DIVISOR: 20,
  GRIND_COOLDOWN: 3.0,
  createPlayerSim: vi.fn().mockImplementation((x: number, z: number, angle: number, speed: number, vehicleType: string) => ({
    x, z, angle, speed, vehicleType, meter: 100, alive: true,
    boosting: false, dashing: false, brakeBlend: 0, trailTimer: 0,
    proximityBoost: 0, courseAssist: 0, drifting: false, slipAngle: 0,
    velocityAngle: angle, driftTimer: 0, driftEntryTimer: 0,
    driftBrakeHeld: false, driftBrakeReleased: false, driftAlignTimer: 0,
    snapRecovery: false, snapRecoveryTimer: 0, snapRecoveryBoosted: false,
    snapRecoveryFromAngle: angle, turnRamp: 0, boostLocked: false,
    fumes: false, fumesTimer: 0, sputterSFX: false,
    grinding: false, grindTrailOwner: -1, grindSegIdx: 0, grindSegT: 0,
    grindBalance: 0, grindLeanDir: 0, grindRngState: 0, grindSpeed: 0,
    grindDuration: 0, grindGraceTimer: 0, grindDirection: 1, grindOwnTrail: false,
    grindTrailVehicleType: null, _grindDestroyQueue: [], grindBailSide: 0,
    grindStreakCount: 0, grindStreakBest: 0, grindStreakBroken: false,
    airborne: false, airborneTimer: 0, airborneDuration: 0, airbornePeak: 0,
    landingPenalty: false, recovery: false, recoveryTimer: 0, grindCooldown: 0,
    trickInputBuffer: [], trickDetected: '', trickMeterBonus: 0, trickSampleTimer: 0,
    grindScore: 0, grindMultiplier: 1.0, grindChain: [], grindChainDirty: 0,
    grindBustScore: 0, grindRunActive: false, grindSnapAvailable: false,
    grindedOnTimer: 0,
  })),
}));

vi.mock('./sfx', () => ({
  playGrindSweetLockIn: vi.fn(),
  playGrindChainExtend: vi.fn(),
  playGrindMilestone: vi.fn(),
  playGrindCashOut: vi.fn(),
  playGrindBust: vi.fn(),
}));

vi.mock('./ui/grindBustOverlay', () => ({
  GrindBustOverlay: vi.fn().mockImplementation(function () {
    return { flash: vi.fn(), update: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock('./ui/grindComboHUD', () => ({
  GrindComboHUD: vi.fn().mockImplementation(function () {
    return { update: vi.fn(), dispose: vi.fn(), setGlowColor: vi.fn(), triggerCashOut: vi.fn() };
  }),
}));

vi.mock('./vfx/grindSparks', () => ({
  SparkEmitter: vi.fn().mockImplementation(function () {
    return { update: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock('./effects/tireStreaks', () => ({
  TireStreakSystem: vi.fn().mockImplementation(function () {
    return {
      spawnStreak: vi.fn(), tickFade: vi.fn(), fastFade: vi.fn(), clear: vi.fn(),
      instancedMesh: { geometry: { dispose: vi.fn() }, material: { dispose: vi.fn() }, removeFromParent: vi.fn() },
      activeCount: 0, freeCount: 512,
    };
  }),
  getDriftIntensity: vi.fn().mockReturnValue('low'),
}));

vi.mock('./ui/grindHUD', () => ({
  GrindHUD: vi.fn().mockImplementation(function () {
    return { update: vi.fn(), dispose: vi.fn(), show: vi.fn(), hide: vi.fn() };
  }),
}));

vi.mock('./hoverboardAnimator', () => ({
  HoverboardAnimator: vi.fn().mockImplementation(function () {
    return { update: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock('./playerVFX', () => ({
  _deathMat: { clone: vi.fn().mockReturnValue({ opacity: 0, dispose: vi.fn() }) },
  _killColor: {},
  buildBike: vi.fn().mockReturnValue({
    group: { add: vi.fn(), position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, children: [], layers: { enable: vi.fn(), set: vi.fn() }, traverse: vi.fn() },
    engineGlow: { material: { emissiveIntensity: 0 }, scale: { set: vi.fn() } },
    beam: null,
    flashLight: { intensity: 0 },
  }),
  buildCar: vi.fn().mockReturnValue({
    group: { add: vi.fn(), position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, children: [], layers: { enable: vi.fn(), set: vi.fn() }, traverse: vi.fn() },
    engineGlow: { material: { emissiveIntensity: 0 }, scale: { set: vi.fn() } },
    beam: null,
    flashLight: { intensity: 0 },
  }),
  buildHoverboard: vi.fn().mockReturnValue({
    group: { add: vi.fn(), position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, children: [], layers: { enable: vi.fn(), set: vi.fn() }, traverse: vi.fn() },
    engineGlow: { material: { emissiveIntensity: 0 }, scale: { set: vi.fn() } },
    beam: null,
    flashLight: { intensity: 0 },
  }),
  createGroundFX: vi.fn(),
  updateGroundFX: vi.fn(),
  createElectricArcs: vi.fn(),
  updateElectricArcs: vi.fn(),
  createSpeedLines: vi.fn(),
  updateSpeedLines: vi.fn(),
  createSnapSmoke: vi.fn(),
  triggerSnapSmoke: vi.fn(),
  updateSnapSmoke: vi.fn(),
}));

import { adminOverrides, assistTuning, Player } from './player';

// ── Tests ───────────────────────────────────────────────────

describe('player.ts exports', () => {
  describe('adminOverrides', () => {
    it('is a plain object', () => {
      expect(typeof adminOverrides).toBe('object');
      expect(adminOverrides).not.toBeNull();
    });

    it('has expected keys', () => {
      expect(adminOverrides).toHaveProperty('engineGlow');
      expect(adminOverrides).toHaveProperty('bikeLight');
      expect(adminOverrides).toHaveProperty('underGlow');
    });

    it('all values default to null', () => {
      for (const key of Object.keys(adminOverrides)) {
        expect(adminOverrides[key]).toBeNull();
      }
    });

    it('values can be set to numbers and back to null', () => {
      adminOverrides.engineGlow = 5;
      expect(adminOverrides.engineGlow).toBe(5);
      adminOverrides.engineGlow = null;
      expect(adminOverrides.engineGlow).toBeNull();
    });
  });

  describe('assistTuning', () => {
    it('is a plain object', () => {
      expect(typeof assistTuning).toBe('object');
      expect(assistTuning).not.toBeNull();
    });

    it('has expected keys with numeric values', () => {
      expect(typeof assistTuning.range).toBe('number');
      expect(typeof assistTuning.strength).toBe('number');
      expect(typeof assistTuning.angleMax).toBe('number');
    });

    it('range is positive', () => {
      expect(assistTuning.range).toBeGreaterThan(0);
    });

    it('strength is between 0 and 1', () => {
      expect(assistTuning.strength).toBeGreaterThan(0);
      expect(assistTuning.strength).toBeLessThanOrEqual(1);
    });

    it('angleMax is positive', () => {
      expect(assistTuning.angleMax).toBeGreaterThan(0);
    });
  });
});

describe('Player class', () => {
  it('exports the Player class', () => {
    expect(typeof Player).toBe('function');
  });

  it('can be instantiated with a mocked scene', () => {
    const scene = { add: vi.fn(), remove: vi.fn() } as unknown as InstanceType<typeof import('three').Scene>;
    const player = new Player(scene, {
      color: 0x00ffff,
      emissive: 0x00ffff,
      startX: 0,
      startZ: 0,
      startAngle: 0,
    });
    expect(player).toBeDefined();
    expect(player.alive).toBe(true);
    expect(player.vehicleType).toBe('bike');
  });

  it('initialises with correct vehicle type', () => {
    const scene = { add: vi.fn(), remove: vi.fn() } as unknown as InstanceType<typeof import('three').Scene>;
    const player = new Player(scene, {
      color: 0xff0000,
      emissive: 0xff0000,
      startX: 10,
      startZ: 20,
      startAngle: Math.PI,
      vehicleType: 'car',
    });
    expect(player.vehicleType).toBe('car');
  });

  it('initialises meter at max (100)', () => {
    const scene = { add: vi.fn(), remove: vi.fn() } as unknown as InstanceType<typeof import('three').Scene>;
    const player = new Player(scene, {
      color: 0x00ff00,
      emissive: 0x00ff00,
      startX: 0,
      startZ: 0,
      startAngle: 0,
    });
    expect(player.meter).toBe(100);
  });

  it('starts with boosting and dashing off', () => {
    const scene = { add: vi.fn(), remove: vi.fn() } as unknown as InstanceType<typeof import('three').Scene>;
    const player = new Player(scene, {
      color: 0x00ff00,
      emissive: 0x00ff00,
      startX: 0,
      startZ: 0,
      startAngle: 0,
    });
    expect(player.boosting).toBe(false);
    expect(player.dashing).toBe(false);
    expect(player.drifting).toBe(false);
  });

  it('starts at base speed for the vehicle type', () => {
    const scene = { add: vi.fn(), remove: vi.fn() } as unknown as InstanceType<typeof import('three').Scene>;
    const player = new Player(scene, {
      color: 0x00ff00,
      emissive: 0x00ff00,
      startX: 0,
      startZ: 0,
      startAngle: 0,
      vehicleType: 'hoverboard',
    });
    // Hoverboard baseSpeed is 45
    expect(player.speed).toBe(45);
  });

  it('isAI defaults to false', () => {
    const scene = { add: vi.fn(), remove: vi.fn() } as unknown as InstanceType<typeof import('three').Scene>;
    const player = new Player(scene, {
      color: 0x00ff00,
      emissive: 0x00ff00,
      startX: 0,
      startZ: 0,
      startAngle: 0,
    });
    expect(player.isAI).toBe(false);
  });

  it('isAI can be set to true', () => {
    const scene = { add: vi.fn(), remove: vi.fn() } as unknown as InstanceType<typeof import('three').Scene>;
    const player = new Player(scene, {
      color: 0x00ff00,
      emissive: 0x00ff00,
      startX: 0,
      startZ: 0,
      startAngle: 0,
      isAI: true,
    });
    expect(player.isAI).toBe(true);
  });
});
