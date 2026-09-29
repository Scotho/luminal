import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { SpectatorDrone } from './arenaState';
import type { ArenaAudioPass } from '../arenaAudio';
import { createReactiveState } from './arenaState';
import { updateSpectatorDrone, __test__ } from './spectatorDroneAnim';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DT = 1 / 60;

function makeDrone(): SpectatorDrone {
  const mesh = new THREE.Group();
  const recLight = new THREE.PointLight(0xff2222, 3.0, 15);
  mesh.position.set(__test__.HALF * 0.85, 45, 0);
  return {
    mesh,
    recLight,
    angle: 0,
    orbitR: __test__.HALF * 0.85,
    targetR: __test__.HALF * 0.85,
    flyY: 45,
    targetY: 45,
    bankAngle: 0,
    pitchAngle: 0,
  };
}

function makePass(
  drone: SpectatorDrone,
  now: number,
  targets?: Array<{ x: number; z: number } | null>,
): ArenaAudioPass {
  const reactive = createReactiveState('synth_pit');
  reactive.spectatorDrone = drone;
  if (targets) reactive._trackTargets = targets;
  // gfx and bands are required by the type but unused by updateSpectatorDrone.
  return {
    reactive,
    gfx: {} as ArenaAudioPass['gfx'],
    bands: {
      bass: 0, lowMid: 0, mid: 0, upperMid: 0, presence: 0, energy: 0, kick: 0,
    },
    now,
    dt: DT,
  };
}

function runFor(drone: SpectatorDrone, seconds: number, startNow: number,
                targets?: Array<{ x: number; z: number } | null>): void {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    const pass = makePass(drone, startNow + i * DT, targets);
    updateSpectatorDrone(pass);
  }
}

describe('updateSpectatorDrone — velocity continuity', () => {
  it('transitions idle -> chase without a velocity step', () => {
    const drone = makeDrone();
    // Run 2 seconds of idle to build up velocity state
    runFor(drone, 2.0, 0);
    const angVelBefore = drone._angVel ?? 0;
    const radVelBefore = drone._radVel ?? 0;
    const yVelBefore = drone._yVel ?? 0;

    // Flip to chase mode with a target
    const target = { x: 50, z: 50 };
    const pass = makePass(drone, 2.0 + DT, [target]);
    updateSpectatorDrone(pass);
    const angVelAfter = drone._angVel ?? 0;
    const radVelAfter = drone._radVel ?? 0;
    const yVelAfter = drone._yVel ?? 0;

    // Per-frame velocity delta must be bounded by the physical maxSpeed
    expect(Math.abs(angVelAfter - angVelBefore)).toBeLessThan(__test__.MAX_ANG_SPEED);
    expect(Math.abs(radVelAfter - radVelBefore)).toBeLessThan(__test__.MAX_RAD_SPEED);
    expect(Math.abs(yVelAfter - yVelBefore)).toBeLessThan(__test__.MAX_Y_SPEED);
  });

  it('transitions chase -> idle without a velocity step', () => {
    const drone = makeDrone();
    runFor(drone, 2.0, 0, [{ x: 80, z: -40 }]);
    const angVelBefore = drone._angVel ?? 0;

    const pass = makePass(drone, 2.0 + DT);  // no targets
    updateSpectatorDrone(pass);
    const angVelAfter = drone._angVel ?? 0;

    expect(Math.abs(angVelAfter - angVelBefore)).toBeLessThan(__test__.MAX_ANG_SPEED);
  });
});

describe('updateSpectatorDrone — idle target continuity', () => {
  it('targetR and targetY are continuous functions of now', () => {
    const drone = makeDrone();
    let prevR = drone.targetR;
    let prevY = drone.targetY;
    // 30 seconds, sample every frame
    for (let i = 0; i < 30 / DT; i++) {
      const pass = makePass(drone, i * DT);
      updateSpectatorDrone(pass);
      if (i > 0) {
        // Step bound: targetR/targetY shouldn't jump more than 2 units per frame.
        // The old 4-phase code violated this at phase boundaries.
        expect(Math.abs(drone.targetR - prevR)).toBeLessThan(2);
        expect(Math.abs(drone.targetY - prevY)).toBeLessThan(2);
      }
      prevR = drone.targetR;
      prevY = drone.targetY;
    }
  });
});

describe('updateSpectatorDrone — target hysteresis', () => {
  it('does not flip latch when candidates are near-equidistant', () => {
    const drone = makeDrone();
    // Two targets near the drone's starting pos, roughly equidistant
    const t0 = { x: 160, z: 0 };
    const t1 = { x: 159, z: 1 };
    runFor(drone, 0.5, 0, [t0, t1]);
    const latched = drone._latchedTargetIdx;
    expect(latched).toBeDefined();

    // Tiny perturbations shouldn't flip the latch
    for (let i = 0; i < 60; i++) {
      const jitter = Math.sin(i * 0.2) * 0.3;
      const pass = makePass(drone, 0.5 + i * DT, [
        { x: t0.x + jitter, z: t0.z },
        { x: t1.x - jitter, z: t1.z },
      ]);
      updateSpectatorDrone(pass);
      expect(drone._latchedTargetIdx).toBe(latched);
    }
  });

  it('flips latch when a new candidate is >20% closer', () => {
    const drone = makeDrone();
    const t0 = { x: 160, z: 0 };     // current latched target
    const t1 = { x: 900, z: 900 };   // far initially
    runFor(drone, 0.5, 0, [t0, t1]);
    expect(drone._latchedTargetIdx).toBe(0);

    // Now swap: t1 is the close one, t0 is far
    const t1Close = { x: drone.mesh.position.x + 5, z: drone.mesh.position.z + 5 };
    const t0Far = { x: 900, z: 900 };
    runFor(drone, 0.5, 0.5, [t0Far, t1Close]);
    expect(drone._latchedTargetIdx).toBe(1);
  });
});

describe('spectatorDroneAnim module — regression guards', () => {
  it('does not call THREE.Object3D.lookAt', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'spectatorDroneAnim.ts'),
      'utf8',
    );
    // Strip comments and match any .lookAt( call on the mesh
    const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(/\.lookAt\s*\(/);
  });
});
