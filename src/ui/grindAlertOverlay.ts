/**
 * Screen-edge flash overlay — CSS-only (no Three.js).
 * Flashes edges when an enemy grinds the local player's trail.
 */

const GRADIENT_DEPTH = '80px';

function createEdge(side: 'top' | 'bottom' | 'left' | 'right'): HTMLDivElement {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.pointerEvents = 'none';
  el.style.opacity = '0';
  el.style.zIndex = '9999';

  switch (side) {
    case 'top':
      el.style.top = '0'; el.style.left = '0'; el.style.right = '0';
      el.style.height = GRADIENT_DEPTH;
      break;
    case 'bottom':
      el.style.bottom = '0'; el.style.left = '0'; el.style.right = '0';
      el.style.height = GRADIENT_DEPTH;
      break;
    case 'left':
      el.style.top = '0'; el.style.bottom = '0'; el.style.left = '0';
      el.style.width = GRADIENT_DEPTH;
      break;
    case 'right':
      el.style.top = '0'; el.style.bottom = '0'; el.style.right = '0';
      el.style.width = GRADIENT_DEPTH;
      break;
  }
  return el;
}

function hexToCSS(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

function setGradient(el: HTMLDivElement, side: 'top' | 'bottom' | 'left' | 'right', color: string): void {
  const from = color + '33'; // 20% opacity
  const to = 'transparent';
  const dirs: Record<string, string> = {
    top: 'to bottom',
    bottom: 'to top',
    left: 'to right',
    right: 'to left',
  };
  el.style.background = `linear-gradient(${dirs[side]}, ${from}, ${to})`;
}

type Side = 'top' | 'bottom' | 'left' | 'right';
const SIDES: Side[] = ['top', 'bottom', 'left', 'right'];

export class GrindAlertOverlay {
  private _edges: Map<Side, HTMLDivElement> = new Map();
  private _opacity = 0;
  private _duration = 0;
  private _elapsed = 0;
  private _active = false;

  constructor(container?: HTMLElement) {
    const parent = container ?? document.getElementById('game-container') ?? document.body;
    for (const side of SIDES) {
      const el = createEdge(side);
      parent.appendChild(el);
      this._edges.set(side, el);
    }
  }

  flash(colorHex: number, durationSec: number): void {
    const css = hexToCSS(colorHex);
    for (const side of SIDES) {
      const el = this._edges.get(side)!;
      setGradient(el, side, css);
    }
    this._opacity = 1;
    this._duration = durationSec;
    this._elapsed = 0;
    this._active = true;
  }

  update(dt: number): void {
    if (!this._active) return;
    this._elapsed += dt;
    if (this._elapsed >= this._duration) {
      this._opacity = 0;
      this._active = false;
    } else {
      // Ease-out decay: opacity = (1 - t)^2
      const t = this._elapsed / this._duration;
      this._opacity = (1 - t) * (1 - t);
    }
    for (const [side, el] of this._edges.entries()) {
      const mult = (side === 'top' || side === 'bottom') ? 1.3 : 1.0;
      el.style.opacity = String(Math.min(1, this._opacity * mult));
    }
  }

  dispose(): void {
    for (const el of this._edges.values()) {
      el.remove();
    }
    this._edges.clear();
  }
}
