import * as THREE from 'three';
import type { FireworkLineBuffer } from './fireworkLineBuffer';

// ── Tuning constants ─────────────────────────────────────────────────
// Gentle gravity — shells fly near-straight over their ~1–2s life.
export const GRAVITY_Y = -2.0;
export const TRAIL_LENGTH = 8;
// Trail segments are boosted above particle color so the head glows hot.
export const TRAIL_BRIGHTNESS_GAIN = 2.0;

// Subclasses override these hooks. System is forward-declared for
// Shell.onExpire which needs to emit sparks back into the orchestrator.
export interface FireworksSystemHandle {
  emit(particle: FwParticle): void;
  audio: {
    play(name: 'launch0' | 'pop0' | 'boom0', position: THREE.Vector3, gain: number, detune: number): void;
  };
  triggerTextBomb(shell: Shell): void;
}

// ── Base particle ─────────────────────────────────────────────────────

export abstract class FwParticle {
  position: THREE.Vector3 = new THREE.Vector3();
  velocity: THREE.Vector3 = new THREE.Vector3();
  color: THREE.Color = new THREE.Color(1, 1, 1);
  mass = 1;
  drag = 0;            // 0 = no drag; otherwise per-frame (applied as drag^ndt)
  life = 1;            // seconds
  spawnTime = 0;       // set on first step
  dead = false;

  // Trail: ring of slot indices, -1 = empty.
  protected trail: Int32Array = new Int32Array(TRAIL_LENGTH).fill(-1);
  protected trailCursor = 0;
  /** Count of slots this particle currently owns (0..TRAIL_LENGTH). */
  protected trailCount = 0;
  /** Previous-frame position used as segment start. */
  protected lastPos: THREE.Vector3 = new THREE.Vector3();

  /**
   * Advance physics + trail one frame.
   * Returns true when the particle is fully disposed (caller removes it).
   */
  step(dt: number, ndt: number, now: number, buf: FireworkLineBuffer): boolean {
    if (this.spawnTime === 0) {
      // Back-date spawn by dt so the first frame contributes a proper age
      // slice (otherwise age would always be 0 on the first step).
      this.spawnTime = now - dt;
      this.lastPos.copy(this.position);
    }

    const age = Math.min(1, (now - this.spawnTime) / this.life);

    // Expire check BEFORE trail write — avoids wasting a slot reservation
    // on the death frame only to clear it moments later.
    if (this.dead || age >= 1) {
      this.onExpire();
      this.clearOwnedSlots(buf);
      return true;
    }

    // Compute new position. Position integrates real delta-time (dt);
    // frame-normalized quantities (gravity, drag) use ndt.
    const vx = this.velocity.x * dt;
    const vy = this.velocity.y * dt;
    const vz = this.velocity.z * dt;
    const newX = this.position.x + vx;
    const newY = this.position.y + vy;
    const newZ = this.position.z + vz;

    // Write trail segment from lastPos → newPos with fading brightness
    // (brighter at head, dimmer at tail, scaled by (1-age)^2 * gain).
    if (this.shouldDrawTrail()) {
      const slot = buf.reserveSlot();
      const brightness = ((1 - age) * (1 - age)) * TRAIL_BRIGHTNESS_GAIN;
      buf.writeSegment(
        slot,
        this.lastPos.x, this.lastPos.y, this.lastPos.z,
        newX, newY, newZ,
        this.color.r * brightness,
        this.color.g * brightness,
        this.color.b * brightness,
      );
      // Free the oldest trail slot we own if the ring is full.
      const prev = this.trail[this.trailCursor];
      if (prev !== -1) buf.clearSlot(prev);
      this.trail[this.trailCursor] = slot;
      this.trailCursor = (this.trailCursor + 1) % TRAIL_LENGTH;
      if (this.trailCount < TRAIL_LENGTH) this.trailCount++;
    }

    this.lastPos.set(newX, newY, newZ);
    this.position.set(newX, newY, newZ);

    // Gravity
    this.velocity.y += GRAVITY_Y * this.mass * ndt;

    // Ground bounce (reflect + 0.5 damp) or drag
    if (this.position.y < 0) {
      this.position.y = -this.position.y;
      this.velocity.y *= -1;
      this.velocity.multiplyScalar(0.5);
      // Stop micro-oscillation at rest: if the reflected vy is below a tiny
      // epsilon, pin the particle to y=0 so it doesn't burn trail slots
      // ticking back and forth every frame.
      if (Math.abs(this.velocity.y) < 1.0) {
        this.velocity.y = 0;
        this.position.y = 0;
      }
    } else if (this.drag > 0) {
      // Frame-rate-independent drag: (drag)^ndt
      const factor = Math.pow(this.drag, ndt);
      this.velocity.multiplyScalar(factor);
    }

    return false;
  }

  /** Subclasses override to suppress trail drawing (e.g. Launcher). */
  protected shouldDrawTrail(): boolean { return true; }

  /** Called once when the particle expires. Subclasses emit sparks, play SFX, etc. */
  protected onExpire(): void { /* base no-op */ }

  private clearOwnedSlots(buf: FireworkLineBuffer): void {
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const slot = this.trail[i];
      if (slot !== -1) {
        buf.clearSlot(slot);
        this.trail[i] = -1;
      }
    }
    this.trailCount = 0;
  }
}

// ── Spark ─────────────────────────────────────────────────────────────
// Standard physics particle. Emitted by Shell on expiry.
export class Spark extends FwParticle {
  // No subclass overrides — uses all base behavior.
}

// ── Shell ─────────────────────────────────────────────────────────────

export const SPARKS_PER_SHELL = 50;
export const BOMB_PROBABILITY = 1 / 20;

/** Random in [min, max). */
function rrng(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class Shell extends FwParticle {
  power = 1;
  private readonly system: FireworksSystemHandle;

  constructor(system: FireworksSystemHandle) {
    super();
    this.system = system;
  }

  protected override onExpire(): void {
    // Play boom (90%) or pop (10%)
    const soundName: 'boom0' | 'pop0' = Math.random() > 0.1 ? 'boom0' : 'pop0';
    // Detune range [-2000, +500) matches atos (biased low for heavier boom thump).
    this.system.audio.play(soundName, this.position, 0.6, Math.random() * 2500 - 2000);

    // Rare easter-egg bomb
    if (Math.random() < BOMB_PROBABILITY) {
      this.system.triggerTextBomb(this);
    }

    // Emit sparks
    for (let i = 0; i < SPARKS_PER_SHELL; i++) {
      const spark = new Spark();
      spark.position.copy(this.position);
      // Random unit direction × 0.23 * power (atos tuning scaled by 60 for SI, +10% burst size tune)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = (0.23 * this.power + Math.random() * 0.23) * 66;
      spark.velocity.set(
        Math.sin(phi) * Math.cos(theta) * speed + this.velocity.x,
        Math.cos(phi) * speed + this.velocity.y,
        Math.sin(phi) * Math.sin(theta) * speed + this.velocity.z,
      );
      spark.color.copy(this.color);
      spark.life = rrng(0.8, 1.0);
      spark.mass = rrng(0.5, 1.0);
      spark.drag = rrng(0.95, 0.99);
      this.system.emit(spark);
    }
  }
}

// ── Launcher (sky-box emitter) ────────────────────────────────────────
// NOTE: Unlike atos, the Launcher is not a physical object — it is a pure
// scheduler. Its position is unused. On each fire it picks a fresh random
// spawn position inside the sky box and emits a Shell there with minimal
// velocity so the explosion happens right at that location.

// Cooldowns shortened ~10% vs atos default (0.17/0.50) for a punchier cadence.
export const LAUNCHER_COOLDOWN_MIN = 0.153;
export const LAUNCHER_COOLDOWN_MAX = 0.45;
export const LAUNCHER_PAUSE_CHANCE = 0.05;
export const LAUNCHER_PAUSE_DURATION = 3.0;

// Sky-box matches old spawnFirework positions, raised to clear all map floors.
export const EMIT_XZ_HALF = 96;    // x,z ∈ [-96, 96]
export const EMIT_Y_MIN = 80;
export const EMIT_Y_MAX = 120;

export class Launcher extends FwParticle {
  private readonly system: FireworksSystemHandle;
  private nextFireAt = 0;

  constructor(system: FireworksSystemHandle) {
    super();
    this.life = Number.POSITIVE_INFINITY;
    this.system = system;
    // Initial cooldown so the launcher does not fire on the very first step
    // (matches the cadence applied after every subsequent fire).
    this.nextFireAt = LAUNCHER_COOLDOWN_MIN + Math.random() * (LAUNCHER_COOLDOWN_MAX - LAUNCHER_COOLDOWN_MIN);
  }

  protected override shouldDrawTrail(): boolean { return false; }

  override step(dt: number, ndt: number, now: number, buf: FireworkLineBuffer): boolean {
    if (this.spawnTime === 0) this.spawnTime = now;
    if (now >= this.nextFireAt && !this.dead) {
      this.fire(now);
    }
    return this.dead;
  }

  private fire(now: number): void {
    const shell = new Shell(this.system);

    // Pick a random position in the sky box — not at the launcher's position.
    shell.position.set(
      (Math.random() * 2 - 1) * EMIT_XZ_HALF,
      EMIT_Y_MIN + Math.random() * (EMIT_Y_MAX - EMIT_Y_MIN),
      (Math.random() * 2 - 1) * EMIT_XZ_HALF,
    );

    // Play the launch sound at the shell's spawn position (not the launcher's).
    this.system.audio.play('launch0', shell.position, 0.4, Math.random() * 4000 - 500);

    // Tiny upward drift — explosion happens ~where the shell spawns.
    shell.velocity.set(
      (Math.random() * 2 - 1) * 3,
      5 + Math.random() * 10,
      (Math.random() * 2 - 1) * 3,
    );

    shell.power = 1 + Math.random();
    shell.life = 0.1 + Math.random() * 0.2;    // rrng(0.1, 0.3) — short
    shell.color.setHSL(Math.random(), 0.9, 0.6);

    this.system.emit(shell);

    // Schedule next fire
    const cooldown = LAUNCHER_COOLDOWN_MIN + Math.random() * (LAUNCHER_COOLDOWN_MAX - LAUNCHER_COOLDOWN_MIN);
    const pauseExtra = Math.random() < LAUNCHER_PAUSE_CHANCE ? LAUNCHER_PAUSE_DURATION : 0;
    this.nextFireAt = now + cooldown + pauseExtra;
  }
}
