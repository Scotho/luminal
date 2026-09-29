import { getStreakTier, STREAK_PROXIMITY_CUE } from '../streak';
import { show, hide } from './dom';

const TIER_CLASSES = ['streak-tier-1', 'streak-tier-2', 'streak-tier-3', 'streak-tier-4'];

function applyProximityCue(proxEl: HTMLElement, distance: number): void {
  if (distance > 0 && distance <= STREAK_PROXIMITY_CUE) {
    proxEl.textContent = `${distance} away from your best!`;
    proxEl.classList.add('visible');
  } else {
    proxEl.classList.remove('visible');
  }
}

/**
 * Update the in-game streak display. Called on every win/loss and during game state transitions.
 * @param streak - current streak count
 * @param prevStreak - previous streak count (reserved for future tier-change detection)
 * @param bestStreak - personal best for this mode
 */
export function updateStreakDisplay(streak: number, prevStreak: number, bestStreak: number): void {
  const el = document.getElementById('streak-display');
  if (!el) return;

  if (streak < 1) {
    hide(el);
    return;
  }

  show(el);

  const numEl = el.querySelector('.streak-num') as HTMLElement;
  if (numEl) {
    // Punch animation on increment (not on first render)
    if (prevStreak > 0 && streak > prevStreak) {
      numEl.classList.remove('streak-punch');
      void numEl.offsetWidth; // force reflow to restart animation
      numEl.classList.add('streak-punch');
      numEl.addEventListener('animationend', () => {
        numEl.classList.remove('streak-punch');
      }, { once: true });
    }
    numEl.textContent = String(streak);
    numEl.setAttribute('data-streak', String(streak));
  }

  const prevTier = getStreakTier(prevStreak);
  const tier = getStreakTier(streak);
  for (const cls of TIER_CLASSES) {
    el.classList.remove(cls);
  }
  if (tier > 0) {
    el.classList.add(`streak-tier-${tier}`);
  }

  // Tier-flash on tier change
  const flashEl = el.querySelector('.streak-tier-flash') as HTMLElement;
  if (flashEl) {
    if (tier > prevTier && prevStreak > 0) {
      flashEl.classList.remove('active');
      void flashEl.offsetWidth;
      flashEl.classList.add('active');
      flashEl.addEventListener('animationend', () => {
        flashEl.classList.remove('active');
      }, { once: true });
    }
  }

  const proxEl = el.querySelector('.streak-proximity') as HTMLElement;
  if (proxEl) {
    applyProximityCue(proxEl, bestStreak - streak);
  }
}

/**
 * Hide the streak display.
 */
export function hideStreakDisplay(): void {
  const el = document.getElementById('streak-display');
  if (el) {
    hide(el);
    el.classList.remove('streak-display--prominent');
  }
}

/**
 * Update the match-end streak info section.
 * @param isRecord - whether a new record was just set
 * @param distanceToBest - how far from personal best (0 if record)
 * @param rank - leaderboard rank (0 to hide)
 * @param prevRank - previous rank for movement display (0 to hide movement)
 */
export function updateStreakEndInfo(
  isRecord: boolean,
  distanceToBest: number,
  rank: number,
  prevRank: number,
): void {
  const container = document.getElementById('streak-end-info');
  const bestEl = document.getElementById('streak-end-best');
  const rankEl = document.getElementById('streak-end-rank');
  if (!container || !bestEl || !rankEl) return;

  show(container);

  if (isRecord || distanceToBest <= 0) {
    bestEl.textContent = '';
  } else {
    bestEl.textContent = `${distanceToBest} more to beat your record`;
  }

  if (rank <= 0) {
    rankEl.innerHTML = '';
    return;
  }

  let rankHtml = '';
  if (rank <= 3) {
    const medalClass = rank === 1 ? 'lb-row--gold' : rank === 2 ? 'lb-row--silver' : 'lb-row--bronze';
    rankHtml += `<span class="lb-medal ${medalClass}"></span>`;
  }

  if (prevRank > 0 && prevRank > rank) {
    rankHtml += `<span>#${prevRank} → #${rank}</span> <span class="streak-end-rank-up">(+${prevRank - rank})</span>`;
  } else {
    rankHtml += `<span>Ranked #${rank}</span>`;
  }
  rankEl.innerHTML = rankHtml;
}

/**
 * Hide the match-end streak info.
 */
export function hideStreakEndInfo(): void {
  const container = document.getElementById('streak-end-info');
  if (container) hide(container);
}

/* ── Killcam sparkle burst (streak increment only) ─────── */

const SPARKLE_COUNT = 14;

/** Spawn sparkle particles around the killcam streak text. */
export function spawnKillcamSparkles(): void {
  const container = document.getElementById('killcam-sparkles');
  if (!container) return;
  container.innerHTML = '';
  container.classList.remove('fading');

  for (let i = 0; i < SPARKLE_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / SPARKLE_COUNT + (Math.random() - 0.5) * 0.4;
    const dist = 60 + Math.random() * 80;  // px spread
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const size = 2 + Math.random() * 4;
    const dur = 0.6 + Math.random() * 0.5;
    const delay = Math.random() * 0.15;

    const dot = document.createElement('span');
    dot.className = 'killcam-sparkle' + (Math.random() < 0.35 ? ' killcam-sparkle--teal' : '');
    dot.style.cssText =
      `--dx:${dx}px;--dy:${dy}px;--size:${size}px;--dur:${dur}s;--delay:${delay}s`;
    container.appendChild(dot);
  }
}

/** Begin fading sparkles out (0.3s CSS transition). */
export function fadeKillcamSparkles(): void {
  const container = document.getElementById('killcam-sparkles');
  if (container) container.classList.add('fading');
}

/** Instantly remove all sparkle DOM nodes. */
export function clearKillcamSparkles(): void {
  const container = document.getElementById('killcam-sparkles');
  if (container) {
    container.innerHTML = '';
    container.classList.remove('fading');
  }
}
