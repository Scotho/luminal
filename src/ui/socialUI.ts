// ── Social UI Module ────────────────────────────────────
// Manages the SOCIAL component: tab switching, party/friends/notifs panels,
// controller availability, and badge updates.
//
// The social component is rendered as TWO clones: one inside the top-bar
// dropdown (`#social-drop-body`), and one inside the overlay screen
// (`#social-overlay-body`). Both stay permanently mounted. Helpers in this
// module operate on `[data-social-*]` NodeLists so every state change
// propagates to BOTH clones at once.
//
// NOTE: Party tab reuses lobby state/rendering but does not embed inside Lobby.
// Lobby reuse was deferred — SOCIAL Party + "GO TO LOBBY" navigation handles
// the controller/mobile flow. See docs/superpowers/plans/2026-03-29-social-menu.md Task 13.

import { isGamepadConnected, getForceKeyboard } from '../gamepad';
import { signOutUser } from '../auth';
import { initPresence } from '../presence';
import { toggleVisible, confirmButton, escapeHtml } from './dom';
import { cycleIndex } from './controls';
import { reparentChatToSocial, scrollActiveChatToBottom } from './chatUI';
import { playUiTab } from '../sfx';
import type { UserProfile } from '../profile';

// ── Types ──────────────────────────────────────────────
export type SocialTab = 'party' | 'friends' | 'notifs' | 'chat' | 'account';

// ── Constants ──────────────────────────────────────────
const TAB_ORDER: SocialTab[] = ['party', 'friends', 'notifs', 'chat', 'account'];
const TABLET_BREAKPOINT = 1024;

// ── Dependencies ───────────────────────────────────────
interface SocialUIDeps {
  navigateTo: (screen: string) => void;
  navigateBack: () => void;
  getCurrentLobbyId: () => string | null;
  getMyRole: () => 'host' | 'guest' | null;
  createParty: () => void;
  leaveParty: () => void;
  currentUid: string | null;
  currentUsername: string | null;
  isRealUser: boolean;
}

// ── State ──────────────────────────────────────────────
let _currentTab: SocialTab = 'party';
let _deps: SocialUIDeps | null = null;

// ── DOM helpers ────────────────────────────────────────
function slotAll(slot: string): NodeListOf<HTMLElement> {
  return document.querySelectorAll<HTMLElement>(`[data-social-slot="${slot}"]`);
}

// ── Exports ────────────────────────────────────────────

export function isSocialAvailable(): boolean {
  const controllerActive = isGamepadConnected() && !getForceKeyboard();
  const smallViewport = window.innerWidth <= TABLET_BREAKPOINT;
  return controllerActive || smallViewport;
}

// ts-prune-ignore-next
export function getCurrentSocialTab(): SocialTab {
  return _currentTab;
}

export function switchSocialTab(tab: SocialTab): void {
  if (tab === _currentTab) return;
  playUiTab();
  _currentTab = tab;

  // Update every tab button across all clones.
  for (const btn of document.querySelectorAll<HTMLElement>('[data-social-tab]')) {
    const isActive = btn.dataset.socialTab === tab;
    btn.classList.toggle('social-tab--active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  }

  // Update every panel across all clones.
  for (const panel of document.querySelectorAll<HTMLElement>('[data-social-panel]')) {
    toggleVisible(panel, panel.dataset.socialPanel === tab);
  }

  // Snap chat to latest on activation — without this, a long scrollback opens
  // at the top, pushing recent messages off-screen.
  if (tab === 'chat') {
    requestAnimationFrame(scrollActiveChatToBottom);
  }
}

function _isTabVisible(tab: SocialTab): boolean {
  // A tab counts as visible if at least one clone's button is not hidden.
  for (const btn of document.querySelectorAll<HTMLElement>(`[data-social-tab="${tab}"]`)) {
    if (!btn.classList.contains('hidden')) return true;
  }
  return false;
}

export function cycleSocialTab(direction: 1 | -1): void {
  // Skip tabs whose buttons are hidden (e.g. ACCOUNT when signed out).
  let idx = TAB_ORDER.indexOf(_currentTab);
  for (let i = 0; i < TAB_ORDER.length; i++) {
    idx = cycleIndex(idx, direction, TAB_ORDER.length);
    const candidate = TAB_ORDER[idx];
    if (candidate === _currentTab) return;
    if (_isTabVisible(candidate)) {
      switchSocialTab(candidate);
      return;
    }
  }
}

export function initSocialUI(deps: SocialUIDeps): void {
  _deps = deps;

  // Tab click handlers — one delegated listener so both clones work without double-binding.
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    if (!target) return;
    const btn = target.closest<HTMLElement>('[data-social-tab]');
    if (btn?.dataset.socialTab) {
      switchSocialTab(btn.dataset.socialTab as SocialTab);
    }
  });

  // Controller hint visibility
  updateControllerHintVisibility();

  // ── Party action buttons ──────────────────────────────
  // CREATE PARTY — create lobby then navigate to it.
  // Delegated so both clones' CREATE buttons work.
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    if (target?.closest('[data-social-slot="btn-create-party"]')) {
      if (_deps) _deps.createParty();
    }
  });

  // SIGN IN / SIGN OUT (exists only once in the header — overlay clone inherits via data-slot if duplicated).
  document.getElementById('btn-social-signin')?.addEventListener('click', async () => {
    if (_deps?.isRealUser) {
      await signOutUser();
      initPresence();
    } else {
      _deps?.navigateTo('login');
    }
  });
  updateSocialAuthButton(_deps?.isRealUser ?? false);

  // Account-tab SIGN OUT — delegated so both clones' buttons fire the same handler.
  document.addEventListener('click', async (e) => {
    const target = e.target as Element | null;
    if (!target?.closest('[data-social-action="signout"]')) return;
    await signOutUser();
    initPresence();
  });

  // GO TO LOBBY
  document.getElementById('btn-social-party-lobby')?.addEventListener('click', () => {
    if (_deps) _deps.navigateTo('lobby');
  });

  // COPY INVITE — delegated across clones.
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    if (target?.closest('[data-social-slot="btn-copy-invite"]')) {
      const lobbyId = _deps?.getCurrentLobbyId();
      if (lobbyId) {
        navigator.clipboard.writeText(`${window.location.origin}/?join=${lobbyId}`).catch(() => {});
      }
    }
  });

  // LEAVE PARTY — double-click confirmation on every clone.
  for (const btn of slotAll('btn-leave-party')) {
    confirmButton(btn, () => { deps.leaveParty(); });
  }

  // ── Friends add button ──────────────────────────────────
  // Sync input to main friends input and trigger add (delegated over both clones).
  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const addBtn = target?.closest<HTMLElement>('[data-social-slot="btn-friends-add"]');
    if (!addBtn) return;
    // Find the sibling input in the same clone.
    const clone = addBtn.closest<HTMLElement>('.social-clone');
    const input = clone?.querySelector<HTMLInputElement>('[data-social-slot="friends-add-input"]');
    if (!input) return;
    const username = input.value.trim();
    if (!username) return;

    const mainInput = document.getElementById('friends-add-input') as HTMLInputElement | null;
    if (mainInput) {
      mainInput.value = username;
      document.getElementById('btn-friends-add')?.click();
    }
    input.value = '';
  });

  // Also allow Enter key in the social friends input (both clones).
  document.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Enter') return;
    const target = e.target as Element | null;
    const input = target?.closest<HTMLElement>('[data-social-slot="friends-add-input"]');
    if (!input) return;
    const clone = input.closest<HTMLElement>('.social-clone');
    const addBtn = clone?.querySelector<HTMLElement>('[data-social-slot="btn-friends-add"]');
    addBtn?.click();
  });

  // Embed chat inside the dropdown CHAT tab panel only.
  // Option B from the plan: the chat DOM is a single set of input/message containers
  // that can't be cheaply duplicated, so the overlay's chat panel is intentionally
  // left empty. On overlay-enabled devices, users access chat via the dropdown clone.
  const chatPanel = document.getElementById('social-panel-chat');
  if (chatPanel) reparentChatToSocial(chatPanel);
}

function updateControllerHintVisibility(): void {
  const controllerActive = isGamepadConnected() && !getForceKeyboard();
  for (const hint of slotAll('tab-hint')) {
    toggleVisible(hint, controllerActive);
  }
}

export function updateSocialButtonVisibility(): void {
  const btn = document.getElementById('btn-social');
  if (btn) {
    toggleVisible(btn, isSocialAvailable());
  }
}

export function updateSocialPartyState(lobbyId: string | null, _lobbyData: unknown): void {
  const inParty = lobbyId != null;
  for (const empty of slotAll('party-empty')) toggleVisible(empty, !inParty);
  for (const active of slotAll('party-active')) toggleVisible(active, inParty);
}

export function renderSocialPartyMembers(membersHtml: string): void {
  for (const el of slotAll('party-members')) {
    el.innerHTML = membersHtml;
  }
}

export function updateSocialNotifBadge(count: number): void {
  for (const badge of slotAll('notif-badge')) {
    badge.textContent = String(count);
    toggleVisible(badge, count > 1);
  }
}

// ── Party badge on top bar icon ──────────────────────────
export function updateSocialPartyBadge(humanCount: number): void {
  const badge = document.getElementById('social-icon-badge');
  if (badge) {
    badge.textContent = String(humanCount);
    toggleVisible(badge, humanCount >= 1);
  }
}

// ts-prune-ignore-next
export function showSocialFriendDetail(uid: string, username: string, isOnline: boolean): void {
  for (const detail of slotAll('friend-detail')) {
    toggleVisible(detail, true);
    detail.setAttribute('data-uid', uid);
  }
  for (const nameEl of slotAll('friend-detail-name')) {
    nameEl.textContent = username;
  }
  for (const statusEl of slotAll('friend-detail-status')) {
    statusEl.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
  }
}

// ts-prune-ignore-next
export function hideSocialFriendDetail(): void {
  for (const detail of slotAll('friend-detail')) {
    toggleVisible(detail, false);
  }
}

export function updateSocialAuthButton(isReal: boolean): void {
  if (_deps) _deps.isRealUser = isReal;
  const btn = document.getElementById('btn-social-signin');
  if (btn) {
    const label = btn.querySelector('.social-header-auth-label');
    const icon = btn.querySelector('.icon use');
    if (isReal) {
      if (label) label.textContent = 'SIGN OUT';
      if (icon) icon.setAttribute('href', '/icons.svg#i-x');
    } else {
      if (label) label.textContent = 'SIGN IN';
      if (icon) icon.setAttribute('href', '/icons.svg#i-user');
    }
  }
  updateSocialAccountTabVisibility(isReal);
}

// ── Account tab helpers ────────────────────────────────
// The account tab is gated on "real" (non-anonymous) sign-in. When hidden
// while active, we fall back to the party tab. Both clones are updated via
// a single NodeList pass so dropdown + overlay stay in sync.
export function updateSocialAccountTabVisibility(isReal: boolean): void {
  for (const btn of document.querySelectorAll<HTMLElement>('[data-social-tab="account"]')) {
    btn.classList.toggle('hidden', !isReal);
  }
  // If account was the active tab and we're hiding it, fall back to party.
  if (!isReal && _currentTab === 'account') {
    switchSocialTab('party');
  }
}

export function renderSocialAccountPanel(profile: UserProfile | null): void {
  const points = profile?.specialPoints ?? 0;
  for (const el of slotAll('account-points')) {
    el.textContent = String(points);
  }
  const bio = (profile?.about ?? '').trim();
  for (const el of slotAll('account-bio')) {
    el.textContent = bio || '—';
  }
  const socialsHtml = _renderSocialsHtml(profile?.socials);
  for (const el of slotAll('account-socials')) {
    el.innerHTML = socialsHtml;
  }
}

function _renderSocialsHtml(socials?: UserProfile['socials']): string {
  if (!socials) return '';
  // Social glyph icons (i-discord/i-steam/...) are not present in icons.svg,
  // so badges are text-only. Labels come from the key itself.
  const entries: Array<[keyof NonNullable<UserProfile['socials']>, string]> = [
    ['discord', socials.discord],
    ['steam',   socials.steam],
    ['twitch',  socials.twitch],
    ['youtube', socials.youtube],
  ];
  return entries
    .filter(([, val]) => val && val.trim().length > 0)
    .map(([key, val]) =>
      `<a class="social-account-socials-badge" data-kind="${key}" href="${escapeHtml(val)}" target="_blank" rel="noopener"><span class="social-account-socials-badge-key">${key.toUpperCase()}</span><span class="social-account-socials-badge-val">${escapeHtml(val)}</span></a>`,
    )
    .join('');
}

export function _resetForTesting(): void {
  _currentTab = 'party';
  _deps = null;
}
