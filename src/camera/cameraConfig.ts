// Camera configuration — absorbs module-level variables from scene.ts
// 3-layer config: hardcoded defaults → player localStorage → admin session overrides

let CAM_DIST = 30;
let CAM_HEIGHT = computeHeight(30);
let CAM_LOOK_AHEAD = 11;
let CAM_LERP = 5.0;

let BASE_FOV = 60;    // default Legacy framing

let SHAKE_ENABLED = true;

// Height: base sqrt curve + gentle vertical lift beyond default distance (~62).
// Below default: mostly flat. Beyond: camera gradually rises for overview feel.
function computeHeight(dist: number): number {
  const DEFAULT_DIST = 30;
  const base = 2.0 + Math.sqrt(dist) * 1.4;
  const overshoot = Math.max(0, dist - DEFAULT_DIST);
  const lift = overshoot * 0.12; // gentle rise: +1.2 units per 10 units beyond default
  return base + lift;
}

// ── Getters ─────────────────────────────────────────────────
// CAM_DIST is the user's preferred zoom distance (Layer A).
// Dynamic effects (speed, boost, drift) are additive on top in the rig.
export function getCAM_DIST(): number { return CAM_DIST; }
// ts-prune-ignore-next
export function getUserDist(): number { return CAM_DIST; } // explicit alias for Layer A
export function getCAM_HEIGHT(): number { return CAM_HEIGHT; }
// ts-prune-ignore-next
export function getCAM_LOOK_AHEAD(): number { return CAM_LOOK_AHEAD; }
export function getCAM_LERP(): number { return CAM_LERP; }
export function getBASE_FOV(): number { return BASE_FOV; }
export function getSHAKE_ENABLED(): boolean { return SHAKE_ENABLED; }

// ── Setters (legacy-compatible API) ─────────────────────────
export function setCameraFOV(fov: number): void {
  BASE_FOV = fov;
}

export function setCameraDist(dist: number): void {
  CAM_DIST = dist;
  CAM_HEIGHT = computeHeight(dist);
}

export function setCameraLookAhead(v: number): void { CAM_LOOK_AHEAD = v; }
export function setCameraLerp(v: number): void { CAM_LERP = v; }
export function setShakeEnabled(v: boolean): void { SHAKE_ENABLED = v; }

export function getCameraParams(): { dist: number; height: number; fov: number; lookAhead: number; lerp: number } {
  return { dist: CAM_DIST, height: CAM_HEIGHT, fov: BASE_FOV, lookAhead: CAM_LOOK_AHEAD, lerp: CAM_LERP };
}
