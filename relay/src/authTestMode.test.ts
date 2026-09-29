import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

describe('AUTH_MODE=test bypass', () => {
  const originalEnv = process.env.AUTH_MODE;

  beforeAll(() => {
    process.env.AUTH_MODE = 'test';
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.AUTH_MODE = originalEnv;
    } else {
      delete process.env.AUTH_MODE;
    }
  });

  it('accepts any token as UID in test mode', async () => {
    vi.resetModules();
    const { verifyAndAuthorize } = await import('./auth.js');
    const result = await verifyAndAuthorize('test-uid-123', 'match-abc', 'test-uid-123');
    expect(result.ok).toBe(true);
  });

  it('rejects when claimed UID does not match token in test mode', async () => {
    vi.resetModules();
    const { verifyAndAuthorize } = await import('./auth.js');
    const result = await verifyAndAuthorize('token-uid-A', 'match-abc', 'different-uid');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('uid mismatch');
  });
});
