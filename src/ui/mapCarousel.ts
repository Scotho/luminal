// ── Map Carousel Widget ───────────────────────────────────────────────────────
// Reusable horizontal/vertical carousel for map selection with preview images.
// Replaces the flat tile grid in mapSelectUI for richer map browsing UX.

import type { MapType } from '../types/index';
import { MAPS } from '../types/index';
import { getSelectedMap, setSelectedMap } from './mapSelectUI';
import { vibrate } from '../vibrate';
import { initDragScroll, initElasticScroll, revealScrollItem } from './dragScroll';
import { getSynthCityAssets } from '../arena/synthcity';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Orientation = 'landscape' | 'portrait';

export interface CarouselSoloOptions {
  mode: 'solo';
  container: HTMLElement;
  orientation: Orientation;
  playTick?: () => void;
}

export interface CarouselLobbyOptions {
  mode: 'lobby';
  container: HTMLElement;
  orientation: Orientation;
  votes: Map<MapType, Array<{ name: string; color: string; isHost: boolean; icon?: string }>>;
  activeMap: MapType;
  localVote: MapType | null;
  onVote: (map: MapType) => void;
  playTick?: () => void;
}

export type MapCarouselOptions = CarouselSoloOptions | CarouselLobbyOptions;

// ── Cleanup registry ─────────────────────────────────────────────────────────

const cleanupMap = new WeakMap<HTMLElement, () => void>();

// ── Public API ────────────────────────────────────────────────────────────────

export function renderMapCarousel(opts: MapCarouselOptions): void {
  // Destroy any existing instance first
  destroyMapCarousel(opts.container);

  const { orientation } = opts;
  const axis: 'x' | 'y' = orientation === 'portrait' ? 'y' : 'x';

  // ── Root element ────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.className = `map-carousel map-carousel--${orientation}`;

  // ── Build tiles ─────────────────────────────────────────────────────────────
  let selectedTile: HTMLElement | null = null;

  for (const map of MAPS) {
    const tile = document.createElement('div');
    tile.className = 'map-carousel-tile';
    tile.id = `map-tile-${map.id}`;
    tile.dataset.map = map.id;
    tile.style.backgroundImage = `url('${map.preview}')`;

    // Selection / active state
    if (opts.mode === 'solo') {
      if (getSelectedMap() === map.id) {
        tile.classList.add('map-carousel-tile--selected');
        selectedTile = tile;
      }
    } else {
      if (opts.localVote === map.id) {
        tile.classList.add('map-carousel-tile--selected');
        selectedTile = tile;
      }
      if (opts.activeMap === map.id) {
        tile.classList.add('map-carousel-tile--active');
      }
    }

    // Map name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'map-carousel-name';
    nameSpan.textContent = map.label;
    tile.appendChild(nameSpan);

    // Active badge (lobby only)
    if (opts.mode === 'lobby' && opts.activeMap === map.id) {
      const badge = document.createElement('span');
      badge.className = 'map-carousel-badge';
      badge.textContent = 'ACTIVE';
      tile.appendChild(badge);
    }

    // Player vote list (lobby only)
    if (opts.mode === 'lobby') {
      const players = opts.votes.get(map.id) ?? [];
      if (players.length > 0) {
        const playerList = document.createElement('div');
        playerList.className = 'map-carousel-players';

        for (const p of players) {
          const pRow = document.createElement('div');
          pRow.className = 'map-carousel-player-row';

          if (p.isHost) {
            const crown = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            crown.setAttribute('viewBox', '0 0 24 24');
            crown.classList.add('map-carousel-crown');
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons.svg#i-crown');
            crown.appendChild(use);
            pRow.appendChild(crown);
          }

          const nameEl = document.createElement('span');
          nameEl.className = 'map-carousel-player-name';
          nameEl.textContent = p.name;
          nameEl.style.color = p.color;
          nameEl.style.textShadow = `0 0 6px ${p.color}`;
          pRow.appendChild(nameEl);

          playerList.appendChild(pRow);
        }

        tile.appendChild(playerList);
      }
    }

    root.appendChild(tile);
  }

  // ── Event delegation ─────────────────────────────────────────────────────────
  function onClick(e: MouseEvent): void {
    const tile = (e.target as HTMLElement).closest('.map-carousel-tile') as HTMLElement | null;
    if (!tile?.dataset.map) return;
    const mapId = tile.dataset.map as MapType;
    if (opts.playTick) opts.playTick();
    vibrate(10);
    // Pre-warm synth_city's OBJ + texture bundle so the match builder doesn't
    // have to block on asset load. Fire-and-forget — subsequent selections hit
    // the cache for free.
    if (mapId === 'synth_city') {
      getSynthCityAssets().catch(() => { /* swallow — builder will log */ });
    }
    if (opts.mode === 'solo') {
      setSelectedMap(mapId);
      renderMapCarousel(opts);
      // Re-apply gamepad nav focus after re-render
      const newTile = opts.container.querySelector(`[data-map="${mapId}"]`);
      if (newTile) newTile.classList.add('map-carousel-tile--nav-focus');
    } else {
      opts.onVote(mapId);
    }
  }

  root.addEventListener('click', onClick);

  // ── Mount ────────────────────────────────────────────────────────────────────
  opts.container.appendChild(root);

  // ── Drag scroll ──────────────────────────────────────────────────────────────
  let cleanupDrag: (() => void) | null = null;
  let cleanupElastic: (() => void) | null = null;

  if (typeof root.setPointerCapture === 'function') {
    cleanupDrag = initDragScroll(root);
    cleanupElastic = initElasticScroll(root, { axis });
  }

  // Scroll selected tile into view on next frame
  if (selectedTile) {
    const tileRef = selectedTile;
    requestAnimationFrame(() => {
      revealScrollItem(root, tileRef, axis, 'auto');
    });
  }

  // ── Mobile snap tracking ──────────────────────────────────────────────────
  let snapCleanup: (() => void) | null = null;

  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    let snapRaf: number | null = null;
    let lastSnapIndex = -1;

    const updateSnap = (): void => {
      const rootRect = root.getBoundingClientRect();
      const isVertical = orientation === 'portrait';
      const center = isVertical
        ? rootRect.top + rootRect.height / 2
        : rootRect.left + rootRect.width / 2;

      const tiles = root.querySelectorAll('.map-carousel-tile') as NodeListOf<HTMLElement>;
      let closestIdx = 0;
      let closestDist = Infinity;

      tiles.forEach((tile, i) => {
        const rect = tile.getBoundingClientRect();
        const tileCtr = isVertical
          ? rect.top + rect.height / 2
          : rect.left + rect.width / 2;
        const dist = Math.abs(tileCtr - center);
        if (dist < closestDist) { closestDist = dist; closestIdx = i; }
      });

      tiles.forEach((tile, i) => {
        tile.classList.toggle('map-carousel-tile--snap-active', i === closestIdx);
      });

      if (closestIdx !== lastSnapIndex) {
        lastSnapIndex = closestIdx;
        if (navigator.vibrate) navigator.vibrate(8);
      }
    };

    const onScroll = (): void => {
      if (snapRaf !== null) cancelAnimationFrame(snapRaf);
      snapRaf = requestAnimationFrame(updateSnap);
    };

    root.addEventListener('scroll', onScroll, { passive: true });

    snapCleanup = () => {
      root.removeEventListener('scroll', onScroll);
      if (snapRaf !== null) cancelAnimationFrame(snapRaf);
    };
  }

  // ── Register cleanup ─────────────────────────────────────────────────────────
  cleanupMap.set(opts.container, () => {
    root.removeEventListener('click', onClick);
    if (cleanupDrag) cleanupDrag();
    if (cleanupElastic) cleanupElastic();
    if (snapCleanup) snapCleanup();
    root.remove();
  });
}

export function destroyMapCarousel(container: HTMLElement): void {
  const cleanup = cleanupMap.get(container);
  if (cleanup) {
    cleanup();
    cleanupMap.delete(container);
  }
}
