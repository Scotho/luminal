import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock Firebase modules BEFORE importing presence ──
const mockRef = vi.fn((_db: unknown, path: string) => ({ __path: path }));
const mockSet = vi.fn(() => Promise.resolve());
const mockGet = vi.fn(() => Promise.resolve({ exists: () => false, val: () => null }));
const mockOnValue = vi.fn(() => vi.fn()); // returns unsub
const mockOnDisconnect = vi.fn(() => ({ remove: vi.fn(() => Promise.resolve()) }));
const mockRemove = vi.fn(() => Promise.resolve());
const mockRunTransaction = vi.fn(() => Promise.resolve());

vi.mock('firebase/database', () => ({
  ref: (...args: unknown[]) => mockRef(...args),
  set: (...args: unknown[]) => mockSet(...args),
  get: (...args: unknown[]) => mockGet(...args),
  onValue: (...args: unknown[]) => mockOnValue(...args),
  onDisconnect: (...args: unknown[]) => mockOnDisconnect(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  serverTimestamp: vi.fn(),
}));

let authCallback: ((user: { uid: string } | null) => void) | null = null;
const mockOnAuthStateChanged = vi.fn((_auth: unknown, cb: (user: { uid: string } | null) => void) => {
  authCallback = cb;
  return vi.fn(); // returns unsub
});

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
}));

vi.mock('./firebase', () => ({
  rtdb: { __rtdb: true },
  auth: { currentUser: null },
}));

vi.mock('./auth', () => ({
  signInAnon: vi.fn(() => Promise.resolve()),
}));

import { initPresence } from './presence';

describe('Presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCallback = null;
  });

  it('calling initPresence twice does not register duplicate onAuthStateChanged listeners', async () => {
    const unsub1 = vi.fn();
    mockOnAuthStateChanged.mockReturnValueOnce(unsub1);

    await initPresence();
    await initPresence();

    // onAuthStateChanged should be called twice, but the first unsub should be called
    // before registering the second listener
    expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(2);
    expect(unsub1).toHaveBeenCalledOnce();
  });

  it('onAuthStateChanged login fires setupPresenceNode exactly once per login', async () => {
    await initPresence();

    // Simulate login
    authCallback!({ uid: 'user1' });

    // Count .info/connected listeners (setupPresenceNode registers one)
    const connectedCalls = mockOnValue.mock.calls.filter(
      (call) => (call[0] as { __path: string }).__path === '.info/connected'
    );
    expect(connectedCalls).toHaveLength(1);
  });

  it('re-login after logout cleans up old connected listener', async () => {
    const unsub1 = vi.fn();
    const unsub2 = vi.fn();
    mockOnValue.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2);

    await initPresence();

    // Login
    authCallback!({ uid: 'user1' });
    expect(unsub1).not.toHaveBeenCalled();

    // Re-login (simulates logout+login or token refresh)
    authCallback!({ uid: 'user1' });
    expect(unsub1).toHaveBeenCalledOnce(); // old connected listener cleaned up
  });
});
