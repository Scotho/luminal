// ── Vehicle Selection System Tests ──────────────────────
// Comprehensive coverage of vehicle selection across both UIs:
// Character Select (home screen) and Lobby (multiplayer).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSelectedVehicle, getSelectedColorKey, _LOADOUT_STATS_FOR_TESTING, _resetForTesting } from '../characterSelectUI';
import { LOADOUTS, DISABLED_LOADOUTS } from '../lobby/lobbyContext';
import { BIKE_PHYSICS, CAR_PHYSICS, HOVERBOARD_PHYSICS, getVehiclePhysics, LOADOUT_DISPLAY_NAMES } from '../../vehicleConfig';
import type { VehicleType } from '../../types/index';

describe('Vehicle Selection System', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
  });

  // ── 1. Character Select — Disabled Vehicle Guard ──────
  describe('Character Select — Disabled Vehicle Guard', () => {
    it('returns "hoverboard" when "hoverboard" is saved (currently enabled)', () => {
      localStorage.setItem('luminal-vehicle', 'hoverboard');
      expect(getSelectedVehicle()).toBe('hoverboard');
    });

    it('returns "car" when "car" is saved (not disabled)', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      expect(getSelectedVehicle()).toBe('car');
    });

    it('returns "bike" for garbage values', () => {
      localStorage.setItem('luminal-vehicle', 'spaceship');
      expect(getSelectedVehicle()).toBe('bike');
    });

    it('returns "bike" when nothing is saved', () => {
      expect(getSelectedVehicle()).toBe('bike');
    });
  });

  // ── 2. Character Select — DOM Structure ──
  describe('Character Select — DOM Structure', () => {
    it('detail panel has #cs-coming-soon element hidden by default', () => {
      const el = document.getElementById('cs-coming-soon');
      expect(el).toBeTruthy();
      expect(el!.style.display).toBe('none');
    });

    it('bike card does NOT have cs-card--disabled class', () => {
      const card = document.getElementById('cs-card-bike')!;
      expect(card.classList.contains('cs-card--disabled')).toBe(false);
    });

    it('car card does NOT have cs-card--disabled class', () => {
      const card = document.getElementById('cs-card-car')!;
      expect(card.classList.contains('cs-card--disabled')).toBe(false);
    });

    it('all 3 vehicle cards exist in the carousel', () => {
      const bike = document.getElementById('cs-card-bike');
      const car = document.getElementById('cs-card-car');
      const hoverboard = document.getElementById('cs-card-hoverboard');
      expect(bike).toBeTruthy();
      expect(car).toBeTruthy();
      expect(hoverboard).toBeTruthy();
    });
  });

  // ── 3. Lobby — LOADOUTS and DISABLED_LOADOUTS ─────────
  describe('Lobby — LOADOUTS and DISABLED_LOADOUTS', () => {
    it('LOADOUTS contains exactly bike, car, hoverboard', () => {
      expect(LOADOUTS).toEqual(['bike', 'car', 'hoverboard']);
    });

    it('DISABLED_LOADOUTS does NOT contain hoverboard (now enabled)', () => {
      expect(DISABLED_LOADOUTS.has('hoverboard')).toBe(false);
    });

    it('DISABLED_LOADOUTS does NOT contain bike', () => {
      expect(DISABLED_LOADOUTS.has('bike')).toBe(false);
    });

    it('DISABLED_LOADOUTS does NOT contain car', () => {
      expect(DISABLED_LOADOUTS.has('car')).toBe(false);
    });
  });

  // ── 4. Lobby — DOM Structure ──────────────────────────
  describe('Lobby — DOM Structure', () => {
    it('has vehicle tile for bike', () => {
      expect(document.getElementById('lobby-vtile-bike')).toBeTruthy();
    });

    it('has vehicle tile for car', () => {
      expect(document.getElementById('lobby-vtile-car')).toBeTruthy();
    });

    it('has vehicle tile for hoverboard', () => {
      expect(document.getElementById('lobby-vtile-hoverboard')).toBeTruthy();
    });

    it('has exactly one --locked placeholder tile for future vehicle', () => {
      const locked = document.querySelectorAll('.lobby-vehicle-tile--locked');
      expect(locked.length).toBe(1);
    });
  });

  // ── 5. Vehicle Physics Config ─────────────────────────
  describe('Vehicle Physics Config', () => {
    it('getVehiclePhysics("bike") returns BIKE_PHYSICS', () => {
      expect(getVehiclePhysics('bike')).toBe(BIKE_PHYSICS);
    });

    it('getVehiclePhysics("car") returns CAR_PHYSICS', () => {
      expect(getVehiclePhysics('car')).toBe(CAR_PHYSICS);
    });

    it('getVehiclePhysics("hoverboard") returns HOVERBOARD_PHYSICS', () => {
      expect(getVehiclePhysics('hoverboard')).toBe(HOVERBOARD_PHYSICS);
    });

    it('HOVERBOARD_PHYSICS is NOT the same object as BIKE_PHYSICS', () => {
      expect(HOVERBOARD_PHYSICS).not.toBe(BIKE_PHYSICS);
    });

    it('hoverboard has distinct turnLerp (8), turnDecay (12), turnSpeedBleed (0.97)', () => {
      expect(HOVERBOARD_PHYSICS.turnLerp).toBe(8);
      expect(HOVERBOARD_PHYSICS.turnDecay).toBe(12);
      expect(HOVERBOARD_PHYSICS.turnSpeedBleed).toBe(0.97);
    });

    it('hoverboard canGrind is true', () => {
      expect(HOVERBOARD_PHYSICS.canGrind).toBe(true);
    });

    it('bike canGrind is false', () => {
      expect(BIKE_PHYSICS.canGrind).toBe(false);
    });

    it('car canGrind is false', () => {
      expect(CAR_PHYSICS.canGrind).toBe(false);
    });

    it('all three vehicle types have display names', () => {
      expect(LOADOUT_DISPLAY_NAMES.bike).toBeDefined();
      expect(LOADOUT_DISPLAY_NAMES.car).toBeDefined();
      expect(LOADOUT_DISPLAY_NAMES.hoverboard).toBeDefined();
    });
  });

  // ── 6. Vehicle Selection Persistence — Cross-UI Consistency ──
  describe('Vehicle Selection Persistence — Cross-UI Consistency', () => {
    it('returns "bike" when luminal-vehicle is set to "bike"', () => {
      localStorage.setItem('luminal-vehicle', 'bike');
      expect(getSelectedVehicle()).toBe('bike');
    });

    it('returns "car" when luminal-vehicle is set to "car"', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      expect(getSelectedVehicle()).toBe('car');
    });

    it('returns "hoverboard" when luminal-vehicle is set to "hoverboard"', () => {
      localStorage.setItem('luminal-vehicle', 'hoverboard');
      expect(getSelectedVehicle()).toBe('hoverboard');
    });

    it('reading does not create side effects in localStorage', () => {
      const keysBefore = Object.keys(localStorage);
      getSelectedVehicle();
      const keysAfter = Object.keys(localStorage);
      expect(keysAfter).toEqual(keysBefore);
    });
  });

  // ── 7. Disabled Vehicle — No Selection Leakage ────────
  describe('Disabled Vehicle — No Selection Leakage', () => {
    it('returns "hoverboard" when hoverboard is selected (currently enabled)', () => {
      localStorage.setItem('luminal-vehicle', 'hoverboard');
      const result = getSelectedVehicle();
      expect(result).toBe('hoverboard');
    });

    it('does not mutate localStorage — "hoverboard" still stored after fallback', () => {
      localStorage.setItem('luminal-vehicle', 'hoverboard');
      getSelectedVehicle();
      expect(localStorage.getItem('luminal-vehicle')).toBe('hoverboard');
    });
  });

  // ── 8. Display Data Completeness ──────────────────────
  describe('Display Data Completeness', () => {
    const vehicles: VehicleType[] = ['bike', 'car', 'hoverboard'];

    for (const v of vehicles) {
      it(`${v} has name, flavor, 5 stats, and special ability`, () => {
        const data = _LOADOUT_STATS_FOR_TESTING[v];
        expect(data).toBeDefined();
        expect(typeof data.name).toBe('string');
        expect(data.name.length).toBeGreaterThan(0);
        expect(typeof data.flavor).toBe('string');
        expect(data.flavor.length).toBeGreaterThan(0);
        expect(data.stats).toHaveLength(5);
        for (const s of data.stats) {
          expect(typeof s.label).toBe('string');
          expect(typeof s.value).toBe('number');
        }
        expect(typeof data.special.name).toBe('string');
        expect(typeof data.special.desc).toBe('string');
      });
    }

    it('hoverboard special is named "VECTOR LOCK"', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.hoverboard.special.name).toBe('VECTOR LOCK');
    });

    it('each vehicle has distinct stat profiles', () => {
      const bikeVals = _LOADOUT_STATS_FOR_TESTING.bike.stats.map(s => s.value);
      const carVals = _LOADOUT_STATS_FOR_TESTING.car.stats.map(s => s.value);
      const hoverVals = _LOADOUT_STATS_FOR_TESTING.hoverboard.stats.map(s => s.value);
      // No two vehicles should have identical stat arrays
      expect(bikeVals).not.toEqual(carVals);
      expect(bikeVals).not.toEqual(hoverVals);
      expect(carVals).not.toEqual(hoverVals);
    });
  });
});
