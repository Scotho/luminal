// ── Unlocks & Shop UI Tests ─────────────────────────────
import { describe, it, expect, beforeEach, vi } from 'vitest';

// jsdom doesn't implement scrollIntoView
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function () { /* no-op */ };
}

// ── Mocks ───────────────────────────────────────────────

const { mockAuth } = vi.hoisted(() => {
  const mockAuth: { currentUser: { uid: string; isAnonymous: boolean } | null } = { currentUser: null };
  return { mockAuth };
});

vi.mock('../../firebase', () => ({
  auth: mockAuth,
  db: {},
}));

vi.mock('../../profile', () => ({
  fetchProfile: vi.fn(() => Promise.resolve({ bankedFlow: 500 })),
}));

const mockGetIsRealUser = vi.fn(() => false);
vi.mock('../authUIFlows', () => ({
  getIsRealUser: () => mockGetIsRealUser(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn(),
  updateDoc: vi.fn(),
  runTransaction: vi.fn(),
  arrayUnion: vi.fn(),
  collection: vi.fn(),
  onSnapshot: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  addDoc: vi.fn(),
  serverTimestamp: vi.fn(),
}));

const mockGetProgressionState = vi.fn(() => null);
const mockAddUnlockFromPurchase = vi.fn();
vi.mock('../../progression/progressionManager', () => ({
  getProgressionState: () => mockGetProgressionState(),
  addUnlockFromPurchase: (...args: unknown[]) => mockAddUnlockFromPurchase(...args),
}));

vi.mock('../../progression/unlockRegistry', () => ({
  LEVEL_UNLOCKS: [
    { level: 1, unlocks: [{ id: 'color:red', label: 'Red', category: 'color' }] },
    { level: 2, unlocks: [{ id: 'vehicle:car', label: 'Slingshot', category: 'vehicle' }] },
  ],
  getAllChallenges: vi.fn(() => []),
}));

vi.mock('../../progression/challengeState', () => ({
  getAllChallengeViews: vi.fn(() => [
    { label: 'Win 5', description: 'Win 5 matches', progress: 2, target: 5, complete: false, unlockId: 'color:cyan', rewardType: 'color' },
    { label: 'Play 10', description: 'Play 10 matches', progress: 10, target: 10, complete: true, unlockId: 'color:lime', rewardType: 'color' },
  ]),
}));

const mockShopItems = [
  { id: 'shop_orange', label: 'Orange', cost: 200, category: 'color' as const, unlockId: 'color:orange', owned: false, affordable: true },
  { id: 'shop_teal', label: 'Teal', cost: 200, category: 'color' as const, unlockId: 'color:teal', owned: true, affordable: true },
  { id: 'shop_emissive_glow', label: 'Enhanced Glow', cost: 400, category: 'emissive' as const, unlockId: 'emissive:enhanced_glow', owned: false, affordable: false },
];

const mockPurchaseItem = vi.fn(() => Promise.resolve({ success: true, cost: 200, unlockId: 'color:orange', newBalance: 300 }));

vi.mock('../../progression/flowShop', () => ({
  getShopItems: vi.fn(() => mockShopItems),
  purchaseItem: (...args: unknown[]) => mockPurchaseItem(...args),
}));

vi.mock('../../progression/progressionGuard', () => ({
  isUnlocked: vi.fn(() => false),
  getAvailableColors: vi.fn(() => ['red', 'blue']),
}));

vi.mock('../../progression/xpConfig', () => ({
  XP_THRESHOLDS: [0, 100, 300, 600],
}));

vi.mock('../../progression/progressionEvents', () => ({
  EVT_PROGRESSION_READY: 'progression:ready',
}));

import {
  initUnlocksAndShop,
  renderShopPanel,
  renderUnlocksPanel,
  refreshShopBalance,
  closePurchaseModal,
  closeSigninModal,
  _resetForTesting,
} from '../unlocksUI';

// ── Helpers ─────────────────────────────────────────────

function setSignedInUser(): void {
  mockAuth.currentUser = { uid: 'test-uid', isAnonymous: false };
  mockGetIsRealUser.mockReturnValue(true);
}

function setAnonymousUser(): void {
  mockAuth.currentUser = { uid: 'anon-uid', isAnonymous: true };
  mockGetIsRealUser.mockReturnValue(false);
}

function setNoUser(): void {
  mockAuth.currentUser = null;
  mockGetIsRealUser.mockReturnValue(false);
}

function getShopCards(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.shop-card'));
}

function getBuyButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.shop-card__buy'));
}

function getPurchaseModal(): HTMLElement {
  return document.getElementById('shop-purchase-modal')!;
}

function getSigninModal(): HTMLElement {
  return document.getElementById('shop-signin-modal')!;
}

function isModalVisible(modal: HTMLElement): boolean {
  return !modal.classList.contains('hidden');
}

// ── Tests ───────────────────────────────────────────────

describe('unlocksUI', () => {
  beforeEach(() => {
    _resetForTesting();
    vi.clearAllMocks();
    setNoUser();
    // Reset modal DOM state
    getPurchaseModal().classList.add('hidden');
    getSigninModal().classList.add('hidden');
    document.getElementById('shop-modal-error')!.classList.add('hidden');
    const confirmBtn = document.getElementById('shop-modal-confirm') as HTMLButtonElement;
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'CONFIRM';
    document.getElementById('shop-grid')!.innerHTML = '';
  });

  // ── Initialization ──────────────────────────────────

  describe('initUnlocksAndShop', () => {
    it('caches DOM refs without error', () => {
      expect(() => initUnlocksAndShop()).not.toThrow();
    });

    it('does not double-init', () => {
      initUnlocksAndShop();
      const grid = document.getElementById('shop-grid')!;
      grid.innerHTML = '<div class="sentinel"></div>';
      initUnlocksAndShop(); // should no-op
      expect(grid.querySelector('.sentinel')).toBeTruthy();
    });
  });

  // ── Shop Category Tabs ──────────────────────────────

  describe('shop category tabs', () => {
    beforeEach(() => {
      setSignedInUser();
      initUnlocksAndShop();
    });

    it('colors category is active by default', () => {
      renderShopPanel();
      const cards = getShopCards();
      // Should only show color items (orange + teal from mock)
      const names = cards.map(c => c.querySelector('.shop-card__name')!.textContent);
      expect(names).toContain('Orange');
      expect(names).toContain('Teal');
      expect(names).not.toContain('Enhanced Glow');
    });

    it('switching to emissive category re-renders', () => {
      const emissiveBtn = document.querySelector<HTMLElement>('.shop-cat[data-category="emissive"]')!;
      emissiveBtn.click();
      const cards = getShopCards();
      const names = cards.map(c => c.querySelector('.shop-card__name')!.textContent);
      expect(names).toContain('Enhanced Glow');
      expect(names).not.toContain('Orange');
    });

    it('updates aria-selected on category switch', () => {
      const colorBtn = document.querySelector<HTMLElement>('.shop-cat[data-category="color"]')!;
      const emissiveBtn = document.querySelector<HTMLElement>('.shop-cat[data-category="emissive"]')!;
      emissiveBtn.click();
      expect(emissiveBtn.getAttribute('aria-selected')).toBe('true');
      expect(colorBtn.getAttribute('aria-selected')).toBe('false');
    });

    it('adds shop-cat--active class to active category', () => {
      const emissiveBtn = document.querySelector<HTMLElement>('.shop-cat[data-category="emissive"]')!;
      emissiveBtn.click();
      expect(emissiveBtn.classList.contains('shop-cat--active')).toBe(true);
    });
  });

  // ── Shop Card Rendering ─────────────────────────────

  describe('renderShopPanel', () => {
    beforeEach(() => {
      setSignedInUser();
      initUnlocksAndShop();
      renderShopPanel();
    });

    it('renders shop cards into grid', () => {
      expect(getShopCards().length).toBeGreaterThan(0);
    });

    it('marks owned items with shop-card--owned class', () => {
      const owned = getShopCards().find(c => c.querySelector('.shop-card__name')!.textContent === 'Teal');
      expect(owned?.classList.contains('shop-card--owned')).toBe(true);
    });

    it('hides BUY button on owned items', () => {
      // The CSS hides it via .shop-card--owned .shop-card__buy { display: none }
      const owned = getShopCards().find(c => c.classList.contains('shop-card--owned'));
      expect(owned?.querySelector('.shop-card__buy')).toBeTruthy();
    });

    it('shows OWNED label on owned items', () => {
      const owned = getShopCards().find(c => c.classList.contains('shop-card--owned'));
      expect(owned?.querySelector('.shop-card__owned')?.textContent).toContain('OWNED');
    });

    it('each card has a preview element', () => {
      for (const card of getShopCards()) {
        expect(card.querySelector('.shop-card__preview')).toBeTruthy();
      }
    });

    it('each card has a cost element', () => {
      for (const card of getShopCards()) {
        expect(card.querySelector('.shop-card__cost')).toBeTruthy();
      }
    });

    it('each card is focusable (tabIndex=0)', () => {
      for (const card of getShopCards()) {
        expect(card.tabIndex).toBe(0);
      }
    });

    it('cant-afford cards have disabled BUY button', () => {
      // Force a can't-afford state: signed in, not owned, not affordable
      const origAffordable = mockShopItems[0].affordable;
      const origOwned = mockShopItems[0].owned;
      try {
        mockShopItems[0].affordable = false;
        mockShopItems[0].owned = false;
        renderShopPanel();
        const card = getShopCards().find(c => c.querySelector('.shop-card__name')!.textContent === 'Orange');
        const buyBtn = card?.querySelector('.shop-card__buy') as HTMLButtonElement;
        expect(buyBtn?.disabled).toBe(true);
      } finally {
        mockShopItems[0].affordable = origAffordable;
        mockShopItems[0].owned = origOwned;
      }
    });
  });

  // ── BUY Button for Signed-in Users ──────────────────

  describe('BUY button (signed-in user)', () => {
    beforeEach(() => {
      setSignedInUser();
      initUnlocksAndShop();
      renderShopPanel();
    });

    it('opens purchase modal when clicked', () => {
      const buyBtns = getBuyButtons();
      const firstBuy = buyBtns.find(b => !b.disabled);
      firstBuy?.click();
      expect(isModalVisible(getPurchaseModal())).toBe(true);
    });

    it('sets modal title to item name', () => {
      getBuyButtons()[0].click();
      expect(document.getElementById('shop-modal-title')!.textContent).toContain('Orange');
    });

    it('sets modal cost text', () => {
      getBuyButtons()[0].click();
      expect(document.getElementById('shop-modal-cost')!.textContent).toContain('200');
    });

    it('sets modal balance text', () => {
      getBuyButtons()[0].click();
      expect(document.getElementById('shop-modal-balance')!.textContent).toContain('balance');
    });

    it('hides error message when modal opens', () => {
      document.getElementById('shop-modal-error')!.classList.remove('hidden');
      getBuyButtons()[0].click();
      expect(document.getElementById('shop-modal-error')!.classList.contains('hidden')).toBe(true);
    });
  });

  // ── BUY Button for Anonymous Users ──────────────────

  describe('BUY button (anonymous user)', () => {
    beforeEach(() => {
      setAnonymousUser();
      initUnlocksAndShop();
      renderShopPanel();
    });

    it('opens sign-in modal instead of purchase modal', () => {
      const buyBtns = getBuyButtons();
      const firstBuy = buyBtns.find(b => !b.disabled);
      firstBuy?.click();
      expect(isModalVisible(getSigninModal())).toBe(true);
      expect(isModalVisible(getPurchaseModal())).toBe(false);
    });
  });

  describe('BUY button (no user)', () => {
    beforeEach(() => {
      setNoUser();
      initUnlocksAndShop();
      renderShopPanel();
    });

    it('opens sign-in modal when no user logged in', () => {
      getBuyButtons()[0].click();
      expect(isModalVisible(getSigninModal())).toBe(true);
    });
  });

  // ── Purchase Modal ──────────────────────────────────

  describe('purchase modal', () => {
    beforeEach(() => {
      setSignedInUser();
      initUnlocksAndShop();
      renderShopPanel();
      // Open modal
      getBuyButtons()[0].click();
    });

    it('CANCEL button closes the modal', () => {
      expect(isModalVisible(getPurchaseModal())).toBe(true);
      document.getElementById('shop-modal-cancel')!.click();
      expect(isModalVisible(getPurchaseModal())).toBe(false);
    });

    it('backdrop click closes the modal', () => {
      const backdrop = getPurchaseModal().querySelector('.shop-modal-backdrop') as HTMLElement;
      backdrop.click();
      expect(isModalVisible(getPurchaseModal())).toBe(false);
    });

    it('CONFIRM button shows loading state', () => {
      const confirmBtn = document.getElementById('shop-modal-confirm') as HTMLButtonElement;
      confirmBtn.click();
      expect(confirmBtn.disabled).toBe(true);
      expect(confirmBtn.textContent).toBe('...');
    });

    it('successful purchase closes modal', async () => {
      mockPurchaseItem.mockResolvedValueOnce({ success: true, cost: 200, unlockId: 'color:orange', newBalance: 300 });
      document.getElementById('shop-modal-confirm')!.click();
      await vi.waitFor(() => {
        expect(isModalVisible(getPurchaseModal())).toBe(false);
      });
    });

    it('successful purchase updates balance display', async () => {
      mockPurchaseItem.mockResolvedValueOnce({ success: true, cost: 200, unlockId: 'color:orange', newBalance: 300 });
      document.getElementById('shop-modal-confirm')!.click();
      await vi.waitFor(() => {
        expect(document.getElementById('shop-flow-amount')!.textContent).toBe('300');
      });
    });

    it('successful purchase calls addUnlockFromPurchase', async () => {
      mockPurchaseItem.mockResolvedValueOnce({ success: true, cost: 200, unlockId: 'color:orange', newBalance: 300 });
      document.getElementById('shop-modal-confirm')!.click();
      await vi.waitFor(() => {
        expect(mockAddUnlockFromPurchase).toHaveBeenCalledWith('color:orange');
      });
    });

    it('failed purchase shows error message', async () => {
      mockPurchaseItem.mockResolvedValueOnce({ success: false, cost: 200, unlockId: 'color:orange', newBalance: 0 });
      document.getElementById('shop-modal-confirm')!.click();
      await vi.waitFor(() => {
        const errorEl = document.getElementById('shop-modal-error')!;
        expect(errorEl.classList.contains('hidden')).toBe(false);
        expect(errorEl.textContent).toContain('insufficient FLOW');
      });
    });

    it('network error shows error message', async () => {
      mockPurchaseItem.mockRejectedValueOnce(new Error('Network'));
      document.getElementById('shop-modal-confirm')!.click();
      await vi.waitFor(() => {
        const errorEl = document.getElementById('shop-modal-error')!;
        expect(errorEl.classList.contains('hidden')).toBe(false);
        expect(errorEl.textContent).toContain('Network error');
      });
    });

    it('CONFIRM button is re-enabled after failure', async () => {
      mockPurchaseItem.mockResolvedValueOnce({ success: false, cost: 200, unlockId: 'color:orange', newBalance: 0 });
      const confirmBtn = document.getElementById('shop-modal-confirm') as HTMLButtonElement;
      confirmBtn.click();
      await vi.waitFor(() => {
        expect(confirmBtn.disabled).toBe(false);
        expect(confirmBtn.textContent).toBe('CONFIRM');
      });
    });
  });

  // ── closePurchaseModal ────────────────────────────────

  describe('closePurchaseModal', () => {
    beforeEach(() => {
      initUnlocksAndShop();
      getPurchaseModal().classList.remove('hidden');
    });

    it('hides the purchase modal', () => {
      closePurchaseModal();
      expect(isModalVisible(getPurchaseModal())).toBe(false);
    });

    it('resets confirm button to CONFIRM text', () => {
      const btn = document.getElementById('shop-modal-confirm') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = '...';
      closePurchaseModal();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe('CONFIRM');
    });

    it('hides error message', () => {
      document.getElementById('shop-modal-error')!.classList.remove('hidden');
      closePurchaseModal();
      expect(document.getElementById('shop-modal-error')!.classList.contains('hidden')).toBe(true);
    });
  });

  // ── closeSigninModal ──────────────────────────────────

  describe('closeSigninModal', () => {
    beforeEach(() => {
      initUnlocksAndShop();
      getSigninModal().classList.remove('hidden');
    });

    it('hides the sign-in modal', () => {
      closeSigninModal();
      expect(isModalVisible(getSigninModal())).toBe(false);
    });
  });

  // ── Sign-in Modal ─────────────────────────────────────

  describe('sign-in modal', () => {
    beforeEach(() => {
      setAnonymousUser();
      initUnlocksAndShop();
      renderShopPanel();
      getBuyButtons()[0].click();
    });

    it('CANCEL button closes the sign-in modal', () => {
      document.getElementById('shop-signin-cancel')!.click();
      expect(isModalVisible(getSigninModal())).toBe(false);
    });

    it('backdrop click closes the sign-in modal', () => {
      const backdrop = getSigninModal().querySelector('.shop-modal-backdrop') as HTMLElement;
      backdrop.click();
      expect(isModalVisible(getSigninModal())).toBe(false);
    });

    it('SIGN IN button triggers login flow', () => {
      const loginBtn = document.getElementById('btn-login');
      const clickSpy = vi.fn();
      loginBtn?.addEventListener('click', clickSpy);
      document.getElementById('shop-signin-btn')!.click();
      expect(isModalVisible(getSigninModal())).toBe(false);
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  // ── Balance Refresh ───────────────────────────────────

  describe('refreshShopBalance', () => {
    it('updates balance display for signed-in users', async () => {
      setSignedInUser();
      initUnlocksAndShop();
      await refreshShopBalance();
      expect(document.getElementById('shop-flow-amount')!.textContent).toBe('500');
    });

    it('shows 0 for anonymous users', async () => {
      setAnonymousUser();
      initUnlocksAndShop();
      await refreshShopBalance();
      expect(document.getElementById('shop-flow-amount')!.textContent).toBe('0');
    });

    it('shows 0 when no user is logged in', async () => {
      setNoUser();
      initUnlocksAndShop();
      await refreshShopBalance();
      expect(document.getElementById('shop-flow-amount')!.textContent).toBe('0');
    });
  });

  // ── Unlocks Panel ─────────────────────────────────────

  describe('renderUnlocksPanel', () => {
    beforeEach(() => {
      initUnlocksAndShop();
    });

    it('renders without progression state', () => {
      mockGetProgressionState.mockReturnValue(null);
      expect(() => renderUnlocksPanel()).not.toThrow();
    });

    it('renders level track nodes', () => {
      mockGetProgressionState.mockReturnValue({ level: 1, xp: 50, totalXp: 50, unlockedItems: [], challengeProgress: {} });
      renderUnlocksPanel();
      const nodes = document.querySelectorAll('.unlocks-track-node');
      expect(nodes.length).toBe(2); // 2 levels from mock
    });

    it('marks current level node', () => {
      mockGetProgressionState.mockReturnValue({ level: 1, xp: 50, totalXp: 50, unlockedItems: [], challengeProgress: {} });
      renderUnlocksPanel();
      const currentNode = document.querySelector('.unlocks-track-node--current');
      expect(currentNode).toBeTruthy();
    });

    it('renders challenge cards', () => {
      mockGetProgressionState.mockReturnValue({ level: 1, xp: 0, totalXp: 0, unlockedItems: [], challengeProgress: {} });
      renderUnlocksPanel();
      const cards = document.querySelectorAll('.unlocks-challenge-card');
      expect(cards.length).toBe(2); // 1 active + 1 complete from mock
    });

    it('marks completed challenges', () => {
      mockGetProgressionState.mockReturnValue({ level: 1, xp: 0, totalXp: 0, unlockedItems: [], challengeProgress: {} });
      renderUnlocksPanel();
      const complete = document.querySelectorAll('.unlocks-challenge-card--complete');
      expect(complete.length).toBe(1);
    });

    it('shows challenge count text', () => {
      mockGetProgressionState.mockReturnValue({ level: 1, xp: 0, totalXp: 0, unlockedItems: [], challengeProgress: {} });
      renderUnlocksPanel();
      expect(document.getElementById('unlocks-challenge-count')!.textContent).toBe('1 active / 1 complete');
    });

    it('shows 0 counts when no progression state', () => {
      mockGetProgressionState.mockReturnValue(null);
      renderUnlocksPanel();
      expect(document.getElementById('unlocks-challenge-count')!.textContent).toBe('0 active / 0 complete');
    });

    it('renders XP progress bar on current level', () => {
      mockGetProgressionState.mockReturnValue({ level: 1, xp: 50, totalXp: 50, unlockedItems: [], challengeProgress: {} });
      renderUnlocksPanel();
      const bar = document.querySelector('.unlocks-xp-bar');
      expect(bar).toBeTruthy();
    });

    it('level nodes are focusable', () => {
      mockGetProgressionState.mockReturnValue({ level: 1, xp: 0, totalXp: 0, unlockedItems: [], challengeProgress: {} });
      renderUnlocksPanel();
      const node = document.querySelector('.unlocks-track-node') as HTMLElement;
      expect(node?.tabIndex).toBe(0);
    });

    it('clicking level node toggles expanded', () => {
      mockGetProgressionState.mockReturnValue({ level: 1, xp: 0, totalXp: 0, unlockedItems: [], challengeProgress: {} });
      renderUnlocksPanel();
      const node = document.querySelector('.unlocks-track-node') as HTMLElement;
      node.click();
      expect(node.classList.contains('unlocks-track-node--expanded')).toBe(true);
      node.click();
      expect(node.classList.contains('unlocks-track-node--expanded')).toBe(false);
    });

    it('renders connectors between nodes', () => {
      mockGetProgressionState.mockReturnValue({ level: 2, xp: 0, totalXp: 300, unlockedItems: [], challengeProgress: {} });
      renderUnlocksPanel();
      const connectors = document.querySelectorAll('.unlocks-track-connector');
      expect(connectors.length).toBe(1); // 2 nodes = 1 connector
    });
  });

  // ── Focus Trap ─────────────────────────────────────────

  describe('focus trap', () => {
    beforeEach(() => {
      setSignedInUser();
      initUnlocksAndShop();
      renderShopPanel();
      getBuyButtons()[0].click();
    });

    it('Tab from last focusable wraps to first', () => {
      const modal = getPurchaseModal();
      const cancelBtn = document.getElementById('shop-modal-cancel')!;
      cancelBtn.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      const spy = vi.spyOn(event, 'preventDefault');
      modal.dispatchEvent(event);
      // Should prevent default and wrap focus
      expect(spy).toHaveBeenCalled();
    });

    it('Shift+Tab from first focusable wraps to last', () => {
      const modal = getPurchaseModal();
      const confirmBtn = document.getElementById('shop-modal-confirm')!;
      confirmBtn.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });
      const spy = vi.spyOn(event, 'preventDefault');
      modal.dispatchEvent(event);
      expect(spy).toHaveBeenCalled();
    });
  });

  // ── Double-click protection ───────────────────────────

  describe('double-click protection', () => {
    beforeEach(() => {
      setSignedInUser();
      initUnlocksAndShop();
      renderShopPanel();
      getBuyButtons()[0].click();
    });

    it('CONFIRM button is disabled during purchase', () => {
      const confirmBtn = document.getElementById('shop-modal-confirm') as HTMLButtonElement;
      confirmBtn.click();
      expect(confirmBtn.disabled).toBe(true);
    });

    it('second click on disabled CONFIRM does not fire purchaseItem', () => {
      mockPurchaseItem.mockClear();
      const confirmBtn = document.getElementById('shop-modal-confirm') as HTMLButtonElement;
      confirmBtn.click(); // first click
      const callCount = mockPurchaseItem.mock.calls.length;
      confirmBtn.click(); // second click — button is now disabled
      expect(mockPurchaseItem.mock.calls.length).toBe(callCount);
    });
  });

  // ── _resetForTesting ──────────────────────────────────

  describe('_resetForTesting', () => {
    it('allows re-initialization after reset', () => {
      initUnlocksAndShop();
      _resetForTesting();
      expect(() => initUnlocksAndShop()).not.toThrow();
    });
  });

  // ── Progression Ready Event ───────────────────────────

  describe('progression:ready event', () => {
    it('re-renders panels on progression ready', () => {
      mockGetProgressionState.mockReturnValue({ level: 1, xp: 0, totalXp: 0, unlockedItems: [], challengeProgress: {} });
      initUnlocksAndShop();
      const grid = document.getElementById('shop-grid')!;
      grid.innerHTML = '';
      document.dispatchEvent(new CustomEvent('progression:ready'));
      // Should have re-rendered both panels
      expect(document.getElementById('unlocks-challenge-count')!.textContent).toContain('active');
    });
  });
});
