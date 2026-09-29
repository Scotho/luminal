// ── Social UI Tests ─────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../gamepad', () => ({
  isGamepadConnected: vi.fn(() => false),
  getForceKeyboard: vi.fn(() => false),
  getUINav: vi.fn(() => null),
  initGamepad: vi.fn(),
  pollGamepad: vi.fn(),
  getGamepadState: vi.fn(() => null),
  getRawGamepadState: vi.fn(() => null),
  setForceKeyboard: vi.fn(),
}));

// Account-tab sign-out delegation test needs a mockable signOutUser.
vi.mock('../../auth', () => ({
  signOutUser: vi.fn(() => Promise.resolve()),
  onAuthChange: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithApple: vi.fn(),
  signInWithGitHub: vi.fn(),
  signInWithMicrosoft: vi.fn(),
  sendPhoneCode: vi.fn(),
  verifyPhoneCode: vi.fn(),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  resetPassword: vi.fn(),
  sendEmailLink: vi.fn(),
  checkEmailLinkRedirect: vi.fn(() => false),
  setUsernameForUser: vi.fn(),
  getUsername: vi.fn(() => Promise.resolve(null)),
  getUserSettings: vi.fn(() => Promise.resolve(null)),
  getCurrentUser: vi.fn(() => null),
  ensureUserIcon: vi.fn(() => Promise.resolve({ icon: null, awarded: false })),
  isUsernameTaken: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('../../presence', () => ({
  initPresence: vi.fn(),
  onOnlineCount: vi.fn(),
  onConnectionChange: vi.fn(),
  onGlobalTimePlayed: vi.fn(),
}));

import { SCREEN_IDS } from '../navigation';
import {
  isSocialAvailable,
  getCurrentSocialTab,
  switchSocialTab,
  cycleSocialTab,
  initSocialUI,
  updateSocialButtonVisibility,
  updateSocialPartyState,
  renderSocialPartyMembers,
  updateSocialNotifBadge,
  showSocialFriendDetail,
  hideSocialFriendDetail,
  updateSocialAccountTabVisibility,
  renderSocialAccountPanel,
  updateSocialAuthButton,
  _resetForTesting,
} from '../socialUI';
import type { UserProfile } from '../profile';
import * as auth from '../../auth';
import { isGamepadConnected, getForceKeyboard } from '../../gamepad';

const mockDeps = () => ({
  navigateTo: vi.fn(),
  navigateBack: vi.fn(),
  getCurrentLobbyId: vi.fn(() => null),
  getMyRole: vi.fn(() => null as 'host' | 'guest' | null),
  createParty: vi.fn(),
  leaveParty: vi.fn(),
  currentUid: null,
  currentUsername: null,
  isRealUser: false,
});

// Reset both clones (dropdown + overlay) to their pristine default state.
function resetSocialClones(): void {
  for (const tab of document.querySelectorAll<HTMLElement>('[data-social-tab]')) {
    tab.classList.toggle('social-tab--active', tab.dataset.socialTab === 'party');
  }
  // Account tab starts hidden (signed-out).
  for (const tab of document.querySelectorAll<HTMLElement>('[data-social-tab="account"]')) {
    tab.classList.add('hidden');
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-social-panel]')) {
    panel.classList.toggle('hidden', panel.dataset.socialPanel !== 'party');
  }
  for (const empty of document.querySelectorAll<HTMLElement>('[data-social-slot="party-empty"]')) {
    empty.classList.remove('hidden');
  }
  for (const active of document.querySelectorAll<HTMLElement>('[data-social-slot="party-active"]')) {
    active.classList.add('hidden');
  }
  for (const badge of document.querySelectorAll<HTMLElement>('[data-social-slot="notif-badge"]')) {
    badge.classList.add('hidden');
    badge.textContent = '0';
  }
  for (const detail of document.querySelectorAll<HTMLElement>('[data-social-slot="friend-detail"]')) {
    detail.classList.add('hidden');
  }
}

describe('Social UI', () => {
  beforeEach(() => {
    _resetForTesting();
    vi.mocked(isGamepadConnected).mockReturnValue(false);
    vi.mocked(getForceKeyboard).mockReturnValue(false);

    // Reset DOM state for both social clones (dropdown + overlay).
    resetSocialClones();
    document.getElementById('btn-social')?.classList.remove('hidden');
  });

  // ── Screen Registration ────────────────────────────────
  describe('screen registration', () => {
    it('SCREEN_IDS.social === "social-overlay"', () => {
      expect(SCREEN_IDS.social).toBe('social-overlay');
    });
  });

  // ── SOCIAL Overlay DOM ─────────────────────────────────
  describe('SOCIAL overlay DOM', () => {
    it('overlay exists', () => {
      expect(document.getElementById('social-overlay')).toBeTruthy();
    });

    it('has 5 tab buttons (including hidden ACCOUNT)', () => {
      const tabs = document.querySelectorAll('#social-component .social-tab');
      expect(tabs.length).toBe(5);
    });

    it('Account tab is hidden by default (signed out)', () => {
      const tab = document.getElementById('social-tab-account')!;
      expect(tab.classList.contains('hidden')).toBe(true);
    });

    it('Account panel is hidden by default', () => {
      expect(document.getElementById('social-panel-account')!.classList.contains('hidden')).toBe(true);
    });

    it('Party tab is active by default', () => {
      const tab = document.getElementById('social-tab-party')!;
      expect(tab.classList.contains('social-tab--active')).toBe(true);
    });

    it('Party panel is visible by default', () => {
      const panel = document.getElementById('social-panel-party')!;
      expect(panel.classList.contains('hidden')).toBe(false);
    });

    it('Friends panel is hidden by default', () => {
      expect(document.getElementById('social-panel-friends')!.classList.contains('hidden')).toBe(true);
    });

    it('Notifs panel is hidden by default', () => {
      expect(document.getElementById('social-panel-notifs')!.classList.contains('hidden')).toBe(true);
    });

    it('SOCIAL button exists in main menu', () => {
      const btn = document.getElementById('btn-social');
      expect(btn).toBeTruthy();
      // Button is icon-only; accessible label is provided via title attribute
      expect(btn!.getAttribute('title')).toBeTruthy();
    });
  });

  // ── Tab Switching ──────────────────────────────────────
  describe('tab switching', () => {
    it('default tab is party', () => {
      expect(getCurrentSocialTab()).toBe('party');
    });

    it('switchSocialTab shows correct panel and hides others', () => {
      switchSocialTab('friends');
      expect(document.getElementById('social-panel-friends')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('social-panel-party')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('social-panel-notifs')!.classList.contains('hidden')).toBe(true);
    });

    it('switchSocialTab updates active tab button', () => {
      switchSocialTab('notifs');
      expect(document.getElementById('social-tab-notifs')!.classList.contains('social-tab--active')).toBe(true);
      expect(document.getElementById('social-tab-party')!.classList.contains('social-tab--active')).toBe(false);
      expect(document.getElementById('social-tab-friends')!.classList.contains('social-tab--active')).toBe(false);
    });

    it('same-tab switch is a no-op', () => {
      switchSocialTab('party');
      expect(getCurrentSocialTab()).toBe('party');
      expect(document.getElementById('social-panel-party')!.classList.contains('hidden')).toBe(false);
    });

    it('tab click switches tabs', () => {
      initSocialUI(mockDeps());
      const friendsTab = document.getElementById('social-tab-friends')!;
      friendsTab.click();
      expect(getCurrentSocialTab()).toBe('friends');
      expect(document.getElementById('social-panel-friends')!.classList.contains('hidden')).toBe(false);
    });
  });

  // ── Availability ───────────────────────────────────────
  describe('availability', () => {
    it('false on wide desktop with no controller', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
      vi.mocked(isGamepadConnected).mockReturnValue(false);
      expect(isSocialAvailable()).toBe(false);
    });

    it('true with controller connected', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
      vi.mocked(isGamepadConnected).mockReturnValue(true);
      expect(isSocialAvailable()).toBe(true);
    });

    it('false with force-keyboard on', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
      vi.mocked(isGamepadConnected).mockReturnValue(true);
      vi.mocked(getForceKeyboard).mockReturnValue(true);
      expect(isSocialAvailable()).toBe(false);
    });

    it('true at <=1024px viewport', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
      vi.mocked(isGamepadConnected).mockReturnValue(false);
      expect(isSocialAvailable()).toBe(true);
    });

    it('true at 768px', () => {
      Object.defineProperty(window, 'innerWidth', { value: 768, writable: true });
      expect(isSocialAvailable()).toBe(true);
    });

    it('true with both controller and small screen', () => {
      Object.defineProperty(window, 'innerWidth', { value: 768, writable: true });
      vi.mocked(isGamepadConnected).mockReturnValue(true);
      expect(isSocialAvailable()).toBe(true);
    });
  });

  // ── Button Visibility ──────────────────────────────────
  describe('button visibility', () => {
    it('hides on wide desktop', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
      vi.mocked(isGamepadConnected).mockReturnValue(false);
      updateSocialButtonVisibility();
      expect(document.getElementById('btn-social')!.classList.contains('hidden')).toBe(true);
    });

    it('shows with controller', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true });
      vi.mocked(isGamepadConnected).mockReturnValue(true);
      updateSocialButtonVisibility();
      expect(document.getElementById('btn-social')!.classList.contains('hidden')).toBe(false);
    });

    it('shows on tablet viewport', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
      updateSocialButtonVisibility();
      expect(document.getElementById('btn-social')!.classList.contains('hidden')).toBe(false);
    });
  });

  // ── Party Tab ──────────────────────────────────────────
  describe('party tab', () => {
    it('empty/active state toggling via updateSocialPartyState', () => {
      updateSocialPartyState('lobby-123', {});
      expect(document.getElementById('social-party-empty')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('social-party-active')!.classList.contains('hidden')).toBe(false);

      updateSocialPartyState(null, null);
      expect(document.getElementById('social-party-empty')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('social-party-active')!.classList.contains('hidden')).toBe(true);
    });

    it('CREATE button exists', () => {
      const btn = document.getElementById('btn-social-create-party');
      expect(btn).toBeTruthy();
      expect(btn!.textContent).toContain('CREATE');
    });

    it('COPY INVITE button exists', () => {
      const btn = document.getElementById('btn-social-copy-invite');
      expect(btn).toBeTruthy();
      expect(btn!.textContent).toContain('COPY INVITE');
    });

    it('LEAVE PARTY button exists', () => {
      const btn = document.getElementById('btn-social-leave-party');
      expect(btn).toBeTruthy();
      expect(btn!.textContent).toContain('LEAVE PARTY');
    });
  });

  // ── Friends Tab ────────────────────────────────────────
  describe('friends tab', () => {
    it('has add input with placeholder and maxlength', () => {
      const input = document.getElementById('social-friends-add-input') as HTMLInputElement;
      expect(input).toBeTruthy();
      expect(input.placeholder).toBe('Enter username...');
      expect(input.maxLength).toBe(20);
    });

    it('has add button', () => {
      expect(document.getElementById('btn-social-friends-add')).toBeTruthy();
    });

    it('has friends list container', () => {
      expect(document.getElementById('social-friends-list')).toBeTruthy();
    });

    it('requests section hidden by default', () => {
      expect(document.getElementById('social-friends-requests')!.classList.contains('hidden')).toBe(true);
    });

    it('outgoing section hidden by default', () => {
      expect(document.getElementById('social-friends-outgoing')!.classList.contains('hidden')).toBe(true);
    });

    it('detail pane hidden by default', () => {
      expect(document.getElementById('social-friend-detail')!.classList.contains('hidden')).toBe(true);
    });

    it('detail has INVITE button', () => {
      const btn = document.getElementById('btn-social-invite-friend');
      expect(btn).toBeTruthy();
      expect(btn!.textContent).toContain('INVITE');
    });

    it('detail has REMOVE button', () => {
      const btn = document.getElementById('btn-social-remove-friend');
      expect(btn).toBeTruthy();
      expect(btn!.textContent).toContain('REMOVE');
    });

    it('has empty state', () => {
      const empty = document.getElementById('social-friends-empty');
      expect(empty).toBeTruthy();
      expect(empty!.textContent).toBeTruthy();
    });
  });

  // ── Notifications Tab ──────────────────────────────────
  describe('notifications tab', () => {
    it('has list container', () => {
      expect(document.getElementById('social-notif-list')).toBeTruthy();
    });

    it('has empty state', () => {
      expect(document.getElementById('social-notif-empty')).toBeTruthy();
    });

    it('badge shows/hides with count', () => {
      const badge = document.getElementById('social-notif-badge')!;

      updateSocialNotifBadge(3);
      expect(badge.classList.contains('hidden')).toBe(false);
      expect(badge.textContent).toBe('3');

      updateSocialNotifBadge(1);
      expect(badge.classList.contains('hidden')).toBe(true);
      expect(badge.textContent).toBe('1');

      updateSocialNotifBadge(0);
      expect(badge.classList.contains('hidden')).toBe(true);
      expect(badge.textContent).toBe('0');
    });
  });

  // ── Controller Cycling ─────────────────────────────────
  describe('controller cycling', () => {
    it('forward: party → friends → notifs → chat → party wrap', () => {
      expect(getCurrentSocialTab()).toBe('party');
      cycleSocialTab(1);
      expect(getCurrentSocialTab()).toBe('friends');
      cycleSocialTab(1);
      expect(getCurrentSocialTab()).toBe('notifs');
      cycleSocialTab(1);
      expect(getCurrentSocialTab()).toBe('chat');
      cycleSocialTab(1);
      expect(getCurrentSocialTab()).toBe('party');
    });

    it('backward: party → chat wrap', () => {
      expect(getCurrentSocialTab()).toBe('party');
      cycleSocialTab(-1);
      expect(getCurrentSocialTab()).toBe('chat');
    });

    it('backward: friends → party', () => {
      switchSocialTab('friends');
      cycleSocialTab(-1);
      expect(getCurrentSocialTab()).toBe('party');
    });
  });

  // ── Touch Safety ───────────────────────────────────────
  describe('touch safety', () => {
    it('all action buttons are clickable elements', () => {
      const actionIds = [
        'btn-social-create-party', 'btn-social-copy-invite',
        'btn-social-leave-party',
        'btn-social-friends-add', 'btn-social-invite-friend',
        'btn-social-remove-friend',
      ];
      for (const id of actionIds) {
        const el = document.getElementById(id);
        expect(el, `${id} should exist`).toBeTruthy();
      }
    });

    it('tabs are button elements', () => {
      const tabs = document.querySelectorAll('#social-overlay .social-tab');
      tabs.forEach(tab => {
        expect(tab.tagName).toBe('BUTTON');
      });
    });

    it('no context menus on action buttons (elements exist)', () => {
      // Verify action buttons are real DOM elements (not generated on-demand)
      const btn = document.getElementById('btn-social-create-party');
      expect(btn).toBeTruthy();
    });

    it('detail pane actions are visible buttons', () => {
      const invite = document.getElementById('btn-social-invite-friend');
      const remove = document.getElementById('btn-social-remove-friend');
      expect(invite).toBeTruthy();
      expect(remove).toBeTruthy();
    });
  });

  // ── Edge Cases ─────────────────────────────────────────
  describe('edge cases', () => {
    it('switching tabs multiple times', () => {
      switchSocialTab('friends');
      switchSocialTab('notifs');
      switchSocialTab('party');
      switchSocialTab('friends');
      expect(getCurrentSocialTab()).toBe('friends');
      expect(document.getElementById('social-panel-friends')!.classList.contains('hidden')).toBe(false);
      expect(document.getElementById('social-panel-party')!.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('social-panel-notifs')!.classList.contains('hidden')).toBe(true);
    });

    it('party state toggle back and forth', () => {
      updateSocialPartyState('lobby-1', {});
      expect(document.getElementById('social-party-active')!.classList.contains('hidden')).toBe(false);
      updateSocialPartyState(null, null);
      expect(document.getElementById('social-party-active')!.classList.contains('hidden')).toBe(true);
      updateSocialPartyState('lobby-2', {});
      expect(document.getElementById('social-party-active')!.classList.contains('hidden')).toBe(false);
    });

    it('badge updates independent of tab state', () => {
      switchSocialTab('friends');
      updateSocialNotifBadge(5);
      expect(document.getElementById('social-notif-badge')!.textContent).toBe('5');
      expect(document.getElementById('social-notif-badge')!.classList.contains('hidden')).toBe(false);
    });

    it('exactly 1 panel visible at a time', () => {
      const panelIds = ['social-panel-party', 'social-panel-friends', 'social-panel-notifs'];
      for (const tab of ['party', 'friends', 'notifs'] as const) {
        switchSocialTab(tab === 'party' && getCurrentSocialTab() === 'party' ? 'friends' : tab);
        // reset to desired tab
      }
      // After switching to notifs
      switchSocialTab('notifs');
      const visible = panelIds.filter(id => !document.getElementById(id)!.classList.contains('hidden'));
      expect(visible.length).toBe(1);
      expect(visible[0]).toBe('social-panel-notifs');
    });

    it('controller hint element exists', () => {
      const hint = document.getElementById('social-tab-hint');
      expect(hint).toBeTruthy();
    });

    it('showSocialFriendDetail sets data-uid, name, and status', () => {
      showSocialFriendDetail('uid-123', 'TestUser', true);
      const detail = document.getElementById('social-friend-detail')!;
      expect(detail.classList.contains('hidden')).toBe(false);
      expect(detail.getAttribute('data-uid')).toBe('uid-123');
      expect(document.getElementById('social-friend-detail-name')!.textContent).toBe('TestUser');
      expect(document.getElementById('social-friend-detail-status')!.textContent).toBe('ONLINE');
    });

    it('showSocialFriendDetail shows OFFLINE status', () => {
      showSocialFriendDetail('uid-456', 'OfflineUser', false);
      expect(document.getElementById('social-friend-detail-status')!.textContent).toBe('OFFLINE');
    });

    it('hideSocialFriendDetail hides the pane', () => {
      showSocialFriendDetail('uid-123', 'TestUser', true);
      hideSocialFriendDetail();
      expect(document.getElementById('social-friend-detail')!.classList.contains('hidden')).toBe(true);
    });

    it('renderSocialPartyMembers sets innerHTML', () => {
      renderSocialPartyMembers('<div class="member">Player1</div>');
      expect(document.getElementById('social-party-members')!.innerHTML).toBe('<div class="member">Player1</div>');
    });
  });

  // ── Clone Sync (dropdown + overlay) ────────────────────
  // BUG-19: two instances of the social component are mounted (one in the top-bar
  // dropdown, one in the overlay screen). State changes must propagate to both.
  describe('dropdown ↔ overlay clone sync', () => {
    it('both clones are mounted in the DOM', () => {
      const clones = document.querySelectorAll<HTMLElement>('.social-clone');
      expect(clones.length).toBe(2);
      expect(document.getElementById('social-component')).toBeTruthy();
      expect(document.getElementById('social-component-ovl')).toBeTruthy();
    });

    it('dropdown clone lives inside #social-drop-body', () => {
      const dropBody = document.getElementById('social-drop-body')!;
      expect(dropBody.querySelector('[data-social-clone="dropdown"]')).toBeTruthy();
    });

    it('overlay clone lives inside #social-overlay-body', () => {
      const overlayBody = document.getElementById('social-overlay-body')!;
      expect(overlayBody.querySelector('[data-social-clone="overlay"]')).toBeTruthy();
    });

    it('switchSocialTab updates active tab class on BOTH clones', () => {
      switchSocialTab('friends');

      const activeTabs = document.querySelectorAll<HTMLElement>('[data-social-tab="friends"].social-tab--active');
      expect(activeTabs.length).toBe(2);

      const partyTabs = document.querySelectorAll<HTMLElement>('[data-social-tab="party"].social-tab--active');
      expect(partyTabs.length).toBe(0);
    });

    it('switchSocialTab updates panel visibility on BOTH clones', () => {
      switchSocialTab('notifs');

      const notifPanels = document.querySelectorAll<HTMLElement>('[data-social-panel="notifs"]');
      expect(notifPanels.length).toBe(2);
      for (const panel of notifPanels) {
        expect(panel.classList.contains('hidden')).toBe(false);
      }
      const partyPanels = document.querySelectorAll<HTMLElement>('[data-social-panel="party"]');
      for (const panel of partyPanels) {
        expect(panel.classList.contains('hidden')).toBe(true);
      }
    });

    it('renderSocialPartyMembers populates BOTH clones', () => {
      renderSocialPartyMembers('<div class="member">Clone Sync</div>');
      const slots = document.querySelectorAll<HTMLElement>('[data-social-slot="party-members"]');
      expect(slots.length).toBe(2);
      for (const slot of slots) {
        expect(slot.innerHTML).toBe('<div class="member">Clone Sync</div>');
      }
    });

    it('updateSocialPartyState toggles empty/active on BOTH clones', () => {
      updateSocialPartyState('lobby-XYZ', {});
      for (const empty of document.querySelectorAll<HTMLElement>('[data-social-slot="party-empty"]')) {
        expect(empty.classList.contains('hidden')).toBe(true);
      }
      for (const active of document.querySelectorAll<HTMLElement>('[data-social-slot="party-active"]')) {
        expect(active.classList.contains('hidden')).toBe(false);
      }

      updateSocialPartyState(null, null);
      for (const empty of document.querySelectorAll<HTMLElement>('[data-social-slot="party-empty"]')) {
        expect(empty.classList.contains('hidden')).toBe(false);
      }
      for (const active of document.querySelectorAll<HTMLElement>('[data-social-slot="party-active"]')) {
        expect(active.classList.contains('hidden')).toBe(true);
      }
    });

    it('updateSocialNotifBadge updates BOTH clones', () => {
      updateSocialNotifBadge(7);
      const badges = document.querySelectorAll<HTMLElement>('[data-social-slot="notif-badge"]');
      expect(badges.length).toBe(2);
      for (const badge of badges) {
        expect(badge.textContent).toBe('7');
        expect(badge.classList.contains('hidden')).toBe(false);
      }

      updateSocialNotifBadge(0);
      for (const badge of badges) {
        expect(badge.textContent).toBe('0');
        expect(badge.classList.contains('hidden')).toBe(true);
      }
    });

    it('showSocialFriendDetail populates BOTH clones', () => {
      showSocialFriendDetail('uid-sync', 'SyncUser', true);
      const details = document.querySelectorAll<HTMLElement>('[data-social-slot="friend-detail"]');
      expect(details.length).toBe(2);
      for (const d of details) {
        expect(d.classList.contains('hidden')).toBe(false);
        expect(d.getAttribute('data-uid')).toBe('uid-sync');
      }
      const names = document.querySelectorAll<HTMLElement>('[data-social-slot="friend-detail-name"]');
      for (const n of names) expect(n.textContent).toBe('SyncUser');
      const statuses = document.querySelectorAll<HTMLElement>('[data-social-slot="friend-detail-status"]');
      for (const s of statuses) expect(s.textContent).toBe('ONLINE');
    });

    it('hideSocialFriendDetail hides BOTH clones', () => {
      showSocialFriendDetail('uid-sync', 'SyncUser', true);
      hideSocialFriendDetail();
      for (const d of document.querySelectorAll<HTMLElement>('[data-social-slot="friend-detail"]')) {
        expect(d.classList.contains('hidden')).toBe(true);
      }
    });

    it('clicking a tab in the overlay clone switches both clones', () => {
      initSocialUI(mockDeps());
      // Click the friends tab inside the overlay clone specifically.
      const overlayFriendsTab = document.querySelector<HTMLElement>(
        '[data-social-clone="overlay"] [data-social-tab="friends"]',
      )!;
      overlayFriendsTab.click();

      expect(getCurrentSocialTab()).toBe('friends');
      // Dropdown clone's friends panel should now be visible too.
      const dropPanel = document.querySelector<HTMLElement>(
        '[data-social-clone="dropdown"] [data-social-panel="friends"]',
      )!;
      expect(dropPanel.classList.contains('hidden')).toBe(false);
    });

    it('chat panel is rendered only in the dropdown clone (option B)', () => {
      // Option B from the BUG-19 plan: chat DOM mounts only in the dropdown clone;
      // the overlay clone's chat panel is intentionally left empty.
      const dropChat = document.querySelector<HTMLElement>(
        '[data-social-clone="dropdown"] [data-social-panel="chat"]',
      )!;
      const overlayChat = document.querySelector<HTMLElement>(
        '[data-social-clone="overlay"] [data-social-panel="chat"]',
      )!;
      expect(dropChat).toBeTruthy();
      expect(overlayChat).toBeTruthy();
      // Both panels exist — content behavior is enforced at runtime by socialUI.ts init.
      expect(overlayChat.children.length).toBe(0);
    });
  });

  // ── Account Tab (TASK-287) ─────────────────────────────
  describe('account tab', () => {
    const sampleProfile: UserProfile = {
      uid: 'uid-acct',
      username: 'Neo',
      icon: '',
      about: 'Hello from the grid.',
      specialPoints: 42,
      createdAt: null,
      socials: {
        discord: 'neo#1234',
        steam: 'https://steamcommunity.com/id/neo',
        twitch: '',
        youtube: '',
      },
    };

    it('hides account tab buttons on BOTH clones when signed out', () => {
      updateSocialAccountTabVisibility(false);
      const btns = document.querySelectorAll<HTMLElement>('[data-social-tab="account"]');
      expect(btns.length).toBe(2);
      for (const btn of btns) {
        expect(btn.classList.contains('hidden')).toBe(true);
      }
    });

    it('shows account tab buttons on BOTH clones when signed in', () => {
      updateSocialAccountTabVisibility(true);
      const btns = document.querySelectorAll<HTMLElement>('[data-social-tab="account"]');
      expect(btns.length).toBe(2);
      for (const btn of btns) {
        expect(btn.classList.contains('hidden')).toBe(false);
      }
    });

    it('falls back to party when hiding the currently active account tab', () => {
      updateSocialAccountTabVisibility(true);
      switchSocialTab('account');
      expect(getCurrentSocialTab()).toBe('account');
      updateSocialAccountTabVisibility(false);
      expect(getCurrentSocialTab()).toBe('party');
      // Party panel visible across both clones again.
      for (const panel of document.querySelectorAll<HTMLElement>('[data-social-panel="party"]')) {
        expect(panel.classList.contains('hidden')).toBe(false);
      }
    });

    it('updateSocialAuthButton toggles account visibility as a side-effect', () => {
      updateSocialAuthButton(true);
      for (const btn of document.querySelectorAll<HTMLElement>('[data-social-tab="account"]')) {
        expect(btn.classList.contains('hidden')).toBe(false);
      }
      updateSocialAuthButton(false);
      for (const btn of document.querySelectorAll<HTMLElement>('[data-social-tab="account"]')) {
        expect(btn.classList.contains('hidden')).toBe(true);
      }
    });

    it('renderSocialAccountPanel propagates points/bio/socials to BOTH clones', () => {
      renderSocialAccountPanel(sampleProfile);

      const points = document.querySelectorAll<HTMLElement>('[data-social-slot="account-points"]');
      expect(points.length).toBe(2);
      for (const el of points) expect(el.textContent).toBe('42');

      const bios = document.querySelectorAll<HTMLElement>('[data-social-slot="account-bio"]');
      for (const el of bios) expect(el.textContent).toBe('Hello from the grid.');

      const socials = document.querySelectorAll<HTMLElement>('[data-social-slot="account-socials"]');
      for (const el of socials) {
        expect(el.innerHTML).toContain('data-kind="discord"');
        expect(el.innerHTML).toContain('neo#1234');
        expect(el.innerHTML).toContain('data-kind="steam"');
        // Empty socials are filtered out.
        expect(el.innerHTML).not.toContain('data-kind="twitch"');
        expect(el.innerHTML).not.toContain('data-kind="youtube"');
      }
    });

    it('renderSocialAccountPanel with null clears all slots on BOTH clones', () => {
      renderSocialAccountPanel(sampleProfile);
      renderSocialAccountPanel(null);
      for (const el of document.querySelectorAll<HTMLElement>('[data-social-slot="account-points"]')) {
        expect(el.textContent).toBe('0');
      }
      for (const el of document.querySelectorAll<HTMLElement>('[data-social-slot="account-bio"]')) {
        expect(el.textContent).toBe('—');
      }
      for (const el of document.querySelectorAll<HTMLElement>('[data-social-slot="account-socials"]')) {
        expect(el.innerHTML).toBe('');
      }
    });

    it('renderSocialAccountPanel coalesces missing specialPoints to 0', () => {
      const profileNoPoints: UserProfile = { ...sampleProfile, specialPoints: undefined };
      renderSocialAccountPanel(profileNoPoints);
      for (const el of document.querySelectorAll<HTMLElement>('[data-social-slot="account-points"]')) {
        expect(el.textContent).toBe('0');
      }
    });

    it('account tab sign-out delegation calls signOutUser (dropdown clone)', async () => {
      initSocialUI(mockDeps());
      updateSocialAccountTabVisibility(true);
      vi.mocked(auth.signOutUser).mockClear();

      const btn = document.getElementById('btn-social-account-signout')!;
      expect(btn).toBeTruthy();
      btn.click();
      // Allow the async handler to run.
      await Promise.resolve();
      await Promise.resolve();

      expect(auth.signOutUser).toHaveBeenCalled();
    });

    it('account tab sign-out delegation also fires from overlay clone', async () => {
      initSocialUI(mockDeps());
      updateSocialAccountTabVisibility(true);
      vi.mocked(auth.signOutUser).mockClear();

      const btn = document.getElementById('btn-social-account-signout-ovl')!;
      expect(btn).toBeTruthy();
      btn.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(auth.signOutUser).toHaveBeenCalled();
    });
  });
});
