// ── Online Play UI ─────────────────────────────────────
import { enterQueue, leaveQueue, onMatchFound, listenForMatch, removeFromQueue } from '../matchmaking';
import { OnlineMatch } from '../onlineMatch';
import { formatTime } from '../utils';
import { vibrate, VIBE } from '../vibrate';
import { playUiMatchFound, playUiBlip } from '../sfx';
import { joinLobbyById } from './lobby/lobbyUI';
import { DEFAULT_PLAYER_COLOR_KEY } from '../playerColors';
import { getSelectedMap } from './mapSelectUI';
import type { MatchFoundData, PublicLobbyInfo } from '../types/index';
import { escapeHtml } from './dom';
import { fetchPublicLobbies } from '../lobby';
import { net } from '../netLog';
import { dispatchOnlineState, initOnlineUIStates } from './onlineUIStates';
import { wireOnlineUIBindings } from './onlineUIBindings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameInstance = any;

// ── Injected dependency types ───────────────────────────
interface OnlineUIDeps {
  game: GameInstance;
  currentUid: string | null;
  currentUsername: string | null;
  isRealUser: boolean;
  showScreen: (screen: string | null) => void;
  navigateTo: (screen: string) => void;
  navigateBack: () => void;
  setCurrentScreen: (s: string | null) => void;
  getCurrentScreen: () => string | null;
  updateFocus: () => void;
  getFocusIndex: () => number;
  setFocusIndex: (i: number) => void;
  playConfirm: () => void;
  playTick: () => void;
  hideChatForMatch: () => void;
  restoreChatAfterMatch: () => void;
  initMatchChat: (matchId: string, opponentName: string) => void;
  destroyMatchChat: () => void;
  restoreBgMode: () => void;
  ensureAudio: () => void;
  updateControlUI: () => void;
  getLobbyMatchStarting: () => boolean;
  setLobbyMatchStarting: (v: boolean) => void;
  hideDynBack: () => void;
  clearNavStack: () => void;
}

// ── Shared state (injected via init) ────────────────────
let game: GameInstance = null;
let currentUid: string | null = null;
let currentUsername: string | null = null;
let isRealUser: boolean = false;
let showScreen: ((screen: string | null) => void) | null = null;
let _setCurrentScreen: ((s: string | null) => void) | null = null;
let updateFocus: (() => void) | null = null;
let _setFocusIndex: ((i: number) => void) | null = null;
let playTick: (() => void) | null = null;
let _restoreChatAfterMatch: (() => void) | null = null;
let _destroyMatchChat: (() => void) | null = null;
let _restoreBgMode: (() => void) | null = null;
let _setLobbyMatchStarting: ((v: boolean) => void) | null = null;

// ── Profile click callback ──────────────────────────────
let _onProfileClick: ((uid: string) => void) | null = null;

export function setOnlineProfileClickHandler(handler: (uid: string) => void): void {
  _onProfileClick = handler;
}

// ── Open Lobbies state ─────────────────────────────────────
let _lobbiesExpanded: boolean = false;
let _lobbyPollInterval: ReturnType<typeof setInterval> | null = null;
let _lobbyCountdownInterval: ReturnType<typeof setInterval> | null = null;
let _lobbyCountdown: number = 0;
const LOBBY_POLL_SECONDS = 15;
let _lastLobbyResults: PublicLobbyInfo[] = [];

// ── Online Play state ───────────────────────────────────
let currentOnlineMatch: OnlineMatch | null = null;
let queueTimerInterval: ReturnType<typeof setInterval> | null = null;
let queueStartTime: number = 0;
let acceptTimerInterval: ReturnType<typeof setInterval> | null = null;
let acceptTimeLeft: number = 10;

// ── Queue Timer ─────────────────────────────────────────
function startQueueTimer(): void {
  queueStartTime = Date.now();
  queueTimerInterval = setInterval(() => {
    const elapsed: number = Math.floor((Date.now() - queueStartTime) / 1000);
    document.getElementById('queue-timer')!.textContent = formatTime(elapsed);
  }, 1000);
}

// ── Enable/disable online button based on auth ──────────
function updateOnlineButton(): void {
  const btn: HTMLElement | null = document.getElementById('btn-online');
  const inviteBtn: HTMLElement | null = document.getElementById('btn-invite');
  const hint: HTMLElement | null = document.getElementById('sign-in-to-play');
  // Casual matchmaking is open to all users (including anonymous)
  // Invite/lobby requires a real account
  if (currentUid && currentUsername) {
    btn!.classList.remove('menu-btn--disabled');
    if (hint) hint.style.display = 'none';
  } else {
    btn!.classList.add('menu-btn--disabled');
    if (hint) hint.style.display = '';
  }
  if (isRealUser && currentUsername) {
    if (inviteBtn) inviteBtn.classList.remove('menu-btn--disabled');
  } else {
    if (inviteBtn) inviteBtn.classList.add('menu-btn--disabled');
  }
}

// ── Player color key ────────────────────────────────────
function getPlayerColorKey(): string {
  return localStorage.getItem('luminal-color') || DEFAULT_PLAYER_COLOR_KEY;
}

// ── Match found popup ───────────────────────────────────
function showMatchFound(match: MatchFoundData): void {
  vibrate(VIBE.matchFound);
  showScreen!('matchFound');
  const oppNameEl = document.getElementById('match-opponent-name')!;
  oppNameEl.textContent = match.opponents.map(o => o.name || 'Opponent').join(', ');
  if (_onProfileClick && match.opponents.length === 1 && match.opponents[0].uid) {
    const oppUid = match.opponents[0].uid;
    oppNameEl.style.cursor = 'pointer';
    oppNameEl.onclick = (e) => { e.stopPropagation(); playUiBlip(); _onProfileClick!(oppUid); };
  } else {
    oppNameEl.style.cursor = '';
    oppNameEl.onclick = null;
  }
  document.getElementById('match-accept-status')!.textContent = '';
  document.getElementById('match-accept-timer')!.textContent = '10';
  const acceptBtn: HTMLElement = document.getElementById('btn-match-accept')!;
  acceptBtn.textContent = 'ACCEPT';
  acceptBtn.classList.remove('menu-btn--accepted');
  _setCurrentScreen!('matchFound'); _setFocusIndex!(0); updateFocus!();

  playUiMatchFound();

  const arc: HTMLElement = document.getElementById('match-accept-arc')!;
  const circumference: number = 452.389;
  (arc as HTMLElement).style.strokeDashoffset = '0';

  acceptTimeLeft = 10;
  let accepted: boolean = false;
  let matchStarted: boolean = false;

  // Clean up any previous match session
  if (currentOnlineMatch) { currentOnlineMatch.stop(); currentOnlineMatch = null; }

  acceptTimerInterval = setInterval(() => {
    acceptTimeLeft--;
    document.getElementById('match-accept-timer')!.textContent = String(Math.max(0, acceptTimeLeft));
    (arc as HTMLElement).style.strokeDashoffset = String(circumference * (1 - Math.max(0, acceptTimeLeft) / 10));
    if (acceptTimeLeft > 0) playTick!();

    if (acceptTimeLeft <= 0 && !matchStarted) {
      clearInterval(acceptTimerInterval!);
      // Double-check game isn't already running (countdown may have fired between ticks)
      if (game.state === 'countdown' || game.state === 'playing' || game.state === 'transition' || game.state === 'waitingOnline') {
        matchStarted = true;
        return;
      }
      if (currentOnlineMatch) { currentOnlineMatch.stop(); currentOnlineMatch = null; }

      if (accepted) {
        // We accepted but opponent(s) didn't — remove all their queue docs
        for (const opp of match.opponents) removeFromQueue(opp.uid).catch(() => {});
        document.getElementById('match-accept-status')!.textContent = 'OPPONENT DID NOT ACCEPT';
        document.getElementById('match-accept-timer')!.textContent = '';
        setTimeout(async () => {
          showScreen!('queue');
          _setCurrentScreen!('queue'); _setFocusIndex!(0); updateFocus!();
          // Re-enter queue — set callbacks before entering
          startQueueTimer();
          const matchHandler = (m: MatchFoundData): void => { clearInterval(queueTimerInterval!); showMatchFound(m); };
          onMatchFound(matchHandler);
          listenForMatch(currentUid!, matchHandler);
          await enterQueue(currentUid!, currentUsername!, getPlayerColorKey(), getSelectedMap());
        }, 2000);
      } else if (game.state !== 'countdown' && game.state !== 'playing') {
        // Didn't accept — fully leave queue and boot back to online screen
        leaveQueue(currentUid!).catch(() => {});
        showScreen!('online');
        _setCurrentScreen!('online'); _setFocusIndex!(0); updateFocus!();
      }
    }
  }, 1000);

  // Accept button handler (fresh each time)
  const btn: HTMLElement = document.getElementById('btn-match-accept')!;
  const newBtn: HTMLElement = btn.cloneNode(true) as HTMLElement;
  btn.parentNode!.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', async () => {
    if (accepted) return;
    accepted = true;
    newBtn.textContent = 'ACCEPTED';
    newBtn.classList.add('menu-btn--accepted');
    document.getElementById('match-accept-status')!.textContent = 'WAITING FOR OPPONENT...';

    currentOnlineMatch = new OnlineMatch(match, currentUid!, game);
    currentOnlineMatch.onStateChange = (state: string, data?: unknown): void => {
      matchStarted = true; // any state transition means match is live — protect from timer expiry
      handleOnlineStateChange(state, data);
    };
    currentOnlineMatch.start();
    await currentOnlineMatch.accept();
  });
}

// ── Online state change handler (thin dispatcher) ───────
function handleOnlineStateChange(state: string, data?: unknown): void {
  dispatchOnlineState(state, data);
}

// ── Open Lobbies: render ────────────────────────────────
function _renderLobbyRows(lobbies: PublicLobbyInfo[]): void {
  const rows = document.getElementById('open-lobbies-rows')!;
  const empty = document.getElementById('open-lobbies-empty')!;
  const countEl = document.getElementById('open-lobbies-count')!;

  rows.innerHTML = '';
  if (lobbies.length === 0) {
    empty.classList.remove('hidden');
    countEl.textContent = '0 LOBBIES';
    return;
  }
  empty.classList.add('hidden');
  countEl.textContent = `${lobbies.length} ${lobbies.length === 1 ? 'LOBBY' : 'LOBBIES'}`;

  for (const lobby of lobbies) {
    const series = lobby.seriesLength === 1 ? 'BO1' : `BO${lobby.seriesLength}`;
    const canJoin = isRealUser || lobby.allowAnonymous;
    const isActive = lobby.status === 'active';
    const btnLabel = !canJoin ? 'SIGN IN TO JOIN' : isActive ? 'SPECTATE' : 'JOIN';

    const row = document.createElement('div');
    row.className = 'open-lobbies-row';
    row.tabIndex = 0;
    row.setAttribute('data-lobby-id', lobby.lobbyId);
    row.innerHTML = `
      <div>
        <div class="open-lobbies-row__host">${escapeHtml(lobby.hostName)}</div>
        <div class="open-lobbies-row__info">${series} · ${lobby.playerCount}/${lobby.lobbySize} PLAYERS${isActive ? ' · IN MATCH' : ''}</div>
      </div>
      <button class="open-lobbies-row__join${canJoin ? '' : ' open-lobbies-row__join--disabled'}${isActive ? ' open-lobbies-row__join--spectate' : ''}"
        ${canJoin ? '' : 'disabled'}>${btnLabel}</button>
    `;

    if (canJoin) {
      const joinBtn = row.querySelector('.open-lobbies-row__join')!;
      const handler = () => _joinOpenLobby(lobby.lobbyId);
      joinBtn.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
      });
    }

    rows.appendChild(row);
  }
}

// ── Open Lobbies: fetch and poll ────────────────────────
async function _fetchAndRenderLobbies(): Promise<void> {
  try {
    _lastLobbyResults = await fetchPublicLobbies();
    _renderLobbyRows(_lastLobbyResults);
    const badge = document.getElementById('open-lobbies-badge');
    if (badge) badge.textContent = String(_lastLobbyResults.length);
  } catch (err) {
    net.warn('onlineUI: fetchPublicLobbies failed — user can manually refresh', err);
  }
}

function _startLobbyPoll(): void {
  _stopLobbyPoll();
  _lobbyCountdown = LOBBY_POLL_SECONDS;
  _updateCountdownLabel();

  _lobbyPollInterval = setInterval(() => {
    _fetchAndRenderLobbies();
    _lobbyCountdown = LOBBY_POLL_SECONDS;
  }, LOBBY_POLL_SECONDS * 1000);

  _lobbyCountdownInterval = setInterval(() => {
    _lobbyCountdown = Math.max(0, _lobbyCountdown - 1);
    _updateCountdownLabel();
  }, 1000);
}

function _stopLobbyPoll(): void {
  if (_lobbyPollInterval) { clearInterval(_lobbyPollInterval); _lobbyPollInterval = null; }
  if (_lobbyCountdownInterval) { clearInterval(_lobbyCountdownInterval); _lobbyCountdownInterval = null; }
}

function _updateCountdownLabel(): void {
  const el = document.getElementById('open-lobbies-timer');
  if (el) el.textContent = `REFRESH IN ${_lobbyCountdown}s`;
}

function _manualRefresh(): void {
  _lobbyCountdown = LOBBY_POLL_SECONDS;
  _fetchAndRenderLobbies();
  if (_lobbyPollInterval) {
    clearInterval(_lobbyPollInterval);
    _lobbyPollInterval = setInterval(() => {
      _fetchAndRenderLobbies();
      _lobbyCountdown = LOBBY_POLL_SECONDS;
    }, LOBBY_POLL_SECONDS * 1000);
  }
}

// ── Open Lobbies: toggle and join ───────────────────────
function _toggleLobbies(): void {
  const btn = document.getElementById('btn-open-lobbies')!;
  const list = document.getElementById('open-lobbies-list')!;

  _lobbiesExpanded = !_lobbiesExpanded;

  if (_lobbiesExpanded) {
    btn.classList.add('online-option--expanded');
    list.classList.remove('hidden');
    _fetchAndRenderLobbies();
    _startLobbyPoll();
    requestAnimationFrame(() => {
      const first = list.querySelector<HTMLElement>('.open-lobbies-row');
      if (first) first.focus();
    });
  } else {
    btn.classList.remove('online-option--expanded');
    list.classList.add('hidden');
    _stopLobbyPoll();
  }
}

function _collapseLobbies(): boolean {
  if (!_lobbiesExpanded) return false;
  _lobbiesExpanded = false;
  const btn = document.getElementById('btn-open-lobbies')!;
  const list = document.getElementById('open-lobbies-list')!;
  btn.classList.remove('online-option--expanded');
  list.classList.add('hidden');
  _stopLobbyPoll();
  btn.focus();
  return true;
}

/** Attempt to collapse the lobby list. Returns true if it was expanded and collapsed. */
export function tryCollapseOpenLobbies(): boolean {
  return _collapseLobbies();
}

function _joinOpenLobby(lobbyId: string): void {
  if (!currentUid || !currentUsername) return;
  _collapseLobbies();
  // Delegate to lobbyUI's full join flow (listener setup, color resolution, localStorage, etc.)
  joinLobbyById(lobbyId);
}

// ── Init (wire up event listeners) ──────────────────────
export function initOnlineUI(deps: OnlineUIDeps): void {
  game = deps.game;
  currentUid = deps.currentUid;
  currentUsername = deps.currentUsername;
  isRealUser = deps.isRealUser;
  showScreen = deps.showScreen;
  _setCurrentScreen = deps.setCurrentScreen;
  updateFocus = deps.updateFocus;
  _setFocusIndex = deps.setFocusIndex;
  playTick = deps.playTick;
  _restoreChatAfterMatch = deps.restoreChatAfterMatch;
  _destroyMatchChat = deps.destroyMatchChat;
  _restoreBgMode = deps.restoreBgMode;
  _setLobbyMatchStarting = deps.setLobbyMatchStarting;

  const getOnlineMatch = (): OnlineMatch | null => currentOnlineMatch;
  const setOnlineMatch = (m: OnlineMatch | null): void => { currentOnlineMatch = m; };

  // Initialize the state-handler module with accessors/deps
  initOnlineUIStates({
    game,
    getCurrentUid: () => currentUid,
    getCurrentUsername: () => currentUsername,
    getCurrentOnlineMatch: getOnlineMatch,
    setCurrentOnlineMatch: setOnlineMatch,
    getAcceptTimerInterval: () => acceptTimerInterval,
    showScreen: deps.showScreen,
    setCurrentScreen: deps.setCurrentScreen,
    updateControlUI: deps.updateControlUI,
    hideChatForMatch: deps.hideChatForMatch,
    initMatchChat: deps.initMatchChat,
    destroyMatchChat: deps.destroyMatchChat,
    restoreChatAfterMatch: deps.restoreChatAfterMatch,
    restoreBgMode: deps.restoreBgMode,
    hideDynBack: deps.hideDynBack,
    clearNavStack: deps.clearNavStack,
    setLobbyMatchStarting: deps.setLobbyMatchStarting,
  });

  // btn-online click is handled in main.js (no login gate for anon users)

  // Delegate all event-listener wiring to the bindings module
  wireOnlineUIBindings({
    game,
    getCurrentUid: () => currentUid,
    getCurrentUsername: () => currentUsername,
    getCurrentOnlineMatch: getOnlineMatch,
    setCurrentOnlineMatch: setOnlineMatch,
    getPlayerColorKey,
    showMatchFound,
    startQueueTimer,
    getQueueTimerInterval: () => queueTimerInterval,
    navigateTo: deps.navigateTo,
    navigateBack: deps.navigateBack,
    setCurrentScreen: deps.setCurrentScreen,
    setFocusIndex: deps.setFocusIndex,
    updateFocus: deps.updateFocus,
    ensureAudio: deps.ensureAudio,
    restoreBgMode: deps.restoreBgMode,
    restoreChatAfterMatch: deps.restoreChatAfterMatch,
    destroyMatchChat: deps.destroyMatchChat,
    setLobbyMatchStarting: deps.setLobbyMatchStarting,
    fetchAndRenderLobbies: _fetchAndRenderLobbies,
    toggleLobbies: _toggleLobbies,
    manualRefreshLobbies: _manualRefresh,
    collapseLobbies: _collapseLobbies,
  });
}

// ── Exported getters / setters ──────────────────────────
export function getCurrentOnlineMatch(): OnlineMatch | null {
  return currentOnlineMatch;
}

export function setCurrentOnlineMatch(match: OnlineMatch | null): void {
  currentOnlineMatch = match;
}

export function updateCurrentUser(uid: string | null, username: string | null, real?: boolean): void {
  currentUid = uid;
  currentUsername = username;
  if (real !== undefined) isRealUser = real;
  updateOnlineButton();
}

/** Forfeit the current online match — reports own death, cleans up, returns to menu. */
export function forfeitOnlineMatch(): void {
  if (currentOnlineMatch) {
    // Report self as dead so opponent gets the win
    currentOnlineMatch.reportLocalDeath(currentOnlineMatch.myUid);
    currentOnlineMatch.stop();
    currentOnlineMatch = null;
  }
  game.mode = 'local';
  game._onlineMatch = null;
  game._fading = false;
  game.seriesLength = 1;
  _setLobbyMatchStarting!(false);

  // Full UI reset
  document.getElementById('btn-online-next')!.style.display = 'none';
  document.getElementById('btn-online-rematch')!.style.display = 'none';
  document.getElementById('btn-online-leave')!.style.display = 'none';
  document.getElementById('btn-return-lobby-pause')!.style.display = 'none';
  document.getElementById('btn-return-lobby-result')!.style.display = 'none';
  document.getElementById('online-next-timer')!.style.display = 'none';
  document.getElementById('series-score')!.classList.add('hidden');
  document.getElementById('pregame-screen')!.classList.add('hidden');
  document.getElementById('countdown')!.classList.add('hidden');
  document.getElementById('result-buttons')!.style.display = '';
  document.getElementById('meter-wrap')!.classList.add('menu-hidden');
  document.getElementById('radar')!.classList.add('hidden');
  document.getElementById('match-timer')!.classList.add('hidden');
  document.getElementById('streak-display')!.classList.add('hidden');
  document.getElementById('scene-fade')!.classList.remove('scene-fade--active');

  _destroyMatchChat!();
  game.returnToMenu(); _restoreBgMode!(); _restoreChatAfterMatch!();
  _setCurrentScreen!('main'); _setFocusIndex!(0); updateFocus!();
}

export { handleOnlineStateChange, showMatchFound, getPlayerColorKey };
