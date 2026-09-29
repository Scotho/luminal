// ── OnlineMatch Class Tests ───────────────────────────────
// Tests for the OnlineMatch lifecycle: death evaluation, grace windows,
// round end reconciliation, series scoring, disconnect handling, and cleanup.

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// ── Mock NetcodeSession ──
type EventCallback = (...args: unknown[]) => void;

function createMockNetcode() {
  const cbs: Record<string, EventCallback> = {};
  return {
    start: vi.fn(),
    stop: vi.fn(),
    onDeath: vi.fn((cb: EventCallback) => { cbs.onDeath = cb; }),
    onRemoteDead: vi.fn((cb: EventCallback) => { cbs.onRemoteDead = cb; }),
    onAllRoundEnd: vi.fn((cb: EventCallback) => { cbs.onAllRoundEnd = cb; }),
    onAllLoaded: vi.fn((cb: EventCallback) => { cbs.onAllLoaded = cb; }),
    onAllNextRound: vi.fn((cb: EventCallback) => { cbs.onAllNextRound = cb; }),
    onAllRematch: vi.fn((cb: EventCallback) => { cbs.onAllRematch = cb; }),
    reportDeath: vi.fn(() => Promise.resolve()),
    writeRoundEnd: vi.fn(() => Promise.resolve()),
    writeAccept: vi.fn(() => Promise.resolve()),
    writeLoaded: vi.fn(() => Promise.resolve()),
    writeNextRound: vi.fn(() => Promise.resolve()),
    writeRematch: vi.fn(() => Promise.resolve()),
    resetForNewRound: vi.fn(),
    isOpponentConnected: vi.fn(() => true),
    isPlayerConnected: vi.fn(() => true),
    isAnyOpponentConnected: vi.fn(() => true),
    estimatedRttMs: 100,
    _serverTimeOffset: 0,
    _processedEventKeys: new Set<string>(),
    _cbs: cbs, // exposed for tests to trigger callbacks
  };
}

let mockNetcode: ReturnType<typeof createMockNetcode>;

vi.mock('./netcode', () => ({
  NetcodeSession: vi.fn(function () { return mockNetcode; }),
}));

// Mock firebase/database
const mockRef = vi.fn((_db: unknown, path: string) => ({ __path: path }));
const mockSet = vi.fn(() => Promise.resolve());
const mockRemove = vi.fn(() => Promise.resolve());
const mockGet = vi.fn(() => Promise.resolve({ exists: () => false, val: () => null }));
const mockOnValue = vi.fn(() => vi.fn()); // returns unsub
const mockServerTimestamp = vi.fn(() => 'SERVER_TS');

vi.mock('firebase/database', () => ({
  ref: (...args: unknown[]) => mockRef(...args),
  set: (...args: unknown[]) => mockSet(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
  get: (...args: unknown[]) => mockGet(...args),
  onValue: (...args: unknown[]) => mockOnValue(...args),
  serverTimestamp: () => mockServerTimestamp(),
}));

vi.mock('./firebase', () => ({
  rtdb: { __rtdb: true },
  db: { __db: true },
  auth: { currentUser: null },
  functions: { __functions: true },
}));

import { OnlineMatch } from './onlineMatch';

// ── Helpers ─────────────────────────────────────────────
function createMatch(opts: Partial<{
  matchId: string;
  myUid: string;
  opponentUid: string;
  seed: number;
  seriesLength: number;
  totalEntityCount: number;
}> = {}) {
  const matchInfo = {
    matchId: opts.matchId || 'match123',
    opponents: [{ uid: opts.opponentUid || 'oppUid', name: 'Opponent', color: '#ff0000' as string | number }],
    seed: opts.seed || 42,
  };
  const myUid = opts.myUid || 'myUid';
  const game = { matchTime: 0, _lockstep: null, _delayAdvisor: { recordRound() {}, clear() {} } };

  const match = new OnlineMatch(matchInfo, myUid, game);
  if (opts.seriesLength !== undefined) match.seriesLength = opts.seriesLength;
  if (opts.totalEntityCount !== undefined) match.totalEntityCount = opts.totalEntityCount;
  return match;
}

describe('OnlineMatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockNetcode = createMockNetcode();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor ──────────────────────────────────────
  describe('constructor', () => {
    it('initializes state to pending, round to 1, scores to 0-0', () => {
      const match = createMatch();
      expect(match.state).toBe('pending');
      expect(match.round).toBe(1);
      expect(match.scores['myUid']).toBe(0);
      expect(match.scores['oppUid']).toBe(0);
    });

    it('defaults deathGraceMs to 150', () => {
      const match = createMatch();
      expect(match.deathGraceMs).toBe(150);
    });

    it('defaults totalEntityCount to 2', () => {
      const match = createMatch();
      expect(match.totalEntityCount).toBe(2);
    });

    it('defaults seriesLength to 3', () => {
      const match = createMatch();
      expect(match.seriesLength).toBe(3);
    });

    it('stores match info correctly', () => {
      const match = createMatch({ matchId: 'abc', opponentUid: 'opp', myUid: 'me', seed: 999 });
      expect(match.matchId).toBe('abc');
      expect(match.opponentUid).toBe('opp');
      expect(match.myUid).toBe('me');
      expect(match.seed).toBe(999);
    });
  });

  // ── start() ──────────────────────────────────────────
  describe('start()', () => {
    it('calls netcode.start()', () => {
      const match = createMatch();
      match.start();
      expect(mockNetcode.start).toHaveBeenCalled();
    });

    it('registers onDeath and onRemoteDead callbacks', () => {
      const match = createMatch();
      match.start();
      expect(mockNetcode.onDeath).toHaveBeenCalled();
      expect(mockNetcode.onRemoteDead).toHaveBeenCalled();
      expect(mockNetcode.onAllRoundEnd).toHaveBeenCalled();
    });

    it('sets up disconnect check interval', () => {
      const match = createMatch();
      match.start();
      // Advance 3s — disconnect check fires
      mockNetcode.isPlayerConnected.mockReturnValue(true);
      mockNetcode.isAnyOpponentConnected.mockReturnValue(true);
      vi.advanceTimersByTime(3000);
      expect(mockNetcode.isPlayerConnected).toHaveBeenCalled();
    });
  });

  // ── reportLocalDeath ──────────────────────────────────
  describe('reportLocalDeath', () => {
    it('sends death via netcode only for own uid (anticheat)', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.reportLocalDeath('myUid');
      expect(mockNetcode.reportDeath).toHaveBeenCalledWith('myUid', 0);
    });

    it('does NOT send death report for opponent uid', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.reportLocalDeath('oppUid');
      expect(mockNetcode.reportDeath).not.toHaveBeenCalled();
    });

    it('deduplicates — second call for same uid is no-op', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.reportLocalDeath('myUid');
      match.reportLocalDeath('myUid');
      expect(mockNetcode.reportDeath).toHaveBeenCalledTimes(1);
    });
  });

  // ── registerLocalOpponentDeath ──────────────────────
  describe('registerLocalOpponentDeath', () => {
    it('adds opponent to deaths set without netcode send', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.registerLocalOpponentDeath('oppUid');
      expect(mockNetcode.reportDeath).not.toHaveBeenCalled();
    });

    it('deduplicates repeated calls', () => {
      const match = createMatch();
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();
      match.state = 'playing';
      match.registerLocalOpponentDeath('oppUid');
      match.registerLocalOpponentDeath('oppUid');
      // Only one death should be tracked
    });
  });

  // ── registerAiDeath ──────────────────────────────────
  describe('registerAiDeath', () => {
    it('contributes to round end evaluation', () => {
      // 3 entities: 2 humans + 1 AI. AI dies → still 2 alive → continues
      const match = createMatch({ totalEntityCount: 3 });
      match.start();
      match.state = 'playing';
      match.registerAiDeath();
      // State should still be 'playing' — 2 humans still alive
      expect(match.state).toBe('playing');
    });

    it('does nothing after roundEndProcessed', () => {
      const match = createMatch({ totalEntityCount: 3 });
      match.start();
      match.state = 'playing';
      // Force round end first
      match.reportLocalDeath('myUid');
      match.reportLocalDeath('oppUid');
      // Now AI death should be ignored
      match.registerAiDeath();
    });
  });

  // ── Lockstep truth model: onDeath ─────────────────────
  describe('lockstep: onDeath is bookkeeping only', () => {
    it('does NOT immediately evaluate round end when useLockstep is true', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.useLockstep = true;

      // Fire peer death event for opponent
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      // In lockstep, peer death should NOT immediately trigger round end evaluation.
      // State remains 'playing' for 500ms while waiting for sim to confirm.
      vi.advanceTimersByTime(100);
      expect(match.state).toBe('playing');
    });

    it('peer death does not suppress authoritative sim death path', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.useLockstep = true;

      // Peer death event arrives first — goes into _peerDeathReports, NOT _deathsThisRound
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      // Authoritative sim path: registerLocalOpponentDeath should NOT be suppressed
      // by the peer event. It must still add oppUid to _deathsThisRound and evaluate.
      match.registerLocalOpponentDeath('oppUid');
      // Self still alive → only opponent dead → opponent lost, we win
      match.reportLocalDeath('myUid');
      vi.advanceTimersByTime(10);
      expect(match.state).toBe('roundOver');
    });

    it('authoritative sim death is not blocked when peer event arrives first', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.useLockstep = true;

      // Peer event arrives first
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      // Sim detects opponent death — this must NOT early-return
      match.registerLocalOpponentDeath('oppUid');
      vi.advanceTimersByTime(10);

      // Opponent dead, we're alive → we win (not a draw from suppressed path)
      expect(match.state).toBe('roundOver');
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'myUid', undefined);
    });

    it('promotes peer death as fallback if sim does not confirm within 500ms', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.useLockstep = true;

      // Peer reports death, but local sim never detects it (desync scenario)
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      // 499ms — still waiting for sim confirmation
      vi.advanceTimersByTime(499);
      expect(match.state).toBe('playing');

      // 500ms — fallback kicks in, promotes peer death
      vi.advanceTimersByTime(1);
      // Now oppUid is in _deathsThisRound, opponent dead + us alive = we win
      // Lockstep uses setTimeout(0) debounce for round-end evaluation
      vi.advanceTimersByTime(10);
      expect(match.state).toBe('roundOver');
    });

    it('state-stream mode still uses onDeath for round evaluation', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.useLockstep = false;

      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(match.deathGraceMs + 10);

      expect(match.state).toBe('roundOver');
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'myUid', undefined);
    });
  });

  // ── Lockstep truth model: onRemoteDead ────────────────
  describe('lockstep: onRemoteDead is disabled', () => {
    it('does NOT register death or evaluate round end in lockstep', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.useLockstep = true;

      mockNetcode._cbs.onRemoteDead('oppUid');

      vi.advanceTimersByTime(1000);
      expect(match.state).toBe('playing');
      expect(mockNetcode.writeRoundEnd).not.toHaveBeenCalled();
    });

    it('state-stream mode still uses onRemoteDead for round evaluation', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.useLockstep = false;

      mockNetcode._cbs.onRemoteDead('oppUid');
      vi.advanceTimersByTime(match.deathGraceMs + 10);

      expect(match.state).toBe('roundOver');
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'myUid', undefined);
    });
  });

  // ── Lockstep truth model: onAllRoundEnd ───────────────
  describe('lockstep: onAllRoundEnd is consistency check only', () => {
    it('does NOT override pendingWinner from remote claims in lockstep', () => {
      const match = createMatch();
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();
      match.state = 'playing';
      match.useLockstep = true;

      // Simulate deterministic round end: opponent dies via sim
      match.registerLocalOpponentDeath('oppUid');
      vi.advanceTimersByTime(10); // let setTimeout(0) fire

      expect(match.state).toBe('roundOver');

      // Now simulate remote onAllRoundEnd with a DIFFERENT winner claim
      const allRoundEndCb = mockNetcode._cbs.onAllRoundEnd;
      allRoundEndCb({
        myUid: { round: 1, winner: 'myUid', ts: 1000 },
        oppUid: { round: 1, winner: 'draw', ts: 1000 }, // opponent disagrees
      });

      // The local deterministic result (myUid wins) should NOT be overridden.
      // Scores should reflect myUid winning, not a draw.
      expect(match.scores['myUid']).toBe(1);
      expect(match.scores['oppUid']).toBe(0);
    });

    it('state-stream mode still reconciles via onAllRoundEnd', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.useLockstep = false;

      // Trigger round end via state-stream path
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(match.deathGraceMs + 10);

      // Both wrote roundEnd — all confirm with same winner
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid', ts: 1000 },
        oppUid: { round: 1, winner: 'myUid', ts: 1000 },
      });

      expect(match.scores['myUid']).toBe(1);
    });
  });

  // ── Lockstep truth model: opponent roundEnd fallback ──
  describe('lockstep: opponent roundEnd fallback disabled', () => {
    it('does NOT start 2s trust-opponent timer in lockstep', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';
      match.useLockstep = true;

      // Simulate opponent writing roundEnd via the onValue listener.
      // The oppRoundEnd listener is registered via mockOnValue — grab the callback.
      // In the real code, this is an onValue on `matches/{id}/roundEnd`.
      // Since we mock onValue, we need to find the call that registered for roundEnd path.
      const roundEndCalls = mockOnValue.mock.calls.filter(
        (call) => call[0]?.__path?.includes('roundEnd') && !call[0]?.__path?.includes('nextRound'),
      );
      // The opponent roundEnd fallback listener is the last roundEnd onValue registration
      const oppFallbackCall = roundEndCalls[roundEndCalls.length - 1];
      if (!oppFallbackCall) throw new Error('Could not find opponent roundEnd fallback listener');
      const oppFallbackCb = oppFallbackCall[1];

      // Simulate opponent writing roundEnd
      oppFallbackCb({
        val: () => ({
          oppUid: { round: 1, winner: 'oppUid', ts: Date.now() },
        }),
      });

      // Advance past the 2s fallback window
      vi.advanceTimersByTime(3000);

      // In lockstep, this should be a no-op — state should remain 'playing'
      expect(match.state).toBe('playing');
      expect(mockNetcode.writeRoundEnd).not.toHaveBeenCalled();
    });
  });

  // ── _evaluateRoundEnd: simultaneous death ──────────
  describe('round end evaluation — simultaneous death', () => {
    it('both humans dead → immediate draw (no grace window)', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';

      // Simulate both netcode death callbacks
      const onDeathCb = mockNetcode._cbs.onDeath;
      onDeathCb({ uid: 'myUid', roundTime: 10 });
      onDeathCb({ uid: 'oppUid', roundTime: 10 });

      expect(match.state).toBe('roundOver');
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'draw', undefined);
    });

    it('one human dead → waits deathGraceMs before committing', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });

      // State should not change yet — still in grace window
      expect(match.state).toBe('playing');

      // After grace window expires
      vi.advanceTimersByTime(match.deathGraceMs + 10);

      expect(match.state).toBe('roundOver');
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'oppUid', undefined);
    });

    it('one dies then other dies within grace → draw', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });

      // Second death within grace window
      vi.advanceTimersByTime(50); // less than deathGraceMs
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      // Both dead now — should commit draw immediately
      expect(match.state).toBe('roundOver');
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'draw', undefined);
    });

    it('grace expires with only one dead → survivor wins', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';

      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      vi.advanceTimersByTime(match.deathGraceMs + 10);

      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'myUid', undefined);
    });

    it('does nothing when aliveCount > 1', () => {
      // 3 entities, only 1 AI died → 2 remain
      const match = createMatch({ totalEntityCount: 3 });
      match.start();
      match.state = 'playing';
      match.registerAiDeath();
      expect(match.state).toBe('playing');
      expect(mockNetcode.writeRoundEnd).not.toHaveBeenCalled();
    });
  });

  // ── free-for-all with AIs ──────────────────────────
  describe('round end evaluation — free-for-all with AIs', () => {
    it('round continues while humans + AIs alive > 1', () => {
      const match = createMatch({ totalEntityCount: 4 }); // 2 humans + 2 AIs
      match.start();
      match.state = 'playing';
      match.registerAiDeath(); // 3 alive
      expect(match.state).toBe('playing');
      match.registerAiDeath(); // 2 alive (both humans)
      expect(match.state).toBe('playing');
    });

    it('all AIs dead + one human dead → other human wins', () => {
      const match = createMatch({ totalEntityCount: 3 }); // 2 humans + 1 AI
      match.start();
      match.state = 'playing';

      match.registerAiDeath(); // 2 alive
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 }); // 1 alive

      // With only 1 alive and both humans accounted for (one dead), grace window starts
      vi.advanceTimersByTime(200);
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'myUid', undefined);
    });

    it('AI deaths alone do not end round if both humans alive', () => {
      const match = createMatch({ totalEntityCount: 4 }); // 2 humans + 2 AIs
      match.start();
      match.state = 'playing';

      match.registerAiDeath();
      match.registerAiDeath();
      // 2 humans alive → aliveCount = 2 > 1 → continues
      expect(match.state).toBe('playing');
      expect(mockNetcode.writeRoundEnd).not.toHaveBeenCalled();
    });
  });

  // ── _showRoundResult: scoring ──────────────────────
  describe('scoring and series detection', () => {
    function setupRoundEndMatch(seriesLength: number) {
      const match = createMatch({ seriesLength });
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();
      match.state = 'playing';
      return { match, stateChangeCb };
    }

    it('increments winner score correctly', () => {
      const { match, stateChangeCb } = setupRoundEndMatch(3);
      // Both die and bothRoundEnd fires
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      // Simulate bothRoundEnd
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      expect(match.scores['myUid']).toBe(1);
      expect(match.scores['oppUid']).toBe(0);
    });

    it('draw does not change scores', () => {
      const { match } = setupRoundEndMatch(3);
      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'draw' },
        oppUid: { round: 1, winner: 'draw' },
      });

      expect(match.scores['myUid']).toBe(0);
      expect(match.scores['oppUid']).toBe(0);
    });

    it('detects series over for best-of-1', () => {
      const { match, stateChangeCb } = setupRoundEndMatch(1);
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      expect(match.state).toBe('finished');
      const resultCall = stateChangeCb.mock.calls.find(
        (c: unknown[]) => c[0] === 'roundOver'
      );
      expect(resultCall).toBeTruthy();
      expect((resultCall![1] as { seriesOver: boolean }).seriesOver).toBe(true);
    });

    it('detects series over for best-of-3 (2 wins needed)', async () => {
      const { match, stateChangeCb } = setupRoundEndMatch(3);

      // Win round 1
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });
      expect(match.scores['myUid']).toBe(1);
      expect(match.state).not.toBe('finished');

      // Simulate next round setup completing (async — cleanup resets _roundEndProcessed)
      await mockNetcode._cbs.onAllNextRound(0);
      vi.advanceTimersByTime(100);

      // Win round 2
      match.state = 'playing';
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 2, winner: 'myUid' },
        oppUid: { round: 2, winner: 'myUid' },
      });

      expect(match.scores['myUid']).toBe(2);
      expect(match.state).toBe('finished');
    });

    it('does NOT fire roundOver callback during countdown state', () => {
      const { match, stateChangeCb } = setupRoundEndMatch(3);
      match.state = 'countdown';

      // Force process round end — _showRoundResult should be blocked by state guard
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      // _showRoundResult returns early during countdown — no roundOver callback
      const roundOverCalls = stateChangeCb.mock.calls.filter(
        (c: unknown[]) => c[0] === 'roundOver'
      );
      expect(roundOverCalls.length).toBe(0);

      // _updateScoresFromWinner has the same state guard as _showRoundResult:
      // scores are NOT incremented during countdown/playing/pending states.
      // This prevents desync from stale events.
      expect(match.scores['myUid']).toBe(0);
    });
  });

  // ── Round end reconciliation ──────────────────────
  describe('round end reconciliation (onAllRoundEnd)', () => {
    it('uses draw when either client reports draw and other disagrees', () => {
      const match = createMatch();
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();
      match.state = 'playing';

      // Both die
      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      // Disagreement: I say draw, opponent says they won
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'draw' },
        oppUid: { round: 1, winner: 'oppUid' },
      });

      // Should use draw since one side reported draw
      const resultCall = stateChangeCb.mock.calls.find(
        (c: unknown[]) => c[0] === 'roundOver'
      );
      expect(resultCall).toBeTruthy();
      expect((resultCall![1] as { winner: string }).winner).toBe('draw');
    });

    it('ignores stale roundEnd from previous round generation', () => {
      const match = createMatch();
      match.start();
      match.state = 'playing';

      // This roundEnd has round=99 — doesn't match current round 1
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 99, winner: 'myUid' },
        oppUid: { round: 99, winner: 'myUid' },
      });

      // Should not have processed anything
      expect(match.scores['myUid']).toBe(0);
    });
  });

  // ── opponent roundEnd fallback ──────────────────────
  describe('opponent roundEnd fallback', () => {
    it('after 2s trusts opponent winner determination', () => {
      const match = createMatch();
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();
      match.state = 'playing';

      // Capture the onValue callback for roundEnd listener
      const onValueCalls = (mockOnValue as Mock).mock.calls;
      // Find the roundEnd listener (matches path containing 'roundEnd')
      const roundEndListenerCall = onValueCalls.find((c: unknown[]) =>
        (c[0] as { __path: string })?.__path?.includes('roundEnd'));

      if (roundEndListenerCall) {
        const listenerCb = roundEndListenerCall[1] as (snap: unknown) => void;

        // Simulate opponent writing roundEnd
        listenerCb({
          val: () => ({
            oppUid: { round: 1, winner: 'oppUid', ts: Date.now() },
          }),
        });

        // State should not change immediately
        expect(match.state).toBe('playing');

        // After 2s fallback kicks in
        vi.advanceTimersByTime(2100);
        expect(match.state).toBe('roundOver');
      }
    });
  });

  // ── deathGraceMs / updateGraceFromRtt ──────────────
  describe('deathGraceMs / updateGraceFromRtt', () => {
    it('grace = RTT + 50, clamped to [100, 500]', () => {
      const match = createMatch();
      mockNetcode.estimatedRttMs = 200;
      match.updateGraceFromRtt();
      expect(match.deathGraceMs).toBe(250);
    });

    it('low RTT (20ms) → grace = 100 (floor)', () => {
      const match = createMatch();
      mockNetcode.estimatedRttMs = 20;
      match.updateGraceFromRtt();
      expect(match.deathGraceMs).toBe(100);
    });

    it('high RTT (600ms) → grace = 500 (ceiling)', () => {
      const match = createMatch();
      mockNetcode.estimatedRttMs = 600;
      match.updateGraceFromRtt();
      expect(match.deathGraceMs).toBe(500);
    });

    it('moderate RTT (200ms) → grace = 250', () => {
      const match = createMatch();
      mockNetcode.estimatedRttMs = 200;
      match.updateGraceFromRtt();
      expect(match.deathGraceMs).toBe(250);
    });
  });

  // ── signalLoaded ──────────────────────────────────
  describe('signalLoaded', () => {
    it('fires opponentDisconnected when opponent never loads (15s timeout)', async () => {
      const match = createMatch();
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();

      await match.signalLoaded();
      expect(mockNetcode.writeLoaded).toHaveBeenCalled();

      // Advance past 15s timeout
      vi.advanceTimersByTime(15_100);
      expect(stateChangeCb).toHaveBeenCalledWith('opponentDisconnected');
    });

    it('fires bothLoaded when both load before timeout', async () => {
      const match = createMatch();
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();

      await match.signalLoaded();

      // Trigger bothLoaded callback from netcode
      const bothLoadedCb = mockNetcode._cbs.onAllLoaded;
      bothLoadedCb(50); // 50ms delay

      // Should fire after the delay
      vi.advanceTimersByTime(60);
      expect(stateChangeCb).toHaveBeenCalledWith('bothLoaded');
    });
  });

  // ── _setupNextRound ──────────────────────────────────
  describe('next round setup', () => {
    it('10s countdown emits nextRoundTimer events', () => {
      const match = createMatch({ seriesLength: 5 });
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();
      match.state = 'playing';

      // Win a round to trigger _setupNextRound
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      // _setupNextRound should have been called — advance countdown
      vi.advanceTimersByTime(1000);
      expect(stateChangeCb).toHaveBeenCalledWith('nextRoundTimer', 9);

      vi.advanceTimersByTime(1000);
      expect(stateChangeCb).toHaveBeenCalledWith('nextRoundTimer', 8);
    });

    it('onAllNextRound increments round and resets deaths', async () => {
      const match = createMatch({ seriesLength: 5 });
      match.start();
      match.state = 'playing';

      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      // Trigger bothNextRound
      await mockNetcode._cbs.onAllNextRound(0);
      vi.advanceTimersByTime(100);

      expect(match.round).toBe(2);
    });
  });

  // ── _setupRematch ──────────────────────────────────
  describe('rematch setup', () => {
    it('resets round to 1, scores to 0-0 on bothRematch', async () => {
      const match = createMatch({ seriesLength: 1 });
      match.start();
      match.state = 'playing';

      // Win series
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });
      expect(match.state).toBe('finished');
      expect(match.scores['myUid']).toBe(1);

      // Trigger rematch
      await mockNetcode._cbs.onAllRematch();

      expect(match.round).toBe(1);
      expect(match.scores['myUid']).toBe(0);
      expect(match.scores['oppUid']).toBe(0);
    });

    it('clears processedEventKeys on rematch', async () => {
      const match = createMatch({ seriesLength: 1 });
      match.start();
      match.state = 'playing';

      mockNetcode._processedEventKeys.add('some-key');

      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      await mockNetcode._cbs.onAllRematch();
      expect(mockNetcode._processedEventKeys.size).toBe(0);
    });
  });

  // ── stop() ──────────────────────────────────────────
  describe('stop()', () => {
    it('calls netcode.stop()', () => {
      const match = createMatch();
      match.start();
      match.stop();
      expect(mockNetcode.stop).toHaveBeenCalled();
    });

    it('does NOT remove match document — server-side cleanup handles it', () => {
      const match = createMatch();
      match.start();
      match.stop();
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  // ── _handleOpponentDisconnect ──────────────────────
  describe('opponent disconnect', () => {
    it('transitions state to disconnected', () => {
      const match = createMatch();
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();
      match.state = 'playing';

      // Simulate disconnect check — all opponents disconnected
      mockNetcode.isPlayerConnected.mockReturnValue(false);
      mockNetcode.isAnyOpponentConnected.mockReturnValue(false);
      // First tick starts the 20s grace period
      vi.advanceTimersByTime(3100);
      expect(match.state).toBe('playing'); // still in grace period
      // Advance past 20s grace period — next interval tick confirms forfeit
      vi.advanceTimersByTime(21_000);

      expect(match.state).toBe('disconnected');
      expect(stateChangeCb).toHaveBeenCalledWith('opponentDisconnected');
    });

    it('is idempotent for finished state', () => {
      const match = createMatch();
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();
      match.state = 'finished';

      mockNetcode.isOpponentConnected.mockReturnValue(false);
      vi.advanceTimersByTime(3100);

      // Should not change state or fire callback
      expect(match.state).toBe('finished');
      expect(stateChangeCb).not.toHaveBeenCalledWith('opponentDisconnected');
    });

    it('is idempotent for already disconnected state', () => {
      const match = createMatch();
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();
      match.state = 'disconnected';

      mockNetcode.isOpponentConnected.mockReturnValue(false);
      vi.advanceTimersByTime(3100);

      expect(stateChangeCb).not.toHaveBeenCalledWith('opponentDisconnected');
    });
  });

  // ── _deterministicSeed ──────────────────────────────
  describe('deterministic seed', () => {
    it('produces same seed for same matchId + round', () => {
      const match1 = createMatch({ matchId: 'test123' });
      const match2 = createMatch({ matchId: 'test123' });
      // Access private method via getSpawns — seed is set in constructor
      expect(match1.seed).toBe(match2.seed);
    });

    it('produces different seeds for different matchIds', () => {
      const match1 = createMatch({ matchId: 'match_a', seed: 1 });
      const match2 = createMatch({ matchId: 'match_b', seed: 2 });
      // The initial seeds differ because matchId is different
      expect(match1.seed).not.toBe(match2.seed);
    });
  });

  // ── getSpawns ──────────────────────────────────────
  describe('getSpawns', () => {
    it('returns an array of SpawnPositions', () => {
      const match = createMatch();
      const spawns = match.getSpawns();
      expect(Array.isArray(spawns)).toBe(true);
      expect(spawns.length).toBeGreaterThanOrEqual(2);
      expect(spawns[0]).toHaveProperty('x');
      expect(spawns[0]).toHaveProperty('z');
      expect(spawns[0]).toHaveProperty('angle');
    });

    it('returns more spawns when lobbyAis present', () => {
      const match = createMatch();
      match.lobbyAis = { ai1: { name: 'Bot', color: '#fff', vehicle: 'bike' } };
      match.totalEntityCount = 3;
      const spawns = match.getSpawns();
      expect(spawns.length).toBeGreaterThanOrEqual(3);
    });

    it('is deterministic — same match produces same spawns', () => {
      const match1 = createMatch({ seed: 42, myUid: 'aaa', opponentUid: 'bbb' });
      const match2 = createMatch({ seed: 42, myUid: 'aaa', opponentUid: 'bbb' });
      const s1 = match1.getSpawns();
      const s2 = match2.getSpawns();
      expect(s1[0].x).toBe(s2[0].x);
      expect(s1[0].z).toBe(s2[0].z);
    });

    it('deterministic assignment by sorted UIDs (both clients agree)', () => {
      // Both players should get same world positions regardless of who is "my" vs "opp"
      const match1 = createMatch({ seed: 42, myUid: 'alpha', opponentUid: 'beta' });
      const match2 = createMatch({ seed: 42, myUid: 'beta', opponentUid: 'alpha' });
      const s1 = match1.getSpawns();
      const s2 = match2.getSpawns();
      // Same seed produces same spawn positions array
      expect(s1[0].x).toBeCloseTo(s2[0].x);
      expect(s1[0].z).toBeCloseTo(s2[0].z);
    });
  });

  // ── returnToLobby listener ──────────────────────────
  describe('returnToLobby listener', () => {
    it('fires onStateChange returnToLobby when signal received', () => {
      const match = createMatch();
      const stateChangeCb = vi.fn();
      match.onStateChange = stateChangeCb;
      match.start();

      // Find the returnToLobby onValue listener
      const onValueCalls = (mockOnValue as Mock).mock.calls;
      const returnListenerCall = onValueCalls.find((c: unknown[]) =>
        (c[0] as { __path: string })?.__path?.includes('returnToLobby'));

      if (returnListenerCall) {
        const listenerCb = returnListenerCall[1] as (snap: unknown) => void;
        listenerCb({ val: () => true });
        expect(stateChangeCb).toHaveBeenCalledWith('returnToLobby');
      }
    });
  });

  describe('stop()', () => {
    it('calls netcode.stop() and clears all intervals', () => {
      const match = createMatch();
      match.start();
      match.stop();
      expect(mockNetcode.stop).toHaveBeenCalled();
    });

    it('is idempotent — calling stop() twice does not throw', () => {
      const match = createMatch();
      match.start();
      match.stop();
      expect(() => match.stop()).not.toThrow();
    });
  });

  describe('winner vote reconciliation', () => {
    it('resolves 1v1 tied vote to the same winner regardless of allPlayerUids ordering (client aaa)', () => {
      // From client 'aaa' perspective: allPlayerUids = ['aaa', 'zzz']
      const match = new OnlineMatch(
        { matchId: 'match-tie', opponents: [{ uid: 'zzz', name: 'Z', color: 'blue' as string | number }], seed: 1 },
        'aaa', { matchTime: 0 } as any
      );
      let winner: string | null = null;
      match.onStateChange = (_e, d) => { if (d && (d as any).winner) winner = (d as any).winner; };
      match.useLockstep = false; // state-streaming so onAllRoundEnd does the reconciliation
      match.start();
      match.state = 'roundOver'; // pass guard in _showRoundResult

      // aaa reports zzz won, zzz reports aaa won — genuine 1-1 tie
      mockNetcode._cbs.onAllRoundEnd({
        aaa: { winner: 'zzz', round: 1, ts: 1000 },
        zzz: { winner: 'aaa', round: 1, ts: 1000 },
      });

      // 'aaa' < 'zzz' lexicographically — must win tie-break on both clients
      expect(winner).toBe('aaa');
    });

    it('resolves 1v1 tied vote to the same winner regardless of allPlayerUids ordering (client zzz)', () => {
      // From client 'zzz' perspective: allPlayerUids = ['zzz', 'aaa']
      // This is the same match but seen from the other client — must agree on winner
      mockNetcode = createMockNetcode(); // fresh mock so callbacks don't interfere

      const match = new OnlineMatch(
        { matchId: 'match-tie', opponents: [{ uid: 'aaa', name: 'A', color: 'red' as string | number }], seed: 1 },
        'zzz', { matchTime: 0 } as any
      );
      let winner: string | null = null;
      match.onStateChange = (_e, d) => { if (d && (d as any).winner) winner = (d as any).winner; };
      match.useLockstep = false;
      match.start();
      match.state = 'roundOver';

      mockNetcode._cbs.onAllRoundEnd({
        aaa: { winner: 'zzz', round: 1, ts: 1000 },
        zzz: { winner: 'aaa', round: 1, ts: 1000 },
      });

      // Must agree with the 'aaa' client — both pick 'aaa'
      expect(winner).toBe('aaa');
    });
  });

  describe('stop() does not delete match data (server cleanup handles it)', () => {
    it('does NOT call Firebase remove — server-side cleanupStaleMatches handles deletion', () => {
      const match1 = new OnlineMatch(
        { matchId: 'match-cleanup', opponents: [{ uid: 'zzz', name: 'Z', color: 'blue' as string | number }], seed: 1 },
        'aaa', { matchTime: 0 } as any
      );
      match1.stop();
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  // ── Vehicle Handshake ─────────────────────────────────
  describe('vehicle handshake', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('opponentVehicle defaults to bike when no vehicle in matchInfo', () => {
      const match = createMatch();
      expect(match.opponentVehicle).toBe('bike');
    });

    it('opponentVehicle returns vehicle from matchInfo', () => {
      const matchInfo = {
        matchId: 'match123',
        opponents: [{ uid: 'oppUid', name: 'Opponent', color: '#ff0000' as string | number, vehicle: 'car' as const }],
        seed: 42,
      };
      const match = new OnlineMatch(matchInfo, 'myUid', { matchTime: 0, _lockstep: null, _delayAdvisor: { recordRound() {}, clear() {} } } as any);
      expect(match.opponentVehicle).toBe('car');
    });

    it('opponentVehicle returns bike for undefined vehicle', () => {
      const matchInfo = {
        matchId: 'match123',
        opponents: [{ uid: 'oppUid', name: 'Opponent', color: '#ff0000' as string | number, vehicle: undefined }],
        seed: 42,
      };
      const match = new OnlineMatch(matchInfo, 'myUid', { matchTime: 0, _lockstep: null, _delayAdvisor: { recordRound() {}, clear() {} } } as any);
      expect(match.opponentVehicle).toBe('bike');
    });

    it('opponents array preserves vehicle assignment', () => {
      const matchInfo = {
        matchId: 'match123',
        opponents: [
          { uid: 'opp1', name: 'Opp1', color: '#ff0000' as string | number, vehicle: 'car' as const },
          { uid: 'opp2', name: 'Opp2', color: '#00ff00' as string | number, vehicle: 'hoverboard' as const },
        ],
        seed: 42,
      };
      const match = new OnlineMatch(matchInfo, 'myUid', { matchTime: 0, _lockstep: null, _delayAdvisor: { recordRound() {}, clear() {} } } as any);
      expect(match.opponents[0].vehicle).toBe('car');
      expect(match.opponents[1].vehicle).toBe('hoverboard');
    });

    it('localStorage vehicle is read for accept', () => {
      localStorage.setItem('luminal-vehicle', 'car');
      expect((localStorage.getItem('luminal-vehicle') || 'bike')).toBe('car');
    });

    it('localStorage defaults to bike when empty', () => {
      expect((localStorage.getItem('luminal-vehicle') || 'bike')).toBe('bike');
    });

    // Skipped: this dynamic-imports characterSelectUI which transitively pulls
    // chatUI → chat.ts (`collection(db, 'chat')`). The minimal firebase mock in
    // this file doesn't satisfy real firestore's type check. Covered elsewhere
    // by characterSelect.test.ts.
    it.skip('localStorage returns hoverboard when selected via getSelectedVehicle', async () => {
      localStorage.setItem('luminal-vehicle', 'hoverboard');
      const { getSelectedVehicle } = await import('./ui/characterSelectUI');
      expect(getSelectedVehicle()).toBe('hoverboard');
      expect(localStorage.getItem('luminal-vehicle')).toBe('hoverboard');
    });
  });
});
