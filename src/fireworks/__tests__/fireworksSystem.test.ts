import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// Stub the audio module — we don't want to render procedural buffers in tests.
vi.mock('../fireworkAudio', () => ({
  FireworkAudio: class {
    play = vi.fn();
    dispose = vi.fn();
  },
}));

// Stub the text bomb — keeps tests fast and free of network font loads.
vi.mock('../fireworkTextBomb', () => ({
  FireworkTextBomb: class {
    emit = vi.fn();
    dispose = vi.fn();
  },
}));

// Stub sfxContext used transitively.
vi.mock('../../sfxContext', () => ({
  getCtx: vi.fn(),
  getSfxOutput: vi.fn(),
  noiseBuf: vi.fn(),
}));

import { FireworksSystem } from '../fireworksSystem';
import { Launcher, Shell, Spark } from '../fireworkParticles';

describe('FireworksSystem', () => {
  let scene: THREE.Scene;
  let camera: THREE.Camera;
  let system: FireworksSystem;

  beforeEach(() => {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera();
    system = new FireworksSystem();
  });

  it('start adds the line buffer mesh to the scene', () => {
    const addSpy = vi.spyOn(scene, 'add');
    system.start(scene, camera);
    expect(addSpy).toHaveBeenCalled();
  });

  it('start creates 1 non-positional emitter', () => {
    system.start(scene, camera);
    expect(system.launcherCount).toBe(1);
  });

  it('step emits shells from the emitter and advances particles', () => {
    system.start(scene, camera);
    // Run enough frames for at least one fire + spark cascade
    for (let i = 0; i < 120; i++) system.step(1 / 60);
    expect(system.activeCount).toBeGreaterThan(0);
  });

  it('emitted sparks count as active particles', () => {
    system.start(scene, camera);
    // Inject a near-dead shell directly; on its next step it should emit sparks.
    const shell = new Shell(system);
    shell.position.set(0, 80, 0);
    shell.life = 0.001;
    system.emit(shell);
    system.step(0.1);
    // After expiry, exactly 50 sparks should have been added (Shell emits 50 per expiry).
    expect(system.activeCount).toBe(50);
  });

  it('step prunes dead particles', () => {
    system.start(scene, camera);
    const spark = new Spark();
    spark.position.set(0, 50, 0);
    spark.life = 0.001;
    system.emit(spark);
    expect(system.activeCount).toBe(1);
    system.step(0.1);
    expect(system.activeCount).toBe(0);
  });

  it('hard particle cap suppresses new emissions', () => {
    system.start(scene, camera);
    const cap = (system as unknown as { hardCap: number }).hardCap;
    for (let i = 0; i < cap; i++) {
      const s = new Spark();
      s.position.set(0, 50, 0);
      s.life = 10;
      system.emit(s);
    }
    expect(system.activeCount).toBe(cap);
    // Additional emits past the cap should be silently dropped.
    for (let i = 0; i < 5; i++) {
      const s = new Spark();
      s.position.set(0, 50, 0);
      s.life = 10;
      system.emit(s);
    }
    expect(system.activeCount).toBe(cap);
  });

  it('stop removes the line buffer mesh from the scene', () => {
    const removeSpy = vi.spyOn(scene, 'remove');
    system.start(scene, camera);
    system.stop();
    expect(removeSpy).toHaveBeenCalled();
  });

  it('dispose tears down the buffer', () => {
    system.start(scene, camera);
    system.dispose();
    // Should not throw.
    expect(system.activeCount).toBe(0);
  });
});
