// ── Admin Panel: Freecam Section ────────────────────────
// Freecam mode toggle + keyboard/mouse input for free camera movement.

import * as THREE from 'three';
import type { GameLike } from '../adminPanel';

export interface FreecamRefs {
  cleanup: (() => void) | null;
  tickFn: (() => void) | null;
}

export function addFreecamSection(
  panel: HTMLDivElement,
  gameRef: GameLike | null,
  renderer: THREE.WebGLRenderer | null,
  _destroyAdminPanel: () => void,
): FreecamRefs {
  const refs: FreecamRefs = { cleanup: null, tickFn: null };

  const freecamBtn = document.createElement('div');
  freecamBtn.textContent = gameRef?.adminFreecam ? 'FREECAM: ON' : 'FREECAM: OFF';
  const updateFcStyle = (on: boolean): void => {
    freecamBtn.textContent = on ? 'FREECAM: ON  (click canvas → mouse look)' : 'FREECAM: OFF';
    freecamBtn.style.color = on ? '#4ae8a7' : '#888';
    freecamBtn.style.borderColor = on ? 'rgba(74,232,167,0.4)' : 'rgba(73,162,178,0.2)';
    freecamBtn.style.background = on ? 'rgba(74,232,167,0.06)' : 'transparent';
  };
  Object.assign(freecamBtn.style, {
    padding: '6px 10px', textAlign: 'center', cursor: 'pointer',
    color: '#888', border: '1px solid rgba(73,162,178,0.2)',
    marginBottom: '8px', fontSize: '11px', letterSpacing: '2px', fontWeight: 'bold',
    transition: 'all 0.15s',
  });
  updateFcStyle(!!gameRef?.adminFreecam);

  // Keyboard state for freecam WASD
  const _fcKeys: Record<string, boolean> = {};
  const _fcKeyHandler = (e: KeyboardEvent): void => {
    if (!gameRef?.adminFreecam) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    _fcKeys[e.code] = e.type === 'keydown';
  };
  window.addEventListener('keydown', _fcKeyHandler);
  window.addEventListener('keyup', _fcKeyHandler);

  // Clear freecam keys when window loses focus (prevents stuck movement on alt-tab)
  const _fcClearKeys = (): void => { for (const k in _fcKeys) _fcKeys[k] = false; };
  const _fcVisChange = (): void => { if (document.hidden) _fcClearKeys(); };
  window.addEventListener('blur', _fcClearKeys);
  document.addEventListener('visibilitychange', _fcVisChange);

  // Mouse look via pointer lock
  const canvas = renderer?.domElement as HTMLCanvasElement | undefined;
  const _fcMouseMove = (e: MouseEvent): void => {
    if (!gameRef?.adminFreecam || !document.pointerLockElement) return;
    gameRef._freeCamYaw -= e.movementX * 0.002;
    gameRef._freeCamPitch = Math.max(-1.5707, Math.min(1.5707, gameRef._freeCamPitch + e.movementY * 0.002));
  };
  const _fcClick = (): void => {
    if (gameRef?.adminFreecam && canvas && !document.pointerLockElement) {
      canvas.requestPointerLock();
    }
  };
  document.addEventListener('mousemove', _fcMouseMove);
  if (canvas) canvas.addEventListener('click', _fcClick);

  // Store cleanup refs
  refs.cleanup = () => {
    window.removeEventListener('keydown', _fcKeyHandler);
    window.removeEventListener('keyup', _fcKeyHandler);
    window.removeEventListener('blur', _fcClearKeys);
    document.removeEventListener('visibilitychange', _fcVisChange);
    document.removeEventListener('mousemove', _fcMouseMove);
    if (canvas) canvas.removeEventListener('click', _fcClick);
    if (gameRef) {
      gameRef.adminFreecam = false;
      gameRef.adminFreecamInput = {};
    }
    if (document.pointerLockElement) document.exitPointerLock();
  };

  // Update input each frame in the perf ticker
  refs.tickFn = () => {
    if (!gameRef?.adminFreecam) return;
    gameRef.adminFreecamInput = {
      forward: _fcKeys['KeyW'] || _fcKeys['ArrowUp'],
      backward: _fcKeys['KeyS'] || _fcKeys['ArrowDown'],
      left: _fcKeys['KeyA'] || _fcKeys['ArrowLeft'],
      right: _fcKeys['KeyD'] || _fcKeys['ArrowRight'],
      up: _fcKeys['Space'],
      down: _fcKeys['ShiftLeft'] || _fcKeys['ShiftRight'],
      fast: _fcKeys['ControlLeft'] || _fcKeys['ControlRight'],
    };
  };

  freecamBtn.addEventListener('click', () => {
    if (!gameRef) return;
    const on = !gameRef.adminFreecam;
    gameRef.adminFreecam = on;
    if (on) {
      // Seed freecam at current camera position
      gameRef._freeCamPos.copy(gameRef.camera.position);
      const dir = new THREE.Vector3();
      gameRef.camera.getWorldDirection(dir);
      gameRef._freeCamYaw = Math.atan2(dir.x, dir.z);
      gameRef._freeCamPitch = -Math.asin(dir.y);
    } else {
      gameRef.adminFreecamInput = {};
      if (document.pointerLockElement) document.exitPointerLock();
    }
    updateFcStyle(on);
  });
  panel.appendChild(freecamBtn);

  return refs;
}
