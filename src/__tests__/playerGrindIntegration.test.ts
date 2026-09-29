// ── Player grind single-player integration tests (SPEC-80) ──
// Drives Player.update() through the hoverboard branch with a real
// advancePlayer + a hand-built SimContext and asserts grind lifecycle.
//
// Unlike player.test.ts (which mocks out core/simulation), this suite
// uses the REAL simulation functions so the full grind pipeline runs.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TrailPoint, PlayerSim, SimState } from '../core/simulation';
import { createPlayerSim, GRIND_SNAP_RANGE } from '../core/simulation';
import { buildLocalSimContext } from '../core/simContext';

// ── Mock three.js with minimal stubs (Player constructor uses new Group etc.) ──
vi.mock('three', () => {
  const fn = vi.fn;
  const vec3 = (): { x: number; y: number; z: number; set: typeof fn; copy: typeof fn; addScaledVector: typeof fn; normalize: typeof fn; multiplyScalar: typeof fn; setScalar: typeof fn } => ({
    x: 0, y: 0, z: 0,
    set: fn(), copy: fn(), addScaledVector: fn(),
    normalize: fn(), multiplyScalar: fn(), setScalar: fn(),
  });
  return {
    Color: fn().mockImplementation(function () {
      return {
        r: 0.5, g: 0.5, b: 0.5,
        setScalar: fn(),
        getHexString: fn().mockReturnValue('ff0000'),
        clone: fn(),
        setHex: fn(),
        setRGB: fn(),
        // computeDarkBoost in emissiveUtils calls getHSL(target).l — return a mid-luminance value
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
        layers: { enable: fn(), set: fn() }, material: { emissiveIntensity: 0 },
      };
    }),
    MeshStandardMaterial: fn().mockImplementation(function () { return { dispose: fn(), emissiveIntensity: 0 }; }),
    MeshBasicMaterial: fn().mockImplementation(function () { return { dispose: fn() }; }),
    PointLight: fn().mockImplementation(function () {
      return { position: vec3(), layers: { enable: fn(), set: fn() }, color: { setHex: fn(), setRGB: fn() }, intensity: 0, distance: 0 };
    }),
    SpotLight: fn().mockImplementation(function () {
      return { position: vec3(), target: { position: vec3() }, layers: { enable: fn(), set: fn() }, color: { setHex: fn() } };
    }),
    Points: fn().mockImplementation(function () {
      return { position: vec3(), geometry: { attributes: { position: { array: new Float32Array(0) } }, dispose: fn() }, visible: false, frustumCulled: true };
    }),
    PointsMaterial: fn().mockImplementation(function () { return { dispose: fn(), color: { setHex: fn() }, opacity: 0, clone: fn() }; }),
    BufferGeometry: fn().mockImplementation(function () {
      return { setAttribute: fn(), attributes: { position: { array: new Float32Array(0) } }, dispose: fn() };
    }),
    BufferAttribute: fn().mockImplementation(function () { return {}; }),
    Float32BufferAttribute: fn().mockImplementation(function () { return {}; }),
    Vector3: fn().mockImplementation(function () { return vec3(); }),
    Box3: fn().mockImplementation(function () { return { setFromObject: fn().mockReturnThis(), getSize: fn() }; }),
    Scene: fn().mockImplementation(function () { return { add: fn(), remove: fn() }; }),
    Object3D: fn().mockImplementation(function () { return { position: vec3(), rotation: { x: 0, y: 0, z: 0 } }; }),
    CylinderGeometry: fn().mockImplementation(function () { return { dispose: fn() }; }),
    SphereGeometry: fn().mockImplementation(function () { return { dispose: fn() }; }),
    BoxGeometry: fn().mockImplementation(function () { return { dispose: fn() }; }),
    MathUtils: { clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)), lerp: (a: number, b: number, t: number) => a + (b - a) * t },
    AdditiveBlending: 2,
  };
});

vi.mock('../trail', () => ({
  Trail: vi.fn().mockImplementation(function () {
    return {
      points: [] as TrailPoint[],
      addPoint: vi.fn(),
      updateHead: vi.fn(),
      updateSpeed: vi.fn(),
      mesh: { visible: false },
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('../utils', () => ({
  pointToSegmentDist: vi.fn().mockReturnValue(999),
}));

vi.mock('../graphics', () => ({
  getGfx: vi.fn().mockReturnValue({ preset: 'high', playerVFX: 'off' }),
  bloomMul: { vehicles: 1, trails: 1, environment: 1, lights: 1 },
  VISUAL_TUNING: { high: { neonEmissive: 1.5, bikeLightInt: 1, underGlowInt: 1 } },
}));

vi.mock('../spatialGrid', () => ({
  grid: {
    insert: vi.fn(),
    remove: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    nearestDist: vi.fn().mockReturnValue(Infinity),
  },
}));

vi.mock('../vfx/grindSparks', () => ({
  SparkEmitter: vi.fn().mockImplementation(function () {
    return { update: vi.fn(), dispose: vi.fn(), emit: vi.fn() };
  }),
}));

vi.mock('../effects/tireStreaks', () => ({
  TireStreakSystem: vi.fn().mockImplementation(function () {
    return {
      spawnStreak: vi.fn(), tickFade: vi.fn(), fastFade: vi.fn(), clear: vi.fn(),
      instancedMesh: { geometry: { dispose: vi.fn() }, material: { dispose: vi.fn() }, removeFromParent: vi.fn() },
    };
  }),
  getDriftIntensity: vi.fn().mockReturnValue('low'),
}));

vi.mock('../ui/grindHUD', () => ({
  GrindHUD: vi.fn().mockImplementation(function () {
    return { update: vi.fn(), dispose: vi.fn(), show: vi.fn(), hide: vi.fn(), setTrailDifficulty: vi.fn() };
  }),
}));

vi.mock('../ui/grindComboHUD', () => ({
  GrindComboHUD: vi.fn().mockImplementation(function () {
    return { update: vi.fn(), dispose: vi.fn(), setGlowColor: vi.fn(), triggerCashOut: vi.fn() };
  }),
}));

vi.mock('../ui/grindBustOverlay', () => ({
  GrindBustOverlay: vi.fn().mockImplementation(function () {
    return { flash: vi.fn(), update: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock('../sfx', () => ({
  playGrindSweetLockIn: vi.fn(),
  playGrindChainExtend: vi.fn(),
  playGrindMilestone: vi.fn(),
  playGrindCashOut: vi.fn(),
  playGrindBust: vi.fn(),
}));

vi.mock('../hoverboardAnimator', () => ({
  HoverboardAnimator: vi.fn().mockImplementation(function () {
    return { update: vi.fn(), dispose: vi.fn(), attachProxies: vi.fn() };
  }),
}));

vi.mock('../bikeAnimator', () => ({
  BikeAnimator: vi.fn().mockImplementation(function () {
    return { update: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock('../carAnimator', () => ({
  CarAnimator: vi.fn().mockImplementation(function () {
    return { update: vi.fn(), dispose: vi.fn() };
  }),
}));

vi.mock('../playerVFX', () => {
  const build = (): Record<string, unknown> => ({
    glow: { material: { emissiveIntensity: 0 }, scale: { set: vi.fn() } },
    bikeLight: null,
    underGlow: null,
    proximityAura: null,
    beam: null,
    vehicleClone: null,
  });
  return {
    _deathMat: { clone: vi.fn().mockReturnValue({ opacity: 0, dispose: vi.fn() }) },
    _killColor: {},
    buildBike: vi.fn().mockImplementation(build),
    buildCar: vi.fn().mockImplementation(build),
    buildHoverboard: vi.fn().mockImplementation(build),
    createGroundFX: vi.fn(),
    updateGroundFX: vi.fn(),
    createElectricArcs: vi.fn(),
    updateElectricArcs: vi.fn(),
    createSpeedLines: vi.fn(),
    updateSpeedLines: vi.fn(),
    createSnapSmoke: vi.fn(),
    triggerSnapSmoke: vi.fn(),
    updateSnapSmoke: vi.fn(),
  };
});

import { Player } from '../player';

// ── Helpers ────────────────────────────────────────────

function makeHoverboardPlayer(startX = 0, startZ = 0, startAngle = 0): Player {
  const scene = { add: vi.fn(), remove: vi.fn() } as unknown as InstanceType<typeof import('three').Scene>;
  return new Player(scene, {
    color: 0x00ffff,
    emissive: 0x00ffff,
    startX,
    startZ,
    startAngle,
    vehicleType: 'hoverboard',
  });
}

function straightTrail(startX: number, endX: number, z: number, n: number): TrailPoint[] {
  const pts: TrailPoint[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({ x: startX + (endX - startX) * (i / (n - 1)), z });
  }
  return pts;
}

function makeContextWithEnemyTrail(player: Player, trail: TrailPoint[]): { context: SimState; enemy: PlayerSim; trails: TrailPoint[][] } {
  const enemy = createPlayerSim(200, 200, 0, 45, 'hoverboard');
  const trails: TrailPoint[][] = [player.trail.points, trail];
  const context = buildLocalSimContext(100, [player.sim, enemy], trails);
  return { context, enemy, trails };
}

// ── Tests ──────────────────────────────────────────────

describe('Player hoverboard grind — single-player integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1: grind engages when pressing special near an enemy trail', () => {
    const player = makeHoverboardPlayer(0, 0, 0);
    const enemyTrail = straightTrail(-50, 50, 0, 100);
    const { context } = makeContextWithEnemyTrail(player, enemyTrail);
    player.meter = 100;

    // Seed _sim position to match (constructor position is 0,0,0)
    expect(player.isGrinding).toBe(false);
    player.update(1 / 60, 0, false, false, false, false, /* special */ true, context, 0);
    expect(player.isGrinding).toBe(true);
  });

  it('T2: grind does NOT engage without a nearby trail', () => {
    const player = makeHoverboardPlayer(0, 0, 0);
    // Put trail 100 units away from player on Z axis — far outside GRIND_SNAP_RANGE
    const enemyTrail = straightTrail(-50, 50, 100, 100);
    const { context } = makeContextWithEnemyTrail(player, enemyTrail);
    player.meter = 100;

    player.update(1 / 60, 0, false, false, false, false, true, context, 0);
    expect(player.isGrinding).toBe(false);
  });

  it('T3: grind does NOT engage with a nearby trail but special=false', () => {
    const player = makeHoverboardPlayer(0, 0, 0);
    const enemyTrail = straightTrail(-50, 50, 0, 100);
    const { context } = makeContextWithEnemyTrail(player, enemyTrail);
    player.meter = 100;

    player.update(1 / 60, 0, false, false, false, false, /* special */ false, context, 0);
    expect(player.isGrinding).toBe(false);
  });

  it('T4: grindBalance drifts (RNG changes) across successive frames while grinding', () => {
    const player = makeHoverboardPlayer(0, 0, 0);
    const enemyTrail = straightTrail(-50, 50, 0, 100);
    const { context } = makeContextWithEnemyTrail(player, enemyTrail);
    player.meter = 100;

    player.update(1 / 60, 0, false, false, false, false, true, context, 0);
    expect(player.isGrinding).toBe(true);
    const balances: number[] = [player.grindBalanceValue];
    // Run long enough to clear the grace window so destabilization physics engage.
    for (let i = 0; i < 40; i++) {
      player.update(1 / 60, 0, false, false, false, false, true, context, 0);
      balances.push(player.grindBalanceValue);
    }
    // At least one balance should differ from initial (RNG drift or physics)
    const anyChange = balances.some((b, i) => i > 0 && b !== balances[0]);
    expect(anyChange).toBe(true);
  });

  it('T5: releasing special during a grind causes transition to airborne', () => {
    const player = makeHoverboardPlayer(0, 0, 0);
    const enemyTrail = straightTrail(-50, 50, 0, 100);
    const { context } = makeContextWithEnemyTrail(player, enemyTrail);
    player.meter = 100;

    // Engage
    player.update(1 / 60, 0, false, false, false, false, true, context, 0);
    expect(player.isGrinding).toBe(true);
    // Release special → clean exit to airborne
    player.update(1 / 60, 0, false, false, false, false, /* special */ false, context, 0);
    expect(player.isGrinding).toBe(false);
    expect(player.isAirborne).toBe(true);
  });

  it('T6: passing no simContext keeps non-grind physics working (bike compat)', () => {
    const scene = { add: vi.fn(), remove: vi.fn() } as unknown as InstanceType<typeof import('three').Scene>;
    const bike = new Player(scene, {
      color: 0x00ff00,
      emissive: 0x00ff00,
      startX: 0,
      startZ: 0,
      startAngle: 0,
      vehicleType: 'bike',
    });
    // No simContext — bikes don't use grind and must continue working
    expect(() => bike.update(1 / 60, 0, true, false, false, false, false)).not.toThrow();
    expect(bike.alive).toBe(true);
  });

  it('T7: player meter decreases by GRIND_ENTRY_COST on successful grind entry', () => {
    const player = makeHoverboardPlayer(0, 0, 0);
    const enemyTrail = straightTrail(-50, 50, 0, 100);
    const { context } = makeContextWithEnemyTrail(player, enemyTrail);
    player.meter = 100;

    player.update(1 / 60, 0, false, false, false, false, true, context, 0);
    expect(player.isGrinding).toBe(true);
    // Entry cost is 50 (GRIND_ENTRY_COST); accounting for regen during the same tick
    expect(player.meter).toBeLessThan(60);
    expect(player.meter).toBeGreaterThan(40);
  });

  it('T8: grind never enters with snap range exceeded', () => {
    const player = makeHoverboardPlayer(0, 0, 0);
    // Trail on Z axis just outside GRIND_SNAP_RANGE
    const enemyTrail = straightTrail(-50, 50, GRIND_SNAP_RANGE + 0.5, 100);
    const { context } = makeContextWithEnemyTrail(player, enemyTrail);
    player.meter = 100;

    player.update(1 / 60, 0, false, false, false, false, true, context, 0);
    expect(player.isGrinding).toBe(false);
  });
});

describe('AI hoverboard grind — single-player integration (TASK-225)', () => {
  it('T9: AI hoverboard engages grind when special input is routed', () => {
    const ai = makeHoverboardPlayer(0, 0, 0);
    // Human (index 0) trail runs through AI position
    const humanTrail = straightTrail(-50, 50, 0, 100);
    // AI is index 1 in the context — its sim gets simContext, playerIndex=1
    const humanSim = createPlayerSim(-100, -100, 0, 45, 'hoverboard');
    const trails: TrailPoint[][] = [humanTrail, ai.trail.points];
    const context = buildLocalSimContext(100, [humanSim, ai.sim], trails);
    ai.meter = 100;

    ai.update(1 / 60, 0, false, false, false, /* driftBrake */ false, /* special */ true, context, 1);
    expect(ai.isGrinding).toBe(true);
  });

  it('T10: AI with undefined special passes cleanly without crash', () => {
    const ai = makeHoverboardPlayer(0, 0, 0);
    const humanTrail = straightTrail(-50, 50, 0, 100);
    const humanSim = createPlayerSim(-100, -100, 0, 45, 'hoverboard');
    const trails: TrailPoint[][] = [humanTrail, ai.trail.points];
    const context = buildLocalSimContext(100, [humanSim, ai.sim], trails);
    ai.meter = 100;

    // Mimic game.ts AI path: input.special ?? false
    const specialVal = (undefined as boolean | undefined) ?? false;
    expect(() =>
      ai.update(1 / 60, 0, true, false, false, false, specialVal, context, 1),
    ).not.toThrow();
    expect(ai.isGrinding).toBe(false);
  });
});
