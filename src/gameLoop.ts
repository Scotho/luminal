// ── Game Loop (extracted from main.ts) ───────────────────
import { pollGamepad, getRawGamepadState, isGamepadConnected } from './gamepad';
import { updateFPS } from './ui/effects';
import { recordFrameSample } from './ui/perfStats';
import { isEnter, consumeEnter, TOUCH_ENABLED } from './input';
import { setVaporText } from './ui/vaporText';
import { isLoadingDismissed, getLoadProgress, dismissLoading } from './ui/loadingScreen';
import {
  getCurrentScreen, setCurrentScreen,
  hideDynBack, clearNavStack,
} from './ui/navigation';
import { updateControlUI } from './ui/inputUI';
import { updateFreeCamInput } from './ui/replayUI';
import { showChatInMatch } from './ui/chatUI';
import { unreadyInParty } from './ui/lobby/lobbyUI';
import { showTouchControls } from './touch';
import { maybeSwitchToGamepad, updateGamepadNav, trackScreenState } from './gameLoopPerf';
import { stepAndRender } from './gameLoopFixedStep';

export interface LoopDeps {
  game: any;
  composer: { render(): void };
  ensureAudio: () => void;
  closeAllPopups: () => void;
  sanitizeRenderState: () => void;
  hideChatForMatch: () => void;
  restoreChatAfterMatch: () => void;
  isAudioStarted: () => boolean;
  updateOnlineUI: () => void;
}

let _deps: LoopDeps;
let lastTime: number = 0;

export function startLoop(deps: LoopDeps): void {
  _deps = deps;
  lastTime = performance.now();
  requestAnimationFrame(loop);
}

function _checkLoadingDismiss(): void {
  if (isLoadingDismissed() || getLoadProgress() < 100) return;
  if (!TOUCH_ENABLED && isGamepadConnected()) {
    setVaporText('PRESS ANY BUTTON TO START');
  }
  const gp = getRawGamepadState();
  if (gp) {
    for (const key of Object.keys(gp._edges)) {
      if ((gp._edges as Record<string, boolean>)[key]) { dismissLoading(); break; }
    }
  }
}

function _handleEnterKey(): void {
  if (!isLoadingDismissed() || !isEnter() || (document.activeElement as HTMLElement)?.tagName === 'INPUT') return;
  consumeEnter();
  _deps.ensureAudio();
  if ((_deps.game.state === 'playing' || _deps.game.state === 'countdown') && !getCurrentScreen()) {
    // During gameplay with no menu open: toggle chat
    showChatInMatch();
  } else if (_deps.game.state === 'menu') {
    unreadyInParty(); clearNavStack(); hideDynBack(); _deps.game.startSeries(); setCurrentScreen(null);
    _deps.closeAllPopups(); _deps.hideChatForMatch(); if (TOUCH_ENABLED) showTouchControls();
  } else if (_deps.game.canRestart()) {
    unreadyInParty(); if (_deps.game.seriesOver) _deps.game.startSeries(); else _deps.game.start();
    setCurrentScreen(null); _deps.hideChatForMatch(); if (TOUCH_ENABLED) showTouchControls();
  }
}

function loop(): void {
  requestAnimationFrame(loop);

  const now: number = performance.now();
  const rawDtMs: number = now - lastTime;
  const dt: number = Math.min(rawDtMs / 1000, 0.05);
  lastTime = now;

  updateFPS();
  recordFrameSample(rawDtMs);
  pollGamepad();
  _checkLoadingDismiss();
  updateFreeCamInput();
  updateControlUI();
  _handleEnterKey();
  maybeSwitchToGamepad();
  updateGamepadNav({ game: _deps.game, ensureAudio: _deps.ensureAudio });
  trackScreenState(_deps.game.state);
  _deps.updateOnlineUI();

  stepAndRender(dt, {
    game: _deps.game,
    composer: _deps.composer,
    sanitizeRenderState: _deps.sanitizeRenderState,
    isAudioStarted: _deps.isAudioStarted,
  });
}
