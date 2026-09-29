// ── Lobby Party HUD ─────────────────────────────────────
// Party HUD aggregator, offline countdown timers, mobile bottom sheet, and
// init of all lobby action-bar / social-tab listeners.
//
// Row DOM templates live in `lobbyPartyRow.ts`.
// Context menu system lives in `lobbyContextMenu.ts`.

import type { LobbyContext } from './lobbyContext';
import type { DisposableBag } from '../../disposables';
import type { LobbyData, VehicleType } from '../../types/index';
import { LOBBY_SIZE_OPTIONS } from './lobbyContext';
import { getGuestByUid, getGuestList, getHumanCount } from '../../types/index';
import { confirmButton, escapeHtml, toggleVisible } from '../dom';
import { updateSocialPartyState, renderSocialPartyMembers, updateSocialPartyBadge } from '../socialUI';
import { getFriendsForInvite, handleSmartInvitePublic } from '../friendsUI';
import { kickPlayer, updateLobbySettings, getLobbyUrl, startLobbyMatch as startLobbyMatchFB } from '../../lobby';
import { playUiTab } from '../../sfx';
import { addAiToSlot, expandAndAddAi, removeSlot } from './lobbyAI';
import { reparentChatToLobby } from './lobbyChat';
import { renderPartyMembers, renderPartyAiAndSlots } from './lobbyPartyRow';

// Re-exports to preserve the public API surface that lobbyUI.ts imports.
export type { MemberRowOpts } from './lobbyPartyRow';
export { createMemberRow, renderPartyMembers, renderPartyAiAndSlots, createOpenSlotRow } from './lobbyPartyRow';
export { initLobbyContextMenu, closeLobbyCtxMenu, showLobbyContextMenu } from './lobbyContextMenu';
export type { CtxMenuOpts } from './lobbyContextMenu';
export { updatePartyChip, renderPartySheet } from './lobbyPartySheet';

// ── Offline countdown state ─────────────────────────────
const OFFLINE_KICK_TIMEOUT = 30_000; // 30 seconds
const _offlineTimers: Map<string, { startedAt: number; interval: ReturnType<typeof setInterval> }> = new Map();

function _startOfflineCountdown(uid: string, role: 'host' | 'guest', ctx: LobbyContext): void {
  // Only start once — don't restart while already running
  if (_offlineTimers.has(uid)) return;
  const startedAt = Date.now();
  const interval = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= OFFLINE_KICK_TIMEOUT) {
      _stopOfflineCountdown(uid);
      // Auto-kick expired player and shrink lobby
      const currentLobbyId = ctx.getCurrentLobbyId();
      if (role === 'guest' && ctx.getMyRole() === 'host' && currentLobbyId) {
        kickPlayer(currentLobbyId, uid).catch(e => console.warn('lobby: auto-kick failed', e));
        const currentSize = ctx.getLastLobbyData()?.settings.lobbySize || 2;
        const newSize = Math.max(2, currentSize - 1);
        const sizeOpt = LOBBY_SIZE_OPTIONS.find(o => o.size === newSize);
        if (sizeOpt) ctx.setLobbySizeIndex(LOBBY_SIZE_OPTIONS.indexOf(sizeOpt));
        ctx.syncSizeToQuickStart();
        updateLobbySettings(currentLobbyId, { lobbySize: newSize }).catch(() => {});
      }
    }
    // Re-render party HUD to update countdown display
    const lastData = ctx.getLastLobbyData();
    if (lastData) updatePartyHud(lastData, ctx);
  }, 1000);
  _offlineTimers.set(uid, { startedAt, interval });
}

function _stopOfflineCountdown(uid: string): void {
  const timer = _offlineTimers.get(uid);
  if (timer) { clearInterval(timer.interval); _offlineTimers.delete(uid); }
}

function _getOfflineRemaining(uid: string): number | null {
  const timer = _offlineTimers.get(uid);
  if (!timer) return null;
  const remaining = Math.max(0, OFFLINE_KICK_TIMEOUT - (Date.now() - timer.startedAt));
  return Math.ceil(remaining / 1000);
}

// ── Party toggle visibility ─────────────────────────────

/** Show/hide party dropdown based on login + lobby state. */
export function setPartyToggleVisible(inParty: boolean, ctx: LobbyContext): void {
  const wrap = document.getElementById('social-dropdown-wrap');
  const shouldShow = !!ctx.getCurrentUid();
  if (wrap) {
    toggleVisible(wrap, shouldShow);
    if (!shouldShow) wrap.classList.remove('tb-dropdown--pinned', 'tb-dropdown--open', 'tb-dropdown--ctx-pinned');
  }
  // Update badges on top bar icon and lobby button
  const lastData = ctx.getLastLobbyData();
  const count = inParty && lastData ? getHumanCount(lastData) : 0;
  updateSocialPartyBadge(count);
  _updateLobbyBadge(Math.max(0, count - 1));
}

/** Update the badge on the main menu LOBBY button. */
function _updateLobbyBadge(otherPlayers: number): void {
  const badge = document.getElementById('lobby-badge');
  if (!badge) return;
  badge.textContent = String(otherPlayers);
  toggleVisible(badge, otherPlayers > 0);
}

// ── Party HUD aggregator ────────────────────────────────

/** Main party HUD update — tracks offline timers, renders member lists, syncs social panel. */
export function updatePartyHud(data: LobbyData | null, ctx: LobbyContext): void {
  if (!data) {
    setPartyToggleVisible(false, ctx);
    for (const [uid] of _offlineTimers) _stopOfflineCountdown(uid);
    updateSocialPartyState(null, null);
    renderSocialPartyMembers('');
    _updateLobbyBadge(0);
    return;
  }

  setPartyToggleVisible(true, ctx);

  // Track offline state for countdown
  const hostOffline = data.host.presence === false;
  if (hostOffline) _startOfflineCountdown(data.host.uid, 'host', ctx);
  else _stopOfflineCountdown(data.host.uid);

  for (const guest of getGuestList(data)) {
    if (guest.presence === false) _startOfflineCountdown(guest.uid, 'guest', ctx);
    else _stopOfflineCountdown(guest.uid);
  }

  // Compact AI slots before rendering
  const aiSlots = ctx.getAiSlots();
  const aiStart = getHumanCount(data);
  {
    const sorted = [...aiSlots.entries()].sort((a, b) => a[0] - b[0]);
    const compacted = new Map<number, { name: string; color: string; vehicle: VehicleType }>();
    let idx = aiStart;
    for (const [, ai] of sorted) {
      compacted.set(idx++, ai);
    }
    ctx.setAiSlots(compacted);
  }

  // Render into a temporary container for social panel mirroring
  const tmp = document.createElement('div');
  renderPartyMembers(tmp, data, ctx, _getOfflineRemaining);
  renderPartyAiAndSlots(tmp, data, ctx);

  const lobbySize = data.settings.lobbySize || 2;
  renderSocialPartyMembers(tmp.innerHTML);
  _rewireSocialPartyListeners(lobbySize, ctx);
  updateSocialPartyState(ctx.getCurrentLobbyId(), data);
  updateSocialPartyBadge(getHumanCount(data));
  _updateLobbyBadge(getHumanCount(data) - 1);
}

function _rewireSocialPartyListeners(lobbySize: number, ctx: LobbyContext): void {
  // Re-wire listeners for every social clone (dropdown + overlay) since
  // renderSocialPartyMembers() populates both.
  const containers = document.querySelectorAll<HTMLElement>('[data-social-slot="party-members"]');
  for (const cont of containers) {
    const addSlotEl = cont.querySelector('[data-action="add-slot"]');
    if (addSlotEl) {
      const ls = parseInt((addSlotEl as HTMLElement).dataset.lobbySize || String(lobbySize));
      addSlotEl.addEventListener('click', () => expandAndAddAi(ls, ctx));
    }

    cont.querySelectorAll('[data-action="add-ai"]').forEach(el => {
      const slot = parseInt((el as HTMLElement).dataset.slot!);
      el.addEventListener('click', (e) => { e.stopPropagation(); addAiToSlot(slot, ctx); });
    });

    cont.querySelectorAll('[data-action="kick-ai"]').forEach(el => {
      const slot = parseInt((el as HTMLElement).dataset.slot!);
      el.addEventListener('click', (e) => { e.stopPropagation(); removeSlot(slot, ctx); });
    });

    cont.querySelectorAll('[data-action="kick-human"]').forEach(el => {
      const uid = (el as HTMLElement).dataset.uid!;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentLobbyId = ctx.getCurrentLobbyId();
        if (!currentLobbyId || !uid) return;
        kickPlayer(currentLobbyId, uid).catch(e => console.warn('lobby: kick failed', e));
        const currentSize = ctx.getLastLobbyData()?.settings.lobbySize || 2;
        const newSize = Math.max(2, currentSize - 1);
        const sizeOpt = LOBBY_SIZE_OPTIONS.find(o => o.size === newSize);
        if (sizeOpt) ctx.setLobbySizeIndex(LOBBY_SIZE_OPTIONS.indexOf(sizeOpt));
        ctx.syncSizeToQuickStart();
        updateLobbySettings(currentLobbyId, { lobbySize: newSize }).catch(() => {});
      });
    });
  }
}

// ── Party tab renderers ─────────────────────────────────

/** Render simplified friends list for lobby invite mode */
export function renderLobbyFriends(): void {
  const panel = document.getElementById('lobby-panel-friends');
  if (!panel) return;

  const friends = getFriendsForInvite();
  if (friends.length === 0) {
    panel.innerHTML = '<div style="padding:16px;text-align:center;font-size:10px;letter-spacing:3px;color:rgba(var(--c-hot-light),0.3);">NO FRIENDS YET</div>';
    return;
  }

  panel.innerHTML = friends.map(f => {
    const dotStyle = f.online
      ? 'background:rgb(var(--c-green));box-shadow:0 0 4px rgb(var(--c-green))'
      : 'background:rgba(var(--c-white),0.15)';
    const offlineClass = f.online ? '' : ' lobby-friend--offline';
    const interactiveClass = f.online ? ' party-member--interactive' : '';
    const action = f.online
      ? `<span class="lobby-friend-invite" data-uid="${escapeHtml(f.uid)}">INVITE</span>`
      : '';
    return `<div class="party-member${interactiveClass}${offlineClass}" data-friend-uid="${escapeHtml(f.uid)}">
      <div class="party-member-dot" style="${dotStyle}"></div>
      <span class="party-member-name">${escapeHtml(f.username)}</span>
      ${action}
    </div>`;
  }).join('');
}

/** Render full party list into lobby social tab (humans + AI + open slots) */
export function renderLobbyParty(data: LobbyData, ctx: LobbyContext): void {
  const panel = document.getElementById('lobby-panel-party');
  if (!panel) return;
  panel.innerHTML = '';

  // Human players (host + guests)
  renderPartyMembers(panel, data, ctx, _getOfflineRemaining);

  // AI slots + open slots + expand button (shared renderer)
  renderPartyAiAndSlots(panel, data, ctx);
}

// ── Init party HUD event listeners ─────────────────────

/** Wire all party HUD + lobby action button event listeners. Called from initLobbyUI(). */
export function initPartyHudListeners(ctx: LobbyContext, bag: DisposableBag): void {
  const wire = (id: string, handler: EventListener): void => {
    const el = document.getElementById(id);
    if (el) bag.addEventListener(el, 'click', handler);
  };

  _wireLobbySocialTabs(bag);
  _wireLobbyFriendInvites(ctx, wire);
  _wireMobilePartySheet(ctx, bag, wire);
  _wireLobbyInviteCopy(ctx, wire);
  _wireLobbyActionBar(ctx, wire);
}

/** Lobby social tab switching (PARTY / FRIENDS / CHAT). */
function _wireLobbySocialTabs(bag: DisposableBag): void {
  for (const tab of document.querySelectorAll('.lobby-social-tab')) {
    bag.addEventListener(tab as HTMLElement, 'click', () => {
      const target = (tab as HTMLElement).dataset.tab;
      if (!target) return;
      playUiTab();
      for (const t of document.querySelectorAll('.lobby-social-tab')) {
        const isActive = (t as HTMLElement).dataset.tab === target;
        t.classList.toggle('lobby-social-tab--active', isActive);
        t.setAttribute('aria-selected', String(isActive));
      }
      const partyPanel = document.getElementById('lobby-panel-party');
      const friendsPanel = document.getElementById('lobby-panel-friends');
      const chatPanel = document.getElementById('lobby-panel-chat');
      if (partyPanel) toggleVisible(partyPanel, target === 'party');
      if (friendsPanel) toggleVisible(friendsPanel, target === 'friends');
      if (chatPanel) toggleVisible(chatPanel, target === 'chat');
      if (target === 'friends') renderLobbyFriends();
      if (target === 'chat') {
        const lobbyChat = document.getElementById('lobby-panel-chat');
        if (lobbyChat && !lobbyChat.querySelector('#chat-tab-bar')) {
          reparentChatToLobby(lobbyChat);
        }
      }
    });
  }
}

/** Invite friend from lobby friends tab (delegated). */
function _wireLobbyFriendInvites(ctx: LobbyContext, wire: (id: string, handler: EventListener) => void): void {
  wire('lobby-panel-friends', (e) => {
    const inviteBtn = (e.target as HTMLElement).closest('.lobby-friend-invite') as HTMLElement | null;
    if (!inviteBtn) return;
    const uid = inviteBtn.dataset.uid;
    const currentLobbyId = ctx.getCurrentLobbyId();
    if (!uid || !currentLobbyId) return;

    handleSmartInvitePublic(uid).catch(() => {});

    inviteBtn.textContent = 'SENT!';
    inviteBtn.style.pointerEvents = 'none';
    setTimeout(() => {
      inviteBtn.textContent = 'INVITE';
      inviteBtn.style.pointerEvents = '';
    }, 3000);
  });
}

/** Mobile party chip + bottom sheet open/close/copy handlers. */
function _wireMobilePartySheet(ctx: LobbyContext, bag: DisposableBag, wire: (id: string, handler: EventListener) => void): void {
  // Party chip opens bottom sheet
  wire('lobby-party-chip', () => {
    const sheet = document.getElementById('lobby-party-sheet');
    if (!sheet) return;
    sheet.classList.toggle('lobby-party-sheet--open');
  });

  // Close party sheet on backdrop tap
  wire('lobby-party-sheet-backdrop', () => {
    document.getElementById('lobby-party-sheet')?.classList.remove('lobby-party-sheet--open');
  });

  // Copy invite from party sheet (delegated because the element is dynamically rendered)
  bag.addEventListener(document, 'click', (e) => {
    const target = e.target as HTMLElement;
    if (target.id !== 'lobby-party-sheet-copy') return;
    const currentLobbyId = ctx.getCurrentLobbyId();
    if (!currentLobbyId) return;
    const url = getLobbyUrl(currentLobbyId);
    navigator.clipboard.writeText(url).then(() => {
      const invite = document.getElementById('lobby-party-sheet-invite');
      if (!invite) return;
      invite.classList.add('lobby-party-sheet-invite--copied');
      target.textContent = 'COPIED!';
      setTimeout(() => {
        invite.classList.remove('lobby-party-sheet-invite--copied');
        target.textContent = 'COPY';
      }, 2000);
    }).catch(() => {});
  });
}

/** Lobby invite copy buttons (action bar + settings column). */
function _wireLobbyInviteCopy(ctx: LobbyContext, wire: (id: string, handler: EventListener) => void): void {
  // Invite button in action bar — copies lobby URL
  wire('btn-lobby-invite', () => {
    const currentLobbyId = ctx.getCurrentLobbyId();
    if (!currentLobbyId) return;
    const url = getLobbyUrl(currentLobbyId);
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('btn-lobby-invite')!;
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg class="icon" style="width:13px;height:13px;margin-right:3px"><use href="/icons.svg#i-check"/></svg>COPIED';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }).catch(e => console.warn('clipboard:', e));
  });

  // Copy invite from settings column
  wire('lobby-settings-invite-copy', () => {
    const currentLobbyId = ctx.getCurrentLobbyId();
    if (!currentLobbyId) return;
    const url = getLobbyUrl(currentLobbyId);
    navigator.clipboard.writeText(url).then(() => {
      const row = document.getElementById('lobby-settings-invite');
      const copy = document.getElementById('lobby-settings-invite-copy');
      if (!row || !copy) return;
      row.classList.add('lobby-settings-invite--copied');
      copy.textContent = 'COPIED!';
      setTimeout(() => {
        row.classList.remove('lobby-settings-invite--copied');
        copy.textContent = 'COPY';
      }, 2000);
    }).catch(e => console.warn('clipboard:', e));
  });
}

/** Action bar buttons (create, ready, start, leave, back). */
function _wireLobbyActionBar(ctx: LobbyContext, wire: (id: string, handler: EventListener) => void): void {
  // Create Lobby button (main menu)
  wire('btn-create-lobby', () => {
    ctx.openLobbyAsHost?.();
  });

  // Ready button — disabled until a vehicle is selected and opponents exist
  wire('btn-lobby-ready', () => {
    const btn = document.getElementById('btn-lobby-ready') as HTMLButtonElement | null;
    if (btn?.dataset.disabled) return;
    const lastData = ctx.getLastLobbyData();
    const myRole = ctx.getMyRole();
    const currentUid = ctx.getCurrentUid();
    if (lastData && myRole) {
      const me = myRole === 'host' ? lastData.host : (currentUid ? getGuestByUid(lastData, currentUid) : null);
      if (!me?.vehicle) return;
    }
    ctx.ensureAudio();
    ctx.toggleReady?.();
  });

  // Start button (host)
  wire('btn-lobby-start', async () => {
    const currentLobbyId = ctx.getCurrentLobbyId();
    if (!currentLobbyId || ctx.getMyRole() !== 'host') return;
    if (document.getElementById('btn-lobby-start')?.dataset.disabled) return;
    ctx.ensureAudio();
    await startLobbyMatchFB(currentLobbyId);
  });

  // Leave button (double-confirm)
  const lobbyLeaveBtn = document.getElementById('btn-lobby-leave');
  if (lobbyLeaveBtn) confirmButton(lobbyLeaveBtn, () => { ctx.leaveLobby(); ctx.navigateReset('main'); });

  // Back button — navigates back without leaving the party
  wire('btn-lobby-back', () => {
    document.getElementById('dyn-back')?.click();
  });

  // Leave button — guest in join-lobby-overlay (double-confirm)
  const joinLobbyLeaveBtn = document.getElementById('btn-join-lobby-leave');
  if (joinLobbyLeaveBtn) confirmButton(joinLobbyLeaveBtn, () => { ctx.leaveLobby(); ctx.navigateReset('main'); });
}
