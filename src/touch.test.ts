import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Import module under test ────────────────────────────
import {
  initTouch,
  getTouchState,
  showTouchControls,
  hideTouchControls,
  setTouchVehicle,
  setTouchDrifting,
} from './touch';

// ── Tests ───────────────────────────────────────────────

describe('touch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getTouchState before init ─────────────────────────

  describe('getTouchState', () => {
    it('returns null when overlay is hidden (default after init)', () => {
      // After init, the overlay exists but has class "hidden",
      // so getTouchState should return null.
      const state = getTouchState();
      // Either null (not initialized) or null (hidden overlay)
      expect(state).toBeNull();
    });
  });

  // ── initTouch ─────────────────────────────────────────

  describe('initTouch', () => {
    it('does not throw', () => {
      expect(() => initTouch()).not.toThrow();
    });

    it('is idempotent (calling twice is safe)', () => {
      expect(() => {
        initTouch();
        initTouch();
      }).not.toThrow();
    });

    it('creates the touch overlay in DOM', () => {
      initTouch();
      const overlay = document.getElementById('touch-overlay');
      expect(overlay).not.toBeNull();
    });

    it('overlay starts hidden', () => {
      initTouch();
      const overlay = document.getElementById('touch-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay!.classList.contains('hidden')).toBe(true);
    });
  });

  // ── showTouchControls / hideTouchControls ─────────────

  describe('showTouchControls / hideTouchControls', () => {
    it('showTouchControls removes hidden class from overlay', () => {
      initTouch();
      showTouchControls();
      const overlay = document.getElementById('touch-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay!.classList.contains('hidden')).toBe(false);
    });

    it('getTouchState returns state after showing controls', () => {
      initTouch();
      showTouchControls();
      const state = getTouchState();
      expect(state).not.toBeNull();
      expect(typeof state!.left).toBe('boolean');
      expect(typeof state!.right).toBe('boolean');
      expect(typeof state!.accelerate).toBe('boolean');
      expect(typeof state!.dash).toBe('boolean');
      expect(typeof state!.brake).toBe('boolean');
    });

    it('default touch state has no active inputs', () => {
      initTouch();
      showTouchControls();
      const state = getTouchState();
      expect(state).not.toBeNull();
      expect(state!.left).toBe(false);
      expect(state!.right).toBe(false);
      expect(state!.accelerate).toBe(false);
      expect(state!.dash).toBe(false);
      expect(state!.brake).toBe(false);
    });

    it('hideTouchControls adds hidden class back', () => {
      initTouch();
      showTouchControls();
      hideTouchControls();
      const overlay = document.getElementById('touch-overlay');
      expect(overlay!.classList.contains('hidden')).toBe(true);
    });

    it('getTouchState returns null after hiding controls', () => {
      initTouch();
      showTouchControls();
      hideTouchControls();
      expect(getTouchState()).toBeNull();
    });
  });

  // ── setTouchVehicle ───────────────────────────────────

  describe('setTouchVehicle', () => {
    it('does not throw for bike', () => {
      initTouch();
      expect(() => setTouchVehicle('bike')).not.toThrow();
    });

    it('does not throw for car', () => {
      initTouch();
      expect(() => setTouchVehicle('car')).not.toThrow();
    });

    it('updates slide hint text to DRIFT for car', () => {
      initTouch();
      setTouchVehicle('car');
      const hint = document.getElementById('touch-slide-hint');
      expect(hint).not.toBeNull();
      expect(hint!.textContent).toBe('DRIFT');
    });

    it('updates slide hint text to SLIDE for bike', () => {
      initTouch();
      setTouchVehicle('bike');
      const hint = document.getElementById('touch-slide-hint');
      expect(hint).not.toBeNull();
      expect(hint!.textContent).toBe('SLIDE');
    });
  });

  // ── setTouchDrifting ──────────────────────────────────

  describe('setTouchDrifting', () => {
    it('does not throw', () => {
      initTouch();
      expect(() => setTouchDrifting(true)).not.toThrow();
      expect(() => setTouchDrifting(false)).not.toThrow();
    });

    it('is idempotent with same value', () => {
      initTouch();
      expect(() => {
        setTouchDrifting(true);
        setTouchDrifting(true);
      }).not.toThrow();
    });
  });
});
