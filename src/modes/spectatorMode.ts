// ── Spectator Mode ───────────────────────────────────────
// Extracted from game.ts — spectator camera target picking,
// AI-only sim tick during spectating, and end-of-spectating
// round resolution (stats, series, streaks, replay saving).

import { Player } from '../player';
import { getAIInput } from '../ai';
import { updateProximitySpeed, applyWallRepulsion } from '../core/collisionSystem';
import { ARENA_SIZE, updateWallGlow } from '../grid';
import { saveReplay } from '../replayStore';
import { resolveRound } from '../core/roundResolution';
import { Trail } from '../trail';
import { ReplayRecorder } from '../replay';
import type { ReplaySnapshot, MatchInfo, KillcamData, GameStats } from '../types/index';
import type { IGameCore } from './index';
import type { StreakData } from '../types';
import type { StreakKey } from '../streak';

export interface ISpectatorHost extends IGameCore {
  matchTime: number;
  _spectateTarget: Player | null;
  _killcamData: KillcamData | null;

  // AI frame counter
  _aiFrame: number;

  // Series
  seriesLength: number;
  seriesPlayerWins: number;
  seriesAiWins: number[];
  seriesOver: boolean;
  opponentCount: number;
  /** TASK-292: stable id linking all rounds of a best-of series. */
  readonly currentSeriesId: string | null;

  // Stats / streaks
  stats: GameStats;
  streakData: StreakData;

  // Replay
  _replayRecorder: ReplayRecorder;
  _lastReplaySnapshot: ReplaySnapshot | null;
  _lastSavedReplayId: string | null;
  _seriesReplayIds: string[];

  // Callbacks
  onMatchEnd: ((result: string, matchTime: number, seriesLength: number, opponentCount: number, replayId: string | null) => void) | null;

  // Methods
  _checkCollisions(): void;
  _showResultScreen(): Promise<void>;
  _refreshMatchSelector(): void;
  _updateSeriesHUD(): void;
  _getStreakKey(): StreakKey;
}

export class SpectatorMode {
  private host: ISpectatorHost;
  private _currentTarget: Player | null = null;

  constructor(host: ISpectatorHost) {
    this.host = host;
  }

  /** Pick the AI closest to another AI (most likely to collide = most exciting).
   *  Hysteresis: if we already have a target, only switch if the new candidate's
   *  nearest-neighbour distance is at least 30% closer — prevents rapid flipping
   *  between equally-close AIs that causes visible camera snaps. */
  pickTarget(): Player | null {
    const alive = this.host.ais.filter(ai => ai.player.alive).map(ai => ai.player);
    if (alive.length === 0) return null;
    if (alive.length === 1) return alive[0];

    // For each alive AI, compute its nearest-neighbour distance
    const dists: Map<Player, number> = new Map();
    for (let i = 0; i < alive.length; i++) {
      const pi = alive[i].getPosition();
      let nearest = Infinity;
      for (let j = 0; j < alive.length; j++) {
        if (i === j) continue;
        const pj = alive[j].getPosition();
        const d = Math.hypot(pi.x - pj.x, pi.z - pj.z);
        if (d < nearest) nearest = d;
      }
      dists.set(alive[i], nearest);
    }

    // Find the overall best (smallest nearest-neighbour distance)
    let best: Player = alive[0];
    let bestDist = dists.get(alive[0])!;
    for (let i = 1; i < alive.length; i++) {
      const d = dists.get(alive[i])!;
      if (d < bestDist) { bestDist = d; best = alive[i]; }
    }

    // Hysteresis: keep current target unless the new one is meaningfully better
    const current = this._currentTarget;
    if (current && current.alive && dists.has(current)) {
      const currentDist = dists.get(current)!;
      if (bestDist >= currentDist * 0.7) return current;
    }

    this._currentTarget = best;
    return best;
  }

  updateSim(dt: number): void {
    const host = this.host;

    // Build trail list (dead player trails are still obstacles)
    const allTrails: Trail[] = [host.player!.trail];
    for (const ai of host.ais) allTrails.push(ai.player.trail);

    // AI input + update
    host._aiFrame = (host._aiFrame || 0) + 1;
    for (let idx = 0; idx < host.ais.length; idx++) {
      const ai = host.ais[idx];
      if (!ai.player.alive || !ai.aiState) continue;
      if (host._aiFrame % 3 === idx % 3) {
        ai._lastInput = getAIInput(ai.player, allTrails, dt, ai.aiState, host.player!.trail, ai.player.trail);
      }
      const input = ai._lastInput || { turn: 0, accelerate: false, dash: false, brake: false };
      ai.player.update(dt, input.turn, input.accelerate, input.dash, input.brake);
    }

    // Meter recharge (AI-to-AI + dead player trails)
    for (let i = 0; i < host.ais.length; i++) {
      if (!host.ais[i].player.alive) continue;
      host.ais[i].player.rechargeMeter(host.player!.trail, dt);
      for (let j = 0; j < host.ais.length; j++) {
        if (i !== j) host.ais[i].player.rechargeMeter(host.ais[j].player.trail, dt);
      }
    }

    // Wall recharge + glow
    const half: number = ARENA_SIZE / 2;
    let nearestWallDist: number = Infinity;
    for (const ai of host.ais) {
      if (!ai.player.alive) continue;
      const pos = ai.player.getPosition();
      const wallDist = Math.min(half - Math.abs(pos.x), half - Math.abs(pos.z));
      if (wallDist < nearestWallDist) nearestWallDist = wallDist;
      if (wallDist < 8 && !ai.player.dashing) {
        const factor = 1 - wallDist / 8;
        ai.player.meter = Math.min(100, ai.player.meter + 104 * factor * dt);
        ai.player.meterGaining = true;
      }
    }
    updateWallGlow(nearestWallDist);

    // Proximity speed + wall repulsion
    for (const ai of host.ais) {
      if (!ai.player.alive) continue;
      updateProximitySpeed(ai.player);
      applyWallRepulsion(ai.player, dt, host.mode);
    }

    // Collision detection (uses _checkCollisions which checks all alive entities)
    host._checkCollisions();

    // Death animations
    for (const ai of host.ais) {
      if (!ai.player.alive) ai.player.updateDeath(dt);
    }
    if (host.player && !host.player.alive) host.player.updateDeath(dt);

    // Match timer
    host.matchTime += dt;
  }

  endSpectating(): void {
    const host = this.host;

    host._spectating = false;
    host._spectateTarget = null;
    host._killcamPhase = 'none';
    const label = document.getElementById('spectator-label');
    if (label) label.classList.add('hidden');

    // In online mode, triggerOnlineGameover handles results — don't show here.
    // If triggerOnlineGameover already fired and set _killcamData, show now.
    const isOnlineMatch = host.mode === 'online' && host._onlineMatch;
    if (isOnlineMatch) {
      if (host._killcamData) {
        host._showResultScreen();
      }
      return;
    }

    // Compute deferred stats (player is dead — result is 'ai' or 'draw')
    const allAisDead = host.ais.every(ai => !ai.player.alive);
    const matchTime = host.matchTime;

    const resolution = resolveRound({
      playerAlive: false,
      allAisDead,
      matchTime,
      seriesLength: host.seriesLength,
      seriesPlayerWins: host.seriesPlayerWins,
      seriesAiWins: host.seriesAiWins,
      lastAliveAiIndex: host.ais.findIndex(ai => ai.player.alive),
      streakKey: host._getStreakKey(),
      streakData: host.streakData,
      stats: host.stats,
    });

    const roundResult = resolution.roundResult;
    host.stats = resolution.updatedStats;
    host.streakData = resolution.updatedStreakData;
    host.seriesPlayerWins = resolution.updatedSeriesPlayerWins;
    host.seriesAiWins = resolution.updatedSeriesAiWins;
    host.seriesOver = resolution.seriesOver;
    const playerWonSeries = resolution.playerWonSeries;
    const anyAiWonSeries = resolution.anyAiWonSeries;

    // Streak loss: resolveRound() already reset streak data and saved.
    // No killcam extension or ceremony in spectator path — goes straight to results.

    // Save replay
    if (host._replayRecorder.hasData()) {
      const recorder = host._replayRecorder;
      const seriesLen = host.seriesLength;
      const spw = host.seriesPlayerWins;
      const saw = [...host.seriesAiWins];
      const opCount = host.opponentCount;
      const onEnd = host.onMatchEnd;
      const self = host;

      const doSave = (): void => {
        const snapshot: ReplaySnapshot = recorder.getSnapshot();
        self._lastReplaySnapshot = snapshot;
        const winnerName = roundResult === 'draw' ? 'DRAW' : 'AI';
        saveReplay(snapshot, {
          result: roundResult as MatchInfo['result'],
          matchType: 'ai',
          winnerName, opponentName: 'AI',
          // TASK-292: thread the seriesId through so every round links together.
          seriesInfo: seriesLen > 1 ? { length: seriesLen, playerWins: spw, aiWins: saw, roundIndex: 0, seriesId: host.currentSeriesId } : null,
        }).then((id: string) => {
          self._lastSavedReplayId = id;
          self._seriesReplayIds.push(id);
          self._refreshMatchSelector();
          if (onEnd) onEnd(roundResult, matchTime, seriesLen, opCount, id);
        });
      };

      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(doSave, { timeout: 2000 });
      } else {
        doSave();
      }
    } else if (host.onMatchEnd) {
      host.onMatchEnd(roundResult, matchTime, host.seriesLength, host.opponentCount, null);
    }

    // Show result screen directly (no second killcam)
    host._killcamData = { roundResult, playerWonSeries, anyAiWonSeries };
    host._showResultScreen();

    // _showResultScreen already calls _applyResultButtonVisibility
  }
}
