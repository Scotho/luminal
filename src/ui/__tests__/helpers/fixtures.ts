// ── Shared Test Fixtures ────────────────────────────────

import { PLAYER_COLORS } from '../../../playerColors';

export const COLORS = [
  ...PLAYER_COLORS.map(({ key, color }) => ({ key, hex: color })),
] as const;

export const BESTOF_OPTIONS = [
  { value: 1, label: 'SINGLE MATCH' },
  { value: 3, label: 'BEST OF 3' },
  { value: 5, label: 'BEST OF 5' },
  { value: 7, label: 'BEST OF 7' },
] as const;

export const OPPONENT_OPTIONS = [
  { value: 1, label: '1 OPPONENT' },
  { value: 2, label: '2 OPPONENTS' },
  { value: 3, label: '3 OPPONENTS' },
  { value: 4, label: '4 OPPONENTS' },
] as const;

export const TEST_USER = {
  uid: 'test-uid-123',
  username: 'TestPlayer',
  email: 'test@example.com',
} as const;

export const SCREEN_IDS: Record<string, string> = {
  main: 'overlay',
  settings: 'settings-overlay',
  online: 'online-overlay',
  queue: 'queue-overlay',
  matchFound: 'match-found-overlay',
  login: 'login-overlay',
  stats: 'stats-overlay',
  friends: 'friends-overlay',
  music: 'music-overlay',
  leaderboard: 'leaderboard-overlay',
  gameover: 'result',
  joinLobby: 'join-lobby-overlay',
  lobby: 'lobby-overlay',
  characterSelect: 'character-select-overlay',
};

export const EXTRA_SCREEN_IDS: Record<string, string> = {
  paused: 'pause-overlay',
  replay: 'replay-overlay',
};
