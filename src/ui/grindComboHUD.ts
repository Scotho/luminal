// ── Grind Combo HUD — score × multiplier + chain + cooldown (SPEC-82) ──
const SHOW_THRESHOLD = 3;
const POST_GRIND_LINGER_MS = 650;
const CHAIN_MAX_VISIBLE = 5;
const SCORE_LERP_RATE = 18;  // per second

const MILESTONES = [10, 25, 50, 100];
function nextMilestone(count: number): number {
  for (let i = 0; i < MILESTONES.length; i++) {
    if (count < MILESTONES[i]) return MILESTONES[i];
  }
  return MILESTONES[MILESTONES.length - 1];
}

export interface GrindComboState {
  streakCount: number;
  broken: boolean;
  isGrinding: boolean;
  score: number;
  multiplier: number;
  chain: readonly string[];
  dirty: number;
  cooldownRemaining: number;
  cooldownTotal: number;
}

function injectStyles(): void {
  if (document.getElementById('grind-combo-styles')) return;
  const style = document.createElement('style');
  style.id = 'grind-combo-styles';
  style.textContent = `
    .grind-combo-root {
      position: fixed;
      bottom: 14%;
      left: 50%;
      transform: translate(-50%, 8px);
      display: flex;
      flex-direction: column;
      align-items: center;
      pointer-events: none;
      z-index: 120;
      opacity: 0;
      transition: opacity 140ms ease-out, transform 180ms cubic-bezier(.2,.9,.3,1.2);
      filter: drop-shadow(0 0 22px var(--combo-glow, #00d4ff));
    }
    .grind-combo-root.visible {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    .grind-combo-chain {
      font-family: 'Orbitron', 'Rajdhani', sans-serif;
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--combo-glow, #00d4ff);
      text-shadow: 0 0 10px var(--combo-glow, #00d4ff);
      letter-spacing: 0.12em;
      min-height: 1rem;
      margin-bottom: 4px;
      white-space: nowrap;
    }
    .grind-combo-chip {
      display: flex;
      align-items: baseline;
      gap: 0.65rem;
      padding: 0.35rem 1.2rem 0.45rem;
      border: 1px solid var(--combo-glow, #00d4ff);
      border-radius: 4px;
      background: linear-gradient(180deg,
        rgba(4, 10, 22, 0.88) 0%,
        rgba(0, 0, 0, 0.68) 100%);
      box-shadow:
        inset 0 0 18px rgba(0, 212, 255, 0.12),
        0 0 24px rgba(0, 212, 255, 0.35);
      clip-path: polygon(5% 0, 95% 0, 100% 50%, 95% 100%, 5% 100%, 0 50%);
    }
    .grind-combo-score {
      font-family: 'Orbitron', 'Rajdhani', monospace;
      font-size: 3.2rem;
      font-weight: 900;
      color: #fff;
      text-shadow:
        0 0 6px var(--combo-glow, #00d4ff),
        0 0 18px var(--combo-glow, #00d4ff),
        0 0 36px var(--combo-glow, #00d4ff);
      transition: transform 0.12s cubic-bezier(.2,.9,.3,1.5);
      line-height: 0.9;
      letter-spacing: 0.02em;
    }
    .grind-combo-score.shake {
      animation: combo-shake 0.22s ease-out;
    }
    .grind-combo-mult {
      font-family: 'Orbitron', monospace;
      font-size: 1.6rem;
      font-weight: 800;
      color: #ffb020;
      text-shadow: 0 0 10px #ffb020, 0 0 20px rgba(255, 176, 32, 0.5);
      letter-spacing: 0.06em;
      transition: transform 0.12s cubic-bezier(.2,.9,.3,1.5);
    }
    .grind-combo-mult.flash {
      transform: scale(1.3);
    }
    .grind-combo-bar-wrap {
      width: 160px;
      height: 4px;
      background: rgba(255,255,255,0.12);
      border-radius: 2px;
      margin-top: 8px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.15);
    }
    .grind-combo-bar-fill {
      height: 100%;
      background: var(--combo-glow, #00d4ff);
      border-radius: 2px;
      transition: width 0.18s ease-out;
      box-shadow: 0 0 10px var(--combo-glow, #00d4ff);
    }
    .grind-combo-footer {
      font-family: 'Orbitron', 'Rajdhani', sans-serif;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: var(--combo-glow, #00d4ff);
      text-shadow: 0 0 6px var(--combo-glow, #00d4ff);
      margin-top: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .grind-combo-footer-bar {
      width: 60px;
      height: 3px;
      background: rgba(255,255,255,0.12);
      border-radius: 2px;
      overflow: hidden;
    }
    .grind-combo-footer-bar-fill {
      height: 100%;
      background: var(--combo-glow, #00d4ff);
      box-shadow: 0 0 6px var(--combo-glow, #00d4ff);
      transition: width 0.12s linear;
    }
    .grind-combo-milestone {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      font-family: 'Orbitron', monospace;
      font-size: 1.25rem;
      font-weight: 900;
      color: #7dff9d;
      text-shadow:
        0 0 8px #7dff9d,
        0 0 18px #24ff55;
      opacity: 0;
      pointer-events: none;
      letter-spacing: 0.15em;
    }
    .grind-combo-milestone.active {
      animation: combo-milestone 0.85s cubic-bezier(.2,.7,.3,1) forwards;
    }
    @keyframes combo-shake {
      0% { transform: translateX(0); }
      25% { transform: translateX(-5px); }
      50% { transform: translateX(4px); }
      75% { transform: translateX(-2px); }
      100% { transform: translateX(0); }
    }
    @keyframes combo-milestone {
      0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
      25% { opacity: 1; transform: translateX(-50%) translateY(-8px) scale(1.15); }
      100% { opacity: 0; transform: translateX(-50%) translateY(-48px) scale(1); }
    }
    @keyframes chain-item-in {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .grind-combo-chain-item {
      display: inline;
      animation: chain-item-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
    }
    .grind-combo-chain-sep {
      display: inline;
      opacity: 0.6;
    }
    @media (prefers-reduced-motion: reduce) {
      .grind-combo-chain-item { animation: none; }
    }
  `;
  document.head.appendChild(style);
}

function formatScore(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
function formatMult(m: number): string {
  return `× ${m.toFixed(1)}`;
}

export class GrindComboHUD {
  private _root: HTMLDivElement;
  private _chainEl: HTMLDivElement;
  private _scoreEl: HTMLDivElement;
  private _multEl: HTMLDivElement;
  private _barFill: HTMLDivElement;
  private _footerEl: HTMLDivElement;
  private _footerBarFill: HTMLDivElement;
  private _milestoneEl: HTMLDivElement;

  private _displayScore = 0;
  private _lastDirty = -1;
  private _lastStreak = 0;
  private _visible = false;
  private _hideTimer = 0;
  private _lastChainLength = 0;

  constructor() {
    injectStyles();

    this._root = document.createElement('div');
    this._root.className = 'grind-combo-root';

    this._milestoneEl = document.createElement('div');
    this._milestoneEl.className = 'grind-combo-milestone';
    this._root.appendChild(this._milestoneEl);

    this._chainEl = document.createElement('div');
    this._chainEl.className = 'grind-combo-chain';
    this._root.appendChild(this._chainEl);

    const chip = document.createElement('div');
    chip.className = 'grind-combo-chip';

    this._scoreEl = document.createElement('div');
    this._scoreEl.className = 'grind-combo-score';
    this._scoreEl.textContent = '0';
    chip.appendChild(this._scoreEl);

    this._multEl = document.createElement('div');
    this._multEl.className = 'grind-combo-mult';
    this._multEl.textContent = '× 1.0';
    chip.appendChild(this._multEl);

    this._root.appendChild(chip);

    const barWrap = document.createElement('div');
    barWrap.className = 'grind-combo-bar-wrap';
    this._barFill = document.createElement('div');
    this._barFill.className = 'grind-combo-bar-fill';
    this._barFill.style.width = '0%';
    barWrap.appendChild(this._barFill);
    this._root.appendChild(barWrap);

    this._footerEl = document.createElement('div');
    this._footerEl.className = 'grind-combo-footer';
    const footerBar = document.createElement('div');
    footerBar.className = 'grind-combo-footer-bar';
    this._footerBarFill = document.createElement('div');
    this._footerBarFill.className = 'grind-combo-footer-bar-fill';
    this._footerBarFill.style.width = '0%';
    footerBar.appendChild(this._footerBarFill);
    this._footerEl.appendChild(document.createTextNode(''));
    this._footerEl.appendChild(footerBar);
    this._root.appendChild(this._footerEl);

    document.body.appendChild(this._root);
  }

  update(state: GrindComboState): void {
    const hasChain = state.chain.length > 0;
    const shouldShowNow = state.isGrinding &&
      !state.broken &&
      (state.streakCount >= SHOW_THRESHOLD || hasChain);

    if (shouldShowNow) {
      if (this._hideTimer) { window.clearTimeout(this._hideTimer); this._hideTimer = 0; }
      if (!this._visible) this._show();
    } else if (this._visible && !this._hideTimer) {
      this._hideTimer = window.setTimeout(() => {
        this._hide();
        this._hideTimer = 0;
      }, POST_GRIND_LINGER_MS);
    }

    // Score lerp
    this._displayScore += (state.score - this._displayScore) * Math.min(1, SCORE_LERP_RATE * (1/60));
    if (Math.abs(state.score - this._displayScore) < 0.5) this._displayScore = state.score;
    this._scoreEl.textContent = formatScore(this._displayScore);

    // Multiplier
    this._multEl.textContent = formatMult(state.multiplier);
    if (state.dirty !== this._lastDirty) {
      this._multEl.classList.remove('flash');
      void this._multEl.offsetWidth;
      this._multEl.classList.add('flash');
      this._lastDirty = state.dirty;
    }

    // Chain stagger — only re-render when chain length changes
    if (state.chain.length !== this._lastChainLength) {
      this._chainEl.innerHTML = '';
      const visible = state.chain.slice(-CHAIN_MAX_VISIBLE);
      const overflow = state.chain.length - visible.length;
      for (let i = 0; i < visible.length; i++) {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'grind-combo-chain-sep';
          sep.textContent = ' → ';
          this._chainEl.appendChild(sep);
        }
        const item = document.createElement('span');
        item.className = 'grind-combo-chain-item';
        // Only animate newly-added items (last item when chain grows)
        if (i === visible.length - 1 && state.chain.length > this._lastChainLength) {
          item.style.animationDelay = '0ms';
        } else {
          item.style.animation = 'none';
        }
        item.textContent = visible[i];
        this._chainEl.appendChild(item);
      }
      if (overflow > 0) {
        const suf = document.createElement('span');
        suf.className = 'grind-combo-chain-sep';
        suf.textContent = `  +${overflow}`;
        this._chainEl.appendChild(suf);
      }
      this._lastChainLength = state.chain.length;
    }

    // Break shake
    if (state.broken && this._lastStreak >= SHOW_THRESHOLD) {
      this._scoreEl.classList.remove('shake');
      void this._scoreEl.offsetWidth;
      this._scoreEl.classList.add('shake');
      window.setTimeout(() => {
        this._scoreEl.classList.remove('shake');
      }, 240);
    }

    // Progress bar (streak toward next milestone)
    const next = nextMilestone(state.streakCount);
    const prev = MILESTONES[MILESTONES.indexOf(next) - 1] ?? 0;
    const progress = next > prev ? (state.streakCount - prev) / (next - prev) : 0;
    this._barFill.style.width = `${Math.min(100, progress * 100)}%`;

    // Footer
    this._updateFooter(state);

    this._lastStreak = state.streakCount;
  }

  private _updateFooter(state: GrindComboState): void {
    const textNode = this._footerEl.firstChild as Text;
    if (state.isGrinding) {
      textNode.textContent = `GRIND • ${state.streakCount} HITS `;
      this._footerBarFill.style.width = '0%';
    } else if (state.cooldownRemaining > 0 && state.cooldownTotal > 0) {
      const pct = Math.max(0, 1 - state.cooldownRemaining / state.cooldownTotal) * 100;
      textNode.textContent = `COOLING `;
      this._footerBarFill.style.width = `${pct}%`;
    } else {
      textNode.textContent = `READY `;
      this._footerBarFill.style.width = '100%';
    }
  }

  triggerCashOut(meterGain: number): void {
    this._milestoneEl.textContent = `+${meterGain} METER`;
    this._milestoneEl.classList.remove('active');
    void this._milestoneEl.offsetWidth;
    this._milestoneEl.classList.add('active');
  }

  setGlowColor(hex: number): void {
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    this._root.style.setProperty('--combo-glow', `rgb(${r},${g},${b})`);
  }

  private _show(): void {
    this._visible = true;
    this._root.classList.add('visible');
  }

  private _hide(): void {
    this._visible = false;
    this._root.classList.remove('visible');
    this._lastChainLength = 0;
  }

  dispose(): void {
    if (this._hideTimer) window.clearTimeout(this._hideTimer);
    this._root.remove();
  }
}
