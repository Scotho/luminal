// ── Friends UI ──────────────────────────────────────────
import {
  sendFriendRequest, acceptFriendRequest, denyFriendRequest,
  removeFriend, listenRequests, listenFriends,
  findUserByUsername, stopAll as stopFriendsListening
} from '../friends';
import { sendLobbyInvite, createLobby, checkLobby } from '../lobby';
import { pushNotif } from './notifUI';
import { getCurrentLobbyId, getMyRole, openLobbyById } from './lobby/lobbyUI';
import type { FriendRequest, FriendEntry } from '../types/index';
import { escapeHtml, show, hide, toggleVisible, updateBadge, onLongPress } from './dom';
import { ref, onValue as rtdbOnValue } from 'firebase/database';
import { rtdb as rtdbInstance } from '../firebase';
import type { Unsubscribe } from 'firebase/database';
import { DEFAULT_PLAYER_COLOR_KEY } from '../playerColors';
import { playLobbyJoin } from '../sfx';
import { net } from '../netLog';

// ── Extended FriendRequest with runtime id field ─────────
interface FriendRequestWithId extends FriendRequest {
  id: string;
}

// ── Init dependencies ────────────────────────────────────
interface FriendsUIDeps {
  currentUid: string | null;
  currentUsername: string | null;
  isRealUser: boolean;
  navigateTo: (screen: string) => void;
  navigateBack: () => void;
  showServerActivity: (msg: string) => void;
  hideServerActivity: () => void;
  getPlayerColorKey?: () => string;
  getPlayerIcon?: () => string | null;
}

/* ── Injected state (set via init / updateCurrentUser) ── */
let _currentUid: string | null = null;
let _currentUsername: string | null = null;
let _isRealUser: boolean = false;

/* ── Injected callbacks (set via initFriendsUI) ───────── */
let _navigateTo: ((screen: string) => void) | null = null;
let _showServerActivity: ((msg: string) => void) | null = null;
let _hideServerActivity: (() => void) | null = null;
let _getPlayerColorKey: () => string = () => DEFAULT_PLAYER_COLOR_KEY;
let _getPlayerIcon: () => string | null = () => null;

/* ── Profile click callback ───────────────────────────── */
let _onProfileClick: ((uid: string) => void) | null = null;

export function setFriendProfileClickHandler(handler: (uid: string) => void): void {
  _onProfileClick = handler;
}

/* ── Internal state ───────────────────────────────────── */
let _friendsList: FriendEntry[] = [];
let _friendRequests: FriendRequestWithId[] = [];
let _friendsListenerActive: boolean = false;

/* ── Online status ─────────────────────────────────────── */
const STALE_THRESHOLD_MS = 120_000;
const _friendsOnline: Map<string, boolean> = new Map();
const _friendsOnlineUnsubs: Map<string, Unsubscribe> = new Map();
let _onFriendsChangeCb: (() => void) | null = null;

// ── Core listeners ───────────────────────────────────────

export function _startFriendsListeners(): void {
  if (_friendsListenerActive || !_currentUid || !_isRealUser) return;
  _friendsListenerActive = true;

  listenRequests(_currentUid, (requests: FriendRequestWithId[]) => {
    // Detect new requests — push to unified notification system
    const oldIds: Set<string> = new Set(_friendRequests.map((r: FriendRequestWithId) => r.id));
    for (const req of requests) {
      if (!oldIds.has(req.id)) {
        pushNotif({
          id: `fr-${req.id}`,
          type: 'friend-request',
          message: `${req.fromUsername} sent you a friend request`,
          createdAt: Date.now(),
          fromUid: req.fromUid,
          fromUsername: req.fromUsername,
        });
      }
    }
    _friendRequests = requests;
    _updateFriendBadge();
    _renderFriendRequests();
  });

  listenFriends(_currentUid, (friends: (FriendEntry & { id: string })[]) => {
    if (_friendsList.length > 0 && friends.length > _friendsList.length) playLobbyJoin();
    _friendsList = friends;
    _renderFriendsList();
    _updateFriendsOnlineListeners();
    _onFriendsChangeCb?.();
  });
}

export function _stopFriendsListeners(): void {
  stopFriendsListening();
  _friendsListenerActive = false;
  _friendsList = [];
  _friendRequests = [];
  // Stop all RTDB online listeners
  _friendsOnlineUnsubs.forEach(unsub => unsub());
  _friendsOnlineUnsubs.clear();
  _friendsOnline.clear();
}

function _updateFriendsOnlineListeners(): void {
  const currentUids = new Set(_friendsList.map(f => f.uid));

  // Remove listeners for friends no longer on the list
  let removed = false;
  for (const [uid, unsub] of _friendsOnlineUnsubs) {
    if (!currentUids.has(uid)) {
      unsub();
      _friendsOnlineUnsubs.delete(uid);
      _friendsOnline.delete(uid);
      removed = true;
    }
  }
  if (removed) _updateFriendsOnlineIndicator();

  // Add listeners for new friends
  for (const f of _friendsList) {
    if (_friendsOnlineUnsubs.has(f.uid)) continue;
    const statusRef = ref(rtdbInstance, `status/${f.uid}`);
    const unsub = rtdbOnValue(statusRef, (snap) => {
      const val = snap.val();
      const isOnline = val?.online === true &&
        Date.now() - (val?.ts || 0) < STALE_THRESHOLD_MS;
      const prev = _friendsOnline.get(f.uid);
      _friendsOnline.set(f.uid, isOnline);
      if (prev !== isOnline) {
        _renderFriendsList();
        _onFriendsChangeCb?.();
      }
      _updateFriendsOnlineIndicator();
    });
    _friendsOnlineUnsubs.set(f.uid, unsub);
  }
}

export function isFriend(uid: string): boolean {
  return _friendsList.some(f => f.uid === uid);
}

// ── Badge ────────────────────────────────────────────────

export function _updateFriendBadge(): void {
  updateBadge('friend-req-badge', _friendRequests.length);
}

// ── Render helpers ───────────────────────────────────────

function _renderFriendRequests(): void {
  const container: HTMLElement = document.getElementById('friends-requests-list')!;
  const section: HTMLElement = document.getElementById('friends-requests')!;
  const sectionLabel = section.querySelector('.friends-section-label');
  if (sectionLabel) sectionLabel.textContent = `REQUESTS (${_friendRequests.length})`;
  if (!_friendRequests.length) {
    hide(section);
    return;
  }
  show(section);
  container.innerHTML = '';
  for (const req of _friendRequests) {
    const row: HTMLDivElement = document.createElement('div');
    row.className = 'friend-row';
    row.innerHTML = `
      <span class="friend-name">${escapeHtml(req.fromUsername)}</span>
      <div class="friend-actions">
        <span class="friend-action-btn friend-action-btn--accept" data-uid="${req.fromUid}" data-name="${escapeHtml(req.fromUsername)}">ACCEPT</span>
        <span class="friend-action-btn friend-action-btn--deny" data-uid="${req.fromUid}">DENY</span>
      </div>`;
    container.appendChild(row);
  }
  container.querySelectorAll('.friend-action-btn--accept').forEach((btn: Element) => {
    btn.addEventListener('click', async () => {
      _showServerActivity!('ACCEPTING');
      await acceptFriendRequest(_currentUid!, _currentUsername!, (btn as HTMLElement).dataset.uid!, (btn as HTMLElement).dataset.name!);
      playLobbyJoin();
      _hideServerActivity!();
    });
  });
  container.querySelectorAll('.friend-action-btn--deny').forEach((btn: Element) => {
    btn.addEventListener('click', async () => {
      await denyFriendRequest(_currentUid!, (btn as HTMLElement).dataset.uid!);
    });
  });

  renderFriendsIntoSocial();
}

// ── Friend Context Menu ──────────────────────────────────
let _ctxMenu: HTMLElement | null = null;

function _initContextMenu(): void {
  _ctxMenu = document.createElement('div');
  _ctxMenu.className = 'dropdown-panel';
  _ctxMenu.id = 'friend-ctx-menu';
  _ctxMenu.style.position = 'fixed';
  _ctxMenu.style.zIndex = '100';
  document.body.appendChild(_ctxMenu);
  document.addEventListener('click', _closeCtxMenu);
  document.addEventListener('contextmenu', (e: MouseEvent) => {
    // Close if right-clicking outside a friend row
    if (!(e.target as HTMLElement).closest('.friend-row')) _closeCtxMenu();
  });
}

function _closeCtxMenu(): void {
  if (_ctxMenu) _ctxMenu.classList.remove('dropdown-panel--open');
}

function _showFriendContextMenu(x: number, y: number, friendUid: string): void {
  if (!_ctxMenu) return;
  _ctxMenu.innerHTML = '';

  const inviteItem: HTMLDivElement = document.createElement('div');
  inviteItem.className = 'dropdown-item';
  inviteItem.textContent = 'INVITE TO LOBBY';
  inviteItem.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); _handleSmartInvite(friendUid); });
  _ctxMenu.appendChild(inviteItem);

  const removeItem: HTMLDivElement = document.createElement('div');
  removeItem.className = 'dropdown-item dropdown-item--danger';
  removeItem.textContent = 'REMOVE FRIEND';
  removeItem.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); _handleRemoveFriend(friendUid); });
  _ctxMenu.appendChild(removeItem);

  // Position with bounds checking
  _ctxMenu.classList.add('dropdown-panel--open');
  _ctxMenu.style.left = `${x}px`;
  _ctxMenu.style.top = `${y}px`;
  requestAnimationFrame(() => {
    if (!_ctxMenu) return;
    const rect: DOMRect = _ctxMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) _ctxMenu.style.left = `${window.innerWidth - rect.width - 8}px`;
    if (rect.bottom > window.innerHeight) _ctxMenu.style.top = `${window.innerHeight - rect.height - 8}px`;
  });
}

async function _handleSmartInvite(friendUid: string): Promise<void> {
  _closeCtxMenu();
  if (!_currentUid || !_currentUsername) return;

  let lobbyId: string | null = getCurrentLobbyId();

  if (lobbyId) {
    // Check invite permission
    try {
      const lobbyData = await checkLobby(lobbyId);
      if (lobbyData && lobbyData.settings.invitePermission === 'private' && getMyRole() !== 'host') {
        pushNotif({ id: `info-${Date.now()}`, type: 'info', message: 'Only the host can send invites', createdAt: Date.now() });
        return;
      }
    } catch (err) {
      net.warn('friendsUI: checkLobby failed — proceeding with invite anyway', err);
    }
  } else {
    // Auto-create a lobby AND initialize lobby UI so host is properly "in" it
    try {
      const colorKey: string = _getPlayerColorKey();
      const icon: string | undefined = _getPlayerIcon() || undefined;
      lobbyId = await createLobby(_currentUid, _currentUsername, colorKey, {}, icon);
      await openLobbyById(lobbyId, 'host');
    } catch {
      pushNotif({ id: `info-${Date.now()}`, type: 'info', message: 'Failed to create lobby', createdAt: Date.now() });
      return;
    }
  }

  try {
    await sendLobbyInvite(_currentUid, _currentUsername, friendUid, lobbyId);
    pushNotif({ id: `info-${Date.now()}`, type: 'info', message: 'Lobby invite sent!', createdAt: Date.now() });
  } catch {
    pushNotif({ id: `info-${Date.now()}`, type: 'info', message: 'Failed to send invite', createdAt: Date.now() });
  }
}

async function _handleRemoveFriend(friendUid: string): Promise<void> {
  _closeCtxMenu();
  if (!_currentUid) return;
  _showServerActivity!('REMOVING');
  await removeFriend(_currentUid, friendUid);
  _hideServerActivity!();
}

// ── Render friends list ─────────────────────────────────
function _renderFriendsList(): void {
  const container: HTMLElement = document.getElementById('friends-list')!;
  const empty: HTMLElement = document.getElementById('friends-empty')!;
  const sectionLabel = document.querySelector('#friends-list-section > .friends-section-label');
  if (sectionLabel) sectionLabel.textContent = `FRIENDS${_friendsList.length ? ` (${_friendsList.length})` : ''}`;

  if (!_friendsList.length) {
    container.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  container.innerHTML = '';

  // Sort: online first, then alphabetical
  const sorted = [..._friendsList].sort((a, b) => {
    const aOn = _friendsOnline.get(a.uid) ? 1 : 0;
    const bOn = _friendsOnline.get(b.uid) ? 1 : 0;
    if (aOn !== bOn) return bOn - aOn;
    return a.username.localeCompare(b.username);
  });

  for (const f of sorted) {
    const online = _friendsOnline.get(f.uid) || false;
    const row: HTMLDivElement = document.createElement('div');
    row.className = 'friend-row';

    // Online dot
    const dot = document.createElement('span');
    dot.className = `friend-status-dot${online ? ' friend-status-dot--online' : ''}`;
    dot.setAttribute('data-tip', online ? 'ONLINE' : 'OFFLINE');
    row.appendChild(dot);

    // Name
    const nameEl = document.createElement('span');
    nameEl.className = 'friend-name';
    if (!online) nameEl.classList.add('friend-name--offline');
    nameEl.textContent = f.username;
    if (_onProfileClick) {
      nameEl.style.cursor = 'pointer';
      nameEl.addEventListener('click', (e) => { e.stopPropagation(); _onProfileClick!(f.uid); });
    }
    row.appendChild(nameEl);

    // Inline actions (visible on hover)
    const actions = document.createElement('span');
    actions.className = 'friend-actions';

    const inviteBtn = document.createElement('span');
    inviteBtn.className = 'friend-action-btn friend-action-btn--invite';
    inviteBtn.textContent = 'INVITE';
    inviteBtn.addEventListener('click', (e) => { e.stopPropagation(); _handleSmartInvite(f.uid); });
    actions.appendChild(inviteBtn);

    const removeBtn = document.createElement('span');
    removeBtn.className = 'friend-action-btn friend-action-btn--remove';
    removeBtn.textContent = 'REMOVE';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); _handleRemoveFriend(f.uid); });
    actions.appendChild(removeBtn);

    row.appendChild(actions);

    // Context menu (right-click + long-press)
    row.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      _showFriendContextMenu(e.clientX, e.clientY, f.uid);
    });
    onLongPress(row, (x, y) => _showFriendContextMenu(x, y, f.uid));
    container.appendChild(row);
  }

  renderFriendsIntoSocial();
}

// (Old notification popup removed — unified system in notifUI.ts)

// ── Add friend ───────────────────────────────────────────

async function _addFriend(): Promise<void> {
  const input: HTMLInputElement = document.getElementById('friends-add-input') as HTMLInputElement;
  const status: HTMLElement = document.getElementById('friends-add-status')!;
  const username: string = input.value.trim();
  if (!username) return;
  if (username === _currentUsername) {
    status.textContent = "THAT'S YOU";
    status.className = 'error';
    return;
  }

  status.textContent = 'SEARCHING...';
  status.className = '';
  _showServerActivity!('ADDING FRIEND');

  try {
    const user: { uid: string } | null = await findUserByUsername(username);
    if (!user) {
      status.textContent = 'USER NOT FOUND';
      status.className = 'error';
      _hideServerActivity!();
      return;
    }

    const result: string = await sendFriendRequest(_currentUid!, _currentUsername!, user.uid, username);
    if (result === 'accepted') {
      status.textContent = 'FRIEND ADDED!';
    } else {
      status.textContent = 'REQUEST SENT!';
    }
    status.className = 'success';
    input.value = '';
  } catch (e: unknown) {
    status.textContent = (e instanceof Error ? e.message?.toUpperCase() : '') || 'ERROR';
    status.className = 'error';
  }
  _hideServerActivity!();
}


// ── Initialization ───────────────────────────────────────

/**
 * Wire up all Friends UI event listeners and inject shared dependencies.
 * Call once after the DOM is ready.
 */
export function initFriendsUI({ currentUid, currentUsername, isRealUser, navigateTo, navigateBack: _navigateBack, showServerActivity, hideServerActivity, getPlayerColorKey, getPlayerIcon }: FriendsUIDeps): void {
  _currentUid = currentUid;
  _currentUsername = currentUsername;
  _isRealUser = isRealUser;
  _navigateTo = navigateTo;
  _showServerActivity = showServerActivity;
  _hideServerActivity = hideServerActivity;
  if (getPlayerColorKey) _getPlayerColorKey = getPlayerColorKey;
  if (getPlayerIcon) _getPlayerIcon = getPlayerIcon;

  _initContextMenu();

  // Friends overlay open/close — whole header row or VIEW ALL link
  function _openFriends(): void {
    if (!_currentUid || !_isRealUser || !_currentUsername) {
      document.getElementById('btn-login')!.click();
      return;
    }
    _navigateTo!('friends');
  }
  document.getElementById('btn-friends-social')?.addEventListener('click', (e) => { e.stopPropagation(); _openFriends(); });

  // Add friend by username
  document.getElementById('btn-friends-add')!.addEventListener('click', _addFriend);
  document.getElementById('friends-add-input')!.addEventListener('keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); _addFriend(); }
    e.stopPropagation(); // Prevent game key handlers
  });
}

/**
 * Update the cached user identity (call after login/logout).
 */
export function updateCurrentUser(uid: string | null, username: string | null, isReal: boolean): void {
  _currentUid = uid;
  _currentUsername = username;
  _isRealUser = isReal;
}

/** Render friends list into ALL social clones (dropdown + overlay). */
export function renderFriendsIntoSocial(): void {
  const mainList = document.getElementById('friends-list');
  if (mainList) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-social-slot="friends-list"]')) {
      el.innerHTML = mainList.innerHTML;
    }
  }

  // Mirror requests section
  const mainReqs = document.getElementById('friends-requests-list');
  if (mainReqs) {
    for (const el of document.querySelectorAll<HTMLElement>('[data-social-slot="friends-requests-list"]')) {
      el.innerHTML = mainReqs.innerHTML;
    }
  }

  // Show/hide requests section
  const mainReqSection = document.getElementById('friends-requests');
  if (mainReqSection) {
    const visible = !mainReqSection.classList.contains('hidden');
    for (const el of document.querySelectorAll<HTMLElement>('[data-social-slot="friends-requests"]')) {
      toggleVisible(el, visible);
    }
  }

  // Show/hide empty state (main uses style.display)
  const mainEmpty = document.getElementById('friends-empty');
  if (mainEmpty) {
    const visible = mainEmpty.style.display !== 'none';
    for (const el of document.querySelectorAll<HTMLElement>('[data-social-slot="friends-empty"]')) {
      toggleVisible(el, visible);
    }
  }
}

export function getFriendOnlineMap(): Map<string, boolean> { return _friendsOnline; }
export function onFriendsChange(cb: () => void): void { _onFriendsChangeCb = cb; }

export function getOnlineFriendCount(): number {
  let count = 0;
  for (const online of _friendsOnline.values()) {
    if (online) count++;
  }
  return count;
}

function _updateFriendsOnlineIndicator(): void {
  const count = getOnlineFriendCount();
  const el = document.getElementById('friends-online-count');
  const wrap = document.getElementById('friends-online-indicator');
  if (el) el.textContent = String(count);
  if (wrap) wrap.classList.toggle('hidden', count === 0);
}
export async function handleSmartInvitePublic(friendUid: string): Promise<void> {
  return _handleSmartInvite(friendUid);
}

/** Get friends list for lobby invite mode — online friends first, then offline */
export function getFriendsForInvite(): Array<{ uid: string; username: string; online: boolean }> {
  return _friendsList
    .map(f => ({
      uid: f.uid,
      username: f.username,
      online: _friendsOnline.get(f.uid) ?? false,
    }))
    .sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.username.localeCompare(b.username);
    });
}
