/**
 * SPEC-91: FLOW round-end reveal — choreographed score presentation.
 *
 * Trick log entries pop in sequentially, subtotal + multiplier reveal,
 * then final FLOW amount lands with scale/glow impact.
 * On death: crossed-out tally, fast-forwarded.
 */

import type { RoundResult, TrickLogEntry } from '../flow/flowTypes';
import { FLOW_MULTIPLIER_LABELS } from '../flow/flowMultiplier';
import { startRewardTally, playRewardTotal } from '../sfxAssets';

// ── Timing constants ────────────────────────────────────────────

interface FlowRevealTiming {
  logStagger: number;
  logToSubtotal: number;
  subtotalToMult: number;
  multToTotal: number;
  totalHold: number;
}

const TIMING_WIN: FlowRevealTiming = {
  logStagger: 90,
  logToSubtotal: 150,
  subtotalToMult: 200,
  multToTotal: 280,
  totalHold: 600,
};

const TIMING_DEATH: FlowRevealTiming = {
  logStagger: 40,
  logToSubtotal: 60,
  subtotalToMult: 0,
  multToTotal: 60,
  totalHold: 150,
};

// ── Module state ────────────────────────────────────────────────

let skipRequested = false;
let timeoutIds: number[] = [];
let resolveReveal: (() => void) | null = null;
let stopTally: (() => void) | null = null;

// ── Public API ──────────────────────────────────────────────────

export function playFlowReveal(result: RoundResult): Promise<void> {
  return new Promise<void>((resolve) => {
    resolveReveal = resolve;
    skipRequested = false;
    timeoutIds = [];

    const container = document.getElementById('flow-reveal');
    const logEl = document.getElementById('flow-reveal-log');
    const subtotalEl = document.getElementById('flow-reveal-subtotal');
    const subtotalWrap = subtotalEl?.parentElement;
    const multEl = document.getElementById('flow-reveal-mult');
    const multStreak = document.getElementById('flow-reveal-mult-streak');
    const multX = document.getElementById('flow-reveal-mult-x');
    const totalEl = document.getElementById('flow-reveal-total');
    const totalWrap = totalEl?.parentElement;

    if (!container || !logEl || !subtotalEl || !multEl || !multStreak || !multX || !totalEl || !subtotalWrap || !totalWrap) {
      resolve();
      return;
    }

    // Reset
    container.classList.remove('hidden', 'flow-reveal--died');
    logEl.innerHTML = '';
    subtotalWrap.classList.remove('visible');
    subtotalEl.textContent = '0';
    multEl.classList.add('hidden');
    totalWrap.classList.remove('revealed');
    totalEl.textContent = '0';

    if (result.died) {
      container.classList.add('flow-reveal--died');
    }

    const timing = result.died ? TIMING_DEATH : TIMING_WIN;
    let t = 0;

    // SFX: start continuous tally sound (skip on death — too fast)
    if (!result.died) {
      stopTally = startRewardTally();
    }

    // 1. Trick log rows
    const rows = result.trickLog.filter((e) => e.amount > 0);
    for (let i = 0; i < rows.length; i++) {
      const delay = t + i * timing.logStagger;
      scheduleTimeout(() => {
        if (skipRequested) return;
        appendLogRow(logEl, rows[i]);
      }, delay);
    }
    t += rows.length * timing.logStagger + timing.logToSubtotal;

    // 2. Subtotal
    scheduleTimeout(() => {
      if (skipRequested) return;
      subtotalEl.textContent = result.subtotal.toLocaleString();
      subtotalWrap.classList.add('visible');
    }, t);
    t += timing.subtotalToMult;

    // 3. Multiplier (skip if 1x)
    if (result.multiplier > 1) {
      scheduleTimeout(() => {
        if (skipRequested) return;
        multStreak.textContent = FLOW_MULTIPLIER_LABELS[result.tierIndex] || '';
        multX.textContent = '\u00d7' + result.multiplier;
        multEl.classList.remove('hidden');
        if (result.tierIndex >= 2) {
          multEl.classList.add('tier-3');
        }
      }, t);
      t += timing.multToTotal;
    }

    // SFX: fade tally before total lands
    if (!result.died) {
      scheduleTimeout(() => {
        if (stopTally) { stopTally(); stopTally = null; }
      }, t - 80);
    }

    // 4. Final total
    scheduleTimeout(() => {
      if (skipRequested) return;
      totalEl.textContent = result.awarded.toLocaleString();
      totalWrap.classList.add('revealed');
      if (!result.died) playRewardTotal();
    }, t);
    t += timing.totalHold;

    // 5. Resolve
    scheduleTimeout(() => {
      finishReveal();
    }, t);
  });
}

export function requestSkipFlowReveal(): void {
  skipRequested = true;
  if (stopTally) { stopTally(); stopTally = null; }
  // Clear all pending timeouts
  for (const id of timeoutIds) {
    clearTimeout(id);
  }
  timeoutIds = [];

  // Jump to final state
  const container = document.getElementById('flow-reveal');
  const logEl = document.getElementById('flow-reveal-log');
  const subtotalWrap = document.getElementById('flow-reveal-subtotal')?.parentElement;
  const totalWrap = document.getElementById('flow-reveal-total')?.parentElement;

  if (container) container.classList.remove('hidden');
  if (logEl) {
    // Show all rows immediately
    for (const row of logEl.children) {
      (row as HTMLElement).style.animation = 'none';
      (row as HTMLElement).style.opacity = '1';
      (row as HTMLElement).style.transform = 'none';
    }
  }
  if (subtotalWrap) subtotalWrap.classList.add('visible');
  if (totalWrap) totalWrap.classList.add('revealed');

  finishReveal();
}

export function resetFlowReveal(): void {
  for (const id of timeoutIds) {
    clearTimeout(id);
  }
  timeoutIds = [];
  if (stopTally) { stopTally(); stopTally = null; }
  skipRequested = false;

  const container = document.getElementById('flow-reveal');
  if (container) {
    container.classList.add('hidden');
    container.classList.remove('flow-reveal--died');
  }
  const logEl = document.getElementById('flow-reveal-log');
  if (logEl) logEl.innerHTML = '';
}

// ── Helpers ─────────────────────────────────────────────────────

function scheduleTimeout(fn: () => void, delay: number): void {
  timeoutIds.push(window.setTimeout(fn, delay));
}

function finishReveal(): void {
  if (resolveReveal) {
    const r = resolveReveal;
    resolveReveal = null;
    r();
  }
}

function appendLogRow(parent: HTMLElement, entry: TrickLogEntry): void {
  const row = document.createElement('div');
  row.className = 'flow-reveal__log-row';
  row.setAttribute('data-kind', entry.kind);
  // Vary entrance distance by amount — higher-value tricks slide further
  const baseOffset = -12;
  const extraOffset = Math.min(8, Math.floor(entry.amount / 50) * 2);
  row.style.setProperty('--reveal-offset', `${baseOffset - extraOffset}px`);

  const label = document.createElement('span');
  label.className = 'flow-reveal__log-label';
  let labelText = entry.kind.toUpperCase();
  if (entry.kind === 'elimination' && entry.count && entry.count > 1) {
    labelText += ` x${entry.count}`;
  }
  label.textContent = labelText;

  const value = document.createElement('span');
  value.className = 'flow-reveal__log-value';
  value.textContent = `+${Math.round(entry.amount).toLocaleString()}`;

  row.appendChild(label);
  row.appendChild(value);
  parent.appendChild(row);
}
