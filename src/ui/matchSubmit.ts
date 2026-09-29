import { getCurrentUid, getIsRealUser, getCurrentUsername, getCurrentIcon } from './authUI';
import { getPlayerColorKey } from './onlineUI';
import { getPlayerColor } from '../playerColors';
import { getSelectedMap } from './mapSelectUI';
import { getAutoSubmitEnabled } from './settingsUI';
import { uploadReplay } from '../cloudReplay';
import type { MatchMetadata } from '../cloudReplay';
import { compressFrames } from '../replayStore';
import { submitMatch, getRankForMetric } from '../leaderboard';
import { vibrate, VIBE } from '../vibrate';
import { showSlideHint, hideSlideHint, hideTouchControls } from '../touch';
import { TOUCH_ENABLED } from '../input';
import { ico } from './dom';
import { warnDev } from '../swallow';
import type { Game } from '../game';

interface MatchSubmitDeps {
  game: Game;
  showServerActivity: (label: string) => void;
  hideServerActivity: () => void;
}

let _pendingMatch: { result: string; matchTime: number; seriesLength: number; opponentCount: number; replayId: string | null; matchType: 'ai' | 'casual' } | null = null;
let _lastSubmittedReplayId: string | null = null;
let _showServerActivity: (label: string) => void = () => { /* noop until init */ };
let _hideServerActivity: () => void = () => { /* noop until init */ };

export function initMatchSubmit(deps: MatchSubmitDeps): void {
  const { game, showServerActivity, hideServerActivity } = deps;
  _showServerActivity = showServerActivity;
  _hideServerActivity = hideServerActivity;

  game.onCountdownTick = (num: number): void => {
    vibrate(VIBE.countdown);
    if (num === 3 && TOUCH_ENABLED) showSlideHint();
    if (num === 0 && TOUCH_ENABLED) hideSlideHint();
  };

  game.onMatchEnd = (result: string, matchTime: number, seriesLength: number, opponentCount: number, replayId: string | null): void => {
    hideTouchControls();
    // Dedup: don't re-process the same match
    if (replayId && replayId === _lastSubmittedReplayId) return;
    const isOnline: boolean = !!game._onlineMatch;
    const matchType: 'ai' | 'casual' = isOnline ? 'casual' : 'ai';
    _pendingMatch = { result, matchTime, seriesLength, opponentCount, replayId, matchType };

    // Fire-and-forget cloud replay upload for authenticated real users
    if (getCurrentUid() && getIsRealUser() && game._lastReplaySnapshot) {
      const uid = getCurrentUid()!;
      const snapshot = game._lastReplaySnapshot;
      const onlineMatch = game._onlineMatch;
      const playerVehicle = (localStorage.getItem('luminal-vehicle') || 'bike') as string;
      const winnerUid: string = result === 'player' ? uid
        : result === 'ai' && onlineMatch ? onlineMatch.opponentUid
        : '';
      const players: MatchMetadata['players'] = [
        { uid, username: getCurrentUsername() || '', color: snapshot.playerColor, vehicle: playerVehicle },
      ];
      if (onlineMatch) {
        players.push({
          uid: onlineMatch.opponentUid,
          username: onlineMatch.opponentName,
          color: snapshot.aiColors[0]?.color ?? 0,
          vehicle: (snapshot.aiVehicles?.[0] ?? 'bike') as string,
        });
      }
      const participantUids: string[] = onlineMatch
        ? [uid, onlineMatch.opponentUid]
        : [uid];
      const seriesScore = {
        p1: game.seriesPlayerWins,
        p2: game.seriesAiWins[0] ?? 0,
      };
      const matchMeta: MatchMetadata = {
        players,
        result,
        winnerUid,
        series: seriesLength,
        matchType,
        duration: matchTime,
        map: getSelectedMap(),
        seriesScore,
        participantUids,
      };
      const cloudMatchId = `${uid}_${Date.now().toString(36)}`;
      const compressedFrames = compressFrames(snapshot.frames);
      uploadReplay(cloudMatchId, compressedFrames, matchMeta).catch((e: unknown) => {
        console.warn('Cloud replay upload failed:', e);
      });
    }

    // Enable fav button only when a replay was actually saved
    const favResultBtn = document.getElementById('btn-replay-fav-result')!;
    if (replayId) favResultBtn.classList.remove('quickstart-toggle--disabled');
    favResultBtn.innerHTML = ico('star');

    const canSubmit: boolean = !!(getCurrentUid() && getIsRealUser() && getCurrentUsername());
    const localBtn: HTMLElement = document.getElementById('btn-submit-match')!;
    const onlineBtn: HTMLElement = document.getElementById('btn-submit-match-online')!;

    if (isOnline) {
      // Online: server Cloud Function handles leaderboard — skip client submit
      localBtn.style.display = 'none';
      onlineBtn.style.display = 'none';
    } else if (canSubmit && getAutoSubmitEnabled()) {
      // Auto-submit for local/AI matches when auto-submit is enabled
      localBtn.style.display = 'none';
      onlineBtn.style.display = 'none';
      _submitPendingMatch(localBtn, true);
    } else if (canSubmit) {
      // Manual: show the button
      localBtn.style.display = '';
      onlineBtn.style.display = 'none';
    } else {
      localBtn.style.display = 'none';
      onlineBtn.style.display = 'none';
    }
  };

  // Wire submit button click handlers
  document.getElementById('btn-submit-match')!.addEventListener('click', () => {
    _submitPendingMatch(document.getElementById('btn-submit-match')!);
  });
  document.getElementById('btn-submit-match-online')!.addEventListener('click', () => {
    _submitPendingMatch(document.getElementById('btn-submit-match-online')!);
  });
}

export function resetSubmitButtons(): void {
  _pendingMatch = null;
  for (const id of ['btn-submit-match', 'btn-submit-match-online']) {
    const btn: HTMLElement = document.getElementById(id)!;
    btn.innerHTML = `<i class="btn-icon">${ico('arrow-up')}</i>SUBMIT TO LEADERBOARD`;
    btn.classList.remove('menu-btn--disabled');
    btn.style.pointerEvents = '';
    btn.style.display = 'none';
  }
}

async function _submitPendingMatch(btn: HTMLElement, silent: boolean = false): Promise<void> {
  if (!_pendingMatch || !getCurrentUid() || !getIsRealUser() || !getCurrentUsername()) return;
  const m = _pendingMatch;
  // Dedup guard
  if (m.replayId && m.replayId === _lastSubmittedReplayId) return;

  if (!silent) {
    btn.textContent = 'SUBMITTING...';
    btn.style.pointerEvents = 'none';
  }
  _showServerActivity('SUBMITTING');
  try {
    await submitMatch(getCurrentUid()!, getCurrentUsername()!, getPlayerColor(getPlayerColorKey()).color, m.result, m.matchTime, m.seriesLength, m.matchType, m.replayId ?? undefined, getCurrentIcon() || undefined);
    if (m.replayId) _lastSubmittedReplayId = m.replayId;
    _pendingMatch = null;

    // Fetch rank
    let rankText: string = '';
    try {
      const rank: number | null = await getRankForMetric(getCurrentUid()!, m.seriesLength, m.matchType, 'wins');
      if (rank) rankText = ` — RANK #${rank}`;
    } catch (e) { warnDev('matchSubmit', e); }

    if (silent) {
      // Auto-submit: don't show the button
    } else {
      btn.innerHTML = `<i class="btn-icon">${ico('check')}</i>SUBMITTED${rankText}`;
      btn.classList.add('menu-btn--disabled');
    }
  } catch (e) {
    console.error('Leaderboard submit error:', e);
    if (!silent) {
      btn.innerHTML = `<i class="btn-icon">${ico('arrow-up')}</i>RETRY`;
      btn.style.pointerEvents = '';
    }
  }
  _hideServerActivity();
}
