// ── Global Chat Tests ───────────────────────────────────
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ── Mock dependencies BEFORE importing chatGlobal ───────
const mockOnMessages = vi.fn<(cb: (msgs: unknown[]) => void) => void>();
const mockStopListening = vi.fn();

vi.mock('../../chat', () => ({
  onMessages: (...args: unknown[]) => mockOnMessages(args[0] as (msgs: unknown[]) => void),
  stopListening: () => mockStopListening(),
}));

const mockPlayChat = vi.fn();
vi.mock('../../sfx', () => ({
  playChat: () => mockPlayChat(),
}));

const mockResolveIconCache = vi.fn<(msgs: unknown[], cb: () => void) => Promise<void>>();
const mockGetIconForMsg = vi.fn<(msg: unknown) => string | undefined>();
const mockIconHtml = vi.fn((icon?: string) => (icon ? `<icon:${icon}>` : ''));

vi.mock('../chat/chatIcons', () => ({
  resolveIconCache: (...args: unknown[]) => mockResolveIconCache(args[0] as unknown[], args[1] as () => void),
  getIconForMsg: (...args: unknown[]) => mockGetIconForMsg(args[0]),
  iconHtml: (icon?: string) => mockIconHtml(icon),
}));

import {
  setIsInGame,
  getIsInGame,
  getGlobalUnread,
  setGlobalUnread,
  updateChatBadge,
  renderGlobalChat,
  setupGlobalChatListener,
} from '../chat/chatGlobal';
import type { ChatMessage } from '../../types/index';

// ── Helpers ─────────────────────────────────────────────
function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    uid: 'uid-1',
    username: 'Alice',
    text: 'hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

function setupGlobalDom(): void {
  document.body.innerHTML = `
    <div id="chat-messages"></div>
    <div id="chat-tab-badge" class="hidden"></div>
  `;
}

describe('chatGlobal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setIsInGame(false);
    setGlobalUnread(0);
    setupGlobalDom();
  });

  // ── State accessors ───────────────────────────────────
  describe('state accessors', () => {
    it('setIsInGame / getIsInGame round-trip', () => {
      expect(getIsInGame()).toBe(false);
      setIsInGame(true);
      expect(getIsInGame()).toBe(true);
    });

    it('setGlobalUnread / getGlobalUnread round-trip', () => {
      expect(getGlobalUnread()).toBe(0);
      setGlobalUnread(7);
      expect(getGlobalUnread()).toBe(7);
    });
  });

  // ── updateChatBadge ───────────────────────────────────
  describe('updateChatBadge', () => {
    it('hides badge when unread is 0', () => {
      setGlobalUnread(0);
      updateChatBadge();
      const badge = document.getElementById('chat-tab-badge')!;
      expect(badge.classList.contains('hidden')).toBe(true);
    });

    it('hides badge when not in game even with unread', () => {
      setGlobalUnread(5);
      setIsInGame(false);
      updateChatBadge();
      const badge = document.getElementById('chat-tab-badge')!;
      expect(badge.classList.contains('hidden')).toBe(true);
    });

    it('shows badge with count when in game and unread > 0', () => {
      setGlobalUnread(3);
      setIsInGame(true);
      updateChatBadge();
      const badge = document.getElementById('chat-tab-badge')!;
      expect(badge.classList.contains('hidden')).toBe(false);
      expect(badge.textContent).toBe('(3)');
    });

    it('caps badge display at 99+', () => {
      setGlobalUnread(150);
      setIsInGame(true);
      updateChatBadge();
      const badge = document.getElementById('chat-tab-badge')!;
      expect(badge.textContent).toBe('(99+)');
    });

    it('does not throw when badge element is missing', () => {
      document.body.innerHTML = '';
      setGlobalUnread(5);
      setIsInGame(true);
      // Should not throw
      updateChatBadge();
    });
  });

  // ── renderGlobalChat ──────────────────────────────────
  describe('renderGlobalChat', () => {
    it('does nothing when container is missing', () => {
      document.body.innerHTML = '';
      // Should not throw
      renderGlobalChat();
    });

    it('renders empty container when no messages', () => {
      renderGlobalChat();
      const container = document.getElementById('chat-messages')!;
      expect(container.innerHTML).toBe('');
    });
  });

  // ── setupGlobalChatListener ───────────────────────────
  describe('setupGlobalChatListener', () => {
    it('registers a callback with onMessages', () => {
      setupGlobalChatListener();
      expect(mockOnMessages).toHaveBeenCalledOnce();
      expect(typeof mockOnMessages.mock.calls[0][0]).toBe('function');
    });

    it('renders messages when callback fires', () => {
      setupGlobalChatListener();
      const callback = mockOnMessages.mock.calls[0][0] as (msgs: ChatMessage[]) => void;
      const msgs = [makeMsg({ username: 'Bob', text: 'hey' })];
      mockGetIconForMsg.mockReturnValue(undefined);
      callback(msgs);
      const container = document.getElementById('chat-messages')!;
      expect(container.innerHTML).toContain('Bob');
      expect(container.innerHTML).toContain('hey');
    });

    it('renders system messages with system class', () => {
      setupGlobalChatListener();
      const callback = mockOnMessages.mock.calls[0][0] as (msgs: ChatMessage[]) => void;
      const msgs = [{ ...makeMsg({ username: 'System', text: 'joined' }), system: true }];
      mockGetIconForMsg.mockReturnValue(undefined);
      callback(msgs as unknown as ChatMessage[]);
      const container = document.getElementById('chat-messages')!;
      const sysDiv = container.querySelector('.chat-msg-system');
      expect(sysDiv).toBeTruthy();
    });

    it('calls resolveIconCache with messages', () => {
      setupGlobalChatListener();
      const callback = mockOnMessages.mock.calls[0][0] as (msgs: ChatMessage[]) => void;
      const msgs = [makeMsg()];
      callback(msgs);
      expect(mockResolveIconCache).toHaveBeenCalledWith(msgs, expect.any(Function));
    });

    it('renders icon HTML for messages with icons', () => {
      setupGlobalChatListener();
      const callback = mockOnMessages.mock.calls[0][0] as (msgs: ChatMessage[]) => void;
      const msgs = [makeMsg({ icon: 'star' })];
      mockGetIconForMsg.mockReturnValue('star');
      callback(msgs);
      expect(mockIconHtml).toHaveBeenCalledWith('star');
      const container = document.getElementById('chat-messages')!;
      expect(container.innerHTML).toContain('<icon:star>');
    });

    it('increments unread when new messages arrive in-game', () => {
      setIsInGame(true);
      setupGlobalChatListener();
      const callback = mockOnMessages.mock.calls[0][0] as (msgs: ChatMessage[]) => void;
      // Establish baseline count with initial batch
      callback([makeMsg({ id: 'inc-1' }), makeMsg({ id: 'inc-2' })]);
      const afterInit = getGlobalUnread();
      // New message arrives — should increment by 1
      callback([makeMsg({ id: 'inc-1' }), makeMsg({ id: 'inc-2' }), makeMsg({ id: 'inc-3' })]);
      expect(getGlobalUnread()).toBe(afterInit + 1);
    });

    it('plays chat sound on new messages in-game', () => {
      setIsInGame(true);
      setupGlobalChatListener();
      const callback = mockOnMessages.mock.calls[0][0] as (msgs: ChatMessage[]) => void;
      // Establish baseline
      callback([makeMsg({ id: 'snd-1' }), makeMsg({ id: 'snd-2' })]);
      mockPlayChat.mockClear();
      // New message arrives
      callback([makeMsg({ id: 'snd-1' }), makeMsg({ id: 'snd-2' }), makeMsg({ id: 'snd-3' })]);
      expect(mockPlayChat).toHaveBeenCalledOnce();
    });

    it('does not increment unread when not in-game', () => {
      setIsInGame(false);
      const prevUnread = getGlobalUnread();
      setupGlobalChatListener();
      const callback = mockOnMessages.mock.calls[0][0] as (msgs: ChatMessage[]) => void;
      callback([makeMsg({ id: 'ng-1' })]);
      callback([makeMsg({ id: 'ng-1' }), makeMsg({ id: 'ng-2' })]);
      expect(getGlobalUnread()).toBe(prevUnread);
      expect(mockPlayChat).not.toHaveBeenCalled();
    });

    it('accumulates unread count across multiple arrivals', () => {
      setIsInGame(true);
      setupGlobalChatListener();
      const callback = mockOnMessages.mock.calls[0][0] as (msgs: ChatMessage[]) => void;
      const prevUnread = getGlobalUnread();
      callback([makeMsg({ id: 'a1' })]);                                        // baseline
      callback([makeMsg({ id: 'a1' }), makeMsg({ id: 'a2' })]);                 // +1
      callback([makeMsg({ id: 'a1' }), makeMsg({ id: 'a2' }), makeMsg({ id: 'a3' })]); // +1
      expect(getGlobalUnread()).toBe(prevUnread + 2);
    });
  });
});
