// ── DM Chat Tests ───────────────────────────────────────
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ── Mock Firebase modules BEFORE importing chatDm ───────
const mockRef = vi.fn((_db: unknown, path: string) => ({ __path: path }));
const mockOnValue = vi.fn(() => vi.fn());
const mockOff = vi.fn();
const mockPush = vi.fn(() => Promise.resolve());

vi.mock('firebase/database', () => ({
  ref: (...args: unknown[]) => mockRef(...args),
  onValue: (...args: unknown[]) => mockOnValue(...args),
  off: (...args: unknown[]) => mockOff(...args),
  push: (...args: unknown[]) => mockPush(...args),
}));

vi.mock('../../firebase', () => ({
  rtdb: { __rtdb: true },
}));

vi.mock('../../swallow', () => ({
  swallow: () => () => {},
}));

vi.mock('../chat/chatIcons', () => ({
  iconHtml: (icon?: string) => (icon ? `<icon:${icon}>` : ''),
}));

import {
  initDmChatDeps,
  getActiveDmUid,
  setActiveDmUid,
  getDmChats,
  hasDmChat,
  updateDmBadge,
  renderDmChat,
  sendDmChat,
  updateDmOnlineStatuses,
  startDmChat,
  stopDmChat,
  switchDmTabs,
} from '../chat/chatDm';

// ── DOM Setup Helper ────────────────────────────────────
function setupChatDom(): void {
  document.body.innerHTML = `
    <div id="chat-tab-bar"></div>
    <div id="global-chat">
      <div id="chat-messages-lobby" style="overflow-y:auto;max-height:200px;"></div>
      <div id="chat-input-row"></div>
    </div>
  `;
}

// ── Dependency Stubs ────────────────────────────────────
function makeDeps() {
  return {
    switchChatTab: vi.fn(),
    getCurrentUid: vi.fn(() => 'my-uid'),
    getCurrentUsername: vi.fn(() => 'TestUser'),
    getCurrentIcon: vi.fn(() => null),
    applyChatVisibility: vi.fn(),
  };
}

describe('chatDm', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear internal _dmChats map via stopDmChat for any leftover state
    for (const uid of [...getDmChats().keys()]) {
      stopDmChat(uid);
    }
    setActiveDmUid(null);
    setupChatDom();
    deps = makeDeps();
    initDmChatDeps(deps);
  });

  // ── Accessors ─────────────────────────────────────────
  describe('accessors', () => {
    it('getActiveDmUid returns null by default', () => {
      expect(getActiveDmUid()).toBeNull();
    });

    it('setActiveDmUid / getActiveDmUid round-trip', () => {
      setActiveDmUid('friend-1');
      expect(getActiveDmUid()).toBe('friend-1');
    });

    it('getDmChats returns empty map initially', () => {
      expect(getDmChats().size).toBe(0);
    });

    it('hasDmChat returns false when no chats open', () => {
      expect(hasDmChat('unknown')).toBe(false);
    });
  });

  // ── updateDmBadge ─────────────────────────────────────
  describe('updateDmBadge', () => {
    it('does nothing when friend not in dmChats', () => {
      // Should not throw
      updateDmBadge('nonexistent');
    });

    it('shows badge when unread > 0 and not active DM', () => {
      startDmChat('friend-badge', 'BadgeFriend');
      const dm = getDmChats().get('friend-badge')!;
      dm.unread = 5;
      setActiveDmUid(null);
      updateDmBadge('friend-badge');
      const badge = dm.tabEl!.querySelector('.chat-unread') as HTMLElement;
      expect(badge.textContent).toBe('(5)');
      expect(badge.classList.contains('hidden')).toBe(false);
    });

    it('caps badge display at 99+', () => {
      startDmChat('friend-cap', 'CapFriend');
      const dm = getDmChats().get('friend-cap')!;
      dm.unread = 150;
      setActiveDmUid(null);
      updateDmBadge('friend-cap');
      const badge = dm.tabEl!.querySelector('.chat-unread') as HTMLElement;
      expect(badge.textContent).toBe('(99+)');
    });

    it('hides badge when active DM matches friendUid', () => {
      startDmChat('friend-active', 'ActiveFriend');
      const dm = getDmChats().get('friend-active')!;
      dm.unread = 3;
      setActiveDmUid('friend-active');
      updateDmBadge('friend-active');
      const badge = dm.tabEl!.querySelector('.chat-unread') as HTMLElement;
      expect(badge.classList.contains('hidden')).toBe(true);
    });
  });

  // ── renderDmChat ──────────────────────────────────────
  describe('renderDmChat', () => {
    it('does nothing for unknown friendUid', () => {
      // Should not throw
      renderDmChat('unknown');
    });

    it('renders system header with friend username', () => {
      startDmChat('friend-render', 'RenderFriend');
      const dm = getDmChats().get('friend-render')!;
      dm.messages = [];
      renderDmChat('friend-render');
      expect(dm.containerEl!.innerHTML).toContain('Chat with RenderFriend');
    });

    it('renders regular messages with username and text', () => {
      startDmChat('friend-msgs', 'MsgFriend');
      const dm = getDmChats().get('friend-msgs')!;
      dm.messages = [
        { uid: 'u1', username: 'Alice', text: 'hi there', ts: 1000 },
        { uid: 'u2', username: 'Bob', text: 'hey', ts: 2000 },
      ];
      renderDmChat('friend-msgs');
      expect(dm.containerEl!.innerHTML).toContain('Alice');
      expect(dm.containerEl!.innerHTML).toContain('hi there');
      expect(dm.containerEl!.innerHTML).toContain('Bob');
      expect(dm.containerEl!.innerHTML).toContain('hey');
    });

    it('renders system messages with system class', () => {
      startDmChat('friend-sys', 'SysFriend');
      const dm = getDmChats().get('friend-sys')!;
      dm.messages = [
        { uid: '', username: 'System', text: 'connected', ts: 1000, system: true },
      ];
      renderDmChat('friend-sys');
      const sysDiv = dm.containerEl!.querySelector('.chat-msg-system:last-child');
      expect(sysDiv).toBeTruthy();
      expect(sysDiv!.textContent).toBe('connected');
    });

    it('renders icon HTML for messages with icon', () => {
      startDmChat('friend-icon', 'IconFriend');
      const dm = getDmChats().get('friend-icon')!;
      dm.messages = [
        { uid: 'u1', username: 'Alice', text: 'yo', ts: 1000, icon: 'star' },
      ];
      renderDmChat('friend-icon');
      // iconHtml mock returns <icon:star>
      expect(dm.containerEl!.innerHTML).toContain('<icon:star>');
    });
  });

  // ── sendDmChat ────────────────────────────────────────
  describe('sendDmChat', () => {
    it('pushes message to Firebase RTDB with correct DM path', () => {
      sendDmChat('friend-send', 'hello world');
      expect(mockRef).toHaveBeenCalled();
      // Path should be canonical sorted: dms/friend-send_my-uid or dms/my-uid_friend-send
      const refCall = (mockRef as Mock).mock.calls.find(
        (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).startsWith('dms/'),
      );
      expect(refCall).toBeTruthy();
      const path = refCall![1] as string;
      // Sorted: 'friend-send' < 'my-uid' so path = dms/friend-send_my-uid/messages
      expect(path).toBe('dms/friend-send_my-uid/messages');

      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({ __path: path }),
        expect.objectContaining({
          uid: 'my-uid',
          username: 'TestUser',
          text: 'hello world',
        }),
      );
    });

    it('includes icon in payload when getCurrentIcon returns one', () => {
      deps.getCurrentIcon.mockReturnValue('crown');
      sendDmChat('friend-icon-send', 'hey');
      const pushPayload = (mockPush as Mock).mock.calls[0][1] as Record<string, unknown>;
      expect(pushPayload.icon).toBe('crown');
    });

    it('omits icon from payload when getCurrentIcon returns null', () => {
      deps.getCurrentIcon.mockReturnValue(null);
      sendDmChat('friend-no-icon', 'hey');
      const pushPayload = (mockPush as Mock).mock.calls[0][1] as Record<string, unknown>;
      expect(pushPayload.icon).toBeUndefined();
    });

    it('does nothing when getCurrentUid returns null', () => {
      deps.getCurrentUid.mockReturnValue(null);
      sendDmChat('friend-x', 'msg');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('does nothing when getCurrentUsername returns null', () => {
      deps.getCurrentUsername.mockReturnValue(null);
      sendDmChat('friend-x', 'msg');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('uses sorted UID pair to build canonical DM path', () => {
      // my-uid > abc so path = dms/abc_my-uid/messages
      sendDmChat('abc', 'test');
      const refCall = (mockRef as Mock).mock.calls.find(
        (c: unknown[]) => typeof c[1] === 'string' && (c[1] as string).startsWith('dms/'),
      );
      expect(refCall![1]).toBe('dms/abc_my-uid/messages');
    });
  });

  // ── startDmChat / stopDmChat ──────────────────────────
  describe('startDmChat', () => {
    it('creates tab element in tab bar', () => {
      startDmChat('friend-tab', 'TabFriend');
      const tabBar = document.getElementById('chat-tab-bar')!;
      expect(tabBar.children.length).toBe(1);
      expect(tabBar.innerHTML).toContain('TabFriend');
    });

    it('creates message container in global-chat before input row', () => {
      startDmChat('friend-container', 'ContainerFriend');
      const container = document.getElementById('chat-messages-dm-friend-container');
      expect(container).toBeTruthy();
    });

    it('registers entry in dmChats map', () => {
      startDmChat('friend-map', 'MapFriend');
      expect(hasDmChat('friend-map')).toBe(true);
    });

    it('sets up RTDB listener when current user is available', () => {
      startDmChat('friend-listen', 'ListenFriend');
      expect(mockRef).toHaveBeenCalled();
      expect(mockOnValue).toHaveBeenCalled();
    });

    it('switches to the DM tab after opening', () => {
      startDmChat('friend-switch', 'SwitchFriend');
      expect(deps.switchChatTab).toHaveBeenCalledWith('dm-friend-switch');
    });

    it('just switches tab if DM already open', () => {
      startDmChat('friend-dupe', 'DupeFriend');
      deps.switchChatTab.mockClear();
      startDmChat('friend-dupe', 'DupeFriend');
      expect(deps.switchChatTab).toHaveBeenCalledWith('dm-friend-dupe');
      // Should not create a second tab
      expect(getDmChats().size).toBe(1);
    });

    it('sets localStorage chat-visible to true', () => {
      localStorage.removeItem('luminal-chat-visible');
      startDmChat('friend-vis', 'VisFriend');
      expect(localStorage.getItem('luminal-chat-visible')).toBe('true');
    });

    it('calls applyChatVisibility', () => {
      startDmChat('friend-apply', 'ApplyFriend');
      expect(deps.applyChatVisibility).toHaveBeenCalled();
    });
  });

  describe('stopDmChat', () => {
    it('removes entry from dmChats map', () => {
      startDmChat('friend-stop', 'StopFriend');
      expect(hasDmChat('friend-stop')).toBe(true);
      stopDmChat('friend-stop');
      expect(hasDmChat('friend-stop')).toBe(false);
    });

    it('removes tab and container elements from DOM', () => {
      startDmChat('friend-dom', 'DomFriend');
      stopDmChat('friend-dom');
      expect(document.getElementById('chat-messages-dm-friend-dom')).toBeNull();
    });

    it('detaches RTDB listener', () => {
      startDmChat('friend-off', 'OffFriend');
      const dm = getDmChats().get('friend-off')!;
      expect(dm.listenerRef).toBeTruthy();
      stopDmChat('friend-off');
      expect(mockOff).toHaveBeenCalled();
    });

    it('switches to global tab if active DM was closed', () => {
      startDmChat('friend-close', 'CloseFriend');
      setActiveDmUid('friend-close');
      deps.switchChatTab.mockClear();
      stopDmChat('friend-close');
      expect(deps.switchChatTab).toHaveBeenCalledWith('global');
    });

    it('does nothing for unknown friendUid', () => {
      // Should not throw
      stopDmChat('nonexistent');
    });
  });

  // ── switchDmTabs ──────────────────────────────────────
  describe('switchDmTabs', () => {
    it('activates matching DM tab and shows its container', () => {
      startDmChat('friend-sw1', 'SW1');
      startDmChat('friend-sw2', 'SW2');
      switchDmTabs('dm-friend-sw1');
      const dm1 = getDmChats().get('friend-sw1')!;
      const dm2 = getDmChats().get('friend-sw2')!;
      expect(dm1.tabEl!.classList.contains('chat-tab--active')).toBe(true);
      expect(dm2.tabEl!.classList.contains('chat-tab--active')).toBe(false);
    });

    it('clears unread when switching to a DM', () => {
      startDmChat('friend-unread', 'UnreadFriend');
      const dm = getDmChats().get('friend-unread')!;
      dm.unread = 5;
      switchDmTabs('dm-friend-unread');
      expect(dm.unread).toBe(0);
    });

    it('sets activeDmUid to null when switching to non-DM tab', () => {
      setActiveDmUid('someone');
      switchDmTabs('global');
      expect(getActiveDmUid()).toBeNull();
    });
  });

  // ── updateDmOnlineStatuses ────────────────────────────
  describe('updateDmOnlineStatuses', () => {
    it('adds online class when friend is online', () => {
      startDmChat('friend-on', 'OnFriend');
      const dm = getDmChats().get('friend-on')!;
      const dot = dm.tabEl!.querySelector('.chat-dm-dot') as HTMLElement;
      const onlineMap = new Map([['friend-on', true]]);
      updateDmOnlineStatuses(onlineMap);
      expect(dot.classList.contains('chat-dm-dot--online')).toBe(true);
    });

    it('removes online class when friend is offline', () => {
      startDmChat('friend-off2', 'OffFriend2');
      const dm = getDmChats().get('friend-off2')!;
      const dot = dm.tabEl!.querySelector('.chat-dm-dot') as HTMLElement;
      dot.classList.add('chat-dm-dot--online');
      const onlineMap = new Map([['friend-off2', false]]);
      updateDmOnlineStatuses(onlineMap);
      expect(dot.classList.contains('chat-dm-dot--online')).toBe(false);
    });

    it('defaults to offline when friend not in map', () => {
      startDmChat('friend-miss', 'MissFriend');
      const dm = getDmChats().get('friend-miss')!;
      const dot = dm.tabEl!.querySelector('.chat-dm-dot') as HTMLElement;
      dot.classList.add('chat-dm-dot--online');
      updateDmOnlineStatuses(new Map());
      expect(dot.classList.contains('chat-dm-dot--online')).toBe(false);
    });
  });
});
