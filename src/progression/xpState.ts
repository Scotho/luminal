/**
 * TASK-306: Pure XP state logic.
 * No DOM, no Firebase. Fully unit-testable.
 */

import type { XpState, ProgressionSnapshot } from './progressionTypes';
import type { VehicleType, MapType } from '../types/index';
import { XP_THRESHOLDS, MAX_LEVEL, getXpForLevel } from './xpConfig';

const DEFAULT_UNLOCKS: readonly string[] = [
  'vehicle:bike', 'vehicle:hoverboard', 'map:midtown_bowl', 'color:red', 'color:cyan',
];

export function createXpState(): XpState {
  return {
    level: 1, xp: 0, totalXp: 0,
    unlockedItems: [...DEFAULT_UNLOCKS],
    challengeProgress: {},
    tokensUsed: {},
  };
}

export function getLevelFromXp(totalXp: number): number {
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (totalXp >= XP_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return level;
}

export interface AddXpResult {
  state: XpState;
  levelsGained: number;
  previousLevel: number;
}

export function addXp(state: XpState, amount: number): AddXpResult {
  const previousLevel = state.level;
  state.xp += amount;
  state.totalXp += amount;
  state.level = getLevelFromXp(state.totalXp);
  return { state, levelsGained: state.level - previousLevel, previousLevel };
}

export function getXpToNextLevel(state: XpState): number {
  if (state.level >= MAX_LEVEL) return 0;
  return getXpForLevel(state.level + 1) - state.totalXp;
}

export function isMaxLevel(state: XpState): boolean {
  return state.level >= MAX_LEVEL;
}

export function addUnlock(state: XpState, itemId: string): void {
  if (!state.unlockedItems.includes(itemId)) {
    state.unlockedItems.push(itemId);
  }
}

export function getSnapshot(state: XpState): ProgressionSnapshot {
  const vehicles = state.unlockedItems
    .filter(id => id.startsWith('vehicle:'))
    .map(id => id.replace('vehicle:', '') as VehicleType);
  const maps = state.unlockedItems
    .filter(id => id.startsWith('map:'))
    .map(id => id.replace('map:', '') as MapType);
  const colors = state.unlockedItems
    .filter(id => id.startsWith('color:'))
    .map(id => id.replace('color:', ''));
  return { level: state.level, xp: state.totalXp, xpToNextLevel: getXpToNextLevel(state), totalXp: state.totalXp, unlockedVehicles: vehicles, unlockedMaps: maps, unlockedColors: colors };
}

export function _resetForTesting(): XpState {
  return createXpState();
}
