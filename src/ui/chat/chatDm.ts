// ── DM Chat state, badge, rendering, send ───────────────
import { show, hide, toggleVisible, escapeHtml } from '../dom';
import { ref, onValue as rtdbOnValue, off as rtdbOff, push as rtdbPush, DatabaseReference } from 'firebase/database';
import { rtdb as rtdbInstance } from '../../firebase';
import { swallow } from '../../swallow';
import { iconHtml } from './chatIcons';

// ── DM Chat message shape ───────────────────────────────
interface MatchChatMsg {
  uid?: string;
  username: string;
  text: string;
  ts: number;
  system?: boolean;
  icon?: string;
}

// ── DM state ────────────────────────────────────────────
export interface DmState {
  friendUid: string;
  friendUsername: string;
  messages: MatchChatMsg[];
  unread: number;
  prevCount: number;
  listenerRef: DatabaseReference | null;
  tabEl: HTMLElement | null;
  containerEl: HTMLElement | null;
}

const _dmChats: Map<string, DmState> = new Map();
let _activeDmUid: string | null = null;

// ── External dependencies injected at init ──────────────
let _switchChatTabFn: ((tab: string) => void) | null = null;
let _getCurrentUid: (() => string | null) | null = null;
let _getCurrentUsername: (() => string | null) | null = null;
let _getCurrentIcon: (() => string | null) | null = null;
let _applyChatVisibilityFn: (() => void) | null = null;

export function initDmChatDeps(deps: {
  switchChatTab: (tab: string) => void;
  getCurrentUid: () => string | null;
  getCurrentUsername: () => string | null;
  getCurrentIcon: () => string | null;
  applyChatVisibility: () => void;
}): void {
  _switchChatTabFn = deps.switchChatTab;
  _getCurrentUid = deps.getCurrentUid;
  _getCurrentUsername = deps.getCurrentUsername;
  _getCurrentIcon = deps.getCurrentIcon;
  _applyChatVisibilityFn = deps.applyChatVisibility;
}

// ── Accessors ───────────────────────────────────────────
export function getActiveDmUid(): string | null { return _activeDmUid; }
// ts-prune-ignore-next
export function setActiveDmUid(uid: string | null): void { _activeDmUid = uid; }
export function getDmChats(): Map<string, DmState> { return _dmChats; }
export function hasDmChat(uid: string): boolean { return _dmChats.has(uid); }

/** Canonical RTDB path for a DM channel (sorted UIDs to avoid duplication). */
function _dmPath(uid1: string, uid2: string): string {
  return uid1 < uid2 ? `dms/${uid1}_${uid2}/messages` : `dms/${uid2}_${uid1}/messages`;
}

// ── DM Badge ────────────────────────────────────────────
export function updateDmBadge(friendUid: string): void {
  const dm = _dmChats.get(friendUid);
  if (!dm?.tabEl) return;
  const badge = dm.tabEl.querySelector('.chat-unread') as HTMLElement | null;
  if (!badge) return;
  if (dm.unread > 0 && _activeDmUid !== friendUid) {
    badge.textContent = `(${dm.unread > 99 ? '99+' : dm.unread})`;
    show(badge);
  } else {
    hide(badge);
  }
}

// ── Render DM Chat ──────────────────────────────────────
export function renderDmChat(friendUid: string): void {
  const dm = _dmChats.get(friendUid);
  if (!dm?.containerEl) return;
  dm.containerEl.innerHTML = `<div class="chat-msg-system">Chat with ${escapeHtml(dm.friendUsername)}</div>`;
  for (const msg of dm.messages) {
    const div: HTMLDivElement = document.createElement('div');
    if (msg.system) {
      div.className = 'chat-msg-system';
      div.textContent = msg.text;
    } else {
      div.innerHTML = `${iconHtml(msg.icon)}<span class="chat-msg-user">${escapeHtml(msg.username)}:</span>${escapeHtml(msg.text)}`;
    }
    dm.containerEl.appendChild(div);
  }
  dm.containerEl.scrollTop = dm.containerEl.scrollHeight;
}

// ── Send DM Chat ────────────────────────────────────────
export function sendDmChat(friendUid: string, text: string): void {
  const uid = _getCurrentUid?.();
  const username = _getCurrentUsername?.();
  const icon = _getCurrentIcon?.();
  if (!uid || !username) return;
  const chatRef: DatabaseReference = ref(rtdbInstance, _dmPath(uid, friendUid));
  rtdbPush(chatRef, { uid, username, text, ts: Date.now(), ...(icon ? { icon } : {}) }).catch(swallow('chat'));
}

// ── DM Online Status ────────────────────────────────────
function _updateDmOnlineStatus(friendUid: string, isOnline: boolean): void {
  const dm = _dmChats.get(friendUid);
  if (!dm?.tabEl) return;
  const dot = dm.tabEl.querySelector('.chat-dm-dot') as HTMLElement | null;
  if (dot) {
    dot.classList.toggle('chat-dm-dot--online', isOnline);
  }
}

export function updateDmOnlineStatuses(onlineMap: Map<string, boolean>): void {
  for (const [uid] of _dmChats) {
    _updateDmOnlineStatus(uid, onlineMap.get(uid) ?? false);
  }
}

// ── Start / Stop DM Chat ────────────────────────────────
export function startDmChat(friendUid: string, friendUsername: string): void {
  // If already open, just switch to it
  if (_dmChats.has(friendUid)) {
    _switchChatTabFn?.(`dm-${friendUid}`);
    return;
  }

  const tabBar = document.getElementById('chat-tab-bar')!;
  const chatEl = document.getElementById('global-chat')!;

  // Create tab element
  const tabEl = document.createElement('div');
  tabEl.className = 'chat-tab';
  tabEl.innerHTML = `<span class="chat-dm-dot"></span>${escapeHtml(friendUsername)} <span class="chat-unread hidden"></span><span class="chat-tab-x">&times;</span>`;
  tabEl.addEventListener('click', () => _switchChatTabFn?.(`dm-${friendUid}`));
  const closeBtn = tabEl.querySelector('.chat-tab-x')!;
  closeBtn.addEventListener('click', (e: Event) => {
    e.stopPropagation();
    stopDmChat(friendUid);
  });
  tabBar.appendChild(tabEl);

  // Create message container
  const containerEl = document.createElement('div');
  containerEl.className = 'hidden';
  containerEl.id = `chat-messages-dm-${friendUid}`;
  containerEl.style.cssText = document.getElementById('chat-messages-lobby')!.style.cssText;
  // Insert before input row
  const inputRow = document.getElementById('chat-input-row')!;
  chatEl.insertBefore(containerEl, inputRow);

  const dm: DmState = {
    friendUid, friendUsername,
    messages: [], unread: 0, prevCount: 0,
    listenerRef: null, tabEl, containerEl,
  };
  _dmChats.set(friendUid, dm);

  // Force chat visible
  localStorage.setItem('luminal-chat-visible', 'true');
  _applyChatVisibilityFn?.();

  // Listen to DM messages in RTDB
  const currentUid = _getCurrentUid?.();
  if (currentUid) {
    dm.listenerRef = ref(rtdbInstance, _dmPath(currentUid, friendUid));
    rtdbOnValue(dm.listenerRef, (snap) => {
      const val: Record<string, MatchChatMsg> | null = snap.val();
      const msgs: MatchChatMsg[] = val ? (Object.values(val) as MatchChatMsg[]).sort((a, b) => a.ts - b.ts) : [];
      dm.messages = msgs;
      renderDmChat(friendUid);
      if (msgs.length > dm.prevCount && _activeDmUid !== friendUid) {
        dm.unread += msgs.length - dm.prevCount;
        updateDmBadge(friendUid);
      }
      dm.prevCount = msgs.length;
    });
  }

  _switchChatTabFn?.(`dm-${friendUid}`);
}

export function stopDmChat(friendUid: string): void {
  const dm = _dmChats.get(friendUid);
  if (!dm) return;
  if (dm.listenerRef) { rtdbOff(dm.listenerRef); dm.listenerRef = null; }
  dm.tabEl?.remove();
  dm.containerEl?.remove();
  _dmChats.delete(friendUid);
  if (_activeDmUid === friendUid) _switchChatTabFn?.('global');
}

// ── Tab switching helpers used by coordinator ────────────
export function switchDmTabs(tab: string): void {
  const isDm = tab.startsWith('dm-');
  _activeDmUid = isDm ? tab.slice(3) : null;
  for (const [uid, dm] of _dmChats) {
    const active = isDm && uid === _activeDmUid;
    dm.tabEl?.classList.toggle('chat-tab--active', active);
    if (dm.containerEl) toggleVisible(dm.containerEl, active);
    if (active) { dm.unread = 0; updateDmBadge(uid); }
  }
}
