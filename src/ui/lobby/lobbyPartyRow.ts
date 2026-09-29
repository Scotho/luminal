// ── Lobby party row builders ────────────────────────────
// DOM templates for party member rows (humans, AI, open slots).
// Extracted from lobbyPartyHud.ts (TASK-247).

import type { LobbyContext } from './lobbyContext';
import type { LobbyData, VehicleType } from '../../types/index';
import { COLOR_MAP, ICON_TOOLTIPS, MAX_LOBBY_SIZE } from './lobbyContext';
import { getGuestList, getHumanCount } from '../../types/index';
import { onLongPress } from '../dom';
import { addAiToSlot, expandAndAddAi, removeSlot, selectAiSlot, toggleAiInlineEdit } from './lobbyAI';
import { botIcon, setBotName } from './lobbyPlayers';
import { showLobbyContextMenu } from './lobbyContextMenu';

export interface MemberRowOpts {
  isSelf?: boolean;
  isHost?: boolean;
  isAi?: boolean;
  empty?: boolean;
  canKick?: boolean;
  canPromote?: boolean;
  kickUid?: string;
  kickUsername?: string;
  vehicle?: VehicleType | null;
  offline?: boolean;
  offlineCountdown?: number | null;
}

export function createMemberRow(
  name: string,
  colorKey: string,
  ready: boolean,
  icon: string | undefined,
  opts: MemberRowOpts,
  ctx: LobbyContext,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'party-member';
  if (opts.isAi) row.classList.add('party-member--ai');

  // Make interactive if self (leave) or kickable
  const interactive = opts.isSelf || opts.canKick;
  if (interactive) row.classList.add('party-member--interactive');

  const dot = document.createElement('div');
  dot.className = 'party-member-dot';
  if (colorKey && COLOR_MAP[colorKey]) {
    dot.style.background = COLOR_MAP[colorKey];
    dot.style.boxShadow = `0 0 4px ${COLOR_MAP[colorKey]}`;
  } else {
    dot.style.background = 'rgba(var(--c-white), 0.15)';
  }

  // Icon (e.g. star for early adopter)
  let iconEl: SVGSVGElement | null = null;
  if (icon) {
    iconEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    iconEl.setAttribute('viewBox', '0 0 24 24');
    iconEl.classList.add('party-member-icon', `party-icon-${icon}`);
    const tip = ICON_TOOLTIPS[icon] || '';
    if (tip) iconEl.setAttribute('data-tip', tip);
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#i-${icon}`);
    iconEl.appendChild(use);
  }

  const nameEl = document.createElement('span');
  nameEl.className = 'party-member-name';
  if (opts.isAi) { setBotName(nameEl, name); } else { nameEl.textContent = name; }
  if (opts.empty) nameEl.style.opacity = '0.3';
  const onProfileClick = ctx.getOnProfileClick();
  if (!opts.isAi && !opts.isSelf && !opts.empty && opts.kickUid && onProfileClick) {
    nameEl.style.cursor = 'pointer';
    nameEl.addEventListener('click', (e) => {
      e.stopPropagation();
      onProfileClick(opts.kickUid!);
    });
  }

  // Host badge
  let hostBadge: HTMLElement | null = null;
  if (opts.isHost) {
    hostBadge = document.createElement('span');
    hostBadge.className = 'party-member-host';
    hostBadge.textContent = 'HOST';
  }
  if (opts.offline) {
    nameEl.style.opacity = '0.35';
    nameEl.style.color = 'rgba(var(--c-red-bright), 0.7)';
  }

  // Offline countdown
  let countdownEl: HTMLElement | null = null;
  if (opts.offline && opts.offlineCountdown != null) {
    countdownEl = document.createElement('span');
    countdownEl.className = 'party-member-offline';
    countdownEl.textContent = `OFFLINE 0:${opts.offlineCountdown.toString().padStart(2, '0')}`;
    countdownEl.style.fontSize = '7px';
    countdownEl.style.letterSpacing = '1.5px';
    countdownEl.style.color = 'rgba(var(--c-red), 0.8)';
    countdownEl.style.fontFamily = "'Orbitron',sans-serif";
    countdownEl.style.marginLeft = '4px';
  }

  const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  check.setAttribute('viewBox', '0 0 24 24');
  check.classList.add('party-member-check');
  if (ready) check.classList.add('party-member-check--ready');
  const useCheck = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  useCheck.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons.svg#i-check');
  check.appendChild(useCheck);

  // Connection status dot: green = online, red = offline
  if (opts.offline) {
    dot.style.background = 'rgb(var(--c-red))';
    dot.style.boxShadow = '0 0 4px rgba(var(--c-red), 0.6)';
  }

  row.appendChild(dot);
  if (iconEl) row.appendChild(iconEl);
  row.appendChild(nameEl);
  if (hostBadge) row.appendChild(hostBadge);
  if (countdownEl) row.appendChild(countdownEl);

  // Action hint (kick, promote, or leave)
  if (opts.canKick) {
    const action = document.createElement('span');
    action.className = 'party-member-action party-member-action--kick';
    action.textContent = 'KICK';
    action.dataset.action = 'kick-human';
    if (opts.kickUid) action.dataset.uid = opts.kickUid;
    row.appendChild(action);
    row.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      if (!ctx.getCurrentLobbyId()) return;
      showLobbyContextMenu(e.clientX, e.clientY, {
        canKick: true,
        canPromote: !!opts.canPromote,
        canAddFriend: true,
        playerUid: opts.kickUid,
        playerUsername: opts.kickUsername,
      }, ctx);
    });
    onLongPress(row, (x, y) => {
      if (!ctx.getCurrentLobbyId()) return;
      showLobbyContextMenu(x, y, {
        canKick: true,
        canPromote: !!opts.canPromote,
        canAddFriend: true,
        playerUid: opts.kickUid,
        playerUsername: opts.kickUsername,
      }, ctx);
    });
  } else if (opts.isSelf) {
    const action = document.createElement('span');
    action.className = 'party-member-action party-member-action--leave';
    action.textContent = 'LEAVE';
    action.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      ctx.leaveLobby();
      ctx.navigateReset('main');
    });
    row.appendChild(action);
    // Click self row on lobby screen → deselect AI, sync color picker back to own color
    row.addEventListener('click', () => {
      const onLobby = document.getElementById('lobby-overlay')?.classList.contains('hidden') === false;
      if (onLobby && ctx.getSelectedAiSlot() !== null) selectAiSlot(null, ctx);
    });
  } else if (!opts.isAi && !opts.empty && !opts.isSelf && opts.kickUid) {
    // Non-self, non-AI: context menu to add friend (right-click + long-press)
    row.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      showLobbyContextMenu(e.clientX, e.clientY, {
        canAddFriend: true,
        playerUid: opts.kickUid,
        playerUsername: opts.kickUsername,
      }, ctx);
    });
    onLongPress(row, (x, y) => {
      showLobbyContextMenu(x, y, {
        canAddFriend: true,
        playerUid: opts.kickUid,
        playerUsername: opts.kickUsername,
      }, ctx);
    });
  }

  row.appendChild(check);
  return row;
}

/** Render human player member rows into a container. Shared by both Party HUD and dropdown. */
export function renderPartyMembers(
  container: HTMLElement,
  data: LobbyData,
  ctx: LobbyContext,
  getOfflineRemaining: (uid: string) => number | null,
): void {
  const isHost = ctx.getMyRole() === 'host';
  const currentUid = ctx.getCurrentUid();
  const hostIsSelf = data.host.uid === currentUid;
  const hostCountdown = getOfflineRemaining(data.host.uid);
  const hostOffline = data.host.presence === false;
  container.appendChild(createMemberRow(
    data.host.username, data.host.color, !!data.host.ready, data.host.icon,
    { isSelf: hostIsSelf, isHost: true, isAi: false, kickUid: data.host.uid, kickUsername: data.host.username,
      offline: hostOffline, offlineCountdown: hostCountdown },
    ctx,
  ));

  for (const guest of getGuestList(data)) {
    const guestIsSelf = guest.uid === currentUid;
    const guestCountdown = getOfflineRemaining(guest.uid);
    container.appendChild(createMemberRow(
      guest.username, guest.color, !!guest.ready, guest.icon,
      { isSelf: guestIsSelf, canKick: isHost && !guestIsSelf, canPromote: isHost && !guestIsSelf, kickUid: guest.uid, kickUsername: guest.username,
        offline: guest.presence === false, offlineCountdown: guestCountdown },
      ctx,
    ));
  }
}

/** Render AI slots, open slots, and expand button into any container. Shared by HUD, dropdown, and lobby tab. */
export function renderPartyAiAndSlots(container: HTMLElement, data: LobbyData, ctx: LobbyContext): void {
  const isHost = ctx.getMyRole() === 'host';
  const lobbySize = data.settings.lobbySize || 2;
  const aiStart = getHumanCount(data);
  const aiSlots = ctx.getAiSlots();
  const selectedAiSlot = ctx.getSelectedAiSlot();

  for (let i = aiStart; i < lobbySize; i++) {
    const ai = aiSlots.get(i);
    if (ai) {
      const row = document.createElement('div');
      row.className = 'party-member party-member--ai party-member--interactive';
      if (selectedAiSlot === i) row.classList.add('party-member--editing');

      const dot = document.createElement('div');
      dot.className = 'party-member-dot';
      const css = COLOR_MAP[ai.color] || '#0ff';
      dot.style.background = css;
      dot.style.boxShadow = `0 0 4px ${css}`;
      row.appendChild(dot);

      row.appendChild(botIcon());

      const nameEl = document.createElement('span');
      nameEl.className = 'party-member-name';
      setBotName(nameEl, ai.name);
      row.appendChild(nameEl);

      // AI is always ready — add checkmark
      const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      check.setAttribute('viewBox', '0 0 24 24');
      check.classList.add('party-member-check', 'party-member-check--ready');
      const useCheck = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      useCheck.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/icons.svg#i-check');
      check.appendChild(useCheck);
      row.appendChild(check);

      if (isHost) {
        const action = document.createElement('span');
        action.className = 'party-member-action party-member-action--kick';
        action.textContent = 'KICK';
        action.dataset.action = 'kick-ai';
        action.dataset.slot = String(i);
        row.appendChild(action);
        const slotIdx = i;
        action.addEventListener('click', (e) => { e.stopPropagation(); removeSlot(slotIdx, ctx); });
        // On lobby screen: click selects AI for color/vehicle editing; elsewhere: inline edit
        row.addEventListener('click', () => {
          const onLobby = document.getElementById('lobby-overlay')?.classList.contains('hidden') === false;
          if (onLobby) {
            selectAiSlot(slotIdx, ctx);
          } else {
            toggleAiInlineEdit(container, slotIdx, ai, ctx);
          }
        });
      }

      container.appendChild(row);
    } else {
      container.appendChild(createOpenSlotRow(i, isHost, ctx));
    }
  }

  // Host-only: expand slot button at very bottom
  if (isHost && lobbySize < MAX_LOBBY_SIZE) {
    const expandRow = document.createElement('div');
    expandRow.className = 'party-member';
    expandRow.style.cursor = 'pointer';
    expandRow.dataset.action = 'add-slot';
    expandRow.dataset.lobbySize = String(lobbySize);
    const expandLabel = document.createElement('span');
    expandLabel.className = 'party-member-name';
    expandLabel.textContent = '+ ADD SLOT';
    expandLabel.style.color = 'rgba(var(--c-teal), 0.7)';
    expandRow.appendChild(expandLabel);
    expandRow.addEventListener('click', () => expandAndAddAi(lobbySize, ctx));
    container.appendChild(expandRow);
  }
}

export function createOpenSlotRow(slotIndex: number, isHost: boolean, ctx: LobbyContext): HTMLElement {
  const emptyRow = document.createElement('div');
  emptyRow.className = 'party-member party-member--open-slot';
  emptyRow.style.opacity = '0.3';
  const emptyName = document.createElement('span');
  emptyName.className = 'party-member-name';
  emptyName.textContent = 'OPEN SLOT';
  emptyRow.appendChild(emptyName);
  if (isHost) {
    const addBtn = document.createElement('span');
    addBtn.className = 'party-member-action party-member-action--add-ai';
    addBtn.textContent = 'ADD AI';
    addBtn.dataset.testid = 'lobby-ai-add-btn';
    addBtn.dataset.action = 'add-ai';
    addBtn.dataset.slot = String(slotIndex);
    addBtn.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); addAiToSlot(slotIndex, ctx); });
    emptyRow.appendChild(addBtn);
  }
  return emptyRow;
}
