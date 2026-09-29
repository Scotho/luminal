import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockLocalStorage } from '../../__tests__/helpers';
const storage = mockLocalStorage();

import { detachSession, dockSession, getFloatingWindows, _resetForTesting, wireTabTearOff } from '../detachableWindow';

beforeEach(() => {
  storage.clear();
  _resetForTesting();
  document.body.innerHTML = '<div id="cc-flyout"><div id="cc-agent-tabs"></div><div id="cc-flyout-output"></div></div>';
});

const STORAGE_KEY = 'luminal-floating-windows';

describe('detachableWindow', () => {
  describe('detachSession', () => {
    it('creates a floating window element in DOM', () => {
      detachSession('sess-1', 100, 200, { label: 'Agent 1', status: 'running' });
      const el = document.querySelector('.cc-floating-window');
      expect(el).not.toBeNull();
    });

    it('positions window at specified coordinates', () => {
      detachSession('sess-2', 150, 100, { label: 'Agent 2', status: 'idle' });
      const el = document.querySelector<HTMLElement>('.cc-floating-window');
      expect(el).not.toBeNull();
      expect(el!.style.left).toBe('150px');
      expect(el!.style.top).toBe('100px');
    });

    it('returns a FloatingWindow object with sessionId', () => {
      const fw = detachSession('sess-3', 0, 0, { label: 'A', status: 'running' });
      expect(fw.sessionId).toBe('sess-3');
    });

    it('enforces minimum size constraints', () => {
      const fw = detachSession('sess-4', 0, 0, { label: 'B', status: 'idle' });
      expect(fw.element.style.minWidth).toBe('320px');
      expect(fw.element.style.minHeight).toBe('240px');
    });

    it('creates titlebar inside window', () => {
      detachSession('sess-5', 50, 50, { label: 'C', status: 'running' });
      const titlebar = document.querySelector('.cc-float-titlebar');
      expect(titlebar).not.toBeNull();
    });

    it('creates content area inside window', () => {
      detachSession('sess-6', 50, 50, { label: 'D', status: 'running' });
      const content = document.querySelector('.cc-float-content');
      expect(content).not.toBeNull();
    });
  });

  describe('minimize', () => {
    it('hides window and creates pill element', () => {
      const fw = detachSession('sess-min', 100, 100, { label: 'Min Test', status: 'running' });
      fw.minimize();
      expect(fw.element.style.display).toBe('none');
      const pill = document.querySelector('.cc-float-pill');
      expect(pill).not.toBeNull();
    });
  });

  describe('maximize', () => {
    it('adds maximized class to window', () => {
      const fw = detachSession('sess-max', 100, 100, { label: 'Max Test', status: 'running' });
      fw.maximize();
      expect(fw.element.classList.contains('cc-float--maximized')).toBe(true);
    });

    it('toggles maximized class on second call', () => {
      const fw = detachSession('sess-max2', 100, 100, { label: 'Max Test 2', status: 'running' });
      fw.maximize();
      fw.maximize();
      expect(fw.element.classList.contains('cc-float--maximized')).toBe(false);
    });
  });

  describe('dockSession', () => {
    it('removes floating window from DOM', () => {
      detachSession('sess-dock', 100, 100, { label: 'Dock Test', status: 'running' });
      expect(document.querySelector('.cc-floating-window')).not.toBeNull();
      dockSession('sess-dock');
      // After docking, that specific session's window should be gone
      expect(document.querySelectorAll('.cc-floating-window').length).toBe(0);
    });

    it('removes only the specified session window', () => {
      detachSession('sess-a', 10, 10, { label: 'A', status: 'running' });
      detachSession('sess-b', 200, 200, { label: 'B', status: 'running' });
      expect(document.querySelectorAll('.cc-floating-window').length).toBe(2);
      dockSession('sess-a');
      expect(document.querySelectorAll('.cc-floating-window').length).toBe(1);
    });
  });

  describe('bringToFront', () => {
    it('increments z-index when bringToFront called', () => {
      const fw1 = detachSession('sess-z1', 0, 0, { label: 'Z1', status: 'running' });
      const fw2 = detachSession('sess-z2', 50, 50, { label: 'Z2', status: 'running' });
      const z1Before = parseInt(fw1.element.style.zIndex, 10);
      fw2.bringToFront();
      const z2After = parseInt(fw2.element.style.zIndex, 10);
      expect(z2After).toBeGreaterThan(z1Before);
    });

    it('bringToFront gives window a higher z-index than initial', () => {
      const fw = detachSession('sess-z3', 0, 0, { label: 'Z3', status: 'running' });
      const zBefore = parseInt(fw.element.style.zIndex, 10);
      fw.bringToFront();
      const zAfter = parseInt(fw.element.style.zIndex, 10);
      expect(zAfter).toBeGreaterThan(zBefore);
    });
  });

  describe('getFloatingWindows', () => {
    it('returns empty array initially', () => {
      expect(getFloatingWindows()).toHaveLength(0);
    });

    it('returns all active windows', () => {
      detachSession('sess-w1', 0, 0, { label: 'W1', status: 'running' });
      detachSession('sess-w2', 50, 50, { label: 'W2', status: 'running' });
      expect(getFloatingWindows()).toHaveLength(2);
    });

    it('reflects windows removed by dockSession', () => {
      detachSession('sess-wr1', 0, 0, { label: 'WR1', status: 'running' });
      detachSession('sess-wr2', 50, 50, { label: 'WR2', status: 'running' });
      dockSession('sess-wr1');
      expect(getFloatingWindows()).toHaveLength(1);
      expect(getFloatingWindows()[0].sessionId).toBe('sess-wr2');
    });
  });

  describe('localStorage persistence', () => {
    it('persists window state to localStorage on detach', () => {
      detachSession('sess-ls1', 100, 200, { label: 'LS1', status: 'running' });
      const raw = storage.get(STORAGE_KEY);
      expect(raw).toBeDefined();
      expect(raw).toContain('sess-ls1');
    });

    it('removes session from localStorage on close', () => {
      const fw = detachSession('sess-ls2', 100, 200, { label: 'LS2', status: 'running' });
      fw.close();
      const raw = storage.get(STORAGE_KEY);
      // Either null/undefined or parsed array should not contain the session
      if (raw) {
        expect(raw).not.toContain('sess-ls2');
      } else {
        expect(raw).toBeFalsy();
      }
    });

    it('persists multiple windows', () => {
      detachSession('sess-ls3', 0, 0, { label: 'LS3', status: 'running' });
      detachSession('sess-ls4', 50, 50, { label: 'LS4', status: 'running' });
      const raw = storage.get(STORAGE_KEY);
      expect(raw).toContain('sess-ls3');
      expect(raw).toContain('sess-ls4');
    });
  });

  describe('close', () => {
    it('removes window element from DOM', () => {
      const fw = detachSession('sess-cl1', 100, 100, { label: 'Close1', status: 'running' });
      fw.close();
      expect(document.querySelectorAll('.cc-floating-window').length).toBe(0);
    });

    it('removes window from getFloatingWindows', () => {
      const fw = detachSession('sess-cl2', 100, 100, { label: 'Close2', status: 'running' });
      fw.close();
      expect(getFloatingWindows()).toHaveLength(0);
    });

    it('removes pill if minimized before close', () => {
      const fw = detachSession('sess-cl3', 100, 100, { label: 'Close3', status: 'running' });
      fw.minimize();
      expect(document.querySelector('.cc-float-pill')).not.toBeNull();
      fw.close();
      expect(document.querySelector('.cc-float-pill')).toBeNull();
    });
  });

  describe('_resetForTesting', () => {
    it('clears all windows', () => {
      detachSession('sess-r1', 0, 0, { label: 'R1', status: 'running' });
      detachSession('sess-r2', 50, 50, { label: 'R2', status: 'running' });
      _resetForTesting();
      expect(getFloatingWindows()).toHaveLength(0);
    });

    it('removes all window elements from DOM', () => {
      detachSession('sess-r3', 0, 0, { label: 'R3', status: 'running' });
      _resetForTesting();
      expect(document.querySelectorAll('.cc-floating-window').length).toBe(0);
    });
  });

  describe('resize handles', () => {
    it('floating window has 8 resize handles', () => {
      const win = detachSession('sess-1', 100, 100, { label: 'Test', status: 'done' });
      const handles = win.element.querySelectorAll('.cc-float-resize');
      expect(handles.length).toBe(8);
      win.close();
    });
  });

  describe('wireTabTearOff', () => {
    it('wireTabTearOff is exported', () => {
      expect(typeof wireTabTearOff).toBe('function');
    });
  });
});
