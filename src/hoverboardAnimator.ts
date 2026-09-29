import * as THREE from 'three';
import {
  AnimPose,
  POSE_KEYS,
  LERP_RATES,
  GRIND_ENTRY_DURATION,
  GRIND_EXIT_DURATION,
  defaultPose,
  poseIdle,
  poseAccel,
  poseBoost,
  poseTurn,
  poseBoardGrab,
  poseGrindEntry,
  poseGrindRide,
  poseGrindExit,
  poseAirborne,
  poseRecovery,
  poseBail,
} from './hoverboardPoses';
import {
  RiderBones,
  BoneTargets,
  emptyRiderBones,
  findRiderBones,
  captureRestRotations,
  defaultBoneTargets,
  computeBoneTargets,
  applyBoneTargets,
} from './hoverboardBoneAnim';

// Permanent downward nudge for the rider proxy — the baked GLB rig has the
// back foot hovering slightly above the deck. This negative offset sinks the
// rear foot onto the board; the front foot compresses imperceptibly.
const RIDER_BASE_OFFSET_Y = -0.045;

// ── Public types ────────────────────────────────────────

export enum HoverAnimState {
  Idle,
  Accel,
  Boost,
  Turn,
  BoardGrab,
  GrindEntry,
  GrindRide,
  GrindExit,
  Airborne,
  Recovery,
  Bail,
}

/** Per-frame snapshot of physics state fed into the animator. */
export interface HoverAnimInput {
  dt: number;
  speed: number;
  baseSpeed: number;
  boosting: boolean;
  dashing: boolean;
  turnRamp: number;        // -1..+1 smoothed turn intensity
  brakeBlend: number;      // 0..1
  grinding: boolean;
  grindBalance: number;    // -1..+1
  airborne: boolean;
  airborneTimer: number;
  airborneDuration: number;
  airbornePeak: number;
  recovery: boolean;
  landingPenalty: boolean;
}

// ── Animator class ─────────────────────────────────────

export class HoverboardAnimator {
  private _state: HoverAnimState = HoverAnimState.Idle;
  private _innerGroup: THREE.Group;
  private _boardProxy: THREE.Group | null = null;
  private _riderProxy: THREE.Group | null = null;

  // Grind entry/exit tracking
  private _grindTimer = 0;
  private _wasGrinding = false;
  private _exitTimer = 0;
  private _isExiting = false;

  // Recovery tracking
  private _recoveryStartTime = 0;
  private _recoveryDuration = 700; // ms

  // Pre-allocated pose buffers (avoids per-frame allocation)
  private _pose: AnimPose = defaultPose();
  private _target: AnimPose = defaultPose();

  // Procedural rider bone animation
  private _bones: RiderBones = emptyRiderBones();
  private _restBoneRotations: Map<THREE.Bone, THREE.Euler> = new Map();
  private _boneTarget: BoneTargets = defaultBoneTargets();

  constructor(innerGroup: THREE.Group) {
    this._innerGroup = innerGroup;
  }

  /** Attach board/rider proxy groups after model clone is ready. */
  attachProxies(hoverClone: THREE.Group): void {
    this._boardProxy = (hoverClone.userData.boardProxy as THREE.Group) ?? null;
    this._riderProxy = (hoverClone.userData.riderProxy as THREE.Group) ?? null;

    // Procedural skate-style bone animation: find Mixamo rider bones and
    // snapshot their rest rotations so we can layer small deltas on top.
    // (Baked clips remain disabled — they bake the π facing rotation into
    // bone quaternions and break orientation when played via AnimationMixer.)
    this._bones = findRiderBones(hoverClone);
    this._restBoneRotations = captureRestRotations(this._bones);
  }

  getState(): HoverAnimState {
    return this._state;
  }

  reset(): void {
    this._state = HoverAnimState.Idle;
    this._grindTimer = 0;
    this._wasGrinding = false;
    this._exitTimer = 0;
    this._isExiting = false;
    this._recoveryStartTime = 0;
    this._pose = defaultPose();
    this._applyPose();
  }

  update(input: HoverAnimInput): void {
    const { dt } = input;
    const time = performance.now();

    // Track grind entry/exit transitions (before state resolution so _isExiting is current)
    if (input.grinding && !this._wasGrinding) {
      this._grindTimer = 0;
    }
    if (input.grinding) {
      this._grindTimer += dt;
    }
    if (this._wasGrinding && !input.grinding && !input.airborne) {
      this._isExiting = true;
      this._exitTimer = 0;
    }
    if (this._isExiting) {
      this._exitTimer += dt;
      if (this._exitTimer >= GRIND_EXIT_DURATION) {
        this._isExiting = false;
      }
    }
    this._wasGrinding = input.grinding;

    // ── Resolve state ──
    const prevState = this._state;
    this._state = this._resolveState(input);

    if (this._state === HoverAnimState.Recovery && prevState !== HoverAnimState.Recovery) {
      this._recoveryStartTime = time;
    }

    // ── Compute target pose (writes into pre-allocated _target) ──
    this._computeTargetPose(input, time);

    // ── Blend toward target ──
    for (let i = 0; i < POSE_KEYS.length; i++) {
      const key = POSE_KEYS[i];
      const blend = 1 - Math.exp(-LERP_RATES[key] * dt);
      this._pose[key] += (this._target[key] - this._pose[key]) * blend;
    }

    this._applyPose();

    // Procedural bone animation — layered on top of rigid proxy pose.
    computeBoneTargets(this._boneTarget, this._state, input, time);
    const boneBlend = 1 - Math.exp(-12 * dt);
    applyBoneTargets(this._bones, this._restBoneRotations, this._boneTarget, boneBlend);
  }

  /** Determine animation state from physics input. */
  private _resolveState(input: HoverAnimInput): HoverAnimState {
    if (input.landingPenalty && input.airborne) return HoverAnimState.Bail;
    if (input.airborne) return HoverAnimState.Airborne;

    if (input.grinding) {
      if (this._grindTimer < GRIND_ENTRY_DURATION) return HoverAnimState.GrindEntry;
      return HoverAnimState.GrindRide;
    }

    if (this._isExiting) return HoverAnimState.GrindExit;
    if (input.recovery) return HoverAnimState.Recovery;
    if (input.dashing) return HoverAnimState.Boost;
    if (input.boosting) return HoverAnimState.Accel;

    const absTurn = Math.abs(input.turnRamp);
    if (absTurn > 0.75 && input.speed > input.baseSpeed * 0.8) return HoverAnimState.BoardGrab;
    if (absTurn > 0.1) return HoverAnimState.Turn;

    return HoverAnimState.Idle;
  }

  /** Write target pose into this._target (no allocation). */
  private _computeTargetPose(input: HoverAnimInput, time: number): void {
    const out = this._target;

    switch (this._state) {
      case HoverAnimState.Idle:
        poseIdle(out, time);
        break;
      case HoverAnimState.Accel:
        poseAccel(out, time);
        break;
      case HoverAnimState.Boost:
        poseBoost(out, time);
        break;
      case HoverAnimState.Turn:
        poseTurn(out, input.turnRamp);
        break;
      case HoverAnimState.BoardGrab:
        poseBoardGrab(out, input.turnRamp);
        break;
      case HoverAnimState.GrindEntry:
        poseGrindEntry(out, Math.min(1, this._grindTimer / GRIND_ENTRY_DURATION), input.grindBalance);
        break;
      case HoverAnimState.GrindRide:
        poseGrindRide(out, input.grindBalance);
        break;
      case HoverAnimState.GrindExit:
        poseGrindExit(out, Math.min(1, this._exitTimer / GRIND_EXIT_DURATION), input.turnRamp);
        break;
      case HoverAnimState.Airborne:
        poseAirborne(out, input.airborneTimer, input.airborneDuration, input.airbornePeak, input.turnRamp, time);
        break;
      case HoverAnimState.Recovery: {
        const elapsed = time - this._recoveryStartTime;
        poseRecovery(out, Math.min(1, elapsed / this._recoveryDuration));
        break;
      }
      case HoverAnimState.Bail:
        poseBail(out, input.airborneTimer, input.airborneDuration, input.airbornePeak, time);
        break;
    }
  }

  private _applyPose(): void {
    const p = this._pose;

    this._innerGroup.position.y = p.innerY + p.grindLift;
    this._innerGroup.rotation.z = p.innerRollZ;

    if (this._boardProxy) {
      this._boardProxy.rotation.x = p.boardPitchX;
      this._boardProxy.rotation.z = p.boardRollZ;
    }

    if (this._riderProxy) {
      this._riderProxy.rotation.x = p.riderPitchX;
      this._riderProxy.rotation.z = p.riderRollZ;
      this._riderProxy.scale.y = p.riderScaleY;
      this._riderProxy.position.y = p.riderOffsetY + RIDER_BASE_OFFSET_Y;
    }
  }
}
