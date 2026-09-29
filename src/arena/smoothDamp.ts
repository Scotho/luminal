/**
 * Critically-damped spring integrator. Reaches target in ~smoothTime with
 * no overshoot. Velocity persists across calls via the VelRef carrier.
 *
 * Formula from Game Programming Gems 4, also used by Unity's SmoothDamp.
 */

export interface VelRef {
  v: number;
}

export function smoothDamp(
  current: number,
  target: number,
  velRef: VelRef,
  smoothTime: number,
  maxSpeed: number,
  dt: number,
): number {
  const smooth = Math.max(smoothTime, 1e-4);
  const omega = 2 / smooth;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  let change = current - target;
  const originalTarget = target;

  const maxChange = maxSpeed * smooth;
  change = Math.max(-maxChange, Math.min(maxChange, change));
  const clampedTarget = current - change;

  const temp = (velRef.v + omega * change) * dt;
  velRef.v = (velRef.v - omega * temp) * exp;
  let result = clampedTarget + (change + temp) * exp;

  if ((originalTarget - current > 0) === (result > originalTarget)) {
    // Snapped past the target — clamp and zero velocity.
    result = originalTarget;
    velRef.v = 0;
  }

  return result;
}

/**
 * Angle variant of smoothDamp. Wraps the diff between `current` and `target`
 * to [-π, π] before integrating so the spring always takes the short arc.
 *
 * Returns the new angle in the same unwrapped space as `current` — the
 * result is NOT clamped to [-π, π]. Callers that need a normalized angle
 * for display should renormalize via atan2(sin(a), cos(a)) or fmod.
 */
export function smoothDampAngle(
  current: number,
  target: number,
  velRef: VelRef,
  smoothTime: number,
  maxSpeed: number,
  dt: number,
): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const wrappedTarget = current + diff;
  return smoothDamp(current, wrappedTarget, velRef, smoothTime, maxSpeed, dt);
}
