// ── Global Chat state, badge, rendering, listener ───────
import { show, hide, escapeHtml } from '../dom';
import { onMessages } from '../../chat';
import { playChat } from '../../sfx';
import { resolveIconCache, getIconForMsg, iconHtml } from './chatIcons';
import type { ChatMessage } from '../../types/index';

// ── Global Chat state ────────────────────────────────────
let _globalMsgCount: number = 0;
let _globalUnread: number = 0;
let _globalInited: boolean = false;
let _lastGlobalMsgs: ChatMessage[] = [];
let _isInGame: boolean = false;

export function setIsInGame(val: boolean): void { _isInGame = val; }
export function getIsInGame(): boolean { return _isInGame; }
// ts-prune-ignore-next
export function getGlobalUnread(): number { return _globalUnread; }
export function setGlobalUnread(n: number): void { _globalUnread = n; }

// ── Global Chat Badge ────────────────────────────────────
export function updateChatBadge(): void {
  const tabBadge: HTMLElement | null = document.getElementById('chat-tab-badge');
  const count: number | string = _globalUnread > 99 ? '99+' : _globalUnread;
  // Show badge only while in-game (chat is hidden, unread msgs arrived)
  if (_globalUnread > 0 && _isInGame) {
    if (tabBadge) { tabBadge.textContent = `(${count})`; show(tabBadge); }
  } else {
    if (tabBadge) hide(tabBadge);
  }
}

// ── Render global chat from stored messages ──────────────
export function renderGlobalChat(): void {
  const container: HTMLElement | null = document.getElementById('chat-messages');
  if (!container) return;
  container.innerHTML = '';
  for (const msg of _lastGlobalMsgs) {
    const div: HTMLDivElement = document.createElement('div');
    if ((msg as ChatMessage & { system?: boolean }).system) {
      div.className = 'chat-msg-system';
      div.innerHTML = `<span class="chat-msg-user">${escapeHtml(msg.username)}</span> ${escapeHtml(msg.text)}`;
    } else {
      div.innerHTML = `${iconHtml(getIconForMsg(msg))}<span class="chat-msg-user">${escapeHtml(msg.username)}:</span>${escapeHtml(msg.text)}`;
    }
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

// ── Global Chat Message Listener ─────────────────────────
export function setupGlobalChatListener(): void {
  onMessages((msgs: ChatMessage[]) => {
    _lastGlobalMsgs = msgs;
    renderGlobalChat();

    // Resolve icons for messages missing them (historical)
    resolveIconCache(msgs, renderGlobalChat);

    // Track unread
    if (_globalInited) {
      const newCount: number = msgs.length - _globalMsgCount;
      if (newCount > 0 && _isInGame) {
        _globalUnread += newCount;
        updateChatBadge();
        playChat();
      }
    }
    _globalMsgCount = msgs.length;
    _globalInited = true;
  });
}
