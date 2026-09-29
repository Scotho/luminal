import { describe, it, expect } from 'vitest';
import {
  BIKE_PHYSICS,
  CAR_PHYSICS,
  HOVERBOARD_PHYSICS,
  getVehiclePhysics,
  LOADOUT_DISPLAY_NAMES,
  type VehiclePhysics,
} from './vehicleConfig';

describe('vehicleConfig', () => {
  const ALL_CONFIGS: ReadonlyArray<[string, VehiclePhysics]> = [
    ['bike', BIKE_PHYSICS],
    ['car', CAR_PHYSICS],
    ['hoverboard', HOVERBOARD_PHYSICS],
  ];

  describe('physics constants', () => {
    for (const [name, config] of ALL_CONFIGS) {
      it(`${name} has positive baseSpeed`, () => {
        expect(config.baseSpeed).toBeGreaterThan(0);
      });
      it(`${name} has positive boostSpeed`, () => {
        expect(config.boostSpeed).toBeGreaterThan(0);
      });
      it(`${name} has positive dashSpeed`, () => {
        expect(config.dashSpeed).toBeGreaterThan(0);
      });
      it(`${name} has positive brakeSpeed`, () => {
        expect(config.brakeSpeed).toBeGreaterThan(0);
      });
      it(`${name} has numeric turnSpeed`, () => {
        expect(typeof config.turnSpeed).toBe('number');
        expect(config.turnSpeed).toBeGreaterThan(0);
      });
      it(`${name} boostSpeed > baseSpeed`, () => {
        expect(config.boostSpeed).toBeGreaterThan(config.baseSpeed);
      });
      it(`${name} dashSpeed > boostSpeed`, () => {
        expect(config.dashSpeed).toBeGreaterThan(config.boostSpeed);
      });
      it(`${name} brakeSpeed < baseSpeed`, () => {
        expect(config.brakeSpeed).toBeLessThan(config.baseSpeed);
      });
      it(`${name} has non-negative dashDrain`, () => {
        expect(config.dashDrain).toBeGreaterThanOrEqual(0);
      });
      it(`${name} has non-negative passiveRegen`, () => {
        expect(config.passiveRegen).toBeGreaterThanOrEqual(0);
      });
      it(`${name} has fumesDuration between 0 and 5`, () => {
        expect(config.fumesDuration).toBeGreaterThanOrEqual(0);
        expect(config.fumesDuration).toBeLessThanOrEqual(5);
      });
      it(`${name} has fumesSpeedScale between 0 and 1`, () => {
        expect(config.fumesSpeedScale).toBeGreaterThanOrEqual(0);
        expect(config.fumesSpeedScale).toBeLessThanOrEqual(1);
      });
      it(`${name} has proximitySpeedMultiplier between 0 and 1`, () => {
        expect(config.proximitySpeedMultiplier).toBeGreaterThanOrEqual(0);
        expect(config.proximitySpeedMultiplier).toBeLessThanOrEqual(1);
      });
      it(`${name} has boostLockThreshold between 0 and 1`, () => {
        expect(config.boostLockThreshold).toBeGreaterThanOrEqual(0);
        expect(config.boostLockThreshold).toBeLessThanOrEqual(1);
      });
    }
  });

  describe('vehicle-specific traits', () => {
    it('only car can drift', () => {
      expect(CAR_PHYSICS.canDrift).toBe(true);
      expect(BIKE_PHYSICS.canDrift).toBe(false);
      expect(HOVERBOARD_PHYSICS.canDrift).toBe(false);
    });

    it('only hoverboard can grind', () => {
      expect(HOVERBOARD_PHYSICS.canGrind).toBe(true);
      expect(BIKE_PHYSICS.canGrind).toBe(false);
      expect(CAR_PHYSICS.canGrind).toBe(false);
    });

    it('car has highest dashSpeed', () => {
      expect(CAR_PHYSICS.dashSpeed).toBeGreaterThan(BIKE_PHYSICS.dashSpeed);
      expect(CAR_PHYSICS.dashSpeed).toBeGreaterThan(HOVERBOARD_PHYSICS.dashSpeed);
    });

    it('car has non-zero drift parameters', () => {
      expect(CAR_PHYSICS.driftMinSpeed).toBeGreaterThan(0);
      expect(CAR_PHYSICS.driftMeterRegen).toBeGreaterThan(0);
      expect(CAR_PHYSICS.driftSpeed).toBeGreaterThan(0);
      expect(CAR_PHYSICS.driftBoostSpeed).toBeGreaterThan(0);
      expect(CAR_PHYSICS.driftTurnMultiplier).toBeGreaterThan(1);
    });

    it('hoverboard has turnSpeedBleed (speed penalty on turns)', () => {
      expect(HOVERBOARD_PHYSICS.turnSpeedBleed).toBeLessThan(1);
    });

    it('bike and car have no turnSpeedBleed', () => {
      expect(BIKE_PHYSICS.turnSpeedBleed).toBe(1.0);
      expect(CAR_PHYSICS.turnSpeedBleed).toBe(1.0);
    });

    it('car has snap exit parameters', () => {
      expect(CAR_PHYSICS.snapExitSlipThreshold).toBeGreaterThan(0);
      expect(CAR_PHYSICS.snapRecoveryDuration).toBeGreaterThan(0);
    });
  });

  describe('getVehiclePhysics', () => {
    it('returns BIKE_PHYSICS for bike', () => {
      expect(getVehiclePhysics('bike')).toBe(BIKE_PHYSICS);
    });
    it('returns CAR_PHYSICS for car', () => {
      expect(getVehiclePhysics('car')).toBe(CAR_PHYSICS);
    });
    it('returns HOVERBOARD_PHYSICS for hoverboard', () => {
      expect(getVehiclePhysics('hoverboard')).toBe(HOVERBOARD_PHYSICS);
    });
  });

  describe('LOADOUT_DISPLAY_NAMES', () => {
    it('has a string name for each vehicle type', () => {
      expect(typeof LOADOUT_DISPLAY_NAMES.bike).toBe('string');
      expect(typeof LOADOUT_DISPLAY_NAMES.car).toBe('string');
      expect(typeof LOADOUT_DISPLAY_NAMES.hoverboard).toBe('string');
    });

    it('names are non-empty', () => {
      expect(LOADOUT_DISPLAY_NAMES.bike.length).toBeGreaterThan(0);
      expect(LOADOUT_DISPLAY_NAMES.car.length).toBeGreaterThan(0);
      expect(LOADOUT_DISPLAY_NAMES.hoverboard.length).toBeGreaterThan(0);
    });

    it('maps to expected display names', () => {
      expect(LOADOUT_DISPLAY_NAMES.bike).toBe('SPECTRE');
      expect(LOADOUT_DISPLAY_NAMES.car).toBe('SLINGSHOT');
      expect(LOADOUT_DISPLAY_NAMES.hoverboard).toBe('VECTOR');
    });
  });
});
