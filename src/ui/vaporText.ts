// ── Vaporize Text Effect ──────────────────────────────────
// Canvas-based particle text that cycles: fade in → hold → vaporize → repeat.
// Ported from a React component to vanilla TS for the loading screen.

interface Particle {
  x: number;
  y: number;
  originalX: number;
  originalY: number;
  color: string;
  opacity: number;
  originalAlpha: number;
  velocityX: number;
  velocityY: number;
  angle: number;
  speed: number;
  shouldFadeQuickly?: boolean;
}

interface TextBoundaries {
  left: number;
  right: number;
  width: number;
}

interface VaporTextOptions {
  font?: string;
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: number;
  color?: string;
  spread?: number;
  density?: number;
  vaporizeDuration?: number;
  fadeInDuration?: number;
  holdDuration?: number;
}

let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;
let _particles: Particle[] = [];
let _boundaries: TextBoundaries | null = null;
let _raf = 0;
let _onResize: (() => void) | null = null;
let _text = '';
let _opts: Required<VaporTextOptions>;
let _dpr = 1;
let _state: 'idle' | 'fadeIn' | 'hold' | 'vaporize' = 'idle';
let _progress = 0; // 0-1 for fade-in, 0-100+ for vaporize sweep
let _holdTimer = 0;

const DEFAULTS: Required<VaporTextOptions> = {
  font: 'Orbitron, sans-serif',
  fontSize: 13,
  fontWeight: 400,
  letterSpacing: 6,
  color: 'rgba(255,255,255,0.4)',
  spread: 5,
  density: 5,
  vaporizeDuration: 2,
  fadeInDuration: 0.8,
  holdDuration: 1.5,
};

function _clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }

function _transformDensity(d: number): number {
  // Map 0-10 → 0.3-1
  return _clamp(0.3 + (d / 10) * 0.7, 0.3, 1);
}

function _calcSpread(fontSize: number): number {
  if (fontSize <= 20) return 0.2;
  if (fontSize >= 100) return 1.5;
  if (fontSize <= 50) return 0.2 + (fontSize - 20) * (0.5 - 0.2) / (50 - 20);
  return 0.5 + (fontSize - 50) * (1.5 - 0.5) / (100 - 50);
}

function _parseColor(color: string): string {
  const rgba = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${rgba[4] ?? '1'})`;
  return 'rgba(255, 255, 255, 1)';
}

function _createParticles(): void {
  if (!_canvas || !_ctx) return;
  const ctx = _ctx;
  const w = _canvas.width;
  const h = _canvas.height;

  ctx.clearRect(0, 0, w, h);

  const scaledSize = _opts.fontSize * _dpr;
  const font = `${_opts.fontWeight} ${scaledSize}px ${_opts.font}`;
  const color = _parseColor(_opts.color);

  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (_opts.letterSpacing) {
    ctx.letterSpacing = `${_opts.letterSpacing * _dpr}px`;
  }

  const textX = w / 2;
  const textY = h / 2;
  ctx.fillText(_text, textX, textY);

  const metrics = ctx.measureText(_text);
  const textWidth = metrics.width;
  const textLeft = textX - textWidth / 2;
  _boundaries = { left: textLeft, right: textLeft + textWidth, width: textWidth };

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const baseDPR = 3;
  const currentDPR = _dpr;
  const sampleRate = Math.max(1, Math.round(currentDPR / baseDPR));

  _particles = [];
  for (let y = 0; y < h; y += sampleRate) {
    for (let x = 0; x < w; x += sampleRate) {
      const idx = (y * w + x) * 4;
      const alpha = data[idx + 3];
      if (alpha > 0) {
        const originalAlpha = (alpha / 255) * (sampleRate / currentDPR);
        _particles.push({
          x, y,
          originalX: x, originalY: y,
          color: `rgba(${data[idx]}, ${data[idx + 1]}, ${data[idx + 2]}, ${originalAlpha})`,
          opacity: originalAlpha,
          originalAlpha,
          velocityX: 0, velocityY: 0,
          angle: 0, speed: 0,
        });
      }
    }
  }

  ctx.clearRect(0, 0, w, h);
  // Reset letter spacing
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

function _resetParticles(): void {
  for (const p of _particles) {
    p.x = p.originalX;
    p.y = p.originalY;
    p.opacity = p.originalAlpha;
    p.speed = 0;
    p.velocityX = 0;
    p.velocityY = 0;
    p.shouldFadeQuickly = undefined;
  }
}

function _renderParticles(opacity: number): void {
  if (!_ctx) return;
  _ctx.save();
  _ctx.scale(_dpr, _dpr);
  for (const p of _particles) {
    if (p.opacity <= 0) continue;
    const a = Math.min(opacity, 1) * p.opacity;
    const c = p.color.replace(/[\d.]+\)$/, `${a})`);
    _ctx.fillStyle = c;
    _ctx.fillRect(p.x / _dpr, p.y / _dpr, 1, 1);
  }
  _ctx.restore();
}

function _updateVaporize(dt: number): boolean {
  if (!_boundaries) return true;
  const MULTIPLIED_SPREAD = _calcSpread(_opts.fontSize) * _opts.spread;
  const VAPORIZE_MS = _opts.vaporizeDuration * 1000;
  const density = _transformDensity(_opts.density);

  const vaporizeX = _boundaries.left + _boundaries.width * Math.min(100, _progress) / 100;
  let allDone = true;

  for (const p of _particles) {
    if (p.originalX > vaporizeX) { allDone = false; continue; }

    if (p.speed === 0) {
      p.angle = Math.random() * Math.PI * 2;
      p.speed = (Math.random() + 0.5) * MULTIPLIED_SPREAD;
      p.velocityX = Math.cos(p.angle) * p.speed;
      p.velocityY = Math.sin(p.angle) * p.speed;
      p.shouldFadeQuickly = Math.random() > density;
    }

    if (p.shouldFadeQuickly) {
      p.opacity = Math.max(0, p.opacity - dt);
    } else {
      const dx = p.originalX - p.x;
      const dy = p.originalY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const damping = Math.max(0.95, 1 - dist / (100 * MULTIPLIED_SPREAD));
      const spread = MULTIPLIED_SPREAD * 3;
      p.velocityX = (p.velocityX + (Math.random() - 0.5) * spread + dx * 0.002) * damping;
      p.velocityY = (p.velocityY + (Math.random() - 0.5) * spread + dy * 0.002) * damping;
      const maxV = MULTIPLIED_SPREAD * 2;
      const curV = Math.sqrt(p.velocityX * p.velocityX + p.velocityY * p.velocityY);
      if (curV > maxV) { const s = maxV / curV; p.velocityX *= s; p.velocityY *= s; }
      p.x += p.velocityX * dt * 20;
      p.y += p.velocityY * dt * 10;
      const fadeRate = 0.25 * (2000 / VAPORIZE_MS);
      p.opacity = Math.max(0, p.opacity - dt * fadeRate);
    }

    if (p.opacity > 0.01) allDone = false;
  }
  return allDone;
}

function _resize(): void {
  if (!_canvas) return;
  const parent = _canvas.parentElement;
  if (!parent) return;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  _dpr = Math.min(window.devicePixelRatio * 1.5 || 1, 4);
  _canvas.style.width = `${w}px`;
  _canvas.style.height = `${h}px`;
  _canvas.width = Math.floor(w * _dpr);
  _canvas.height = Math.floor(h * _dpr);
  _createParticles();
}

// ── Public API ───────────────────────────────────────────

export function startVaporText(canvas: HTMLCanvasElement, text: string, options?: VaporTextOptions): void {
  _canvas = canvas;
  _ctx = canvas.getContext('2d');
  if (!_ctx) return;
  _text = text;
  _opts = { ...DEFAULTS, ...options };
  _state = 'idle';
  _progress = 0;

  _resize();
  _onResize = _resize;
  window.addEventListener('resize', _resize);

  let lastTime = performance.now();

  function loop(now: number): void {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    if (!_canvas || !_ctx) return;
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

    switch (_state) {
      case 'idle':
        // Wait for trigger
        break;

      case 'fadeIn':
        _progress = Math.min(1, _progress + dt / _opts.fadeInDuration);
        _renderParticles(_progress);
        if (_progress >= 1) {
          _state = 'hold';
          _holdTimer = 0;
        }
        break;

      case 'hold':
        _renderParticles(1);
        _holdTimer += dt;
        if (_holdTimer >= _opts.holdDuration) {
          _state = 'vaporize';
          _progress = 0;
        }
        break;

      case 'vaporize': {
        _progress += dt * 100 / _opts.vaporizeDuration;
        const allDone = _updateVaporize(dt);
        _renderParticles(1);
        if (_progress >= 100 && allDone) {
          // Reset and fade in again
          _resetParticles();
          _state = 'fadeIn';
          _progress = 0;
        }
        break;
      }
    }

    _raf = requestAnimationFrame(loop);
  }

  _raf = requestAnimationFrame(loop);
}

/** Trigger the fade-in → hold → vaporize cycle */
export function triggerVaporText(): void {
  if (_state !== 'idle' && _state !== 'fadeIn') return;
  _resetParticles();
  _state = 'fadeIn';
  _progress = 0;
}

/** Update the displayed text (e.g. when gamepad is connected) */
export function setVaporText(text: string): void {
  if (text === _text) return;
  _text = text;
  if (_canvas) {
    _resize(); // re-create particles with new text
    // Restart current cycle
    _resetParticles();
    if (_state !== 'idle') {
      _state = 'fadeIn';
      _progress = 0;
    }
  }
}

export function stopVaporText(): void {
  if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
  if (_onResize) { window.removeEventListener('resize', _onResize); _onResize = null; }
  _particles = [];
  _canvas = null;
  _ctx = null;
  _state = 'idle';
}
