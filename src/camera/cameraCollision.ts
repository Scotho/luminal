import * as THREE from 'three';

// Camera collision avoidance — multi-ray sweep from pivot to desired boom position.
// If obstructed, shorten boom to stay in front of the obstacle.
// If distance would be crushed below 30%, raise camera height instead.

let _collisionMeshes: THREE.Mesh[] = [];
const _raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _hits: THREE.Intersection[] = [];
const _offDir = new THREE.Vector3();
const _offOrigin = new THREE.Vector3();
const _offHits: THREE.Intersection[] = [];

// Collision tuning
let COLLISION_BUFFER = 0.15;   // push camera off obstacle by this margin
let MIN_CAMERA_DIST = 0.5;    // minimum boom distance
let SWEEP_RADIUS = 0.8;       // ~0.15L — offset for multi-ray sweep
let CRUSH_THRESHOLD = 0.3;    // raise camera if distance crushed below this fraction

export function getCollisionTuning() {
  return { COLLISION_BUFFER, MIN_CAMERA_DIST, SWEEP_RADIUS, CRUSH_THRESHOLD };
}
export function setCollisionTuning(key: string, val: number): void {
  switch (key) {
    case 'COLLISION_BUFFER': COLLISION_BUFFER = val; break;
    case 'MIN_CAMERA_DIST': MIN_CAMERA_DIST = val; break;
    case 'SWEEP_RADIUS': SWEEP_RADIUS = val; break;
    case 'CRUSH_THRESHOLD': CRUSH_THRESHOLD = val; break;
  }
}

export function setCameraCollisionMeshes(meshes: THREE.Mesh[]): void {
  _collisionMeshes = meshes;
}

export function getCameraCollisionMeshes(): THREE.Mesh[] {
  return _collisionMeshes;
}

/** Single ray helper — returns hit distance or Infinity. */
function rayCheck(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
  _raycaster.set(origin, dir);
  _raycaster.near = 0;
  _raycaster.far = maxDist;
  _offHits.length = 0;
  _raycaster.intersectObjects(_collisionMeshes, false, _offHits);
  return _offHits.length > 0 ? _offHits[0].distance : Infinity;
}

/**
 * Multi-ray collision check from pivot to desired camera position.
 * Uses 3 rays (center + up offset + right offset) for approximate sphere sweep.
 * Returns corrected position in `out` and occlusion push factor (0..1).
 */
export function resolveCameraCollision(
  pivotPos: THREE.Vector3,
  desiredPos: THREE.Vector3,
  out: THREE.Vector3,
): number {
  out.copy(desiredPos);

  if (_collisionMeshes.length === 0) return 0;

  _dir.subVectors(desiredPos, pivotPos);
  const maxDist = _dir.length();
  if (maxDist < 1e-4) return 0;
  _dir.divideScalar(maxDist); // normalize

  // Ray 1: center ray
  _raycaster.set(pivotPos, _dir);
  _raycaster.near = 0;
  _raycaster.far = maxDist;
  _hits.length = 0;
  _raycaster.intersectObjects(_collisionMeshes, false, _hits);
  let closestDist = _hits.length > 0 ? _hits[0].distance : Infinity;

  // Ray 2: offset upward (catches low overhangs)
  _offOrigin.copy(pivotPos).y += SWEEP_RADIUS;
  const upHit = rayCheck(_offOrigin, _dir, maxDist);
  if (upHit < closestDist) closestDist = upHit;

  // Ray 3: offset right (catches side walls)
  // right = cross(dir, up) — perpendicular in horizontal plane
  _offDir.set(-_dir.z, 0, _dir.x); // simplified cross with Y-up
  const rLen = _offDir.length();
  if (rLen > 0.001) {
    _offDir.divideScalar(rLen);
    _offOrigin.copy(pivotPos).addScaledVector(_offDir, SWEEP_RADIUS);
    const sideHit = rayCheck(_offOrigin, _dir, maxDist);
    if (sideHit < closestDist) closestDist = sideHit;
  }

  if (closestDist < maxDist) {
    let correctedDist = closestDist - COLLISION_BUFFER;
    correctedDist = Math.max(correctedDist, MIN_CAMERA_DIST);
    correctedDist = Math.min(correctedDist, maxDist);

    // Height raise fallback: if distance is crushed below threshold, raise camera
    const crushLimit = maxDist * CRUSH_THRESHOLD;
    if (correctedDist < crushLimit) {
      out.copy(pivotPos).addScaledVector(_dir, crushLimit);
      out.y += (crushLimit - correctedDist) * 0.5;
    } else {
      out.copy(pivotPos).addScaledVector(_dir, correctedDist);
    }

    return 1 - correctedDist / maxDist;
  }

  return 0;
}
