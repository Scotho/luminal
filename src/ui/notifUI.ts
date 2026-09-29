// ── Notification UI ──────────────────────────────────────
// Two categories:
//   LOCAL  (type='info')           — toast-only, never stored in dropdown/badge
//   SERVER (friend-request, lobby-invite) — toast + dropdown list + badge count

import { acceptFriendRequest, denyFriendRequest } from '../friends';
import { listenLobbyInvites, stopListeningInvites, clearLobbyInvite } from '../lobby';
import { playNotif, playLobbyJoin } from '../sfx';
import { updateSocialNotifBadge } from './socialUI';
import type { LobbyInviteData } from '../lobby';
import { escapeHtml, show, hide, updateBadge } from './dom';
import type { AppNotif } from '../types/index';
import { net } from '../netLog';

// ── Dependencies ────────────────────────────────────────
interface NotifUIDeps {
  getCurrentLobbyId: () => string | null;
  joinLobbyById: (lobbyId: string) => void;
  joinMatchAsSpectator: (lobbyId: string) => void;
  showServerActivity: (msg: string) => void;
  hideServerActivity: () => void;
}

let _getCurrentLobbyId: () => string | null = () => null;
let _joinLobbyById: ((lobbyId: string) => void) | null = null;
let _joinMatchAsSpectator: ((lobbyId: string) => void) | null = null;
let _showServerActivity: (msg: string) => void = () => {};
let _hideServerActivity: () => void = () => {};

// ── State ───────────────────────────────────────────────
let _currentUid: string | null = null;
let _currentUsername: string | null = null;

const _notifications: AppNotif[] = [];
const _toastTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_VISIBLE_TOASTS = 4;
const TOAST_DURATION = 10_000;
const LOBBY_INVITE_STALE_MS = 30 * 60 * 1000; // 30 minutes
const SWIPE_THRESHOLD = 60; // px to trigger fling dismiss
const SWIPE_VELOCITY_THRESHOLD = 0.3; // px/ms — fast flick overrides distance

let _knownInviteKeys = new Set<string>();

// ── Public API ──────────────────────────────────────────

export function initNotifUI(deps: NotifUIDeps): void {
  _getCurrentLobbyId = deps.getCurrentLobbyId;
  _joinLobbyById = deps.joinLobbyById;
  _joinMatchAsSpectator = deps.joinMatchAsSpectator;
  _showServerActivity = deps.showServerActivity;
  _hideServerActivity = deps.hideServerActivity;

  // Bell click toggles dropdown pinned state
  document.getElementById('notif-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const wrap = document.getElementById('notif-wrap');
    if (wrap) wrap.classList.toggle('pinned');
  });

  // Click outside to unpin
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('notif-wrap');
    if (wrap && !wrap.contains(e.target as Node)) {
      wrap.classList.remove('pinned');
    }
  });

  // Stale lobby invite cleanup every 60s (fire-and-forget — no teardown)
  setInterval(_cleanupStaleInvites, 60_000);

  // Ensure badge starts hidden (no notifications on init)
  _updateBadge();
}

export function pushNotif(notif: AppNotif): void {
  const isLocal = notif.type === 'info';

  if (isLocal) {
    // Local notifications: toast only, no dropdown/badge
    _renderToast(notif);
    playNotif();
    return;
  }

  // Server notifications: toast + dropdown + badge
  if (_notifications.some(n => n.id === notif.id)) return;
  _notifications.push(notif);
  _renderToast(notif);
  _renderDropdown();
  _renderSocialNotifs();
  _updateBadge();
  playNotif();
}

export function removeNotif(id: string): void {
  const idx = _notifications.findIndex(n => n.id === id);
  if (idx !== -1) _notifications.splice(idx, 1);

  // Remove toast
  _dismissToast(id);

  _renderDropdown();
  _renderSocialNotifs();
  _updateBadge();
}

export function startInviteListener(uid: string): void {
  _knownInviteKeys = new Set();
  listenLobbyInvites(uid, (invites: LobbyInviteData[]) => {
    for (const inv of invites) {
      const key = `lobby-inv-${inv.fromUid}`;
      if (_knownInviteKeys.has(key)) continue;
      _knownInviteKeys.add(key);
      // Skip stale invites
      if (Date.now() - inv.ts > LOBBY_INVITE_STALE_MS) {
        clearLobbyInvite(uid, inv.fromUid).catch(() => {});
        continue;
      }
      pushNotif({
        id: key,
        type: 'lobby-invite',
        message: `${inv.fromUsername} invited you to a lobby`,
        createdAt: inv.ts,
        fromUid: inv.fromUid,
        fromUsername: inv.fromUsername,
        lobbyId: inv.lobbyId,
      });
    }
  });
}

export function stopInviteListener(): void {
  stopListeningInvites();
  _knownInviteKeys.clear();
}

export function updateCurrentUser(uid: string | null, username: string | null, _isReal?: boolean): void {
  _currentUid = uid;
  _currentUsername = username;
}

// ── Toast rendering ─────────────────────────────────────

function _renderToast(notif: AppNotif): void {
  const container = document.getElementById('notif-toast-container');
  if (!container) return;

  // Limit visible toasts
  if (container.children.length >= MAX_VISIBLE_TOASTS) return;

  const toast = document.createElement('div');
  toast.className = 'notif-toast';
  toast.dataset.notifId = notif.id;

  // Countdown spinner (top-right) — must use SVG namespace
  const NS = 'http://www.w3.org/2000/svg';
  const spinner = document.createElementNS(NS, 'svg');
  spinner.setAttribute('class', 'notif-toast-spinner');
  spinner.setAttribute('viewBox', '0 0 20 20');
  const track = document.createElementNS(NS, 'circle');
  track.setAttribute('class', 'notif-spinner-track');
  track.setAttribute('cx', '10'); track.setAttribute('cy', '10'); track.setAttribute('r', '8');
  const fill = document.createElementNS(NS, 'circle');
  fill.setAttribute('class', 'notif-spinner-fill');
  fill.setAttribute('cx', '10'); fill.setAttribute('cy', '10'); fill.setAttribute('r', '8');
  fill.style.animationDuration = `${TOAST_DURATION}ms`;
  spinner.appendChild(track);
  spinner.appendChild(fill);
  toast.appendChild(spinner);

  // Close button (on top of spinner)
  const close = document.createElement('span');
  close.className = 'notif-toast-close';
  close.textContent = '✕';
  close.addEventListener('click', () => _onToastClose(notif));
  toast.appendChild(close);

  // Message
  const text = document.createElement('div');
  text.className = 'notif-toast-text';
  text.innerHTML = _formatMessage(notif);
  toast.appendChild(text);

  // Action buttons (for actionable types)
  if (notif.type === 'friend-request' || notif.type === 'lobby-invite' || notif.type === 'join-game') {
    const actions = document.createElement('div');
    actions.className = 'notif-toast-actions';

    const acceptLabel = notif.type === 'join-game' ? 'JOIN GAME' : notif.type === 'lobby-invite' ? 'JOIN' : 'ACCEPT';
    const denyLabel = notif.type === 'lobby-invite' || notif.type === 'join-game' ? 'DISMISS' : 'DENY';

    const acceptBtn = document.createElement('span');
    acceptBtn.className = 'notif-action-btn notif-action-btn--accept';
    acceptBtn.innerHTML = `<svg style="width:10px;height:10px;stroke:currentColor;fill:none;stroke-width:2.5;vertical-align:middle;margin-right:3px" viewBox="0 0 24 24"><use href="/icons.svg#i-check"/></svg>${acceptLabel}`;
    acceptBtn.addEventListener('click', () => _onAccept(notif));

    const denyBtn = document.createElement('span');
    denyBtn.className = 'notif-action-btn notif-action-btn--deny';
    denyBtn.innerHTML = `✕ ${denyLabel}`;
    denyBtn.addEventListener('click', () => _onDeny(notif));

    actions.appendChild(acceptBtn);
    actions.appendChild(denyBtn);
    toast.appendChild(actions);
  }

  // Swipe-to-dismiss (touch + mouse)
  _attachSwipe(toast, notif);

  container.appendChild(toast);

  // Auto-dismiss toast after duration (visual only — notification stays in dropdown)
  const timer = setTimeout(() => _dismissToast(notif.id), TOAST_DURATION);
  _toastTimers.set(notif.id, timer);
}

// ── Swipe-to-dismiss ─────────────────────────────────────

function _attachSwipe(toast: HTMLElement, notif: AppNotif): void {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let startTime = 0;
  let swiping = false;

  const onStart = (x: number, y: number) => {
    startX = x;
    startY = y;
    currentX = x;
    startTime = Date.now();
    swiping = false;
    toast.style.transition = 'none';
  };

  const onMove = (x: number, y: number) => {
    const dx = x - startX;
    const dy = y - startY;
    // Lock to horizontal after 5px movement
    if (!swiping && Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy)) {
      swiping = true;
    }
    if (!swiping) return;
    currentX = x;
    const clampedDx = Math.max(0, dx); // only swipe right
    toast.style.transform = `translateX(${clampedDx}px)`;
    toast.style.opacity = String(Math.max(0.2, 1 - clampedDx / 250));
  };

  const onEnd = () => {
    if (!swiping) return;
    const dx = currentX - startX;
    const elapsed = Date.now() - startTime;
    const velocity = dx / Math.max(1, elapsed);

    if (dx > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY_THRESHOLD) {
      // Fling dismiss — mark as swiped so _dismissToast skips the slide-out animation
      toast.dataset.swiped = '1';
      toast.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      toast.style.transform = 'translateX(110%)';
      toast.style.opacity = '0';
      setTimeout(() => _onToastClose(notif), 200);
    } else {
      // Snap back
      toast.style.transition = 'transform 0.25s cubic-bezier(0.2,1,0.3,1), opacity 0.25s ease';
      toast.style.transform = '';
      toast.style.opacity = '';
    }
    swiping = false;
  };

  // Touch events
  toast.addEventListener('touchstart', (e: TouchEvent) => {
    const t = e.touches[0];
    onStart(t.clientX, t.clientY);
  }, { passive: true });

  toast.addEventListener('touchmove', (e: TouchEvent) => {
    const t = e.touches[0];
    onMove(t.clientX, t.clientY);
    if (swiping) e.preventDefault();
  }, { passive: false });

  toast.addEventListener('touchend', onEnd);
  toast.addEventListener('touchcancel', onEnd);

  // Mouse events (desktop drag)
  toast.addEventListener('mousedown', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.notif-toast-close, .notif-action-btn')) return;
    onStart(e.clientX, e.clientY);

    const onMouseMove = (ev: MouseEvent) => onMove(ev.clientX, ev.clientY);
    const onMouseUp = () => {
      onEnd();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

function _dismissToast(id: string): void {
  const timer = _toastTimers.get(id);
  if (timer) { clearTimeout(timer); _toastTimers.delete(id); }

  const container = document.getElementById('notif-toast-container');
  if (!container) return;
  const toast = container.querySelector(`[data-notif-id="${id}"]`) as HTMLElement | null;
  if (!toast) return;
  if (toast.dataset.swiped) {
    // Already swiped off-screen — just remove without replaying animation
    toast.remove();
  } else {
    toast.classList.add('notif-toast--slide-out');
    setTimeout(() => toast.remove(), 250);
  }
}

function _onToastClose(notif: AppNotif): void {
  _dismissToast(notif.id);
  if (notif.type === 'info') return; // local — toast only, nothing else to clean up
  if (notif.type === 'lobby-invite') {
    removeNotif(notif.id);
    if (_currentUid && notif.fromUid) {
      clearLobbyInvite(_currentUid, notif.fromUid).catch(() => {});
    }
  } else if (notif.type === 'join-game') {
    removeNotif(notif.id);
  }
  // friend-request: toast dismissed but stays in dropdown
}

// ── Action handlers ─────────────────────────────────────

async function _onAccept(notif: AppNotif): Promise<void> {
  if (notif.type === 'friend-request') {
    if (!_currentUid || !_currentUsername || !notif.fromUid || !notif.fromUsername) return;
    _showServerActivity('ACCEPTING');
    try {
      await acceptFriendRequest(_currentUid, _currentUsername, notif.fromUid, notif.fromUsername);
      playLobbyJoin();
    } catch (err) {
      net.warn('notifUI: acceptFriendRequest failed (already friends or request gone?)', err);
    }
    _hideServerActivity();
    removeNotif(notif.id);
  } else if (notif.type === 'lobby-invite') {
    if (_getCurrentLobbyId()) {
      pushNotif({
        id: `info-${Date.now()}`,
        type: 'info',
        message: 'You are already in a party',
        createdAt: Date.now(),
      });
      return;
    }
    if (notif.lobbyId && _joinLobbyById) {
      _joinLobbyById(notif.lobbyId);
    }
    if (_currentUid && notif.fromUid) {
      clearLobbyInvite(_currentUid, notif.fromUid).catch(() => {});
    }
    removeNotif(notif.id);
  } else if (notif.type === 'join-game') {
    if (notif.lobbyId && _joinMatchAsSpectator) {
      _joinMatchAsSpectator(notif.lobbyId);
    }
    removeNotif(notif.id);
  }
}

async function _onDeny(notif: AppNotif): Promise<void> {
  if (notif.type === 'friend-request') {
    if (!_currentUid || !notif.fromUid) return;
    await denyFriendRequest(_currentUid, notif.fromUid).catch(() => {});
    removeNotif(notif.id);
  } else if (notif.type === 'lobby-invite') {
    if (_currentUid && notif.fromUid) {
      clearLobbyInvite(_currentUid, notif.fromUid).catch(() => {});
    }
    removeNotif(notif.id);
  } else if (notif.type === 'join-game') {
    removeNotif(notif.id);
  }
}

// ── Dropdown rendering ──────────────────────────────────

function _renderDropdown(): void {
  const list = document.getElementById('notif-list');
  const empty = document.getElementById('notif-empty');
  if (!list || !empty) return;

  // Filter stale lobby invites
  const active = _notifications.filter(n => {
    if (n.type === 'lobby-invite' && Date.now() - n.createdAt > LOBBY_INVITE_STALE_MS) return false;
    return true;
  });

  list.innerHTML = '';
  if (active.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  for (const notif of active) {
    const row = document.createElement('div');
    row.className = 'notif-row';

    const text = document.createElement('div');
    text.className = 'notif-row-text';
    text.innerHTML = _formatMessage(notif);
    row.appendChild(text);

    // Server notifications always have accept/deny actions
    const actions = document.createElement('div');
    actions.className = 'notif-row-actions';

    const acceptBtn = document.createElement('span');
    acceptBtn.className = 'notif-row-btn notif-row-btn--accept';
    acceptBtn.textContent = notif.type === 'join-game' ? 'JOIN GAME' : notif.type === 'lobby-invite' ? 'JOIN' : 'ACCEPT';
    acceptBtn.addEventListener('click', () => _onAccept(notif));

    const denyBtn = document.createElement('span');
    denyBtn.className = 'notif-row-btn notif-row-btn--deny';
    denyBtn.textContent = notif.type === 'lobby-invite' || notif.type === 'join-game' ? 'DISMISS' : 'DENY';
    denyBtn.addEventListener('click', () => _onDeny(notif));

    actions.appendChild(acceptBtn);
    actions.appendChild(denyBtn);
    row.appendChild(actions);

    list.appendChild(row);
  }
}

// ── Badge ───────────────────────────────────────────────

function _updateBadge(): void {
  const count = _notifications.filter(n => {
    if (n.type === 'lobby-invite' && Date.now() - n.createdAt > LOBBY_INVITE_STALE_MS) return false;
    return true;
  }).length;
  updateBadge('notif-badge', count);
}

// ── Social panel mirror ────────────────────────────────

/** Mirror notifications into every SOCIAL clone (dropdown + overlay). */
function _renderSocialNotifs(): void {
  const socialLists = document.querySelectorAll<HTMLElement>('[data-social-slot="notif-list"]');
  const socialEmpties = document.querySelectorAll<HTMLElement>('[data-social-slot="notif-empty"]');
  if (socialLists.length === 0) return;

  const serverNotifs = _notifications.filter(n => {
    if (n.type === 'info') return false;
    if (n.type === 'lobby-invite' && Date.now() - n.createdAt > LOBBY_INVITE_STALE_MS) return false;
    return true;
  });

  if (serverNotifs.length === 0) {
    for (const list of socialLists) list.innerHTML = '';
    for (const empty of socialEmpties) show(empty);
    updateSocialNotifBadge(0);
    return;
  }

  for (const empty of socialEmpties) hide(empty);

  const html = serverNotifs.map(n => {
    const isActionable = n.type === 'friend-request' || n.type === 'lobby-invite' || n.type === 'join-game';
    const acceptLabel = n.type === 'join-game' ? 'JOIN GAME' : n.type === 'lobby-invite' ? 'JOIN' : 'ACCEPT';
    const denyLabel = n.type === 'lobby-invite' || n.type === 'join-game' ? 'DISMISS' : 'DENY';
    const actionsHtml = isActionable ? `
      <div class="social-notif-actions">
        <div class="menu-btn" data-social-notif-action="accept" data-social-notif-id="${n.id}">
          ${acceptLabel}
        </div>
        <div class="menu-btn menu-btn--secondary" data-social-notif-action="deny" data-social-notif-id="${n.id}">
          ${denyLabel}
        </div>
      </div>
    ` : '';

    return `
      <div class="social-notif-row" data-social-notif-id="${n.id}">
        <div class="social-notif-msg">${_formatMessage(n)}</div>
        ${actionsHtml}
      </div>
    `;
  }).join('');

  for (const list of socialLists) {
    list.innerHTML = html;
    // Wire action buttons for this clone.
    list.querySelectorAll('[data-social-notif-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.socialNotifAction;
        const notifId = (btn as HTMLElement).dataset.socialNotifId;
        if (!notifId) return;
        const notif = _notifications.find(n => n.id === notifId);
        if (!notif) return;

        if (action === 'accept') {
          _handleSocialAccept(notif);
        } else if (action === 'deny') {
          _handleSocialDeny(notif);
        }
      });
    });
  }

  updateSocialNotifBadge(serverNotifs.length);
}

function _handleSocialAccept(notif: AppNotif): void {
  // Delegate to the same handler used by toasts/dropdown
  _onAccept(notif);
}

function _handleSocialDeny(notif: AppNotif): void {
  // Delegate to the same handler used by toasts/dropdown
  _onDeny(notif);
}

// ── Helpers ─────────────────────────────────────────────

function _formatMessage(notif: AppNotif): string {
  if (notif.fromUsername) {
    return notif.message.replace(notif.fromUsername, `<span class="notif-name">${escapeHtml(notif.fromUsername)}</span>`);
  }
  return escapeHtml(notif.message);
}


function _cleanupStaleInvites(): void {
  let changed = false;
  for (let i = _notifications.length - 1; i >= 0; i--) {
    const n = _notifications[i];
    if (n.type === 'lobby-invite' && Date.now() - n.createdAt > LOBBY_INVITE_STALE_MS) {
      _notifications.splice(i, 1);
      _dismissToast(n.id);
      if (_currentUid && n.fromUid) clearLobbyInvite(_currentUid, n.fromUid).catch(() => {});
      changed = true;
    }
  }
  if (changed) {
    _renderDropdown();
    _renderSocialNotifs();
    _updateBadge();
  }
}
