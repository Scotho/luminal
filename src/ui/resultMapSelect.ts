// ── Result Screen Map Selection ────────────────────────────────────────────────
// Manages showing/hiding the map carousel panel on the result screen.
// Desktop (portrait): vertical carousel, slides in from right as a sidebar.
// Mobile (landscape): horizontal carousel, inline inside #result .content.

import type { MapType } from '../types/index';
import { renderMapCarousel, destroyMapCarousel } from './mapCarousel';
import type { Orientation } from './mapCarousel';
import { getSelectedMap } from './mapSelectUI';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ShowSoloOptions {
  mode: 'solo';
  playTick?: () => void;
}

interface ShowLobbyOptions {
  mode: 'lobby';
  votes: Map<MapType, Array<{ name: string; color: string; isHost: boolean; icon?: string }>>;
  activeMap: MapType;
  localVote: MapType | null;
  onVote: (map: MapType) => void;
  playTick?: () => void;
}

export type ShowOptions = ShowSoloOptions | ShowLobbyOptions;

// ── Module state ──────────────────────────────────────────────────────────────

let currentOpts: ShowOptions | null = null;
let mq: MediaQueryList | null = null;
let mqListener: ((e: MediaQueryListEvent) => void) | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOrientation(): Orientation {
  return window.matchMedia('(max-width: 768px)').matches ? 'landscape' : 'portrait';
}

function repositionPanel(panel: HTMLElement, orientation: Orientation): void {
  // Navigate via panel's parent chain to find #result, avoiding ID collisions
  const result = panel.closest('#result') as HTMLElement | null;
  if (!result) return;

  if (orientation === 'landscape') {
    // Move panel inside #result .content, before #result-buttons
    const content = result.querySelector('.content');
    const resultButtons = result.querySelector('#result-buttons');
    if (content && resultButtons) {
      content.insertBefore(panel, resultButtons);
    }
  } else {
    // Ensure panel is a direct child of #result (its original position)
    if (panel.parentElement !== result) {
      result.appendChild(panel);
    }
  }
}

function renderCarousel(panel: HTMLElement, opts: ShowOptions, orientation: Orientation): void {
  // Use attribute selector instead of ID selector to avoid jsdom duplicate-ID quirks
  const container = panel.querySelector<HTMLElement>('[id="result-map-carousel"]');
  if (!container) return;

  if (opts.mode === 'solo') {
    renderMapCarousel({
      mode: 'solo',
      container,
      orientation,
      playTick: opts.playTick,
    });
  } else {
    renderMapCarousel({
      mode: 'lobby',
      container,
      orientation,
      votes: opts.votes,
      activeMap: opts.activeMap,
      localVote: opts.localVote,
      onVote: opts.onVote,
      playTick: opts.playTick,
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function showResultMapPanel(opts: ShowOptions): void {
  currentOpts = opts;

  // Use the last matching element in document order — in tests, the test's
  // freshly appended element comes after the one loaded by setupDom.
  const panels = document.querySelectorAll<HTMLElement>('#result-map-panel');
  const panel = panels.length > 0 ? panels[panels.length - 1] : null;
  if (!panel) return;

  // Remove hidden synchronously so it's in the layout before transition
  panel.classList.remove('hidden');

  // Trigger CSS transition on next frame
  requestAnimationFrame(() => {
    panel.classList.add('result-map-panel--visible');
  });

  // Determine orientation and reposition
  const orientation = getOrientation();
  repositionPanel(panel, orientation);

  // Render carousel
  renderCarousel(panel, opts, orientation);

  // Watch for breakpoint changes
  mq = window.matchMedia('(max-width: 768px)');
  mqListener = (e: MediaQueryListEvent) => {
    if (!currentOpts) return;
    const newOrientation: Orientation = e.matches ? 'landscape' : 'portrait';
    repositionPanel(panel, newOrientation);
    renderCarousel(panel, currentOpts, newOrientation);
  };
  mq.addEventListener('change', mqListener);
}

export function hideResultMapPanel(): void {
  const panels = document.querySelectorAll<HTMLElement>('#result-map-panel');
  const panel = panels.length > 0 ? panels[panels.length - 1] : null;
  if (panel) {
    panel.classList.remove('result-map-panel--visible');
    panel.classList.add('hidden');

    const container = panel.querySelector<HTMLElement>('[id="result-map-carousel"]');
    if (container) {
      destroyMapCarousel(container);
    }
  }

  // Remove matchMedia listener
  if (mq && mqListener) {
    mq.removeEventListener('change', mqListener);
  }

  // Clear module state
  currentOpts = null;
  mq = null;
  mqListener = null;
}

// ts-prune-ignore-next
export function getResultMapSelection(): MapType {
  return getSelectedMap();
}
