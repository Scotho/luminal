// ── Globe Backdrop for FIND MATCH screen ────────────────
// Renders a slowly rotating cobe globe behind the online overlay content.
// Uses the Luminal teal/ink palette so it feels like a subtle holographic map.

import createGlobe, { type Globe } from 'cobe';

let globe: Globe | null = null;
let wrapper: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let frameId = 0;

/**
 * Create (or re-show) the globe canvas inside #online-overlay.
 * Call this every time the online screen becomes visible.
 */
export function showGlobe(): void {
  const overlay = document.getElementById('online-overlay');
  if (!overlay) return;

  // Already mounted — just make visible
  if (wrapper) {
    wrapper.style.opacity = '0.8';
    return;
  }

  wrapper = document.createElement('div');
  wrapper.id = 'globe-backdrop';
  canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  wrapper.appendChild(canvas);
  overlay.appendChild(wrapper);

  initGlobe(canvas);
}

/** Fade out the globe when leaving the online screen. */
export function hideGlobe(): void {
  if (wrapper) wrapper.style.opacity = '0';
}

// ── Internal ────────────────────────────────────────────

function initGlobe(el: HTMLCanvasElement): void {
  const size = Math.min(el.offsetWidth, 520) || 420;
  let phi = 0.3;

  // Palette-matched colors (RGB 0–1):
  // baseColor  → dark ink-teal (close to --bg-panel 5,20,22)
  // glowColor  → deep teal shadow (--teal-800 11,54,61)
  // markerColor → bright teal (--teal-500 73,162,178)
  globe = createGlobe(el, {
    devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    width: size,
    height: size,
    phi: 0.3,
    theta: 0.18,
    dark: 1,
    diffuse: 2.2,
    mapSamples: 16000,
    mapBrightness: 4.5,
    baseColor: [0.04, 0.13, 0.15],
    markerColor: [0.35, 0.72, 0.78],
    glowColor: [0.08, 0.32, 0.36],
    markers: [],
  });

  // Slow auto-rotate via rAF loop
  function spin() {
    phi += 0.002;
    globe!.update({ phi });
    frameId = requestAnimationFrame(spin);
  }
  frameId = requestAnimationFrame(spin);

  // Fade in after first paint
  requestAnimationFrame(() => { if (wrapper) wrapper.style.opacity = '0.8'; });
}
