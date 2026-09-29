/**
 * SPEC-89: Shared types for the FLOW scoring system.
 */

export type PassiveSource = 'slipstream' | 'grind' | 'drift-low' | 'drift-med' | 'drift-high';
export type BankSource = 'drift' | 'slipstream' | 'grind';
export type TrickKind = 'drift' | 'slipstream' | 'grind' | 'elimination' | 'boost' | 'survival' | 'near-miss';
export type CapState = 'open' | 'soft' | 'hard';

export interface FlowSnapshot {
  active: number;
  passiveSubtotal: number;
  bonusSubtotal: number;
  tierIndex: 0 | 1 | 2 | 3;
  multiplier: number;
  capState: CapState;
  lastGainAmount: number;
  lastGainAt: number;
  pendingBanks: readonly PendingBank[];
}

export interface PendingBank {
  id: number;
  amount: number;
  source: BankSource;
  spawnedAt: number;
}

export interface TrickLogEntry {
  kind: TrickKind;
  amount: number;
  count?: number;
}

export interface RoundResult {
  passiveSubtotal: number;
  bonusSubtotal: number;
  subtotal: number;
  multiplier: number;
  tierIndex: number;
  awarded: number;
  capApplied: 'none' | 'soft' | 'hard';
  died: boolean;
  trickLog: TrickLogEntry[];
}
