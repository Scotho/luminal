// ── Game-side collision resolver (extracted from game.ts) ──
// Moved as-is from Game._checkCollisions so game.ts can stay under the file-size budget.
// The Game instance is passed in; this function mutates `game` state exactly like
// the original method did — no behavioral changes, no smell fixes. Scope is a
// refactor, not a rewrite. TASK-237.

import * as THREE from 'three';

import { AI_SKIP_OWN } from '../ai';
import { grid } from '../spatialGrid';
import { isOutOfBounds } from '../grid';
import { destroyOpponentAudio, fadeOutAllOpponentEngines, fadeOutOpponentEngine, playOpponentSound, SoundRange, stopOpponentEngine } from '../spatialAudio';
import { playExplosion, stopGrindLoop, stopProximitySpark } from '../sfx';
import { fadeOutVehicleEngine } from '../vehicleAudioEngine';
import { stopNearMiss } from '../sfxAssets';
import { vibrate, VIBE } from '../vibrate';
import { resolveRound } from './roundResolution';
import { HIT_RADIUS } from './simulation';
import { hideStreakDisplay, updateStreakDisplay } from '../ui/streakUI';
import { handleStreakLoss as _handleStreakLossImpl } from '../ui/streakCeremony';
import { bridgeEndRound, bridgeElimination } from '../flow/flowBridge';
import { clearEnemySlipstreamVFX } from './collisionSystem';
import type { Player } from '../player';
import type { MatchInfo, ReplaySnapshot } from '../types/index';
import { saveReplay } from '../replayStore';

// Forward-declared structural type of the Game instance — avoids a circular
// import with game.ts while still giving us strong typing on every field we
// read or write. Mirrors the fields `_checkCollisions` originally touched.
import type { Game } from '../game';

// Helper — mirrors the module-level helper in game.ts. Duplicated rather than
// exported to keep this extraction self-contained.
function clearSlipstreamOverlay(): void {
  const el: HTMLElement | null = document.getElementById('slipstream-overlay');
  if (!el) return;
  el.classList.remove('slipstream--active');
  el.style.setProperty('--slip-alpha', '0');
  el.style.setProperty('--slip-chroma', '0');
  el.style.setProperty('--slip-offset', '0');
  document.body.classList.remove('slipstream-phase-entry', 'slipstream-phase-lockin', 'slipstream-phase-active');
}

export function checkCollisions(game: Game): void {
  // Check if game is already over (all AIs or player dead)
  const anyAiAlive: boolean = game.ais.some(ai => ai.player.alive);
  if (!game.player!.alive && !game._spectating) return;
  if (!anyAiAlive) return;

  // Collect all alive players and trails
  const allPlayers: { obj: Player; isPlayer: boolean }[] = [{ obj: game.player!, isPlayer: true }];
  for (const ai of game.ais) allPlayers.push({ obj: ai.player, isPlayer: false });

  // Determine who dies this frame (reuse array to avoid Set allocation)
  const deadThisFrame: { obj: Player; isPlayer: boolean }[] = [];
  const isOnline: boolean = game.mode === 'online';

  for (const entry of allPlayers) {
    if (!entry.obj.alive) continue;
    // God mode — skip all collision for the human player
    if (game.adminGodMode && entry.isPlayer) continue;
    // In online mode, skip collision checks for the REMOTE opponent —
    // their death is reported by their own client via netcode.
    // Checking the interpolated opponent position locally causes false
    // draws because the position is 80ms behind reality.
    // Lobby AIs (aiState !== null) are computed locally and need collision checks.
    if (isOnline && !entry.isPlayer) {
      const aiEntry = game.ais.find(a => a.player === entry.obj);
      if (!aiEntry || !aiEntry.aiState) continue; // skip remote opponent only
    }
    const pos = entry.obj.getPosition();

    // Out of bounds (applies to everyone including grinders — defensive)
    if (isOutOfBounds(pos.x, pos.z)) {
      deadThisFrame.push(entry);
      continue;
    }

    // Grinders and airborne players skip the trail-wall check. Their position
    // is snapped onto a trail segment (grind) or elevated above the arena
    // (airborne). The normal HIT_RADIUS collision would produce false
    // positives — grind init sets position = trail segment position, which
    // is 0 units from the trail, well inside HIT_RADIUS=0.8. Without this
    // exemption, every enemy-trail grind face-plants on the same frame it
    // starts. Mirrors the lockstep exemption at simulation.ts:1338 (BUG-18).
    if (entry.obj.isGrinding || entry.obj.isAirborne) continue;

    // Check collision against all trails via spatial grid (single query)
    if (grid.checkCollision(pos.x, pos.z, HIT_RADIUS, entry.obj.trail, AI_SKIP_OWN)) {
      deadThisFrame.push(entry);
    }
  }

  // Head-on collisions between all pairs of alive players
  for (let i = 0; i < allPlayers.length; i++) {
    if (!allPlayers[i].obj.alive) continue;
    if (game.adminGodMode && allPlayers[i].isPlayer) continue;
    const pi = allPlayers[i].obj.getPosition();
    for (let j = i + 1; j < allPlayers.length; j++) {
      if (!allPlayers[j].obj.alive) continue;
      if (game.adminGodMode && allPlayers[j].isPlayer) continue;
      const pj = allPlayers[j].obj.getPosition();
      if (Math.hypot(pi.x - pj.x, pi.z - pj.z) < 2.0) {
        deadThisFrame.push(allPlayers[i]);
        deadThisFrame.push(allPlayers[j]);
      }
    }
  }

  if (deadThisFrame.length === 0) return;

  // Kill everyone who died
  let playerDied = false;
  let anyAiDied = false;
  for (const entry of deadThisFrame) {
    if (entry.obj.alive) {
      entry.obj.kill();
      if (entry.isPlayer) { playerDied = true; vibrate(VIBE.death); }
      else anyAiDied = true;

      // In online mode, report deaths through OnlineMatch for proper sync
      // Anticheat: only report OWN death — opponent death detected via state sync (alive:false)
      // Deferred to next microtask — network write doesn't need to block the death frame
      if (game.mode === 'online' && game._onlineMatch) {
        if (entry.isPlayer) {
          // Report own death via netcode
          Promise.resolve().then(() => game._onlineMatch!.reportLocalDeath(game._onlineMatch!.myUid));
        } else {
          // Distinguish lobby AI deaths from remote opponent death
          const aiEntry = game.ais.find(a => a.player === entry.obj);
          if (aiEntry && aiEntry.aiState) {
            // Lobby AI died — both clients compute identically, register locally
            Promise.resolve().then(() => game._onlineMatch!.registerAiDeath());
          } else {
            // Opponent death detected locally — register in deathsThisRound but don't send via netcode
            // The opponent's own client will report their death, or alive:false state sync will catch it
            const diedUid = aiEntry?.uid;
            if (diedUid) Promise.resolve().then(() => game._onlineMatch!.registerLocalOpponentDeath(diedUid));
          }
        }
      }
    }
  }
  // FLOW: award elimination bonus for each AI the player killed this frame
  if (anyAiDied && !playerDied) {
    const now = performance.now();
    for (const entry of deadThisFrame) {
      if (!entry.isPlayer) {
        bridgeElimination(game._flowState, now);
      }
    }
  }

  // Spatial explosion for each dead AI
  if (anyAiDied) {
    for (const entry of deadThisFrame) {
      if (entry.isPlayer) continue;
      const idx = game.ais.findIndex(a => a.player === entry.obj);
      if (idx < 0) continue;
      const oppId = game.ais[idx].uid || `ai-${idx}`;
      playOpponentSound(oppId, SoundRange.LONG, d => playExplosion(d));
      fadeOutOpponentEngine(oppId, 0.3);
      const capturedId = oppId;
      setTimeout(() => {
        stopOpponentEngine(capturedId);
        destroyOpponentAudio(capturedId);
      }, 500);
      // TASK-300 SPEC-89: elimination FLOW already awarded via bridgeElimination above.
    }
  }
  // Local player explosion stays centered
  if (playerDied) setTimeout(() => playExplosion(), 0);

  // Fade out engine + all looping sounds on player death
  if (playerDied) {
    stopProximitySpark(0.3);
    stopGrindLoop();
    stopNearMiss();
    clearEnemySlipstreamVFX();
    clearSlipstreamOverlay();
    fadeOutVehicleEngine(0.3);
    fadeOutAllOpponentEngines(0.5);
    // SPEC-94: Fast-fade tire streaks on death
    if (game.player?._tireStreaks) {
      game.player._tireStreaks.fastFade(800);
    }
  }

  // In online mode, don't independently determine gameover — OnlineMatch coordinates via roundOver callback
  // But start killcam immediately so the player sees the death animation while waiting for server
  if (game.mode === 'online' && game._onlineMatch) {
    if (playerDied && game.state !== 'gameover') {
      if (!game._killcamPos) game._killcamPos = new THREE.Vector3();
      if (!game._killcamStartCamPos) game._killcamStartCamPos = new THREE.Vector3();
      const dp = game.player!.mesh.position;
      game._killcamPos.set(dp.x, 0.7, dp.z);
      game._killcamActive = true;
      game._killcamTimer = 0;
      game._killcamDelayTimer = 0;
      game._killcamPhase = 'slowmo';
      game._killcamStartCamPos.copy(game.camera.position);
      game.state = 'gameover';
      // TASK-300 SPEC-89: online player death ends this FLOW round as died.
      bridgeEndRound(game._flowState, 'died');
      requestAnimationFrame(() => {
        document.getElementById('meter-wrap')!.classList.add('menu-hidden');
        document.getElementById('flow-hud')?.classList.add('menu-hidden');
        document.getElementById('radar')!.classList.add('hidden');
      });
    }
    return;
  }

  // Check if round is over: all humans dead OR all opponents dead
  const allAisDead: boolean = game.ais.length === 0 || game.ais.every(ai => !ai.player.alive);
  const allHumansDead = !game.player!.alive;
  const aliveCount = allPlayers.filter(e => e.obj.alive).length;

  // Player dead but 2+ AIs still fighting → enter killcam then spectate (not full gameover yet)
  if (allHumansDead && aliveCount >= 2 && game.state !== 'gameover') {
    // Fade out all audio smoothly for killcam
    stopProximitySpark(0.3);
    stopGrindLoop();
    stopNearMiss();
    clearEnemySlipstreamVFX();
    clearSlipstreamOverlay();
    fadeOutVehicleEngine(0.3);
    fadeOutAllOpponentEngines(0.5);

    // Capture death position for killcam
    if (!game._killcamPos) game._killcamPos = new THREE.Vector3();
    if (!game._killcamStartCamPos) game._killcamStartCamPos = new THREE.Vector3();
    let foundDeath = false;
    for (const entry of deadThisFrame) {
      const p = entry.obj.mesh.position;
      game._killcamPos.set(p.x, 0.7, p.z);
      foundDeath = true;
    }
    if (!foundDeath && game.player && !game.player.alive) {
      const p = game.player.mesh.position;
      game._killcamPos.set(p.x, 0.7, p.z);
      foundDeath = true;
    }
    if (!foundDeath) {
      const fb = game.player?.mesh?.position || game.camera.position;
      game._killcamPos.set(fb.x, 0.7, fb.z);
    }

    // Enter killcam → will transition to spectating after orbit
    game._killcamActive = true;
    game._killcamTimer = 0;
    game._killcamDelayTimer = 0;
    game._killcamPhase = 'slowmo';
    game._killcamStartCamPos.copy(game.camera.position);
    game._spectating = true; // flag: orbit end → spectate instead of results
    game.state = 'gameover';
    // TASK-300 SPEC-89: player is dead but match continues — round-over is 'died'.
    bridgeEndRound(game._flowState, 'died');

    // Hide HUD
    requestAnimationFrame(() => {
      document.getElementById('meter-wrap')!.classList.add('menu-hidden');
      document.getElementById('flow-hud')?.classList.add('menu-hidden');
      document.getElementById('radar')!.classList.add('hidden');
    });
    return;
  }

  // During spectating, round end is handled by _endSpectating()
  if (game._spectating) return;

  const roundOver: boolean = aliveCount <= 1 || allHumansDead;
  if (!roundOver) return; // some are still fighting

  // Fade out all audio smoothly for killcam
  stopProximitySpark(0.3);
  stopGrindLoop();
  stopNearMiss();
  clearEnemySlipstreamVFX();
  clearSlipstreamOverlay();
  fadeOutVehicleEngine(0.3);
  fadeOutAllOpponentEngines(0.5);

  // SPEC-94: Fast-fade tire streaks on round end (cleanup before killcam)
  if (game.player?._tireStreaks) {
    game.player._tireStreaks.fastFade(800);
  }

  // Capture death position for killcam — focus on whoever just died
  // Reuse scratch vectors to avoid heap allocations on the death frame
  if (!game._killcamPos) game._killcamPos = new THREE.Vector3();
  if (!game._killcamStartCamPos) game._killcamStartCamPos = new THREE.Vector3();
  let foundDeath = false;
  for (const entry of deadThisFrame) {
    const p = entry.obj.mesh.position;
    game._killcamPos.set(p.x, 0.7, p.z);
    foundDeath = true;
  }
  if (!foundDeath && game.player && !game.player.alive) {
    const p = game.player.mesh.position;
    game._killcamPos.set(p.x, 0.7, p.z);
    foundDeath = true;
  }
  if (!foundDeath) {
    const fb = game.player?.mesh?.position || game.camera.position;
    game._killcamPos.set(fb.x, 0.7, fb.z);
  }

  // Enter killcam phase — start with slow-mo before orbiting
  game._killcamActive = true;
  game._killcamTimer = 0;
  game._killcamDelayTimer = 0;
  game._killcamPhase = 'slowmo';
  game._killcamStartCamPos.copy(game.camera.position);
  game.state = 'gameover';

  // Pre-load modules needed by result screen during killcam idle time
  import('../leaderboard');
  import('../firebase');

  // Capture state needed for deferred UI work
  const playerAlive: boolean = game.player!.alive;
  const matchTime: number = game.matchTime;

  // Record stats + resolve series/streak via shared function
  const resolution = resolveRound({
    playerAlive,
    allAisDead,
    matchTime,
    seriesLength: game.seriesLength,
    seriesPlayerWins: game.seriesPlayerWins,
    seriesAiWins: game.seriesAiWins,
    lastAliveAiIndex: game.ais.findIndex(ai => ai.player.alive),
    streakKey: game._getStreakKey(),
    streakData: game.streakData,
    stats: game.stats,
  });

  const roundResult = resolution.roundResult;
  game.stats = resolution.updatedStats;
  game.streakData = resolution.updatedStreakData;
  game.seriesPlayerWins = resolution.updatedSeriesPlayerWins;
  game.seriesAiWins = resolution.updatedSeriesAiWins;
  game.seriesOver = resolution.seriesOver;
  const playerWonSeries = resolution.playerWonSeries;
  const anyAiWonSeries = resolution.anyAiWonSeries;

  // FLOW: end round — compute awarded FLOW (SPEC-89)
  const flowOutcome = playerAlive ? 'won' as const : 'died' as const;
  game._lastFlowRoundResult = bridgeEndRound(game._flowState, flowOutcome);

  if (resolution.playerWon) {
    game._victoryFireworks = true;
  }

  if (resolution.streakLoss) {
    const sl = resolution.streakLoss;
    const result = _handleStreakLossImpl(sl.streak, sl.wasRecord, sl.distanceToBest);
    game._killcamDuration += result.killcamDurationDelta;
    game._streakCeremony = result.ceremony;
    game._lastStreakEnd = result.lastStreakEnd;
  }

  if (resolution.streakIncrement) {
    game._streakIncrementAnim = {
      prevStreak: resolution.streakIncrement.prevStreak,
      newStreak: resolution.streakIncrement.newStreak,
      phase: 'pending',
    };
    game._streakIncrementTimer = 0;
    game._killcamDuration += 0.5;
    updateStreakDisplay(resolution.streakIncrement.newStreak, resolution.streakIncrement.prevStreak, resolution.streakIncrement.best);
  }

  // Save replay to IndexedDB — deferred well past the killcam animation
  // (0.5s slow-mo + 2.5s orbit = 3s) so compression work doesn't cause
  // frame drops during the death sequence. Uses requestIdleCallback when
  // available so the browser can schedule it in a gap between frames.
  if (game._replayRecorder.hasData()) {
    const recorder = game._replayRecorder;
    const mode = game.mode;
    const onlineMatch = game._onlineMatch;
    const seriesLen = game.seriesLength;
    const seriesPlayerWins = game.seriesPlayerWins;
    const seriesAiWins = [...game.seriesAiWins];
    const opCount = game.opponentCount;
    const onEnd = game.onMatchEnd;
    const doSave = (): void => {
      const snapshot: ReplaySnapshot = recorder.getSnapshot();
      game._lastReplaySnapshot = snapshot;
      const matchType: string = mode === 'online' ? 'casual' : 'ai';
      let winnerName = 'DRAW';
      if (roundResult === 'player') {
        winnerName = 'YOU';
      } else if (roundResult === 'ai') {
        winnerName = mode === 'online' && onlineMatch
          ? onlineMatch.opponentName : 'AI';
      }
      const opponentName: string = mode === 'online' && onlineMatch
        ? onlineMatch.opponentName : 'AI';

      saveReplay(snapshot, {
        result: roundResult as MatchInfo['result'],
        matchType: matchType as MatchInfo['matchType'],
        winnerName,
        opponentName,
        seriesInfo: seriesLen > 1 ? {
          length: seriesLen,
          playerWins: seriesPlayerWins,
          aiWins: seriesAiWins,
          roundIndex: 0,
          // TASK-292: stable id linking every round of this best-of.
          seriesId: game.currentSeriesId,
        } : null,
      }).then((id: string) => {
        game._lastSavedReplayId = id;
        game._seriesReplayIds.push(id);
        game._refreshMatchSelector();
        if (onEnd) onEnd(roundResult, matchTime, seriesLen, opCount, id);
      });
    };

    // Schedule after killcam finishes (~3s), then use idle callback if available
    setTimeout(() => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(doSave, { timeout: 2000 });
      } else {
        doSave();
      }
    }, 2500);
  } else if (game.onMatchEnd) {
    game.onMatchEnd(roundResult, matchTime, game.seriesLength, game.opponentCount, null);
  }

  // Store data for deferred result screen (shown after killcam)
  game._killcamData = { roundResult, playerWonSeries, anyAiWonSeries };
  // Hide HUD immediately, update series score
  requestAnimationFrame(() => {
    document.getElementById('meter-wrap')!.classList.add('menu-hidden');
    document.getElementById('flow-hud')?.classList.add('menu-hidden');
    document.getElementById('radar')!.classList.add('hidden');
    game._updateSeriesHUD();
    hideStreakDisplay();
  });
}
