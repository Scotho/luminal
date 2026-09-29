import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./grid', async () => {
  const actual = await vi.importActual<typeof import('./grid')>('./grid');
  return {
    ...actual,
    triggerCountdownPulse: vi.fn(),
    updateCountdownPulses: vi.fn(),
    clearCountdownPulses: vi.fn(),
  };
});

vi.mock('./sfx', async () => {
  const actual = await vi.importActual<typeof import('./sfx')>('./sfx');
  return {
    ...actual,
    playCountdown: vi.fn(),
    playVictory: vi.fn(),
    playDefeat: vi.fn(),
  };
});

vi.mock('./sfxAssets', async () => {
  const actual = await vi.importActual<typeof import('./sfxAssets')>('./sfxAssets');
  return {
    ...actual,
    playGameOver: vi.fn(),
    playWinScreen: vi.fn(),
  };
});

const { Game } = await import('./game');
const { RoundFlow } = await import('./modes/roundFlow');

function makeGame(overrides: Record<string, unknown> = {}): Game {
  const game = Object.assign(Object.create(Game.prototype), overrides) as Game;
  // Provide _roundFlow so delegated methods work without calling the constructor
  if (!game._roundFlow) game._roundFlow = new RoundFlow(game as never);
  return game;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  delete (window as Window & { _showTopBar?: () => void })._showTopBar;
});

describe('Game result flow', () => {
  it('does not prewarm replay assets on the countdown 3 tick', () => {
    // Provide DOM elements that RoundFlow.updateCountdown reads
    const cd = document.createElement('div'); cd.id = 'countdown'; document.body.appendChild(cd);
    const cdNum = document.createElement('div'); cdNum.id = 'countdown-num'; document.body.appendChild(cdNum);

    const game = makeGame({
      countdownTimer: 0,
      countdownNum: 2,
      scene: {},
      mode: 'local',
      state: 'countdown',
      gameOverTimer: 0,
      _prewarmResultGhost: vi.fn(),
    }) as Game & { _prewarmResultGhost: ReturnType<typeof vi.fn> };

    game._roundFlow!.updateCountdown(0);

    expect(game._prewarmResultGhost).not.toHaveBeenCalled();
    expect(game.countdownNum).toBe(3);

    cd.remove();
    cdNum.remove();
  });

  it('prepares result assets during blackout and waits for replay startup', async () => {
    const events: string[] = [];
    let finishReplayLoad: (() => void) | null = null;
    const game = makeGame({
      _prepDone: false,
      _prebuiltResultState: null,
      _replayRecorder: { hasData: () => true },
      _prepResultScreenEarly: vi.fn(() => { events.push('early'); }),
      _prepResultScreenLate: vi.fn(() => { events.push('late'); }),
      startBgReplay: vi.fn(() => {
        events.push('bg-start');
        return new Promise<void>((resolve) => {
          finishReplayLoad = () => {
            events.push('bg-end');
            resolve();
          };
        });
      }),
    });

    const prepPromise = game._prepareResultScreenDuringBlackout();
    await Promise.resolve();

    expect(events).toEqual(['early', 'late', 'bg-start']);
    expect(game._prepDone).toBe(true);

    finishReplayLoad?.();
    await prepPromise;

    expect(events).toEqual(['early', 'late', 'bg-start', 'bg-end']);
  });

  it('keeps the blackout up until prep and the minimum hold are both complete', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let finishPrep: (() => void) | null = null;
    const game = makeGame({
      _fading: false,
      _killcamActive: true,
      _killcamData: { roundResult: 'player', playerWonSeries: false, anyAiWonSeries: false },
      _sceneFade: vi.fn(async (toBlack: boolean) => { events.push(toBlack ? 'fade:black' : 'fade:reveal'); }),
      _prepareResultScreenDuringBlackout: vi.fn(() => new Promise<void>((resolve) => {
        events.push('prep:start');
        finishPrep = () => {
          game._prebuiltResultState = { ready: true } as never;
          events.push('prep:end');
          resolve();
        };
      })),
      _applyPrebuiltResultScreen: vi.fn(() => { events.push('apply'); }),
      _showResultScreenWaterfall: vi.fn(() => { events.push('waterfall'); }),
      _streakCeremony: { any: true },
      _streakIncrementAnim: { any: true },
    });

    (window as Window & { _showTopBar?: () => void })._showTopBar = () => { events.push('topbar'); };

    const showPromise = game._showResultScreen();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual(['fade:black', 'prep:start']);

    finishPrep?.();
    await Promise.resolve();

    expect(events).toEqual(['fade:black', 'prep:start', 'prep:end', 'apply']);

    await vi.advanceTimersByTimeAsync(599);
    expect(events).toEqual(['fade:black', 'prep:start', 'prep:end', 'apply']);

    await vi.advanceTimersByTimeAsync(1);
    await showPromise;

    // topbar slides in AFTER the reveal so the animation is visible
    expect(events).toEqual(['fade:black', 'prep:start', 'prep:end', 'apply', 'fade:reveal', 'topbar']);
    expect(game._killcamData).toBeNull();
    expect(game._fading).toBe(false);
  });
});
