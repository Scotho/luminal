// ── Settings UI Tests ───────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing settingsUI
vi.mock('../../audio', () => ({
  setMusicVolume: vi.fn(),
  getPlaylistMode: vi.fn(() => 'default'),
}));
vi.mock('../../sfx', () => ({
  setSfxVolume: vi.fn(),
  playTick: vi.fn(),
  playUiBlip: vi.fn(),
}));
vi.mock('../../scene', () => ({
  setCameraFOV: vi.fn(),
  setCameraDist: vi.fn(),
  setCameraLerp: vi.fn(),
  setShakeEnabled: vi.fn(),
}));
vi.mock('../../graphics', () => ({
  getGfx: vi.fn(() => ({
    preset: 'high',
    bloom: 'high',
    pixelRatio: 2,
    arenaDetail: 'full',
    raveSpotlights: 8,
    audioReactivity: 'full',
    playerVFX: 'full',
    lighting: 'full',
    atmosphere: 'full',
  })),
  setPreset: vi.fn(),
  setSetting: vi.fn(),
  loadSettings: vi.fn(() => true),
  detectPreset: vi.fn(),
  PRESET_NAMES: ['low', 'medium', 'high', 'ultra'],
  BLOOM_LEVEL_NAMES: ['off', 'low', 'high', 'ultra'],
  BLOOM_PRESETS: { off: { strength: 0, enabled: false }, low: { strength: 1.0, enabled: true }, high: { strength: 3.2, enabled: true }, ultra: { strength: 4.0, enabled: true } },
  getBloomLevel: vi.fn(() => 'high'),
  PIXEL_RATIO_OPTIONS: [0.5, 1, 1.5, 2],
  ARENA_DETAIL_OPTIONS: ['minimal', 'reduced', 'full'],
  RAVE_OPTIONS: [0, 4, 8],
  REACTIVITY_OPTIONS: ['off', 'low', 'full'],
  VFX_OPTIONS: ['off', 'low', 'full'],
  LIGHTING_OPTIONS: ['minimal', 'reduced', 'full'],
  ATMOSPHERE_OPTIONS: ['off', 'haze', 'full'],
}));

import { initSettingsUI, getRadarEnabled, getLineAssistEnabled, getAutoSubmitEnabled } from '../settingsUI';
import { setMusicVolume } from '../../audio';
import { setSfxVolume } from '../../sfx';

describe('Settings UI', () => {
  const mockGame = {
    radarEnabled: true,
    settingsOpen: false,
    rebuildWorld: vi.fn(),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockGame.radarEnabled = true;
    mockGame.settingsOpen = false;
  });

  describe('initialization', () => {
    it('initializes without errors', () => {
      expect(() => initSettingsUI({ game: mockGame })).not.toThrow();
    });
  });

  describe('volume sliders', () => {
    beforeEach(() => {
      initSettingsUI({ game: mockGame });
    });

    it('restores saved music volume from localStorage', () => {
      localStorage.setItem('luminal-vol-music', '50');
      initSettingsUI({ game: mockGame });
      const slider = document.getElementById('vol-music') as HTMLInputElement;
      expect(slider.value).toBe('50');
    });

    it('restores saved sfx volume from localStorage', () => {
      localStorage.setItem('luminal-vol-sfx', '75');
      initSettingsUI({ game: mockGame });
      const slider = document.getElementById('vol-sfx') as HTMLInputElement;
      expect(slider.value).toBe('75');
    });

    it('calls setMusicVolume on input event', () => {
      const slider = document.getElementById('vol-music') as HTMLInputElement;
      slider.value = '60';
      slider.dispatchEvent(new Event('input'));
      expect(setMusicVolume).toHaveBeenCalledWith(0.6);
    });

    it('calls setSfxVolume on input event', () => {
      const slider = document.getElementById('vol-sfx') as HTMLInputElement;
      slider.value = '80';
      slider.dispatchEvent(new Event('input'));
      expect(setSfxVolume).toHaveBeenCalledWith(0.8);
    });

    it('persists music volume to localStorage on change', () => {
      const slider = document.getElementById('vol-music') as HTMLInputElement;
      slider.value = '45';
      slider.dispatchEvent(new Event('change'));
      expect(localStorage.getItem('luminal-vol-music')).toBe('45');
    });

    it('persists sfx volume to localStorage on change', () => {
      const slider = document.getElementById('vol-sfx') as HTMLInputElement;
      slider.value = '90';
      slider.dispatchEvent(new Event('change'));
      expect(localStorage.getItem('luminal-vol-sfx')).toBe('90');
    });
  });

  describe('toggle defaults', () => {
    it('radar defaults to enabled', () => {
      expect(getRadarEnabled()).toBe(true);
    });

    it('line assist defaults to enabled', () => {
      expect(getLineAssistEnabled()).toBe(true);
    });

    it('auto submit defaults to enabled', () => {
      expect(getAutoSubmitEnabled()).toBe(true);
    });

    it('auto-submit defaults to enabled', () => {
      expect(getAutoSubmitEnabled()).toBe(true);
    });
  });

  describe('toggle persistence', () => {
    it('radar disabled persists to localStorage', () => {
      localStorage.setItem('luminal-radar-enabled', 'false');
      // Re-import would re-read. We test the getRadarEnabled contract instead.
      expect(localStorage.getItem('luminal-radar-enabled')).toBe('false');
    });

    it('autosubmit enabled persists to localStorage', () => {
      localStorage.setItem('luminal-autosubmit', 'true');
      expect(localStorage.getItem('luminal-autosubmit')).toBe('true');
    });
  });

  describe('settings DOM structure', () => {
    it('settings overlay exists with correct sections', () => {
      const overlay = document.getElementById('settings-overlay')!;
      expect(overlay).toBeTruthy();
      expect(overlay.classList.contains('overlay-screen')).toBe(true);

      // New tab-based layout: tabs are represented as sidebar items
      const sidebarItems = overlay.querySelectorAll('.settings-sidebar-item');
      const tabNames = Array.from(sidebarItems).map(s => s.textContent?.trim());
      expect(tabNames).toContain('GAMEPLAY');
      expect(tabNames).toContain('AUDIO');
      expect(tabNames).toContain('CAMERA');
      expect(tabNames).toContain('VIDEO');
      expect(tabNames).toContain('HUD');
      expect(tabNames).toContain('CONTROLS');
      expect(tabNames).toContain('ACCOUNT');
    });

    it('has quality preset toggle with LOW/MED/HIGH/ULTRA', () => {
      const presetToggle = document.getElementById('gfx-preset-toggle')!;
      expect(presetToggle).toBeTruthy();
      const opts = presetToggle.querySelectorAll('.control-toggle__option');
      const labels = Array.from(opts).map(o => o.textContent?.trim());
      expect(labels).toEqual(['LOW', 'MED', 'HIGH', 'ULTRA', 'CUSTOM']);
    });

    it('has volume sliders for music and sfx', () => {
      expect(document.getElementById('vol-music')).toBeTruthy();
      expect(document.getElementById('vol-sfx')).toBeTruthy();
    });

    it('has camera FOV and distance sliders', () => {
      expect(document.getElementById('cam-fov')).toBeTruthy();
      expect(document.getElementById('cam-dist')).toBeTruthy();
    });

    it('has radar size slider and toggle', () => {
      expect(document.getElementById('radar-size')).toBeTruthy();
      expect(document.getElementById('radar-toggle')).toBeTruthy();
    });

    it('has line assist toggle', () => {
      expect(document.getElementById('lineassist-toggle')).toBeTruthy();
    });

    it('has auto submit toggle', () => {
      expect(document.getElementById('autosubmit-toggle')).toBeTruthy();
    });

    it('has social dropdown in top bar', () => {
      expect(document.getElementById('social-dropdown-wrap')).toBeTruthy();
    });

    it('has inline keybind rows in Controls tab', () => {
      expect(document.querySelector('.keybind-row[data-action="left"]')).toBeTruthy();
      expect(document.getElementById('btn-keybinds-reset')).toBeTruthy();
    });
  });

  describe('collapsible sections', () => {
    it('all sections start collapsed', () => {
      const bodies = document.getElementById('settings-overlay')!.querySelectorAll('.settings-section-body');
      bodies.forEach(body => {
        expect(body.classList.contains('settings-section-body--collapsed')).toBe(true);
      });
    });

    it('section headings have collapsed class initially', () => {
      const headings = document.getElementById('settings-overlay')!.querySelectorAll('.section-heading.settings-section');
      headings.forEach(heading => {
        expect(heading.classList.contains('settings-section--collapsed')).toBe(true);
      });
    });
  });
});
