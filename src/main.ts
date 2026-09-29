import { startLoop } from './gameLoop';
import { createScene } from './scene';
import { Game } from './game';
import { TOUCH_ENABLED } from './input';
import { initTooltips } from './ui/tooltipSystem';
import { initTouch } from './touch';
import { initAudio, startAudio } from './audio';
import { playConfirm, playTick } from './sfx';
import { initGamepad } from './gamepad';
import { initTimeTracking } from './ui/timeTracking';
import { loadSettings, detectPreset } from './graphics';
import { initLeaderboardUI } from './ui/leaderboardUI';
import { initFriendsUI } from './ui/friendsUI';
import { initChatUI, _hideChatForMatch, _restoreChatAfterMatch, _initMatchChat, _destroyMatchChat, updateOnlineUI as updateChatOnlineUI } from './ui/chatUI';
import { initEffects } from './ui/effects';
import { initLoadingScreen, isLoadingDismissed } from './ui/loadingScreen';
import { initReplayUI, resetReplayUI } from './ui/replayUI';
import { initMusicUI } from './ui/musicUI';
import { initOnlineUI, handleOnlineStateChange, setCurrentOnlineMatch, getPlayerColorKey } from './ui/onlineUI';
import { initLobbyUI, getCurrentLobbyId, getMyRole, joinLobbyById, joinMatchAsSpectator, isLobbyMatchStarting, _openLobbyAsHost, _leaveLobby } from './ui/lobby/lobbyUI';
import { initNotifUI } from './ui/notifUI';
import { initSocialUI, updateSocialButtonVisibility } from './ui/socialUI';
import { initMobileDrawer } from './ui/mobileDrawer';
import { hideTopBar, showTopBar } from './ui/topbar';
import { initSettingsUI, getRadarMobileHide } from './ui/settingsUI';
import { initTopbarDropdowns } from './ui/topbarDropdown';
import { initVersionCheck } from './ui/versionCheck';
import { initScreenHooks } from './ui/screenHooks';
import { initEscapeHandler } from './ui/escapeHandler';
import { initKeybindsUI } from './ui/keybindsUI';
import { initInputUI, updateControlUI } from './ui/inputUI';
import { getCurrentUid, getCurrentUsername, getCurrentIcon, getIsRealUser } from './ui/authUI';
import {
  showScreen, navigateTo, navigateBack, navigateBackFromUI,
  navigateReset, getCurrentScreen, setCurrentScreen,
  getFocusIndex, setFocusIndex, updateFocus,
  hideDynBack, clearNavStack,
} from './ui/navigation';
import { initCharacterSelect } from './ui/characterSelectUI';
import { initBugReporter } from './bugReporter';
import { initStatsUI } from './ui/statsUI';
import { initCursorGlow } from './ui/cursorGlow';
import { initPWA } from './ui/pwa';
import { initProfileUI } from './ui/profileUI';
import { initMatchSubmit } from './ui/matchSubmit';
import { initMatchHistory } from './ui/matchHistory';
import { initVolumeUI } from './ui/volumeUI';
import { initPerfStats } from './ui/perfStats';
import { initCameraInput } from './ui/cameraInput';
import { showServerActivity, hideServerActivity } from './ui/serverActivity';
import { initHistoryNav } from './ui/historyNav';
import { initButtonHandlers } from './ui/buttonHandlers';
import { initPresenceUI } from './ui/presenceUI';
import { initChatDrag } from './ui/chatDrag';
import { initOrientationTransition } from './ui/orientationTransition';
import { initOverlayScaler } from './ui/overlayScaler';
import { initAuthWiring } from './ui/authWiring';
import { initAnnouncements } from './announcements';
import { initMenuSubplate } from './ui/menuSubplate';
import { initShellResize } from './shellResize';

// ── Touch Controls ───────────────────────────────────────
if (TOUCH_ENABLED) {
  initTouch();
} else {
  // Lazy init for desktop touchscreens — activate on first real touch
  window.addEventListener('touchstart', () => {
    initTouch();
  }, { once: true });
}

// ── Orientation Change Animation ─────────────────────────
initOrientationTransition();

// ── Cursor Glow (hover effect on clickables) ────────────
initCursorGlow();

// ── PWA Install ──────────────────────────────────────────
initPWA();

// ── Graphics Settings ─────────────────────────────────────
const _gfxHadSaved: boolean = loadSettings();

const sceneBundle = createScene();
const { scene, camera, renderer, composer, bloomPass } = sceneBundle;
const game: Game = new Game(scene, camera, bloomPass);

function cameraStateIsFinite(): boolean {
  return Number.isFinite(camera.position.x)
    && Number.isFinite(camera.position.y)
    && Number.isFinite(camera.position.z)
    && Number.isFinite(camera.fov);
}

function sanitizeRenderState(): void {
  if (!Number.isFinite(renderer.toneMappingExposure) || renderer.toneMappingExposure <= 0) {
    renderer.toneMappingExposure = 1.3;
  }

  if (bloomPass) {
    if (!Number.isFinite(bloomPass.strength) || bloomPass.strength < 0) bloomPass.strength = 0.5;
    if (!Number.isFinite(bloomPass.radius) || bloomPass.radius < 0) bloomPass.radius = 0.71;
    if (!Number.isFinite(bloomPass.threshold)) bloomPass.threshold = 0.55;
  }

  if (!cameraStateIsFinite()) {
    camera.position.set(0, 100, 140);
    camera.lookAt(0, 0, 0);
    camera.fov = 72;
    camera.updateProjectionMatrix();
  }
}

if (import.meta.env.MODE === 'development') {
  void import('./debugLog').then(({ registerDebugRefs }) => {
    registerDebugRefs(game, renderer);
  });
  void import('./ui/adminToggle').then(({ initAdminToggle }) => {
    initAdminToggle({ game, renderer });
  });
}

// Auto-detect quality on first visit (after scene exists)
if (!_gfxHadSaved) detectPreset(renderer, scene, camera, composer);

// Post-match leaderboard — wired via initMatchSubmit
initMatchSubmit({ game, showServerActivity, hideServerActivity });

initTimeTracking();

initVersionCheck();

// ── Menu Background Mode ──────────────────────────────────
// Always AI demo — replay bg mode removed (action cam broken).
function _restoreBgMode(): void { /* no-op — AI demo restarts via returnToMenu */ }

// ── Audio ─────────────────────────────────────────────────
let audioStarted: boolean = false;
function ensureAudio(): void {
  if (!audioStarted) {
    initAudio();
    startAudio();
    audioStarted = true;
  }
}

initEffects({ game, getAudioStarted: () => audioStarted, composer, renderer });

initLoadingScreen({ game, ensureAudio, showScreen, getCurrentScreen });

initGamepad();
initPerfStats({ renderer });
initOverlayScaler();

// ── Window Globals ───────────────────────────────────────
window.showScreen = showScreen;
window.navigateReset = navigateReset;

initHistoryNav({ game, ensureAudio, restoreBgMode: _restoreBgMode, touchEnabled: TOUCH_ENABLED });
initScreenHooks({ game, audioStarted: () => audioStarted });

initTooltips();

initEscapeHandler({ game, ensureAudio });

// Quick Start: always single match, 1 opponent (settings live in Character Select + Lobby)
game.seriesLength = 1;
game.opponentCount = 1;

// ── Close all popups on game start ────────────────────────
function _closeAllPopups(): void {
  document.getElementById('announcement-panel')?.classList.remove('announcement--visible');
  document.getElementById('lobby-panel')?.classList.remove('open');
  document.querySelectorAll('.overlay-screen:not(.hidden)').forEach((o: Element) => o.classList.add('hidden'));
  // Close any pinned dropdowns
  document.querySelectorAll('.tb-dropdown--pinned').forEach((el: Element) => el.classList.remove('tb-dropdown--pinned', 'tb-dropdown--open'));
}

window._hideTopBar = hideTopBar;
window._showTopBar = showTopBar;

// ── Sub-module initialization ─────────────────────────────
initShellResize();
initSettingsUI({ game });
game.radarMobileHide = getRadarMobileHide();
initMusicUI({ ensureAudio, navigateTo });
initKeybindsUI({ navigateTo });
initInputUI({ getCurrentScreen, getGameState: () => game.state });
initReplayUI({ game, getCurrentScreen, setCurrentScreen, navigateReset, getFocusIndex, setFocusIndex, updateFocus, canvas: renderer.domElement });
initLeaderboardUI({ currentUid: getCurrentUid(), game, showScreen, navigateTo, setCurrentScreen, getRadarEnabled: () => game.radarEnabled, resetReplayUI });
initFriendsUI({ currentUid: getCurrentUid(), currentUsername: getCurrentUsername(), isRealUser: getIsRealUser(), navigateTo, navigateBack, showServerActivity, hideServerActivity, getPlayerColorKey, getPlayerIcon: getCurrentIcon });
initOnlineUI({ game, showScreen, navigateTo, navigateBack, setCurrentScreen, getCurrentScreen, updateFocus, getFocusIndex, setFocusIndex, playConfirm, playTick, hideChatForMatch: _hideChatForMatch, restoreChatAfterMatch: _restoreChatAfterMatch, initMatchChat: _initMatchChat, destroyMatchChat: _destroyMatchChat, restoreBgMode: _restoreBgMode, ensureAudio, updateControlUI, getLobbyMatchStarting: isLobbyMatchStarting, setLobbyMatchStarting: (_v: boolean) => {}, currentUid: getCurrentUid(), currentUsername: getCurrentUsername(), isRealUser: getIsRealUser(), hideDynBack, clearNavStack });
initLobbyUI({ game, currentUid: getCurrentUid(), currentUsername: getCurrentUsername(), isRealUser: getIsRealUser(), showScreen, navigateTo, navigateReset, handleOnlineStateChange, setCurrentOnlineMatch, getPlayerColorKey, getPlayerIcon: getCurrentIcon, ensureAudio, hideChatForMatch: _hideChatForMatch, setCurrentScreen });
initNotifUI({ getCurrentLobbyId, joinLobbyById, joinMatchAsSpectator, showServerActivity, hideServerActivity });
initSocialUI({
  navigateTo,
  navigateBack,
  getCurrentLobbyId,
  getMyRole,
  createParty: _openLobbyAsHost,
  leaveParty: () => { _leaveLobby(); navigateReset('main'); },
  currentUid: getCurrentUid(),
  currentUsername: getCurrentUsername(),
  isRealUser: getIsRealUser(),
});
window.addEventListener('resize', updateSocialButtonVisibility);
window.addEventListener('gamepadconnected', () => setTimeout(updateSocialButtonVisibility, 100));
window.addEventListener('gamepaddisconnected', () => setTimeout(updateSocialButtonVisibility, 100));
updateSocialButtonVisibility();
initChatUI({ currentUid: getCurrentUid(), currentUsername: getCurrentUsername(), isRealUser: getIsRealUser() });
// Keep chat hidden until CLICK TO START is dismissed (transition applied in dismissLoading)
if (!isLoadingDismissed()) document.getElementById('global-chat')?.classList.add('chat--match-hidden');
initCharacterSelect({ playTick, onBack: navigateBackFromUI });
initMobileDrawer();
initProfileUI({ getCurrentUid: () => getCurrentUid(), navigateBack });
initAuthWiring({ updateOnlineUI });

// ── Scroll-at-end detection for scroll fade affordance (touch) ──
if (TOUCH_ENABLED) {
  const SCROLL_END_THRESHOLD = 8; // px from bottom to consider "at end"
  document.addEventListener('scroll', (e: Event) => {
    if (!(e.target instanceof HTMLElement)) return;
    const t = e.target;
    const atEnd = t.scrollHeight - t.scrollTop - t.clientHeight < SCROLL_END_THRESHOLD;
    t.classList.toggle('scroll-at-end', atEnd);
  }, true);
}

initBugReporter({
  getUid: () => getCurrentUid() || 'anonymous',
  getUsername: () => getCurrentUsername() || 'anonymous',
  getGameMode: () => `${game.mode}/${game.state}`,
});

initTopbarDropdowns();
initStatsUI({ game, navigateTo });
initMatchHistory({ game, navigateTo, showScreen, setCurrentScreen });
initVolumeUI({ ensureAudio });

initButtonHandlers({ game, ensureAudio, restoreBgMode: _restoreBgMode, closeAllPopups: _closeAllPopups });
initCameraInput({ game });
initPresenceUI();
initChatDrag();
initAnnouncements();
initMenuSubplate();

function updateOnlineUI(): void { updateChatOnlineUI(); }

// Randomize button sheen timing so they don't sync
document.querySelectorAll('.menu-btn, .replay-btn, .auth-google, .online-option, #btn-login').forEach((el: Element) => {
  (el as HTMLElement).style.setProperty('--sheen-delay', (Math.random() * -6).toFixed(2) + 's');
  (el as HTMLElement).style.setProperty('--sheen-dur', (2.5 + Math.random() * 2).toFixed(2) + 's');
});

startLoop({
  game,
  composer,
  ensureAudio,
  closeAllPopups: _closeAllPopups,
  sanitizeRenderState,
  hideChatForMatch: _hideChatForMatch,
  restoreChatAfterMatch: _restoreChatAfterMatch,
  isAudioStarted: () => audioStarted,
  updateOnlineUI,
});
