/**
 * Tests for verifyRankedRound — ranked digest verification.
 *
 * Verifies that state digests from both clients are cross-checked
 * before arbitrating ranked match results.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state (available inside vi.mock factories) ──

const {
  mockRtdbData, mockRefSet, mockDatabase,
} = vi.hoisted(() => {
  const mockRtdbData: Record<string, unknown> = {};

  function getNestedValue(path: string): unknown {
    const segments = path.split('/').filter(Boolean);
    let current: unknown = mockRtdbData;
    for (const seg of segments) {
      if (current == null || typeof current !== 'object') return null;
      current = (current as Record<string, unknown>)[seg];
    }
    return current ?? null;
  }

  function setNestedValue(path: string, value: unknown): void {
    const segments = path.split('/').filter(Boolean);
    let current = mockRtdbData as Record<string, unknown>;
    for (let i = 0; i < segments.length - 1; i++) {
      if (!current[segments[i]] || typeof current[segments[i]] !== 'object') {
        current[segments[i]] = {};
      }
      current = current[segments[i]] as Record<string, unknown>;
    }
    current[segments[segments.length - 1]] = value;
  }

  const mockRefSetInner = vi.fn(async (_val: unknown) => {});

  function createMockRefForPath(path: string): Record<string, unknown> {
    return {
      get: vi.fn(async () => {
        const val = getNestedValue(path);
        return { val: () => val, exists: () => val !== null && val !== undefined };
      }),
      set: vi.fn(async (val: unknown) => {
        setNestedValue(path, val);
        mockRefSetInner(val);
      }),
      update: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      child: (childPath: string) => createMockRefForPath(`${path}/${childPath}`),
    };
  }

  const mockDatabase = {
    ref: vi.fn((path: string) => createMockRefForPath(path)),
  };

  return {
    mockRtdbData,
    mockRefSet: mockRefSetInner,
    mockDatabase,
    getNestedValue,
    setNestedValue,
    createMockRefForPath,
  };
});

// ── Mock all firebase modules ────────────────────────────

vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(),
    database: vi.fn(() => mockDatabase),
  },
  initializeApp: vi.fn(),
  database: Object.assign(vi.fn(() => mockDatabase), {
    ServerValue: { TIMESTAMP: 'MOCK_TIMESTAMP' },
  }),
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

vi.mock('firebase-admin/database', () => ({
  getDatabase: vi.fn(() => mockDatabase),
}));

vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Import (mocks hoisted above) ────────────────────────

import { verifyRankedRound } from '../verifyRankedRound';

// ── Helpers ──────────────────────────────────────────────

function clearRtdb(): void {
  for (const key of Object.keys(mockRtdbData)) delete mockRtdbData[key];
  mockRefSet.mockClear();
}

// ── Tests ────────────────────────────────────────────────

describe('verifyRankedRound', () => {
  beforeEach(() => {
    clearRtdb();
    vi.clearAllMocks();
  });

  it('should verify when both players agree on winner and digest', async () => {
    const result = await verifyRankedRound('m1', {
      playerA: { round: 1, winner: 'playerA', stateDigest: 12345 },
      playerB: { round: 1, winner: 'playerA', stateDigest: 12345 },
    }, 'ranked');

    expect(result.verified).toBe(true);
    expect(result.dispute).toBeUndefined();
  });

  it('should flag dispute when winners and digests disagree', async () => {
    const result = await verifyRankedRound('m2', {
      playerA: { round: 1, winner: 'playerA', stateDigest: 11111 },
      playerB: { round: 1, winner: 'playerB', stateDigest: 22222 },
    }, 'ranked');

    expect(result.verified).toBe(false);
    expect(result.dispute).toBeDefined();
    expect(result.dispute?.reason).toBe('digest_and_winner_mismatch');
  });

  it('should verify when winners agree but digests differ (benign desync)', async () => {
    const result = await verifyRankedRound('m3', {
      playerA: { round: 1, winner: 'playerA', stateDigest: 11111 },
      playerB: { round: 1, winner: 'playerA', stateDigest: 22222 },
    }, 'ranked');

    expect(result.verified).toBe(true);
    expect(result.dispute).toBeUndefined();
  });

  it('should skip verification for casual matches', async () => {
    const result = await verifyRankedRound('m4', {
      playerA: { round: 1, winner: 'playerA', stateDigest: 11111 },
      playerB: { round: 1, winner: 'playerB', stateDigest: 22222 },
    }, 'casual');

    expect(result.verified).toBe(true);
    expect(result.dispute).toBeUndefined();
  });

  it('should verify when a player is missing stateDigest (backwards compat)', async () => {
    const result = await verifyRankedRound('m5', {
      playerA: { round: 1, winner: 'playerA', stateDigest: 12345 },
      playerB: { round: 1, winner: 'playerB' },
    }, 'ranked');

    expect(result.verified).toBe(true);
    expect(result.dispute).toBeUndefined();
  });

  it('should write dispute record to RTDB with correct structure', async () => {
    const result = await verifyRankedRound('m6', {
      playerA: { round: 2, winner: 'playerA', stateDigest: 99999 },
      playerB: { round: 2, winner: 'playerB', stateDigest: 88888 },
    }, 'ranked');

    expect(result.verified).toBe(false);
    expect(result.dispute).toBeDefined();

    // Verify dispute structure
    expect(result.dispute).toEqual(expect.objectContaining({
      reason: 'digest_and_winner_mismatch',
      digests: { playerA: 99999, playerB: 88888 },
      winners: { playerA: 'playerA', playerB: 'playerB' },
    }));
    expect(typeof result.dispute?.ts).toBe('number');

    // Verify RTDB write
    expect(mockDatabase.ref).toHaveBeenCalledWith('matches/m6/disputes/2');
    expect(mockRefSet).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'digest_and_winner_mismatch',
        digests: { playerA: 99999, playerB: 88888 },
        winners: { playerA: 'playerA', playerB: 'playerB' },
      }),
    );
  });
});
