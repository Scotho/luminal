// ── QA-1: Firebase module export tests ───────────────────
import { describe, it, expect, vi } from 'vitest';

// Mock all Firebase SDK modules before any imports (firebase.ts runs
// initializeApp / getAuth / etc. at module-load time).

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: 'test-app' })),
  setLogLevel: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: null, onAuthStateChanged: vi.fn() })),
  connectAuthEmulator: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({ type: 'firestore' })),
  connectFirestoreEmulator: vi.fn(),
}));

vi.mock('firebase/database', () => ({
  getDatabase: vi.fn(() => ({ type: 'database' })),
  connectDatabaseEmulator: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({ type: 'functions' })),
}));

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({ type: 'storage' })),
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: vi.fn(() => ({ type: 'app-check' })),
  ReCaptchaEnterpriseProvider: vi.fn(),
}));

describe('firebase exports', () => {
  it('exports auth instance', async () => {
    const fb = await import('./firebase');
    expect(fb.auth).toBeDefined();
  });

  it('exports firestore (db) instance', async () => {
    const fb = await import('./firebase');
    expect(fb.db).toBeDefined();
  });

  it('exports rtdb instance', async () => {
    const fb = await import('./firebase');
    expect(fb.rtdb).toBeDefined();
  });

  it('exports functions instance', async () => {
    const fb = await import('./firebase');
    expect(fb.functions).toBeDefined();
  });

  it('exports storage instance', async () => {
    const fb = await import('./firebase');
    expect(fb.storage).toBeDefined();
  });

  it('exports appCheck instance', async () => {
    const fb = await import('./firebase');
    expect(fb.appCheck).toBeDefined();
  });

  it('calls initializeApp with project config', async () => {
    const { initializeApp } = await import('firebase/app');
    await import('./firebase');
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'luminal-game',
        authDomain: 'luminal-game.firebaseapp.com',
      }),
    );
  });

  it('calls getFunctions with us-central1 region', async () => {
    const { getFunctions } = await import('firebase/functions');
    await import('./firebase');
    expect(getFunctions).toHaveBeenCalledWith(
      expect.anything(),
      'us-central1',
    );
  });

  it('initialises AppCheck with ReCaptchaEnterpriseProvider', async () => {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } =
      await import('firebase/app-check');
    await import('./firebase');
    expect(ReCaptchaEnterpriseProvider).toHaveBeenCalled();
    expect(initializeAppCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isTokenAutoRefreshEnabled: true }),
    );
  });
});
