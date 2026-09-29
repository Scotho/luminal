/**
 * TASK-306: Post-match XP bar reveal.
 * Compact bar with animated fill, level-up flash, unlock toast stack.
 * Muted treatment for anonymous users with sign-in overlay.
 */

import type { MatchXpResult } from '../progression/progressionBridge';
import { MAX_LEVEL } from '../progression/xpConfig';
import { startRewardTally, playRewardTotal, playRewardLevelUp } from '../sfxAssets';

const FADE_IN_MS = 30;
const FILL_DURATION_MS = 350;
const FLASH_DURATION_MS = 150;
const FLASH_HOLD_MS = 220;
const MULTI_LEVEL_CYCLE_MS = 320;
const TOAST_START_DELAY_MS = 150;
const TOAST_STAGGER_MS = 120;
const TOAST_DISMISS_MS = 2800;
const TOAST_FADE_MS = 250;
const TOKEN_LEVELS = [6, 9];

let timeoutIds: number[] = [];
let skipRequested = false;
let stopTally: (() => void) | null = null;

export function renderXpBar(
  result: MatchXpResult | null,
  isAnon: boolean,
  currentXp: number,
  xpForNextLevel: number,
): void {
  skipRequested = false;
  timeoutIds = [];

  const bar = document.getElementById('xp-reveal');
  const toastContainer = document.getElementById('xp-toast-container');
  if (!bar) return;

  const level = result ? result.newLevel : 1;
  const xpEarned = result ? result.award.total : 80;
  const levelsGained = result ? result.levelsGained : 0;
  const previousLevel = result ? result.previousLevel : 1;
  const isMaxLvl = level >= MAX_LEVEL;

  const newPct = isMaxLvl ? 100 : xpForNextLevel > 0 ? Math.min(100, Math.round((currentXp / xpForNextLevel) * 100)) : 0;
  let oldPct: number;
  if (levelsGained > 0) {
    oldPct = 0;
  } else {
    const oldXp = Math.max(0, currentXp - xpEarned);
    oldPct = xpForNextLevel > 0 ? Math.min(100, Math.round((oldXp / xpForNextLevel) * 100)) : 0;
  }

  bar.innerHTML = `
    <div class="xp-bar__header">
      <span class="xp-bar__label">LEVEL ${previousLevel}</span>
      <span class="xp-bar__badge">+${xpEarned} XP</span>
    </div>
    <div class="xp-bar__track">
      <div class="xp-bar__fill" style="width:${levelsGained > 0 ? 80 : oldPct}%"></div>
    </div>
    <div class="xp-bar__progress">${currentXp} / ${xpForNextLevel} XP</div>
  `;

  bar.classList.remove('hidden', 'xp-bar--visible', 'xp-bar--levelup', 'xp-bar--anon');

  if (isAnon) {
    bar.classList.add('xp-bar--anon');
    const signin = document.createElement('div');
    signin.className = 'xp-bar__signin';
    signin.textContent = 'SIGN IN TO SAVE PROGRESS';
    signin.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('luminal:requestSignIn'));
    });
    bar.appendChild(signin);
  }

  scheduleTimeout(() => {
    if (skipRequested) return;
    bar.classList.add('xp-bar--visible');
  }, FADE_IN_MS);

  if (isAnon || !result) {
    scheduleTimeout(() => {
      if (skipRequested) return;
      const fill = bar.querySelector('.xp-bar__fill') as HTMLElement;
      if (fill) fill.style.width = `${newPct}%`;
    }, FADE_IN_MS + 50);
    return;
  }

  if (levelsGained === 0) {
    stopTally = startRewardTally({ volume: 0.25 });
    scheduleTimeout(() => {
      if (skipRequested) return;
      const fill = bar.querySelector('.xp-bar__fill') as HTMLElement;
      if (fill) fill.style.width = `${newPct}%`;
    }, FADE_IN_MS + 50);
    scheduleTimeout(() => {
      if (stopTally) { stopTally(); stopTally = null; }
      if (!skipRequested) playRewardTotal();
    }, FADE_IN_MS + 50 + FILL_DURATION_MS);
  } else {
    stopTally = startRewardTally({ volume: 0.25 });
    let t = FADE_IN_MS + 50;

    for (let i = 0; i < levelsGained; i++) {
      const isLast = i === levelsGained - 1;
      const cycleDuration = levelsGained > 1 ? MULTI_LEVEL_CYCLE_MS : FILL_DURATION_MS;

      scheduleTimeout(() => {
        if (skipRequested) return;
        const fill = bar.querySelector('.xp-bar__fill') as HTMLElement;
        if (fill) { fill.style.transition = `width ${cycleDuration}ms ease-out`; fill.style.width = '100%'; }
      }, t);
      t += cycleDuration;

      scheduleTimeout(() => {
        if (skipRequested) return;
        bar.classList.add('xp-bar--levelup');
        playRewardLevelUp();
      }, t);
      t += FLASH_DURATION_MS;

      const newLvl = previousLevel + i + 1;
      scheduleTimeout(() => {
        if (skipRequested) return;
        const label = bar.querySelector('.xp-bar__label');
        const badge = bar.querySelector('.xp-bar__badge');
        if (label) label.textContent = `LEVEL ${newLvl}`;
        if (badge && !isLast) badge.textContent = 'LEVEL UP';
        const fill = bar.querySelector('.xp-bar__fill') as HTMLElement;
        if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; }
      }, t);
      t += 50;

      if (isLast) {
        scheduleTimeout(() => {
          if (skipRequested) return;
          const fill = bar.querySelector('.xp-bar__fill') as HTMLElement;
          if (fill) { fill.style.transition = `width ${FLASH_HOLD_MS}ms ease-out`; fill.style.width = `${newPct}%`; }
          const badge = bar.querySelector('.xp-bar__badge');
          if (badge) badge.textContent = `+${xpEarned} XP`;
        }, t);
        t += FLASH_HOLD_MS;
        scheduleTimeout(() => {
          if (stopTally) { stopTally(); stopTally = null; }
          if (!skipRequested) playRewardTotal();
        }, t + FLASH_HOLD_MS);
      }
    }

    scheduleTimeout(() => {
      if (skipRequested) return;
      bar.classList.remove('xp-bar--levelup');
    }, t + 1500);

    if (toastContainer && result.newUnlocks.length > 0) {
      scheduleTimeout(() => {
        if (skipRequested) return;
        showToastStack(toastContainer, result.newUnlocks, result.newLevel);
      }, t + TOAST_START_DELAY_MS);
    } else if (toastContainer && TOKEN_LEVELS.includes(result.newLevel) && levelsGained > 0) {
      scheduleTimeout(() => {
        if (skipRequested) return;
        showTokenToast(toastContainer);
      }, t + TOAST_START_DELAY_MS);
    }
  }
}

export function skipXpAnimation(): void {
  skipRequested = true;
  for (const id of timeoutIds) clearTimeout(id);
  timeoutIds = [];
  if (stopTally) { stopTally(); stopTally = null; }
  const bar = document.getElementById('xp-reveal');
  if (bar) {
    bar.classList.add('xp-bar--visible');
    const fill = bar.querySelector('.xp-bar__fill') as HTMLElement;
    if (fill) fill.style.transition = 'none';
  }
  const toastContainer = document.getElementById('xp-toast-container');
  if (toastContainer) { toastContainer.classList.add('hidden'); toastContainer.innerHTML = ''; }
}

export function cleanupXpBar(): void {
  for (const id of timeoutIds) clearTimeout(id);
  timeoutIds = [];
  skipRequested = false;
  if (stopTally) { stopTally(); stopTally = null; }
  const bar = document.getElementById('xp-reveal');
  if (bar) { bar.classList.add('hidden'); bar.classList.remove('xp-bar--visible', 'xp-bar--levelup', 'xp-bar--anon'); bar.innerHTML = ''; }
  const toastContainer = document.getElementById('xp-toast-container');
  if (toastContainer) { toastContainer.classList.add('hidden'); toastContainer.innerHTML = ''; }
}

function showToastStack(container: HTMLElement, unlocks: string[], newLevel: number): void {
  container.classList.remove('hidden');
  container.innerHTML = '';
  unlocks.forEach((unlockId, i) => {
    scheduleTimeout(() => {
      if (skipRequested) return;
      const toast = createUnlockToast(unlockId);
      container.appendChild(toast);
      scheduleTimeout(() => {
        if (skipRequested) return;
        toast.classList.add('xp-toast--fading');
        scheduleTimeout(() => { toast.remove(); if (container.children.length === 0) container.classList.add('hidden'); }, TOAST_FADE_MS);
      }, TOAST_DISMISS_MS);
    }, i * TOAST_STAGGER_MS);
  });
  if (TOKEN_LEVELS.includes(newLevel)) {
    scheduleTimeout(() => { if (skipRequested) return; showTokenToast(container); }, unlocks.length * TOAST_STAGGER_MS + 100);
  }
}

function showTokenToast(container: HTMLElement): void {
  container.classList.remove('hidden');
  const toast = document.createElement('div');
  toast.className = 'xp-toast xp-toast--token';
  toast.innerHTML = `<div><div class="xp-toast__category">REWARD</div><div class="xp-toast__name">TOKEN AVAILABLE</div></div>`;
  container.appendChild(toast);
}

function createUnlockToast(unlockId: string): HTMLElement {
  const [category, name] = unlockId.split(':');
  const displayName = formatUnlockName(name);
  const accentColor = getUnlockColor(category, name);
  const toast = document.createElement('div');
  toast.className = 'xp-toast';
  toast.style.borderLeftColor = accentColor;
  toast.innerHTML = `<div><div class="xp-toast__category">UNLOCKED</div><div class="xp-toast__name" style="color:${accentColor}">${displayName}</div></div>`;
  return toast;
}

function formatUnlockName(name: string): string {
  if (name.includes('+')) return name.split('+').map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(' + ');
  const nameMap: Record<string, string> = {
    bike: 'SPECTRE', car: 'SLINGSHOT', hoverboard: 'VECTOR',
    midtown_bowl: 'MIDTOWN BOWL', synth_pit: 'SYNTH PIT', synth_city: 'SYNTH CITY',
    enhanced_glow: 'Enhanced Glow', pulse: 'Pulse Effect', overdrive: 'Overdrive', luminal: 'Luminal Radiance',
    survivor: 'Survivor', streak_fire: 'Streak Fire', mastery_bo3: 'Mastery', early_access: 'Early Access',
  };
  return nameMap[name] || name.charAt(0).toUpperCase() + name.slice(1);
}

function getUnlockColor(category: string, name: string): string {
  if (category === 'vehicle' || category === 'map') return '#00e5ff';
  if (category === 'emissive') return '#9B59B6';
  const colorMap: Record<string, string> = {
    red: '#C02018', orange: '#E08830', magenta: '#FC741E', lime: '#FAC322',
    green: '#66D450', cyan: '#49A2B2', teal: '#2D6469', blue: '#1A6A8A',
    pink: '#D440B8', white: '#E0F0F0',
  };
  return colorMap[name] || '#00e5ff';
}

function scheduleTimeout(fn: () => void, ms: number): void {
  const id = window.setTimeout(fn, ms);
  timeoutIds.push(id);
}

export function _resetForTesting(): void {
  for (const id of timeoutIds) clearTimeout(id);
  timeoutIds = [];
  skipRequested = false;
}
