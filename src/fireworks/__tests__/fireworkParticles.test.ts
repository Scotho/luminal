import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { FireworkLineBuffer } from '../fireworkLineBuffer';
import { FwParticle, Spark, Shell, Launcher, SPARKS_PER_SHELL, TRAIL_LENGTH, GRAVITY_Y } from '../fireworkParticles';
import type { FireworksSystemHandle } from '../fireworkParticles';

function step(particle: Spark, buf: FireworkLineBuffer, dt = 1 / 60, times = 1): void {
  let now = 0;
  for (let i = 0; i < times; i++) {
    now += dt;
    particle.step(dt, dt * 60, now, buf);
  }
}

describe('Spark', () => {
  let buf: FireworkLineBuffer;

  beforeEach(() => {
    buf = new FireworkLineBuffer(200);
  });

  it('step advances position by velocity * dt', () => {
    const s = new Spark();
    s.position.set(0, 50, 0);
    s.velocity.set(10, 0, 0);
    s.life = 10;
    s.color.setRGB(1, 1, 1);
    step(s, buf, 1 / 60);
    // dt = 1/60, position.x should advance by velocity.x * dt = 10 / 60
    expect(s.position.x).toBeCloseTo(10 / 60, 3);
  });

  it('gravity reduces y velocity over time', () => {
    const s = new Spark();
    s.position.set(0, 100, 0);
    s.velocity.set(0, 0, 0);
    s.life = 10;
    s.mass = 1;
    s.color.setRGB(1, 1, 1);
    step(s, buf, 1 / 60);
    // After one frame: vy = 0 + GRAVITY_Y * 1/60 (negative)
    expect(s.velocity.y).toBeLessThan(0);
  });

  it('bounces off y=0 with velocity reflection and 0.5 damp', () => {
    const s = new Spark();
    s.position.set(0, 0.01, 0);
    s.velocity.set(0, -10, 0);
    s.life = 10;
    s.mass = 1;
    s.color.setRGB(1, 1, 1);
    step(s, buf, 1 / 60);
    expect(s.position.y).toBeGreaterThanOrEqual(0);
    expect(s.velocity.y).toBeGreaterThan(0);
    // Velocity should be damped to ~half its magnitude
    expect(Math.abs(s.velocity.y)).toBeLessThan(10);
  });

  it('applies drag multiplicatively (frame-rate independent)', () => {
    const s = new Spark();
    s.position.set(0, 100, 0);
    s.velocity.set(10, 0, 0);
    s.life = 10;
    s.mass = 1;
    s.drag = 0.95;
    s.color.setRGB(1, 1, 1);
    step(s, buf, 1 / 60);
    // drag^ndt at ndt=1 → 0.95; vx should shrink
    expect(s.velocity.x).toBeLessThan(10);
    expect(s.velocity.x).toBeGreaterThan(9);
  });

  it('returns true from step when age exceeds life', () => {
    const s = new Spark();
    s.position.set(0, 50, 0);
    s.velocity.set(0, 0, 0);
    s.life = 0.1;
    s.color.setRGB(1, 1, 1);
    const done = s.step(0.2, 12, 0.2, buf);
    expect(done).toBe(true);
  });

  it('reserves trail slots up to TRAIL_LENGTH', () => {
    const s = new Spark();
    s.position.set(0, 50, 0);
    s.velocity.set(5, 0, 0);
    s.life = 10;
    s.color.setRGB(1, 1, 1);
    step(s, buf, 1 / 60, TRAIL_LENGTH + 2);
    // Should have used at least TRAIL_LENGTH unique segments
    expect((s as unknown as { trailCount: number }).trailCount).toBe(TRAIL_LENGTH);
  });

  it('clears owned slots on death', () => {
    const s = new Spark();
    s.position.set(0, 50, 0);
    s.velocity.set(5, 0, 0);
    s.life = 0.05;
    s.color.setRGB(1, 1, 1);
    // Step once — writes one trail segment at slot 0
    step(s, buf, 1 / 60);
    const positions = buf.mesh.geometry.attributes.position.array as Float32Array;
    // Sanity: slot 0 was written (at least one position is non-zero)
    const slot0HasContent = positions.slice(0, 6).some(v => v !== 0);
    expect(slot0HasContent).toBe(true);
    // Step again with enough time to push age >= 1 and trigger death
    const done = s.step(0.1, 6, 0.15, buf);
    expect(done).toBe(true);
    // All slots owned by this particle should now be zeroed
    const stillHasContent = positions.slice(0, 6).some(v => v !== 0);
    expect(stillHasContent).toBe(false);
  });
});

describe('GRAVITY_Y constant', () => {
  it('is negative (gravity pulls down)', () => {
    expect(GRAVITY_Y).toBeLessThan(0);
  });
});

function makeSystemStub() {
  const emitted: FwParticle[] = [];
  const plays: Array<{ name: string; pos: THREE.Vector3 }> = [];
  const bombs: number[] = [];
  const system: FireworksSystemHandle = {
    emit: (p: FwParticle): void => { emitted.push(p); },
    audio: {
      play: (name: 'launch0' | 'pop0' | 'boom0', pos: THREE.Vector3, _gain: number, _detune: number): void => {
        plays.push({ name, pos });
      },
    },
    triggerTextBomb: (): void => { bombs.push(1); },
  };
  return { system, emitted, plays, bombs };
}

describe('Shell', () => {
  it('emits exactly SPARKS_PER_SHELL sparks on expiry', () => {
    const buf = new FireworkLineBuffer(400);
    const { system, emitted } = makeSystemStub();
    const shell = new Shell(system);
    shell.position.set(0, 80, 0);
    shell.velocity.set(0, 5, 0);
    shell.life = 0.05;
    shell.color.setRGB(1, 0.5, 0.5);
    // Step long enough for age >= 1
    shell.step(0.1, 6, 0.1, buf);
    expect(emitted.length).toBe(SPARKS_PER_SHELL);
    expect(emitted.every(p => p instanceof Spark)).toBe(true);
    expect(emitted.every(p => p.velocity.lengthSq() > 0)).toBe(true);
  });

  it('plays boom0 or pop0 on expiry at the shell position', () => {
    const buf = new FireworkLineBuffer(400);
    const { system, plays } = makeSystemStub();
    const shell = new Shell(system);
    shell.position.set(10, 80, 20);
    shell.life = 0.05;
    shell.color.setRGB(1, 1, 1);
    shell.step(0.1, 6, 0.1, buf);
    expect(plays.length).toBe(1);
    expect(['boom0', 'pop0']).toContain(plays[0].name);
    expect(plays[0].pos.x).toBeCloseTo(10);
    expect(plays[0].pos.y).toBeCloseTo(80);
    expect(plays[0].pos.z).toBeCloseTo(20);
  });

  it('triggers the text bomb when the probability roll passes', () => {
    const buf = new FireworkLineBuffer(400);
    const { system, bombs } = makeSystemStub();
    // Stub Math.random to force the bomb-probability branch.
    // Shell.onExpire call order:
    //   1. boom-vs-pop roll (> 0.1 → boom)
    //   2. detune
    //   3. bomb probability (< 0.05 triggers)
    //   4+. spark emit loop (~4 calls/spark × 50 sparks)
    // Default everything else to 0.5 so only index 2 matters.
    const randomValues: number[] = [0.5, 0.5, 0.01];
    let i = 0;
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      const v = randomValues[i] ?? 0.5;
      i++;
      return v;
    });
    try {
      const shell = new Shell(system);
      shell.position.set(0, 80, 0);
      shell.life = 0.05;
      shell.color.setRGB(1, 1, 1);
      shell.step(0.1, 6, 0.1, buf);
      expect(bombs.length).toBe(1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('sparks inherit shell position and color', () => {
    const buf = new FireworkLineBuffer(400);
    const { system, emitted } = makeSystemStub();
    const shell = new Shell(system);
    shell.position.set(10, 80, 20);
    shell.life = 0.05;
    shell.color.setRGB(0.2, 0.4, 0.8);
    shell.step(0.1, 6, 0.1, buf);
    for (const spark of emitted) {
      expect(spark.position.x).toBeCloseTo(10);
      expect(spark.position.z).toBeCloseTo(20);
      expect(spark.color.r).toBeCloseTo(0.2);
      expect(spark.color.g).toBeCloseTo(0.4);
      expect(spark.color.b).toBeCloseTo(0.8);
    }
  });
});

describe('Launcher', () => {
  it('fires a Shell when cooldown elapses', () => {
    const buf = new FireworkLineBuffer(400);
    const { system, emitted, plays } = makeSystemStub();
    const launcher = new Launcher(system);
    launcher.position.set(100, 2, 100);
    // Force immediate fire by zeroing cooldown
    (launcher as unknown as { nextFireAt: number }).nextFireAt = 0;
    launcher.step(1 / 60, 1, 0.02, buf);
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toBeInstanceOf(Shell);
    expect(plays.some(p => p.name === 'launch0')).toBe(true);
  });

  it('schedules next fire in the future after firing', () => {
    const buf = new FireworkLineBuffer(400);
    const { system } = makeSystemStub();
    const launcher = new Launcher(system);
    (launcher as unknown as { nextFireAt: number }).nextFireAt = 0;
    launcher.step(1 / 60, 1, 0.1, buf);
    const next = (launcher as unknown as { nextFireAt: number }).nextFireAt;
    expect(next).toBeGreaterThan(0.1);
  });

  it('does not draw trails (shouldDrawTrail is false)', () => {
    const buf = new FireworkLineBuffer(400);
    const writeSpy = vi.spyOn(buf, 'writeSegment');
    const { system } = makeSystemStub();
    const launcher = new Launcher(system);
    launcher.position.set(0, 5, 0);
    (launcher as unknown as { nextFireAt: number }).nextFireAt = 999; // don't fire
    launcher.step(1 / 60, 1, 0.02, buf);
    // Base FwParticle.step would have called writeSegment — launcher overrides to skip
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('never expires (life=Infinity)', () => {
    const buf = new FireworkLineBuffer(400);
    const { system } = makeSystemStub();
    const launcher = new Launcher(system);
    (launcher as unknown as { nextFireAt: number }).nextFireAt = 999;
    const done = launcher.step(1, 60, 10, buf);
    expect(done).toBe(false);
  });

  it('emitted shell spawns inside the sky-box (x,z ∈ [-96,96], y ∈ [80,120])', () => {
    const buf = new FireworkLineBuffer(400);
    const { system, emitted } = makeSystemStub();
    const launcher = new Launcher(system);
    for (let i = 0; i < 20; i++) {
      (launcher as unknown as { nextFireAt: number }).nextFireAt = 0;
      launcher.step(1 / 60, 1, 0.02 + i * 0.01, buf);
    }
    // All emitted shells should be inside the box
    for (const p of emitted) {
      expect(p.position.x).toBeGreaterThanOrEqual(-96);
      expect(p.position.x).toBeLessThanOrEqual(96);
      expect(p.position.y).toBeGreaterThanOrEqual(80);
      expect(p.position.y).toBeLessThanOrEqual(120);
      expect(p.position.z).toBeGreaterThanOrEqual(-96);
      expect(p.position.z).toBeLessThanOrEqual(96);
    }
  });

  it('emitted shell has only a small upward drift (not a launch)', () => {
    const buf = new FireworkLineBuffer(400);
    const { system, emitted } = makeSystemStub();
    const launcher = new Launcher(system);
    (launcher as unknown as { nextFireAt: number }).nextFireAt = 0;
    launcher.step(1 / 60, 1, 0.02, buf);
    const shell = emitted[0] as Shell;
    expect(shell.velocity.y).toBeGreaterThanOrEqual(0);
    expect(shell.velocity.y).toBeLessThan(20);
  });
});
