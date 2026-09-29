import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getGfx, setPreset, setSetting, onSettingsChange, loadSettings, BLOOM_PRESETS, getBloomLevel } from './graphics';

describe('graphics settings', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset to default by loading with no saved settings
    setPreset('high');
  });

  describe('getGfx', () => {
    it('returns current settings object', () => {
      const settings = getGfx();
      expect(settings).toHaveProperty('preset');
      expect(settings).toHaveProperty('bloom');
      expect(settings).toHaveProperty('antialias');
      expect(settings).toHaveProperty('pixelRatio');
    });
  });

  describe('setPreset', () => {
    it('sets low preset', () => {
      setPreset('low');
      const s = getGfx();
      expect(s.preset).toBe('low');
      expect(s.bloom).toEqual(BLOOM_PRESETS.off);
      expect(s.antialias).toBe(false);
      expect(s.pixelRatio).toBe(1.0);
    });

    it('sets medium preset', () => {
      setPreset('medium');
      const s = getGfx();
      expect(s.preset).toBe('medium');
      expect(s.bloom).toEqual(BLOOM_PRESETS.low);
      expect(s.pixelRatio).toBe(1.5);
    });

    it('sets high preset', () => {
      setPreset('high');
      const s = getGfx();
      expect(s.preset).toBe('high');
      expect(s.bloom).toEqual(BLOOM_PRESETS.high);
      expect(s.antialias).toBe(true);
      expect(s.pixelRatio).toBe(2.0);
    });

    it('sets ultra preset', () => {
      setPreset('ultra');
      const s = getGfx();
      expect(s.preset).toBe('ultra');
      expect(s.bloom).toEqual(BLOOM_PRESETS.ultra);
    });

    it('persists to localStorage', () => {
      setPreset('low');
      expect(localStorage.getItem('luminal-gfx-preset')).toBe('low');
    });

    it('ignores invalid preset names', () => {
      setPreset('high');
      setPreset('nonexistent' as any);
      expect(getGfx().preset).toBe('high');
    });
  });

  describe('setSetting', () => {
    it('changes individual setting', () => {
      setPreset('high');
      setSetting('bloom', BLOOM_PRESETS.off);
      expect(getGfx().bloom.enabled).toBe(false);
    });

    it('sets preset to custom when it no longer matches', () => {
      setPreset('high');
      setSetting('bloom', BLOOM_PRESETS.off);
      expect(getGfx().preset).toBe('custom');
    });

    it('detects matching preset when setting matches a preset', () => {
      setPreset('high');
      setSetting('bloom', BLOOM_PRESETS.ultra);
      setSetting('reflections', 'ultra');
      // Changed bloom + reflections from high to ultra — all settings now match ultra preset
      expect(getGfx().preset).toBe('ultra');
    });

    it('ignores invalid setting keys', () => {
      const before = { ...getGfx() };
      setSetting('nonexistent', 'value');
      expect(getGfx()).toEqual(before);
    });
  });

  describe('onSettingsChange', () => {
    it('calls listener when preset changes', () => {
      const listener = vi.fn();
      onSettingsChange(listener);
      setPreset('low');
      expect(listener).toHaveBeenCalledWith(getGfx());
    });

    it('calls listener when individual setting changes', () => {
      const listener = vi.fn();
      onSettingsChange(listener);
      setSetting('bloom', BLOOM_PRESETS.off);
      expect(listener).toHaveBeenCalled();
    });

    it('supports multiple listeners', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      onSettingsChange(l1);
      onSettingsChange(l2);
      setPreset('low');
      expect(l1).toHaveBeenCalled();
      expect(l2).toHaveBeenCalled();
    });
  });

  describe('loadSettings', () => {
    it('returns false when no saved settings exist', () => {
      localStorage.clear();
      expect(loadSettings()).toBe(false);
    });

    it('returns true and restores saved preset', () => {
      setPreset('low'); // saves 'low' to localStorage
      expect(loadSettings()).toBe(true);
      expect(getGfx().preset).toBe('low');
    });
  });

  describe('bloom presets', () => {
    it('BLOOM_PRESETS has correct pmndrs BloomEffect values for each level', () => {
      // off: strength=0, bloom disabled
      expect(BLOOM_PRESETS.off.strength).toBe(0);
      expect(BLOOM_PRESETS.off.radius).toBe(0.4);
      expect(BLOOM_PRESETS.off.threshold).toBe(0.25);
      expect(BLOOM_PRESETS.off.enabled).toBe(false);

      // low
      expect(BLOOM_PRESETS.low.strength).toBe(0.6);
      expect(BLOOM_PRESETS.low.radius).toBe(0.35);
      expect(BLOOM_PRESETS.low.threshold).toBe(0.25);
      expect(BLOOM_PRESETS.low.enabled).toBe(true);

      // high
      expect(BLOOM_PRESETS.high.strength).toBe(1.0);
      expect(BLOOM_PRESETS.high.radius).toBe(0.5);
      expect(BLOOM_PRESETS.high.threshold).toBe(0.18);
      expect(BLOOM_PRESETS.high.enabled).toBe(true);

      // ultra
      expect(BLOOM_PRESETS.ultra.strength).toBe(1.1);
      expect(BLOOM_PRESETS.ultra.radius).toBe(0.55);
      expect(BLOOM_PRESETS.ultra.threshold).toBe(0.16);
      expect(BLOOM_PRESETS.ultra.enabled).toBe(true);
    });

    it('BLOOM_PRESETS vehiclesMul is 0.15 for all levels', () => {
      expect(BLOOM_PRESETS.off.vehiclesMul).toBe(0.15);
      expect(BLOOM_PRESETS.low.vehiclesMul).toBe(0.15);
      expect(BLOOM_PRESETS.high.vehiclesMul).toBe(0.15);
      expect(BLOOM_PRESETS.ultra.vehiclesMul).toBe(0.15);
    });

    it('getBloomLevel returns correct level based on current strength', () => {
      setPreset('high');
      expect(getBloomLevel()).toBe('high');

      setPreset('low');
      // low preset uses BLOOM_PRESETS.off (bloom disabled)
      expect(getBloomLevel()).toBe('off');

      setPreset('medium');
      // medium preset uses BLOOM_PRESETS.low
      expect(getBloomLevel()).toBe('low');

      setPreset('ultra');
      // ultra has unique strength=1.4
      expect(getBloomLevel()).toBe('ultra');
    });
  });
});
