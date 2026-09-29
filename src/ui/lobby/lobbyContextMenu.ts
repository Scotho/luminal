// ── Lobby context menu ──────────────────────────────────
// Right-click / long-press context menu for lobby party rows (kick, promote,
// add friend, remove slot, leave). Extracted from lobbyPartyHud.ts (TASK-247).

import type { LobbyContext } from './lobbyContext';
import type { DisposableBag } from '../../disposables';
import { LOBBY_SIZE_OPTIONS } from './lobbyContext';
import { getGuestByUid, getGuestList } from '../../types/index';
import { isFriend } from '../friendsUI';
import { kickPlayer, transferHost, updateLobbySettings } from '../../lobby';
import { sendFriendRequest } from '../../friends';
import { pushNotif } from '../notifUI';
import { playUiCtxAction } from '../../sfx';
import { removeSlot } from './lobbyAI';

export interface CtxMenuOpts {
  canKick?: boolean;
  canPromote?: boolean;
  canRemoveSpace?: boolean;
  canLeave?: boolean;
  canAddFriend?: boolean;
  playerUid?: string;
  playerUsername?: string;
  slotIndex?: number;
}

let _lobbyCtxMenu: HTMLElement | null = null;

export function initLobbyContextMenu(bag: DisposableBag): void {
  _lobbyCtxMenu = document.createElement('div');
  _lobbyCtxMenu.className = 'dropdown-panel';
  _lobbyCtxMenu.id = 'lobby-ctx-menu';
  _lobbyCtxMenu.style.position = 'fixed';
  _lobbyCtxMenu.style.zIndex = '100';
  document.body.appendChild(_lobbyCtxMenu);
  bag.addEventListener(document, 'click', closeLobbyCtxMenu);
}

export function closeLobbyCtxMenu(): void {
  if (_lobbyCtxMenu) _lobbyCtxMenu.classList.remove('dropdown-panel--open');
  // Unpin any dropdown that was held open for the context menu
  const pinned = document.querySelector('.tb-dropdown-wrap.tb-dropdown--ctx-pinned') as HTMLElement | null;
  if (pinned) pinned.classList.remove('tb-dropdown--ctx-pinned', 'tb-dropdown--open');
}

export function showLobbyContextMenu(x: number, y: number, opts: CtxMenuOpts, ctx: LobbyContext): void {
  if (!_lobbyCtxMenu) return;
  _lobbyCtxMenu.innerHTML = '';

  if (opts.canKick) {
    const kickItem = document.createElement('div');
    kickItem.className = 'dropdown-item dropdown-item--danger';
    kickItem.textContent = 'KICK';
    kickItem.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      closeLobbyCtxMenu();
      playUiCtxAction();
      const currentLobbyId = ctx.getCurrentLobbyId();
      if (!currentLobbyId || !opts.playerUid) return;
      kickPlayer(currentLobbyId, opts.playerUid).catch(e => console.warn('lobby: kick failed', e));
      // Shrink lobby size to remove the slot
      const currentSize = ctx.getLastLobbyData()?.settings.lobbySize || 2;
      const newSize = Math.max(2, currentSize - 1);
      const sizeOpt = LOBBY_SIZE_OPTIONS.find(o => o.size === newSize);
      if (sizeOpt) ctx.setLobbySizeIndex(LOBBY_SIZE_OPTIONS.indexOf(sizeOpt));
      ctx.syncSizeToQuickStart();
      updateLobbySettings(currentLobbyId, { lobbySize: newSize }).catch(() => {});
    });
    _lobbyCtxMenu.appendChild(kickItem);
  }

  if (opts.canPromote && opts.playerUid) {
    const promoteItem = document.createElement('div');
    promoteItem.className = 'dropdown-item';
    promoteItem.textContent = 'PROMOTE TO HOST';
    promoteItem.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      closeLobbyCtxMenu();
      playUiCtxAction();
      _promotePlayer(opts.playerUid, ctx);
    });
    _lobbyCtxMenu.appendChild(promoteItem);
  }

  if (opts.canRemoveSpace && opts.slotIndex !== undefined) {
    const removeItem = document.createElement('div');
    removeItem.className = 'dropdown-item dropdown-item--danger';
    removeItem.textContent = 'REMOVE SPACE';
    removeItem.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      closeLobbyCtxMenu();
      playUiCtxAction();
      removeSlot(opts.slotIndex!, ctx);
    });
    _lobbyCtxMenu.appendChild(removeItem);
  }

  if (opts.canAddFriend && opts.playerUid) {
    const alreadyFriends = isFriend(opts.playerUid);
    const addItem = document.createElement('div');
    addItem.className = 'dropdown-item';
    addItem.textContent = alreadyFriends ? 'ALREADY FRIENDS' : 'ADD FRIEND';
    if (alreadyFriends) {
      addItem.style.opacity = '0.3';
      addItem.style.pointerEvents = 'none';
    } else {
      addItem.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        closeLobbyCtxMenu();
        const currentUid = ctx.getCurrentUid();
        const currentUsername = ctx.getCurrentUsername();
        if (!currentUid || !currentUsername || !opts.playerUid || !opts.playerUsername) return;
        sendFriendRequest(currentUid, currentUsername, opts.playerUid, opts.playerUsername)
          .then(r => pushNotif({ id: `friend-${Date.now()}`, type: 'info', message: r === 'accepted' ? `You and ${opts.playerUsername} are now friends!` : `Friend request sent to ${opts.playerUsername}`, createdAt: Date.now(), silent: true }))
          .catch((err: Error) => pushNotif({ id: `friend-err-${Date.now()}`, type: 'info', message: err.message, createdAt: Date.now() }));
      });
    }
    _lobbyCtxMenu.appendChild(addItem);
  }

  if (opts.canLeave) {
    const leaveItem = document.createElement('div');
    leaveItem.className = 'dropdown-item dropdown-item--danger';
    leaveItem.textContent = 'LEAVE PARTY';
    leaveItem.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      closeLobbyCtxMenu();
      ctx.leaveLobby();
      ctx.navigateReset('main');
    });
    _lobbyCtxMenu.appendChild(leaveItem);
  }

  if (_lobbyCtxMenu.children.length === 0) return;

  // Pin the parent dropdown open while context menu is visible
  const parentDrop = document.querySelector('.tb-dropdown-wrap.tb-dropdown--open') as HTMLElement | null;
  if (parentDrop) parentDrop.classList.add('tb-dropdown--ctx-pinned');

  _lobbyCtxMenu.classList.add('dropdown-panel--open');
  _lobbyCtxMenu.style.left = `${x}px`;
  _lobbyCtxMenu.style.top = `${y}px`;
  requestAnimationFrame(() => {
    if (!_lobbyCtxMenu) return;
    const rect = _lobbyCtxMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) _lobbyCtxMenu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) _lobbyCtxMenu.style.top = `${window.innerHeight - rect.height - 8}px`;
  });
}

// ── Promote guest to host ────────────────────────────────

function _promotePlayer(guestUid: string | undefined, ctx: LobbyContext): void {
  const currentLobbyId = ctx.getCurrentLobbyId();
  const lastData = ctx.getLastLobbyData();
  if (!currentLobbyId || ctx.getMyRole() !== 'host' || !lastData) return;
  const guest = guestUid ? getGuestByUid(lastData, guestUid) : getGuestList(lastData)[0];
  if (!guest) return;
  const host = lastData.host;
  transferHost(currentLobbyId, guest, host).catch(e => console.warn('lobby: transferHost failed', e));
}
