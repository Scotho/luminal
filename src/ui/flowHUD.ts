/**
 * SPEC-90: FLOW HUD counter — update function called from game._updateHUD.
 *
 * Displays active FLOW with elastic burst scaling, glow pulses on gains,
 * multiplier display, and floating bank tally animations.
 */

import type { FlowSnapshot, BankSource } from '../flow/flowTypes';
import { commitPendingBank, type FlowState } from '../flow/flowState';
import { createGrindBankElement, updateGrindGlitchIntensity } from '../effects/grindGlitch';

// ── Types ───────────────────────────────────────────────────────

interface FlowHudElements {
  wrap: HTMLElement;
  value: HTMLElement;
  mult: HTMLElement;
  bankLayer: HTMLElement;
}

interface FlowHudLocal {
  displayedValue: number;
  targetValue: number;
  scaleAnim: number;
  glowAnim: number;
  lastTier: 0 | 1 | 2 | 3;
  spawnedBankIds: Set<number>;
}

type CharacterKind = 'spectre' | 'slingshot' | 'vector' | null;

// ── Module state ────────────────────────────────────────────────

let els: FlowHudElements | null = null;
let local: FlowHudLocal = createLocalState();
let currentCharacter: CharacterKind = null;
let flowStateRef: FlowState | null = null;

function createLocalState(): FlowHudLocal {
  return {
    displayedValue: 0,
    targetValue: 0,
    scaleAnim: 1,
    glowAnim: 0,
    lastTier: 0,
    spawnedBankIds: new Set(),
  };
}

// ── Public API ──────────────────────────────────────────────────

export function initFlowHUD(elements: FlowHudElements): void {
  els = elements;
  local = createLocalState();
  currentCharacter = null;
  flowStateRef = null;
}

export function setFlowStateRef(state: FlowState): void {
  flowStateRef = state;
}

export function updateFlowHUD(snapshot: FlowSnapshot, dtMs: number): void {
  if (!els) return;

  const now = performance.now();
  const dt = dtMs / 1000; // seconds

  // 1. Lerp displayed value toward actual
  local.targetValue = snapshot.active;
  const diff = local.targetValue - local.displayedValue;
  if (Math.abs(diff) < 1) {
    local.displayedValue = local.targetValue;
  } else {
    local.displayedValue += diff * Math.min(1, 0.25 * dt * 60);
  }

  // Write value
  const formatted = Math.round(local.displayedValue).toLocaleString();
  els.value.textContent = formatted;
  els.value.setAttribute('data-value', formatted);

  // 2. Burst scale + glow from recent gain
  const timeSinceGain = now - snapshot.lastGainAt;
  if (snapshot.lastGainAt > 0 && timeSinceGain < 600) {
    const burst = snapshot.lastGainAmount;
    if (burst >= 80) {
      local.scaleAnim = 1.8;
      local.glowAnim = 1.0;
    } else if (burst >= 25) {
      local.scaleAnim = 1.4;
      local.glowAnim = 0.6;
    } else {
      local.scaleAnim = 1.1;
      local.glowAnim = 0.3;
    }
  } else {
    // Exponential decay — approaches 1.0 smoothly with natural deceleration
    if (local.scaleAnim > 1.02) {
      local.scaleAnim = 1 + (local.scaleAnim - 1) * Math.exp(-8 * dt);
    } else if (local.scaleAnim !== 1) {
      local.scaleAnim = 1; // snap to avoid perpetual micro-animation
    }
    local.glowAnim = Math.max(0, local.glowAnim * Math.exp(-8 * dt));
    if (local.glowAnim < 0.01) local.glowAnim = 0;
  }

  // 3. Write CSS variables
  els.wrap.style.setProperty('--flow-scale', local.scaleAnim.toFixed(3));
  els.wrap.style.setProperty('--flow-glow', local.glowAnim.toFixed(3));

  // 4. Multiplier display
  if (snapshot.multiplier > 1) {
    els.mult.textContent = '\u00d7' + snapshot.multiplier;
    let cls = 'flow-hud__mult active';
    if (snapshot.tierIndex === 3) cls += ' tier-10';
    else if (snapshot.tierIndex === 2) cls += ' tier-3';
    els.mult.className = cls;
  } else {
    els.mult.className = 'flow-hud__mult';
  }

  // 5. Process pending banks
  for (const bank of snapshot.pendingBanks) {
    if (!local.spawnedBankIds.has(bank.id)) {
      local.spawnedBankIds.add(bank.id);
      spawnBankElement(bank.source, bank.amount, bank.id);
    }
  }
}

export function resetFlowHUD(): void {
  local = createLocalState();
  if (els) {
    els.value.textContent = '0';
    els.value.setAttribute('data-value', '0');
    els.mult.className = 'flow-hud__mult';
    els.bankLayer.innerHTML = '';
    els.wrap.style.setProperty('--flow-scale', '1');
    els.wrap.style.setProperty('--flow-glow', '0');
  }
}

export function setFlowHudCharacterState(kind: CharacterKind): void {
  if (!els) return;
  // Remove all character classes
  els.wrap.classList.remove('flow-hud--spectre', 'flow-hud--slingshot', 'flow-hud--vector');
  currentCharacter = kind;
  if (kind) {
    els.wrap.classList.add(`flow-hud--${kind}`);
  }
}

// ── Bank element spawning ────────────────────────────────��──────

function spawnBankElement(source: BankSource, amount: number, bankId: number): void {
  if (!els) return;

  // SPEC-95: Grind banks use per-digit fragment animation for VECTOR
  const el = (source === 'grind' && currentCharacter === 'vector')
    ? createGrindBankElement(amount)
    : createStandardBankElement(source, amount);
  els.bankLayer.appendChild(el);

  // Remove after animation ends and commit the bank
  const onDone = (): void => {
    el.remove();
    if (flowStateRef) {
      commitPendingBank(flowStateRef, bankId, performance.now());
    }
  };

  el.addEventListener('animationend', onDone, { once: true });
  // Fallback timeout in case animationend doesn't fire
  setTimeout(onDone, 600);
}

// ── SPEC-95: Grind glitch intensity per-frame ──────────────────

export function updateFlowGlitch(grinding: boolean, grindDuration: number): void {
  if (!els || currentCharacter !== 'vector') return;
  if (grinding) {
    updateGrindGlitchIntensity(els.wrap, grindDuration);
  }
}

// ── Standard bank element ──────────────────────────────────────

function createStandardBankElement(source: BankSource, amount: number): HTMLElement {
  const el = document.createElement('div');
  el.className = `flow-bank flow-bank--${source}`;
  el.textContent = `+${amount.toLocaleString()}`;
  return el;
}

// ── Testing helper ──────────────────────────────────────────────

export function _resetFlowHUDForTesting(): void {
  els = null;
  local = createLocalState();
  currentCharacter = null;
  flowStateRef = null;
}
