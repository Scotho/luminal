// ── Online Mode Helpers ──────────────────────────────────
// Module-level helpers shared between onlineMode phases
// (startOnlineMatch, updateLockstepTick, updateOnlineSync).

import { Player } from '../player';
import { Trail } from '../trail';
import { grid } from '../spatialGrid';
import type { IOnlineModeHost } from './onlineModeTypes';

/**
 * Map a lockstep player index to the visual Player object.
 * Layout: myIndex → host.player; other human indices → host.ais[rIdx] (aiState null);
 * AI indices (>= humanCount) → host.ais[remoteHumanCount + aiOffset].
 */
export function _getLockstepPlayer(
  host: IOnlineModeHost,
  myIndex: number,
  humanCount: number,
  playerIndex: number,
): Player | null {
  if (playerIndex === myIndex) return host.player;
  // Build remote-human offset
  let rIdx = 0;
  for (let i = 0; i < humanCount; i++) {
    if (i === myIndex) continue;
    if (i === playerIndex) return host.ais[rIdx]?.player ?? null;
    rIdx++;
  }
  // AI players (index >= humanCount)
  const remoteHumanCount = humanCount - 1;
  const aiOffset = playerIndex - humanCount;
  return host.ais[remoteHumanCount + aiOffset]?.player ?? null;
}

/**
 * Advance fading trail segments for all players, then finalize destruction
 * (mark destroyed + remove from spatial grid) once fade completes.
 */
export function _tickAllFadingSegments(host: IOnlineModeHost, dt: number): void {
  const allPlayers: Player[] = [];
  if (host.player) allPlayers.push(host.player);
  for (const ai of host.ais) allPlayers.push(ai.player);

  for (const player of allPlayers) {
    const completed = player.trail.tickFadingSegments(dt);
    for (const idx of completed) {
      player.trail.markSegmentDestroyed(idx);
      grid.removeSegment(player.trail, idx);
    }
  }
}

// ── Module-level helpers (duplicated from game.ts to avoid circular deps) ──

let _slipOverlay: HTMLElement | null = null;

export function _updateSlipstreamOverlay(prox: number): void {
  if (!_slipOverlay) _slipOverlay = document.getElementById('slipstream-overlay');
  if (!_slipOverlay) return;
  if (prox > 0.1) {
    _slipOverlay.classList.add('slipstream--active');
    const alpha: string = (prox * 0.15).toFixed(3);
    const chroma: string = Math.min(1, prox * 1.2).toFixed(2);
    const offset: string = (prox * 3).toFixed(1);
    _slipOverlay.style.setProperty('--slip-alpha', alpha);
    _slipOverlay.style.setProperty('--slip-chroma', chroma);
    _slipOverlay.style.setProperty('--slip-offset', offset);
  } else if (prox < 0.05) {
    _slipOverlay.classList.remove('slipstream--active');
  }
}

export function _clearSlipstreamOverlay(): void {
  if (!_slipOverlay) _slipOverlay = document.getElementById('slipstream-overlay');
  if (!_slipOverlay) return;
  _slipOverlay.classList.remove('slipstream--active');
  _slipOverlay.style.setProperty('--slip-alpha', '0');
  _slipOverlay.style.setProperty('--slip-chroma', '0');
  _slipOverlay.style.setProperty('--slip-offset', '0');
}

export function _collectEnemyTrails(
  ais: { player: Player }[],
  opponent: Player | null,
  self: Player,
): Trail[] {
  const trails: Trail[] = [];
  for (const ai of ais) {
    if (ai.player !== self && ai.player.alive) trails.push(ai.player.trail);
  }
  if (opponent && opponent !== self && opponent.alive && !trails.includes(opponent.trail)) {
    trails.push(opponent.trail);
  }
  return trails;
}
