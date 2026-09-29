// ── Admin Panel: Camera Section ──────────────────────────
// Camera FOV/distance, rig tuning, collision tuning, camera profiles.

import * as THREE from 'three';
import {
  addHeader,
  addSlider,
  trackSlider,
} from './helpers';
import { setCameraFOV, setCameraDist, setCameraLookAhead, setCameraLerp, getCameraParams } from '../scene';
import { PROFILE_MAP } from '../camera/cameraProfiles';
import { CameraMode } from '../camera/types';
import { getRigTuning, setRigTuning } from '../camera/cameraRig';
import { getCollisionTuning as getCamCollisionTuning, setCollisionTuning as setCamCollisionTuning } from '../camera/cameraCollision';
import type { GameLike } from '../adminPanel';

export function addCameraSection(panel: HTMLDivElement, gameRef: GameLike | null): void {
  // ── Live Camera Coordinates ────────────────────────────
  const coordRow = document.createElement('div');
  Object.assign(coordRow.style, {
    padding: '6px 4px', marginBottom: '4px', borderBottom: '1px solid rgba(73,162,178,0.2)',
    fontFamily: 'monospace', fontSize: '10px', color: '#49A2B2', letterSpacing: '0.5px',
    lineHeight: '1.6',
  });
  coordRow.style.display = 'flex';
  coordRow.style.alignItems = 'center';
  coordRow.style.gap = '6px';
  const coordText = document.createElement('span');
  coordText.style.flex = '1';
  coordText.innerHTML = 'CAM <span id="admin-cam-coords">—</span><br>DIR <span id="admin-cam-dir">—</span>';
  coordRow.appendChild(coordText);
  const copyBtn = document.createElement('span');
  copyBtn.textContent = 'COPY';
  Object.assign(copyBtn.style, {
    cursor: 'pointer', padding: '3px 6px', fontSize: '9px', letterSpacing: '1px',
    border: '1px solid rgba(73,162,178,0.4)', color: '#49A2B2', flexShrink: '0',
    alignSelf: 'flex-start',
  });
  copyBtn.addEventListener('click', () => {
    const txt = coordText.textContent ?? '';
    navigator.clipboard.writeText(txt).then(() => {
      copyBtn.textContent = 'OK';
      setTimeout(() => { copyBtn.textContent = 'COPY'; }, 800);
    });
  });
  coordRow.appendChild(copyBtn);
  panel.appendChild(coordRow);
  const camCoordEl = coordRow.querySelector('#admin-cam-coords') as HTMLSpanElement;
  const camDirEl = coordRow.querySelector('#admin-cam-dir') as HTMLSpanElement;
  const cam = gameRef?.scene?.userData._camera as THREE.PerspectiveCamera | undefined;
  if (cam && camCoordEl && camDirEl) {
    const _dir = new THREE.Vector3();
    const tickCoords = (): void => {
      if (!panel?.isConnected) return; // panel closed
      const p = cam.position;
      camCoordEl.textContent = `x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)}`;
      cam.getWorldDirection(_dir);
      camDirEl.textContent = `x ${_dir.x.toFixed(2)}  y ${_dir.y.toFixed(2)}  z ${_dir.z.toFixed(2)}`;
      requestAnimationFrame(tickCoords);
    };
    requestAnimationFrame(tickCoords);
  }

  // ── Camera ──────────────────────────────────────────────
  addHeader('CAMERA', 'camera');
  const camParams = getCameraParams();
  trackSlider('camera', 'fov', addSlider('FOV', camParams.fov, 55, 90, 1, (v) => { setCameraFOV(v); }));
  trackSlider('camera', 'distance', addSlider('distance', camParams.dist, 9, 48, 1, (v) => { setCameraDist(v); }));
  trackSlider('camera', 'lookAhead', addSlider('lookAhead', camParams.lookAhead, 0, 25, 0.5, (v) => { setCameraLookAhead(v); }));
  trackSlider('camera', 'lerp', addSlider('smoothing', camParams.lerp, 1, 15, 0.5, (v) => { setCameraLerp(v); }));

  // ── Camera Rig Tuning ─────────────────────────────────────
  addHeader('CAMERA RIG', 'cam-rig');
  const rig = getRigTuning();
  trackSlider('cam-rig', 'dampLateral', addSlider('damp lateral', rig.DAMP_LATERAL, 2, 25, 0.5, (v) => { setRigTuning('DAMP_LATERAL', v); }));
  trackSlider('cam-rig', 'dampVertical', addSlider('damp vertical', rig.DAMP_VERTICAL, 2, 20, 0.5, (v) => { setRigTuning('DAMP_VERTICAL', v); }));
  trackSlider('cam-rig', 'dampDistance', addSlider('damp distance', rig.DAMP_DISTANCE, 1, 15, 0.5, (v) => { setRigTuning('DAMP_DISTANCE', v); }));
  trackSlider('cam-rig', 'lookAheadMin', addSlider('lookAhead min', rig.LOOK_AHEAD_MIN, 0, 10, 0.5, (v) => { setRigTuning('LOOK_AHEAD_MIN', v); }));
  trackSlider('cam-rig', 'lookAheadMax', addSlider('lookAhead max', rig.LOOK_AHEAD_MAX, 5, 40, 1, (v) => { setRigTuning('LOOK_AHEAD_MAX', v); }));
  trackSlider('cam-rig', 'pivotHeight', addSlider('pivot height', rig.PIVOT_HEIGHT, 0.3, 4, 0.1, (v) => { setRigTuning('PIVOT_HEIGHT', v); }));

  // ── Camera Collision Tuning ───────────────────────────────
  addHeader('CAMERA COLLISION', 'cam-collision');
  const col = getCamCollisionTuning();
  trackSlider('cam-collision', 'buffer', addSlider('collision buffer', col.COLLISION_BUFFER, 0.01, 1.0, 0.01, (v) => { setCamCollisionTuning('COLLISION_BUFFER', v); }));
  trackSlider('cam-collision', 'minDist', addSlider('min cam dist', col.MIN_CAMERA_DIST, 0.1, 3.0, 0.1, (v) => { setCamCollisionTuning('MIN_CAMERA_DIST', v); }));
  trackSlider('cam-collision', 'sweepRadius', addSlider('sweep radius', col.SWEEP_RADIUS, 0.1, 3.0, 0.1, (v) => { setCamCollisionTuning('SWEEP_RADIUS', v); }));
  trackSlider('cam-collision', 'crushThreshold', addSlider('crush threshold', col.CRUSH_THRESHOLD, 0.1, 0.8, 0.05, (v) => { setCamCollisionTuning('CRUSH_THRESHOLD', v); }));

  // ── Camera Profiles (per-mode tuning) ─────────────────────
  addHeader('CAMERA PROFILES', 'cam-profiles');
  const modeNames: Record<CameraMode, string> = {
    [CameraMode.Normal]: 'Normal',
    [CameraMode.Boost]: 'Boost',
    [CameraMode.Drift]: 'Drift',
    [CameraMode.DriftBoost]: 'DriftBoost',
    [CameraMode.Dash]: 'Dash',
  };
  for (const mode of [CameraMode.Normal, CameraMode.Boost, CameraMode.Drift, CameraMode.DriftBoost, CameraMode.Dash]) {
    const p = PROFILE_MAP[mode];
    const prefix = modeNames[mode];
    trackSlider('cam-profiles', `${prefix}-fovGain`, addSlider(`${prefix} fovSpeedGain`, p.fovSpeedGain, 0, 25, 0.5, (v) => { p.fovSpeedGain = v; }));
    trackSlider('cam-profiles', `${prefix}-distGain`, addSlider(`${prefix} distSpeedGain`, p.distSpeedGain, 0, 0.1, 0.005, (v) => { p.distSpeedGain = v; }));
    trackSlider('cam-profiles', `${prefix}-latOffset`, addSlider(`${prefix} latOffset`, p.latOffset, 0, 3, 0.1, (v) => { p.latOffset = v; }));
    trackSlider('cam-profiles', `${prefix}-headVel`, addSlider(`${prefix} headingVelBlend`, p.headingVelBlend, 0, 1, 0.05, (v) => { p.headingVelBlend = v; }));
    trackSlider('cam-profiles', `${prefix}-lookAhead`, addSlider(`${prefix} lookAheadGain`, p.lookAheadGain, 0.5, 2, 0.1, (v) => { p.lookAheadGain = v; }));
  }
}
