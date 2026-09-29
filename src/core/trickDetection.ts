// ── Trick Detection — pure function for airborne trick recognition ──

export interface TrickDef {
  name: string;
  pattern: number[];  // sequence of -1 (left), 1 (right)
  meterBonus: number;
}

export const TRICKS: TrickDef[] = [
  { name: 'CORKSCREW',  pattern: [1, -1, -1, 1],  meterBonus: 15 },
  { name: 'REVERSAL',   pattern: [1, -1, 1],       meterBonus: 12 },
  { name: 'FLIP',       pattern: [-1, 1, -1],      meterBonus: 12 },
  { name: 'SPIN',       pattern: [1, 1, 1],        meterBonus: 8 },
  { name: 'WHIP',       pattern: [-1, -1, -1],     meterBonus: 8 },
];

// Pre-sorted by pattern length descending so longest match wins
const _sortedTricks = [...TRICKS].sort((a, b) => b.pattern.length - a.pattern.length);

/**
 * Check if the tail of `buffer` matches any trick pattern.
 * Returns the longest matching trick, or null.
 */
export function detectTrick(buffer: number[]): TrickDef | null {
  const len = buffer.length;
  for (const trick of _sortedTricks) {
    const pLen = trick.pattern.length;
    if (pLen > len) continue;
    let match = true;
    for (let i = 0; i < pLen; i++) {
      if (buffer[len - pLen + i] !== trick.pattern[i]) {
        match = false;
        break;
      }
    }
    if (match) return trick;
  }
  return null;
}
