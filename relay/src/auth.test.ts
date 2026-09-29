import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVerifyIdToken = vi.fn();
const mockDbGet = vi.fn();

vi.mock('firebase-admin', () => ({
  default: {
    initializeApp: vi.fn(),
    auth: () => ({ verifyIdToken: mockVerifyIdToken }),
    database: () => ({
      ref: () => ({ get: mockDbGet }),
    }),
  },
}));

import { verifyAndAuthorize } from './auth.js';

describe('verifyAndAuthorize', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects invalid token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid'));
    const result = await verifyAndAuthorize('bad', 'match1', 'uid1');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('token');
  });

  it('rejects uid mismatch', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-other' });
    const result = await verifyAndAuthorize('token', 'match1', 'uid1');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('rejects non-participant', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid1' });
    mockDbGet.mockResolvedValue({ val: () => ({ players: ['uid2', 'uid3'] }) });
    const result = await verifyAndAuthorize('token', 'match1', 'uid1');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not a participant');
  });

  it('accepts valid participant', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid1' });
    mockDbGet.mockResolvedValue({ val: () => ({ players: ['uid1', 'uid2'] }) });
    const result = await verifyAndAuthorize('token', 'match1', 'uid1');
    expect(result.ok).toBe(true);
  });
});
