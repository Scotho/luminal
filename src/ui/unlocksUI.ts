/**
 * UNLOCKS + SHOP panel rendering for the hub.
 * Level track, challenges, shop grid, purchase flow.
 */
import { getProgressionState, addUnlockFromPurchase } from '../progression/progressionManager';
import { LEVEL_UNLOCKS, getAllChallenges } from '../progression/unlockRegistry';
import { getAllChallengeViews } from '../progression/challengeState';
import { getShopItems, purchaseItem } from '../progression/flowShop';
import type { ShopItemView } from '../progression/flowShop';
import { isUnlocked } from '../progression/progressionGuard';
import { XP_THRESHOLDS } from '../progression/xpConfig';
import { EVT_PROGRESSION_READY } from '../progression/progressionEvents';
import { fetchProfile } from '../profile';
import { PLAYER_COLORS } from '../playerColors';
import { auth } from '../firebase';
import { getIsRealUser } from './authUIFlows';

// ── State ────────────────────────────────────────────────

let _trackScroll: HTMLElement;
let _challengeGrid: HTMLElement;
let _challengeCount: HTMLElement;
let _shopGrid: HTMLElement;
let _flowAmountEl: HTMLElement;
let _purchaseModal: HTMLElement;
let _signinModal: HTMLElement;
let _confirmBtn: HTMLButtonElement;
let _errorEl: HTMLElement;
let _bankedFlow = 0;
let _activeShopCategory: 'color' | 'emissive' = 'color';
let _pendingPurchaseId: string | null = null;
let _triggerElement: HTMLElement | null = null;
let _initialized = false;

const ANON_DUMMY_STATE = { level: 1, xp: 0, totalXp: 0, unlockedItems: [] as string[], challengeProgress: {} as Record<string, number>, tokensUsed: {} as Record<number, string> };

/** Build a Map<unlockId, css> from PLAYER_COLORS for O(1) lookups. */
const _colorCssMap = new Map(PLAYER_COLORS.map(c => [`color:${c.key}`, c.css]));

// ── Init ─────────────────────────────────────────────────

export function initUnlocksAndShop(): void {
  if (_initialized) return;
  _initialized = true;

  _trackScroll = document.getElementById('unlocks-track-scroll')!;
  _challengeGrid = document.getElementById('unlocks-challenge-grid')!;
  _challengeCount = document.getElementById('unlocks-challenge-count')!;
  _shopGrid = document.getElementById('shop-grid')!;
  _flowAmountEl = document.getElementById('shop-flow-amount')!;
  _purchaseModal = document.getElementById('shop-purchase-modal')!;
  _signinModal = document.getElementById('shop-signin-modal')!;
  _confirmBtn = document.getElementById('shop-modal-confirm') as HTMLButtonElement;
  _errorEl = document.getElementById('shop-modal-error')!;

  // Shop category tabs
  for (const btn of document.querySelectorAll<HTMLElement>('.shop-cat')) {
    btn.addEventListener('click', () => {
      _activeShopCategory = btn.dataset.category as 'color' | 'emissive';
      for (const b of document.querySelectorAll<HTMLElement>('.shop-cat')) {
        b.classList.toggle('shop-cat--active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      }
      renderShopPanel();
    });
  }

  // Purchase modal buttons
  _confirmBtn.addEventListener('click', _confirmPurchase);
  document.getElementById('shop-modal-cancel')!.addEventListener('click', closePurchaseModal);
  _purchaseModal.querySelector('.shop-modal-backdrop')!.addEventListener('click', closePurchaseModal);

  // Sign-in modal buttons
  document.getElementById('shop-signin-btn')!.addEventListener('click', _goToSignIn);
  document.getElementById('shop-signin-cancel')!.addEventListener('click', closeSigninModal);
  _signinModal.querySelector('.shop-modal-backdrop')!.addEventListener('click', closeSigninModal);

  // Focus trap in modals
  _purchaseModal.addEventListener('keydown', _trapFocus);
  _signinModal.addEventListener('keydown', _trapFocus);

  // Re-render on progression ready
  document.addEventListener(EVT_PROGRESSION_READY, () => {
    renderUnlocksPanel();
    renderShopPanel();
  });
}

// ── UNLOCKS Panel ───────────────────────────────────────
export function renderUnlocksPanel(): void {
  _renderLevelTrack();
  _renderChallenges();
}

function _renderLevelTrack(): void {
  const state = getProgressionState();
  const currentLevel = state?.level ?? 1;
  const totalXp = state?.totalXp ?? 0;

  _trackScroll.innerHTML = '';

  for (let i = 0; i < LEVEL_UNLOCKS.length; i++) {
    const entry = LEVEL_UNLOCKS[i];
    const isUnlockedLevel = currentLevel >= entry.level;
    const isCurrent = currentLevel === entry.level;

    if (i > 0) {
      const connector = document.createElement('div');
      connector.className = 'unlocks-track-connector' + (currentLevel >= entry.level ? ' unlocks-track-connector--filled' : '');
      _trackScroll.appendChild(connector);
    }

    const node = document.createElement('div');
    node.className = 'unlocks-track-node'
      + (isUnlockedLevel ? ' unlocks-track-node--unlocked' : '')
      + (isCurrent ? ' unlocks-track-node--current' : '');
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `Level ${entry.level}${entry.unlocks.length ? ': ' + entry.unlocks.map(u => u.label).join(', ') : ''}`);

    const pip = document.createElement('div');
    pip.className = 'unlocks-track-node__pip';
    node.appendChild(pip);

    const label = document.createElement('div');
    label.className = 'unlocks-track-node__label';
    label.textContent = `LVL ${entry.level}`;
    node.appendChild(label);

    const rewards = document.createElement('div');
    rewards.className = 'unlocks-track-node__rewards';
    for (const unlock of entry.unlocks) {
      const reward = document.createElement('div');
      reward.className = 'unlocks-track-reward';
      if (isUnlocked(unlock.id, state)) reward.classList.add('unlocks-track-reward--earned');
      if (unlock.category === 'color') {
        const css = _colorCssMap.get(unlock.id);
        if (css) reward.style.background = css;
      } else {
        reward.textContent = unlock.category === 'vehicle' ? unlock.label.charAt(0) : 'E';
      }
      reward.title = unlock.label;
      rewards.appendChild(reward);
    }
    node.appendChild(rewards);

    if (isCurrent && state) {
      const nextThreshold = i + 1 < XP_THRESHOLDS.length ? XP_THRESHOLDS[i + 1] : XP_THRESHOLDS[i];
      const currentThreshold = XP_THRESHOLDS[i];
      const progress = nextThreshold > currentThreshold
        ? Math.min(1, (totalXp - currentThreshold) / (nextThreshold - currentThreshold))
        : 1;
      const bar = document.createElement('div');
      bar.className = 'unlocks-xp-bar';
      const fill = document.createElement('div');
      fill.className = 'unlocks-xp-bar__fill';
      fill.style.width = `${Math.round(progress * 100)}%`;
      bar.appendChild(fill);
      node.appendChild(bar);
    }

    const toggleExpand = () => node.classList.toggle('unlocks-track-node--expanded');
    node.addEventListener('click', toggleExpand);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(); }
    });

    _trackScroll.appendChild(node);
  }

  requestAnimationFrame(() => {
    const currentNode = _trackScroll.querySelector('.unlocks-track-node--current') as HTMLElement | null;
    if (currentNode) currentNode.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
}

function _renderChallenges(): void {
  const state = getProgressionState();
  if (!state) { _challengeGrid.innerHTML = ''; _challengeCount.textContent = '0 active / 0 complete'; return; }

  const views = getAllChallengeViews(state);
  const active = views.filter(v => !v.complete);
  const completed = views.filter(v => v.complete);
  _challengeCount.textContent = `${active.length} active / ${completed.length} complete`;

  _challengeGrid.innerHTML = '';
  for (const view of active) {
    _challengeGrid.appendChild(_buildChallengeCard(view, false));
  }
  for (const view of completed) {
    _challengeGrid.appendChild(_buildChallengeCard(view, true));
  }
}

function _buildChallengeCard(view: ReturnType<typeof getAllChallengeViews>[number], isComplete: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = 'unlocks-challenge-card'
    + (view.rewardType === 'map' ? ' unlocks-challenge-card--map' : '')
    + (isComplete ? ' unlocks-challenge-card--complete' : '');
  card.tabIndex = 0;
  card.setAttribute('role', 'listitem');

  const rewardIcon = view.rewardType === 'map' ? '\uD83D\uDDFA\uFE0F' : '\uD83C\uDFA8';
  const addDiv = (cls: string, text: string) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    card.appendChild(el);
    return el;
  };

  addDiv('unlocks-challenge-card__name', view.label);
  if (!isComplete) {
    addDiv('unlocks-challenge-card__desc', view.description);
    const bar = document.createElement('div');
    bar.className = 'unlocks-challenge-card__bar';
    const fill = document.createElement('div');
    fill.className = 'unlocks-challenge-card__bar-fill';
    fill.style.width = `${Math.round((view.progress / view.target) * 100)}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
    addDiv('unlocks-challenge-card__progress', `${view.progress}/${view.target}`);
  }
  addDiv('unlocks-challenge-card__reward', `${rewardIcon} ${_getUnlockLabel(view.unlockId)}`);
  return card;
}

function _getUnlockLabel(unlockId: string): string {
  for (const entry of LEVEL_UNLOCKS) {
    const found = entry.unlocks.find(u => u.id === unlockId);
    if (found) return found.label;
  }
  const challenge = getAllChallenges().find(c => c.unlockId === unlockId);
  if (challenge) return challenge.label;
  return unlockId.split(':')[1] ?? unlockId;
}

// ── SHOP Panel ──────────────────────────────────────────
export async function refreshShopBalance(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (uid && getIsRealUser()) {
    const profile = await fetchProfile(uid);
    _bankedFlow = profile?.bankedFlow ?? 0;
  } else {
    _bankedFlow = 0;
  }
  _flowAmountEl.textContent = _bankedFlow.toLocaleString();
}

export function renderShopPanel(): void {
  const state = getProgressionState();
  const items = getShopItems(state ?? ANON_DUMMY_STATE, _bankedFlow).filter(i => i.category === _activeShopCategory);
  const isAnon = !getIsRealUser();

  _shopGrid.innerHTML = '';
  for (const item of items) {
    const cantAfford = !item.owned && !item.affordable && !isAnon;
    const card = document.createElement('div');
    card.className = 'shop-card'
      + (item.owned ? ' shop-card--owned' : '')
      + (cantAfford ? ' shop-card--cant-afford' : '');
    card.tabIndex = 0;

    const preview = document.createElement('div');
    preview.className = 'shop-card__preview';
    if (item.category === 'color') {
      const css = _colorCssMap.get(item.unlockId);
      if (css) preview.style.background = css;
    } else {
      preview.style.background = 'linear-gradient(135deg, #49a2b2, #1a6a8a)';
    }
    card.appendChild(preview);

    const name = document.createElement('div');
    name.className = 'shop-card__name';
    name.textContent = item.label;
    card.appendChild(name);

    const cost = document.createElement('div');
    cost.className = 'shop-card__cost';
    cost.innerHTML = `<svg class="shop-card__cost-icon" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor"/></svg>${item.cost}`;
    card.appendChild(cost);

    if (cantAfford) {
      const hint = document.createElement('div');
      hint.className = 'shop-card__hint';
      hint.textContent = `Need \u26A1${item.cost - _bankedFlow} more`;
      card.appendChild(hint);
    }

    const buyBtn = document.createElement('button');
    buyBtn.className = 'shop-card__buy';
    buyBtn.type = 'button';
    buyBtn.textContent = 'BUY';
    buyBtn.disabled = cantAfford;
    buyBtn.addEventListener('click', (e) => { e.stopPropagation(); _triggerElement = buyBtn; _handleBuyClick(item); });
    card.appendChild(buyBtn);

    const owned = document.createElement('div');
    owned.className = 'shop-card__owned';
    owned.textContent = 'OWNED \u2713';
    card.appendChild(owned);

    _shopGrid.appendChild(card);
  }
}

// ── Purchase Flow ───────────────────────────────────────
function _handleBuyClick(item: ShopItemView): void {
  if (!getIsRealUser()) {
    _signinModal.classList.remove('hidden');
    document.getElementById('shop-signin-btn')?.focus();
    return;
  }
  _openPurchaseModal(item);
}

function _openPurchaseModal(item: ShopItemView): void {
  _pendingPurchaseId = item.id;
  const previewEl = document.getElementById('shop-modal-preview')!;
  if (item.category === 'color') {
    previewEl.style.background = _colorCssMap.get(item.unlockId) ?? '#333';
  } else {
    previewEl.style.background = 'linear-gradient(135deg, #49a2b2, #1a6a8a)';
  }
  document.getElementById('shop-modal-title')!.textContent = `Purchase ${item.label}?`;
  document.getElementById('shop-modal-cost')!.textContent = `\u26A1 ${item.cost} FLOW`;
  document.getElementById('shop-modal-balance')!.textContent = `Your balance: \u26A1 ${_bankedFlow.toLocaleString()}`;
  document.getElementById('shop-modal-error')!.classList.add('hidden');
  _purchaseModal.classList.remove('hidden');
  document.getElementById('shop-modal-confirm')?.focus();
}

export function closePurchaseModal(): void {
  _pendingPurchaseId = null;
  if (_confirmBtn) {
    _confirmBtn.disabled = false;
    _confirmBtn.textContent = 'CONFIRM';
  }
  if (_errorEl) _errorEl.classList.add('hidden');
  _purchaseModal.classList.add('hidden');
  _triggerElement?.focus();
  _triggerElement = null;
}

export function closeSigninModal(): void {
  _signinModal.classList.add('hidden');
}

async function _confirmPurchase(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!_pendingPurchaseId || !uid) return;
  const purchaseId = _pendingPurchaseId;

  _confirmBtn.disabled = true;
  _confirmBtn.textContent = '...';

  try {
    const result = await purchaseItem(uid, purchaseId);
    if (_pendingPurchaseId !== purchaseId) return;
    if (result.success) {
      _bankedFlow = result.newBalance;
      _flowAmountEl.textContent = _bankedFlow.toLocaleString();
      addUnlockFromPurchase(result.unlockId);
      closePurchaseModal();
      renderShopPanel();
    } else {
      _errorEl.textContent = 'Purchase failed \u2014 insufficient FLOW or already owned';
      _errorEl.classList.remove('hidden');
    }
  } catch {
    if (_pendingPurchaseId !== purchaseId) return;
    _errorEl.textContent = 'Network error \u2014 please try again';
    _errorEl.classList.remove('hidden');
  } finally {
    _confirmBtn.disabled = false;
    _confirmBtn.textContent = 'CONFIRM';
  }
}

function _goToSignIn(): void {
  _signinModal.classList.add('hidden');
  document.getElementById('btn-login')?.click();
}

// ── Focus Trap ───────────────────────────────────────────

function _trapFocus(e: KeyboardEvent): void {
  if (e.key !== 'Tab') return;
  const modal = e.currentTarget as HTMLElement;
  const focusable = modal.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ── Testing ──────────────────────────────────────────────

export function _resetForTesting(): void {
  _initialized = false;
  _bankedFlow = 0;
  _activeShopCategory = 'color';
  _pendingPurchaseId = null;
  _triggerElement = null;
}
