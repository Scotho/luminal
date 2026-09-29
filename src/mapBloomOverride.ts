// Tiny decoupling layer for per-map bloom overrides.
//
// scene.ts owns the bloom pass, but grid.ts is where map switches happen.
// Importing scene.ts directly from grid.ts would pull the camera module
// (and all its downstream mocks) into every grid test. Keep the surface
// here — one setter that scene.ts calls during createScene(), one function
// grid.ts calls on map switch.

import type { MapType, GfxSettings } from './types/index';

let _apply: ((mapType: MapType, gfx: GfxSettings) => void) | null = null;

/** Called once by scene.ts during createScene() to register the actual
 *  bloom pass writer. Grid.ts's applyMapBloomOverride becomes a no-op until
 *  this is registered. */
export function registerBloomApplier(fn: (mapType: MapType, gfx: GfxSettings) => void): void {
  _apply = fn;
}

/** Called from grid.ts after a map builder finishes. Routes through the
 *  registered scene.ts writer when available; silently no-ops in
 *  environments where scene.ts never ran (e.g., most unit tests). */
export function applyMapBloomOverride(mapType: MapType, gfx: GfxSettings): void {
  if (_apply) _apply(mapType, gfx);
}

// Test-only escape hatch.
export function __resetBloomApplier(): void {
  _apply = null;
}
