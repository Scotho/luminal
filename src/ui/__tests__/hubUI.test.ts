// ── Hub UI Tests ────────────────────────────────────────
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Mock unlocksUI close functions before importing hubUI
vi.mock('../unlocksUI', () => ({
  closePurchaseModal: vi.fn(),
  closeSigninModal: vi.fn(),
  initUnlocksAndShop: vi.fn(),
  renderUnlocksPanel: vi.fn(),
  renderShopPanel: vi.fn(),
  refreshShopBalance: vi.fn(),
  _resetForTesting: vi.fn(),
}));

import {
  initHubUI,
  switchTab,
  cycleTab,
  getActiveTab,
  setPrompts,
  resetPrompts,
  _resetHubForTesting,
} from '../hubUI';
import { closePurchaseModal, closeSigninModal } from '../unlocksUI';

describe('hubUI', () => {
  beforeEach(() => {
    _resetHubForTesting();
    vi.clearAllMocks();
    // Reset DOM state
    document.getElementById('shop-purchase-modal')!.classList.add('hidden');
    document.getElementById('shop-signin-modal')!.classList.add('hidden');
    document.getElementById('character-select-overlay')!.classList.remove('hidden');
    // Reset tab state in DOM
    for (const tab of ['garage', 'match', 'unlocks', 'shop']) {
      const btn = document.getElementById(`hub-tab-${tab}`)!;
      const panel = document.getElementById(`hub-panel-${tab}`)!;
      btn.classList.toggle('hub-tab--active', tab === 'garage');
      btn.setAttribute('aria-selected', tab === 'garage' ? 'true' : 'false');
      panel.classList.toggle('hidden', tab !== 'garage');
    }
  });

  // ── Init ────────────────────────────────────────────────

  describe('initHubUI', () => {
    it('wires tab buttons', () => {
      const onBack = vi.fn();
      const onTabChange = vi.fn();
      initHubUI({ onBack, onTabChange });

      document.getElementById('hub-tab-match')!.click();
      expect(onTabChange).toHaveBeenCalledWith('match');
    });

    it('wires back button', () => {
      const onBack = vi.fn();
      initHubUI({ onBack, onTabChange: vi.fn() });

      document.getElementById('hub-back')!.click();
      expect(onBack).toHaveBeenCalled();
    });

    it('does not double-init', () => {
      const onBack1 = vi.fn();
      const onBack2 = vi.fn();
      initHubUI({ onBack: onBack1, onTabChange: vi.fn() });
      initHubUI({ onBack: onBack2, onTabChange: vi.fn() });

      document.getElementById('hub-back')!.click();
      expect(onBack1).toHaveBeenCalled();
      expect(onBack2).not.toHaveBeenCalled();
    });
  });

  // ── Tab Switching ─────────────────────────────────────

  describe('switchTab', () => {
    beforeEach(() => {
      initHubUI({ onBack: vi.fn(), onTabChange: vi.fn() });
    });

    it('activates the selected tab button', () => {
      switchTab('shop');
      const btn = document.getElementById('hub-tab-shop')!;
      expect(btn.classList.contains('hub-tab--active')).toBe(true);
      expect(btn.getAttribute('aria-selected')).toBe('true');
    });

    it('deactivates the previous tab button', () => {
      switchTab('shop');
      const garageBtn = document.getElementById('hub-tab-garage')!;
      expect(garageBtn.classList.contains('hub-tab--active')).toBe(false);
      expect(garageBtn.getAttribute('aria-selected')).toBe('false');
    });

    it('shows the target panel', () => {
      switchTab('shop');
      expect(document.getElementById('hub-panel-shop')!.classList.contains('hidden')).toBe(false);
    });

    it('hides the previous panel', () => {
      switchTab('shop');
      expect(document.getElementById('hub-panel-garage')!.classList.contains('hidden')).toBe(true);
    });

    it('updates getActiveTab', () => {
      expect(getActiveTab()).toBe('garage');
      switchTab('unlocks');
      expect(getActiveTab()).toBe('unlocks');
    });

    it('no-ops when switching to the current tab', () => {
      const onTabChange = vi.fn();
      _resetHubForTesting();
      initHubUI({ onBack: vi.fn(), onTabChange });
      switchTab('garage'); // already active
      expect(onTabChange).not.toHaveBeenCalled();
    });

    it('calls onTabChange callback', () => {
      const onTabChange = vi.fn();
      _resetHubForTesting();
      initHubUI({ onBack: vi.fn(), onTabChange });
      switchTab('match');
      expect(onTabChange).toHaveBeenCalledWith('match');
    });
  });

  // ── cycleTab ──────────────────────────────────────────

  describe('cycleTab', () => {
    beforeEach(() => {
      initHubUI({ onBack: vi.fn(), onTabChange: vi.fn() });
    });

    it('cycles forward', () => {
      cycleTab(1);
      expect(getActiveTab()).toBe('match');
    });

    it('cycles backward wraps to last tab', () => {
      cycleTab(-1);
      expect(getActiveTab()).toBe('shop');
    });

    it('cycles forward wraps from last to first', () => {
      switchTab('shop');
      cycleTab(1);
      expect(getActiveTab()).toBe('garage');
    });

    it('cycles through all tabs forward', () => {
      const expected = ['match', 'unlocks', 'shop', 'garage'];
      for (const tab of expected) {
        cycleTab(1);
        expect(getActiveTab()).toBe(tab);
      }
    });
  });

  // ── Escape Key ────────────────────────────────────────

  describe('Escape key', () => {
    // Note: document-level keydown listeners accumulate across initHubUI() calls
    // since _resetHubForTesting can't remove them. Tests use relative call counts.

    it('calls onBack when overlay is visible and no modals open', () => {
      const onBack = vi.fn();
      _resetHubForTesting();
      initHubUI({ onBack, onTabChange: vi.fn() });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(onBack).toHaveBeenCalled();
    });

    it('does nothing when overlay is hidden', () => {
      const onBack = vi.fn();
      _resetHubForTesting();
      initHubUI({ onBack, onTabChange: vi.fn() });
      document.getElementById('character-select-overlay')!.classList.add('hidden');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(onBack).not.toHaveBeenCalled();
    });

    it('closes purchase modal instead of calling onBack', () => {
      const onBack = vi.fn();
      _resetHubForTesting();
      initHubUI({ onBack, onTabChange: vi.fn() });
      document.getElementById('shop-purchase-modal')!.classList.remove('hidden');

      const beforeCount = (closePurchaseModal as Mock).mock.calls.length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect((closePurchaseModal as Mock).mock.calls.length).toBeGreaterThan(beforeCount);
      expect(onBack).not.toHaveBeenCalled();
    });

    it('closes sign-in modal instead of calling onBack', () => {
      const onBack = vi.fn();
      _resetHubForTesting();
      initHubUI({ onBack, onTabChange: vi.fn() });
      document.getElementById('shop-signin-modal')!.classList.remove('hidden');

      const beforeCount = (closeSigninModal as Mock).mock.calls.length;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect((closeSigninModal as Mock).mock.calls.length).toBeGreaterThan(beforeCount);
      expect(onBack).not.toHaveBeenCalled();
    });

    it('ignores non-Escape keys', () => {
      const onBack = vi.fn();
      _resetHubForTesting();
      initHubUI({ onBack, onTabChange: vi.fn() });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      expect(onBack).not.toHaveBeenCalled();
    });
  });

  // ── Footer Prompts ────────────────────────────────────

  describe('setPrompts', () => {
    it('sets tabs prompt', () => {
      setPrompts({ tabs: 'TEST TABS' });
      expect(document.getElementById('hub-prompt-tabs')!.innerHTML).toBe('TEST TABS');
    });

    it('sets action prompt', () => {
      setPrompts({ action: 'TEST ACTION' });
      expect(document.getElementById('hub-prompt-action')!.innerHTML).toBe('TEST ACTION');
    });

    it('does not touch undefined keys', () => {
      const original = document.getElementById('hub-prompt-tabs')!.innerHTML;
      setPrompts({ action: 'X' });
      expect(document.getElementById('hub-prompt-tabs')!.innerHTML).toBe(original);
    });
  });

  describe('resetPrompts', () => {
    it('restores default prompt text', () => {
      setPrompts({ tabs: 'CUSTOM', action: 'CUSTOM' });
      resetPrompts();
      expect(document.getElementById('hub-prompt-tabs')!.innerHTML).toContain('LB');
      expect(document.getElementById('hub-prompt-action')!.innerHTML).toContain('Select');
    });
  });

  // ── _resetHubForTesting ───────────────────────────────

  describe('_resetHubForTesting', () => {
    it('resets active tab to garage', () => {
      initHubUI({ onBack: vi.fn(), onTabChange: vi.fn() });
      switchTab('shop');
      _resetHubForTesting();
      expect(getActiveTab()).toBe('garage');
    });

    it('allows re-initialization', () => {
      initHubUI({ onBack: vi.fn(), onTabChange: vi.fn() });
      _resetHubForTesting();
      const onBack2 = vi.fn();
      initHubUI({ onBack: onBack2, onTabChange: vi.fn() });
      document.getElementById('hub-back')!.click();
      expect(onBack2).toHaveBeenCalled();
    });
  });
});
