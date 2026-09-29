import * as THREE from 'three';
import { drawStreakField } from './drawStreakField';

let _cachedWallTexture: THREE.CanvasTexture | null = null;
let _prevWallTexture: THREE.CanvasTexture | null = null;

/** Build (or return cached) shooting-star streak texture used by both the
 *  arena_v2 ring wall and the classic 4-wall arena. */
export function getSharedWallTexture(): THREE.CanvasTexture {
  if (_cachedWallTexture) return _cachedWallTexture;

  const wallCanvas: HTMLCanvasElement = document.createElement('canvas');
  wallCanvas.width = 1024;
  wallCanvas.height = 256;
  const wCtx: CanvasRenderingContext2D = wallCanvas.getContext('2d')!;

  drawStreakField(wCtx, { width: 1024, height: 256, colorMode: 'teal' });

  if (_prevWallTexture) { _prevWallTexture.dispose(); _prevWallTexture = null; }
  _cachedWallTexture = new THREE.CanvasTexture(wallCanvas);
  _prevWallTexture = _cachedWallTexture;
  _cachedWallTexture.wrapS = THREE.RepeatWrapping;
  _cachedWallTexture.wrapT = THREE.ClampToEdgeWrapping;
  return _cachedWallTexture;
}
