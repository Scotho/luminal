import { describe, it, expect, beforeEach } from 'vitest';
import { SHOP_ITEMS, canPurchase, purchase, getShopItems, purchaseItem } from '../flowShop';
import type { XpState } from '../progressionTypes';
import { createXpState } from '../xpState';

describe('flowShop', () => {
  let state: XpState;
  let bankedFlow: number;
  beforeEach(() => { state = createXpState(); bankedFlow = 1000; });

  describe('SHOP_ITEMS', () => {
    it('has items defined', () => { expect(SHOP_ITEMS.length).toBeGreaterThan(0); });
    it('each item has id, label, cost, and category', () => {
      for (const item of SHOP_ITEMS) {
        expect(item.id).toBeTruthy(); expect(item.label).toBeTruthy();
        expect(item.cost).toBeGreaterThan(0); expect(item.category).toBeTruthy();
      }
    });
  });

  describe('canPurchase', () => {
    it('returns true if affordable and not already owned', () => {
      expect(canPurchase(SHOP_ITEMS[0].id, bankedFlow, state)).toBe(true);
    });
    it('returns false if already owned', () => {
      state.unlockedItems.push(SHOP_ITEMS[0].unlockId);
      expect(canPurchase(SHOP_ITEMS[0].id, bankedFlow, state)).toBe(false);
    });
    it('returns false if insufficient FLOW', () => {
      expect(canPurchase(SHOP_ITEMS[0].id, 0, state)).toBe(false);
    });
  });

  describe('purchase', () => {
    it('returns cost and adds unlock on success', () => {
      const result = purchase(SHOP_ITEMS[0].id, bankedFlow, state);
      expect(result).not.toBeNull();
      expect(result!.cost).toBe(SHOP_ITEMS[0].cost);
      expect(state.unlockedItems).toContain(SHOP_ITEMS[0].unlockId);
    });
    it('returns null if cannot purchase', () => {
      expect(purchase(SHOP_ITEMS[0].id, 0, state)).toBeNull();
    });
  });

  describe('getShopItems', () => {
    it('marks items as owned when in unlockedItems', () => {
      state.unlockedItems.push(SHOP_ITEMS[0].unlockId);
      const items = getShopItems(state, bankedFlow);
      expect(items.find(i => i.id === SHOP_ITEMS[0].id)?.owned).toBe(true);
    });
    it('marks items as affordable based on balance', () => {
      const items = getShopItems(state, 50);
      const expensive = items.find(i => i.cost > 50);
      if (expensive) expect(expensive.affordable).toBe(false);
    });
  });

  describe('purchaseItem', () => {
    it('is exported as a function', () => {
      // purchaseItem requires Firestore, so we only verify it's exported
      expect(typeof purchaseItem).toBe('function');
    });
  });
});
