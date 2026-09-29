import * as THREE from 'three';
import { FireworkLineBuffer } from './fireworkLineBuffer';
import { FireworkAudio } from './fireworkAudio';
import { FireworkTextBomb } from './fireworkTextBomb';
import {
  FwParticle,
  Launcher,
  Shell,
  type FireworksSystemHandle,
} from './fireworkParticles';

const HARD_CAP = 400;
const LINE_SEGMENT_BUDGET = 12_000;

/**
 * Orchestrator for the fireworks display. Owns one pooled LineSegments,
 * a single non-positional sky-box emitter, and the active particle list.
 * Stepped once per frame via arenaAudio.updateFireworks.
 */
export class FireworksSystem implements FireworksSystemHandle {
  readonly buffer: FireworkLineBuffer;
  readonly audio: FireworkAudio;
  private readonly textBomb: FireworkTextBomb;
  private readonly particles: FwParticle[] = [];
  private readonly launchers: Launcher[] = [];
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private readonly hardCap = HARD_CAP;
  private now = 0;

  constructor() {
    this.buffer = new FireworkLineBuffer(LINE_SEGMENT_BUDGET);
    this.audio = new FireworkAudio();
    this.textBomb = new FireworkTextBomb();
  }

  start(scene: THREE.Scene, camera: THREE.Camera): void {
    this.now = 0;
    this.scene = scene;
    this.camera = camera;
    scene.add(this.buffer.mesh);

    // Single non-positional emitter. Position is never read by the Launcher
    // class — it randomizes the shell spawn position per fire.
    this.launchers.push(new Launcher(this));
  }

  stop(): void {
    if (this.scene) this.scene.remove(this.buffer.mesh);
    this.buffer.reset();
    this.particles.length = 0;
    this.launchers.length = 0;
    this.scene = null;
    this.camera = null;
  }

  emit(particle: FwParticle): void {
    if (this.particles.length >= this.hardCap) return;
    this.particles.push(particle);
  }

  triggerTextBomb(shell: Shell): void {
    if (this.camera) this.textBomb.emit(this, shell, this.camera);
  }

  step(dt: number): void {
    this.now += dt;
    const ndt = dt * 60;

    // Launchers — never expire, never pruned here.
    for (const l of this.launchers) {
      l.step(dt, ndt, this.now, this.buffer);
    }

    // Particles — step in reverse so we can splice in place.
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const done = this.particles[i].step(dt, ndt, this.now, this.buffer);
      if (done) {
        this.particles.splice(i, 1);
      }
    }

    this.buffer.markDirty();
  }

  get activeCount(): number {
    return this.particles.length;
  }

  get launcherCount(): number {
    return this.launchers.length;
  }

  dispose(): void {
    this.stop();
    this.buffer.dispose();
    this.audio.dispose();
    this.textBomb.dispose();
  }
}
