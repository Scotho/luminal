/**
 * Hub coordinator — tab switching, footer prompts, back button, LB/RB.
 * Thin glue module. Each tab's content is managed by its own module.
 */

import { closePurchaseModal, closeSigninModal } from './unlocksUI';

export type HubTab = 'garage' | 'match' | 'unlocks' | 'shop';
const TAB_ORDER: HubTab[] = ['garage', 'match', 'unlocks', 'shop'];

let _activeTab: HubTab = 'garage';
let _initialized = false;
let _onBack: (() => void) | null = null;
let _onTabChange: ((tab: HubTab) => void) | null = null;

// ── Init ─────────────────────────────────────────────────

export interface HubDeps {
  onBack: () => void;
  onTabChange: (tab: HubTab) => void;
}

export function initHubUI(deps: HubDeps): void {
  if (_initialized) return;
  _initialized = true;
  _onBack = deps.onBack;
  _onTabChange = deps.onTabChange;

  // Tab buttons
  for (const tab of TAB_ORDER) {
    document.getElementById(`hub-tab-${tab}`)?.addEventListener('click', () => switchTab(tab));
  }

  // Back button
  document.getElementById('hub-back')?.addEventListener('click', () => _onBack?.());

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const overlay = document.getElementById('character-select-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    // If a modal is open, close it first
    const purchaseModal = document.getElementById('shop-purchase-modal');
    const signinModal = document.getElementById('shop-signin-modal');
    if (purchaseModal && !purchaseModal.classList.contains('hidden')) {
      closePurchaseModal();
      return;
    }
    if (signinModal && !signinModal.classList.contains('hidden')) {
      closeSigninModal();
      return;
    }
    _onBack?.();
  });

  // Mouse hides prompts, keyboard/gamepad shows them
  const prompts = document.getElementById('hub-prompts');
  if (prompts) {
    document.addEventListener('mousemove', () => prompts.classList.add('hub-prompts--hidden'));
    document.addEventListener('keydown', () => prompts.classList.remove('hub-prompts--hidden'));
  }
}

// ── Tab Switching ────────────────────────────────────────

export function switchTab(tab: HubTab): void {
  if (tab === _activeTab) return;
  _activeTab = tab;

  for (const t of TAB_ORDER) {
    const btn = document.getElementById(`hub-tab-${t}`);
    const panel = document.getElementById(`hub-panel-${t}`);
    if (!btn || !panel) continue;

    const isActive = t === tab;
    btn.classList.toggle('hub-tab--active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
    panel.classList.toggle('hidden', !isActive);
  }

  _onTabChange?.(tab);
}

export function cycleTab(direction: 1 | -1): void {
  const idx = TAB_ORDER.indexOf(_activeTab);
  const next = (idx + direction + TAB_ORDER.length) % TAB_ORDER.length;
  switchTab(TAB_ORDER[next]);
}

export function getActiveTab(): HubTab { return _activeTab; }

// ── Footer Prompts ───────────────────────────────────────

export function setPrompts(prompts: { tabs?: string; nav?: string; action?: string; back?: string }): void {
  const el = (id: string) => document.getElementById(id);
  if (prompts.tabs !== undefined) {
    const tabsEl = el('hub-prompt-tabs');
    if (tabsEl) tabsEl.innerHTML = prompts.tabs;
  }
  if (prompts.action !== undefined) {
    const actionEl = el('hub-prompt-action');
    if (actionEl) actionEl.innerHTML = prompts.action;
  }
}

export function resetPrompts(): void {
  setPrompts({
    tabs: '<kbd>LB</kbd>/<kbd>RB</kbd> Switch tab',
    nav: '<kbd>D-PAD</kbd> Navigate',
    action: '<kbd>A</kbd> Select',
    back: '<kbd>B</kbd> Back',
  });
}

// ── Testing ──────────────────────────────────────────────

export function _resetHubForTesting(): void {
  _activeTab = 'garage';
  _initialized = false;
  _onBack = null;
  _onTabChange = null;
}
