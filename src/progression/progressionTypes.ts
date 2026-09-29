/**
 * TASK-306: Progression system type definitions.
 * Pure types — no logic, no imports from game modules.
 */

import type { VehicleType, MapType } from '../types/index';

export type UnlockCategory = 'vehicle' | 'map' | 'color' | 'emissive';

export interface UnlockEntry {
  id: string;
  category: UnlockCategory;
  label: string;
}

export interface LevelUnlocks {
  level: number;
  xpRequired: number;
  unlocks: UnlockEntry[];
}

export interface XpAward {
  base: number;
  winBonus: number;
  streakBonus: number;
  seriesBonus: number;
  total: number;
}

export interface XpState {
  level: number;
  xp: number;
  totalXp: number;
  unlockedItems: string[];
  challengeProgress: Record<string, number>;
  tokensUsed: Record<number, string>;
}

export interface TokenChoice {
  group: number;
  options: UnlockEntry[];
}

export interface ChallengeDefinition {
  id: string;
  label: string;
  description: string;
  type: 'usage' | 'performance' | 'outcome';
  target: number;
  unlockId: string;
  trackingEvent: string;
  rewardType: 'map' | 'color' | 'emissive';
}

export interface ProgressionSnapshot {
  level: number;
  xp: number;
  xpToNextLevel: number;
  totalXp: number;
  unlockedVehicles: VehicleType[];
  unlockedMaps: MapType[];
  unlockedColors: string[];
}

export type ProgressionEventType = 'levelUp' | 'unlock' | 'challengeComplete';

export interface ProgressionEvent {
  type: ProgressionEventType;
  level?: number;
  unlockId?: string;
  challengeId?: string;
}

export interface UserLoadout {
  vehicle: VehicleType;
  color: string;
}

export interface UnlockRecord {
  id: string;
  source: 'level' | 'challenge' | 'shop' | 'promo';
  at: number;
  cost?: number;
}
