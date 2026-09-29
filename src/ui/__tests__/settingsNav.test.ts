import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock sfx module before importing settingsNav
vi.mock('../../sfx', () => ({
  playTick: vi.fn(),
  playUiTab: vi.fn(),
}));

import { SETTINGS_TABS, getActiveTab, cycleTab, switchTab, _resetForTesting } from '../settingsNav';
import { playTick } from '../../sfx';

describe('settingsNav', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  describe('SETTINGS_TABS', () => {
    it('has 7 tabs in correct order', () => {
      expect(SETTINGS_TABS).toEqual([
        'gameplay', 'video', 'audio', 'camera', 'controls', 'hud', 'account',
      ]);
    });
  });

  describe('cycleTab', () => {
    it('cycles forward through tabs', () => {
      // Default is 'video' (index 1), cycling forward goes to 'audio' (index 2)
      const startTab = getActiveTab();
      expect(startTab).toBe('video');
      cycleTab(1);
      expect(getActiveTab()).toBe('audio');
    });

    it('wraps forward from last to first', () => {
      // Navigate to 'account' (last tab)
      switchTab('account');
      expect(getActiveTab()).toBe('account');
      cycleTab(1);
      expect(getActiveTab()).toBe('gameplay');
    });

    it('cycles backward', () => {
      switchTab('audio');
      cycleTab(-1);
      expect(getActiveTab()).toBe('video');
    });

    it('wraps backward from first to last', () => {
      switchTab('gameplay');
      cycleTab(-1);
      expect(getActiveTab()).toBe('account');
    });
  });

  describe('switchTab', () => {
    it('does nothing when switching to already active tab', () => {
      switchTab('video');
      vi.mocked(playTick).mockClear();
      switchTab('video');
      expect(playTick).not.toHaveBeenCalled();
    });
  });
});
