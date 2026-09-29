import { TOUCH_ENABLED } from '../input';
import { getCurrentScreen, setCurrentScreen, navigateBackFromUI, setFocusIndex, updateFocus } from './navigation';
import { getCurrentOnlineMatch } from './onlineUI';
import { updateControlUI } from './inputUI';
import { showTopBar, hideTopBar } from './topbar';
import { showTouchControls, hideTouchControls } from '../touch';
import { playTick } from '../sfx';
import { playMatchPause } from '../sfxAssets';

interface EscapeHandlerDeps {
  game: {
    state: string;
    mode: string;
    pause: () => void;
    resume: () => void;
  };
  ensureAudio: () => void;
}

export function initEscapeHandler(deps: EscapeHandlerDeps): void {
  const { game } = deps;

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Escape' || e.key === 'Escape') {
      const currentScreen = getCurrentScreen();
      if ((game.state === 'playing' || game.state === 'countdown') && game.mode !== 'online') {
        game.pause();
        playMatchPause();
        showTopBar();
        hideTouchControls();
        setCurrentScreen('paused');
        setFocusIndex(0);
        updateFocus();
        updateControlUI();
      } else if (game.state === 'playing' && game.mode === 'online' && currentScreen === 'settings') {
        // Close settings back to online pause overlay
        navigateBackFromUI();
      } else if (game.state === 'playing' && game.mode === 'online' && currentScreen === 'onlinePause') {
        // Close online pause overlay — resume play
        document.getElementById('online-pause-overlay')!.classList.add('hidden');
        setCurrentScreen(null);
      } else if (game.state === 'playing' && game.mode === 'online') {
        // Online: show pause overlay (game continues running)
        document.getElementById('online-pause-overlay')!.classList.remove('hidden');
        // Show "Return Party to Lobby" only for lobby host
        const onlineMatch = getCurrentOnlineMatch();
        document.getElementById('btn-return-lobby-pause')!.style.display =
          (onlineMatch?.lobbyId && onlineMatch.lobbyRole === 'host') ? '' : 'none';
        setCurrentScreen('onlinePause');
        setFocusIndex(0);
        updateFocus();
      } else if (game.state === 'paused') {
        game.resume();
        playTick();
        hideTopBar();
        if (TOUCH_ENABLED) showTouchControls();
        setCurrentScreen(null);
        updateControlUI();
      } else if (game.state === 'replay' && window._freeCamLocked) {
        // Release pointer lock but stay in freecam — user can click UI
        document.exitPointerLock();
      } else if (game.state === 'replay') {
        document.getElementById('btn-replay-exit-top')!.click();
      } else if (game.state === 'menu' && currentScreen) {
        // ESC acts as back button in all menu sub-screens
        if (currentScreen === 'queue') document.getElementById('btn-queue-cancel')!.click();
        else if (currentScreen !== 'main') navigateBackFromUI();
      } else if (game.state === 'gameover' && currentScreen === 'gameover' && game.mode === 'online') {
        // Online: do nothing — player must click Leave or Next Round
      } else if (game.state === 'gameover' && currentScreen === 'gameover') {
        document.getElementById('btn-mainmenu')!.click();
      }
    }
  });
}
