// ── Elo MMR Calculation ─────────────────────────────────
// Pure math module — no Firebase dependencies.
// Importable by both client (display) and Cloud Functions (calculation).

import { DEFAULT_MMR, PLACEMENT_MATCHES } from './types';

/** Standard Elo expected score: probability A beats B. */
export function expectedScore(mmrA: number, mmrB: number): number {
  return 1 / (1 + Math.pow(10, (mmrB - mmrA) / 400));
}

/**
 * K-factor based on MMR and games played.
 * - Placement (<5 games): K=64 for fast convergence
 * - Normal (<2000 MMR):   K=32
 * - High (>=2000 MMR):    K=24
 * - Master+ (>=2400 MMR): K=16
 */
export function getKFactor(mmr: number, gamesPlayed: number): number {
  if (gamesPlayed < PLACEMENT_MATCHES) return 64;
  if (mmr >= 2400) return 16;
  if (mmr >= 2000) return 24;
  return 32;
}

/**
 * Calculate new MMR for both players after a match.
 * Returns updated MMR values (floored at 0).
 */
// ts-prune-ignore-next
export function calculateNewMmr(
  winnerMmr: number,
  loserMmr: number,
  winnerGames: number,
  loserGames: number,
): { winnerNew: number; loserNew: number } {
  const eWin = expectedScore(winnerMmr, loserMmr);
  const eLose = expectedScore(loserMmr, winnerMmr);

  const kWin = getKFactor(winnerMmr, winnerGames);
  const kLose = getKFactor(loserMmr, loserGames);

  const winnerNew = Math.max(0, Math.round(winnerMmr + kWin * (1 - eWin)));
  const loserNew = Math.max(0, Math.round(loserMmr + kLose * (0 - eLose)));

  return { winnerNew, loserNew };
}

export { DEFAULT_MMR, PLACEMENT_MATCHES };
