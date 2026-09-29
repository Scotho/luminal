// ── Keybinds UI Tests ───────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../input', () => ({
  getBinds: vi.fn(() => ({
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    accelerate: ['KeyW', 'RMB'],
    brake: ['KeyS', 'ArrowDown'],
    dash: ['ShiftLeft', 'LMB'],
    rPlayPause: ['Space', ''],
    rCamPrev: ['KeyQ', ''],
    rCamNext: ['KeyE', 'KeyC'],
    rSkipBack: ['ArrowLeft', ''],
    rSkipFwd: ['ArrowRight', ''],
    rFineBack: ['KeyJ', ''],
    rFineFwd: ['KeyL', ''],
    rToggleUI: ['KeyH', ''],
  })),
  setBind: vi.fn(),
  resetBinds: vi.fn(),
  getDefaultBinds: vi.fn(),
}));
vi.mock('../../sfx', () => ({
  playTick: vi.fn(),
  playConfirm: vi.fn(),
}));
vi.mock('../../gamepad', () => ({
  isGamepadConnected: vi.fn(() => false),
}));

import { initKeybindsUI, refreshKeybindLabels } from '../keybindsUI';

describe('Keybinds UI', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('keybind rows (inline in Controls tab)', () => {
    const actions = ['left', 'right', 'accelerate', 'brake', 'dash'];

    actions.forEach(action => {
      it(`has keybind row for "${action}"`, () => {
        const row = document.querySelector(`.keybind-row[data-action="${action}"]`);
        expect(row).toBeTruthy();
      });
    });

    it('has keybind key display elements for primary keys', () => {
      expect(document.getElementById('kb-left')).toBeTruthy();
      expect(document.getElementById('kb-right')).toBeTruthy();
      expect(document.getElementById('kb-accelerate')).toBeTruthy();
      expect(document.getElementById('kb-brake')).toBeTruthy();
      expect(document.getElementById('kb-dash')).toBeTruthy();
    });

    it('has keybind key display elements for secondary keys', () => {
      expect(document.getElementById('kb-left-2')).toBeTruthy();
      expect(document.getElementById('kb-right-2')).toBeTruthy();
      expect(document.getElementById('kb-accelerate-2')).toBeTruthy();
      expect(document.getElementById('kb-brake-2')).toBeTruthy();
      expect(document.getElementById('kb-dash-2')).toBeTruthy();
    });
  });

  describe('replay keybind rows', () => {
    const replayActions = ['rPlayPause', 'rCamPrev', 'rCamNext', 'rSkipBack', 'rSkipFwd', 'rFineBack', 'rFineFwd', 'rToggleUI'];

    replayActions.forEach(action => {
      it(`has keybind row for replay action "${action}"`, () => {
        const row = document.querySelector(`.keybind-row[data-action="${action}"]`);
        expect(row).toBeTruthy();
      });
    });
  });

  describe('reset button', () => {
    it('has reset keybinds button', () => {
      const btn = document.getElementById('btn-keybinds-reset')!;
      expect(btn).toBeTruthy();
    });
  });

  describe('initialization', () => {
    it('initializes without errors', () => {
      expect(() => initKeybindsUI({ navigateTo: vi.fn() })).not.toThrow();
    });
  });
});
