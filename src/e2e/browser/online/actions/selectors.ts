// src/e2e/browser/online/actions/selectors.ts
// Centralized selector registry for e2e tests.
// When the UI changes, update selectors here — all tests auto-update.

// ── Lobby ────────────────────────────────────────────────────────────────────
export const LOBBY_OVERLAY = '#lobby-overlay:not(.hidden)';
export const LOBBY_START_BTN = '#btn-lobby-start';
export const LOBBY_INVITE_CODE = '.lobby-party-sheet-invite-code';
export const LOBBY_AI_ADD_BTN = '[data-testid="lobby-ai-add-btn"]';
export const LOBBY_PLAYER_CARD = (n: number): string => `[data-testid="lobby-player-card-${n}"]`;

// ── Auth ─────────────────────────────────────────────────────────────────────
export const AUTH_EMAIL_INPUT = '#login-email';
export const AUTH_PASSWORD_INPUT = '#login-password';
export const AUTH_LOGIN_BTN = '#btn-signin-submit';
export const AUTH_SIGNUP_BTN = '[data-testid="auth-signup-btn"]';
export const AUTH_USERNAME_INPUT = '[data-testid="auth-username-input"], #username-input';
export const AUTH_GUEST_BTN = '[data-testid="auth-guest-btn"]';
export const AUTH_USERNAME_DISPLAY = '#auth-username';

// ── Match / Gameplay ─────────────────────────────────────────────────────────
export const MATCH_RESULT_TEXT = '#result-text, [data-testid="match-result-text"]';
export const MATCH_REMATCH_BTN = '[data-testid="match-rematch-btn"], #btn-rematch';
export const MATCH_RETURN_LOBBY_BTN = '[data-testid="match-return-lobby-btn"], #btn-return-lobby';
export const MATCH_RETURN_MENU_BTN = '#btn-result-menu, #btn-gameover-menu';
export const FORFEIT_BTN = '[data-testid="forfeit-btn"], #btn-forfeit';
export const DISCONNECT_BANNER = '#disconnect-banner, [data-testid="disconnect-banner"]';

// ── Character Select ─────────────────────────────────────────────────────────
export const VEHICLE_CARD = (name: string): string => `[data-testid="vehicle-card-${name}"], .vehicle-card[data-vehicle="${name}"]`;
export const VEHICLE_CONFIRM_BTN = '[data-testid="vehicle-confirm-btn"], #btn-vehicle-confirm';

// ── Replay ───────────────────────────────────────────────────────────────────
export const REPLAY_OVERLAY = '#replay-overlay:not(.hidden)';
export const REPLAY_PLAY_BTN = '#btn-replay-play, [data-testid="replay-play-btn"]';
export const REPLAY_SPEED_LABEL = '#replay-speed-label, [data-testid="replay-speed-label"]';
export const REPLAY_CAM_LABEL = '#replay-cam-val, [data-testid="replay-cam-label"]';
export const REPLAY_PROGRESS_FILL = '#replay-progress-fill';

// ── Queue / Matchmaking ──────────────────────────────────────────────────────
export const QUEUE_ENTER_BTN = '[data-testid="queue-enter-btn"], #btn-enter-queue';
export const QUEUE_CANCEL_BTN = '[data-testid="queue-cancel-btn"], #btn-cancel-queue';

// ── Settings ─────────────────────────────────────────────────────────────────
export const SETTINGS_AUDIO_MASTER = '[data-testid="settings-audio-master"]';
export const SETTINGS_GRAPHICS_BLOOM = '[data-testid="settings-graphics-bloom"]';

// ── Leaderboard ──────────────────────────────────────────────────────────────
export const LEADERBOARD_ENTRY = (n: number): string => `[data-testid="leaderboard-entry-${n}"]`;

// ── Common / Navigation ──────────────────────────────────────────────────────
export const LOADING_SCREEN_PROMPT = '#click-prompt.click-prompt--visible';
export const CREATE_LOBBY_BTN = '#btn-create-lobby';
export const QUICKSTART_BTN = '#btn-quickstart';

// ── Result indicators (any text that means the match ended) ──────────────────
export const RESULT_INDICATORS = [
  'FRIED', 'WIN', 'VICTORY', 'LOSE', 'DEFEAT', 'LOST',
  'FORFEIT', 'DISCONNECT', 'DRAW', 'STALEMATE', 'WINNER=',
];
