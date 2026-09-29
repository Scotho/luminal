import type { StreakData } from './types';
import { warnDev } from './swallow';

// ── Constants ─────────────────────────────────────────────
export const STREAK_TIER_1 = 3;
export const STREAK_TIER_2 = 5;
export const STREAK_TIER_3 = 10;
export const STREAK_TIER_4 = 20;
export const STREAK_PROXIMITY_CUE = 3;

const STORAGE_KEY = 'luminal-streaks';
const LEGACY_KEY = 'luminal-stats';

// ── Tier Calculation ──────────────────────────────────────
export function getStreakTier(streak: number): number {
  if (streak >= STREAK_TIER_4) return 4;
  if (streak >= STREAK_TIER_3) return 3;
  if (streak >= STREAK_TIER_2) return 2;
  if (streak >= STREAK_TIER_1) return 1;
  return 0;
}

// ── Mode Key Mapping ──────────────────────────────────────
export type StreakKey = 'bo1' | 'bo3' | 'bo5';

export function getStreakKey(seriesLength: number): StreakKey {
  if (seriesLength === 3) return 'bo3';
  if (seriesLength === 5) return 'bo5';
  return 'bo1';
}

// ── Streak Accessors ──────────────────────────────────────
export function getStreakForMode(data: StreakData, key: StreakKey): number {
  return data[key].currentStreak;
}

export function getBestStreakForMode(data: StreakData, key: StreakKey): number {
  return data[key].bestStreak;
}

export function isNewRecord(data: StreakData, key: StreakKey): boolean {
  return data[key].currentStreak > data[key].bestStreak;
}

export function getDistanceToBest(data: StreakData, key: StreakKey): number {
  return Math.max(0, data[key].bestStreak - data[key].currentStreak);
}

// ── Streak Mutations (return new object) ──────────────────
function cloneData(data: StreakData): StreakData {
  return {
    bo1: { ...data.bo1 },
    bo3: { ...data.bo3 },
    bo5: { ...data.bo5 },
  };
}

export function incrementStreak(data: StreakData, key: StreakKey): StreakData {
  const next = cloneData(data);
  next[key].currentStreak++;
  if (next[key].currentStreak > next[key].bestStreak) {
    next[key].bestStreak = next[key].currentStreak;
  }
  return next;
}

export function resetStreak(data: StreakData, key: StreakKey): StreakData {
  const next = cloneData(data);
  next[key].currentStreak = 0;
  return next;
}

// ── Persistence ───────────────────────────────────────────
function makeDefault(): StreakData {
  return {
    bo1: { currentStreak: 0, bestStreak: 0 },
    bo3: { currentStreak: 0, bestStreak: 0 },
    bo5: { currentStreak: 0, bestStreak: 0 },
  };
}

export function loadStreaks(): StreakData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const data = makeDefault();
      for (const k of ['bo1', 'bo3', 'bo5'] as StreakKey[]) {
        if (parsed[k]) {
          data[k].currentStreak = parsed[k].currentStreak ?? 0;
          data[k].bestStreak = parsed[k].bestStreak ?? 0;
        }
      }
      return data;
    } catch (err) {
      warnDev('streak: failed to parse stored streaks, resetting', err);
    }
  }
  // Migrate legacy flat stats
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      const old = JSON.parse(legacy);
      if (typeof old.bestStreak === 'number') {
        const data = makeDefault();
        data.bo1.bestStreak = old.bestStreak;
        return data;
      }
    } catch (err) {
      warnDev('streak: failed to parse legacy stats', err);
    }
  }
  return makeDefault();
}

export function saveStreaks(data: StreakData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
