// ── SimContext builder for single-player grind ─────────
// Builds a minimal SimState-compatible object that advancePlayer's grind
// path can read (tick, trails, players[i].{x,z,alive,vehicleType,grindCooldown}).
//
// Intended for local (non-lockstep) use only. The returned state references
// the caller's player sims and trails directly (not cloned), so the
// advancePlayer shallow-copy-then-write-back model works correctly: each
// per-player call mutates a working copy and the caller's authoritative
// PlayerSim is updated in place after advancePlayer returns.

import type { SimState, PlayerSim, TrailPoint } from './simulation';

/**
 * Build a SimState for single-player grind operation.
 *
 * @param tick           monotonically increasing tick counter (for seedGrindRng)
 * @param players        array of persistent PlayerSims (passed by reference)
 * @param trails         array of trail point arrays, one per player (by reference)
 */
export function buildLocalSimContext(
  tick: number,
  players: PlayerSim[],
  trails: TrailPoint[][],
): SimState {
  return {
    tick,
    players,
    trails,
  };
}
