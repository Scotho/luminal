/**
 * Progression system public API.
 */

export type {
  XpState, XpAward, UnlockEntry, UnlockCategory, LevelUnlocks,
  ChallengeDefinition, ProgressionSnapshot,
  ProgressionEvent, ProgressionEventType,
  UserLoadout, UnlockRecord,
} from './progressionTypes';

export { XP_THRESHOLDS, MAX_LEVEL, calculateMatchXp, getXpForLevel } from './xpConfig';
export type { MatchXpInput } from './xpConfig';
export { createXpState, getLevelFromXp, addXp, getXpToNextLevel, isMaxLevel, getSnapshot, addUnlock } from './xpState';
export type { AddXpResult } from './xpState';
export { LEVEL_UNLOCKS, getUnlocksForLevel, getAutoUnlocksUpToLevel, getAllChallenges, getChallengeById, CHALLENGES } from './unlockRegistry';
export { incrementChallenge, isChallengeComplete, getAllChallengeViews, getChallengeProgress } from './challengeState';
export type { ChallengeView } from './challengeState';
export { isUnlocked, getAvailableVehicles, getAvailableMaps, getAvailableColors, getLockedReason } from './progressionGuard';
export type { LockedReason } from './progressionGuard';
export { EVT_LEVEL_UP, EVT_UNLOCK, EVT_CHALLENGE_COMPLETE, EVT_PROGRESSION_READY, emitProgressionEvent } from './progressionEvents';
export { awardMatchXp, processLevelUp } from './progressionBridge';
export type { MatchXpResult } from './progressionBridge';
export { SHOP_ITEMS, canPurchase, purchase, getShopItems, purchaseItem } from './flowShop';
export type { ShopItem, ShopItemView, PurchaseResult, TransactionResult } from './flowShop';
export { getProgressionState, initProgression, clearProgression, onMatchComplete, trackChallengeEvent, flushProgressionState } from './progressionManager';
