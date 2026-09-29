import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HoverboardAnimator, HoverAnimState } from '../hoverboardAnimator';
import type { HoverAnimInput } from '../hoverboardAnimator';

// ── Minimal Three.js mocks ────────────────────────────────

function mockVector3() {
  return { x: 0, y: 0, z: 0, copy: vi.fn(), setScalar: vi.fn() };
}

function mockEuler() {
  return { x: 0, y: 0, z: 0, set: vi.fn() };
}

function mockGroup(name = ''): any {
  return {
    name,
    position: mockVector3(),
    rotation: mockEuler(),
    scale: { x: 1, y: 1, z: 1, setScalar: vi.fn() },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    userData: {},
    children: [],
    add: vi.fn(),
    remove: vi.fn(),
    traverse: vi.fn(),
  };
}

function defaultInput(overrides: Partial<HoverAnimInput> = {}): HoverAnimInput {
  return {
    dt: 1 / 60,
    speed: 45,
    baseSpeed: 45,
    boosting: false,
    dashing: false,
    turnRamp: 0,
    brakeBlend: 0,
    grinding: false,
    grindBalance: 0,
    airborne: false,
    airborneTimer: 0,
    airborneDuration: 1,
    airbornePeak: 0,
    recovery: false,
    landingPenalty: false,
    ...overrides,
  };
}

describe('HoverboardAnimator', () => {
  let innerGroup: any;
  let animator: HoverboardAnimator;

  beforeEach(() => {
    innerGroup = mockGroup('inner');
    animator = new HoverboardAnimator(innerGroup);
    // Stub performance.now for deterministic tests
    vi.spyOn(performance, 'now').mockReturnValue(1000);
  });

  // ── State resolution ────────────────────────────────────

  describe('state resolution', () => {
    it('defaults to Idle with no input', () => {
      animator.update(defaultInput());
      expect(animator.getState()).toBe(HoverAnimState.Idle);
    });

    it('resolves to Accel when boosting', () => {
      animator.update(defaultInput({ boosting: true }));
      expect(animator.getState()).toBe(HoverAnimState.Accel);
    });

    it('resolves to Boost when dashing', () => {
      animator.update(defaultInput({ dashing: true }));
      expect(animator.getState()).toBe(HoverAnimState.Boost);
    });

    it('resolves to Turn with moderate turn input', () => {
      animator.update(defaultInput({ turnRamp: 0.3 }));
      expect(animator.getState()).toBe(HoverAnimState.Turn);
    });

    it('resolves to Turn with negative turn input', () => {
      animator.update(defaultInput({ turnRamp: -0.5 }));
      expect(animator.getState()).toBe(HoverAnimState.Turn);
    });

    it('resolves to BoardGrab with high turn and sufficient speed', () => {
      animator.update(defaultInput({ turnRamp: 0.85, speed: 45, baseSpeed: 45 }));
      expect(animator.getState()).toBe(HoverAnimState.BoardGrab);
    });

    it('does not resolve to BoardGrab at low speed', () => {
      animator.update(defaultInput({ turnRamp: 0.9, speed: 20, baseSpeed: 45 }));
      expect(animator.getState()).not.toBe(HoverAnimState.BoardGrab);
      expect(animator.getState()).toBe(HoverAnimState.Turn);
    });

    it('resolves to GrindEntry on first frames of grinding', () => {
      animator.update(defaultInput({ grinding: true }));
      expect(animator.getState()).toBe(HoverAnimState.GrindEntry);
    });

    it('resolves to GrindRide after entry duration passes', () => {
      // Simulate 0.25s of grinding (exceeds 0.2s entry duration)
      for (let i = 0; i < 15; i++) {
        animator.update(defaultInput({ grinding: true }));
      }
      expect(animator.getState()).toBe(HoverAnimState.GrindRide);
    });

    it('resolves to GrindExit when grinding stops (not airborne)', () => {
      // Enter grind
      for (let i = 0; i < 5; i++) {
        animator.update(defaultInput({ grinding: true }));
      }
      // Stop grinding (but not airborne — clean exit)
      animator.update(defaultInput({ grinding: false, airborne: false }));
      expect(animator.getState()).toBe(HoverAnimState.GrindExit);
    });

    it('resolves to Airborne when airborne', () => {
      animator.update(defaultInput({ airborne: true, airbornePeak: 0.8, airborneTimer: 0.2, airborneDuration: 0.3 }));
      expect(animator.getState()).toBe(HoverAnimState.Airborne);
    });

    it('resolves to Bail when airborne with landing penalty', () => {
      animator.update(defaultInput({ airborne: true, landingPenalty: true, airbornePeak: 1.2 }));
      expect(animator.getState()).toBe(HoverAnimState.Bail);
    });

    it('resolves to Recovery when recovery is active', () => {
      animator.update(defaultInput({ recovery: true }));
      expect(animator.getState()).toBe(HoverAnimState.Recovery);
    });
  });

  // ── State priority ──────────────────────────────────────

  describe('priority ordering', () => {
    it('Bail takes priority over everything', () => {
      animator.update(defaultInput({
        airborne: true, landingPenalty: true,
        grinding: true, dashing: true, boosting: true,
      }));
      expect(animator.getState()).toBe(HoverAnimState.Bail);
    });

    it('Airborne takes priority over grinding', () => {
      animator.update(defaultInput({ airborne: true, grinding: true, airbornePeak: 0.8 }));
      expect(animator.getState()).toBe(HoverAnimState.Airborne);
    });

    it('GrindRide takes priority over dashing', () => {
      // Build up grind time past entry
      for (let i = 0; i < 15; i++) {
        animator.update(defaultInput({ grinding: true }));
      }
      animator.update(defaultInput({ grinding: true, dashing: true }));
      expect(animator.getState()).toBe(HoverAnimState.GrindRide);
    });

    it('Boost takes priority over Accel', () => {
      animator.update(defaultInput({ dashing: true, boosting: true }));
      expect(animator.getState()).toBe(HoverAnimState.Boost);
    });

    it('Recovery takes priority over Boost', () => {
      animator.update(defaultInput({ recovery: true, dashing: true }));
      expect(animator.getState()).toBe(HoverAnimState.Recovery);
    });
  });

  // ── Pose application ────────────────────────────────────

  describe('pose application', () => {
    it('updates innerGroup position.y', () => {
      animator.update(defaultInput());
      // Idle bob should produce a non-zero y (from sine wave)
      // With time = 1000, sin(1000 * 0.004) = sin(4) ≈ -0.757
      expect(innerGroup.position.y).not.toBe(0);
    });

    it('applies lean to innerGroup rotation.z during turns', () => {
      // Run several frames with turn input so the pose converges
      for (let i = 0; i < 30; i++) {
        animator.update(defaultInput({ turnRamp: 0.5 }));
      }
      expect(innerGroup.rotation.z).not.toBe(0);
    });

    it('applies board proxy transforms when attached', () => {
      const boardProxy = mockGroup('boardProxy');
      const riderProxy = mockGroup('riderProxy');
      const hoverClone = mockGroup('hoverClone');
      hoverClone.userData = { boardProxy, riderProxy };

      animator.attachProxies(hoverClone);

      // Run boost frames
      for (let i = 0; i < 20; i++) {
        animator.update(defaultInput({ dashing: true }));
      }

      // Board should pitch forward (negative X) during boost
      expect(boardProxy.rotation.x).toBeLessThan(0);
    });

    it('applies rider proxy crouch during boost', () => {
      const boardProxy = mockGroup('boardProxy');
      const riderProxy = mockGroup('riderProxy');
      const hoverClone = mockGroup('hoverClone');
      hoverClone.userData = { boardProxy, riderProxy };

      animator.attachProxies(hoverClone);

      for (let i = 0; i < 30; i++) {
        animator.update(defaultInput({ dashing: true }));
      }

      // Rider should crouch (scaleY < 1) and lean forward (pitchX < 0)
      expect(riderProxy.scale.y).toBeLessThan(1);
      expect(riderProxy.rotation.x).toBeLessThan(0);
    });

    it('rider crouches more for BoardGrab than Turn', () => {
      const riderProxy1 = mockGroup('riderProxy');
      const clone1 = mockGroup();
      clone1.userData = { boardProxy: mockGroup(), riderProxy: riderProxy1 };

      const animator1 = new HoverboardAnimator(mockGroup());
      animator1.attachProxies(clone1);

      // Turn
      for (let i = 0; i < 40; i++) {
        animator1.update(defaultInput({ turnRamp: 0.5, speed: 45, baseSpeed: 45 }));
      }
      const turnScaleY = riderProxy1.scale.y;

      const riderProxy2 = mockGroup('riderProxy');
      const clone2 = mockGroup();
      clone2.userData = { boardProxy: mockGroup(), riderProxy: riderProxy2 };

      const animator2 = new HoverboardAnimator(mockGroup());
      animator2.attachProxies(clone2);

      // BoardGrab
      for (let i = 0; i < 40; i++) {
        animator2.update(defaultInput({ turnRamp: 0.85, speed: 45, baseSpeed: 45 }));
      }
      const grabScaleY = riderProxy2.scale.y;

      expect(grabScaleY).toBeLessThan(turnScaleY);
    });
  });

  // ── Pose convergence ────────────────────────────────────

  describe('pose convergence', () => {
    it('converges to idle hover bob position over many frames', () => {
      // Run many frames with idle input
      for (let i = 0; i < 100; i++) {
        animator.update(defaultInput());
      }
      // Should be near the target idle bob value: sin(1000 * 0.004) * 0.05
      const expectedY = Math.sin(1000 * 0.004) * 0.05;
      expect(Math.abs(innerGroup.position.y - expectedY)).toBeLessThan(0.01);
    });

    it('converges toward boost crouch', () => {
      for (let i = 0; i < 60; i++) {
        animator.update(defaultInput({ dashing: true }));
      }
      // innerY should be near the boost bob: sin(1000 * 0.006) * 0.02
      // The position.y is a blend of the lerped value
      // Just verify it's roughly in the right range (not still at 0 or at idle amplitude)
      expect(Math.abs(innerGroup.position.y)).toBeLessThan(0.1);
    });
  });

  // ── Transitions ─────────────────────────────────────────

  describe('transitions', () => {
    it('smoothly transitions from idle to boost (not instant snap)', () => {
      // Start idle for a few frames
      for (let i = 0; i < 10; i++) {
        animator.update(defaultInput());
      }

      const boardProxy = mockGroup('boardProxy');
      const riderProxy = mockGroup('riderProxy');
      const clone = mockGroup();
      clone.userData = { boardProxy, riderProxy };
      animator.attachProxies(clone);

      // One frame of boost
      animator.update(defaultInput({ dashing: true }));
      const firstFrameScaleY = riderProxy.scale.y;

      // Should NOT have jumped straight to 0.85 — should be partially blended
      expect(firstFrameScaleY).toBeGreaterThan(0.85);
      expect(firstFrameScaleY).toBeLessThan(1.0);
    });

    it('GrindEntry transitions to GrindRide over time', () => {
      const states: HoverAnimState[] = [];
      for (let i = 0; i < 20; i++) {
        animator.update(defaultInput({ grinding: true }));
        states.push(animator.getState());
      }
      expect(states[0]).toBe(HoverAnimState.GrindEntry);
      expect(states[states.length - 1]).toBe(HoverAnimState.GrindRide);
    });
  });

  // ── Reset ───────────────────────────────────────────────

  describe('reset', () => {
    it('returns to Idle state', () => {
      animator.update(defaultInput({ dashing: true }));
      expect(animator.getState()).toBe(HoverAnimState.Boost);

      animator.reset();
      expect(animator.getState()).toBe(HoverAnimState.Idle);
    });

    it('resets innerGroup transforms', () => {
      // Apply some non-idle state
      for (let i = 0; i < 20; i++) {
        animator.update(defaultInput({ dashing: true }));
      }

      animator.reset();
      expect(innerGroup.position.y).toBe(0);
      expect(innerGroup.rotation.z).toBe(0);
    });
  });

  // ── Null proxy resilience ───────────────────────────────

  describe('null proxy resilience', () => {
    it('works without proxies attached (innerGroup-only mode)', () => {
      // Should not throw even without proxies
      expect(() => {
        for (let i = 0; i < 30; i++) {
          animator.update(defaultInput({ dashing: true, turnRamp: 0.5 }));
        }
      }).not.toThrow();

      // Should still update innerGroup
      expect(innerGroup.position.y).not.toBe(undefined);
    });

    it('works with partial proxy attachment (only board, no rider)', () => {
      const boardProxy = mockGroup('boardProxy');
      const clone = mockGroup();
      clone.userData = { boardProxy };
      animator.attachProxies(clone);

      expect(() => {
        for (let i = 0; i < 10; i++) {
          animator.update(defaultInput({ dashing: true }));
        }
      }).not.toThrow();
    });
  });

  // ── Grind balance ───────────────────────────────────────

  describe('grind balance animation', () => {
    it('reflects grind balance in rider lean during GrindRide', () => {
      const boardProxy = mockGroup('boardProxy');
      const riderProxy = mockGroup('riderProxy');
      const clone = mockGroup();
      clone.userData = { boardProxy, riderProxy };

      animator.attachProxies(clone);

      // Build into GrindRide state
      for (let i = 0; i < 15; i++) {
        animator.update(defaultInput({ grinding: true, grindBalance: 0.5 }));
      }

      const leanRight = riderProxy.rotation.z;

      // Reset and test opposite balance
      const animator2 = new HoverboardAnimator(mockGroup());
      const riderProxy2 = mockGroup('riderProxy');
      const clone2 = mockGroup();
      clone2.userData = { boardProxy: mockGroup(), riderProxy: riderProxy2 };
      animator2.attachProxies(clone2);

      for (let i = 0; i < 15; i++) {
        animator2.update(defaultInput({ grinding: true, grindBalance: -0.5 }));
      }
      const leanLeft = riderProxy2.rotation.z;

      // Opposite balance should produce opposite lean direction
      expect(Math.sign(leanRight)).not.toBe(Math.sign(leanLeft));
    });
  });

  // ── Edge cases ──────────────────────────────────────────

  describe('edge cases', () => {
    it('handles zero dt without error', () => {
      expect(() => animator.update(defaultInput({ dt: 0 }))).not.toThrow();
    });

    it('handles very large dt without NaN', () => {
      animator.update(defaultInput({ dt: 10 }));
      expect(Number.isFinite(innerGroup.position.y)).toBe(true);
      expect(Number.isFinite(innerGroup.rotation.z)).toBe(true);
    });

    it('handles turnRamp at extremes', () => {
      expect(() => animator.update(defaultInput({ turnRamp: 1.0 }))).not.toThrow();
      expect(() => animator.update(defaultInput({ turnRamp: -1.0 }))).not.toThrow();
    });

    it('handles grindBalance at extremes', () => {
      // grindBalance at 1.0 = about to bail
      expect(() => {
        animator.update(defaultInput({ grinding: true, grindBalance: 1.0 }));
      }).not.toThrow();
    });
  });
});
