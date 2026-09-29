import type { MapType } from '../types/index';
import { seededRandom } from '../core/seededRandom';
import { playWheelBoot, playWheelTick, playWheelLock, playWheelReveal } from '../sfx';

// ── Map Wheel Tiebreaker ───────────────────────────────
// Cyberpunk-ritual spinning wheel for tied map votes.

export interface MapWheelCandidate {
  mapId: MapType;
  label: string;
  playerNames: string[];
}

/** Salt added to match seed to derive wheel result. */
const WHEEL_FLIP_SALT = 0x4D415057; // "MAPW" in hex

/**
 * Deterministically pick a winner index from a seed.
 * All clients compute the same result independently.
 */
export function computeWheelWinner(seed: number, candidateCount: number): number {
  const rng = seededRandom(seed + WHEEL_FLIP_SALT);
  return Math.floor(rng() * candidateCount);
}

/**
 * Compute the total rotation degrees that lands the arrow
 * on the center of the winning slice. Arrow is at 12 o'clock (0°).
 */
export function computeWheelRotation(winnerIndex: number, numSlices: number): number {
  const sliceSize = 360 / numSlices;
  const sliceCenter = (winnerIndex * sliceSize) + (sliceSize / 2);
  return (3 * 360) + (360 - sliceCenter);
}

// ── DOM Construction ──────────────────────────────────

/** Slice color palette — cycles for N maps */
const SLICE_COLORS: string[] = [
  'rgba(11, 54, 61, 0.95)',   // teal-800
  'rgba(73, 47, 30, 0.95)',   // warm orange-brown
  'rgba(45, 28, 65, 0.95)',   // purple (3rd map+)
  'rgba(30, 60, 40, 0.95)',   // forest green (4th+)
  'rgba(65, 35, 35, 0.95)',   // deep red (5th+)
];

/** Build the conic-gradient value for N slices */
function buildConicGradient(count: number): string {
  const sliceSize = 360 / count;
  const stops: string[] = [];
  for (let i = 0; i < count; i++) {
    const color = SLICE_COLORS[i % SLICE_COLORS.length];
    const start = i * sliceSize;
    const end = start + sliceSize;
    stops.push(`${color} ${start}deg ${end}deg`);
  }
  return `conic-gradient(from 0deg, ${stops.join(', ')})`;
}

/** Create the full wheel overlay DOM tree. Returns the root element + key refs. */
export function createWheelDOM(candidates: MapWheelCandidate[]): {
  overlay: HTMLElement;
  innerWheel: HTMLElement;
  ring: SVGElement;
  titleEl: HTMLElement;
  resultEl: HTMLElement;
  votersEl: HTMLElement;
  labels: HTMLElement[];
} {
  const overlay = document.createElement('div');
  overlay.className = 'map-wheel-overlay';

  // Title
  const titleEl = document.createElement('div');
  titleEl.className = 'map-wheel-title';
  overlay.appendChild(titleEl);

  // Wheel container
  const container = document.createElement('div');
  container.className = 'map-wheel-container map-wheel-container--materializing';

  // SVG ring
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('class', 'map-wheel-ring');
  ring.setAttribute('viewBox', '0 0 258 258');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '129');
  circle.setAttribute('cy', '129');
  circle.setAttribute('r', '128');
  ring.appendChild(circle);
  container.appendChild(ring);

  // Arrow
  const arrow = document.createElement('div');
  arrow.className = 'map-wheel-arrow';
  container.appendChild(arrow);

  // Disc (clips the inner wheel)
  const disc = document.createElement('div');
  disc.className = 'map-wheel-disc';

  // Inner wheel (spins)
  const innerWheel = document.createElement('div');
  innerWheel.className = 'map-wheel-inner';
  innerWheel.style.background = buildConicGradient(candidates.length);

  // Slice labels — placed at the outer band, rotated radially so each
  // label sits on its own slice's side (not overlapping at the hub).
  // Label radius is a CSS var on the container so mobile can scale it.
  const sliceSize = 360 / candidates.length;
  const labels: HTMLElement[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const label = document.createElement('div');
    label.className = 'map-wheel-label';
    label.textContent = candidates[i].label;
    const midAngle = (i * sliceSize) + (sliceSize / 2);
    label.style.transform =
      `translate(-50%, -50%) rotate(${midAngle}deg) translateY(calc(-1 * var(--mw-label-r, 92px)))`;
    label.dataset.angle = String(midAngle);
    innerWheel.appendChild(label);
    labels.push(label);
  }

  disc.appendChild(innerWheel);
  container.appendChild(disc);

  // Center hub
  const hub = document.createElement('div');
  hub.className = 'map-wheel-hub';
  container.appendChild(hub);

  overlay.appendChild(container);

  // Result text
  const resultEl = document.createElement('div');
  resultEl.className = 'map-wheel-result';
  overlay.appendChild(resultEl);

  // Voter names
  const votersEl = document.createElement('div');
  votersEl.className = 'map-wheel-voters';
  for (const c of candidates) {
    const group = document.createElement('span');
    group.textContent = c.playerNames.join(', ');
    votersEl.appendChild(group);
  }
  overlay.appendChild(votersEl);

  return { overlay, innerWheel, ring, titleEl, resultEl, votersEl, labels };
}

// ── Animation Helpers ────────────────────────────────

/** Type out text letter-by-letter into an element. */
function typeText(el: HTMLElement, text: string, charMs: number): Promise<void> {
  return new Promise(resolve => {
    let i = 0;
    const cursor = document.createElement('span');
    cursor.className = 'map-wheel-cursor';
    el.textContent = '';
    el.appendChild(cursor);

    const interval = setInterval(() => {
      if (i < text.length) {
        el.insertBefore(document.createTextNode(text[i]), cursor);
        i++;
      } else {
        clearInterval(interval);
        setTimeout(() => { cursor.remove(); resolve(); }, 300);
      }
    }, charMs);
  });
}

/** Simple delay helper. */
function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Schedule brief glitch-pulse class toggles at random-ish intervals during spin. */
function scheduleGlitchPulses(el: HTMLElement, count: number, overMs: number): void {
  for (let i = 0; i < count; i++) {
    const delay = (overMs / (count + 1)) * (i + 1) + (Math.random() * 200 - 100);
    setTimeout(() => {
      el.classList.add('map-wheel--glitch-pulse');
      el.addEventListener('animationend', () => {
        el.classList.remove('map-wheel--glitch-pulse');
      }, { once: true });
    }, Math.max(0, delay));
  }
}

// ── Main Ceremony ────────────────────────────────────

/**
 * Play the full map wheel tiebreaker ceremony.
 * Returns the winning MapId after ~5.7s animation.
 */
export async function playMapWheel(
  candidates: MapWheelCandidate[],
  seed: number,
): Promise<MapType> {
  const winnerIndex = computeWheelWinner(seed, candidates.length);
  const totalDeg = computeWheelRotation(winnerIndex, candidates.length);

  const { overlay, innerWheel, ring, titleEl, resultEl, votersEl, labels } =
    createWheelDOM(candidates);

  document.body.appendChild(overlay);

  // ── Phase 1: MATERIALIZE (1.0s) ──
  void overlay.offsetHeight;
  overlay.classList.add('map-wheel-overlay--visible');

  await wait(50);
  ring.classList.add('map-wheel-ring--drawn');
  playWheelBoot();

  await typeText(titleEl, 'MAP TIEBREAKER', 45);
  await wait(200);

  // ── Phase 2: SPIN (3.0s) ──
  scheduleGlitchPulses(titleEl, 4, 3000);

  // Schedule tick sounds at slice boundaries during spin deceleration
  const sliceSize = 360 / candidates.length;
  const totalSliceCrossings = Math.floor(totalDeg / sliceSize);
  const tickCount = Math.min(totalSliceCrossings, 40);
  for (let i = 0; i < tickCount; i++) {
    const t = i / tickCount;
    const eased = 1 - Math.pow(1 - t, 3);
    const delay = eased * 3000;
    setTimeout(() => playWheelTick(), delay);
  }

  innerWheel.style.transform = `rotate(${totalDeg}deg)`;

  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 3500);
    innerWheel.addEventListener('transitionend', () => { clearTimeout(timeout); resolve(); }, { once: true });
  });

  // ── Phase 3: LOCK-IN (1.2s) ──
  const flash = document.createElement('div');
  flash.className = 'map-wheel-flash';
  document.body.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove(), { once: true });

  const arrowEl = overlay.querySelector('.map-wheel-arrow') as HTMLElement;
  if (arrowEl) arrowEl.classList.add('map-wheel-arrow--locked');

  playWheelLock();

  for (let i = 0; i < labels.length; i++) {
    if (i === winnerIndex) {
      labels[i].classList.add('map-wheel-label--winner');
    } else {
      labels[i].classList.add('map-wheel-label--loser');
    }
  }

  resultEl.classList.add('map-wheel-result--visible');
  await wait(300);
  playWheelReveal();
  await typeText(resultEl, candidates[winnerIndex].label, 60);

  votersEl.classList.add('map-wheel-voters--visible');
  await wait(400);

  // ── Phase 4: DISSOLVE (0.5s) ──
  const container = overlay.querySelector('.map-wheel-container') as HTMLElement;
  container.classList.remove('map-wheel-container--materializing');
  container.classList.add('map-wheel-container--dissolving');

  overlay.classList.remove('map-wheel-overlay--visible');
  await wait(900);

  overlay.remove();

  return candidates[winnerIndex].mapId;
}
