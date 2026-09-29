import type { MapType, LobbyData } from '../types/index';
import { MAPS, getGuestList } from '../types/index';
import { vibrate } from '../vibrate';
import { EVT_MAP_CHANGED } from '../events';
import { isUnlocked } from '../progression/progressionGuard';
import { getProgressionState } from '../progression/progressionManager';

const STORAGE_KEY = 'luminal-map';
export const DEFAULT_MAP: MapType = 'midtown_bowl';

export interface VoteResult {
  winner: MapType | null;
  isTie: boolean;
  tiedMaps: MapType[];
  votesByMap: Map<MapType, string[]>;
}

export function isValidMapId(id: unknown): id is MapType {
  return MAPS.some(m => m.id === id);
}

export function getSelectedMap(): MapType {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isValidMapId(saved) ? saved : DEFAULT_MAP;
}

export function setSelectedMap(map: MapType): void {
  localStorage.setItem(STORAGE_KEY, map);
  document.dispatchEvent(new CustomEvent(EVT_MAP_CHANGED, { detail: { map } }));
}

interface MapSelectorSoloOptions {
  mode: 'solo';
  container: HTMLElement;
  playTick?: () => void;
}

interface MapSelectorLobbyOptions {
  mode: 'lobby';
  container: HTMLElement;
  votes: Map<MapType, Array<{ name: string; color: string; isHost: boolean; icon?: string }>>;
  activeMap: MapType;
  localVote: MapType | null;
  onVote: (map: MapType) => void;
  playTick?: () => void;
}

type MapSelectorOptions = MapSelectorSoloOptions | MapSelectorLobbyOptions;

export function renderMapSelector(opts: MapSelectorOptions): void {
  const { container } = opts;
  container.innerHTML = '';

  // Section label
  const label = document.createElement('div');
  label.className = 'map-select-label';
  label.textContent = 'ARENA';
  container.appendChild(label);

  // Tile row
  const row = document.createElement('div');
  row.className = 'map-select-row';

  const progState = getProgressionState();

  for (const map of MAPS) {
    const tile = document.createElement('div');
    tile.className = 'map-select-tile';
    tile.dataset.map = map.id;

    // Progression lock check
    const mapLocked = !isUnlocked(`map:${map.id}`, progState);
    if (mapLocked) {
      tile.classList.add('map-select-tile--locked');
      tile.style.opacity = '0.35';
      tile.style.pointerEvents = 'none';
    }

    // Selection / active state
    if (opts.mode === 'solo') {
      if (getSelectedMap() === map.id) tile.classList.add('map-select-tile--selected');
    } else {
      if (opts.localVote === map.id) tile.classList.add('map-select-tile--selected');
      if (opts.activeMap === map.id) tile.classList.add('map-select-tile--active');
    }

    // Map name
    const name = document.createElement('span');
    name.className = 'map-select-tile-name';
    name.textContent = map.label;
    tile.appendChild(name);

    // Active badge (lobby only)
    if (opts.mode === 'lobby' && opts.activeMap === map.id) {
      const badge = document.createElement('span');
      badge.className = 'map-select-tile-badge';
      badge.textContent = 'ACTIVE';
      tile.appendChild(badge);
    }

    row.appendChild(tile);

    // Player names below tile (lobby only)
    if (opts.mode === 'lobby') {
      const players = opts.votes.get(map.id) || [];
      const playerList = document.createElement('div');
      playerList.className = 'map-select-tile-players';
      for (const p of players) {
        const pRow = document.createElement('div');
        pRow.className = 'map-select-player-row';

        if (p.isHost) {
          const crown = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          crown.setAttribute('viewBox', '0 0 24 24');
          crown.classList.add('map-select-crown');
          const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
          use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons.svg#i-crown');
          crown.appendChild(use);
          pRow.appendChild(crown);
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'map-select-player-name';
        nameSpan.textContent = p.name;
        nameSpan.style.color = p.color;
        nameSpan.style.textShadow = `0 0 6px ${p.color}`;
        pRow.appendChild(nameSpan);

        playerList.appendChild(pRow);
      }
      tile.appendChild(playerList);
    }
  }

  row.addEventListener('click', (e: MouseEvent) => {
    const tile = (e.target as HTMLElement).closest('.map-select-tile') as HTMLElement | null;
    if (!tile?.dataset.map) return;
    const mapId = tile.dataset.map as MapType;
    if (!isUnlocked(`map:${mapId}`, getProgressionState())) return;
    if (opts.playTick) opts.playTick();
    vibrate(10);
    if (opts.mode === 'solo') {
      setSelectedMap(mapId);
      renderMapSelector(opts);
    } else {
      opts.onVote(mapId);
    }
  });

  container.appendChild(row);
}

export function resolveMapWinner(data: LobbyData): VoteResult {
  const votesByMap = new Map<MapType, string[]>();

  if (data.host.mapVote && isValidMapId(data.host.mapVote)) {
    const arr = votesByMap.get(data.host.mapVote) || [];
    arr.push(data.host.uid);
    votesByMap.set(data.host.mapVote, arr);
  }

  for (const guest of getGuestList(data)) {
    if (guest.mapVote && isValidMapId(guest.mapVote) && guest.presence !== false) {
      const arr = votesByMap.get(guest.mapVote) || [];
      arr.push(guest.uid);
      votesByMap.set(guest.mapVote, arr);
    }
  }

  if (votesByMap.size === 0) {
    return { winner: DEFAULT_MAP, isTie: false, tiedMaps: [], votesByMap };
  }

  let maxCount = 0;
  for (const [, uids] of votesByMap) {
    if (uids.length > maxCount) maxCount = uids.length;
  }

  const topMaps: MapType[] = [];
  for (const [mapId, uids] of votesByMap) {
    if (uids.length === maxCount) topMaps.push(mapId);
  }

  if (topMaps.length === 1) {
    return { winner: topMaps[0], isTie: false, tiedMaps: [], votesByMap };
  }

  return { winner: null, isTie: true, tiedMaps: topMaps, votesByMap };
}
