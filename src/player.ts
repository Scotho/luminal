import * as THREE from 'three';
import type { VehicleType } from './types/index';
import { Trail } from './trail';
import { getGfx } from './graphics';
import { grid } from './spatialGrid';
import { getVehiclePhysics, type VehiclePhysics } from './vehicleConfig';
import { createPlayerSim, type PlayerSim, type SimState } from './core/simulation';
import { SparkEmitter } from './vfx/grindSparks';
import { GrindHUD } from './ui/grindHUD';
import { GrindComboHUD } from './ui/grindComboHUD';
import { GrindBustOverlay } from './ui/grindBustOverlay';
import { GrindAvailabilityHint } from './ui/grindAvailabilityHint';
import { HoverboardAnimator, type HoverAnimInput } from './hoverboardAnimator';
import { BikeAnimator, type BikeAnimInput } from './bikeAnimator';
import { CarAnimator, type CarAnimInput } from './carAnimator';
import { TireStreakSystem } from './effects/tireStreaks';
import { computeVehicleVisibilityBoost } from './emissiveUtils';
import {
  type GroundFXSystem, type ElectricArcSystem, type SpeedLineSystem, type SnapSmokeFX,
  _deathMat,
  buildBike, buildCar, buildHoverboard,
  createGroundFX,
  createElectricArcs,
  createSpeedLines,
  createSnapSmoke,
} from './playerVFX';
import { stepCarInlinePhysics, stepSimPhysics } from './playerPhysics';
import {
  applyLeanAndAnimatorUpdate, fillHoverAnimInput, updateGrindRender,
  updateLightsAndFXUpdate, updateTrail,
} from './playerRender';
import { applySimState as applySimStateHelper, courseCorrect as courseCorrectHelper } from './playerState';
import { destroyPlayer, killPlayer, updatePlayerDeath } from './playerLifecycle';
import { enableReflection } from './renderLayers';

// Admin panel overrides — when set, player update() skips writing these values
export const adminOverrides: Record<string, number | null> = {
  engineGlow: null,
  bikeLight: null,
  underGlow: null,
};

const METER_MAX = 100;
const METER_RECHARGE_MAX = 104; // reduced 20% from 130
const METER_PASSIVE_REGEN = 5.3;
const RECHARGE_RANGE = 10;

// ── Tunable assist constants (admin panel) ───────────────
export const assistTuning = {
  range: 10,
  strength: 0.35,
  angleMax: 0.4,
};

interface PlayerConstructorOpts {
  color: number;
  emissive: number;
  startX: number;
  startZ: number;
  startAngle: number;
  isAI?: boolean;
  vehicleType?: VehicleType;
}

// ── Player Class ──────────────────────────────────────────
// NOTE ON VISIBILITY: Underscore-prefixed fields are treated as package-internal
// (accessed by playerPhysics/playerRender/playerState helper modules). They are
// not part of the public API — external callers should continue to use the
// public methods and getters defined below.
export class Player {
  // Public render/gameplay state
  scene: THREE.Scene;
  isAI: boolean;
  alive = true;
  speed: number;
  angle: number;
  boosting = false;
  dashing = false;
  wBoosting = false;
  driftBoosting = false;  // W-boost active during drift (for camera zoom)
  drifting = false;       // true while in drift state (for HUD/camera)
  velocityAngle: number;  // direction of travel (for camera drift heading blend)
  slipAngle = 0;          // angle between heading and velocity (for camera slip-proportional blend)
  meter = METER_MAX;
  colorHex: number;
  proximitySpeedBoost = 0; // 0-1, set externally by game
  currentLean = 0;
  mesh: THREE.Group;
  trail: Trail;
  trailTimer = 0;
  color: number;
  engineGlow: THREE.Mesh;
  bikeLight: THREE.PointLight | null;
  underGlow: THREE.PointLight | null;
  proximityAura: THREE.PointLight | null;
  deathParticles: THREE.Points;
  deathTime = 0;
  meterGaining = false;
  boostLocked = false;
  vehicleType: VehicleType;
  fumes = false;
  sputterSFX = false;
  /** Segment indices queued for fade-destroy this frame (local/offline mode only). Cleared each update(). */
  pendingGrindDestroys: number[] = [];
  /** Trail owner index for this frame's grind destroy queue (-1 if not grinding). */
  lastGrindTrailOwner: number = -1;

  // Internal (package-visible) fields — accessed by playerPhysics / playerRender / playerState
  _vehicleLightBoost: number;
  _vehicleUnderglowBoost: number;
  _vCfg: VehiclePhysics;
  _smoothTurnDir = 0;
  _innerGroup: THREE.Group;
  _beam: THREE.SpotLight | null;
  _flashLight: THREE.PointLight;
  _deathMat: THREE.PointsMaterial;
  _debrisCount: number;
  _dvx: Float32Array;
  _dvy: Float32Array;
  _dvz: Float32Array;
  _deathX = 0;
  _deathY = 0;
  _deathZ = 0;
  _brakeBlend = 0;
  _courseAssist = 0;
  _meterGainBlend = 0;

  // Drift state (car only)
  _drifting = false;
  _slipAngle = 0;
  _velocityAngle: number;
  _driftTimer = 0;
  _driftEntryTimer = 0;
  _driftBrakeHeld = false;   // is brake still held since drift started?
  _driftBrakeReleased = false; // brake released at least once during this drift
  _driftAlignTimer = 0;      // time slip angle has been below threshold (for grace exit)
  _snapRecovery = false;
  _snapRecoveryTimer = 0;
  _snapRecoveryBoosted = false;
  _snapRecoveryFromAngle: number;
  _turnRamp = 0;
  _fumesTimer = 0;

  groundFX: GroundFXSystem | undefined;
  electricArcs: ElectricArcSystem | undefined;
  speedLines: SpeedLineSystem | undefined;
  snapSmoke: SnapSmokeFX | undefined;
  _sparkEmitter: SparkEmitter | null = null;
  _grindHUD: GrindHUD | null = null;
  _grindComboHUD: GrindComboHUD | null = null;
  _grindBustOverlay: GrindBustOverlay | null = null;
  _grindAvailabilityHint: GrindAvailabilityHint | null = null;
  _tireStreaks: TireStreakSystem | null = null;
  // SPEC-82: grind cue edge-tracking state (read/written by updateGrindRender)
  _lastChainLength = 0;
  _lastStreakCount = 0;
  _lastSweetLockIn = false;
  _prevRunActive = false;
  _hoverAnimator: HoverboardAnimator | null = null;
  _bikeAnimator: BikeAnimator | null = null;
  _carAnimator: CarAnimator | null = null;

  /** Pre-allocated input buffer — avoids per-frame object creation. */
  _animInput: HoverAnimInput = {
    dt: 0, speed: 0, baseSpeed: 0, boosting: false, dashing: false,
    turnRamp: 0, brakeBlend: 0, grinding: false, grindBalance: 0,
    airborne: false, airborneTimer: 0, airborneDuration: 1, airbornePeak: 0,
    recovery: false, landingPenalty: false,
  };
  _bikeAnimInput: BikeAnimInput = {
    dt: 0, speed: 0, baseSpeed: 0, boosting: false, dashing: false,
    turnRamp: 0, brakeBlend: 0,
  };
  _carAnimInput: CarAnimInput = {
    dt: 0, speed: 0, baseSpeed: 0, boosting: false, dashing: false,
    turnRamp: 0, brakeBlend: 0, drifting: false, driftDirection: 0,
    airborne: false, airborneTimer: 0, airborneDuration: 0.3, airbornePeak: 0,
  };

  /**
   * Persistent PlayerSim for single-player (non-lockstep) path. Owned and mutated
   * in place across frames so grind state (cooldowns, RNG, streak, etc.) persists.
   * Lockstep mode keeps authoritative state in LockstepManager and ignores this.
   */
  _sim: PlayerSim;

  /**
   * Read-only access to the persistent single-player sim. Callers must not
   * mutate grind state directly — that is owned by update() + advancePlayer.
   * Game.ts uses this to build a SimContext referencing all players' sims.
   */
  get sim(): PlayerSim { return this._sim; }

  // Cached grind render state — populated by applySimState (lockstep path)
  _grinding = false;
  _grindBalance = 0;
  _grindBailSide = 0;
  _airborne = false;
  _airborneTimer = 0;
  _airborneDuration = 1;
  _airbornePeak = 0;
  _recovery = false;
  _landingPenalty = false;
  _grindTrailVehicleType: VehicleType | null = null;
  _grindStreakCount = 0;
  _grindStreakBroken = false;
  // Trick state — populated by applySimState
  _trickDetected = '';
  _trickMeterBonus = 0;

  get isGrinding(): boolean { return this._grinding; }
  get grindTrailVehicleType(): VehicleType | null { return this._grindTrailVehicleType; }
  get grindBalanceValue(): number { return this._grindBalance; }
  get grindBailSideValue(): number { return this._grindBailSide; }
  get grindStreakCount(): number { return this._grindStreakCount; }
  get grindStreakBroken(): boolean { return this._grindStreakBroken; }
  get trickName(): string { return this._trickDetected; }
  get trickBonus(): number { return this._trickMeterBonus; }
  get grindScoreValue(): number { return this._sim?.grindScore ?? 0; }
  get grindMultiplierValue(): number { return this._sim?.grindMultiplier ?? 1.0; }
  get grindChainList(): readonly string[] { return this._sim?.grindChain ?? []; }
  /** Returns the pending bust score for this frame. Zero after `consumeGrindBustScore` runs — read before `_updateGrindRender` to catch the value. */
  get grindBustScoreValue(): number { return this._sim?.grindBustScore ?? 0; }
  get grindRunActiveFlag(): boolean { return this._sim?.grindRunActive ?? false; }
  get isAirborne(): boolean { return this._airborne; }
  get isRecovery(): boolean { return this._recovery; }
  get hasLandingPenalty(): boolean { return this._landingPenalty; }

  // ── TASK-267: IAIPlayer-compatible grind getters ──
  // Visual-layer AI reads these via the IAIPlayer interface. They mirror the
  // persistent sim's state so the AI can make grind decisions with the same
  // awareness the sim-layer AI already has in lockstep mode.
  get grinding(): boolean { return this._grinding; }
  get grindBalance(): number { return this._grindBalance; }
  get grindCooldown(): number { return this._sim?.grindCooldown ?? 0; }
  get grindDuration(): number { return this._sim?.grindDuration ?? 0; }
  get airborne(): boolean { return this._airborne; }
  get recovery(): boolean { return this._recovery; }
  get grindSnapAvailable(): boolean { return this._sim?.grindSnapAvailable ?? false; }

  constructor(scene: THREE.Scene, { color, emissive, startX, startZ, startAngle, isAI = false, vehicleType = 'bike' }: PlayerConstructorOpts) {
    this.scene = scene;
    this.isAI = isAI;
    this.vehicleType = vehicleType;
    this._vCfg = getVehiclePhysics(vehicleType);
    this.speed = this._vCfg.baseSpeed;
    this.angle = startAngle;
    this.velocityAngle = startAngle;
    this.colorHex = color;
    this._velocityAngle = startAngle;
    this._snapRecoveryFromAngle = startAngle;

    const vehicleVisibilityBoost = vehicleType === 'bike'
      ? 1
      : computeVehicleVisibilityBoost(color).visibilityBoost;
    this._vehicleLightBoost = 1 + (vehicleVisibilityBoost - 1) * 0.65;
    this._vehicleUnderglowBoost = 1 + (vehicleVisibilityBoost - 1) * 0.9;

    // Persistent PlayerSim (used in the hoverboard non-lockstep path for grind persistence).
    // All vehicle types initialize this so the field is never undefined; only the
    // hoverboard branch of update() actually reads/writes it.
    this._sim = createPlayerSim(startX, startZ, startAngle, this._vCfg.baseSpeed, vehicleType);

    // Outer group for position + heading, inner for lean
    const outer: THREE.Group = new THREE.Group();
    const inner: THREE.Group = new THREE.Group();
    outer.add(inner);
    const { glow, bikeLight, underGlow, proximityAura, beam, vehicleClone } =
      this._buildVehicle(inner, color, emissive);
    this.engineGlow = glow;
    this.bikeLight = bikeLight;
    this.underGlow = underGlow;
    this.proximityAura = proximityAura;
    this._beam = beam;

    inner.scale.setScalar(1.05); // 5% larger
    outer.position.set(startX, 0, startZ);
    outer.rotation.y = startAngle;
    scene.add(outer);
    enableReflection(outer);
    this.mesh = outer;
    this._innerGroup = inner;
    this.color = color;
    this.trail = new Trail(scene, color, vehicleType);

    this._initVFX(scene, color, isAI, vehicleType, inner, vehicleClone);
    this._flashLight = this._initFlashLight(scene, color);
    ({ mat: this._deathMat, particles: this.deathParticles,
       count: this._debrisCount, dvx: this._dvx, dvy: this._dvy, dvz: this._dvz } =
      this._initDeathParticles(scene, isAI));
  }

  private _buildVehicle(
    inner: THREE.Group, color: number, emissive: number,
  ): ReturnType<typeof buildBike> {
    const VEHICLE_BUILDERS: Record<VehicleType, typeof buildBike> = {
      bike: buildBike,
      car: buildCar,
      hoverboard: buildHoverboard,
    };
    const builder = VEHICLE_BUILDERS[this.vehicleType] ?? buildBike;
    return builder(inner, color, emissive, this.isAI);
  }

  private _initVFX(
    scene: THREE.Scene,
    color: number,
    isAI: boolean,
    vehicleType: VehicleType,
    inner: THREE.Group,
    vehicleClone: THREE.Group | undefined,
  ): void {
    // VFX — scaled by graphics quality, reduced for AI
    const vfx = getGfx().playerVFX;
    if (!isAI && vfx !== 'off') {
      this.groundFX = createGroundFX(scene, color);
      this.snapSmoke = createSnapSmoke(scene, color);
      if (vfx === 'full') {
        this.electricArcs = createElectricArcs(scene, color);
        this.speedLines = createSpeedLines(scene, color);
      }
    }

    // Grind VFX + animator — hoverboard only
    if (vehicleType === 'hoverboard') {
      this._sparkEmitter = new SparkEmitter(scene, color);
      if (!isAI) {
        this._grindHUD = new GrindHUD(scene);
        this._grindComboHUD = new GrindComboHUD();
        this._grindComboHUD.setGlowColor(color);
        this._grindBustOverlay = new GrindBustOverlay();
        this._grindAvailabilityHint = new GrindAvailabilityHint();
        this._grindAvailabilityHint.setGlowColor(color);
      }
      this._hoverAnimator = new HoverboardAnimator(inner);
      if (vehicleClone) {
        this._hoverAnimator.attachProxies(vehicleClone);
      }
    }

    if (vehicleType === 'bike') {
      this._bikeAnimator = new BikeAnimator(inner);
    }
    if (vehicleType === 'car') {
      this._carAnimator = new CarAnimator(inner);
      if (!isAI) {
        this._tireStreaks = new TireStreakSystem();
        scene.add(this._tireStreaks.instancedMesh);
      }
    }
  }

  private _initFlashLight(scene: THREE.Scene, color: number): THREE.PointLight {
    // Pre-create death flash light — always visible at intensity 0 so
    // Three.js includes it in the light count from the start, avoiding
    // shader recompilation when we activate it on death.
    const flash = new THREE.PointLight(color, 0, 10);
    scene.add(flash);
    return flash;
  }

  private _initDeathParticles(scene: THREE.Scene, isAI: boolean): {
    mat: THREE.PointsMaterial; particles: THREE.Points; count: number;
    dvx: Float32Array; dvy: Float32Array; dvz: Float32Array;
  } {
    // Pre-create death particle system (hidden) — avoids geometry/material
    // allocation and scene.add on the death frame entirely
    const count: number = isAI ? 12 : 20;
    const debrisPos: Float32Array = new Float32Array(count * 3);
    const debrisCol: Float32Array = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) debrisPos[i] = -9999; // off-screen
    const debrisGeo: THREE.BufferGeometry = new THREE.BufferGeometry();
    debrisGeo.setAttribute('position', new THREE.BufferAttribute(debrisPos, 3));
    debrisGeo.setAttribute('color', new THREE.BufferAttribute(debrisCol, 3));
    const mat = _deathMat.clone();
    mat.opacity = 0; // invisible until death
    const particles = new THREE.Points(debrisGeo, mat);
    particles.frustumCulled = false;
    scene.add(particles);
    return {
      mat, particles, count,
      dvx: new Float32Array(count),
      dvy: new Float32Array(count),
      dvz: new Float32Array(count),
    };
  }

  update(
    dt: number,
    turnDir: number,
    accelerate: boolean,
    dash: boolean = false,
    brake: boolean = false,
    driftBrake: boolean = brake,
    special: boolean = false,
    simContext?: SimState,
    playerIndex?: number,
    camera?: THREE.Camera,
  ): void {
    if (!this.alive) return;
    const cfg = this._vCfg;
    const wasDashing: boolean = this.dashing;

    if (this.vehicleType === 'bike' || this.vehicleType === 'car' || this.vehicleType === 'hoverboard') {
      if (!stepSimPhysics(this, dt, turnDir, accelerate, dash, brake, driftBrake, special, simContext, playerIndex)) {
        return;
      }
    } else {
      stepCarInlinePhysics(this, dt, turnDir, accelerate, dash, brake, driftBrake);
    }

    const dashJustPressed: boolean = this.dashing && !wasDashing;
    this.mesh.rotation.y = this.angle;

    applyLeanAndAnimatorUpdate(this, dt, turnDir);

    // Hoverboard: procedural animation system + grind HUD/VFX
    if (this.vehicleType === 'hoverboard' && this._hoverAnimator) {
      fillHoverAnimInput(this, dt, cfg.baseSpeed);
      this._hoverAnimator.update(this._animInput);
      // Single-player path — pass sim so grind cues + cash-out can fire
      updateGrindRender(this, dt, camera, this._sim);
    }

    updateTrail(this, dt);
    updateLightsAndFXUpdate(this, dt, accelerate, dashJustPressed);
  }

  // ── Lockstep: apply deterministic sim state and run visuals ──
  // SPEC-82: isLocal flag gates grind-cue firing so only the local player hears them
  applySimState(sim: PlayerSim, dt: number, turnDir: number, camera?: THREE.Camera, isLocal = false): void {
    applySimStateHelper(this, sim, dt, turnDir, camera, isLocal);
  }

  // Gentle steering assist: nudge toward parallel when near a trail or wall
  courseCorrect(trails: Trail[], skipOwn: Trail): void {
    courseCorrectHelper(this, trails, skipOwn);
  }

  rechargeMeter(enemyTrail: Trail, dt: number): void {
    if (!this.alive) return;
    void enemyTrail;

    // Passive regen — only when NOT dashing and NOT W-boosting (drifting W-boost is allowed)
    // Bike: handled by advancePlayer() in update(), skip here to avoid double regen
    if (this.vehicleType !== 'bike' && !this.dashing && (!this.wBoosting || this._drifting)) {
      this.meter = Math.min(METER_MAX, this.meter + METER_PASSIVE_REGEN * dt);
    }

    // Proximity recharge — wall riding builds meter (bike only — car builds meter through drift)
    const { x, z } = this.getPosition();
    // Skip own trail entirely — recharge only from enemy trails
    const minDist: number = grid.nearestDist(x, z, RECHARGE_RANGE, this.trail, Infinity);
    if (this.vehicleType !== 'car' && minDist < RECHARGE_RANGE) {
      const factor: number = 1 - minDist / RECHARGE_RANGE;
      // While dashing: 40% recharge (net drain still negative, but extends dash duration)
      const rechargeRate: number = this.dashing ? METER_RECHARGE_MAX * 0.4 : METER_RECHARGE_MAX;
      this.meter = Math.min(METER_MAX, this.meter + rechargeRate * factor * dt);
    }

    // Low meter emergency regen (bike only — trickle charge when critically low)
    const cfg = this._vCfg;
    if (cfg.lowMeterThreshold > 0 && this.meter < METER_MAX * cfg.lowMeterThreshold) {
      this.meter = Math.min(METER_MAX, this.meter + cfg.lowMeterRegen * dt);
    }

    // Track whether meter is actively gaining (for spark effect) — smooth transition
    const wantGaining: boolean = this.vehicleType !== 'car' && (minDist < RECHARGE_RANGE);
    const gainTarget: number = wantGaining ? 1 : 0;
    this._meterGainBlend = (this._meterGainBlend || 0) + (gainTarget - (this._meterGainBlend || 0)) * Math.min(1, (wantGaining ? 10 : 3) * dt);
    this.meterGaining = this._meterGainBlend > 0.1;
  }

  getMeterPercent(): number { return this.meter / METER_MAX; }
  getPosition(): { x: number; z: number } { return { x: this.mesh.position.x, z: this.mesh.position.z }; }

  /**
   * Test-only teleport. Writes position + angle to mesh, cached Player fields,
   * AND the authoritative _sim so next frame's advancePlayer picks them up.
   * Used by browser e2e tests to deterministically position the player for
   * grind scenarios.
   */
  teleportForTest(x: number, z: number, angle: number): void {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    this.angle = angle;
    this.velocityAngle = angle;
    this._velocityAngle = angle;
    this._sim.x = x;
    this._sim.z = z;
    this._sim.angle = angle;
    this._sim.velocityAngle = angle;
  }

  /** Test-only (SPEC-82): force a grind bail by pushing grindBalance past the threshold. */
  forceGrindBailForTest(): boolean {
    if (!this._sim.grinding) return false;
    this._sim.grindBalance = 1.1;
    return true;
  }

  /** Trigger milestone animation on the combo HUD (called by game loop). */
  triggerStreakMilestone(bonus: number): void {
    this._grindComboHUD?.triggerCashOut(bonus);
  }

  kill(): void { killPlayer(this); }

  updateDeath(dt: number): void { updatePlayerDeath(this, dt); }

  /** Hot-swap vehicle physics (admin tool). Changes handling; visual model stays. */
  swapVehicle(type: VehicleType): void {
    this.vehicleType = type;
    this._vCfg = getVehiclePhysics(type);
  }

  destroy(): void { destroyPlayer(this); }
}

// Re-export for backward compat (consumed by game.ts)
export { warmDeathShader } from './playerVFX';
