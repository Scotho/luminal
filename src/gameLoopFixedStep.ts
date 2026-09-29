// ── Game Loop — per-frame update/render step ──────────────
// Extracted from gameLoop.ts to keep loop() thin. Handles the per-frame
// simulation tick, renderer dispatch, and post-frame canvas updates.

import { drawPulseCanvas, updateAmbientEQ } from './ui/effects';
import { getGfx } from './graphics';
import { getArenaReactive } from './grid';

interface FixedStepDeps {
  game: {
    state: string;
    update(dt: number): void;
    _lastBands?: { kick: number } | null;
  };
  composer: { render(): void };
  sanitizeRenderState: () => void;
  isAudioStarted: () => boolean;
}

let _cachedTitleEl: HTMLElement | null = null;
let _lastTitleK: number = -1;

let _reflectFrame = 0;
const REFLECT_INTERVAL_HIGH = 3;
const REFLECT_INTERVAL_ULTRA = 2;

/** Reset frame counter — exposed for tests. */
export function _resetReflectFrame(): void { _reflectFrame = 0; }

/**
 * Pulse the menu logo in response to audio kick band.
 * Cached DOM lookup — only updates style when value changes meaningfully.
 */
export function updateTitlePulse(
  gameState: string,
  isAudioStarted: boolean,
  lastBands: { kick: number } | null | undefined,
): void {
  if (gameState === 'menu' && isAudioStarted && getGfx().audioReactivity !== 'off') {
    if (!_cachedTitleEl) _cachedTitleEl = document.querySelector('#overlay .game-logo--menu');
    if (_cachedTitleEl && lastBands) {
      const k: number = lastBands.kick * lastBands.kick;
      if (Math.abs(k - _lastTitleK) > 0.01) {
        _cachedTitleEl.style.filter = `drop-shadow(0 0 ${8 + k * 15}px rgba(170,50,255,${0.4 + k * 0.3})) drop-shadow(0 0 ${25 + k * 20}px rgba(0,200,255,${0.1 + k * 0.15}))`;
        _lastTitleK = k;
      }
    }
  } else {
    _lastTitleK = -1;
  }
}

/**
 * Run the per-frame sim update, render the composer, and drive the pulse canvas.
 * Called once per RAF tick after input polling and navigation handling.
 */
export function stepAndRender(dt: number, deps: FixedStepDeps): void {
  updateTitlePulse(deps.game.state, deps.isAudioStarted(), deps.game._lastBands);
  updateAmbientEQ();
  deps.game.update(dt);
  if (import.meta.env.DEV) deps.sanitizeRenderState();
  // ── Reflector frame-skip: render reflection every Nth frame ──
  _reflectFrame++;
  const reactive = getArenaReactive();
  if (reactive?.reflector) {
    const interval = getGfx().reflections === 'ultra'
      ? REFLECT_INTERVAL_ULTRA
      : REFLECT_INTERVAL_HIGH;
    reactive.reflector.forceUpdate = (_reflectFrame % interval === 0);
  }
  deps.composer.render();
  drawPulseCanvas();
}
