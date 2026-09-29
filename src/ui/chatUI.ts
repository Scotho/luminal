// ── Chat UI — Coordinator ───────────────────────────────
// Slim coordinator that delegates to focused chat modules.
import { show, hide, toggleVisible } from './dom';
import { sendMessage } from '../chat';
import { TOUCH_ENABLED } from '../input';
import { makeDraggable } from './draggable';
import { DisposableBag } from '../disposables';
import { playUiTab } from '../sfx';

const _chatBag = new DisposableBag();

// ── Module imports ──────────────────────────────────────
import { setupGlobalChatListener, updateChatBadge, setIsInGame, getIsInGame, setGlobalUnread } from './chat/chatGlobal';
import {
  initMatchChatDeps, startMatchChat, stopMatchChat, renderDetachedMatchChat,
  sendMatchChat, sendMatchSystemMsg as _sendMatchSystemMsg, isMatchChatActive as _isMatchChatActive,
  isMatchChatDetached, getMatchChatTab, setMatchChatTab, setMatchChatUnread,
  getMatchChatOpponentName, updateMatchChatBadge, detachMatchChat, dockMatchChat, appendCountdownTick as _appendCountdownTick,
} from './chat/chatMatch';
import {
  initLobbyChatDeps, startLobbyChat as _startLobbyChat, stopLobbyChat as _stopLobbyChat,
  isLobbyChatActive, updateLobbyChatBadge, sendLobbyChat, setLobbyUnread,
} from './chat/chatLobby';
import {
  initDmChatDeps, startDmChat as _startDmChat,
  updateDmOnlineStatuses as _updateDmOnlineStatuses, sendDmChat, getActiveDmUid,
  getDmChats, hasDmChat, switchDmTabs,
} from './chat/chatDm';

const _chatDisabled = false;

// ── Init dependencies ────────────────────────────────────
interface ChatUIDeps {
  currentUid: string | null;
  currentUsername: string | null;
  isRealUser: boolean;
}

// ── Shared state (injected via initChatUI) ───────────────
let _currentUid: string | null = null;
let _currentUsername: string | null = null;
let _currentIcon: string | null = null;

// ── Chat visibility state ───────────────────────────────
let _chatPositioned: boolean = false;
let _chatSending: boolean = false;
let _debugLogModulePromise: Promise<typeof import('../debugLog')> | null = null;

// ── Chat Visibility Helpers ──────────────────────────────
function _setChatDefault(): void {
  const chatEl: HTMLElement = document.getElementById('global-chat')!;
  chatEl.style.left = '14px';
  chatEl.style.bottom = '14px';
  chatEl.style.top = 'auto';
  chatEl.style.transform = 'none';
  chatEl.style.height = '';
}

function _applyChatPosition(): void {
  if (TOUCH_ENABLED) return;
  const chatEl: HTMLElement = document.getElementById('global-chat')!;
  const saved: string | null = localStorage.getItem('luminal-chat-pos');
  if (saved) {
    try {
      const { x, y, w, h }: { x: number; y: number; w?: number; h?: number } = JSON.parse(saved);
      const maxX: number = window.innerWidth - chatEl.offsetWidth;
      const maxY: number = window.innerHeight - 40;
      chatEl.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
      chatEl.style.top = Math.max(36, Math.min(y, maxY)) + 'px';
      chatEl.style.bottom = 'auto';
      chatEl.style.transform = 'none';
      if (w) chatEl.style.width = Math.max(200, w) + 'px';
      if (h) chatEl.style.height = Math.max(80, h) + 'px';
    } catch { _setChatDefault(); }
  } else {
    _setChatDefault();
  }
}

function _applyChatVisibility(): void {
  const chatEl: HTMLElement = document.getElementById('global-chat')!;
  show(chatEl);
  setGlobalUnread(0);
  updateChatBadge();
  if (!_chatPositioned) {
    _applyChatPosition();
    _chatPositioned = true;
  }
}

// ── Chat Tab Switching ──────────────────────────────────
function _switchChatTab(tab: string): void {
  playUiTab();
  setMatchChatTab(tab);
  for (const id of ['chat-tab-global', 'chat-tab-match', 'chat-tab-lobby'] as const) {
    const el = document.getElementById(id);
    if (!el) continue;
    const tabKey = id.replace('chat-tab-', '');
    const isActive = tabKey === tab;
    el.classList.toggle('chat-tab--active', isActive);
    el.setAttribute('aria-selected', String(isActive));
    el.tabIndex = isActive ? 0 : -1;
  }
  toggleVisible('chat-messages', tab === 'global');
  toggleVisible('chat-messages-match', tab === 'match');
  toggleVisible('chat-messages-lobby', tab === 'lobby');
  if (tab === 'match') { setMatchChatUnread(0); updateMatchChatBadge(); }
  if (tab === 'lobby') { setLobbyUnread(0); updateLobbyChatBadge(); }
  if (tab === 'global') { setGlobalUnread(0); updateChatBadge(); }

  // DM tabs
  switchDmTabs(tab);
}

// ── Debug Log Paste (local-only) ─────────────────────────
function _pasteDebugLog(log: string): void {
  const matchActive = _isMatchChatActive();
  const lobbyActive = isLobbyChatActive();
  const tab = getMatchChatTab();
  const containerId = (matchActive && tab === 'match') ? 'chat-messages-match'
    : (lobbyActive && tab === 'lobby') ? 'chat-messages-lobby'
    : 'chat-messages';
  const container: HTMLElement | null = document.getElementById(containerId);
  if (!container) return;

  for (const line of log.split('\n')) {
    const div: HTMLDivElement = document.createElement('div');
    div.className = 'chat-msg-system';
    div.style.fontFamily = 'monospace';
    div.style.fontSize = '10px';
    div.style.opacity = '0.85';
    div.textContent = line;
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

async function _loadDebugLogModule(): Promise<typeof import('../debugLog') | null> {
  if (import.meta.env.MODE !== 'development') return null;
  _debugLogModulePromise ??= import('../debugLog');
  return _debugLogModulePromise;
}

// ── Send Global / Routed Chat ───────────────────────────
async function sendChatMessage(): Promise<void> {
  if (_chatSending) return;
  const input: HTMLInputElement = document.getElementById('chat-input') as HTMLInputElement;
  const text: string = input.value.trim();
  if (!text || !_currentUid || !_currentUsername) return;

  // Slash commands
  if (text === '/log' || text === '/gfx') {
    input.value = '';
    const debugLog = await _loadDebugLogModule();
    if (!debugLog) {
      _pasteDebugLog('Local build only.');
      return;
    }
    const log = text === '/log' ? debugLog.getNetLog() : debugLog.getGfxLog();
    _pasteDebugLog(log);
    return;
  }

  _chatSending = true;
  const tab = getMatchChatTab();
  const activeDm = getActiveDmUid();
  if (_isMatchChatActive() && tab === 'match') {
    sendMatchChat(text);
    input.value = '';
  } else if (isLobbyChatActive() && tab === 'lobby') {
    sendLobbyChat(text);
    input.value = '';
  } else if (activeDm && hasDmChat(activeDm)) {
    sendDmChat(activeDm, text);
    input.value = '';
  } else {
    const result: { ok?: boolean; error?: string } = await sendMessage(_currentUid, _currentUsername, text, _currentIcon || undefined);
    if (result.ok) input.value = '';
  }
  _chatSending = false;
}

// ── Hide / Restore for Match ─────────────────────────────
export function _hideChatForMatch(): void {
  if (_chatDisabled) return;
  setIsInGame(true);
  const chatEl: HTMLElement = document.getElementById('global-chat')!;
  chatEl.classList.add('chat--match-hidden');
}

export function _restoreChatAfterMatch(): void {
  if (_chatDisabled) return;
  setIsInGame(false);
  const chatEl: HTMLElement = document.getElementById('global-chat')!;
  chatEl.classList.remove('chat--match-hidden');
  _applyChatVisibility();
}

/** Show chat during gameplay (Enter key) and focus input. */
export function showChatInMatch(): void {
  if (_chatDisabled) return;
  const chatEl: HTMLElement = document.getElementById('global-chat')!;
  show(chatEl);
  chatEl.classList.remove('chat--match-hidden');
  setGlobalUnread(0);
  updateChatBadge();
  if (!_chatPositioned) { _applyChatPosition(); _chatPositioned = true; }
  const input: HTMLInputElement = document.getElementById('chat-input') as HTMLInputElement;
  if (!input.disabled) input.focus();
}

// ── Update Online UI ─────────────────────────────────────
export function updateOnlineUI(): void {
  if (_chatDisabled) return;
  _applyChatVisibility();
  updateChatBadge();
}

// ── Public Accessors ─────────────────────────────────────
export function isMatchChatActive(): boolean { return _isMatchChatActive(); }

export function appendCountdownTick(num: number): void {
  if (_chatDisabled) return;
  _appendCountdownTick(num);
}

export function sendMatchSystemMsg(text: string): void {
  if (_chatDisabled) return;
  _sendMatchSystemMsg(text);
}

// ── Exported Match Chat Lifecycle ────────────────────────
export function _initMatchChat(matchId: string, opponentName: string): void {
  if (_chatDisabled) return;
  startMatchChat(matchId, opponentName);
}

export function _destroyMatchChat(): void {
  if (_chatDisabled) return;
  stopMatchChat();
}

// ── Exported Lobby Chat Lifecycle ────────────────────────
export function initLobbyChat(lobbyId: string): void {
  if (_chatDisabled) return;
  _startLobbyChat(lobbyId);
}

export function destroyLobbyChat(): void {
  if (_chatDisabled) return;
  _stopLobbyChat();
}

// ── Exported DM Lifecycle ────────────────────────────────
export function startDmChat(friendUid: string, friendUsername: string): void {
  if (_chatDisabled) return;
  _startDmChat(friendUid, friendUsername);
}

export function updateDmOnlineStatuses(onlineMap: Map<string, boolean>): void {
  _updateDmOnlineStatuses(onlineMap);
}

// ── Update Current User ──────────────────────────────────
export function updateCurrentUser(uid: string | null, username: string | null, _isReal: boolean, icon?: string | null): void {
  _currentUid = uid;
  _currentUsername = username;
  _currentIcon = icon || null;
}

// ── Init ─────────────────────────────────────────────────
export function initChatUI({ currentUid, currentUsername, isRealUser: _isRealUser }: ChatUIDeps): void {
  _chatBag.reset(); // tear down any previous init listeners
  _currentUid = currentUid;
  _currentUsername = currentUsername;

  // Wire up module dependencies
  const sharedGetters = {
    getCurrentUid: () => _currentUid,
    getCurrentUsername: () => _currentUsername,
    getCurrentIcon: () => _currentIcon,
  };

  initMatchChatDeps({
    switchChatTab: _switchChatTab,
    ...sharedGetters,
    getMakeDraggable: () => makeDraggable,
  });

  initLobbyChatDeps({
    switchChatTab: _switchChatTab,
    getMatchChatTab,
    ...sharedGetters,
    applyChatVisibility: _applyChatVisibility,
  });

  initDmChatDeps({
    switchChatTab: _switchChatTab,
    ...sharedGetters,
    applyChatVisibility: _applyChatVisibility,
  });

  // ── Global message listener ────────────────────────────
  setupGlobalChatListener();

  // Chat is always visible in menus
  _applyChatVisibility();

  // ── Match Chat Tab listeners ───────────────────────────
  const _tabGlobal = document.getElementById('chat-tab-global');
  if (_tabGlobal) _chatBag.addEventListener(_tabGlobal, 'click', () => _switchChatTab('global'));
  const _tabMatch = document.getElementById('chat-tab-match');
  if (_tabMatch) _chatBag.addEventListener(_tabMatch, 'click', () => {
    if (isMatchChatDetached()) return;
    _switchChatTab('match');
  });

  // Tooltip for overflowing chat tabs
  document.querySelectorAll('.chat-tab').forEach((tab: Element) => {
    _chatBag.addEventListener(tab as HTMLElement, 'mouseenter', () => {
      if (tab.scrollWidth > tab.clientWidth) {
        tab.setAttribute('data-tip', tab.textContent!.trim());
      } else {
        tab.removeAttribute('data-tip');
      }
    });
  });

  // Close match tab via X button
  const _tabMatchClose = document.getElementById('chat-tab-match-close');
  if (_tabMatchClose) _chatBag.addEventListener(_tabMatchClose, 'click', (e: Event) => {
    e.stopPropagation();
    stopMatchChat();
  });

  // ── Lobby Chat Tab listeners ──────────────────────────
  const _tabLobby = document.getElementById('chat-tab-lobby');
  if (_tabLobby) _chatBag.addEventListener(_tabLobby, 'click', () => _switchChatTab('lobby'));
  const _tabLobbyClose = document.getElementById('chat-tab-lobby-close');
  if (_tabLobbyClose) _chatBag.addEventListener(_tabLobbyClose, 'click', (e: Event) => {
    e.stopPropagation();
    _stopLobbyChat();
  });

  // ── Detached Match Chat listeners ──────────────────────
  const _btnMatchDock = document.getElementById('btn-match-chat-dock');
  if (_btnMatchDock) _chatBag.addEventListener(_btnMatchDock, 'click', dockMatchChat);

  const _btnMatchSend = document.getElementById('btn-match-chat-send');
  if (_btnMatchSend) _chatBag.addEventListener(_btnMatchSend, 'click', () => {
    const input: HTMLInputElement = document.getElementById('match-chat-input') as HTMLInputElement;
    const text: string = input.value.trim();
    if (!text) return;
    sendMatchChat(text);
    input.value = '';
  });
  const _matchChatInput = document.getElementById('match-chat-input');
  if (_matchChatInput) _chatBag.addEventListener(_matchChatInput, 'keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); document.getElementById('btn-match-chat-send')!.click(); }
  });

  // Drag match tab out to detach (desktop only)
  if (!TOUCH_ENABLED) {
    const matchTab: HTMLElement = document.getElementById('chat-tab-match')!;
    let tabDragging: boolean = false, tabStartX: number = 0, tabStartY: number = 0, detachTriggered: boolean = false;
    const win: HTMLElement = document.getElementById('match-chat-window')!;

    _chatBag.addEventListener(matchTab, 'mousedown', (e: MouseEvent) => {
      if (isMatchChatDetached() || !_isMatchChatActive()) return;
      tabDragging = true;
      detachTriggered = false;
      tabStartX = e.clientX;
      tabStartY = e.clientY;
      e.preventDefault();
    });

    _chatBag.addEventListener(window, 'mousemove', (e: MouseEvent) => {
      if (!tabDragging) return;
      const dx: number = e.clientX - tabStartX, dy: number = e.clientY - tabStartY;
      if (!detachTriggered && (Math.abs(dx) > 30 || Math.abs(dy) > 30)) {
        detachTriggered = true;
        document.getElementById('match-chat-title')!.textContent = getMatchChatOpponentName().toUpperCase() + ' MATCH';
        renderDetachedMatchChat();
        show(win);
        win.style.opacity = '0.85';
        win.style.pointerEvents = 'none';
      }
      if (detachTriggered) {
        win.style.left = (e.clientX - 160) + 'px';
        win.style.top = (e.clientY - 15) + 'px';
      }
    });

    _chatBag.addEventListener(window, 'mouseup', () => {
      if (!tabDragging) return;
      tabDragging = false;
      if (detachTriggered) {
        win.style.opacity = '';
        win.style.pointerEvents = '';
        detachMatchChat();
      }
    });

    // ── Chat drag + resize ─────────────────────────────────
    {
      const chatEl: HTMLElement = document.getElementById('global-chat')!;
      const handle: HTMLElement = document.getElementById('chat-tab-bar')!;
      const resizeH: HTMLElement = document.getElementById('chat-resize')!;
      makeDraggable(chatEl, handle, { saveKey: 'luminal-chat-pos', skipSelector: '.chat-tab-close, #chat-tab-match' });
      let resizing: boolean = false;
      _chatBag.addEventListener(resizeH, 'mousedown', (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); resizing = true; });
      _chatBag.addEventListener(window, 'mousemove', (e: MouseEvent) => {
        if (!resizing) return;
        const r: DOMRect = chatEl.getBoundingClientRect();
        chatEl.style.width = Math.max(200, e.clientX - r.left) + 'px';
        chatEl.style.height = Math.max(80, e.clientY - r.top) + 'px';
      });
      _chatBag.addEventListener(window, 'mouseup', () => { if (resizing) { resizing = false; localStorage.setItem('luminal-chat-pos', JSON.stringify({ x: parseInt(chatEl.style.left) || 0, y: parseInt(chatEl.style.top) || 0, w: chatEl.offsetWidth, h: chatEl.offsetHeight })); } });
    }
  } // end !TOUCH_ENABLED

  // ── Chat send button + input ───────────────────────────
  _chatBag.addEventListener(document.getElementById('btn-chat-send')!, 'click', sendChatMessage);
  _chatBag.addEventListener(document.getElementById('chat-input')!, 'keydown', (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); sendChatMessage(); }
  });

  // Hide chat on blur ONLY while in-game
  const _chatInputEl = document.getElementById('chat-input');
  if (_chatInputEl) _chatBag.addEventListener(_chatInputEl, 'blur', (e: FocusEvent) => {
    if (!getIsInGame()) return;
    const related: HTMLElement | null = e.relatedTarget as HTMLElement | null;
    const chatEl: HTMLElement = document.getElementById('global-chat')!;
    if (related && chatEl.contains(related)) return;
    hide(chatEl);
  });
}

// ── Reparent Chat to Social overlay ─────────────────────
export function reparentChatToSocial(target: HTMLElement): void {
  const tabBar = document.getElementById('chat-tab-bar');
  const inputRow = document.getElementById('chat-input-row');
  const globalMsgs = document.getElementById('chat-messages');
  const lobbyMsgs = document.getElementById('chat-messages-lobby');
  const matchMsgs = document.getElementById('chat-messages-match');
  if (tabBar) target.appendChild(tabBar);
  if (globalMsgs) target.appendChild(globalMsgs);
  if (lobbyMsgs) target.appendChild(lobbyMsgs);
  if (matchMsgs) target.appendChild(matchMsgs);
  // Move any existing DM containers
  for (const [, dm] of getDmChats()) {
    if (dm.containerEl) target.appendChild(dm.containerEl);
  }
  if (inputRow) target.appendChild(inputRow);

  scrollActiveChatToBottom();
}

/** Snap the currently-visible chat message container (global / lobby / match / any open DM)
 *  to its latest message. Safe to call when chat isn't mounted — no-ops cleanly. */
export function scrollActiveChatToBottom(): void {
  const globalMsgs = document.getElementById('chat-messages');
  const lobbyMsgs = document.getElementById('chat-messages-lobby');
  const matchMsgs = document.getElementById('chat-messages-match');
  for (const el of [globalMsgs, lobbyMsgs, matchMsgs]) {
    if (el && !el.classList.contains('hidden')) el.scrollTop = el.scrollHeight;
  }
  for (const [, dm] of getDmChats()) {
    if (dm.containerEl && !dm.containerEl.classList.contains('hidden')) {
      dm.containerEl.scrollTop = dm.containerEl.scrollHeight;
    }
  }
}
