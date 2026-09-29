// ── Procedural rider bone animation ───────────────────────
// Skate/snowboard-style body movement layered on top of the rigid proxy
// poses in hoverboardAnimator.ts. Finds Mixamo bones by name, captures
// their rest rotations once, then lerps each bone toward state-driven
// target offsets every frame.

import * as THREE from 'three';
import { HoverAnimState } from './hoverboardAnimator';
import type { HoverAnimInput } from './hoverboardAnimator';

/** Mixamo rider bones — any may be null if the model lacks that joint. */
export interface RiderBones {
  spine: THREE.Bone | null;
  spine1: THREE.Bone | null;
  spine2: THREE.Bone | null;
  head: THREE.Bone | null;
  leftArm: THREE.Bone | null;
  leftForeArm: THREE.Bone | null;
  rightArm: THREE.Bone | null;
  rightForeArm: THREE.Bone | null;
  leftUpLeg: THREE.Bone | null;
  rightUpLeg: THREE.Bone | null;
  leftLeg: THREE.Bone | null;
  rightLeg: THREE.Bone | null;
}

export function emptyRiderBones(): RiderBones {
  return {
    spine: null, spine1: null, spine2: null, head: null,
    leftArm: null, leftForeArm: null, rightArm: null, rightForeArm: null,
    leftUpLeg: null, rightUpLeg: null, leftLeg: null, rightLeg: null,
  };
}

export function findRiderBones(root: THREE.Object3D): RiderBones {
  const bones = emptyRiderBones();
  root.traverse((obj: THREE.Object3D) => {
    if (!(obj as THREE.Bone).isBone) return;
    const n = obj.name;
    const b = obj as THREE.Bone;
    if (n.startsWith('mixamorigSpine_')) bones.spine = b;
    else if (n.startsWith('mixamorigSpine1_')) bones.spine1 = b;
    else if (n.startsWith('mixamorigSpine2_')) bones.spine2 = b;
    else if (n.startsWith('mixamorigHead_') && !n.includes('Top')) bones.head = b;
    else if (n.startsWith('mixamorigLeftArm_')) bones.leftArm = b;
    else if (n.startsWith('mixamorigLeftForeArm_')) bones.leftForeArm = b;
    else if (n.startsWith('mixamorigRightArm_')) bones.rightArm = b;
    else if (n.startsWith('mixamorigRightForeArm_')) bones.rightForeArm = b;
    else if (n.startsWith('mixamorigLeftUpLeg_')) bones.leftUpLeg = b;
    else if (n.startsWith('mixamorigRightUpLeg_')) bones.rightUpLeg = b;
    else if (n.startsWith('mixamorigLeftLeg_') && !n.includes('Up')) bones.leftLeg = b;
    else if (n.startsWith('mixamorigRightLeg_') && !n.includes('Up')) bones.rightLeg = b;
  });
  return bones;
}

export function captureRestRotations(bones: RiderBones): Map<THREE.Bone, THREE.Euler> {
  const map = new Map<THREE.Bone, THREE.Euler>();
  for (const bone of Object.values(bones)) {
    if (bone) map.set(bone, bone.rotation.clone());
  }
  return map;
}

/** Per-bone target offsets (deltas from rest rotation, in radians). */
export interface BoneTargets {
  spineX: number; spineY: number; spineZ: number;
  headX: number; headY: number; headZ: number;
  lArmX: number; lArmY: number; lArmZ: number;
  rArmX: number; rArmY: number; rArmZ: number;
  lFAX: number; lFAY: number; lFAZ: number;
  rFAX: number; rFAY: number; rFAZ: number;
  lLegX: number; rLegX: number;
  lShinX: number; rShinX: number;
}

export function defaultBoneTargets(): BoneTargets {
  return {
    spineX: 0, spineY: 0, spineZ: 0,
    headX: 0, headY: 0, headZ: 0,
    lArmX: 0, lArmY: 0, lArmZ: 0,
    rArmX: 0, rArmY: 0, rArmZ: 0,
    lFAX: 0, lFAY: 0, lFAZ: 0,
    rFAX: 0, rFAY: 0, rFAZ: 0,
    lLegX: 0, rLegX: 0,
    lShinX: 0, rShinX: 0,
  };
}

function zeroTargets(o: BoneTargets): void {
  o.spineX = 0; o.spineY = 0; o.spineZ = 0;
  o.headX = 0; o.headY = 0; o.headZ = 0;
  o.lArmX = 0; o.lArmY = 0; o.lArmZ = 0;
  o.rArmX = 0; o.rArmY = 0; o.rArmZ = 0;
  o.lFAX = 0; o.lFAY = 0; o.lFAZ = 0;
  o.rFAX = 0; o.rFAY = 0; o.rFAZ = 0;
  o.lLegX = 0; o.rLegX = 0;
  o.lShinX = 0; o.rShinX = 0;
}

/**
 * Writes state-driven bone offsets into `out` (in-place, no allocation).
 * Offsets are deltas from rest in radians; applyBoneTargets adds them to
 * each bone's cached rest rotation and lerps toward the result.
 */
export function computeBoneTargets(
  out: BoneTargets, state: HoverAnimState, input: HoverAnimInput, time: number,
): void {
  zeroTargets(out);
  const t = time * 0.001;
  const turn = input.turnRamp;

  switch (state) {
    case HoverAnimState.Idle: {
      // Surfer weight-shift: gentle hip sway + shoulder counter + head scan
      const sway = Math.sin(t * 1.2) * 0.05;
      const bob = Math.sin(t * 0.9) * 0.03;
      out.spineZ = sway;
      out.spineY = Math.sin(t * 0.7) * 0.06;
      out.headY = Math.sin(t * 0.6) * 0.10;
      out.headX = Math.sin(t * 0.5) * 0.05;
      out.lArmZ = 0.15 + sway * 0.8;
      out.rArmZ = -0.15 + sway * 0.8;
      out.lFAY = 0.10 + bob;
      out.rFAY = -0.10 - bob;
      break;
    }
    case HoverAnimState.Accel: {
      // Forward commit: shoulders drop, arms swing back, knees bend.
      out.spineX = -0.18;
      out.lArmX = 0.35;
      out.rArmX = 0.35;
      out.lArmZ = 0.28;
      out.rArmZ = -0.28;
      out.lFAY = 0.70;
      out.rFAY = -0.70;
      out.headX = -0.18;
      out.lLegX = -0.14;
      out.rLegX = -0.14;
      out.lShinX = 0.28;
      out.rShinX = 0.28;
      break;
    }
    case HoverAnimState.Boost: {
      // Deep tuck: chest to knees, arms pinned back.
      out.spineX = -0.32;
      out.lArmX = 0.55;
      out.rArmX = 0.55;
      out.lArmZ = 0.18;
      out.rArmZ = -0.18;
      out.lFAY = 1.20;
      out.rFAY = -1.20;
      out.headX = -0.28;
      out.lLegX = -0.28;
      out.rLegX = -0.28;
      out.lShinX = 0.55;
      out.rShinX = 0.55;
      break;
    }
    case HoverAnimState.Turn: {
      // Carve: shoulders rotate into the turn, opposite arm extends.
      out.spineY = turn * 0.28;
      out.spineZ = -turn * 0.12;
      out.lArmZ = 0.22 + turn * 0.38;
      out.rArmZ = -0.22 + turn * 0.38;
      out.headY = turn * 0.18;
      out.headX = -0.05;
      out.lFAY = 0.15 + turn * 0.25;
      out.rFAY = -0.15 + turn * 0.25;
      break;
    }
    case HoverAnimState.BoardGrab: {
      // Deep crouch, outside arm reaches down to grab the deck.
      const side = turn >= 0 ? 1 : -1;
      out.spineX = -0.40;
      out.spineY = side * 0.20;
      if (side > 0) {
        out.rArmX = -1.45;
        out.rArmZ = -0.85;
        out.rFAY = -1.65;
        out.lArmX = 0.25;
        out.lArmZ = 0.45;
        out.lFAY = 0.50;
      } else {
        out.lArmX = -1.45;
        out.lArmZ = 0.85;
        out.lFAY = 1.65;
        out.rArmX = 0.25;
        out.rArmZ = -0.45;
        out.rFAY = -0.50;
      }
      out.headX = -0.28;
      out.lLegX = -0.35;
      out.rLegX = -0.35;
      out.lShinX = 0.60;
      out.rShinX = 0.60;
      break;
    }
    case HoverAnimState.GrindEntry:
    case HoverAnimState.GrindRide: {
      // Wide-arm balance crouch with micro wobble + balance-driven lean.
      out.spineX = -0.22;
      out.spineZ = input.grindBalance * 0.12 + Math.sin(t * 1.8) * 0.03;
      out.lArmX = -0.05;
      out.lArmZ = 1.00;
      out.rArmX = -0.05;
      out.rArmZ = -1.00;
      out.lFAY = 0.25 + Math.sin(t * 1.7) * 0.06;
      out.rFAY = -0.25 - Math.sin(t * 1.7) * 0.06;
      out.headX = -0.10;
      out.headY = input.grindBalance * 0.22;
      out.lLegX = -0.24;
      out.rLegX = -0.24;
      out.lShinX = 0.42;
      out.rShinX = 0.42;
      break;
    }
    case HoverAnimState.GrindExit: {
      // Pop-up from crouch, arms coming in.
      out.spineX = -0.08;
      out.lArmZ = 0.55;
      out.rArmZ = -0.55;
      out.lFAY = 0.18;
      out.rFAY = -0.18;
      out.lLegX = -0.08;
      out.rLegX = -0.08;
      break;
    }
    case HoverAnimState.Airborne: {
      // Skater indy grab: knees tucked high, arms extended forward.
      out.spineX = -0.22;
      out.lArmX = -0.60;
      out.lArmZ = 0.42;
      out.rArmX = -0.60;
      out.rArmZ = -0.42;
      out.lFAY = 1.05;
      out.rFAY = -1.05;
      out.lLegX = -0.70;
      out.rLegX = -0.70;
      out.lShinX = 1.00;
      out.rShinX = 1.00;
      out.headX = -0.18;
      // Subtle spin twist into roll direction
      out.spineY = -turn * 0.22;
      break;
    }
    case HoverAnimState.Recovery: {
      // Shake it off: rise up, arms wipe across body.
      out.spineX = 0.05;
      const wipe = Math.sin(t * 3.5) * 0.30;
      out.lArmX = -0.20 + wipe;
      out.rArmX = -0.20 - wipe;
      out.lArmZ = 0.32;
      out.rArmZ = -0.32;
      out.lFAY = 0.40;
      out.rFAY = -0.40;
      out.headX = 0.05;
      break;
    }
    case HoverAnimState.Bail: {
      // Chaotic flail — arms, legs, spine, head all desynced.
      out.lArmX = Math.sin(t * 12) * 1.10;
      out.lArmZ = 0.55 + Math.sin(t * 11) * 0.65;
      out.rArmX = Math.sin(t * 13 + 1) * 1.10;
      out.rArmZ = -0.55 + Math.sin(t * 10 + 1) * 0.65;
      out.lFAY = Math.sin(t * 14) * 0.90;
      out.rFAY = Math.sin(t * 15) * 0.90;
      out.spineX = Math.sin(t * 8) * 0.35;
      out.spineZ = Math.sin(t * 7) * 0.32;
      out.spineY = Math.sin(t * 9) * 0.30;
      out.headX = Math.sin(t * 9) * 0.45;
      out.headY = Math.sin(t * 11) * 0.45;
      out.lLegX = Math.sin(t * 10) * 0.55;
      out.rLegX = Math.sin(t * 9) * 0.55;
      out.lShinX = 0.5 + Math.sin(t * 13) * 0.35;
      out.rShinX = 0.5 + Math.sin(t * 12) * 0.35;
      break;
    }
  }
}

/** Lerp each bone toward (rest + target delta) with factor k (0..1). */
export function applyBoneTargets(
  bones: RiderBones,
  rest: Map<THREE.Bone, THREE.Euler>,
  t: BoneTargets,
  k: number,
): void {
  // Distribute spine bend across all three segments for a smoother curve.
  const frac = 1 / 3;
  rotateBone(bones.spine, rest, t.spineX * frac, t.spineY * frac, t.spineZ * frac, k);
  rotateBone(bones.spine1, rest, t.spineX * frac, t.spineY * frac, t.spineZ * frac, k);
  rotateBone(bones.spine2, rest, t.spineX * frac, t.spineY * frac, t.spineZ * frac, k);
  rotateBone(bones.head, rest, t.headX, t.headY, t.headZ, k);
  rotateBone(bones.leftArm, rest, t.lArmX, t.lArmY, t.lArmZ, k);
  rotateBone(bones.rightArm, rest, t.rArmX, t.rArmY, t.rArmZ, k);
  rotateBone(bones.leftForeArm, rest, t.lFAX, t.lFAY, t.lFAZ, k);
  rotateBone(bones.rightForeArm, rest, t.rFAX, t.rFAY, t.rFAZ, k);
  rotateBone(bones.leftUpLeg, rest, t.lLegX, 0, 0, k);
  rotateBone(bones.rightUpLeg, rest, t.rLegX, 0, 0, k);
  rotateBone(bones.leftLeg, rest, t.lShinX, 0, 0, k);
  rotateBone(bones.rightLeg, rest, t.rShinX, 0, 0, k);
}

function rotateBone(
  bone: THREE.Bone | null,
  rest: Map<THREE.Bone, THREE.Euler>,
  dx: number, dy: number, dz: number, k: number,
): void {
  if (!bone) return;
  const r = rest.get(bone);
  if (!r) return;
  const tx = r.x + dx, ty = r.y + dy, tz = r.z + dz;
  bone.rotation.x += (tx - bone.rotation.x) * k;
  bone.rotation.y += (ty - bone.rotation.y) * k;
  bone.rotation.z += (tz - bone.rotation.z) * k;
}
