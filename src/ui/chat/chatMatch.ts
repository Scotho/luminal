// ── Match Chat state, badge, rendering, send, detach ────
import { show, hide, escapeHtml } from '../dom';
import { ref, onValue as rtdbOnValue, off as rtdbOff, push as rtdbPush, DatabaseReference } from 'firebase/database';
import { rtdb as rtdbInstance } from '../../firebase';
import { playChat } from '../../sfx';
import { TOUCH_ENABLED } from '../../input';
import { swallow } from '../../swallow';
import { iconHtml } from './chatIcons';
import { makeDraggable } from '../draggable';

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
let _matchChatActive: boolean = false;
let _matchChatTab: string = 'global';
let _matchMessages: MatchChatMsg[] = [];
let _matchChatUnread: number = 0;
let _matchChatListenerRef: DatabaseReference | null = null;
let _matchChatMatchId: string | null = null;
let _matchChatPrevCount: number = 0;

// ── Detached state ──────────────────────────────────────
let _matchChatDetached: boolean = false;
let _matchChatOpponentName: string = '';
let _matchChatDragSetUp: boolean = false;

// ── External dependencies injected at init ──────────────
let _switchChatTabFn: ((tab: string) => void) | null = null;
let _getCurrentUid: (() => string | null) | null = null;
let _getCurrentUsername: (() => string | null) | null = null;
let _getCurrentIcon: (() => string | null) | null = null;

export function initMatchChatDeps(deps: {
  switchChatTab: (tab: string) => void;
  getCurrentUid: () => string | null;
  getCurrentUsername: () => string | null;
  getCurrentIcon: () => string | null;
  getMakeDraggable: () => unknown; // kept for API compat, no longer used
}): void {
  _switchChatTabFn = deps.switchChatTab;
  _getCurrentUid = deps.getCurrentUid;
  _getCurrentUsername = deps.getCurrentUsername;
  _getCurrentIcon = deps.getCurrentIcon;
}

// ── Accessors ───────────────────────────────────────────
export function isMatchChatActive(): boolean { return _matchChatActive; }
export function isMatchChatDetached(): boolean { return _matchChatDetached; }
export function getMatchChatTab(): string { return _matchChatTab; }
export function setMatchChatTab(tab: string): void { _matchChatTab = tab; }
export function setMatchChatUnread(n: number): void { _matchChatUnread = n; }
export function getMatchChatOpponentName(): string { return _matchChatOpponentName; }

// ── Match Chat Badge ────────────────────────────────────
export function updateMatchChatBadge(): void {
  const badge: HTMLElement | null = document.getElementById('chat-tab-match-badge');
  if (!badge) return;
  if (_matchChatUnread > 0 && _matchChatTab !== 'match') {
    badge.textContent = `(${_matchChatUnread > 99 ? '99+' : _matchChatUnread})`;
    show(badge);
  } else {
    hide(badge);
  }
}

// ── Render Match Chat ────────────────────────────────────
export function renderMatchChat(opponentName: string): void {
  const container: HTMLElement = document.getElementById('chat-messages-match')!;
  container.innerHTML = `<div class="chat-msg-system">Connected to ${escapeHtml(opponentName || 'opponent')}</div>`;
  for (const msg of _matchMessages) {
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
  // Also update detached window if open
  if (_matchChatDetached) renderDetachedMatchChat();
}

// ── Render Detached Match Chat ───────────────────────────
export function renderDetachedMatchChat(): void {
  if (!_matchChatDetached) return;
  const container: HTMLElement = document.getElementById('match-chat-detached-msgs')!;
  container.innerHTML = `<div class="chat-msg-system">Connected to ${escapeHtml(_matchChatOpponentName || 'opponent')}</div>`;
  for (const msg of _matchMessages) {
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

// ── Send Match Chat ──────────────────────────────────────
export function sendMatchChat(text: string): void {
  const uid = _getCurrentUid?.();
  const username = _getCurrentUsername?.();
  const icon = _getCurrentIcon?.();
  if (!_matchChatMatchId || !uid || !username) return;
  const chatRef: DatabaseReference = ref(rtdbInstance, `matches/${_matchChatMatchId}/chat`);
  rtdbPush(chatRef, { uid, username, text, ts: Date.now(), ...(icon ? { icon } : {}) }).catch(swallow('chat'));
}

export function sendMatchSystemMsg(text: string): void {
  if (!_matchChatMatchId) return;
  const chatRef: DatabaseReference = ref(rtdbInstance, `matches/${_matchChatMatchId}/chat`);
  rtdbPush(chatRef, { system: true, username: 'SYSTEM', text, ts: Date.now() }).catch(swallow('chat'));
}

// ── Start / Stop Match Chat ──────────────────────────────
export function startMatchChat(matchId: string, opponentName: string): void {
  stopMatchChat(); // clean up any previous
  _matchChatActive = true;
  _matchChatMatchId = matchId;
  _matchChatOpponentName = opponentName || 'opponent';
  _matchMessages = [];
  _matchChatUnread = 0;
  _matchChatPrevCount = 0;

  // Set tab label and show it
  const tabEl: HTMLElement = document.getElementById('chat-tab-match')!;
  tabEl.textContent = (opponentName || 'OPPONENT').toUpperCase() + ' MATCH';
  const badge: HTMLSpanElement = document.createElement('span');
  badge.className = 'chat-unread hidden';
  badge.id = 'chat-tab-match-badge';
  badge.textContent = '(0)';
  tabEl.appendChild(document.createTextNode(' '));
  tabEl.appendChild(badge);
  show(tabEl);
  _switchChatTabFn?.('match');

  // System message
  const container: HTMLElement = document.getElementById('chat-messages-match')!;
  container.innerHTML = `<div class="chat-msg-system">Connected to ${escapeHtml(opponentName || 'opponent')}</div>`;

  // Listen to match chat in RTDB
  _matchChatListenerRef = ref(rtdbInstance, `matches/${matchId}/chat`);
  rtdbOnValue(_matchChatListenerRef, (snap) => {
    const val: Record<string, MatchChatMsg> | null = snap.val();
    const msgs: MatchChatMsg[] = val ? (Object.values(val) as MatchChatMsg[]).sort((a: MatchChatMsg, b: MatchChatMsg) => a.ts - b.ts) : [];
    _matchMessages = msgs;
    renderMatchChat(opponentName);
    // Track unread only for NEW messages
    if (msgs.length > _matchChatPrevCount && _matchChatTab !== 'match') {
      _matchChatUnread += msgs.length - _matchChatPrevCount;
      updateMatchChatBadge();
      playChat();
    }
    _matchChatPrevCount = msgs.length;
  });
}

export function stopMatchChat(): void {
  if (!_matchChatActive) return;
  _matchChatActive = false;
  _matchChatMatchId = null;
  _matchMessages = [];
  _matchChatUnread = 0;
  _matchChatPrevCount = 0;
  _matchChatDetached = false;
  hide('chat-tab-match');
  hide('chat-tab-match-badge');
  document.getElementById('chat-messages-match')!.innerHTML = '';
  hide('match-chat-window');
  if (_matchChatListenerRef) { rtdbOff(_matchChatListenerRef); _matchChatListenerRef = null; }
  _switchChatTabFn?.('global');
}

// ── Detach / Dock Match Chat ─────────────────────────────
export function detachMatchChat(): void {
  if (TOUCH_ENABLED || !_matchChatActive || _matchChatDetached) return;
  _matchChatDetached = true;

  // Hide match tab in main chat, switch to global
  _switchChatTabFn?.('global');
  hide('chat-tab-match');

  // Show detached window
  const win: HTMLElement = document.getElementById('match-chat-window')!;
  show(win);
  document.getElementById('match-chat-title')!.textContent = _matchChatOpponentName.toUpperCase() + ' MATCH';
  renderDetachedMatchChat();

  // Set up drag + resize once
  if (!_matchChatDragSetUp) {
    _matchChatDragSetUp = true;
    makeDraggable(win, win.querySelector('.match-chat-header') as HTMLElement, { saveKey: 'luminal-match-chat-pos', topMin: 36 });
    const resizeH: HTMLElement = document.getElementById('match-chat-resize')!;
    let resizing: boolean = false;
    resizeH.addEventListener('mousedown', (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); resizing = true; });
    window.addEventListener('mousemove', (e: MouseEvent) => { if (!resizing) return; const wr: DOMRect = win.getBoundingClientRect(); win.style.width = Math.max(200, e.clientX - wr.left) + 'px'; win.style.height = Math.max(80, e.clientY - wr.top) + 'px'; });
    window.addEventListener('mouseup', () => { resizing = false; });
  }
}

export function dockMatchChat(): void {
  if (!_matchChatDetached) return;
  _matchChatDetached = false;
  hide('match-chat-window');
  if (_matchChatActive) {
    show('chat-tab-match');
    _switchChatTabFn?.('match');
  }
}

// ── Countdown tick (local only) ─────────────────────────
export function appendCountdownTick(num: number): void {
  if (!_matchChatActive) return;
  const container: HTMLElement = document.getElementById('chat-messages-match')!;
  const div: HTMLDivElement = document.createElement('div');
  div.className = 'chat-msg-system';
  div.textContent = num === 0 ? '▸ GO!' : `${num}...`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}
