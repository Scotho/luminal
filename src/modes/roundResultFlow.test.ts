import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IRoundFlowHost } from './roundFlow';

// ── Mocks ────────────────────────────────────────────────────
// We mock the two UI surfaces we care about so we can assert which
// one was called for each code path.
const mockShowResultMapPanel = vi.fn();
const mockHideResultMapPanel = vi.fn();
vi.mock('../ui/resultMapSelect', () => ({
  showResultMapPanel: (...args: unknown[]) => mockShowResultMapPanel(...args),
  hideResultMapPanel: (...args: unknown[]) => mockHideResultMapPanel(...args),
}));

// Silence the other heavy deps that applyPrebuiltResultScreen touches.
vi.mock('../sfx', () => ({
  stopProximitySpark: vi.fn(),
  playDefeat: vi.fn(),
  playVictory: vi.fn(),
}));
vi.mock('../vehicleAudioEngine', () => ({ stopVehicleEngine: vi.fn() }));
vi.mock('../sfxAssets', () => ({
  playGameOver: vi.fn(),
  playWinScreen: vi.fn(),
}));
vi.mock('../ui/streakUI', () => ({
  hideStreakDisplay: vi.fn(),
  hideStreakEndInfo: vi.fn(),
  updateStreakEndInfo: vi.fn(),
}));
vi.mock('../utils', () => ({
  formatTime: vi.fn((t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`),
}));
vi.mock('../replayStore', () => ({ saveReplay: vi.fn(() => Promise.resolve('replay-id')) }));
vi.mock('../streak', () => ({ getStreakForMode: vi.fn(() => 0) }));

const { applyPrebuiltResultScreen } = await import('./roundResultFlow');

// ── DOM scaffold matching gameplay.html minimal shape ────────
function setupDom(): void {
  const ids = [
    'result', 'result-text', 'result-duration', 'result-streak',
    'result-streak-ended', 'series-result', 'btn-continue',
    'result-match-selector', 'match-sel-label',
  ];
  for (const id of ids) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  // result-streak needs a child span.streak-num
  const rs = document.getElementById('result-streak')!;
  const sn = document.createElement('span');
  sn.className = 'streak-num';
  rs.appendChild(sn);
}

// ── Minimal host factory ─────────────────────────────────────
function createHost(overrides: Partial<IRoundFlowHost> = {}): IRoundFlowHost {
  const prebuilt = {
    resultText: 'VICTORY',
    resultColor: '#00ffff',
    audioCall: null,
    playGameOver: false,
    playWinScreen: false,
    showStreakEnded: false,
    seriesHTML: null,
    seriesLabelHTML: '',
    continueText: 'CONTINUE',
    durationText: '0:30',
    showStreak: false,
    streakNum: '0',
    statsJSON: '{}',
    matchSelectorVisible: false,
    matchSelectorLabel: 'MATCH 1',
  };

  const host = {
    mode: 'local' as const,
    _prebuiltResultState: prebuilt,
    _lastStreakEnd: null,
    _radarPreRendered: true,
    _resultRadarCtx: null,
    _selectedMatchIndex: 0,
    _seriesReplayIds: [],
    _updateSeriesHUD: vi.fn(),
    _updateStreak: vi.fn(),
    _drawRadar: vi.fn(),
    _applyResultButtonVisibility: vi.fn(),
  } as unknown as IRoundFlowHost;

  return Object.assign(host, overrides);
}

// ── Tests ────────────────────────────────────────────────────

describe('applyPrebuiltResultScreen', () => {
  beforeEach(() => {
    mockShowResultMapPanel.mockClear();
    mockHideResultMapPanel.mockClear();
    setupDom();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('quick-start (local mode)', () => {
    it('does not show the NEXT ARENA panel for local matches', () => {
      const host = createHost({ mode: 'local' });

      applyPrebuiltResultScreen(host);

      expect(mockShowResultMapPanel).not.toHaveBeenCalled();
    });

    it('clears _prebuiltResultState when done', () => {
      const host = createHost({ mode: 'local' });

      applyPrebuiltResultScreen(host);

      expect(host._prebuiltResultState).toBeNull();
    });
  });

  describe('online mode', () => {
    it('does NOT show the NEXT ARENA panel — that is driven by the online lobby flow', () => {
      const host = createHost({ mode: 'online' });

      applyPrebuiltResultScreen(host);

      expect(mockShowResultMapPanel).not.toHaveBeenCalled();
    });

    it('still applies header, body, duration, and result-button visibility', () => {
      const host = createHost({ mode: 'online' });

      applyPrebuiltResultScreen(host);

      expect(document.getElementById('result-text')!.textContent).toBe('VICTORY');
      expect(document.getElementById('result-duration')!.textContent).toBe('0:30');
      expect(host._applyResultButtonVisibility).toHaveBeenCalled();
    });
  });
});
