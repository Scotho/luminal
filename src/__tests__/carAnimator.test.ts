import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CarAnimator, CarAnimState } from '../carAnimator';
import type { CarAnimInput } from '../carAnimator';

function makeInput(overrides: Partial<CarAnimInput> = {}): CarAnimInput {
  return {
    dt: 0.016, speed: 45, baseSpeed: 45, boosting: false, dashing: false,
    turnRamp: 0, brakeBlend: 0, drifting: false, driftDirection: 0,
    airborne: false, airborneTimer: 0, airborneDuration: 0.3, airbornePeak: 0,
    ...overrides,
  };
}

function createAnimator(): { animator: CarAnimator; inner: THREE.Group } {
  const inner = new THREE.Group();
  const animator = new CarAnimator(inner);
  return { animator, inner };
}

describe('CarAnimator', () => {
  it('idles with subtle body sway', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) animator.update(makeInput());
    expect(inner.rotation.x).not.toBe(0);
  });

  it('rolls body into turns', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) animator.update(makeInput({ turnRamp: 0.8 }));
    expect(inner.rotation.z).not.toBe(0);
  });

  it('pitches forward on acceleration', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) animator.update(makeInput({ boosting: true }));
    expect(inner.rotation.x).toBeLessThan(0);
  });

  it('pitches more on boost/dash than accel', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) animator.update(makeInput({ dashing: true }));
    expect(inner.rotation.x).toBeLessThan(-0.05);
  });

  it('rolls during drift', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) {
      animator.update(makeInput({ drifting: true, driftDirection: 1, turnRamp: 0.7 }));
    }
    expect(inner.rotation.z).not.toBe(0);
  });

  it('elevates during airborne', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 30; i++) {
      animator.update(makeInput({ airborne: true, airbornePeak: 2.0, airborneTimer: 0.15, airborneDuration: 0.3 }));
    }
    expect(inner.position.y).toBeGreaterThan(0);
  });

  it('resolves Idle state with no input', () => {
    const { animator } = createAnimator();
    animator.update(makeInput());
    expect(animator.getState()).toBe(CarAnimState.Idle);
  });

  it('resolves Accel when boosting', () => {
    const { animator } = createAnimator();
    animator.update(makeInput({ boosting: true }));
    expect(animator.getState()).toBe(CarAnimState.Accel);
  });

  it('resolves Boost when dashing', () => {
    const { animator } = createAnimator();
    animator.update(makeInput({ dashing: true }));
    expect(animator.getState()).toBe(CarAnimState.Boost);
  });

  it('resolves Drift when drifting', () => {
    const { animator } = createAnimator();
    animator.update(makeInput({ drifting: true, driftDirection: 1 }));
    expect(animator.getState()).toBe(CarAnimState.Drift);
  });

  it('resolves Airborne when airborne', () => {
    const { animator } = createAnimator();
    animator.update(makeInput({ airborne: true, airbornePeak: 1.0 }));
    expect(animator.getState()).toBe(CarAnimState.Airborne);
  });

  it('resolves Brake when braking', () => {
    const { animator } = createAnimator();
    animator.update(makeInput({ brakeBlend: 0.5 }));
    expect(animator.getState()).toBe(CarAnimState.Brake);
  });

  it('prioritizes Airborne over Drift', () => {
    const { animator } = createAnimator();
    animator.update(makeInput({ airborne: true, airbornePeak: 1.0, drifting: true, driftDirection: 1 }));
    expect(animator.getState()).toBe(CarAnimState.Airborne);
  });

  it('resets to default', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) animator.update(makeInput({ dashing: true }));
    animator.reset();
    expect(inner.rotation.x).toBe(0);
    expect(inner.position.y).toBe(0);
    expect(animator.getState()).toBe(CarAnimState.Idle);
  });

  it('idle state produces non-zero innerY (bob)', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 120; i++) {
      animator.update(makeInput());
    }
    expect(inner.position.y).not.toBe(0);
  });

  it('idle state produces non-zero roll (sway)', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 120; i++) {
      animator.update(makeInput());
    }
    expect(inner.rotation.z).not.toBe(0);
  });
});
