// ── Game Mock Factory ──────────────────────────────────

import { vi } from 'vitest';
import { DEFAULT_PLAYER_COLOR_KEY, getPlayerColor } from '../../../playerColors';

export interface MockGame {
  state: string;
  mode: string;
  radarEnabled: boolean;
  settingsOpen: boolean;
  seriesLength: number;
  seriesOver: boolean;
  opponentCount: number;
  streak: number;
  player: { colorKey: string; trailColor: number };
  stats: { wins: number; losses: number; draws: number; bestStreak: number; totalTime: number; matchCount: number };
  startSeries: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  returnToMenu: ReturnType<typeof vi.fn>;
  canRestart: ReturnType<typeof vi.fn>;
  _onlineMatch: null | { stop: ReturnType<typeof vi.fn> };
  _lockstep: null | object;
  _teardownOnline: ReturnType<typeof vi.fn>;
  _restartDemo: ReturnType<typeof vi.fn>;
  setPlayerColor: ReturnType<typeof vi.fn>;
  onMatchEnd: ((result: string) => void) | null;
  [key: string]: unknown;
}

export function createMockGame(overrides: Partial<MockGame> = {}): MockGame {
  return {
    state: 'menu',
    mode: 'local',
    radarEnabled: true,
    settingsOpen: false,
    seriesLength: 1,
    seriesOver: false,
    opponentCount: 1,
    streak: 0,
    player: { colorKey: DEFAULT_PLAYER_COLOR_KEY, trailColor: getPlayerColor(DEFAULT_PLAYER_COLOR_KEY).color },
    stats: { wins: 0, losses: 0, draws: 0, bestStreak: 0, totalTime: 0, matchCount: 0 },
    startSeries: vi.fn(),
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    returnToMenu: vi.fn(),
    canRestart: vi.fn(() => true),
    _onlineMatch: null,
    _lockstep: null,
    _teardownOnline: vi.fn(),
    _restartDemo: vi.fn(),
    setPlayerColor: vi.fn(),
    onMatchEnd: null,
    ...overrides,
  };
}
