// ── playerVFXUtil.ts ──────────────────────────────────────
// Shared predicates used by playerVFX.ts and its extracted helper
// modules. Kept in a separate file to avoid circular imports between
// the orchestrator (playerVFX.ts) and the per-effect helpers.

import type * as THREE from 'three';

export function hasFiniteTrackPose(pos: THREE.Vector3, angle: number): boolean {
  return Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z) && Number.isFinite(angle);
}
