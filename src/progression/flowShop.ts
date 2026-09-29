/**
 * TASK-306: FLOW currency shop for cosmetic purchases.
 * Pure logic — Firebase deduction handled by caller.
 */

import type { XpState, UnlockRecord } from './progressionTypes';
import { addUnlock } from './xpState';
import { db } from '../firebase';
import { doc, runTransaction, arrayUnion } from 'firebase/firestore';

export interface ShopItem {
  id: string;
  label: string;
  cost: number;
  category: 'color' | 'emissive';
  unlockId: string;
}

export interface ShopItemView extends ShopItem {
  owned: boolean;
  affordable: boolean;
}

export interface PurchaseResult {
  cost: number;
  unlockId: string;
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: 'shop_orange', label: 'Orange', cost: 200, category: 'color', unlockId: 'color:orange' },
  { id: 'shop_teal', label: 'Teal', cost: 200, category: 'color', unlockId: 'color:teal' },
  { id: 'shop_magenta', label: 'Magenta', cost: 300, category: 'color', unlockId: 'color:magenta' },
  { id: 'shop_lime', label: 'Lime', cost: 300, category: 'color', unlockId: 'color:lime' },
  { id: 'shop_white', label: 'White', cost: 500, category: 'color', unlockId: 'color:white' },
  { id: 'shop_emissive_glow', label: 'Enhanced Glow', cost: 400, category: 'emissive', unlockId: 'emissive:enhanced_glow' },
  { id: 'shop_emissive_pulse', label: 'Pulse Effect', cost: 600, category: 'emissive', unlockId: 'emissive:pulse' },
  { id: 'shop_emissive_overdrive', label: 'Overdrive', cost: 800, category: 'emissive', unlockId: 'emissive:overdrive' },
];

export function canPurchase(itemId: string, bankedFlow: number, state: XpState): boolean {
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return false;
  if (state.unlockedItems.includes(item.unlockId)) return false;
  if (bankedFlow < item.cost) return false;
  return true;
}

export function purchase(itemId: string, bankedFlow: number, state: XpState): PurchaseResult | null {
  if (!canPurchase(itemId, bankedFlow, state)) return null;
  const item = SHOP_ITEMS.find(i => i.id === itemId)!;
  addUnlock(state, item.unlockId);
  return { cost: item.cost, unlockId: item.unlockId };
}

export function getShopItems(state: XpState, bankedFlow: number): ShopItemView[] {
  return SHOP_ITEMS.map(item => ({
    ...item,
    owned: state.unlockedItems.includes(item.unlockId),
    affordable: bankedFlow >= item.cost,
  }));
}

export interface TransactionResult {
  success: boolean;
  cost: number;
  unlockId: string;
  newBalance: number;
}

/**
 * Atomic shop purchase via Firestore transaction.
 * Reads balance, validates, writes deduction + unlock in one atomic op.
 */
export async function purchaseItem(uid: string, itemId: string): Promise<TransactionResult> {
  const item = SHOP_ITEMS.find(i => i.id === itemId);
  if (!item) return { success: false, cost: 0, unlockId: '', newBalance: 0 };

  const userRef = doc(db, 'users', uid);

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(userRef);
    if (!snap.exists()) throw new Error('User doc not found');

    const data = snap.data();
    const bankedFlow = Number(data.bankedFlow) || 0;
    const unlockedItems: string[] = data.progression?.unlockedItems ?? [];

    if (unlockedItems.includes(item.unlockId)) {
      return { success: false, cost: 0, unlockId: item.unlockId, newBalance: bankedFlow };
    }
    if (bankedFlow < item.cost) {
      return { success: false, cost: item.cost, unlockId: item.unlockId, newBalance: bankedFlow };
    }

    const newBalance = bankedFlow - item.cost;
    const record: UnlockRecord = { id: item.unlockId, source: 'shop', at: Date.now(), cost: item.cost };

    transaction.update(userRef, {
      bankedFlow: newBalance,
      'progression.unlockedItems': arrayUnion(item.unlockId),
      unlockLog: arrayUnion(record),
    });

    return { success: true, cost: item.cost, unlockId: item.unlockId, newBalance };
  });
}
