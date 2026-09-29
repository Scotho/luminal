// ── Replay Camera ────────────────────────────────────────
// Extracted from replayMode.ts — replay camera update logic (orbit, free cam,
// player/AI chase, and cross-mode blend transitions).

import * as THREE from 'three';
import { updateCamera } from '../scene';
import type { InterpolatedReplayFrame, FreeCamInput, PlayerState } from '../types/index';
import type { ReplayMode } from './replayMode';

// Scratch vectors for per-frame reuse (zero-alloc hot paths)
const _zoomFwd = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _fakePos = new THREE.Vector3();
const _blendNewDir = new THREE.Vector3();
const _blendTarget = new THREE.Vector3();
const _blendCurDir = new THREE.Vector3();

export function updateReplayCamera(rm: ReplayMode, dt: number, frame: InterpolatedReplayFrame): void {
  const cam: THREE.PerspectiveCamera = rm.host.camera;

  const blending: boolean = rm._camTransition > 0;
  let fromPos: THREE.Vector3 | undefined, fromTarget: THREE.Vector3 | undefined, fromFov: number | undefined;
  if (blending) {
    fromPos = rm._camTransFrom.pos.clone();
    fromTarget = rm._camTransFrom.target.clone();
    fromFov = rm._camTransFrom.fov;
  }

  if (rm._replayCamMode === 0) {
    rm._replayOrbitAngle += dt * 0.15;
    const zoom: number = rm._replayZoom || 1;
    const r: number = 140 * zoom;
    const h: number = 100 * zoom;
    cam.position.x = Math.cos(rm._replayOrbitAngle) * r;
    cam.position.z = Math.sin(rm._replayOrbitAngle) * r;
    cam.position.y = h;
    cam.lookAt(0, 0, 0);
    const targetFov: number = 50 + (zoom - 1) * 10;
    cam.fov += (targetFov - cam.fov) * 2 * dt;
    cam.updateProjectionMatrix();
  } else if (rm._replayCamMode === 1) {
    const input: FreeCamInput = rm._freeCamInput || {};
    const speed: number = input.fast ? 80 : 30;

    const cosP: number = Math.cos(rm.host._freeCamPitch);
    const sinP: number = Math.sin(rm.host._freeCamPitch);
    const sinY: number = Math.sin(rm.host._freeCamYaw);
    const cosY: number = Math.cos(rm.host._freeCamYaw);
    const fwdX: number = sinY * cosP, fwdY: number = -sinP, fwdZ: number = cosY * cosP;
    const rightX: number = -cosY, rightZ: number = sinY;

    const tgtX: number = ((input.forward ? fwdX : 0) + (input.backward ? -fwdX : 0)
      + (input.right ? rightX : 0) + (input.left ? -rightX : 0)) * speed;
    const tgtY: number = ((input.forward ? fwdY : 0) + (input.backward ? -fwdY : 0)
      + (input.up ? speed : 0) + (input.down ? -speed : 0));
    const tgtZ: number = ((input.forward ? fwdZ : 0) + (input.backward ? -fwdZ : 0)
      + (input.right ? rightZ : 0) + (input.left ? -rightZ : 0)) * speed;

    const blend: number = 1 - Math.pow(0.001, dt);
    rm.host._freeCamVel.x += (tgtX - rm.host._freeCamVel.x) * blend;
    rm.host._freeCamVel.y += (tgtY - rm.host._freeCamVel.y) * blend;
    rm.host._freeCamVel.z += (tgtZ - rm.host._freeCamVel.z) * blend;
    rm.host._freeCamPos.addScaledVector(rm.host._freeCamVel, dt);

    const totalLookX: number = (input.lookX || 0) + (input.dpadLookX || 0);
    const totalLookY: number = (input.lookY || 0) + (input.dpadLookY || 0);
    if (totalLookX) rm.host._freeCamYaw -= totalLookX * 1.8 * dt;
    if (totalLookY) rm.host._freeCamPitch = Math.max(-1.5707, Math.min(1.5707, rm.host._freeCamPitch + totalLookY * 1.4 * dt));

    if (input.zoomDelta) {
      _zoomFwd.set(Math.sin(rm.host._freeCamYaw) * Math.cos(rm.host._freeCamPitch), -Math.sin(rm.host._freeCamPitch), Math.cos(rm.host._freeCamYaw) * Math.cos(rm.host._freeCamPitch));
      rm.host._freeCamPos.addScaledVector(_zoomFwd, -input.zoomDelta * 5);
      input.zoomDelta = 0;
    }

    cam.position.copy(rm.host._freeCamPos);
    _lookTarget.set(
      rm.host._freeCamPos.x + Math.sin(rm.host._freeCamYaw) * Math.cos(rm.host._freeCamPitch),
      rm.host._freeCamPos.y - Math.sin(rm.host._freeCamPitch),
      rm.host._freeCamPos.z + Math.cos(rm.host._freeCamYaw) * Math.cos(rm.host._freeCamPitch)
    );
    cam.lookAt(_lookTarget);
    cam.fov = 70;
    cam.updateProjectionMatrix();
  } else {
    const idx: number = rm._replayCamMode - 2;
    let state: PlayerState | undefined;
    if (idx === 0) {
      state = frame.player;
    } else {
      state = frame.ais[idx - 1];
    }
    if (state && state.alive) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fakePlayer: any = {
        mesh: { position: _fakePos.set(state.x, 0, state.z) },
        angle: state.angle,
        alive: true,
        boosting: state.boosting ?? false,
        dashing: state.dashing,
        drifting: false,
        driftBoosting: false,
        proximitySpeedBoost: 0,
        speed: state.speed ?? 0,
        velocityAngle: state.angle,
      };
      updateCamera(cam, fakePlayer, dt);
    } else {
      rm._replayCamMode = 0;
    }
  }

  if (blending) {
    rm._camTransition -= dt;
    const totalDur = 0.4;
    const t: number = Math.max(0, 1 - rm._camTransition / totalDur);
    const ease: number = t * t * (3 - 2 * t);
    const nx = cam.position.x, ny = cam.position.y, nz = cam.position.z;
    cam.getWorldDirection(_blendNewDir);
    const ntx = nx + _blendNewDir.x, nty = ny + _blendNewDir.y, ntz = nz + _blendNewDir.z;
    const newFov: number = cam.fov;

    cam.position.lerpVectors(fromPos!, _fakePos.set(nx, ny, nz), ease);
    _blendTarget.set(
      fromTarget!.x + (ntx - fromTarget!.x) * ease,
      fromTarget!.y + (nty - fromTarget!.y) * ease,
      fromTarget!.z + (ntz - fromTarget!.z) * ease
    );
    cam.lookAt(_blendTarget);
    cam.fov = fromFov! + (newFov - fromFov!) * ease;
    cam.updateProjectionMatrix();

    rm._camTransFrom.pos.copy(cam.position);
    cam.getWorldDirection(_blendCurDir);
    rm._camTransFrom.target.copy(cam.position).add(_blendCurDir);
    rm._camTransFrom.fov = cam.fov;
  }
}
