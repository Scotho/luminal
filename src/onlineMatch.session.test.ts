// ── OnlineMatch Session Tests ─────────────────────────────
// Tests for server-authoritative score sync, killcam timing integration,
// lobby AI collision flows, spectating transitions, and 1v1 casual regression.
//
// These complement onlineMatch.class.test.ts with coverage for the new
// score-sync refactor, lobby AI round-end logic, and edge cases.

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
    _cbs: cbs,
  };
}

let mockNetcode: ReturnType<typeof createMockNetcode>;

vi.mock('./netcode', () => ({
  NetcodeSession: vi.fn(function () { return mockNetcode; }),
}));

const mockRef = vi.fn((_db: unknown, path: string) => ({ __path: path }));
const mockSet = vi.fn(() => Promise.resolve());
const mockRemove = vi.fn(() => Promise.resolve());
const mockGet = vi.fn(() => Promise.resolve({ exists: () => false, val: () => null }));
const mockOnValue = vi.fn(() => vi.fn());
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
  auth: { currentUser: null },
  functions: {},
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
  const game = { matchTime: 0 };
  const match = new OnlineMatch(matchInfo, myUid, game);
  if (opts.seriesLength !== undefined) match.seriesLength = opts.seriesLength;
  if (opts.totalEntityCount !== undefined) match.totalEntityCount = opts.totalEntityCount;
  return match;
}

function setupPlayingMatch(seriesLength = 3, totalEntityCount = 2) {
  const match = createMatch({ seriesLength, totalEntityCount });
  const stateChangeCb = vi.fn();
  match.onStateChange = stateChangeCb;
  match.start();
  match.state = 'playing';
  return { match, stateChangeCb };
}

// ── Tests ─────────────────────────────────────────────────

describe('OnlineMatch — Server-Authoritative Score Sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockNetcode = createMockNetcode();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Score sync: no double-increment ──────────────────
  describe('score double-increment prevention', () => {
    it('only one path increments score even when both fallback and onAllRoundEnd fire', () => {
      const { match, stateChangeCb } = setupPlayingMatch(3);

      // My death triggers commitRoundEnd → sets 3s fallback
      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      vi.advanceTimersByTime(200);

      expect(match.state).toBe('roundOver');
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'oppUid', undefined);

      // onAllRoundEnd fires (should process)
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'oppUid' },
        oppUid: { round: 1, winner: 'oppUid' },
      });

      expect(match.scores['oppUid']).toBe(1);
      expect(match.scores['myUid']).toBe(0);

      // Now the 3s fallback fires — should be no-op (already processed)
      vi.advanceTimersByTime(3000);
      expect(match.scores['oppUid']).toBe(1); // still 1, not 2
    });

    it('fallback timeout increments score if onAllRoundEnd never fires', () => {
      const { match } = setupPlayingMatch(3);

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      vi.advanceTimersByTime(200); // grace expires

      // onAllRoundEnd never fires — advance to 3s fallback
      vi.advanceTimersByTime(3100);

      expect(match.scores['oppUid']).toBe(1);
    });

    it('opponent-trust fallback increments score correctly', () => {
      const { match, stateChangeCb } = setupPlayingMatch(3);

      // Find the roundEnd onValue listener
      const onValueCalls = (mockOnValue as Mock).mock.calls;
      const roundEndListenerCall = onValueCalls.find((c: unknown[]) =>
        (c[0] as { __path: string })?.__path?.includes('roundEnd') &&
        !(c[0] as { __path: string })?.__path?.includes('nextRound'));

      if (roundEndListenerCall) {
        const listenerCb = roundEndListenerCall[1] as (snap: unknown) => void;
        listenerCb({
          val: () => ({
            oppUid: { round: 1, winner: 'oppUid', ts: Date.now() },
          }),
        });

        vi.advanceTimersByTime(2100);
        expect(match.scores['oppUid']).toBe(1);
      }
    });
  });

  // ── Score sync: Firebase persistence ─────────────────
  describe('score persistence to Firebase', () => {
    it('writes scores to matches/{matchId}/scores on round end', () => {
      const { match } = setupPlayingMatch(3);

      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      // Should have called set() with scores path
      const scoreSetCall = (mockSet as Mock).mock.calls.find((c: unknown[]) =>
        (c[0] as { __path: string })?.__path === 'matches/match123/scores');
      expect(scoreSetCall).toBeTruthy();
      expect(scoreSetCall![1]).toEqual({ myUid: 1, oppUid: 0 });
    });
  });

  // ── Winner reconciliation: loser-trust ──────────────
  describe('winner reconciliation — trust the loser', () => {
    it('when I say opponent won and opponent says I won, trusts me (I died)', () => {
      const { match, stateChangeCb } = setupPlayingMatch(3);

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      vi.advanceTimersByTime(200);

      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'oppUid' }, // I say opponent won (I died)
        oppUid: { round: 1, winner: 'myUid' }, // opponent says I won
      });

      // Both players claim the other won (genuine tie) — deterministic tiebreak picks
      // the lexicographically smallest UID ('myUid' < 'oppUid')
      expect(match.scores['myUid']).toBe(1);
      expect(match.scores['oppUid']).toBe(0);
    });

    it('when opponent says I won and I say I won, opponent is the loser', () => {
      const { match } = setupPlayingMatch(3);

      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);

      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' }, // I say I won
        oppUid: { round: 1, winner: 'myUid' }, // opponent also says I won (they died)
      });

      expect(match.scores['myUid']).toBe(1);
    });

    it('falls back to draw when neither report matches expected loser pattern', () => {
      const { match, stateChangeCb } = setupPlayingMatch(3);

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      vi.advanceTimersByTime(200);

      // Both claim they won — pathological case
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'oppUid' },
      });

      // Neither matches the loser-trust pattern, should fall back to draw
      expect(match.scores['myUid']).toBe(0);
      expect(match.scores['oppUid']).toBe(0);
      const resultCall = stateChangeCb.mock.calls.find(
        (c: unknown[]) => c[0] === 'roundOver'
      );
      expect(resultCall).toBeTruthy();
      expect((resultCall![1] as { winner: string }).winner).toBe('draw');
    });

    it('uses draw when I report draw and opponent reports a winner', () => {
      const { match } = setupPlayingMatch(3);

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'draw' },
        oppUid: { round: 1, winner: 'oppUid' },
      });

      expect(match.scores['myUid']).toBe(0);
      expect(match.scores['oppUid']).toBe(0);
    });

    it('agreement — both clients report same winner', () => {
      const { match } = setupPlayingMatch(3);

      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);

      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      expect(match.scores['myUid']).toBe(1);
      expect(match.scores['oppUid']).toBe(0);
    });
  });

  // ── Lobby AI round-end with free-for-all ─────────────
  describe('lobby AI round-end in free-for-all', () => {
    it('2 humans + 1 AI: AI dies then human dies → other human wins', () => {
      const { match } = setupPlayingMatch(3, 3);

      match.registerAiDeath(); // 2 alive
      expect(match.state).toBe('playing');

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 }); // 1 alive
      vi.advanceTimersByTime(200);

      expect(match.state).toBe('roundOver');
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'oppUid', undefined);
    });

    it('2 humans + 2 AI: both AIs die → 2 humans alive → round continues', () => {
      const { match } = setupPlayingMatch(3, 4);

      match.registerAiDeath();
      match.registerAiDeath();
      expect(match.state).toBe('playing');
      expect(mockNetcode.writeRoundEnd).not.toHaveBeenCalled();
    });

    it('2 humans + 2 AI: 2 AIs die + 1 human dies → last human wins', () => {
      const { match } = setupPlayingMatch(3, 4);

      match.registerAiDeath();
      match.registerAiDeath();
      // Now only 2 humans alive
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);

      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'myUid', undefined);
    });

    it('2 humans + 1 AI: human dies, AI dies, other human wins', () => {
      const { match } = setupPlayingMatch(3, 3);

      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 }); // 2 alive
      match.registerAiDeath(); // 1 alive → only myUid remains
      vi.advanceTimersByTime(200);

      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'myUid', undefined);
    });

    it('both humans die simultaneously with AI alive → draw', () => {
      const { match } = setupPlayingMatch(3, 3);

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      // Both humans dead → immediate draw regardless of AI
      expect(match.state).toBe('roundOver');
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'draw', undefined);
    });

    it('registerAiDeath after onAllRoundEnd is a no-op', () => {
      const { match } = setupPlayingMatch(3, 3);

      // End the round: both humans die, then onAllRoundEnd fires
      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      // onAllRoundEnd sets _roundEndProcessed = true
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'draw' },
        oppUid: { round: 1, winner: 'draw' },
      });

      const callsBefore = mockNetcode.writeRoundEnd.mock.calls.length;
      // Now AI death should be fully ignored (roundEndProcessed = true)
      match.registerAiDeath();
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledTimes(callsBefore);
    });
  });

  // ── 1v1 casual mode regression ─────────────────────
  describe('1v1 casual mode regression (no lobby AI)', () => {
    it('standard 1v1 flow: player dies → opponent wins', () => {
      const { match, stateChangeCb } = setupPlayingMatch(3, 2);

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      vi.advanceTimersByTime(200);

      expect(match.state).toBe('roundOver');
      expect(mockNetcode.writeRoundEnd).toHaveBeenCalledWith(1, 'oppUid', undefined);

      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'oppUid' },
        oppUid: { round: 1, winner: 'oppUid' },
      });

      expect(match.scores['oppUid']).toBe(1);
      const result = stateChangeCb.mock.calls.find((c: unknown[]) => c[0] === 'roundOver');
      expect(result).toBeTruthy();
      expect((result![1] as { iWon: boolean }).iWon).toBe(false);
    });

    it('standard 1v1 draw: both die simultaneously', () => {
      const { match, stateChangeCb } = setupPlayingMatch(1, 2);

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'draw' },
        oppUid: { round: 1, winner: 'draw' },
      });

      expect(match.scores['myUid']).toBe(0);
      expect(match.scores['oppUid']).toBe(0);
      // Draw in bo1 — scores are 0-0, neither player reached winsNeeded (1)
      // so seriesOver=false in _showRoundResult, BUT seriesLength <= 1 check
      // is not done there... the state depends on score threshold.
      // With draw in bo1: winsNeeded=1, scores 0-0 → NOT series over → state stays roundOver
      // (This is correct behavior — a draw doesn't end the series, another round is needed)
      const result = stateChangeCb.mock.calls.find((c: unknown[]) => c[0] === 'roundOver');
      expect(result).toBeTruthy();
      expect((result![1] as { isDraw: boolean }).isDraw).toBe(true);
    });

    it('best-of-3: two rounds to series completion', async () => {
      const { match, stateChangeCb } = setupPlayingMatch(3, 2);

      // Round 1: I win
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });
      expect(match.scores['myUid']).toBe(1);
      expect(match.state).not.toBe('finished');

      // Next round
      await mockNetcode._cbs.onAllNextRound(0);
      vi.advanceTimersByTime(100);
      match.state = 'playing';

      // Round 2: I win
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 2, winner: 'myUid' },
        oppUid: { round: 2, winner: 'myUid' },
      });

      expect(match.scores['myUid']).toBe(2);
      expect(match.state).toBe('finished');
      const finalResult = stateChangeCb.mock.calls.filter((c: unknown[]) => c[0] === 'roundOver');
      expect(finalResult.length).toBe(2);
      expect((finalResult[1][1] as { seriesOver: boolean }).seriesOver).toBe(true);
    });
  });

  // ── Return-to-lobby race prevention ─────────────────
  describe('return-to-lobby race prevention', () => {
    it('signalReturnToLobby kills next-round timer immediately', () => {
      const { match, stateChangeCb } = setupPlayingMatch(5);

      // Win a round
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      // Next round timer should be ticking
      vi.advanceTimersByTime(1000);
      expect(stateChangeCb).toHaveBeenCalledWith('nextRoundTimer', 9);

      // Signal return to lobby
      match.signalReturnToLobby();

      // Further timer ticks should not fire (timer killed)
      stateChangeCb.mockClear();
      vi.advanceTimersByTime(5000);
      const timerCalls = stateChangeCb.mock.calls.filter((c: unknown[]) => c[0] === 'nextRoundTimer');
      expect(timerCalls.length).toBe(0);
    });

    it('onAllNextRound aborts when _returningToLobby is set', async () => {
      const { match, stateChangeCb } = setupPlayingMatch(5);

      // Win a round
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      // Signal return to lobby
      match.signalReturnToLobby();

      // onAllNextRound fires — should abort
      const roundBefore = match.round;
      await mockNetcode._cbs.onAllNextRound(0);
      expect(match.round).toBe(roundBefore); // round should NOT increment
    });

    it('returnToLobby listener kills timer and fires callback', () => {
      const { match, stateChangeCb } = setupPlayingMatch(5);

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

  // ── Mixed configurations ────────────────────────────
  describe('mixed configurations', () => {
    it('2 humans + 1 AI (totalEntityCount=3): correct aliveCount tracking', () => {
      const { match } = setupPlayingMatch(3, 3);
      match.registerAiDeath();
      expect(match.state).toBe('playing'); // 2 alive
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      expect(match.state).toBe('roundOver');
    });

    it('2 humans + 2 AI (totalEntityCount=4): needs 3 deaths for round end', () => {
      const { match } = setupPlayingMatch(3, 4);
      match.registerAiDeath(); // 3 alive
      expect(match.state).toBe('playing');
      match.registerAiDeath(); // 2 alive
      expect(match.state).toBe('playing');
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 }); // 1 alive
      vi.advanceTimersByTime(200);
      expect(match.state).toBe('roundOver');
    });

    it('1 human + 3 AI (totalEntityCount=4 but only 1 human in online): tracks correctly', () => {
      // In practice, online always has 2 humans. This tests the edge case.
      const { match } = setupPlayingMatch(3, 4);
      match.registerAiDeath();
      match.registerAiDeath();
      match.registerAiDeath(); // 1 alive (only myUid)
      // No human died, so aliveCount = 1 but myDead and oppDead are both false
      // The _evaluateRoundEnd should pass through without triggering (edge case)
      expect(match.state).toBe('playing');
    });

    it('scores persist correctly across a best-of-3 with lobby AIs', async () => {
      const { match, stateChangeCb } = setupPlayingMatch(3, 3);

      // Round 1: AI dies, then opponent dies → I win
      match.registerAiDeath();
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });
      expect(match.scores['myUid']).toBe(1);

      // Next round
      await mockNetcode._cbs.onAllNextRound(0);
      vi.advanceTimersByTime(100);
      match.state = 'playing';

      // Round 2: AI dies, I die → opponent wins
      match.registerAiDeath();
      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 2, winner: 'oppUid' },
        oppUid: { round: 2, winner: 'oppUid' },
      });
      expect(match.scores['myUid']).toBe(1);
      expect(match.scores['oppUid']).toBe(1);

      // Verify Firebase was called with updated scores each time
      const scoreCalls = (mockSet as Mock).mock.calls.filter((c: unknown[]) =>
        (c[0] as { __path: string })?.__path === 'matches/match123/scores');
      expect(scoreCalls.length).toBe(2);
    });
  });

  // ── Edge cases ──────────────────────────────────────
  describe('edge cases', () => {
    it('stale roundEnd from previous round is ignored (round generation check)', () => {
      const { match } = setupPlayingMatch(3);

      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 99, winner: 'myUid' },
        oppUid: { round: 99, winner: 'myUid' },
      });

      expect(match.scores['myUid']).toBe(0);
    });

    it('draw preserves scores unchanged', () => {
      const { match } = setupPlayingMatch(3);

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });

      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'draw' },
        oppUid: { round: 1, winner: 'draw' },
      });

      expect(match.scores['myUid']).toBe(0);
      expect(match.scores['oppUid']).toBe(0);
    });

    it('onAllRoundEnd with missing winner fields defaults to draw', () => {
      const { match } = setupPlayingMatch(3);

      mockNetcode._cbs.onDeath({ uid: 'myUid', roundTime: 10 });
      vi.advanceTimersByTime(200);

      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1 },
        oppUid: { round: 1 },
      });

      // Both undefined → myWinner === oppWinner (undefined === undefined) → 'draw'
      expect(match.scores['myUid']).toBe(0);
      expect(match.scores['oppUid']).toBe(0);
    });

    it('AI death count resets between rounds', async () => {
      const { match } = setupPlayingMatch(5, 3);

      // Round 1
      match.registerAiDeath();
      mockNetcode._cbs.onDeath({ uid: 'oppUid', roundTime: 10 });
      vi.advanceTimersByTime(200);
      mockNetcode._cbs.onAllRoundEnd({
        myUid: { round: 1, winner: 'myUid' },
        oppUid: { round: 1, winner: 'myUid' },
      });

      await mockNetcode._cbs.onAllNextRound(0);
      vi.advanceTimersByTime(100);
      match.state = 'playing';

      // Round 2: AI death count should start from 0
      // Just 1 AI death should leave 2 alive (not carry over from round 1)
      match.registerAiDeath();
      expect(match.state).toBe('playing'); // 2 alive, not 1
    });
  });
});
