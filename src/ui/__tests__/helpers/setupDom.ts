// ── DOM Setup for UI Tests ──────────────────────────────
// Loads the real index.html body into jsdom before any UI module is imported.
// This must run via vitest setupFiles so module-scope getElementById calls work.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { vi } from 'vitest';

const raw = readFileSync(resolve(__dirname, '../../../../index.html'), 'utf-8');

// Expand <!-- @include "path" --> directives (same logic as the Vite plugin, recursive)
const root = resolve(__dirname, '../../../..');
const INCLUDE_RE = /<!--\s*@include\s+"([^"]+)"\s*-->/g;
let html = raw;
while (INCLUDE_RE.test(html)) {
  INCLUDE_RE.lastIndex = 0;
  html = html.replace(
    INCLUDE_RE,
    (_, filePath: string) => readFileSync(resolve(root, filePath), 'utf-8'),
  );
}

// Extract <body> content
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (bodyMatch) {
  document.body.innerHTML = bodyMatch[1];
}

// Extract <svg> sprite from <body> (it's the first thing in body)
// Already included in body content above — no extra work needed.

// ── Stub browser APIs not available in jsdom ────────────

// window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// HTMLCanvasElement.getContext — jsdom doesn't support canvas
const mockCtx = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  scale: vi.fn(),
  drawImage: vi.fn(),
  setTransform: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  measureText: vi.fn(() => ({ width: 0 })),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  canvas: { width: 300, height: 150 },
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  shadowBlur: 0,
  shadowColor: 'rgba(0,0,0,0)',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
};

vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);

// ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

// requestAnimationFrame / cancelAnimationFrame (basic stubs)
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number);
  window.cancelAnimationFrame = vi.fn((id: number) => clearTimeout(id));
}

// AudioContext stub
vi.stubGlobal('AudioContext', vi.fn(() => ({
  createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })),
  createAnalyser: vi.fn(() => ({ connect: vi.fn(), fftSize: 0, frequencyBinCount: 0, getByteFrequencyData: vi.fn() })),
  createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
  destination: {},
  state: 'running',
  resume: vi.fn(),
})));

// Performance.memory (non-standard)
if (!performance.memory) {
  Object.defineProperty(performance, 'memory', {
    value: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
    writable: true,
  });
}
