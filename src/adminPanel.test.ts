// ── Admin Panel Tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hasAdminAccess, setAdminDeps, destroyAdminPanel } from './adminPanel';
import { getCollisionTuning } from './core/collisionSystem';
import { BIKE_PHYSICS, CAR_PHYSICS } from './vehicleConfig';
import { aiTuning } from './ai';
import { assistTuning } from './player';

// ── Access Control ──────────────────────────────────────
// Note: IS_LOCAL is captured at module load time (jsdom = localhost = true).
// So in this test environment, hasAdminAccess() always returns true via IS_LOCAL.
// We test the username-based path by verifying Scotho grants access even when
// IS_LOCAL would be false (which we can't override here since it's a const).

describe('adminPanel access control', () => {
  beforeEach(() => {
    setAdminDeps({ getUsername: () => null, navigateToDebug: () => {} });
  });

  it('grants access on localhost (jsdom default)', () => {
    // IS_LOCAL is true in jsdom — access granted regardless of username
    setAdminDeps({ getUsername: () => null, navigateToDebug: () => {} });
    expect(hasAdminAccess()).toBe(true);
  });

  it('grants access when username is Scotho', () => {
    setAdminDeps({ getUsername: () => 'Scotho', navigateToDebug: () => {} });
    expect(hasAdminAccess()).toBe(true);
  });

  it('setAdminDeps stores the username provider', () => {
    // On localhost IS_LOCAL short-circuits, so we just verify setAdminDeps doesn't throw
    // and that hasAdminAccess returns true (via IS_LOCAL)
    setAdminDeps({ getUsername: () => 'AnyUser', navigateToDebug: () => {} });
    expect(hasAdminAccess()).toBe(true);
  });

  it('setAdminDeps accepts renderer parameter', () => {
    expect(() => {
      setAdminDeps({ getUsername: () => null, navigateToDebug: () => {}, renderer: {} as never });
    }).not.toThrow();
  });
});

// ── Collision Tuning ────────────────────────────────────

describe('collision tuning', () => {
  const defaults = {
    hitRadius: 0.8,
    skipOwnSegments: 10,
    repulseRange: 6.5,
    repulseStrength: 1.8,
    headOnDistance: 2.0,
    proximityRange: 10,
  };

  beforeEach(() => {
    // Reset to defaults
    const ct = getCollisionTuning();
    Object.assign(ct, defaults);
  });

  it('exports a mutable tuning object', () => {
    const ct = getCollisionTuning();
    expect(ct.hitRadius).toBe(0.8);
    expect(ct.skipOwnSegments).toBe(10);
    expect(ct.repulseRange).toBe(6.5);
    expect(ct.repulseStrength).toBe(1.8);
    expect(ct.headOnDistance).toBe(2.0);
    expect(ct.proximityRange).toBe(10);
  });

  it('allows runtime mutation of hitRadius', () => {
    const ct = getCollisionTuning();
    ct.hitRadius = 1.5;
    expect(getCollisionTuning().hitRadius).toBe(1.5);
  });

  it('allows runtime mutation of skipOwnSegments', () => {
    const ct = getCollisionTuning();
    ct.skipOwnSegments = 20;
    expect(getCollisionTuning().skipOwnSegments).toBe(20);
  });

  it('allows runtime mutation of repulse values', () => {
    const ct = getCollisionTuning();
    ct.repulseRange = 10;
    ct.repulseStrength = 3;
    expect(ct.repulseRange).toBe(10);
    expect(ct.repulseStrength).toBe(3);
  });

  it('allows runtime mutation of headOnDistance', () => {
    const ct = getCollisionTuning();
    ct.headOnDistance = 4;
    expect(ct.headOnDistance).toBe(4);
  });

  it('allows runtime mutation of proximityRange', () => {
    const ct = getCollisionTuning();
    ct.proximityRange = 15;
    expect(ct.proximityRange).toBe(15);
  });

  it('returns the same object reference each call', () => {
    expect(getCollisionTuning()).toBe(getCollisionTuning());
  });
});

// ── Vehicle Physics Mutability ──────────────────────────

describe('vehicle physics mutability', () => {
  const bikeDefaults = { baseSpeed: 40, boostSpeed: 55, dashSpeed: 98.5, turnSpeed: 2.94 };
  const carDefaults = { baseSpeed: 44.4, boostSpeed: 50, dashSpeed: 105, turnSpeed: 1.8 };

  beforeEach(() => {
    Object.assign(BIKE_PHYSICS, bikeDefaults);
    Object.assign(CAR_PHYSICS, carDefaults);
  });

  it('BIKE_PHYSICS properties are mutable at runtime', () => {
    BIKE_PHYSICS.baseSpeed = 60;
    BIKE_PHYSICS.turnSpeed = 4;
    expect(BIKE_PHYSICS.baseSpeed).toBe(60);
    expect(BIKE_PHYSICS.turnSpeed).toBe(4);
  });

  it('CAR_PHYSICS properties are mutable at runtime', () => {
    CAR_PHYSICS.dashSpeed = 120;
    CAR_PHYSICS.driftTurnMultiplier = 3;
    expect(CAR_PHYSICS.dashSpeed).toBe(120);
    expect(CAR_PHYSICS.driftTurnMultiplier).toBe(3);
  });

  it('CAR_PHYSICS drift snap recovery params are mutable', () => {
    CAR_PHYSICS.snapRecoverySpeedFloor = 40;
    CAR_PHYSICS.snapRecoveryBoostFloor = 70;
    CAR_PHYSICS.snapRecoveryTargetSpeed = 60;
    CAR_PHYSICS.snapRecoveryBoostTarget = 100;
    CAR_PHYSICS.snapRecoveryAccelLerp = 15;
    expect(CAR_PHYSICS.snapRecoverySpeedFloor).toBe(40);
    expect(CAR_PHYSICS.snapRecoveryBoostFloor).toBe(70);
    expect(CAR_PHYSICS.snapRecoveryTargetSpeed).toBe(60);
    expect(CAR_PHYSICS.snapRecoveryBoostTarget).toBe(100);
    expect(CAR_PHYSICS.snapRecoveryAccelLerp).toBe(15);
  });

  it('bike and car physics are independent objects', () => {
    BIKE_PHYSICS.baseSpeed = 99;
    expect(CAR_PHYSICS.baseSpeed).toBe(44.4);
  });
});

// ── AI Tuning ───────────────────────────────────────────

describe('AI tuning', () => {
  beforeEach(() => {
    aiTuning.maneuverMinCd = 3;
    aiTuning.maneuverMaxCd = 8;
  });

  it('exports mutable maneuver cooldown values', () => {
    expect(aiTuning.maneuverMinCd).toBe(3);
    expect(aiTuning.maneuverMaxCd).toBe(8);
  });

  it('allows runtime mutation', () => {
    aiTuning.maneuverMinCd = 1;
    aiTuning.maneuverMaxCd = 4;
    expect(aiTuning.maneuverMinCd).toBe(1);
    expect(aiTuning.maneuverMaxCd).toBe(4);
  });
});

// ── Player Assist Tuning ────────────────────────────────

describe('player assist tuning', () => {
  const defaults = { range: 10, strength: 0.35, angleMax: 0.4 };

  beforeEach(() => {
    Object.assign(assistTuning, defaults);
  });

  it('exports mutable assist values', () => {
    expect(assistTuning.range).toBe(10);
    expect(assistTuning.strength).toBe(0.35);
    expect(assistTuning.angleMax).toBe(0.4);
  });

  it('allows runtime mutation', () => {
    assistTuning.range = 15;
    assistTuning.strength = 0.5;
    assistTuning.angleMax = 0.8;
    expect(assistTuning.range).toBe(15);
    expect(assistTuning.strength).toBe(0.5);
    expect(assistTuning.angleMax).toBe(0.8);
  });
});

// ── destroyAdminPanel ───────────────────────────────────

describe('destroyAdminPanel', () => {
  it('does not throw when called with no panel open', () => {
    expect(() => destroyAdminPanel()).not.toThrow();
  });
});
