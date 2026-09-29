import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BikeAnimator, BikeAnimState } from '../bikeAnimator';
import type { BikeAnimInput } from '../bikeAnimator';

function makeInput(overrides: Partial<BikeAnimInput> = {}): BikeAnimInput {
  return {
    dt: 0.016, speed: 45, baseSpeed: 45, boosting: false, dashing: false,
    turnRamp: 0, brakeBlend: 0,
    ...overrides,
  };
}

function createAnimator(): { animator: BikeAnimator; inner: THREE.Group } {
  const inner = new THREE.Group();
  const animator = new BikeAnimator(inner);
  return { animator, inner };
}

describe('BikeAnimator', () => {
  it('idles with subtle bob', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) animator.update(makeInput());
    expect(inner.position.y).not.toBe(0);
  });

  it('leans into turns', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) animator.update(makeInput({ turnRamp: 0.8 }));
    expect(inner.rotation.z).not.toBe(0);
    expect(Math.abs(inner.rotation.z)).toBeGreaterThan(0.1);
  });

  it('pitches forward on acceleration', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) animator.update(makeInput({ boosting: true }));
    expect(inner.rotation.x).toBeLessThan(0);
  });

  it('pitches more aggressively on boost/dash', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) animator.update(makeInput({ dashing: true }));
    expect(inner.rotation.x).toBeLessThan(-0.12);
    expect(inner.position.y).toBeLessThan(0);
  });

  it('resolves Idle state with no input', () => {
    const { animator } = createAnimator();
    animator.update(makeInput());
    expect(animator.getState()).toBe(BikeAnimState.Idle);
  });

  it('resolves Accel when boosting', () => {
    const { animator } = createAnimator();
    animator.update(makeInput({ boosting: true }));
    expect(animator.getState()).toBe(BikeAnimState.Accel);
  });

  it('resolves Boost when dashing', () => {
    const { animator } = createAnimator();
    animator.update(makeInput({ dashing: true }));
    expect(animator.getState()).toBe(BikeAnimState.Boost);
  });

  it('resolves Turn when turnRamp > 0.1', () => {
    const { animator } = createAnimator();
    animator.update(makeInput({ turnRamp: 0.5 }));
    expect(animator.getState()).toBe(BikeAnimState.Turn);
  });

  it('resolves Brake when braking', () => {
    const { animator } = createAnimator();
    animator.update(makeInput({ brakeBlend: 0.5 }));
    expect(animator.getState()).toBe(BikeAnimState.Brake);
  });

  it('resets to default pose', () => {
    const { animator, inner } = createAnimator();
    for (let i = 0; i < 60; i++) animator.update(makeInput({ dashing: true }));
    animator.reset();
    expect(inner.rotation.x).toBe(0);
    expect(inner.rotation.z).toBe(0);
    expect(inner.position.y).toBe(0);
  });
});
