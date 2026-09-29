// ── Character Select Screen Tests ───────────────────────
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PLAYER_COLORS, DEFAULT_PLAYER_COLOR_KEY } from '../../playerColors';

// Mock the showroom audio module so vehicle-card clicks in tests don't try to
// instantiate a real AudioContext (jsdom's AudioContext is a mocked function,
// not a constructor, so `new AudioContext()` throws).
vi.mock('../characterSelectAudio', () => ({
  startShowroomEngine: vi.fn(),
  stopShowroomEngineHard: vi.fn(),
}));

// jsdom doesn't implement Element.prototype.scrollTo; stub it so the carousel
// scroll in _selectVehicle doesn't throw an uncaught exception from rAF.
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollTo) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLElement.prototype as any).scrollTo = function () { /* no-op for jsdom */ };
}

import { getSelectedVehicle, getSelectedColorKey, initCharacterSelect, _resetForTesting, _LOADOUT_STATS_FOR_TESTING } from '../characterSelectUI';
import { _setStateForTesting, _resetManagerForTesting } from '../../progression/progressionManager';

describe('Character Select', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── DOM Structure ──────────────────────────────────────
  describe('DOM structure', () => {
    it('#character-select-overlay exists', () => {
      expect(document.getElementById('character-select-overlay')).toBeTruthy();
    });

    it('has overlay-screen class', () => {
      const el = document.getElementById('character-select-overlay')!;
      expect(el.classList.contains('overlay-screen')).toBe(true);
    });

    it('has hidden class by default', () => {
      const el = document.getElementById('character-select-overlay')!;
      expect(el.classList.contains('hidden')).toBe(true);
    });

    it('has vehicle card for bike', () => {
      expect(document.getElementById('cs-card-bike')).toBeTruthy();
    });

    it('has vehicle card for car', () => {
      expect(document.getElementById('cs-card-car')).toBeTruthy();
    });

    it('bike card has data-vehicle attribute', () => {
      const card = document.getElementById('cs-card-bike')!;
      expect(card.dataset.vehicle).toBe('bike');
    });

    it('car card has data-vehicle attribute', () => {
      const card = document.getElementById('cs-card-car')!;
      expect(card.dataset.vehicle).toBe('car');
    });

    it('has vehicle name element', () => {
      expect(document.getElementById('cs-vehicle-name')).toBeTruthy();
    });

    it('has flavor text element', () => {
      expect(document.getElementById('cs-flavor')).toBeTruthy();
    });

    it('has stats container', () => {
      expect(document.getElementById('cs-stats')).toBeTruthy();
    });

    it('has special ability elements', () => {
      expect(document.getElementById('cs-special-name')).toBeTruthy();
      expect(document.getElementById('cs-special-desc')).toBeTruthy();
    });

    it('has color options container', () => {
      expect(document.getElementById('cs-color-options')).toBeTruthy();
    });

    it('has save confirmation element', () => {
      expect(document.getElementById('cs-saved')).toBeTruthy();
    });

    it('has canvas wrap elements for previews', () => {
      expect(document.getElementById('cs-canvas-wrap-bike')).toBeTruthy();
      expect(document.getElementById('cs-canvas-wrap-car')).toBeTruthy();
    });

    it('has vehicle card for hoverboard', () => {
      expect(document.getElementById('cs-card-hoverboard')).toBeTruthy();
    });

    it('hoverboard card has data-vehicle attribute', () => {
      const card = document.getElementById('cs-card-hoverboard')!;
      expect(card.dataset.vehicle).toBe('hoverboard');
    });

    it('has canvas wrap for hoverboard preview', () => {
      expect(document.getElementById('cs-canvas-wrap-hoverboard')).toBeTruthy();
    });

    it('has carousel container', () => {
      expect(document.getElementById('cs-carousel')).toBeTruthy();
    });
  });

  // ── Persistence ────────────────────────────────────────
  describe('persistence', () => {
    it('getSelectedVehicle defaults to bike when nothing saved', () => {
      expect(getSelectedVehicle()).toBe('bike');
    });

    it('getSelectedColorKey defaults to red when nothing saved', () => {
      expect(getSelectedColorKey()).toBe(DEFAULT_PLAYER_COLOR_KEY);
    });

    it('getSelectedVehicle returns saved vehicle', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      expect(getSelectedVehicle()).toBe('car');
    });

    it('getSelectedColorKey returns saved color', () => {
      localStorage.setItem('luminal-color', 'cyan');
      expect(getSelectedColorKey()).toBe('cyan');
    });

    it('getSelectedVehicle returns bike for invalid saved value', () => {
      localStorage.setItem('luminal-vehicle', 'invalid');
      expect(getSelectedVehicle()).toBe('bike');
    });

    it('getSelectedVehicle returns hoverboard when selected (currently enabled)', () => {
      localStorage.setItem('luminal-vehicle', 'hoverboard');
      expect(getSelectedVehicle()).toBe('hoverboard');
    });
  });

  // ── Vehicle Display Data ───────────────────────────────
  describe('vehicle display data', () => {
    it('has stats for bike', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.bike).toBeTruthy();
      expect(_LOADOUT_STATS_FOR_TESTING.bike.name).toBe('SPECTRE');
    });

    it('has stats for car', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.car).toBeTruthy();
      expect(_LOADOUT_STATS_FOR_TESTING.car.name).toBe('SLINGSHOT');
    });

    it('bike has exactly 5 stat bars', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.bike.stats).toHaveLength(5);
    });

    it('car has exactly 5 stat bars', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.car.stats).toHaveLength(5);
    });

    it('stat labels match expected categories', () => {
      const expected = ['SPEED', 'BOOST', 'ACCEL', 'HANDLING', 'METER'];
      expect(_LOADOUT_STATS_FOR_TESTING.bike.stats.map(s => s.label)).toEqual(expected);
      expect(_LOADOUT_STATS_FOR_TESTING.car.stats.map(s => s.label)).toEqual(expected);
      expect(_LOADOUT_STATS_FOR_TESTING.hoverboard.stats.map(s => s.label)).toEqual(expected);
    });

    it('all stat values are between 1 and 10', () => {
      for (const key of ['bike', 'car', 'hoverboard'] as const) {
        for (const stat of _LOADOUT_STATS_FOR_TESTING[key].stats) {
          expect(stat.value).toBeGreaterThanOrEqual(1);
          expect(stat.value).toBeLessThanOrEqual(10);
        }
      }
    });

    it('bike has flavor text', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.bike.flavor.length).toBeGreaterThan(0);
    });

    it('car has flavor text', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.car.flavor.length).toBeGreaterThan(0);
    });

    it('bike has special ability', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.bike.special.name).toBe('SLIPSTREAM');
      expect(_LOADOUT_STATS_FOR_TESTING.bike.special.desc.length).toBeGreaterThan(0);
    });

    it('car has special ability', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.car.special.name).toBe('SIDEWINDER');
      expect(_LOADOUT_STATS_FOR_TESTING.car.special.desc.length).toBeGreaterThan(0);
    });

    it('has stats for hoverboard', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.hoverboard).toBeTruthy();
      expect(_LOADOUT_STATS_FOR_TESTING.hoverboard.name).toBe('VECTOR');
    });

    it('hoverboard has exactly 5 stat bars', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.hoverboard.stats).toHaveLength(5);
    });

    it('hoverboard has special ability', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.hoverboard.special.name).toBe('VECTOR LOCK');
      expect(_LOADOUT_STATS_FOR_TESTING.hoverboard.special.desc.length).toBeGreaterThan(0);
    });

    it('hoverboard has flavor text', () => {
      expect(_LOADOUT_STATS_FOR_TESTING.hoverboard.flavor.length).toBeGreaterThan(0);
    });

    it('vehicles have distinct stat profiles', () => {
      const bikeStats = _LOADOUT_STATS_FOR_TESTING.bike.stats.map(s => s.value);
      const carStats = _LOADOUT_STATS_FOR_TESTING.car.stats.map(s => s.value);
      const hoverStats = _LOADOUT_STATS_FOR_TESTING.hoverboard.stats.map(s => s.value);
      const bikeCar = bikeStats.filter((v, i) => v !== carStats[i]);
      const bikeHover = bikeStats.filter((v, i) => v !== hoverStats[i]);
      expect(bikeCar.length).toBeGreaterThan(0);
      expect(bikeHover.length).toBeGreaterThan(0);
    });
  });

  // ── Quick Start Integration ────────────────────────────
  describe('Quick Start integration', () => {
    it('Quick Start uses luminal-vehicle from localStorage', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      expect(getSelectedVehicle()).toBe('car');
    });

    it('Quick Start uses luminal-color from localStorage', () => {
      localStorage.setItem('luminal-color', 'cyan');
      expect(getSelectedColorKey()).toBe('cyan');
    });
  });

  // ── Color System ───────────────────────────────────────
  describe('color system', () => {
    it('all 10 player colors are available', () => {
      expect(PLAYER_COLORS).toHaveLength(10);
    });

    it('each color has key, color, emissive, and css properties', () => {
      for (const color of PLAYER_COLORS) {
        expect(color.key).toBeTruthy();
        expect(typeof color.color).toBe('number');
        expect(typeof color.emissive).toBe('number');
        expect(color.css).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it('default player color key is red', () => {
      expect(DEFAULT_PLAYER_COLOR_KEY).toBe('red');
    });
  });

  // ── Match Options: CHARACTER button ────────────────────
  describe('match options CHARACTER button', () => {
    it('CHARACTER button exists', () => {
      expect(document.getElementById('btn-character-select')).toBeTruthy();
    });

    it('vehicle arrow selector has been removed', () => {
      expect(document.getElementById('vehicle-qs-label')).toBeNull();
      expect(document.getElementById('vehicle-left')).toBeNull();
      expect(document.getElementById('vehicle-right')).toBeNull();
    });
  });

  // ── Header/Footer structure ────────────────────────────
  describe('header and footer', () => {
    it('has overlay-header-bar', () => {
      expect(document.querySelector('.overlay-header-bar')).toBeTruthy();
    });

    it('has auto-save toast element (cs-saved)', () => {
      const saved = document.getElementById('cs-saved');
      expect(saved).toBeTruthy();
    });

    it('difficulty container lives in MATCH tab panel', () => {
      const diff = document.getElementById('cs-difficulty-options');
      expect(diff).toBeTruthy();
      expect(diff?.closest('#hub-panel-match')).toBeTruthy();
    });

    it('has at least one cs-section-label', () => {
      expect(document.querySelectorAll('.cs-section-label').length).toBeGreaterThan(0);
    });
  });

  // ── Hub back-button wiring ─────────────────────────────
  describe('hub back-button wiring', () => {
    beforeEach(() => {
      _resetForTesting();
    });

    it('clicking hub-back calls onBack', () => {
      const playTick = vi.fn();
      const onBack = vi.fn();
      initCharacterSelect({ playTick, onBack });
      document.getElementById('hub-back')!.click();
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('stat bar animation', () => {
    beforeEach(() => {
      _resetForTesting();
    });

    it('stat bars start at width 0 on vehicle apply (before stagger runs)', () => {
      initCharacterSelect({ playTick: vi.fn(), onBack: vi.fn() });

      // Click car card to trigger vehicle apply
      document.getElementById('cs-card-car')!.click();

      // Immediately after click, all fills should be at width:0% (stagger hasn't fired)
      const fills = document.querySelectorAll('#cs-stats .cs-stat-fill');
      expect(fills.length).toBe(5);
      for (const fill of Array.from(fills)) {
        expect((fill as HTMLElement).style.width).toBe('0%');
      }
    });
  });

  // ── Signed-in accounts: vehicles are never progression-locked ──
  describe('signed-in vehicle selection', () => {
    beforeEach(() => {
      _resetForTesting();
      // Stored progression that predates the current defaults (no car/hoverboard)
      _setStateForTesting({
        level: 1, xp: 0, totalXp: 0,
        unlockedItems: ['vehicle:bike', 'color:red', 'color:cyan'],
        challengeProgress: {}, tokensUsed: {},
      });
    });
    afterEach(() => { _resetManagerForTesting(); });

    it('getSelectedVehicle keeps a saved car for a signed-in account', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      expect(getSelectedVehicle()).toBe('car');
    });

    it('clicking a vehicle card selects it for a signed-in account', () => {
      initCharacterSelect({ playTick: vi.fn(), onBack: vi.fn() });
      for (const v of ['car', 'hoverboard'] as const) {
        const card = document.getElementById(`cs-card-${v}`)!;
        card.click();
        expect(localStorage.getItem('luminal-vehicle')).toBe(v);
        expect(card.classList.contains('cs-card--selected')).toBe(true);
        expect(card.classList.contains('cs-card--disabled')).toBe(false);
      }
    });
  });
});
