// ── /gfx — Graphics diagnostics ──────────────────────────
// Extracted from debugLog.ts for file-size compliance.

import { getGfx } from './graphics';
import type * as THREE from 'three';

// ── Registration — shared refs injected by debugLog.ts ──
let _game: { scene?: THREE.Scene } | null = null;
let _renderer: THREE.WebGLRenderer | null = null;

/** Called by registerDebugRefs() in debugLog.ts. */
export function registerGfxRefs(
  game: { scene?: THREE.Scene } | null,
  renderer: THREE.WebGLRenderer | null,
): void {
  _game = game;
  _renderer = renderer;
}

export function getGfxLog(): string {
  const lines: string[] = ['── GFXLOG ──'];
  const ts = new Date().toISOString().slice(11, 23);
  lines.push(`time: ${ts}`);

  // Settings
  const gfx = getGfx();
  lines.push(`preset: ${gfx.preset}`);
  lines.push(`bloom: str=${gfx.bloom.strength} r=${gfx.bloom.radius} t=${gfx.bloom.threshold} | antialias: ${gfx.antialias}`);
  lines.push(`pixelRatio: ${gfx.pixelRatio} | devicePR: ${window.devicePixelRatio.toFixed(2)}`);
  lines.push(`arenaDetail: ${gfx.arenaDetail} | lighting: ${gfx.lighting}`);
  lines.push(`playerVFX: ${gfx.playerVFX} | atmosphere: ${gfx.atmosphere}`);
  lines.push(`raveSpotlights: ${gfx.raveSpotlights} | audioReactivity: ${gfx.audioReactivity}`);

  // Viewport
  lines.push(`viewport: ${window.innerWidth}x${window.innerHeight}`);

  // Renderer info
  if (_renderer) {
    const info = _renderer.info;
    lines.push('── RENDERER ──');
    lines.push(`drawCalls: ${info.render.calls} | triangles: ${info.render.triangles}`);
    lines.push(`geometries: ${info.memory.geometries} | textures: ${info.memory.textures}`);
    lines.push(`programs: ${info.programs?.length ?? '?'}`);
  } else {
    lines.push('renderer: not registered');
  }

  // Scene stats
  if (_game) {
    let meshCount = 0;
    let lightCount = 0;
    let totalObjects = 0;
    const scene = _game.scene;
    if (scene) {
      scene.traverse((obj: THREE.Object3D) => {
        totalObjects++;
        if ((obj as THREE.Mesh).isMesh) meshCount++;
        if ((obj as THREE.Light).isLight) lightCount++;
      });
      lines.push(`sceneObjects: ${totalObjects} | meshes: ${meshCount} | lights: ${lightCount}`);
    }
  }

  // GPU context info
  if (_renderer) {
    const gl = _renderer.getContext();
    const gpuName = gl.getParameter(gl.RENDERER);
    if (gpuName) lines.push(`gpu: ${gpuName}`);
  }

  return lines.join('\n');
}
