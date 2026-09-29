// ── Lobby Chat state, badge, rendering, send ────────────
import { show, hide, escapeHtml } from '../dom';
import { ref, onValue as rtdbOnValue, off as rtdbOff, push as rtdbPush, DatabaseReference } from 'firebase/database';
import { rtdb as rtdbInstance } from '../../firebase';
import { swallow } from '../../swallow';
import { iconHtml } from './chatIcons';

// ── Match chat message shape ────────────────────────────
interface MatchChatMsg {
  uid?: string;
  username: string;
  text: string;
  ts: number;
  system?: boolean;
  icon?: string;
}

// ── State ────────────────────────────────────────────────
let _lobbyChatActive: boolean = false;
let _lobbyChatMessages: MatchChatMsg[] = [];
let _lobbyChatUnread: number = 0;
let _lobbyChatListenerRef: DatabaseReference | null = null;
let _lobbyChatLobbyId: string | null = null;
let _lobbyChatPrevCount: number = 0;

// ── External dependencies injected at init ──────────────
let _switchChatTabFn: ((tab: string) => void) | null = null;
let _getMatchChatTab: (() => string) | null = null;
let _getCurrentUid: (() => string | null) | null = null;
let _getCurrentUsername: (() => string | null) | null = null;
let _getCurrentIcon: (() => string | null) | null = null;
let _applyChatVisibilityFn: (() => void) | null = null;

export function initLobbyChatDeps(deps: {
  switchChatTab: (tab: string) => void;
  getMatchChatTab: () => string;
  getCurrentUid: () => string | null;
  getCurrentUsername: () => string | null;
  getCurrentIcon: () => string | null;
  applyChatVisibility: () => void;
}): void {
  _switchChatTabFn = deps.switchChatTab;
  _getMatchChatTab = deps.getMatchChatTab;
  _getCurrentUid = deps.getCurrentUid;
  _getCurrentUsername = deps.getCurrentUsername;
  _getCurrentIcon = deps.getCurrentIcon;
  _applyChatVisibilityFn = deps.applyChatVisibility;
}

// ── Accessors ───────────────────────────────────────────
export function isLobbyChatActive(): boolean { return _lobbyChatActive; }
export function setLobbyUnread(n: number): void { _lobbyChatUnread = n; }

// ── Lobby Chat Badge ────────────────────────────────────
export function updateLobbyChatBadge(): void {
  const badge: HTMLElement | null = document.getElementById('chat-tab-lobby-badge');
  if (!badge) return;
  const tab = _getMatchChatTab?.() || 'global';
  if (_lobbyChatUnread > 0 && tab !== 'lobby') {
    badge.textContent = `(${_lobbyChatUnread > 99 ? '99+' : _lobbyChatUnread})`;
    show(badge);
  } else {
    hide(badge);
  }
}

// ── Render Lobby Chat ────────────────────────────────────
export function renderLobbyChat(): void {
  const container: HTMLElement = document.getElementById('chat-messages-lobby')!;
  container.innerHTML = `<div class="chat-msg-system">Party chat</div>`;
  for (const msg of _lobbyChatMessages) {
    const div: HTMLDivElement = document.createElement('div');
    if (msg.system) {
      div.className = 'chat-msg-system';
      div.textContent = msg.text;
    } else {
      div.innerHTML = `${iconHtml(msg.icon)}<span class="chat-msg-user">${escapeHtml(msg.username)}:</span>${escapeHtml(msg.text)}`;
    }
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

// ── Send Lobby Chat ──────────────────────────────────────
export function sendLobbyChat(text: string): void {
  const uid = _getCurrentUid?.();
  const username = _getCurrentUsername?.();
  const icon = _getCurrentIcon?.();
  if (!_lobbyChatLobbyId || !uid || !username) return;
  const chatRef: DatabaseReference = ref(rtdbInstance, `lobbies/${_lobbyChatLobbyId}/chat`);
  rtdbPush(chatRef, { uid, username, text, ts: Date.now(), ...(icon ? { icon } : {}) }).catch(swallow('chat'));
}

// ── Start / Stop Lobby Chat ──────────────────────────────
export function startLobbyChat(lobbyId: string): void {
  stopLobbyChat(); // clean up any previous
  _lobbyChatActive = true;
  _lobbyChatLobbyId = lobbyId;
  _lobbyChatMessages = [];
  _lobbyChatUnread = 0;
  _lobbyChatPrevCount = 0;

  // Force chat visible when joining a party
  localStorage.setItem('luminal-chat-visible', 'true');
  _applyChatVisibilityFn?.();

  // Show tab
  const tabEl: HTMLElement = document.getElementById('chat-tab-lobby')!;
  tabEl.childNodes[0].textContent = 'PARTY ';
  show(tabEl);
  _switchChatTabFn?.('lobby');

  // System message
  const container: HTMLElement = document.getElementById('chat-messages-lobby')!;
  container.innerHTML = `<div class="chat-msg-system">Party chat</div>`;

  // Listen to lobby chat in RTDB
  _lobbyChatListenerRef = ref(rtdbInstance, `lobbies/${lobbyId}/chat`);
  rtdbOnValue(_lobbyChatListenerRef, (snap) => {
    const val: Record<string, MatchChatMsg> | null = snap.val();
    const msgs: MatchChatMsg[] = val ? (Object.values(val) as MatchChatMsg[]).sort((a: MatchChatMsg, b: MatchChatMsg) => a.ts - b.ts) : [];
    _lobbyChatMessages = msgs;
    renderLobbyChat();
    // Track unread only for NEW messages
    const tab = _getMatchChatTab?.() || 'global';
    if (msgs.length > _lobbyChatPrevCount && tab !== 'lobby') {
      _lobbyChatUnread += msgs.length - _lobbyChatPrevCount;
      updateLobbyChatBadge();
    }
    _lobbyChatPrevCount = msgs.length;
  });
}

export function stopLobbyChat(): void {
  if (!_lobbyChatActive) return;
  _lobbyChatActive = false;
  _lobbyChatLobbyId = null;
  _lobbyChatMessages = [];
  _lobbyChatUnread = 0;
  _lobbyChatPrevCount = 0;
  hide('chat-tab-lobby');
  hide('chat-tab-lobby-badge');
  document.getElementById('chat-messages-lobby')!.innerHTML = '';
  if (_lobbyChatListenerRef) { rtdbOff(_lobbyChatListenerRef); _lobbyChatListenerRef = null; }
  const tab = _getMatchChatTab?.() || 'global';
  if (tab === 'lobby') _switchChatTabFn?.('global');
}
