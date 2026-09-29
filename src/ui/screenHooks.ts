// ── Screen Hooks & Navigation Wiring ────────────────────────────────────────
// Builds the screen enter/exit hook table and calls initNavigation().

import { setMusicDampen, getPlaylistMode } from '../audio';
import { setSfxDampen } from '../sfx';
import { vibrate } from '../vibrate';
import { TOUCH_ENABLED } from '../input';
import { showRadarPreview, hideRadarPreview } from './leaderboardUI';
import {
  initSettingsNav,
  cycleTab, moveFocus, getFocusedRow, resetFocus,
  closeMobileSubpage, isMobileSubpageOpen,
} from './settingsNav';
import { stopListening as stopKeybindListening, refreshKeybindLabels as _refreshKeybindLabels } from './keybindsUI';
import {
  _updateMusicOverlay, _renderDefaultPlaylist, _renderMusicPlaylist,
  _renderSynthwavePlaylist, _renderElectronicPlaylist, _renderAllPlaylist,
  _switchMusicTab, _startScrubberLoop, _stopScrubberLoop,
} from './musicUI';
import { resetStatsView, populateStats } from './statsUI';
import { getLoginExitHook } from './authUI';
import { switchSocialTab } from './socialUI';
import { onCharacterSelectEnter, onCharacterSelectExit } from './characterSelectUI';
import { cycleTab as cycleHubTab } from './hubUI';
import { initNavigation } from './navigation';
import { hideTopBar, showTopBar } from './topbar';
import { showGlobe, hideGlobe } from './globeBackdrop';
import { _restoreChatAfterMatch, _hideChatForMatch } from './chatUI';
import { playNavigate, playNavigateBack, playHover, playConfirm } from '../sfx';

interface ScreenHooksDeps {
  game: { state: string };
  audioStarted: () => boolean;
}

function _setAudioDampen(on: boolean): void {
  setMusicDampen(on);
  setSfxDampen(on);
}

export function initScreenHooks(deps: ScreenHooksDeps): void {
  const { game, audioStarted } = deps;

  const screenHooks: Record<string, { enter?: () => void; exit?: () => void }> = {
    settings: {
      enter() { showRadarPreview(); initSettingsNav(); _refreshKeybindLabels(); _setAudioDampen(true); },
      exit()  { hideRadarPreview(); stopKeybindListening(); _setAudioDampen(false); closeMobileSubpage(); },
    },
    music: {
      enter() {
        _updateMusicOverlay(); _renderDefaultPlaylist(); _renderMusicPlaylist(); _renderSynthwavePlaylist(); _renderElectronicPlaylist(); _renderAllPlaylist();
        _switchMusicTab(getPlaylistMode());
        _startScrubberLoop();
      },
      exit() { _stopScrubberLoop(); },
    },
    stats: {
      enter() {
        resetStatsView();
        document.querySelectorAll('.stats-header-tab').forEach(t => t.classList.remove('stats-header-tab--active'));
        document.querySelector('.stats-header-tab[data-view="mystats"]')?.classList.add('stats-header-tab--active');
        document.getElementById('stats-panel-mystats')?.classList.remove('hidden');
        document.getElementById('stats-panel-history')?.classList.add('hidden');
        document.getElementById('stats-panel-leaderboard')?.classList.add('hidden');
        populateStats();
      },
    },
    login: {
      enter() { getLoginExitHook()(); },
      exit() { getLoginExitHook()(); },
    },
    social: {
      // Both clones stay mounted permanently — just reset the active tab on entry.
      enter() { switchSocialTab('party'); },
    },
    // lobby: no exit hook — player stays in party when navigating away
    characterSelect: {
      enter() { onCharacterSelectEnter(); },
      exit()  { onCharacterSelectExit(); },
    },
    debug: {},
    profile: {},
  };

  initNavigation(screenHooks, {
    onHideTopBar: hideTopBar,
    onShowTopBar: showTopBar,
    getGameState: () => game.state,
    onShowGlobe: showGlobe,
    onHideGlobe: hideGlobe,
    onRestoreChatAfterMatch: _restoreChatAfterMatch,
    onHideChatForMatch: _hideChatForMatch,
    playNavigate,
    playNavigateBack,
    playHover,
    playConfirm,
    vibrate: (ms: number) => vibrate(ms),
    isAudioStarted: audioStarted,
    cycleTab: (dir: number) => cycleTab(dir as 1 | -1),
    cycleHubTab: (dir: number) => cycleHubTab(dir as 1 | -1),
    moveFocus: (dir: number) => moveFocus(dir as 1 | -1),
    getFocusedRow,
    resetFocus,
    isMobileSubpageOpen,
    closeMobileSubpage,
  }, { touchEnabled: TOUCH_ENABLED });
}
