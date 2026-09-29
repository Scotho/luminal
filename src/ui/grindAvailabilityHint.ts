// ── Grind Availability Hint (TASK-265) ─────────────────
// Pre-grind UI cue. Fades in when the player is within snap range of a
// grindable trail and could press Space to engage. Fades out instantly on
// actual grind entry so it never competes with the in-grind balance bar.

const FADE_IN_MS = 180;
const FADE_OUT_MS = 120;

function injectStyles(): void {
  if (document.getElementById('grind-avail-styles')) return;
  const style = document.createElement('style');
  style.id = 'grind-avail-styles';
  style.textContent = `
    .grind-avail-root {
      position: fixed;
      bottom: 26%;
      left: 50%;
      transform: translate(-50%, 0);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      pointer-events: none;
      z-index: 115;
      opacity: 0;
      transition: opacity ${FADE_IN_MS}ms ease-out, transform ${FADE_IN_MS}ms cubic-bezier(.2,.9,.3,1.2);
      filter: drop-shadow(0 0 14px var(--avail-glow, #00d4ff));
      --avail-glow: #00d4ff;
    }
    .grind-avail-root.visible {
      opacity: 1;
      transform: translate(-50%, -6px);
    }
    .grind-avail-root.hiding {
      transition: opacity ${FADE_OUT_MS}ms ease-in;
      opacity: 0;
    }
    .grind-avail-chevron {
      font-family: 'Orbitron', 'Rajdhani', sans-serif;
      font-size: 1.4rem;
      font-weight: 900;
      color: var(--avail-glow, #00d4ff);
      text-shadow:
        0 0 8px var(--avail-glow, #00d4ff),
        0 0 20px var(--avail-glow, #00d4ff);
      line-height: 0.8;
      animation: grind-avail-bob 1.1s ease-in-out infinite;
    }
    .grind-avail-label {
      font-family: 'Orbitron', 'Rajdhani', monospace;
      font-size: 1.0rem;
      font-weight: 900;
      letter-spacing: 0.28em;
      color: #fff;
      text-shadow:
        0 0 8px var(--avail-glow, #00d4ff),
        0 0 18px var(--avail-glow, #00d4ff),
        0 0 32px var(--avail-glow, #00d4ff);
      line-height: 1;
      padding: 0.25rem 0.85rem;
      border: 1px solid var(--avail-glow, #00d4ff);
      border-radius: 3px;
      background: linear-gradient(180deg,
        rgba(4, 10, 22, 0.82) 0%,
        rgba(0, 0, 0, 0.6) 100%);
      box-shadow:
        inset 0 0 10px rgba(0, 212, 255, 0.12),
        0 0 18px rgba(0, 212, 255, 0.35);
      clip-path: polygon(4% 0, 96% 0, 100% 50%, 96% 100%, 4% 100%, 0 50%);
      animation: grind-avail-pulse 1.1s ease-in-out infinite;
    }
    .grind-avail-key {
      font-family: 'Orbitron', monospace;
      font-size: 0.6rem;
      font-weight: 700;
      letter-spacing: 0.22em;
      color: var(--avail-glow, #00d4ff);
      text-shadow: 0 0 6px var(--avail-glow, #00d4ff);
      opacity: 0.85;
      margin-top: 2px;
    }
    @keyframes grind-avail-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(4px); }
    }
    @keyframes grind-avail-pulse {
      0%, 100% { box-shadow:
        inset 0 0 10px rgba(0, 212, 255, 0.12),
        0 0 18px rgba(0, 212, 255, 0.35); }
      50% { box-shadow:
        inset 0 0 14px rgba(0, 212, 255, 0.22),
        0 0 32px rgba(0, 212, 255, 0.65); }
    }
  `;
  document.head.appendChild(style);
}

export class GrindAvailabilityHint {
  private _root: HTMLDivElement;
  private _state: 'hidden' | 'visible' = 'hidden';
  private _hideTimer = 0;

  constructor() {
    injectStyles();

    this._root = document.createElement('div');
    this._root.className = 'grind-avail-root';

    const chevron = document.createElement('div');
    chevron.className = 'grind-avail-chevron';
    chevron.textContent = '▼';
    this._root.appendChild(chevron);

    const label = document.createElement('div');
    label.className = 'grind-avail-label';
    label.textContent = 'GRIND READY';
    this._root.appendChild(label);

    const key = document.createElement('div');
    key.className = 'grind-avail-key';
    key.textContent = 'PRESS SPACE';
    this._root.appendChild(key);

    document.body.appendChild(this._root);
  }

  /** Drive visibility from sim state. Safe to call every frame. */
  setAvailable(available: boolean): void {
    if (available && this._state === 'hidden') {
      if (this._hideTimer) { window.clearTimeout(this._hideTimer); this._hideTimer = 0; }
      this._root.classList.remove('hiding');
      this._root.classList.add('visible');
      this._state = 'visible';
    } else if (!available && this._state === 'visible') {
      this._root.classList.remove('visible');
      this._root.classList.add('hiding');
      this._state = 'hidden';
      // Clean up the transient class once the fade completes
      if (this._hideTimer) window.clearTimeout(this._hideTimer);
      this._hideTimer = window.setTimeout(() => {
        this._root.classList.remove('hiding');
        this._hideTimer = 0;
      }, FADE_OUT_MS + 20);
    }
  }

  setGlowColor(hex: number): void {
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    this._root.style.setProperty('--avail-glow', `rgb(${r},${g},${b})`);
  }

  dispose(): void {
    if (this._hideTimer) window.clearTimeout(this._hideTimer);
    this._state = 'hidden';
    this._root.remove();
  }
}
