// ── Round Result Flow ────────────────────────────────────
// Extracted from roundFlow.ts — gameover / result waterfall
// sequence: triggerOnlineGameover, showResultScreenWaterfall,
// applyPrebuiltResultScreen. Pure extraction, state passed via host.

import { Player } from '../player';
import { stopProximitySpark, playDefeat, playVictory } from '../sfx';
import { stopVehicleEngine } from '../vehicleAudioEngine';
import { playGameOver, playWinScreen } from '../sfxAssets';
import { hideStreakDisplay, hideStreakEndInfo, updateStreakEndInfo } from '../ui/streakUI';
import { formatTime } from '../utils';
import { saveReplay } from '../replayStore';
import { getStreakForMode } from '../streak';
import type { ReplaySnapshot, MatchInfo } from '../types/index';
import type { IRoundFlowHost } from './roundFlow';
import { playFlowReveal, resetFlowReveal } from '../ui/flowReveal';
import { renderXpBar, cleanupXpBar } from '../ui/xpReveal';
import { getProgressionState, onMatchComplete, trackChallengeEvent } from '../progression/progressionManager';
import { getXpForLevel } from '../progression/xpConfig';
import { getAuth } from 'firebase/auth';
import { storeLocalFlow, getLocalFlow, submitFlowReports } from '../flow/flowSubmit';
import { bridgeEndRound } from '../flow/flowBridge';
import { updateAccountFlowDisplay } from '../ui/accountFlowDisplay';
import * as THREE from 'three';

/** Minimum round duration (seconds) for draws to award XP. Prevents AFK farming. */
const MIN_DRAW_DURATION_SEC = 15;

// ── Helpers for showResultScreenWaterfall ─────────────────

/** Frame 1 of the waterfall — overlay, text, and audio. */
function waterfallFrame1(host: IRoundFlowHost, roundResult: string): void {
  const textEl = document.getElementById('result-text')!;
  if (window.showScreen) window.showScreen('gameover');
  else document.getElementById('result')!.classList.remove('hidden');

  if (roundResult === 'draw') {
    textEl.textContent = 'DRAW'; textEl.style.color = 'rgba(var(--c-white), 0.53)';
  } else if (roundResult === 'ai') {
    textEl.textContent = 'FRIED'; textEl.style.color = 'rgb(var(--c-orange-deep))';
    playDefeat();
    if (host.seriesOver) playGameOver();
  } else {
    textEl.textContent = 'VICTORY'; textEl.style.color = 'rgb(var(--c-teal))';
    playVictory();
    if (host.seriesOver) playWinScreen();
  }

  host._applyResultButtonVisibility();
  document.getElementById('result-duration')!.textContent = formatTime(host.matchTime);
}

/** Frame 2 of the waterfall — series dots, streak, radar, stats. */
function waterfallFrame2(host: IRoundFlowHost, roundResult: string, playerWonSeries: boolean, anyAiWonSeries: boolean): void {
  // Guarded — this runs from a deferred RAF/timeout, so the DOM node may be
  // gone if the test suite (or a screen switch) tore it down between the
  // round ending and this callback firing.
  const streakEndedEl = document.getElementById('result-streak-ended');
  if (streakEndedEl) {
    if (roundResult === 'ai') {
      const lastEnd = host._lastStreakEnd;
      if (lastEnd && lastEnd.streak >= 1) {
        streakEndedEl.textContent = 'STREAK OVER';
        streakEndedEl.classList.remove('hidden');
        streakEndedEl.classList.remove('streak-explode');
        void streakEndedEl.offsetWidth;
        streakEndedEl.classList.add('streak-explode');
      } else {
        streakEndedEl.classList.add('hidden');
      }
    } else {
      streakEndedEl.classList.add('hidden');
    }
  }

  // Also guarded — deferred callback, DOM may be gone.
  const continueBtn = document.getElementById('btn-continue');
  const seriesResultEl = document.getElementById('series-result');
  if (continueBtn && seriesResultEl) {
    if (host.seriesLength > 1) {
      continueBtn.textContent = (playerWonSeries || anyAiWonSeries) ? 'NEW SERIES' : 'NEXT ROUND';
      let html: string = host._buildSeriesDotsHTML();
      if (playerWonSeries) html += '<div class="series-label series-label--won">SERIES WON</div>';
      else if (anyAiWonSeries) html += '<div class="series-label series-label--lost">SERIES LOST</div>';
      seriesResultEl.innerHTML = html;
      seriesResultEl.className = '';
      seriesResultEl.classList.remove('hidden');
    } else {
      seriesResultEl.classList.add('hidden');
      continueBtn.textContent = roundResult === 'player' ? 'CONTINUE' : 'RESTART';
    }
  }

  host._updateSeriesHUD();
  host._updateStreak();
  if (host._resultRadarCtx) host._drawRadar(host._resultRadarCtx, 180);

  const resultStreak = document.getElementById('result-streak');
  if (resultStreak) {
    const streakKey = host._getStreakKey();
    const currentStreak = getStreakForMode(host.streakData, streakKey);
    if (currentStreak >= 1 && roundResult === 'player') {
      resultStreak.classList.remove('hidden');
      const numEl = resultStreak.querySelector('.streak-num');
      if (numEl) numEl.textContent = String(currentStreak);
    } else {
      resultStreak.classList.add('hidden');
    }
  }

  fetchAndApplyStreakEndInfo(host);

  localStorage.setItem('luminal-stats', JSON.stringify(host.stats));

  host._selectedMatchIndex = Math.max(0, host._seriesReplayIds.length - 1);
  const matchSel = document.getElementById('result-match-selector');
  if (matchSel) {
    if (host.seriesLength > 1 && host._seriesReplayIds.length > 1) {
      matchSel.classList.remove('hidden');
      document.getElementById('match-sel-label')!.textContent = `MATCH ${host._selectedMatchIndex + 1}`;
    } else {
      matchSel.classList.add('hidden');
    }
  }
}

/** Async fetch of streak-end rank info. Shared between waterfall and prebuilt. */
function fetchAndApplyStreakEndInfo(host: IRoundFlowHost): void {
  const lastEnd = host._lastStreakEnd;
  if (lastEnd && lastEnd.streak >= 1) {
    import('../leaderboard').then(({ getPlayerRank }) => {
      import('../firebase').then(({ auth }) => {
        const user = auth.currentUser;
        if (!user || user.isAnonymous) {
          updateStreakEndInfo(lastEnd.wasRecord, lastEnd.distanceToBest, 0, 0);
          return;
        }
        getPlayerRank(user.uid, host.seriesLength)
          .then(rank => updateStreakEndInfo(lastEnd.wasRecord, lastEnd.distanceToBest, rank, 0))
          .catch(() => updateStreakEndInfo(lastEnd.wasRecord, lastEnd.distanceToBest, 0, 0));
      });
    });
  } else {
    hideStreakEndInfo();
  }
}

/** Fallback for no-killcam paths: spread work across 3 frames. */
export function showResultScreenWaterfall(host: IRoundFlowHost, roundResult: string, playerWonSeries: boolean, anyAiWonSeries: boolean): void {
  // ── Frame 1: Show overlay + text + audio ──
  waterfallFrame1(host, roundResult);

  // ── FLOW reveal (SPEC-91): plays between text and stats ──
  const flowResult = host._lastFlowRoundResult;
  if (flowResult) {
    playFlowReveal(flowResult).catch(() => {
      resetFlowReveal();
      cleanupXpBar();
    });
  }

  // ── FLOW persistence (SPEC-92): bank awarded FLOW ──
  if (flowResult && flowResult.awarded > 0 && host.mode !== 'online') {
    storeLocalFlow(flowResult.awarded);
    const local = getLocalFlow();
    updateAccountFlowDisplay(local.banked, local.lifetime);
  }

  // ── XP reveal (TASK-306): plays after FLOW reveal ──
  {
    const auth = getAuth();
    const isAnon = !auth.currentUser || auth.currentUser.isAnonymous;
    const drawTooShort = roundResult === 'draw' && host.matchTime < MIN_DRAW_DURATION_SEC;
    const streakKey = host._getStreakKey();
    const matchStreak = getStreakForMode(host.streakData, streakKey);
    const xpResult = (!isAnon && !drawTooShort) ? onMatchComplete({
      won: roundResult === 'player',
      matchStreak,
      seriesLength: host.seriesLength,
    }) : null;

    const progState = getProgressionState();
    const currentLevelXp = progState ? getXpForLevel(progState.level) : 0;
    const nextLevelXp = progState ? getXpForLevel(progState.level + 1) : 100;
    const currentXp = progState ? progState.totalXp - currentLevelXp : 0;
    const xpRange = nextLevelXp - currentLevelXp;
    renderXpBar(xpResult, isAnon, currentXp, xpRange > 0 ? xpRange : 100);

    // Track challenge events
    if (!isAnon && !drawTooShort) {
      trackChallengeEvent('match_complete');
      if (roundResult === 'player') trackChallengeEvent('match_win');
    }
  }

  // ── Frame 2: Series dots, streak, radar, stats ──
  requestAnimationFrame(() => {
    waterfallFrame2(host, roundResult, playerWonSeries, anyAiWonSeries);

    // ── Frame 3: Background replay ──
    requestAnimationFrame(() => {
      host.startBgReplay();
    });
  });
}

// ── Helpers for applyPrebuiltResultScreen ─────────────────

/** Apply result text, audio, and streak-ended CSS animation. */
function applyPrebuiltHeader(host: IRoundFlowHost): void {
  const s = host._prebuiltResultState!;
  const textEl = document.getElementById('result-text')!;
  if (window.showScreen) window.showScreen('gameover');
  else document.getElementById('result')!.classList.remove('hidden');

  // Batch DOM writes — no reads between writes to avoid layout thrashing
  textEl.textContent = s.resultText;
  textEl.style.color = s.resultColor;

  // Audio
  if (s.audioCall === 'defeat') { playDefeat(); }
  else if (s.audioCall === 'victory') { playVictory(); }
  if (s.playGameOver) playGameOver();
  if (s.playWinScreen) playWinScreen();

  // Streak ended animation
  const streakEndedEl = document.getElementById('result-streak-ended')!;
  if (s.showStreakEnded) {
    streakEndedEl.textContent = 'STREAK OVER';
    streakEndedEl.classList.remove('hidden');
    streakEndedEl.classList.remove('streak-explode');
    void streakEndedEl.offsetWidth; // reflow to restart CSS animation
    streakEndedEl.classList.add('streak-explode');
  } else {
    streakEndedEl.classList.add('hidden');
  }
}

/** Apply body: series dots, radar, streak, stats, match selector. */
function applyPrebuiltBody(host: IRoundFlowHost): void {
  const s = host._prebuiltResultState!;

  // Series dots
  const continueBtn = document.getElementById('btn-continue')!;
  const seriesResultEl = document.getElementById('series-result')!;
  if (s.seriesHTML !== null) {
    continueBtn.textContent = s.continueText;
    seriesResultEl.innerHTML = s.seriesHTML + s.seriesLabelHTML;
    seriesResultEl.className = '';
    seriesResultEl.classList.remove('hidden');
  } else {
    seriesResultEl.classList.add('hidden');
    continueBtn.textContent = s.continueText;
  }

  host._updateSeriesHUD();
  host._updateStreak();

  // Skip radar if already pre-rendered (safety net if not)
  if (!host._radarPreRendered && host._resultRadarCtx) {
    host._drawRadar(host._resultRadarCtx, 180);
  }

  document.getElementById('result-duration')!.textContent = s.durationText;

  // Current streak display
  const resultStreak = document.getElementById('result-streak')!;
  if (s.showStreak) {
    resultStreak.classList.remove('hidden');
    resultStreak.querySelector('.streak-num')!.textContent = s.streakNum;
  } else {
    resultStreak.classList.add('hidden');
  }

  // Streak-end info (rank fetch is async, fine to fire here)
  fetchAndApplyStreakEndInfo(host);

  localStorage.setItem('luminal-stats', s.statsJSON);
  host._applyResultButtonVisibility();

  host._selectedMatchIndex = Math.max(0, host._seriesReplayIds.length - 1);
  const matchSel = document.getElementById('result-match-selector');
  if (matchSel) {
    if (s.matchSelectorVisible) {
      matchSel.classList.remove('hidden');
      document.getElementById('match-sel-label')!.textContent = s.matchSelectorLabel;
    } else {
      matchSel.classList.add('hidden');
    }
  }

}

/** Apply pre-built result state — near-zero frame cost. */
export function applyPrebuiltResultScreen(host: IRoundFlowHost): void {
  applyPrebuiltHeader(host);
  applyPrebuiltBody(host);
  host._prebuiltResultState = null;
}

// ── Helpers for triggerOnlineGameover ─────────────────────

type RoundResult = 'draw' | 'player' | 'ai';

function resolveRoundResult(host: IRoundFlowHost, iWon: boolean, isDraw: boolean): RoundResult {
  if (isDraw) return 'draw';
  if (iWon) {
    host._victoryFireworks = true;
    return 'player';
  }
  return 'ai';
}

/** Save replay for the "already in gameover" branch (1000 ms delay). */
function saveReplayEarly(host: IRoundFlowHost, roundResult: string, iWon: boolean, isDraw: boolean, winnerUid?: string): void {
  if (!host._replayRecorder.hasData()) return;
  const recorder = host._replayRecorder;
  const opponentName: string = host._onlineMatch
    ? host._onlineMatch.opponents.map(o => o.name).join(', ') : 'OPPONENT';
  const winnerName: string = isDraw ? 'DRAW' : iWon ? 'YOU'
    : (winnerUid && host._onlineMatch?.opponents.find(o => o.uid === winnerUid)?.name) || opponentName;
  const matchTime: number = host.matchTime;
  const onEnd = host.onMatchEnd;
  // TASK-292: capture series state at save time so every round of a BO
  // series links back via a stable seriesId.
  const seriesLen: number = host.seriesLength;
  const spw: number = host.seriesPlayerWins;
  const saw: number[] = [...host.seriesAiWins];
  const sid: string | null = host.currentSeriesId;
  setTimeout(() => {
    const snapshot: ReplaySnapshot = recorder.getSnapshot();
    host._lastReplaySnapshot = snapshot;
    saveReplay(snapshot, {
      result: roundResult as MatchInfo['result'],
      matchType: 'casual', winnerName, opponentName,
      seriesInfo: seriesLen > 1
        ? { length: seriesLen, playerWins: spw, aiWins: saw, roundIndex: 0, seriesId: sid }
        : null,
    }).then((id: string) => {
      host._lastSavedReplayId = id;
      host._seriesReplayIds.push(id);
      host._refreshMatchSelector();
      if (onEnd) onEnd(roundResult, matchTime, 1, 1, id);
    });
  }, 1000);
}

/** Save replay for the primary gameover branch (2500 ms delay + idle callback). */
function saveReplayDeferred(host: IRoundFlowHost, roundResult: string, iWon: boolean, isDraw: boolean, winnerUid?: string): void {
  if (host._replayRecorder.hasData()) {
    const recorder = host._replayRecorder;
    const opponentName: string = host._onlineMatch!.opponents.map(o => o.name).join(', ');
    const winnerName: string = isDraw ? 'DRAW' : iWon ? 'YOU'
      : (winnerUid && host._onlineMatch!.opponents.find(o => o.uid === winnerUid)?.name) || opponentName;
    const matchTime: number = host.matchTime;
    const onEnd = host.onMatchEnd;
    // TASK-292: capture series state at save time so every round of a BO
    // series links back via a stable seriesId.
    const seriesLen: number = host.seriesLength;
    const spw: number = host.seriesPlayerWins;
    const saw: number[] = [...host.seriesAiWins];
    const sid: string | null = host.currentSeriesId;
    setTimeout(() => {
      const doSave = (): void => {
        const snapshot: ReplaySnapshot = recorder.getSnapshot();
        host._lastReplaySnapshot = snapshot;
        saveReplay(snapshot, {
          result: roundResult as MatchInfo['result'],
          matchType: 'casual',
          winnerName,
          opponentName,
          seriesInfo: seriesLen > 1
            ? { length: seriesLen, playerWins: spw, aiWins: saw, roundIndex: 0, seriesId: sid }
            : null,
        }).then((id: string) => {
          host._lastSavedReplayId = id;
          host._seriesReplayIds.push(id);
          host._refreshMatchSelector();
          if (onEnd) onEnd(roundResult, matchTime, 1, 1, id);
        });
      };
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(doSave, { timeout: 2000 });
      } else {
        doSave();
      }
    }, 2500);
  } else if (host.onMatchEnd) {
    host.onMatchEnd(roundResult, host.matchTime, 1, 1, null);
  }
}

/** Handle the "already in gameover" branch — killcam is orbiting when server result arrives. */
function handlePendingOnlineResult(host: IRoundFlowHost, iWon: boolean, isDraw: boolean, winnerUid?: string): void {
  host._pendingOnlineResult = { iWon, isDraw, winnerUid };
  // Set killcam data so the orbiting killcam can transition to results
  const roundResult: string = resolveRoundResult(host, iWon, isDraw);
  const wn: number = Math.ceil(host.seriesLength / 2);
  const pws: boolean = host.seriesPlayerWins >= wn;
  const aws: boolean = host.seriesAiWins.some(w => w >= wn);
  host.seriesOver = host.seriesLength <= 1 || pws || aws;
  host._killcamData = { roundResult, playerWonSeries: pws, anyAiWonSeries: aws };
  // Save replay
  saveReplayEarly(host, roundResult, iWon, isDraw, winnerUid);
  // If killcam is not orbiting and spectating is done, show results directly
  // (no orbit timer will call _showResultScreen, so we must trigger it here)
  if (!host._killcamActive && !host._spectating) {
    host._showResultScreen();
  }
}

/** Set up killcam camera focus on the dying player (or draw fallback). */
function activateOnlineKillcam(host: IRoundFlowHost, iWon: boolean): void {
  if (!host._killcamPos) host._killcamPos = new THREE.Vector3();
  if (!host._killcamStartCamPos) host._killcamStartCamPos = new THREE.Vector3();
  // Focus on the player who died (loser's position, or center on draw)
  let deathTarget: Player | null = null;
  if (!iWon && host.player) {
    deathTarget = host.player; // I lost — focus on my corpse
  } else if (iWon) {
    // N-player: find the last dead remote human (most dramatic); fall back to this.opponent
    const deadRemote = host.ais.filter(a => a.uid && !a.aiState && !a.player.alive);
    deathTarget = deadRemote.length > 0 ? deadRemote[deadRemote.length - 1].player
                : host.opponent;
  }
  if (deathTarget) {
    const p = deathTarget.mesh.position;
    host._killcamPos.set(p.x, 0.7, p.z);
  } else {
    // Fallback: orbit around the player's current position rather than arena center
    // (avoids camera zooming to empty origin when no death target is found)
    const fallback = host.player?.mesh?.position || host.camera.position;
    host._killcamPos.set(fallback.x, 0.7, fallback.z);
  }
  host._killcamActive = true;
  host._killcamTimer = 0;
  host._killcamDelayTimer = 0;
  host._killcamPhase = 'slowmo';
  host._killcamStartCamPos.copy(host.camera.position);
}

export function triggerOnlineGameover(host: IRoundFlowHost, iWon: boolean, isDraw: boolean, winnerUid?: string): void {
  // If already in gameover (killcam started on death, waiting for server confirmation)
  if (host.state === 'gameover') {
    handlePendingOnlineResult(host, iWon, isDraw, winnerUid);
    submitOnlineFlow(host);
    return;
  }
  host.state = 'gameover';
  setTimeout(stopProximitySpark, 0);
  host._clearEnemySlipstreamVFX();
  host._clearSlipstreamOverlay();
  setTimeout(stopVehicleEngine, 0);

  // FLOW: end round for online win/draw (player death already handled in gameCollisions)
  const flowOutcome = iWon ? 'won' as const : 'died' as const;
  host._lastFlowRoundResult = bridgeEndRound(host._flowState, flowOutcome);

  // Activate killcam — same orbit camera as local mode
  activateOnlineKillcam(host, iWon);

  // Determine result
  const roundResult: string = resolveRoundResult(host, iWon, isDraw);

  // Defer replay save past the death animation
  saveReplayDeferred(host, roundResult, iWon, isDraw, winnerUid);

  // Store result for killcam → result screen flow (same as local mode)
  // Killcam timer will call _showResultScreen when orbit finishes
  const winsNeeded: number = Math.ceil(host.seriesLength / 2);
  const playerWonSeries: boolean = host.seriesPlayerWins >= winsNeeded;
  const anyAiWonSeries: boolean = host.seriesAiWins.some(w => w >= winsNeeded);
  host.seriesOver = host.seriesLength <= 1 || playerWonSeries || anyAiWonSeries;

  host._killcamData = { roundResult, playerWonSeries, anyAiWonSeries };
  submitOnlineFlow(host);
  requestAnimationFrame(() => {
    document.getElementById('meter-wrap')!.classList.add('menu-hidden');
    document.getElementById('radar')!.classList.add('hidden');
    host._updateSeriesHUD();
    hideStreakDisplay();
  });
}

// ── FLOW online submission helper ─────────────────────────

function submitOnlineFlow(host: IRoundFlowHost): void {
  const flowResult = host._lastFlowRoundResult;
  if (!flowResult || !host._onlineMatch) return;
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  submitFlowReports(host._onlineMatch.matchId, uid, [flowResult]).catch(() => {});
}
