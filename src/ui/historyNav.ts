// ── History / Popstate Navigation ───────────────────────────────────────────
// Wires the browser back button (popstate) to in-game pause / menu navigation.

import { playMatchPause } from '../sfxAssets';
import { hideTouchControls } from '../touch';
import { updateControlUI } from './inputUI';
import {
  navigateBack, navigateReset,
  getCurrentScreen, setCurrentScreen,
  setFocusIndex, updateFocus,
  getPendingHistoryBack, decrementPendingHistoryBack,
  getNavStack,
} from './navigation';
import { showTopBar } from './topbar';
import { _restoreChatAfterMatch } from './chatUI';
import { getCurrentOnlineMatch } from './onlineUI';

interface HistoryNavDeps {
  game: {
    state: string;
    mode: string;
    pause(): void;
    resume(): void;
    returnToMenu(): void;
    _lobbyOrigin: { lobbyId: string; role: string } | null;
  };
  ensureAudio(): void;
  restoreBgMode(): void;
  touchEnabled: boolean;
}

export function initHistoryNav(deps: HistoryNavDeps): void {
  const { game, ensureAudio, restoreBgMode } = deps;

  window.addEventListener('popstate', () => {
    if (getPendingHistoryBack() > 0) { decrementPendingHistoryBack(); return; }

    const currentScreen = getCurrentScreen();

    // ── In-game: first back → pause, second back → exit to home ──
    if ((game.state === 'playing' || game.state === 'countdown') && !currentScreen && game.mode !== 'online') {
      game.pause();
      playMatchPause();
      showTopBar();
      hideTouchControls();
      document.getElementById('btn-pause-lobby')!.style.display = game._lobbyOrigin ? '' : 'none';
      setCurrentScreen('paused');
      setFocusIndex(0);
      updateFocus();
      updateControlUI();
      return;
    }
    if (game.state === 'paused' && currentScreen === 'paused') {
      ensureAudio(); game.returnToMenu(); restoreBgMode();
      navigateReset('main'); updateControlUI(); _restoreChatAfterMatch(); hideTouchControls();
      return;
    }
    // Online in-game: first back → online pause overlay, second → forfeit/close
    if ((game.state === 'playing' || game.state === 'countdown') && !currentScreen && game.mode === 'online') {
      document.getElementById('online-pause-overlay')!.classList.remove('hidden');
      const onlineMatch = getCurrentOnlineMatch();
      document.getElementById('btn-return-lobby-pause')!.style.display =
        (onlineMatch?.lobbyId && onlineMatch.lobbyRole === 'host') ? '' : 'none';
      setCurrentScreen('onlinePause');
      setFocusIndex(0);
      updateFocus();
      return;
    }
    if (currentScreen === 'onlinePause') {
      document.getElementById('online-pause-overlay')!.classList.add('hidden');
      setCurrentScreen(null);
      return;
    }
    // Replay: exit
    if (game.state === 'replay' && currentScreen === 'replay') {
      document.getElementById('btn-replay-exit-top')!.click();
      return;
    }
    // Gameover: blocked for online, exit for offline
    if (currentScreen === 'gameover') {
      if (game.mode !== 'online') document.getElementById('btn-mainmenu')!.click();
      return;
    }
    // Queue: cancel
    if (currentScreen === 'queue') {
      document.getElementById('btn-queue-cancel')!.click();
      return;
    }

    // ── On main screen with nothing to go back to → let browser handle it ──
    if (currentScreen === 'main' && getNavStack().length === 0) return;

    // ── Normal menu back ──
    if (getNavStack().length > 0) navigateBack();
  });
}
