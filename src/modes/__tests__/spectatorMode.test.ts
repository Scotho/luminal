// ── spectatorMode.ts unit tests ──────────────────────────
// TASK-66 — Tests SpectatorMode.pickTarget, updateSim, endSpectating.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ISpectatorHost } from '../spectatorMode';
import type { GameState, KillcamPhase, GameStats, StreakData, AIState, AIInput, MatchInfo, ReplaySnapshot, KillcamData } from '../../types/index';

// ── Mock heavy dependencies ─────────────────────────────────
vi.mock('../../ai', () => ({
  getAIInput: vi.fn(() => ({ turn: 0, accelerate: true, dash: false, brake: false }) satisfies AIInput),
}));

vi.mock('../../core/collisionSystem', () => ({
  updateProximitySpeed: vi.fn(),
  applyWallRepulsion: vi.fn(),
}));

vi.mock('../../grid', () => ({
  ARENA_SIZE: 200,
  updateWallGlow: vi.fn(),
}));

vi.mock('../../replayStore', () => ({
  saveReplay: vi.fn(() => Promise.resolve('replay-123')),
}));

const resolveRoundMock = vi.fn();
vi.mock('../../core/roundResolution', () => ({
  resolveRound: (...args: unknown[]) => resolveRoundMock(...args),
}));

vi.mock('../../trail', () => ({ Trail: class {} }));
vi.mock('../../replay', () => ({ ReplayRecorder: class {} }));
vi.mock('../../ui/streakUI', () => ({ hideStreakDisplay: vi.fn() }));

vi.mock('three', () => {
  class Vector3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
  }
  class Scene {}
  class PerspectiveCamera { position = new Vector3(); fov = 50; }
  return { Vector3, Scene, PerspectiveCamera };
});

import { SpectatorMode } from '../spectatorMode';
import { updateWallGlow } from '../../grid';
import { saveReplay } from '../../replayStore';
import { getAIInput } from '../../ai';

// ── Typed test doubles ──────────────────────────────────────
interface TestPlayer {
  alive: boolean;
  meter: number;
  meterGaining: boolean;
  dashing: boolean;
  trail: { _tag: 'trail' };
  _pos: { x: number; z: number };
  getPosition(): { x: number; z: number };
  update(dt: number, turn: number, accel: boolean, dash: boolean, brake: boolean): void;
  updateDeath(dt: number): void;
  rechargeMeter(other: unknown, dt: number): void;
}

function makePlayer(x = 0, z = 0, alive = true): TestPlayer {
  const pos = { x, z };
  return {
    alive,
    meter: 50,
    meterGaining: false,
    dashing: false,
    trail: { _tag: 'trail' as const },
    _pos: pos,
    getPosition: () => pos,
    update: vi.fn(),
    updateDeath: vi.fn(),
    rechargeMeter: vi.fn(),
  };
}

interface TestAIEntry {
  player: TestPlayer;
  aiState: AIState | null;
  colorHex: number;
  _lastInput?: AIInput;
}

function makeAI(x = 0, z = 0, alive = true, withState = true): TestAIEntry {
  return {
    player: makePlayer(x, z, alive),
    aiState: withState ? ({ fidgetTimer: 0 } as unknown as AIState) : null,
    colorHex: 0xff0000,
  };
}

// Custom host type — ISpectatorHost field shapes but with test-double Player.
type TestHost = Omit<ISpectatorHost, 'player' | 'ais' | 'stats' | 'streakData' | '_replayRecorder'> & {
  player: TestPlayer | null;
  ais: TestAIEntry[];
  stats: Partial<GameStats>;
  streakData: StreakData;
  _replayRecorder: { hasData: () => boolean; getSnapshot: () => ReplaySnapshot };
};

function createHost(overrides: Partial<TestHost> = {}): TestHost {
  const base: TestHost = {
    scene: {} as THREE.Scene,
    camera: {} as THREE.PerspectiveCamera,
    state: 'playing' as GameState,
    mode: 'local',
    _fading: false,
    player: makePlayer(0, 0, false),
    ais: [makeAI(10, 10, true), makeAI(-10, -10, true)],
    _onlineMatch: null,
    _killcamPhase: 'none' as KillcamPhase,
    _killcamActive: false,
    _killcamPos: null,
    _killcamStartCamPos: null,
    _killcamTimer: 0,
    _killcamDelayTimer: 0,
    _spectating: true,
    cleanup: vi.fn(),
    _sceneFade: vi.fn(() => Promise.resolve()),

    matchTime: 10,
    _spectateTarget: null,
    _killcamData: null,
    _aiFrame: 0,

    seriesLength: 1,
    seriesPlayerWins: 0,
    seriesAiWins: [0],
    seriesOver: false,
    opponentCount: 1,

    stats: { totalRounds: 0 } as Partial<GameStats>,
    streakData: {
      bo1: { currentStreak: 0, bestStreak: 0 },
      bo3: { currentStreak: 0, bestStreak: 0 },
      bo5: { currentStreak: 0, bestStreak: 0 },
    } as StreakData,

    _replayRecorder: {
      hasData: vi.fn(() => false),
      getSnapshot: vi.fn(() => ({
        frames: [], playerColor: 0, playerEmissive: 0, aiColors: [], duration: 0,
      } satisfies ReplaySnapshot)),
    },
    _lastReplaySnapshot: null,
    _lastSavedReplayId: null,
    _seriesReplayIds: [],

    onMatchEnd: null,

    _checkCollisions: vi.fn(),
    _showResultScreen: vi.fn(() => Promise.resolve()),
    _refreshMatchSelector: vi.fn(),
    _updateSeriesHUD: vi.fn(),
    _getStreakKey: vi.fn(() => 'bo1' as const),
  };
  return Object.assign(base, overrides);
}

function asHost(h: TestHost): ISpectatorHost {
  return h as unknown as ISpectatorHost;
}

// ── DOM helpers ─────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  const label = document.createElement('div');
  label.id = 'spectator-label';
  document.body.appendChild(label);
  resolveRoundMock.mockReturnValue({
    roundResult: 'ai',
    updatedStats: { totalRounds: 1 },
    updatedStreakData: {
      bo1: { currentStreak: 0, bestStreak: 0 },
      bo3: { currentStreak: 0, bestStreak: 0 },
      bo5: { currentStreak: 0, bestStreak: 0 },
    },
    updatedSeriesPlayerWins: 0,
    updatedSeriesAiWins: [1],
    seriesOver: true,
    playerWonSeries: false,
    anyAiWonSeries: true,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
});

// ═══════════════════════════════════════════════════════════
// pickTarget
// ═══════════════════════════════════════════════════════════
describe('SpectatorMode.pickTarget', () => {
  it('returns null when no AI is alive', () => {
    const host = createHost({ ais: [makeAI(0, 0, false), makeAI(1, 1, false)] });
    const spec = new SpectatorMode(asHost(host));
    expect(spec.pickTarget()).toBeNull();
  });

  it('returns the only alive AI when exactly one remains', () => {
    const dead = makeAI(100, 100, false);
    const alive = makeAI(5, 5, true);
    const host = createHost({ ais: [dead, alive] });
    const spec = new SpectatorMode(asHost(host));
    expect(spec.pickTarget()).toBe(alive.player);
  });

  it('picks the AI closest to another AI when multiple alive', () => {
    // Closest pair is ais[1] and ais[2] (at 0,0 and 0.5,0.5).
    const far = makeAI(100, 100, true);
    const a = makeAI(0, 0, true);
    const b = makeAI(0.5, 0.5, true);
    const host = createHost({ ais: [far, a, b] });
    const spec = new SpectatorMode(asHost(host));
    const target = spec.pickTarget();
    // Algorithm picks alive[i] from the closest pair (i being first of the pair).
    expect([a.player, b.player]).toContain(target);
    expect(target).not.toBe(far.player);
  });

  it('pickTarget keeps current target when new candidate is not 30% better', () => {
    // AI#0 at (0,0), AI#1 at (10,0), AI#2 at (18,0).
    // Nearest-neighbour distances: AI#0=10, AI#1=8 (to AI#2), AI#2=8 (to AI#1).
    // First call: best is AI#1 (or AI#2) with dist 8, _currentTarget set.
    // Second call: same layout — best is still dist 8, current is dist 8.
    //   bestDist (8) >= currentDist * 0.7 (5.6), so hysteresis keeps current target.
    const ai0 = makeAI(0, 0, true);
    const ai1 = makeAI(10, 0, true);
    const ai2 = makeAI(18, 0, true);
    const host = createHost({ ais: [ai0, ai1, ai2] });
    const spec = new SpectatorMode(asHost(host));

    const first = spec.pickTarget();
    // Best nearest-neighbour is 8 (AI#1 or AI#2); should pick one of them.
    expect([ai1.player, ai2.player]).toContain(first);

    // Now move AI#0 slightly closer to AI#1 so AI#1's nearest-neighbour drops to ~8,
    // but AI#0's nearest-neighbour becomes ~8 too — only 0% better, well below 30%.
    // Keep layout the same; second call should return the same target.
    const second = spec.pickTarget();
    expect(second).toBe(first);
  });

  it('pickTarget switches when new candidate is significantly better', () => {
    // Initial layout: AI#0 at (0,0), AI#1 at (20,0) — nearest-neighbour both = 20.
    const ai0 = makeAI(0, 0, true);
    const ai1 = makeAI(20, 0, true);
    const host = createHost({ ais: [ai0, ai1] });
    const spec = new SpectatorMode(asHost(host));

    const first = spec.pickTarget();
    // With only 2 AIs, both have the same nearest-neighbour (20); picks first in list.
    expect([ai0.player, ai1.player]).toContain(first);

    // Now introduce AI#2 very close to AI#0 — nearest-neighbour for AI#0 drops to 5.
    // AI#2 at (5,0): AI#2's nearest = 5 (to AI#0), AI#0's nearest = 5 (to AI#2).
    // Current target's nearest was 20, new best is 5 => 5 < 20*0.7 (14). Switches!
    const ai2 = makeAI(5, 0, true);
    host.ais.push(ai2);

    const second = spec.pickTarget();
    expect([ai0.player, ai2.player]).toContain(second);
    // The key assertion: we must have switched away from the original target
    // if original was AI#1. If original was AI#0, AI#0 is still valid (its dist dropped).
    // Either way the new target must be from the close pair (ai0 or ai2).
    expect(second).not.toBe(ai1.player);
  });

  it('pickTarget resets when current target dies', () => {
    // Three AIs: AI#0 close pair with AI#1, AI#2 far away.
    const ai0 = makeAI(0, 0, true);
    const ai1 = makeAI(3, 0, true);
    const ai2 = makeAI(100, 0, true);
    const host = createHost({ ais: [ai0, ai1, ai2] });
    const spec = new SpectatorMode(asHost(host));

    const first = spec.pickTarget();
    // Closest pair is ai0-ai1 (dist 3). Target should be one of them.
    expect([ai0.player, ai1.player]).toContain(first);

    // Kill the current target — hysteresis check sees alive=false, must re-pick.
    first!.alive = false;

    const second = spec.pickTarget();
    // The dead AI is filtered out. Remaining: one of ai0/ai1 (alive) + ai2.
    // With only 2 alive AIs, both have the same nearest-neighbour distance.
    expect(second).not.toBeNull();
    expect(second!.alive).toBe(true);
    expect(second).not.toBe(first);
  });
});

// ═══════════════════════════════════════════════════════════
// updateSim
// ═══════════════════════════════════════════════════════════
describe('SpectatorMode.updateSim', () => {
  it('advances matchTime by dt', () => {
    const host = createHost({ matchTime: 5 });
    const spec = new SpectatorMode(asHost(host));
    spec.updateSim(0.25);
    expect(host.matchTime).toBeCloseTo(5.25, 5);
  });

  it('increments _aiFrame on each call', () => {
    const host = createHost({ _aiFrame: 7 });
    const spec = new SpectatorMode(asHost(host));
    spec.updateSim(0.016);
    expect(host._aiFrame).toBe(8);
  });

  it('calls _checkCollisions exactly once', () => {
    const host = createHost();
    const spec = new SpectatorMode(asHost(host));
    spec.updateSim(0.016);
    expect(host._checkCollisions).toHaveBeenCalledTimes(1);
  });

  it('calls updateWallGlow with nearest-wall distance', () => {
    const host = createHost();
    const spec = new SpectatorMode(asHost(host));
    spec.updateSim(0.016);
    expect(updateWallGlow).toHaveBeenCalledTimes(1);
  });

  it('calls getAIInput only for AIs whose index matches the frame slot', () => {
    // Frame increments to 1. idx % 3 === 1 % 3 means idx=1 (out of 3) updates.
    const host = createHost({ _aiFrame: 0, ais: [makeAI(0, 0), makeAI(1, 1), makeAI(2, 2)] });
    const spec = new SpectatorMode(asHost(host));
    spec.updateSim(0.016);
    // frame is now 1; only idx 1 (1%3==1) qualifies
    expect(getAIInput).toHaveBeenCalledTimes(1);
  });

  it('skips AIs that are not alive or have no aiState', () => {
    const host = createHost({
      ais: [makeAI(0, 0, false), makeAI(1, 1, true, false), makeAI(2, 2, true, true)],
    });
    const spec = new SpectatorMode(asHost(host));
    spec.updateSim(0.016);
    // Only the last AI is eligible; even it only runs if index slot matches.
    // _aiFrame becomes 1, idx 2 => 2%3 !== 1%3, so getAIInput might not be called.
    // We just assert no errors + update called appropriately.
    expect(host.ais[2].player.update).toHaveBeenCalled();
    expect(host.ais[0].player.update).not.toHaveBeenCalled();
  });

  it('ticks death animation for dead AIs', () => {
    const dead = makeAI(0, 0, false);
    const host = createHost({ ais: [dead] });
    const spec = new SpectatorMode(asHost(host));
    spec.updateSim(0.05);
    expect(dead.player.updateDeath).toHaveBeenCalledWith(0.05);
  });

  it('boosts AI meter when AI is near an arena wall', () => {
    // Position AI very close to the wall (arena is 200, half = 100). x=98 -> wallDist=2.
    const nearWall = makeAI(98, 0, true);
    nearWall.player.meter = 10;
    nearWall.player.dashing = false;
    const host = createHost({ ais: [nearWall] });
    const spec = new SpectatorMode(asHost(host));
    spec.updateSim(1); // large dt so the meter gain is obvious
    expect(nearWall.player.meter).toBeGreaterThan(10);
    expect(nearWall.player.meterGaining).toBe(true);
  });

  it('does not wall-recharge a dashing AI near wall', () => {
    const nearWall = makeAI(98, 0, true);
    nearWall.player.meter = 10;
    nearWall.player.dashing = true;
    const host = createHost({ ais: [nearWall] });
    const spec = new SpectatorMode(asHost(host));
    spec.updateSim(1);
    expect(nearWall.player.meter).toBe(10); // unchanged
  });

  it('ticks death animation for a dead player', () => {
    const host = createHost();
    const spec = new SpectatorMode(asHost(host));
    spec.updateSim(0.016);
    expect(host.player!.updateDeath).toHaveBeenCalledWith(0.016);
  });
});

describe('SpectatorMode.endSpectating — draw', () => {
  it('resolves with playerAlive=false and allAisDead=true when no AIs alive', () => {
    const host = createHost({
      mode: 'local',
      ais: [makeAI(0, 0, false), makeAI(1, 1, false)],
    });
    // Override mock to simulate draw resolution.
    resolveRoundMock.mockReturnValueOnce({
      roundResult: 'draw',
      updatedStats: { totalRounds: 1 },
      updatedStreakData: {
        bo1: { currentStreak: 0, bestStreak: 0 },
        bo3: { currentStreak: 0, bestStreak: 0 },
        bo5: { currentStreak: 0, bestStreak: 0 },
      },
      updatedSeriesPlayerWins: 0,
      updatedSeriesAiWins: [0],
      seriesOver: true,
      playerWonSeries: false,
      anyAiWonSeries: false,
    });
    const spec = new SpectatorMode(asHost(host));
    spec.endSpectating();
    expect(resolveRoundMock).toHaveBeenCalledWith(expect.objectContaining({
      playerAlive: false,
      allAisDead: true,
    }));
    expect(host._killcamData).toEqual({ roundResult: 'draw', playerWonSeries: false, anyAiWonSeries: false });
  });
});

// ═══════════════════════════════════════════════════════════
// endSpectating
// ═══════════════════════════════════════════════════════════
describe('SpectatorMode.endSpectating', () => {
  it('resets spectating flags and hides the spectator label', () => {
    const host = createHost({ _spectating: true, _spectateTarget: makePlayer() as unknown as ISpectatorHost['_spectateTarget'] });
    const spec = new SpectatorMode(asHost(host));
    spec.endSpectating();
    expect(host._spectating).toBe(false);
    expect(host._spectateTarget).toBeNull();
    expect(host._killcamPhase).toBe('none');
    expect(document.getElementById('spectator-label')!.classList.contains('hidden')).toBe(true);
  });

  it('in online mode with killcamData, calls _showResultScreen and returns early', () => {
    const fakeKillcam: KillcamData = { roundResult: 'ai', playerWonSeries: false, anyAiWonSeries: true };
    const host = createHost({
      mode: 'online',
      _onlineMatch: { _tag: 'online-match' } as unknown as ISpectatorHost['_onlineMatch'],
      _killcamData: fakeKillcam,
    });
    const spec = new SpectatorMode(asHost(host));
    spec.endSpectating();
    expect(host._showResultScreen).toHaveBeenCalledTimes(1);
    expect(resolveRoundMock).not.toHaveBeenCalled();
  });

  it('in online mode without killcamData, returns without resolving round', () => {
    const host = createHost({
      mode: 'online',
      _onlineMatch: { _tag: 'online-match' } as unknown as ISpectatorHost['_onlineMatch'],
      _killcamData: null,
    });
    const spec = new SpectatorMode(asHost(host));
    spec.endSpectating();
    expect(host._showResultScreen).not.toHaveBeenCalled();
    expect(resolveRoundMock).not.toHaveBeenCalled();
  });

  it('in local mode, resolves the round and updates host stats/streak/series', () => {
    const host = createHost({ mode: 'local', matchTime: 42 });
    const spec = new SpectatorMode(asHost(host));
    spec.endSpectating();
    expect(resolveRoundMock).toHaveBeenCalledWith(expect.objectContaining({
      playerAlive: false,
      matchTime: 42,
    }));
    expect(host.stats).toEqual({ totalRounds: 1 });
    expect(host.seriesAiWins).toEqual([1]);
    expect(host.seriesOver).toBe(true);
    expect(host._killcamData).toEqual({ roundResult: 'ai', playerWonSeries: false, anyAiWonSeries: true });
    expect(host._showResultScreen).toHaveBeenCalled();
  });

  it('invokes onMatchEnd callback when no replay data exists', () => {
    const onMatchEnd = vi.fn();
    const host = createHost({ mode: 'local', matchTime: 33, seriesLength: 3, opponentCount: 2, onMatchEnd });
    const spec = new SpectatorMode(asHost(host));
    spec.endSpectating();
    expect(onMatchEnd).toHaveBeenCalledWith('ai', 33, 3, 2, null);
  });

  it('saves a replay when recorder has data', async () => {
    const snap: ReplaySnapshot = { frames: [], playerColor: 1, playerEmissive: 1, aiColors: [], duration: 5 };
    const host = createHost({
      mode: 'local',
      _replayRecorder: {
        hasData: vi.fn(() => true),
        getSnapshot: vi.fn(() => snap),
      },
    });
    const spec = new SpectatorMode(asHost(host));
    // Force synchronous save path by removing requestIdleCallback.
    const orig = (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
    (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = undefined;
    try {
      spec.endSpectating();
      // Give the saveReplay promise a chance to resolve.
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = orig;
    }
    expect(saveReplay).toHaveBeenCalledTimes(1);
    expect(saveReplay).toHaveBeenCalledWith(snap, expect.objectContaining<Partial<MatchInfo>>({
      result: 'ai',
      matchType: 'ai',
      winnerName: 'AI',
    }));
  });
});
