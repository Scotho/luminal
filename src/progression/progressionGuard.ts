/**
 * Progression guards for UI.
 * Returns "everything unlocked" for null state (anonymous users).
 */

import type { XpState } from './progressionTypes';
import type { VehicleType, MapType } from '../types/index';
import { PLAYER_COLOR_KEYS } from '../playerColors';
import { LEVEL_UNLOCKS, CHALLENGES } from './unlockRegistry';
import { SHOP_ITEMS } from './flowShop';

const ALL_VEHICLES: VehicleType[] = ['bike', 'car', 'hoverboard'];
const ALL_MAPS: MapType[] = ['synth_pit', 'midtown_bowl', 'synth_city'];

export interface LockedReason {
  type: 'level' | 'challenge' | 'shop';
  level?: number;
  challengeId?: string;
  shopItemId?: string;
}

export function isUnlocked(itemId: string, state: XpState | null): boolean {
  if (state === null) return true;
  return state.unlockedItems.includes(itemId);
}

export function getAvailableVehicles(state: XpState | null): VehicleType[] {
  if (state === null) return [...ALL_VEHICLES];
  return ALL_VEHICLES.filter(v => state.unlockedItems.includes(`vehicle:${v}`));
}

export function getAvailableMaps(state: XpState | null): MapType[] {
  if (state === null) return [...ALL_MAPS];
  return ALL_MAPS.filter(m => state.unlockedItems.includes(`map:${m}`));
}

export function getAvailableColors(state: XpState | null): string[] {
  if (state === null) return [...PLAYER_COLOR_KEYS];
  return PLAYER_COLOR_KEYS.filter(c => state.unlockedItems.includes(`color:${c}`));
}

export function getLockedReason(itemId: string, state: XpState): LockedReason | null {
  if (state.unlockedItems.includes(itemId)) return null;

  for (const entry of LEVEL_UNLOCKS) {
    if (entry.unlocks.some(u => u.id === itemId)) {
      return { type: 'level', level: entry.level };
    }
  }

  const challenge = CHALLENGES.find(c => c.unlockId === itemId);
  if (challenge) {
    return { type: 'challenge', challengeId: challenge.id };
  }

  const shopItem = SHOP_ITEMS.find(i => i.unlockId === itemId);
  if (shopItem) {
    return { type: 'shop', shopItemId: shopItem.id };
  }

  return null;
}
