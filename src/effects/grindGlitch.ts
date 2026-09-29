/**
 * SPEC-95: VECTOR grind glitch effect — DOM-based glitch on FLOW counter.
 *
 * While VECTOR is grinding: number digits fragment and recombine with
 * sustained subtle oscillation that intensifies with grind duration.
 * Bank animation: digit disintegration → reassembly collapse.
 */

export interface GrindGlitchState {
  isActive: boolean;
  duration: number;
}

export function enterGrindGlitch(flowHudWrap: HTMLElement): void {
  flowHudWrap.classList.add('flow-hud--vector');
}

export function exitGrindGlitch(flowHudWrap: HTMLElement): void {
  flowHudWrap.classList.remove('flow-hud--vector');
}

export function updateGrindGlitchIntensity(
  flowHudWrap: HTMLElement,
  duration: number,
): void {
  // 0s grind → amp 0.35, 10s → 0.62, 20s+ → cap 0.89
  const amp = Math.min(0.9, 0.35 + duration * 0.027);
  flowHudWrap.style.setProperty('--vector-glitch-amp', amp.toFixed(2));
  // Speed gets faster with duration
  const speed = Math.max(1.4, 3 - duration * 0.08);
  flowHudWrap.style.setProperty('--vector-glitch-speed', `${speed.toFixed(2)}s`);
}

/**
 * Creates a grind-specific bank element with per-digit fragment animation.
 */
export function createGrindBankElement(amount: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flow-bank flow-bank--grind';
  const text = '+' + amount.toLocaleString();
  for (let i = 0; i < text.length; i++) {
    const span = document.createElement('span');
    span.textContent = text[i];
    span.style.setProperty('--digit-index', String(i));
    // Random burst direction per digit
    const angle = (Math.random() - 0.5) * Math.PI;
    const radius = 18 + Math.random() * 12;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius - 10;
    span.style.setProperty('--burst-x', `${x.toFixed(1)}px`);
    span.style.setProperty('--burst-y', `${y.toFixed(1)}px`);
    span.style.setProperty('--burst-rot', `${((Math.random() - 0.5) * 20).toFixed(1)}deg`);
    wrap.appendChild(span);
  }
  return wrap;
}
