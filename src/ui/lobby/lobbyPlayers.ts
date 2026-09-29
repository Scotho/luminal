// ── Lobby Players ─────────────────────────────────────────
// Player card rendering, color pickers, vehicle grid, and map grid.
// Extracted from lobbyUI.ts; all state access goes through LobbyContext.

import type { LobbyContext } from './lobbyContext';
import type { DisposableBag } from '../../disposables';
import type { LobbyData, VehicleType, MapType } from '../../types/index';
import { COLOR_MAP, COLOR_KEYS, LOADOUTS, DISABLED_LOADOUTS, MAX_LOBBY_SIZE } from './lobbyContext';
import { getGuestList, getGuestByUid, hasGuest, MAPS } from '../../types/index';
import { DEFAULT_PLAYER_COLOR_KEY } from '../../playerColors';
import { notifySettingChanged } from '../../settingsSync';
import { updateLobbyPlayer, updateLobbySettings } from '../../lobby';
import { onLongPress } from '../dom';
import { renderMapCarousel } from '../mapCarousel';
import { setSelectedMap, resolveMapWinner, DEFAULT_MAP } from '../mapSelectUI';
import { EVT_LOBBY_CTX_MENU } from '../../events';
import { getPreviewCanvasDeferred } from '../lobbyPreview';
import { playConfirm } from '../../sfx';
import { initDragScroll, initElasticScroll, revealScrollItem } from '../dragScroll';
import { selectAiSlot, addAiToSlot, expandAndAddAi, removeSlot, syncAisToServer, cycleAiColor } from './lobbyAI';

// ── Module-level state ──────────────────────────────────
let _shakeTimeout: ReturnType<typeof setTimeout> | null = null;

// ── Cached DOM elements ──────────────────────────────────
let _playersColEl: HTMLElement | null = null;
let _vehicleGridEl: HTMLElement | null = null;
let _colorRowEl: HTMLElement | null = null;

function _getPlayersCol(): HTMLElement | null {
  if (!_playersColEl) _playersColEl = document.getElementById('lobby-players-col');
  return _playersColEl;
}
function _getVehicleGrid(): HTMLElement | null {
  if (!_vehicleGridEl) _vehicleGridEl = document.getElementById('lobby-vehicle-grid');
  return _vehicleGridEl;
}
function _getColorRow(): HTMLElement | null {
  if (!_colorRowEl) _colorRowEl = document.getElementById('lobby-color-row');
  return _colorRowEl;
}

// ── UI helpers ──────────────────────────────────────────

/** SVG icon string for ready button: ✓ when ready, ✕ when not */
export function readyIcon(ready: boolean): string {
  return `<svg class="icon" style="width:14px;height:14px;margin-right:4px;stroke-width:3"><use href="/icons.svg#i-${ready ? 'check' : 'x'}"/></svg>`;
}

/** Create a bot icon as a flex-level sibling (matches party-member-icon sizing). */
export function botIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'party-member-icon party-member-icon--bot');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons.svg#i-bot');
  svg.appendChild(use);
  return svg;
}

/** Set element content to just the name text (bot icon is now a separate flex sibling). */
export function setBotName(el: HTMLElement, name: string): void {
  el.textContent = name;
}

// ── Color picker ──────────────────────────────────────────

/** Collect all colors in use by opponents and AIs (not including the local player).
 *  Returns a map of color key → owner name for tooltip display.
 *  When editing an AI slot, exclude that slot's own color so it stays selectable. */
export function getTakenColors(ctx: LobbyContext): Map<string, string> {
  const taken = new Map<string, string>();
  const data = ctx.getLastLobbyData();
  const myRole = ctx.getMyRole();
  const currentUid = ctx.getCurrentUid();
  const aiSlots = ctx.getAiSlots();
  const selectedAiSlot = ctx.getSelectedAiSlot();

  if (data) {
    if (myRole === 'host') {
      for (const g of getGuestList(data)) taken.set(g.color, g.username);
    } else {
      taken.set(data.host.color, data.host.username);
      for (const g of getGuestList(data)) {
        if (g.uid !== currentUid) taken.set(g.color, g.username);
      }
    }
  }
  for (const [slot, ai] of aiSlots) {
    if (selectedAiSlot === null || slot !== selectedAiSlot) taken.set(ai.color, ai.name);
  }
  return taken;
}

export function renderColorPicker(containerOrId: string | HTMLElement, selectedColor: string, isLocal: boolean, ctx: LobbyContext): void {
  const container = typeof containerOrId === 'string' ? document.getElementById(containerOrId) : containerOrId;
  if (!container) return;
  container.innerHTML = '';
  const takenColors = getTakenColors(ctx);
  for (const key of COLOR_KEYS) {
    const dot = document.createElement('div');
    dot.className = 'lobby-color-opt';
    dot.dataset.color = key;
    dot.style.background = COLOR_MAP[key];
    dot.style.boxShadow = `0 0 6px ${COLOR_MAP[key]}`;
    if (key === selectedColor) dot.classList.add('lobby-color-opt--selected');
    if (!isLocal && key !== selectedColor) {
      dot.style.opacity = key === selectedColor ? '1' : '0.15';
    }
    if (isLocal && takenColors.has(key)) {
      dot.classList.add('lobby-color-opt--taken');
      dot.setAttribute('data-tip', `TAKEN BY ${takenColors.get(key)!.toUpperCase()}`);
    }
    if (isLocal) {
      dot.addEventListener('click', () => _onColorClick(key, ctx));
    }
    container.appendChild(dot);
  }
}

export function renderColorPickerForSelection(data: LobbyData, ctx: LobbyContext): void {
  const colorRow = _getColorRow();
  if (!colorRow) return;
  const selectedAiSlot = ctx.getSelectedAiSlot();
  const aiSlots = ctx.getAiSlots();
  if (selectedAiSlot !== null) {
    const ai = aiSlots.get(selectedAiSlot);
    if (ai) {
      renderColorPicker(colorRow, ai.color, true, ctx);
      return;
    }
  }
  // Default: show local player's color picker
  const myRole = ctx.getMyRole();
  const currentUid = ctx.getCurrentUid();
  const isHost = myRole === 'host';
  if (isHost) {
    renderColorPicker(colorRow, data.host.color, true, ctx);
  } else if (currentUid && hasGuest(data, currentUid)) {
    renderColorPicker(colorRow, getGuestByUid(data, currentUid)!.color, true, ctx);
  }
}

function _onColorClick(colorKey: string, ctx: LobbyContext): void {
  const currentLobbyId = ctx.getCurrentLobbyId();
  const myRole = ctx.getMyRole();
  if (!currentLobbyId || !myRole) return;

  // If editing an AI, change the AI's color instead
  const selectedAiSlot = ctx.getSelectedAiSlot();
  if (selectedAiSlot !== null) {
    const ai = ctx.getAiSlots().get(selectedAiSlot);
    if (ai) {
      ai.color = colorKey;
      syncAisToServer(ctx);
      const lastData = ctx.getLastLobbyData();
      if (lastData) {
        renderColorPickerForSelection(lastData, ctx);
        ctx.renderVehicleGrid(lastData);
        ctx.updatePartyHud(lastData);
      }
    }
    return;
  }

  if (getTakenColors(ctx).has(colorKey)) {
    // Conflict — shake feedback
    const myContainerId = myRole === 'host' ? 'lobby-colors-host' : 'lobby-colors-guest';
    const dot = document.querySelector(`#${myContainerId} .lobby-color-opt[data-color="${colorKey}"]`);
    if (dot) {
      if (_shakeTimeout) clearTimeout(_shakeTimeout);
      dot.classList.remove('lobby-color-opt--shake');
      void (dot as HTMLElement).offsetWidth; // force reflow for re-trigger
      dot.classList.add('lobby-color-opt--shake');
      _shakeTimeout = setTimeout(() => { dot.classList.remove('lobby-color-opt--shake'); _shakeTimeout = null; }, 400);
    }
    return;
  }
  localStorage.setItem('luminal-color', colorKey);
  notifySettingChanged();
  const currentUid = ctx.getCurrentUid();
  updateLobbyPlayer(currentLobbyId, myRole, { color: colorKey }, currentUid!).catch(e => console.warn('lobby: color update failed', e));
}

// ── Lobby cards ───────────────────────────────────────────

export function renderLobbyCards(data: LobbyData, ctx: LobbyContext): void {
  const col = _getPlayersCol();
  if (!col) return;
  col.innerHTML = '';

  const myRole = ctx.getMyRole();
  const currentUid = ctx.getCurrentUid();
  const aiSlots = ctx.getAiSlots();
  const selectedAiSlot = ctx.getSelectedAiSlot();
  const isHost = myRole === 'host';
  const lobbySize = data.settings.lobbySize || 2;

  // Clean up AI slots beyond current lobby size
  for (const [slot] of aiSlots) {
    if (slot >= lobbySize) aiSlots.delete(slot);
  }

  // Build ordered guest list for slot assignment: slot 1, 2, ... after host
  const guestArr = getGuestList(data);

  for (let i = 0; i < lobbySize; i++) {
    const card = document.createElement('div');
    card.className = 'lobby-card';
    card.dataset.slot = String(i);

    const guestForSlot = (i >= 1 && i <= guestArr.length) ? guestArr[i - 1] : null;

    if (i === 0) {
      // Host card
      _buildPlayerCard(card, 'HOST', data.host.username, data.host.color, data.host.icon, isHost, 'host', data.host.vehicle, ctx);
      if (isHost) {
        card.addEventListener('click', () => {
          if (selectedAiSlot !== null) selectAiSlot(null, ctx);
        });
      } else {
        const hostUid = data.host.uid;
        const hostName = data.host.username;
        card.addEventListener('contextmenu', (e: MouseEvent) => {
          e.preventDefault();
          _showLobbyContextMenuExternal(e.clientX, e.clientY, {
            canAddFriend: true,
            playerUid: hostUid,
            playerUsername: hostName,
          }, ctx);
        });
        onLongPress(card, (x, y) => _showLobbyContextMenuExternal(x, y, { canAddFriend: true, playerUid: hostUid, playerUsername: hostName }, ctx));
      }
    } else if (guestForSlot) {
      // Guest card
      const label = `PLAYER ${i + 1}`;
      const isSelf = guestForSlot.uid === currentUid;
      _buildPlayerCard(card, label, guestForSlot.username, guestForSlot.color, guestForSlot.icon, isSelf, 'guest', guestForSlot.vehicle, ctx);
      {
        const guestUid = guestForSlot.uid;
        const guestName = guestForSlot.username;
        card.addEventListener('contextmenu', (e: MouseEvent) => {
          e.preventDefault();
          _showLobbyContextMenuExternal(e.clientX, e.clientY, {
            canKick: isHost && !isSelf,
            canPromote: isHost && !isSelf,
            canAddFriend: !isSelf,
            playerUid: guestUid,
            playerUsername: guestName,
            slotIndex: i,
          }, ctx);
        });
        onLongPress(card, (x, y) => _showLobbyContextMenuExternal(x, y, {
          canKick: isHost && !isSelf,
          canPromote: isHost && !isSelf,
          canAddFriend: !isSelf,
          playerUid: guestUid,
          playerUsername: guestName,
          slotIndex: i,
        }, ctx));
      }
    } else if (aiSlots.has(i)) {
      // AI card
      const ai = aiSlots.get(i)!;
      card.classList.add('lobby-card--ai');
      if (selectedAiSlot === i) card.classList.add('lobby-card--selected');
      _buildAiCard(card, ai.name, ai.color, i, isHost, ctx);
      if (isHost) {
        const slotIdx = i;
        card.addEventListener('click', () => selectAiSlot(slotIdx, ctx));
      }
    } else {
      // Open slot
      card.className = 'lobby-card lobby-card--empty';
      if (isHost) {
        const addBtn = document.createElement('div');
        addBtn.className = 'lobby-card-add';
        addBtn.dataset.testid = 'lobby-ai-add-btn';
        addBtn.textContent = '+';
        const slotIdx = i;
        addBtn.addEventListener('click', () => addAiToSlot(slotIdx, ctx));
        card.appendChild(addBtn);
      }
    }

    col.appendChild(card);
  }

  // Extra "+" expansion card — host only, below max size
  if (isHost && lobbySize < MAX_LOBBY_SIZE) {
    const expandCard = document.createElement('div');
    expandCard.className = 'lobby-card lobby-card--empty';
    const addBtn = document.createElement('div');
    addBtn.className = 'lobby-card-add';
    addBtn.dataset.testid = 'lobby-ai-add-btn';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => expandAndAddAi(lobbySize, ctx));
    expandCard.appendChild(addBtn);
    col.appendChild(expandCard);
  }
}

function _buildPlayerCard(card: HTMLElement, tag: string, name: string, colorKey: string, icon: string | undefined, isLocal: boolean, role: 'host' | 'guest', vehicle: VehicleType | null | undefined, ctx: LobbyContext): void {
  const tagEl = document.createElement('div');
  tagEl.className = 'lobby-card-tag';
  tagEl.textContent = tag;

  const dot = document.createElement('div');
  dot.className = 'lobby-card-dot';
  const css = COLOR_MAP[colorKey] || '#0ff';
  dot.style.background = css;
  dot.style.boxShadow = `0 0 8px ${css}`;

  let iconEl: SVGSVGElement | null = null;
  if (icon) {
    iconEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconEl.setAttribute('viewBox', '0 0 24 24');
    iconEl.classList.add('party-member-icon', `party-icon-${icon}`);
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#i-${icon}`);
    iconEl.appendChild(use);
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'lobby-card-name';
  nameEl.textContent = name;

  const colors = document.createElement('div');
  colors.className = 'lobby-card-colors';
  if (isLocal) colors.id = `lobby-colors-${role}`;

  card.appendChild(tagEl);
  card.appendChild(dot);
  if (iconEl) card.appendChild(iconEl);
  card.appendChild(nameEl);
  card.appendChild(colors);

  renderColorPicker(colors, colorKey, isLocal, ctx);

  // suppress unused warning
  void vehicle;
}

function _buildAiCard(card: HTMLElement, name: string, colorKey: string, slotIndex: number, isHost: boolean, ctx: LobbyContext): void {
  const tagEl = document.createElement('div');
  tagEl.className = 'lobby-card-tag';
  tagEl.textContent = 'AI';
  card.appendChild(tagEl);

  const css = COLOR_MAP[colorKey] || '#0ff';

  if (isHost) {
    const colorRow = document.createElement('div');
    colorRow.className = 'lobby-ai-color-row';

    const leftArrow = document.createElement('span');
    leftArrow.className = 'lobby-ai-arrow';
    leftArrow.innerHTML = '<svg class="icon" style="width:12px;height:12px"><use href="/icons.svg#i-chev-l"/></svg>';
    leftArrow.addEventListener('click', (e) => { e.stopPropagation(); cycleAiColor(slotIndex, -1, ctx); });

    const colorDot = document.createElement('div');
    colorDot.className = 'lobby-ai-color-preview';
    colorDot.style.background = css;
    colorDot.style.boxShadow = `0 0 6px ${css}`;

    const rightArrow = document.createElement('span');
    rightArrow.className = 'lobby-ai-arrow';
    rightArrow.innerHTML = '<svg class="icon" style="width:12px;height:12px"><use href="/icons.svg#i-chev-r"/></svg>';
    rightArrow.addEventListener('click', (e) => { e.stopPropagation(); cycleAiColor(slotIndex, 1, ctx); });

    colorRow.appendChild(leftArrow);
    colorRow.appendChild(colorDot);
    colorRow.appendChild(rightArrow);
    card.appendChild(colorRow);
  } else {
    const dot = document.createElement('div');
    dot.className = 'lobby-card-dot';
    dot.style.background = css;
    dot.style.boxShadow = `0 0 8px ${css}`;
    card.appendChild(dot);
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'lobby-card-name';
  setBotName(nameEl, name);
  card.appendChild(nameEl);

  if (isHost) {
    const removeBtn = document.createElement('div');
    removeBtn.className = 'lobby-ai-remove';
    removeBtn.textContent = 'REMOVE';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeSlot(slotIndex, ctx); });
    card.appendChild(removeBtn);
  }
}

// Delegate context menu to lobbyUI via a DOM event (avoids circular import)
interface CtxMenuOpts {
  canKick?: boolean;
  canPromote?: boolean;
  canRemoveSpace?: boolean;
  canLeave?: boolean;
  canAddFriend?: boolean;
  playerUid?: string;
  playerUsername?: string;
  slotIndex?: number;
}

function _showLobbyContextMenuExternal(x: number, y: number, opts: CtxMenuOpts, _ctx: LobbyContext): void {
  // Dispatch a custom event that lobbyUI.ts handles
  document.dispatchEvent(new CustomEvent(EVT_LOBBY_CTX_MENU, { detail: { x, y, opts } }));
}

// ── Vehicle grid ──────────────────────────────────────────

export function renderVehicleGrid(data: LobbyData, ctx: LobbyContext): void {
  const myRole = ctx.getMyRole();
  const currentUid = ctx.getCurrentUid();
  const aiSlots = ctx.getAiSlots();

  // Clear all tile player containers and selected state
  for (const vType of LOADOUTS) {
    const container = document.getElementById(`lobby-vtile-${vType}-players`);
    const tile = document.getElementById(`lobby-vtile-${vType}`);
    if (container) container.innerHTML = '';
    if (tile) tile.classList.remove('lobby-vehicle-tile--selected');
  }

  // Insert 3D preview canvases into vehicle tiles (colored by local player)
  const localColor = myRole === 'host' ? data.host.color : (currentUid ? getGuestByUid(data, currentUid)?.color || DEFAULT_PLAYER_COLOR_KEY : DEFAULT_PLAYER_COLOR_KEY);
  for (const vType of LOADOUTS) {
    const tile = document.getElementById(`lobby-vtile-${vType}`);
    if (!tile) continue;
    const oldPreview = tile.querySelector('.lobby-card-preview');
    if (oldPreview) oldPreview.remove();

    const _insertCanvas = (canvas: HTMLCanvasElement): void => {
      const t = document.getElementById(`lobby-vtile-${vType}`);
      if (!t) return;
      const existing = t.querySelector('.lobby-card-preview');
      if (existing) existing.remove();
      const existingFloor = t.querySelector('.lobby-vtile-floor');
      if (existingFloor) existingFloor.remove();
      const wrap = document.createElement('div');
      wrap.className = 'lobby-card-preview';
      wrap.appendChild(canvas);
      const floor = document.createElement('div');
      floor.className = 'lobby-vtile-floor';
      const meta = t.querySelector('.lobby-vehicle-tile-meta');
      if (meta) { t.insertBefore(floor, meta); t.insertBefore(wrap, floor); }
      else { t.prepend(floor); t.prepend(wrap); }
    };

    getPreviewCanvasDeferred(`vtile-${vType}`, localColor, vType, _insertCanvas);
  }

  const isHost = myRole === 'host';

  // Collect all players with their vehicle choice
  const allPlayers: Array<{ name: string; color: string; vehicle: VehicleType | null; isLocal: boolean; isAi: boolean; isHost: boolean; icon?: string; ready: boolean }> = [];

  allPlayers.push({
    name: data.host.username,
    color: data.host.color,
    vehicle: data.host.vehicle || null,
    isLocal: isHost,
    isAi: false,
    isHost: true,
    icon: data.host.icon,
    ready: !!data.host.ready,
  });

  for (const guest of getGuestList(data)) {
    allPlayers.push({
      name: guest.username,
      color: guest.color,
      vehicle: guest.vehicle || null,
      isLocal: guest.uid === currentUid,
      isAi: false,
      isHost: false,
      icon: guest.icon,
      ready: !!guest.ready,
    });
  }

  for (const [, ai] of aiSlots) {
    allPlayers.push({
      name: ai.name,
      color: ai.color,
      vehicle: ai.vehicle,
      isLocal: false,
      isAi: true,
      isHost: false,
      ready: true,
    });
  }

  // Place player indicators on the correct vehicle tile
  for (const p of allPlayers) {
    if (!p.vehicle) continue;
    const container = document.getElementById(`lobby-vtile-${p.vehicle}-players`);
    if (!container) continue;

    const row = document.createElement('div');
    row.className = 'lobby-vtile-player-row';
    const css = COLOR_MAP[p.color] || '#0ff';

    // Crown for host
    if (p.isHost) {
      const crown = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      crown.setAttribute('viewBox', '0 0 24 24');
      crown.classList.add('lobby-vtile-crown');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons.svg#i-crown');
      crown.appendChild(use);
      row.appendChild(crown);
    }

    // Player icon badge
    if (p.icon) {
      const ico = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ico.setAttribute('viewBox', '0 0 24 24');
      ico.classList.add('lobby-vtile-icon');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#i-${p.icon}`);
      ico.appendChild(use);
      row.appendChild(ico);
    }

    // Bot icon for AI
    if (p.isAi) {
      const bot = botIcon();
      bot.setAttribute('class', 'lobby-vtile-icon');
      bot.style.color = css;
      bot.style.stroke = 'currentColor';
      row.appendChild(bot);
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'lobby-vehicle-tile-player';
    if (p.isAi) nameSpan.classList.add('lobby-vehicle-tile-player--ai');
    nameSpan.textContent = p.name;
    nameSpan.style.color = css;
    nameSpan.style.textShadow = `0 0 6px ${css}`;
    if (p.isLocal) nameSpan.classList.add('lobby-vehicle-tile-player--selected');
    row.appendChild(nameSpan);

    const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    check.setAttribute('viewBox', '0 0 24 24');
    check.classList.add('lobby-vtile-check');
    if (p.ready) check.classList.add('lobby-vtile-check--ready');
    const useCheck = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    useCheck.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons.svg#i-check');
    check.appendChild(useCheck);
    row.appendChild(check);

    container.appendChild(row);

    // Highlight local player's selected tile
    if (p.isLocal) {
      const tile = document.getElementById(`lobby-vtile-${p.vehicle}`);
      const grid = _getVehicleGrid();
      if (tile) {
        tile.classList.add('lobby-vehicle-tile--selected');
        if (grid) revealScrollItem(grid, tile as HTMLElement, 'x', 'auto');
      }
    }
  }
}

// ── Map grid ──────────────────────────────────────────────

export function renderMapGrid(data: LobbyData, ctx: LobbyContext): void {
  const container = document.getElementById('lobby-map-grid');
  if (!container) return;

  const myRole = ctx.getMyRole();
  const currentUid = ctx.getCurrentUid();
  const currentLobbyId = ctx.getCurrentLobbyId();
  const isHost = myRole === 'host';

  // Build votes map: MapType → player display info
  const votes = new Map<MapType, Array<{ name: string; color: string; isHost: boolean; icon?: string }>>();
  for (const map of MAPS) votes.set(map.id, []);

  if (data.host.mapVote) {
    votes.get(data.host.mapVote)?.push({
      name: data.host.username,
      color: COLOR_MAP[data.host.color] || '#0ff',
      isHost: true,
      icon: data.host.icon,
    });
  }

  for (const guest of getGuestList(data)) {
    if (guest.mapVote && guest.presence !== false) {
      votes.get(guest.mapVote)?.push({
        name: guest.username,
        color: COLOR_MAP[guest.color] || '#0ff',
        isHost: false,
        icon: guest.icon,
      });
    }
  }

  const activeMap = resolveMapWinner(data).winner || DEFAULT_MAP;

  const me = isHost ? data.host : (currentUid ? getGuestByUid(data, currentUid) : null);
  const localVote = me?.mapVote ?? null;

  renderMapCarousel({
    mode: 'lobby',
    container,
    orientation: 'landscape',
    votes,
    activeMap,
    localVote,
    onVote: (mapId: MapType) => {
      if (!currentLobbyId || !myRole) return;
      updateLobbyPlayer(currentLobbyId, myRole, { mapVote: mapId }, currentUid!).catch(e => console.warn('map vote sync failed:', e));
    },
    playTick: playConfirm,
  });

  // Host writes resolved map to settings when it changes
  if (isHost && activeMap !== data.settings.map) {
    updateLobbySettings(currentLobbyId!, { map: activeMap }).catch(e => console.warn('lobby map settings write failed:', e));
    setSelectedMap(activeMap);
  } else if (!isHost && data.settings.map) {
    // Guest: track last resolved map via local state; use ctx for comparison
    setSelectedMap(data.settings.map);
  }
}

// ── Vehicle tile listeners + drag scroll ─────────────────

export function initPlayerListeners(ctx: LobbyContext, bag: DisposableBag): void {
  // Vehicle tile click handlers
  for (const vType of LOADOUTS) {
    if (DISABLED_LOADOUTS.has(vType)) continue;
    const vtile = document.getElementById(`lobby-vtile-${vType}`);
    if (vtile) bag.addEventListener(vtile, 'click', () => {
      const currentLobbyId = ctx.getCurrentLobbyId();
      const myRole = ctx.getMyRole();
      const currentUid = ctx.getCurrentUid();
      if (!currentLobbyId || !myRole) return;
      playConfirm();
      // If editing an AI, change the AI's vehicle (host only)
      const selectedAiSlot = ctx.getSelectedAiSlot();
      if (selectedAiSlot !== null && myRole === 'host') {
        const ai = ctx.getAiSlots().get(selectedAiSlot);
        if (ai) {
          ai.vehicle = vType;
          syncAisToServer(ctx);
          const lastData = ctx.getLastLobbyData();
          if (lastData) {
            ctx.renderVehicleGrid(lastData);
            ctx.updatePartyHud(lastData);
          }
        }
        return;
      }
      localStorage.setItem('luminal-vehicle', vType);
      const tile = document.getElementById(`lobby-vtile-${vType}`);
      const grid = _getVehicleGrid();
      if (tile && grid) revealScrollItem(grid, tile as HTMLElement, 'x', 'smooth');
      notifySettingChanged();
      updateLobbyPlayer(currentLobbyId, myRole, { vehicle: vType }, currentUid!).catch(() => {});
    });
  }

  // Desktop drag-to-scroll for vehicle grid
  const dragGrid = _getVehicleGrid();
  if (dragGrid) {
    initDragScroll(dragGrid);
    initElasticScroll(dragGrid, { axis: 'x' });
  }

  // Mobile vehicle carousel snap tracking
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    const carouselGrid = _getVehicleGrid();
    if (carouselGrid) {
      let snapRaf: number | null = null;
      let lastSnapIndex = -1;

      function _updateVehicleSnap(): void {
        const gridRect = carouselGrid!.getBoundingClientRect();
        const center = gridRect.left + gridRect.width / 2;
        let closestIdx = 0;
        let closestDist = Infinity;
        LOADOUTS.forEach((v, i) => {
          const tile = document.getElementById(`lobby-vtile-${v}`);
          if (!tile) return;
          const rect = tile.getBoundingClientRect();
          const tileCx = rect.left + rect.width / 2;
          const dist = Math.abs(tileCx - center);
          if (dist < closestDist) { closestDist = dist; closestIdx = i; }
        });

        LOADOUTS.forEach((v, i) => {
          document.getElementById(`lobby-vtile-${v}`)?.classList.toggle('lobby-vehicle-tile--snap-active', i === closestIdx);
        });

        if (closestIdx !== lastSnapIndex) {
          lastSnapIndex = closestIdx;
          if (navigator.vibrate) navigator.vibrate(8);
          const vType = LOADOUTS[closestIdx];
          if (DISABLED_LOADOUTS.has(vType)) return; // view-only, don't select
          const currentLobbyId = ctx.getCurrentLobbyId();
          const myRole = ctx.getMyRole();
          const currentUid = ctx.getCurrentUid();
          if (currentLobbyId && myRole && vType) {
            playConfirm();
            localStorage.setItem('luminal-vehicle', vType);
            notifySettingChanged();
            updateLobbyPlayer(currentLobbyId, myRole, { vehicle: vType }, currentUid!).catch(() => {});
          }
        }
      }

      bag.addEventListener(carouselGrid, 'scroll', () => {
        if (snapRaf) cancelAnimationFrame(snapRaf);
        snapRaf = requestAnimationFrame(_updateVehicleSnap);
      }, { passive: true });

      // Scroll to current vehicle on open
      requestAnimationFrame(() => {
        const savedVehicle = localStorage.getItem('luminal-vehicle') as VehicleType | null;
        const initIdx = savedVehicle ? LOADOUTS.indexOf(savedVehicle as VehicleType) : 0;
        if (initIdx > 0) {
          const tile = document.getElementById(`lobby-vtile-${LOADOUTS[initIdx]}`);
          if (tile) {
            revealScrollItem(carouselGrid!, tile as HTMLElement, 'x', 'auto');
          }
        }
        _updateVehicleSnap();
      });
    }
  }
}

