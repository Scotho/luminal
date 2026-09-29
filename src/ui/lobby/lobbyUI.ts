// ── Lobby UI ─────────────────────────────────────────────
// Full-screen lobby with player cards, color pickers, settings sync.
// Shared by both host and guest — role determines which controls are active.

import { createLobby, joinLobby, leaveLobby, returnPartyToLobby as returnPartyToLobbyFB, listenToLobby, stopListening as stopLobbyListening, updateLobbyPlayer } from '../../lobby';
import { OnlineMatch } from '../../onlineMatch';
import { setUserLobby, clearUserLobby } from '../../auth';
import { initLobbyChatIntegration, destroyLobbyChatIntegration, initChatListeners } from './lobbyChat';
import type { LobbyData, VehicleType } from '../../types/index';
import { getGuestList } from '../../types/index';
import { getSelectedMap } from '../mapSelectUI';
import { clearPreviewsByPrefix } from '../lobbyPreview';
import { DEFAULT_PLAYER_COLOR_KEY } from '../../playerColors';
import { BESTOF_OPTIONS, LOBBY_SIZE_OPTIONS, _swallow, type LobbyContext, type GameInstance } from './lobbyContext';
import { selectAiSlot, syncAisToServer, pickAiName, pickAiColor } from './lobbyAI';
import { initLobbySettings, syncBestofToQuickStart as _syncBestofFromSettings, syncSizeToQuickStart as _syncSizeFromSettings, setLobbyBestofIndex as setLobbyBestofIndexImpl, setLobbySizeIndex as setLobbySizeIndexImpl } from './lobbySettings';
import { saveLobbyLocally as _saveLobbyLocally, clearLobbyLocally as _clearLobbyLocally, checkLobbyInvite as _checkLobbyInviteImpl, checkPendingLobby as _checkPendingLobbyImpl, checkSavedLobby as _checkSavedLobbyImpl, rejoinLobbyAfterMatch as _rejoinLobbyAfterMatchImpl } from './lobbyInvites';
import { EVT_CHARACTER_CHANGED, EVT_LOBBY_CTX_MENU } from '../../events';
import { resolveColor } from '../../colorFallback';
import { readyIcon as _readyIconFn, renderLobbyCards as _renderLobbyCardsFnImport, renderVehicleGrid as _renderVehicleGridFnImport, renderMapGrid as _renderMapGridFnImport, renderColorPickerForSelection as _renderColorPickerForSelectionFnImport, initPlayerListeners } from './lobbyPlayers';
import { startLobbyMatch as _startLobbyMatchImpl, clearAutostart as _clearAutostartImpl, checkAutostart as _checkAutostartImpl, showMatchInProgress as _showMatchInProgressImpl, hideMatchInProgress as _hideMatchInProgressImpl, handleReturnToLobby as _handleReturnToLobbyImpl, joinMatchAsSpectator as _joinMatchAsSpectatorImpl, initMatchListeners, isSpectatingMatch as _isSpectatingMatch, setSpectatingMatch as _setSpectatingMatch, isJoinGameNotifPushed as _isJoinGameNotifPushed, setJoinGameNotifPushed as _setJoinGameNotifPushed } from './lobbyMatch';
import { updatePartyHud, setPartyToggleVisible, renderLobbyFriends, renderLobbyParty, updatePartyChip, renderPartySheet, initLobbyContextMenu, showLobbyContextMenu, initPartyHudListeners } from './lobbyPartyHud';
import { handleLobbyUpdate, startHeartbeat as _startHeartbeatImpl, stopHeartbeat as _stopHeartbeat, type LobbyUpdateHooks, type HeartbeatDeps } from './lobbyUIUpdate';
import { DisposableBag } from '../../disposables';

// ── Injected dependency types ───────────────────────────
interface LobbyUIDeps {
  game: GameInstance;
  currentUid: string | null;
  currentUsername: string | null;
  isRealUser?: boolean;
  showScreen: (screen: string | null) => void;
  navigateTo: (screen: string) => void;
  navigateReset: (screen: string) => void;
  handleOnlineStateChange: (state: string, data?: unknown) => void;
  setCurrentOnlineMatch: (match: OnlineMatch | null) => void;
  getPlayerColorKey: () => string;
  getPlayerIcon: () => string | null;
  ensureAudio: () => void;
  hideChatForMatch?: () => void;
  setCurrentScreen?: ((s: string | null) => void) | null;
}

// ── Injected deps (filled by initLobbyUI) ──────────────
let _game: GameInstance = null;
let _currentUid: string | null = null;
let _currentUsername: string | null = null;
let _showScreen: ((screen: string | null) => void) | null = null;
let _navigateTo: ((screen: string) => void) | null = null;
let _navigateReset: ((screen: string) => void) | null = null;
let _handleOnlineStateChange: ((state: string, data?: unknown) => void) | null = null;
let _setCurrentOnlineMatch: ((match: OnlineMatch | null) => void) | null = null;
let _getPlayerColorKey: () => string = () => localStorage.getItem('luminal-color') || DEFAULT_PLAYER_COLOR_KEY;
let _getPlayerIcon: () => string | null = () => null;
let _ensureAudio: () => void = () => {};
let _hideChatForMatch: () => void = () => {};
let _setCurrentScreen: ((s: string | null) => void) | null = null;
let _onProfileClick: ((uid: string) => void) | null = null;
export function setLobbyProfileClickHandler(handler: (uid: string) => void): void { _onProfileClick = handler; }

// ── Lobby state ─────────────────────────────────────────
const _lobbyBag = new DisposableBag();
let _currentLobbyId: string | null = null;
let _myRole: 'host' | 'guest' | null = null;
let _lobbyMatchStarting = false;
let _isReady = false;
let _lobbyBestofIndex = Math.max(0, Math.min(BESTOF_OPTIONS.length - 1, Number(localStorage.getItem('luminal-lobby-bestof') || 0)));
let _lobbySizeIndex = Math.max(0, Math.min(LOBBY_SIZE_OPTIONS.length - 1, Number(localStorage.getItem('luminal-lobby-opponents') || 0)));
let _invitePermIndex = 0;
let _allowAnonIndex: number = 0; // 0 = ALLOW (default true)
let _promotionInProgress = false;
let _aiSlots = new Map<number, { name: string; color: string; vehicle: VehicleType }>();
let _selectedAiSlot: number | null = null; // when set, color picker + vehicle tiles affect this AI
let _hostAiHydrated = false; // true after host's first AI hydration from Firebase
let _lastLobbyData: LobbyData | null = null;
/** SVG icon for ready button: ✓ when ready, ✕ when not (delegates to lobbyPlayers) */
const _readyIcon = _readyIconFn;

// ── Heartbeat — impl lives in lobbyUIUpdate.ts ──────────
const _heartbeatDeps: HeartbeatDeps = {
  getCurrentLobbyId: () => _currentLobbyId,
  getMyRole: () => _myRole,
  leaveLobby: () => _leaveLobby(),
  navigateReset: (s) => _navigateReset?.(s),
};
function _startHeartbeat(): void { _startHeartbeatImpl(_heartbeatDeps); }

// ── Ready toggle ────────────────────────────────────────
let _readyPending = false;
function _toggleReady(): void {
  if (!_currentLobbyId || !_myRole || _readyPending) return;
  _isReady = !_isReady;
  _readyPending = true;
  updateLobbyPlayer(_currentLobbyId, _myRole, { ready: _isReady }, _currentUid!)
    .catch(e => console.warn('lobby: ready toggle failed', e))
    .finally(() => { _readyPending = false; });
}

/** Auto-unready the player (called when entering a game). */
export function unreadyInParty(): void {
  if (!_currentLobbyId || !_myRole || !_isReady) return;
  _isReady = false;
  updateLobbyPlayer(_currentLobbyId, _myRole, { ready: false }, _currentUid!).catch(e => console.warn('lobby: unready failed', e));
  const btn = document.getElementById('btn-lobby-ready');
  if (btn) { btn.innerHTML = _readyIcon(false) + 'READY'; btn.classList.remove('btn-lobby-ready--active'); }
}

// ── Unified lobby update callback ───────────────────────
// Body lives in lobbyUIUpdate.ts — split into ordered sync* phase helpers.
// Order is load-bearing: changing it can cause HUD flicker.
function _onLobbyUpdate(data: LobbyData | null): void { handleLobbyUpdate(data, _ctx, _updateHooks); }

// Hooks lobbyUIUpdate needs beyond LobbyContext.
const _updateHooks: LobbyUpdateHooks = {
  getPromotionInProgress: () => _promotionInProgress,
  setPromotionInProgress: (v) => { _promotionInProgress = v; },
  isSpectatingMatch: () => _isSpectatingMatch(),
  setSpectatingMatch: (v) => { _setSpectatingMatch(v); },
  isJoinGameNotifPushed: () => _isJoinGameNotifPushed(),
  setJoinGameNotifPushed: (v) => { _setJoinGameNotifPushed(v); },
  readyIcon: (ready) => _readyIcon(ready),
  hideMatchInProgress: () => _hideMatchInProgressImpl(),
  showMatchInProgress: (data) => _showMatchInProgressImpl(data, _ctx),
  startLobbyMatch: (data) => _startLobbyMatchImpl(data, _ctx, _clearLobbyLocally),
  handleReturnToLobby: () => _handleReturnToLobbyImpl(_ctx, rejoinLobbyAfterMatch),
  clearLobbyLocally: () => _clearLobbyLocally(),
  stopHeartbeat: () => _stopHeartbeat(),
  checkAutostart: (data) => _checkAutostartImpl(data, _ctx),
  clearAutostart: () => _clearAutostartImpl(),
};

// ── Open lobby as host ──────────────────────────────────
/** Initialize lobby UI state for an already-created lobby. Called by _openLobbyAsHost and invite flow. */
export async function openLobbyById(lobbyId: string, role: 'host' | 'guest'): Promise<void> {
  if (!_currentUid) return;
  const displayName = _currentUsername || 'ANON';
  const colorKey = _getPlayerColorKey();

  _currentLobbyId = lobbyId;
  _myRole = role;
  _lobbyMatchStarting = false;
  _isReady = false;
  _saveLobbyLocally(lobbyId, role);
  setUserLobby(_currentUid!, lobbyId, role).catch(e => console.warn('lobby: setUserLobby failed', e));

  // Default to localStorage vehicle + map vote
  const savedVehicle = (localStorage.getItem('luminal-vehicle') || 'bike') as VehicleType;
  const savedMap = getSelectedMap();
  updateLobbyPlayer(lobbyId, role, { vehicle: savedVehicle, mapVote: savedMap }, _currentUid!).catch(e => console.warn('lobby: vehicle sync failed', e));
  _aiSlots.clear(); _selectedAiSlot = null; _hostAiHydrated = false;

  if (role === 'host') {
    // Auto-add 1 AI to fill the 2nd slot
    const usedNames = new Set<string>([displayName]);
    const usedColors = new Set<string>([colorKey]);
    _aiSlots.set(1, { name: pickAiName(usedNames), color: pickAiColor(usedColors), vehicle: 'bike' as VehicleType });
    syncAisToServer(_ctx);
  }

  const readyBtn = document.getElementById('btn-lobby-ready');
  if (readyBtn) { readyBtn.innerHTML = _readyIcon(false) + 'READY'; readyBtn.classList.remove('btn-lobby-ready--active'); }

  stopLobbyListening();
  listenToLobby(lobbyId, _onLobbyUpdate);
  _startHeartbeat();
  initLobbyChatIntegration(lobbyId);

  _navigateTo!('lobby');

  // Pre-populate friends tab
  _ctx.renderLobbyFriends();
}

let _creatingLobby = false;

export async function _openLobbyAsHost(): Promise<void> {
  if (!_currentUid) return;

  // Already in a lobby — just navigate back to it
  if (_currentLobbyId) {
    _navigateTo!('lobby');
    return;
  }

  if (_creatingLobby) return;
  _creatingLobby = true;

  // Show inline spinner on the lobby button
  const btn = document.getElementById('btn-create-lobby');
  let spinner: HTMLSpanElement | null = null;
  if (btn) {
    spinner = document.createElement('span');
    spinner.className = 'btn-lobby-spinner';
    btn.appendChild(spinner);
  }

  _ensureAudio();

  try {
    const colorKey = _getPlayerColorKey();
    const icon = _getPlayerIcon() || undefined;
    const displayName = _currentUsername || 'ANON';
    const lobbyId = await createLobby(_currentUid!, displayName, colorKey, {
      seriesLength: BESTOF_OPTIONS[_lobbyBestofIndex].rounds,
      lobbySize: LOBBY_SIZE_OPTIONS[_lobbySizeIndex].size,
    }, icon);
    await openLobbyById(lobbyId, 'host');
  } catch (e) {
    console.error('Failed to create lobby:', e);
  } finally {
    _creatingLobby = false;
    if (spinner) spinner.remove();
  }
}

// ── Join lobby via URL (guest) ──────────────────────────
async function _joinLobbyById(lobbyId: string): Promise<void> {
  const statusEl = document.getElementById('join-lobby-status')!;
  const hostEl = document.getElementById('join-lobby-host')!;
  const waitEl = document.getElementById('join-lobby-waiting')!;

  // Show brief joining screen
  _showScreen!('joinLobby');
  statusEl.textContent = 'JOINING LOBBY...';
  hostEl.textContent = '';
  waitEl.style.display = '';
  if (_setCurrentScreen) _setCurrentScreen('joinLobby');

  try {
    const colorKey = _getPlayerColorKey();
    const icon = _getPlayerIcon() || undefined;
    const data = await joinLobby(lobbyId, _currentUid!, _currentUsername || 'ANON', colorKey, icon);
    _currentLobbyId = lobbyId;
    _myRole = 'guest';
    _lobbyMatchStarting = false;
    _isReady = false;
    _aiSlots.clear(); _selectedAiSlot = null; _hostAiHydrated = false;
    _saveLobbyLocally(lobbyId, 'guest');
    setUserLobby(_currentUid!, lobbyId, 'guest').catch(e => console.warn('lobby: setUserLobby failed', e));

    // Resolve color conflict: if our saved color is already taken, fall back deterministically
    const takenOnJoin = new Set<string>();
    takenOnJoin.add(data.host.color);
    for (const g of getGuestList(data)) {
      if (g.uid !== _currentUid) takenOnJoin.add(g.color);
    }
    if (data.ais) for (const ai of Object.values(data.ais as Record<string, { color: string }>)) takenOnJoin.add(ai.color);
    const resolvedColor = resolveColor(colorKey, takenOnJoin);
    if (resolvedColor !== colorKey) {
      updateLobbyPlayer(lobbyId, 'guest', { color: resolvedColor }, _currentUid!).catch(() => {});
    }

    // Default to localStorage vehicle + map vote so the player enters with their saved selection
    const savedVehicle = (localStorage.getItem('luminal-vehicle') || 'bike') as VehicleType;
    const savedMap = getSelectedMap();
    updateLobbyPlayer(lobbyId, 'guest', { vehicle: savedVehicle, mapVote: savedMap }, _currentUid!).catch(() => {});
    const readyBtn = document.getElementById('btn-lobby-ready');
    if (readyBtn) { readyBtn.innerHTML = _readyIcon(false) + 'READY'; readyBtn.classList.remove('btn-lobby-ready--active'); }

    // Listen for lobby changes (will trigger _renderLobbyCards via _onLobbyUpdate)
    listenToLobby(lobbyId, _onLobbyUpdate);
    _startHeartbeat();
    initLobbyChatIntegration(lobbyId);

    // If lobby is active (match in progress), go to spectator screen instead
    if (data.status === 'active') {
      _setSpectatingMatch(true);
      _showMatchInProgressImpl(data, _ctx);
    } else {
      // Transition from joinLobby to lobby screen
      _navigateReset!('lobby');
    }
  } catch (e: unknown) {
    statusEl.textContent = (e instanceof Error ? e.message : '').toUpperCase() || 'FAILED TO JOIN';
    waitEl.style.display = 'none';
    setTimeout(() => _navigateReset!('main'), 2500);
  }
}

// ── Leave / cleanup ─────────────────────────────────────
export function _leaveLobby(): void {
  _lobbyBag.reset();
  if (_currentLobbyId && _myRole) {
    leaveLobby(_currentLobbyId, _currentUid!, _myRole === 'host').catch(_swallow('leave lobby'));
  }
  if (_currentUid) clearUserLobby(_currentUid).catch(() => {});
  stopLobbyListening();
  _stopHeartbeat();
  destroyLobbyChatIntegration();
  _currentLobbyId = null;
  _myRole = null;
  _lobbyMatchStarting = false;
  _isReady = false;
  _clearAutostartImpl();
  _aiSlots.clear(); _selectedAiSlot = null; _hostAiHydrated = false;
  _lastLobbyData = null;
  if (_isSpectatingMatch()) _hideMatchInProgressImpl();
  _ctx.updatePartyHud(null);
  document.getElementById('lobby-party-sheet')?.classList.remove('lobby-party-sheet--open');
  clearPreviewsByPrefix('vtile-');
  _clearLobbyLocally();
}

/** Rejoin the lobby after a match ends (called when host returns party to lobby).
 *  Returns true if rejoin succeeded, false if lobby is gone. */
export async function rejoinLobbyAfterMatch(lobbyId: string, role: 'host' | 'guest'): Promise<boolean> {
  return _rejoinLobbyAfterMatchImpl(lobbyId, role, _ctx, _onLobbyUpdate);
}

// ── Lobby settings persistence (logic lives in lobbySettings.ts) ──
export function setLobbyBestofIndex(index: number): void { setLobbyBestofIndexImpl(index, _ctx); }
export function setLobbySizeIndex(index: number): void { setLobbySizeIndexImpl(index, _ctx); }

export function isLobbyMatchStarting(): boolean { return _lobbyMatchStarting; }

/** Host triggers return-to-lobby for the whole party (called from main.ts pause/result screen). */
export function returnPartyToLobby(): void {
  const lobbyId = _currentLobbyId;
  if (!lobbyId || _myRole !== 'host') return;
  returnPartyToLobbyFB(lobbyId).catch(_swallow('return party'));
}

// ── Public getters for notification system ──────────────
export function getCurrentLobbyId(): string | null { return _currentLobbyId; }
export function getMyRole(): 'host' | 'guest' | null { return _myRole; }
export function joinLobbyById(lobbyId: string): void { _joinLobbyById(lobbyId); }

/** Called from JOIN GAME notification — spectating guest wants to see the match-in-progress screen. */
export function joinMatchAsSpectator(lobbyId: string): void {
  _joinMatchAsSpectatorImpl(lobbyId, _ctx);
}

// ── Check lobby invite / pending / saved lobby ───────────
// Logic lives in lobbyInvites.ts; wrappers pass _ctx and callbacks.

export async function _checkLobbyInvite(): Promise<void> {
  return _checkLobbyInviteImpl(_ctx, _joinLobbyById);
}

export { hasPendingInvite } from './lobbyInvites';

export function _checkPendingLobby(): void {
  _checkPendingLobbyImpl(_ctx, _joinLobbyById);
}

export async function _checkSavedLobby(): Promise<void> {
  return _checkSavedLobbyImpl(_ctx, _onLobbyUpdate);
}

// ── Auth updates ────────────────────────────────────────
export function updateCurrentUser(uid: string | null, username: string | null, _isReal?: boolean): void {
  _currentUid = uid;
  _currentUsername = username;
  // Show/hide party button based on login state
  setPartyToggleVisible(!!_currentLobbyId, _ctx);
}

export function refreshPartyToggleVisibility(): void {
  setPartyToggleVisible(!!_currentLobbyId, _ctx);
}

// ── Context object for extracted modules ────────────────
// All helpers in lobby*.ts read/write coordinator state via this context.
export const _ctx: LobbyContext = {
  // ── Getters ──
  getCurrentLobbyId: () => _currentLobbyId,
  getMyRole: () => _myRole,
  getCurrentUid: () => _currentUid,
  getCurrentUsername: () => _currentUsername,
  getLastLobbyData: () => _lastLobbyData,
  getAiSlots: () => _aiSlots,
  getSelectedAiSlot: () => _selectedAiSlot,
  isReady: () => _isReady,
  getPlayerColorKey: () => _getPlayerColorKey(),
  getPlayerIcon: () => _getPlayerIcon(),
  getLobbyBestofIndex: () => _lobbyBestofIndex,
  getLobbySizeIndex: () => _lobbySizeIndex,
  getInvitePermIndex: () => _invitePermIndex,
  getAllowAnonIndex: () => _allowAnonIndex,
  getGame: () => _game,
  isHostAiHydrated: () => _hostAiHydrated,
  getOnProfileClick: () => _onProfileClick,
  isLobbyMatchStarting: () => _lobbyMatchStarting,
  // ── Setters ──
  setAiSlots: (v) => { _aiSlots = v; },
  setSelectedAiSlot: (v) => { _selectedAiSlot = v; },
  setLobbyBestofIndex: (v) => { _lobbyBestofIndex = v; },
  setLobbySizeIndex: (v) => { _lobbySizeIndex = v; },
  setInvitePermIndex: (v) => { _invitePermIndex = v; },
  setAllowAnonIndex: (i: number) => { _allowAnonIndex = i; },
  setReady: (v) => { _isReady = v; },
  setLastLobbyData: (v) => { _lastLobbyData = v; },
  setHostAiHydrated: (v) => { _hostAiHydrated = v; },
  setLobbyMatchStarting: (v) => { _lobbyMatchStarting = v; },
  setCurrentLobbyId: (v) => { _currentLobbyId = v; },
  setMyRole: (v) => { _myRole = v; },
  setOpponentColor: (_v) => {}, // legacy — was tracked for color conflict checks but never read
  // ── Dep actions ──
  showScreen: (s) => _showScreen?.(s) ?? undefined,
  navigateTo: (s) => _navigateTo?.(s) ?? undefined,
  navigateReset: (s) => _navigateReset?.(s) ?? undefined,
  handleOnlineStateChange: (state, data) => _handleOnlineStateChange?.(state, data) ?? undefined,
  setCurrentOnlineMatch: (m) => _setCurrentOnlineMatch?.(m) ?? undefined,
  ensureAudio: () => _ensureAudio(),
  hideChatForMatch: () => _hideChatForMatch(),
  setCurrentScreen: (s) => _setCurrentScreen?.(s) ?? undefined,
  // ── Cross-module delegations ──
  renderLobbyCards: (data) => _renderLobbyCardsFnImport(data, _ctx),
  renderVehicleGrid: (data) => _renderVehicleGridFnImport(data, _ctx),
  renderMapGrid: (data) => _renderMapGridFnImport(data, _ctx),
  updatePartyHud: (data) => updatePartyHud(data, _ctx),
  syncAisToServer: () => syncAisToServer(_ctx),
  renderColorPickerForSelection: (data) => _renderColorPickerForSelectionFnImport(data, _ctx),
  leaveLobby: () => _leaveLobby(),
  startHeartbeat: () => _startHeartbeat(),
  stopHeartbeat: () => _stopHeartbeat(),
  clearAutostart: () => _clearAutostartImpl(),
  selectAiSlot: (s) => selectAiSlot(s, _ctx),
  syncSizeToQuickStart: () => _syncSizeFromSettings(_ctx),
  syncBestofToQuickStart: () => _syncBestofFromSettings(_ctx),
  checkAutostart: (data) => _checkAutostartImpl(data, _ctx),
  renderLobbyFriends: () => renderLobbyFriends(),
  renderLobbyParty: (data) => renderLobbyParty(data, _ctx),
  updatePartyChip: (data) => updatePartyChip(data, _ctx),
  renderPartySheet: (data) => renderPartySheet(data, _ctx),
  // ── Optional coordinator actions ──
  openLobbyAsHost: () => _openLobbyAsHost(),
  toggleReady: () => _toggleReady(),
};

// ── Init ────────────────────────────────────────────────
export function initLobbyUI(deps: LobbyUIDeps): void {
  _lobbyBag.reset(); // re-init safety: tear down any previous listeners

  _game = deps.game;
  _currentUid = deps.currentUid;
  _currentUsername = deps.currentUsername;
  _showScreen = deps.showScreen;
  _navigateTo = deps.navigateTo;
  _navigateReset = deps.navigateReset;
  _handleOnlineStateChange = deps.handleOnlineStateChange;
  _setCurrentOnlineMatch = deps.setCurrentOnlineMatch;
  _getPlayerColorKey = deps.getPlayerColorKey;
  _getPlayerIcon = deps.getPlayerIcon;
  _ensureAudio = deps.ensureAudio;
  _hideChatForMatch = deps.hideChatForMatch || (() => {});
  _setCurrentScreen = deps.setCurrentScreen || null;

  initLobbyContextMenu(_lobbyBag);

  // Sync character select changes to the active lobby
  _lobbyBag.addEventListener(window, EVT_CHARACTER_CHANGED, ((e: CustomEvent) => {
    if (!_currentLobbyId || !_myRole || !_currentUid) return;
    const { vehicle, color } = e.detail as { vehicle?: string; color?: string };
    const update: Record<string, string> = {};
    if (vehicle) update.vehicle = vehicle;
    if (color) update.color = color;
    if (Object.keys(update).length > 0) {
      updateLobbyPlayer(_currentLobbyId, _myRole, update, _currentUid).catch(() => {});
    }
  }) as EventListener);

  // Autostart banner + match listeners
  initMatchListeners(_ctx, _lobbyBag);

  // Vehicle tile click handlers, drag scroll, mobile carousel
  initPlayerListeners(_ctx, _lobbyBag);

  // Wire up context menu event from lobbyPlayers
  _lobbyBag.addEventListener(document, EVT_LOBBY_CTX_MENU, ((e: CustomEvent) => {
    const { x, y, opts } = e.detail as { x: number; y: number; opts: Parameters<typeof showLobbyContextMenu>[2] };
    showLobbyContextMenu(x, y, opts, _ctx);
  }) as EventListener);

  // Bestof/size/invite-perm arrow listeners — wired in lobbySettings.ts
  initLobbySettings(_ctx, _lobbyBag);

  // Register friends-change callback to keep DM tabs fresh
  initChatListeners(_lobbyBag);

  // Party HUD + lobby action buttons
  initPartyHudListeners(_ctx, _lobbyBag);

  // NOTE: No beforeunload cleanup — Firebase onDisconnect handlers (set in
  // createLobby/joinLobby) already mark presence=false without removing entries.
  // On refresh, _checkSavedLobby() + rejoinLobby() restores the session.
  // On tab close, the 30s offline countdown handles eventual cleanup.

  // Trigger lobby invite check on page load
  setTimeout(_checkLobbyInvite, 500);
}
