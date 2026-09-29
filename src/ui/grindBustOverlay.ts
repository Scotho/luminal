// ── Grind BUSTED! Overlay (SPEC-82) ─────────────────────
// Fires on grind bail. Flashes "BUSTED!" with score snapshot, red vignette,
// shake, auto-hides after 800ms.

const TOTAL_DURATION_SEC = 0.8;

function injectStyles(): void {
  if (document.getElementById('grind-bust-styles')) return;
  const style = document.createElement('style');
  style.id = 'grind-bust-styles';
  style.textContent = `
    .grind-bust-root {
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 150;
      opacity: 0;
      transition: opacity 140ms ease-out;
      --bust-color: #ff2844;
    }
    .grind-bust-root.visible {
      opacity: 1;
    }
    .grind-bust-vignette {
      position: absolute;
      inset: 0;
      background: radial-gradient(
        ellipse at center,
        transparent 35%,
        rgba(255, 40, 68, 0.45) 100%
      );
      pointer-events: none;
    }
    .grind-bust-title {
      font-family: 'Orbitron', 'Rajdhani', monospace;
      font-size: 5rem;
      font-weight: 900;
      color: var(--bust-color, #ff2844);
      text-shadow:
        0 0 16px var(--bust-color, #ff2844),
        0 0 48px var(--bust-color, #ff2844);
      letter-spacing: 0.12em;
      z-index: 1;
    }
    .grind-bust-score {
      font-family: 'Orbitron', monospace;
      font-size: 1.6rem;
      font-weight: 700;
      color: #fff;
      opacity: 0.75;
      margin-top: 12px;
      letter-spacing: 0.08em;
      z-index: 1;
    }
    @keyframes bust-title-punch {
      0%   { transform: scale(0.6); }
      50%  { transform: scale(1.15); }
      100% { transform: scale(1.0); }
    }
    .grind-bust-title.punch {
      animation: bust-title-punch 250ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .grind-bust-root.shake {
      animation: grind-bust-shake 0.2s ease-out;
    }
    @keyframes grind-bust-shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-6px); }
      40% { transform: translateX(5px); }
      60% { transform: translateX(-3px); }
      80% { transform: translateX(2px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .grind-bust-title.punch { animation: none; }
      .grind-bust-root.shake { animation: none; }
    }
  `;
  document.head.appendChild(style);
}

export class GrindBustOverlay {
  private _root: HTMLDivElement;
  private _titleEl: HTMLDivElement;
  private _scoreEl: HTMLDivElement;
  private _vignette: HTMLDivElement;
  private _timer = 0;
  private _active = false;

  constructor() {
    injectStyles();

    this._root = document.createElement('div');
    this._root.className = 'grind-bust-root';

    this._vignette = document.createElement('div');
    this._vignette.className = 'grind-bust-vignette';
    this._root.appendChild(this._vignette);

    this._titleEl = document.createElement('div');
    this._titleEl.className = 'grind-bust-title';
    this._titleEl.textContent = 'BUSTED!';
    this._root.appendChild(this._titleEl);

    this._scoreEl = document.createElement('div');
    this._scoreEl.className = 'grind-bust-score';
    this._root.appendChild(this._scoreEl);

    document.body.appendChild(this._root);
  }

  flash(bustScore: number, colorHex: number): void {
    const r = (colorHex >> 16) & 0xff;
    const g = (colorHex >> 8) & 0xff;
    const b = colorHex & 0xff;
    this._root.style.setProperty('--bust-color', `rgb(${r},${g},${b})`);
    this._scoreEl.textContent = `-${Math.round(bustScore).toLocaleString('en-US')}`;
    this._root.classList.add('visible');
    // Title scale punch fires first
    this._titleEl.classList.remove('punch');
    void this._titleEl.offsetWidth;
    this._titleEl.classList.add('punch');
    // Shake starts 50ms after punch for layered impact
    this._root.classList.remove('shake');
    setTimeout(() => {
      this._root.classList.remove('shake');
      void this._root.offsetWidth;
      this._root.classList.add('shake');
    }, 50);
    this._timer = TOTAL_DURATION_SEC;
    this._active = true;
  }

  update(dt: number): void {
    if (!this._active) return;
    this._timer -= dt;
    if (this._timer <= 0) {
      this._active = false;
      this._root.classList.remove('visible');
      this._root.classList.remove('shake');
      this._titleEl.classList.remove('punch');
    }
  }

  dispose(): void {
    this._active = false;
    this._root.remove();
  }
}
