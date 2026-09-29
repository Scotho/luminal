// ── Menu Button Handlers ─────────────────────────────────────────────────────
// Wires all top-level menu / pause / gameover / replay button click events.

import { togglePause, toggleMute, skipTrack, prevTrack, toggleRepeat, toggleShuffle, getShuffleMode, onPauseChange } from '../audio';
import { TOUCH_ENABLED } from '../input';
import { showTouchControls, hideTouchControls } from '../touch';
import { getReplayList, loadReplay } from '../replayStore';
import { submitManualReport } from '../bugReporter';
import { ico } from './dom';
import { _renderDefaultPlaylist, _renderMusicPlaylist } from './musicUI';
import { resetSubmitButtons } from './matchSubmit';
import { forfeitOnlineMatch } from './onlineUI';
import { unreadyInParty, rejoinLobbyAfterMatch } from './lobby/lobbyUI';
import { setReplaySourceScreen, resetReplayUI } from './replayUI';
import {
  navigateTo, navigateReset, getCurrentScreen, setCurrentScreen,
  hideDynBack, clearNavStack,
} from './navigation';
import { updateControlUI } from './inputUI';
import { hideTopBar } from './topbar';
import { _restoreChatAfterMatch, _hideChatForMatch } from './chatUI';
import type { ReplaySnapshot, LoadedReplayEntry } from '../types/index';
import { playUiToggle } from '../sfx';
import { hideResultMapPanel } from './resultMapSelect';
import { skipXpAnimation, cleanupXpBar } from './xpReveal';

interface ButtonHandlersDeps {
  game: {
    state: string;
    mode: string;
    canRestart(): boolean;
    start(): void;
    startSeries(): void;
    startReplay(): void;
    startReplayFromSnapshot(snapshot: ReplaySnapshot): Promise<void>;
    resume(): void;
    returnToMenu(): void;
    seriesOver: boolean;
    _lobbyOrigin: { lobbyId: string; role: 'host' | 'guest' } | null;
    _selectedMatchIndex: number;
    _seriesReplayIds: string[];
    _lastSavedReplayId: string | null;
  };
  ensureAudio(): void;
  restoreBgMode(): void;
  closeAllPopups(): void;
}

export function initButtonHandlers(deps: ButtonHandlersDeps): void {
  wireMainMenuButtons(deps);
  wireStartContinueButtons(deps);
  wirePauseButtons(deps);
  wireOnlinePauseButtons();
  wireGameoverReplayButtons(deps);
  wireTopbarMusicControls(deps);
  wireFullscreenToggle();
  wireBugReportForm();
  wireSongSkipKeys(deps);
}

// ── Main menu navigation buttons ─────────────────────────
function wireMainMenuButtons(_deps: ButtonHandlersDeps): void {
  document.getElementById('btn-music')!.addEventListener('click', () => navigateTo('music'));
  document.getElementById('btn-settings')!.addEventListener('click', () => navigateTo('settings'));
  document.getElementById('btn-social')?.addEventListener('click', () => navigateTo('social'));
  document.getElementById('btn-leaderboard')?.addEventListener('click', () => {
    navigateTo('stats');
    // Activate the leaderboard tab directly
    const lbTab = document.querySelector('.stats-header-tab[data-view="leaderboard"]') as HTMLElement | null;
    lbTab?.click();
  });
  document.getElementById('btn-online')!.addEventListener('click', () => {
    navigateTo('online');
  });
  document.getElementById('btn-character-select')!.addEventListener('click', () => {
    navigateTo('characterSelect');
  });
}

// ── Game start / continue / main menu ────────────────────
function wireStartContinueButtons(deps: ButtonHandlersDeps): void {
  const { game, ensureAudio, restoreBgMode, closeAllPopups } = deps;

  document.getElementById('btn-quickstart')!.addEventListener('click', () => {
    ensureAudio(); unreadyInParty(); clearNavStack(); hideDynBack(); game.startSeries(); setCurrentScreen(null); updateControlUI();
    closeAllPopups(); _hideChatForMatch(); if (TOUCH_ENABLED) showTouchControls();
  });
  document.getElementById('btn-continue')!.addEventListener('click', () => {
    if (!game.canRestart()) return;
    skipXpAnimation();
    cleanupXpBar();
    hideResultMapPanel();
    ensureAudio();
    resetSubmitButtons();
    unreadyInParty();
    if (game.seriesOver) game.startSeries(); else game.start();
    setCurrentScreen(null); updateControlUI(); closeAllPopups(); _hideChatForMatch(); if (TOUCH_ENABLED) showTouchControls();
  });
  document.getElementById('btn-mainmenu')!.addEventListener('click', () => {
    cleanupXpBar();
    hideResultMapPanel();
    ensureAudio(); resetSubmitButtons(); game.returnToMenu(); restoreBgMode();
    navigateReset('main'); updateControlUI(); _restoreChatAfterMatch(); hideTouchControls();
  });

  // Return to lobby from local lobby game (result screen or pause)
  document.getElementById('btn-return-lobby-result')!.addEventListener('click', () => {
    if (game.mode !== 'local' || !game._lobbyOrigin) return; // online handled by onlineUI
    const { lobbyId, role } = game._lobbyOrigin;
    game._lobbyOrigin = null;
    ensureAudio(); game.returnToMenu(); restoreBgMode();
    _restoreChatAfterMatch(); hideTouchControls();
    (async () => {
      const rejoined = await rejoinLobbyAfterMatch(lobbyId, role);
      if (rejoined) {
        navigateReset('lobby');
      } else {
        navigateReset('main');
      }
      updateControlUI();
    })();
  });
}

// ── Pause overlay buttons ─────────────────────────────────
function wirePauseButtons(deps: ButtonHandlersDeps): void {
  const { game, ensureAudio, restoreBgMode } = deps;

  document.getElementById('btn-resume')!.addEventListener('click', () => {
    game.resume(); hideTopBar(); setCurrentScreen(null); updateControlUI(); if (TOUCH_ENABLED) showTouchControls();
  });
  document.getElementById('btn-pause-menu')!.addEventListener('click', () => {
    ensureAudio(); game.returnToMenu(); restoreBgMode();
    navigateReset('main'); updateControlUI(); _restoreChatAfterMatch(); hideTouchControls();
  });
  document.getElementById('btn-pause-lobby')!.addEventListener('click', () => {
    if (!game._lobbyOrigin) return;
    const { lobbyId, role } = game._lobbyOrigin;
    game._lobbyOrigin = null;
    ensureAudio(); game.returnToMenu(); restoreBgMode();
    _restoreChatAfterMatch(); hideTouchControls();
    (async () => {
      const rejoined = await rejoinLobbyAfterMatch(lobbyId, role);
      if (rejoined) {
        navigateReset('lobby');
      } else {
        navigateReset('main');
      }
      updateControlUI();
    })();
  });
  document.getElementById('btn-pause-settings')!.addEventListener('click', () => navigateTo('settings'));
}

// ── Online pause overlay buttons ─────────────────────────
function wireOnlinePauseButtons(): void {
  document.getElementById('btn-online-resume')!.addEventListener('click', () => {
    document.getElementById('online-pause-overlay')!.classList.add('hidden');
    setCurrentScreen(null);
  });
  document.getElementById('btn-online-pause-settings')!.addEventListener('click', () => navigateTo('settings'));
  document.getElementById('btn-online-forfeit')!.addEventListener('click', () => {
    document.getElementById('online-pause-overlay')!.classList.add('hidden');
    setCurrentScreen(null);
    forfeitOnlineMatch();
  });
  // NOTE: btn-return-lobby-pause and btn-return-lobby-result online handlers are in onlineUI.ts
}

// ── Gameover / replay buttons ─────────────────────────────
function wireGameoverReplayButtons(deps: ButtonHandlersDeps): void {
  const { game } = deps;

  document.getElementById('btn-go-settings')!.addEventListener('click', () => navigateTo('settings'));
  document.getElementById('btn-result-loadout')!.addEventListener('click', () => navigateTo('characterSelect'));
  document.getElementById('btn-replay')!.addEventListener('click', async () => {
    if (!game.canRestart()) return;
    setReplaySourceScreen('gameover');
    // If browsing a non-latest match in a series, load that replay by ID
    const isLatest = game._selectedMatchIndex >= game._seriesReplayIds.length - 1;
    if (!isLatest && game._lastSavedReplayId) {
      const entry: LoadedReplayEntry | null = await loadReplay(game._lastSavedReplayId);
      if (entry) {
        const snapshot: ReplaySnapshot = { frames: entry.frames, playerColor: entry.playerColor, playerEmissive: entry.playerEmissive, playerVehicle: entry.playerVehicle || 'bike', aiColors: entry.aiColors, aiVehicles: entry.aiVehicles || [], duration: entry.duration };
        setCurrentScreen('replay');
        resetReplayUI();
        await game.startReplayFromSnapshot(snapshot);
        return;
      }
    }
    game.startReplay();
    setCurrentScreen('replay');
    resetReplayUI();
  });

  // Match selector arrows (series replay browsing)
  document.getElementById('match-sel-left')?.addEventListener('click', () => {
    if (game._seriesReplayIds.length <= 1) return;
    game._selectedMatchIndex = Math.max(0, game._selectedMatchIndex - 1);
    _updateMatchSelector(game);
  });
  document.getElementById('match-sel-right')?.addEventListener('click', () => {
    if (game._seriesReplayIds.length <= 1) return;
    game._selectedMatchIndex = Math.min(game._seriesReplayIds.length - 1, game._selectedMatchIndex + 1);
    _updateMatchSelector(game);
  });
}

function _updateMatchSelector(game: ButtonHandlersDeps['game']): void {
  const label = document.getElementById('match-sel-label');
  if (label) label.textContent = `MATCH ${game._selectedMatchIndex + 1}`;
  const id = game._seriesReplayIds[game._selectedMatchIndex];
  if (id) {
    game._lastSavedReplayId = id;
    // Update fav icon for selected match
    const favBtn = document.getElementById('btn-replay-fav-result')!;
    getReplayList().then(list => {
      const entry = list.find(e => e.id === id);
      favBtn.innerHTML = entry?.favorite ? ico('star', 'icon--fill-stroke') : ico('star');
    });
  }
}

// ── Top-bar music controls ────────────────────────────────
function wireTopbarMusicControls(deps: ButtonHandlersDeps): void {
  const { ensureAudio } = deps;

  document.getElementById('mute-btn')!.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    const muted: boolean = toggleMute();
    (e.target as HTMLElement).classList.toggle('mute-btn--muted', muted);
    (e.target as HTMLElement).innerHTML = muted ? ico('vol-x') : ico('vol');
  });
  document.getElementById('vol-open-settings')!.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    document.getElementById('vol-dropdown-wrap')?.classList.remove('tb-dropdown--pinned', 'tb-dropdown--open');
    document.getElementById('btn-music')?.click();
  });
  document.getElementById('pause-btn')!.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    togglePause();
  });
  // Centralized play/pause visual sync
  onPauseChange((paused: boolean) => {
    const tb: HTMLElement = document.getElementById('pause-btn')!;
    tb.classList.toggle('pause-btn--paused', paused);
    tb.innerHTML = paused ? ico('play') : ico('pause');
    const mo: HTMLElement | null = document.getElementById('music-playpause');
    if (mo) mo.innerHTML = paused ? ico('play') : ico('pause');
    // Re-render playlist items so their play/pause icons match
    const musicOverlay: HTMLElement | null = document.getElementById('music-overlay');
    if (musicOverlay && !musicOverlay.classList.contains('hidden')) {
      _renderDefaultPlaylist();
      _renderMusicPlaylist();
    }
  });
  document.getElementById('prev-btn')!.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); ensureAudio(); prevTrack(); });
  document.getElementById('skip-btn')!.addEventListener('click', (e: MouseEvent) => { e.stopPropagation(); ensureAudio(); skipTrack(); });
  document.getElementById('repeat-btn')!.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    const active: boolean = toggleRepeat();
    document.getElementById('repeat-btn')!.classList.toggle('repeat-btn--active', active);
    document.getElementById('music-repeat-btn')?.classList.toggle('music-ctrl--active', active);
  });
  document.getElementById('shuffle-btn')!.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    const active: boolean = toggleShuffle();
    document.getElementById('shuffle-btn')!.classList.toggle('shuffle-btn--active', active);
    document.getElementById('music-shuffle-btn')?.classList.toggle('music-ctrl--active', active);
  });
  if (getShuffleMode()) document.getElementById('shuffle-btn')!.classList.add('shuffle-btn--active');
}

// ── Fullscreen toggle ─────────────────────────────────────
function wireFullscreenToggle(): void {
  const fsBtn: HTMLElement = document.getElementById('fullscreen-btn')!;
  const fsLabel: HTMLElement = document.getElementById('fs-label')!;
  const fsIcon: HTMLElement | null = document.getElementById('fs-icon');
  const fsUse: SVGUseElement | null = fsIcon?.querySelector('use') as SVGUseElement | null;

  const updateFsBtn = (): void => {
    const isFs: boolean = !!document.fullscreenElement;
    fsLabel.textContent = isFs ? 'EXIT FULLSCREEN' : 'FULLSCREEN';
    if (fsUse) fsUse.setAttribute('href', isFs ? '/icons.svg#i-minimize' : '/icons.svg#i-maximize');
  };

  fsBtn.addEventListener('click', () => {
    playUiToggle();
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  });

  document.addEventListener('fullscreenchange', updateFsBtn);
}

// ── Bug report form ───────────────────────────────────────
function wireBugReportForm(): void {
  document.getElementById('btn-report-bug')!.addEventListener('click', () => {
    if (getCurrentScreen() === 'bugreport') navigateReset(); else navigateTo('bugreport');
  });
  const bugSubmit = document.getElementById('bugreport-submit')!;
  const bugInput = document.getElementById('bugreport-input') as HTMLTextAreaElement;
  const bugStatus = document.getElementById('bugreport-status')!;
  bugSubmit.addEventListener('click', () => {
    const desc = bugInput.value.trim();
    if (!desc) return;
    submitManualReport(desc);
    bugInput.value = '';
    bugStatus.textContent = 'Report submitted — thank you!';
    bugStatus.classList.remove('hidden');
    setTimeout(() => bugStatus.classList.add('hidden'), 3000);
  });
}

// ── Song skip keys ( < / > ) ──────────────────────────────
function wireSongSkipKeys(deps: ButtonHandlersDeps): void {
  const { ensureAudio } = deps;
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((document.activeElement as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Comma') { ensureAudio(); prevTrack(); }
    if (e.code === 'Period') { ensureAudio(); skipTrack(); }
  });
}
