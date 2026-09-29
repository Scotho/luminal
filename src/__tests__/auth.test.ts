// ── auth.ts unit tests ──────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (accessible inside vi.mock factories) ─
const {
  mockAuth, mockSignInWithPopup, mockCreateUser, mockSignInEmail, mockSendReset,
  mockSendVerification, mockSendLink, mockIsEmailLink, mockSignInEmailLink,
  mockSignInPhone, mockSignInAnonymously, mockOnAuthStateChanged, mockSignOut,
  mockDoc, mockGetDoc, mockUpdateDoc, mockCallable, mockHttpsCallable,
} = vi.hoisted(() => {
  const fn = vi.fn;
  const callable = fn();
  return {
    mockAuth: { currentUser: null as { uid: string; metadata: { creationTime?: string } } | null },
    mockSignInWithPopup: fn(), mockCreateUser: fn(), mockSignInEmail: fn(),
    mockSendReset: fn(), mockSendVerification: fn(), mockSendLink: fn(),
    mockIsEmailLink: fn(), mockSignInEmailLink: fn(), mockSignInPhone: fn(),
    mockSignInAnonymously: fn(), mockOnAuthStateChanged: fn(), mockSignOut: fn(),
    mockDoc: fn((_db: unknown, _coll: string, _id: string) => ({ path: `${_coll}/${_id}` })),
    mockGetDoc: fn(), mockUpdateDoc: fn(),
    mockCallable: callable, mockHttpsCallable: fn(() => callable),
  };
});

vi.mock('../firebase', () => ({ auth: mockAuth, db: {}, functions: {} }));
vi.mock('firebase/auth', () => ({
  signInWithPopup: mockSignInWithPopup, GoogleAuthProvider: vi.fn(),
  GithubAuthProvider: vi.fn(), OAuthProvider: vi.fn(function O() { return {}; }),
  createUserWithEmailAndPassword: mockCreateUser,
  signInWithEmailAndPassword: mockSignInEmail, sendPasswordResetEmail: mockSendReset,
  sendEmailVerification: mockSendVerification, sendSignInLinkToEmail: mockSendLink,
  isSignInWithEmailLink: mockIsEmailLink, signInWithEmailLink: mockSignInEmailLink,
  signInWithPhoneNumber: mockSignInPhone, RecaptchaVerifier: vi.fn(),
  signInAnonymously: mockSignInAnonymously, onAuthStateChanged: mockOnAuthStateChanged,
  signOut: mockSignOut,
}));
vi.mock('firebase/firestore', () => ({ doc: mockDoc, getDoc: mockGetDoc, updateDoc: mockUpdateDoc }));
vi.mock('firebase/functions', () => ({ httpsCallable: mockHttpsCallable }));

// ── Helpers ─────────────────────────────────────────────
function fakeUser(uid = 'uid-1') {
  return { uid, email: 'test@example.com', metadata: { creationTime: '2026-01-01T00:00:00Z' } };
}
function fakeSnap(exists: boolean, data: Record<string, unknown> = {}) {
  return { exists: () => exists, data: () => data };
}

// ── Import SUT (after mocks) ────────────────────────────
import {
  signInWithGoogle, signInWithApple, signInWithGitHub, signInWithMicrosoft,
  sendEmailLink, checkEmailLinkRedirect, signUpWithEmail, signInWithEmail,
  resetPassword, sendPhoneCode, verifyPhoneCode, setUsernameForUser,
  isUsernameTaken, getUsername, getUserIcon, getUserSettings, ensureUserIcon,
  getAuthCreationTime, setUserLobby, clearUserLobby, getUserLobby,
  signOutUser, signInAnon, onAuthChange, getCurrentUser,
} from '../auth';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.currentUser = null;
  window.localStorage.clear();
});

// ── SSO Sign-In ─────────────────────────────────────────
describe('SSO sign-in functions', () => {
  const ssoFns = [
    { name: 'signInWithGoogle', fn: signInWithGoogle },
    { name: 'signInWithApple', fn: signInWithApple },
    { name: 'signInWithGitHub', fn: signInWithGitHub },
    { name: 'signInWithMicrosoft', fn: signInWithMicrosoft },
  ] as const;

  for (const { name, fn } of ssoFns) {
    describe(name, () => {
      it('returns needsUsername=true when userDoc missing', async () => {
        mockSignInWithPopup.mockResolvedValue({ user: fakeUser() });
        mockGetDoc.mockResolvedValue(fakeSnap(false));
        const r = await fn();
        expect(r.needsUsername).toBe(true);
      });
      it('returns needsUsername=false when userDoc exists', async () => {
        mockSignInWithPopup.mockResolvedValue({ user: fakeUser() });
        mockGetDoc.mockResolvedValue(fakeSnap(true, { username: 'P1' }));
        expect((await fn()).needsUsername).toBe(false);
      });
    });
  }
});

// ── Email Auth ──────────────────────────────────────────
describe('Email auth', () => {
  it('sendEmailLink — saves email to localStorage', async () => {
    mockSendLink.mockResolvedValue(undefined);
    await sendEmailLink('foo@bar.com');
    expect(mockSendLink).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem('luminal-email-for-signin')).toBe('foo@bar.com');
  });

  describe('checkEmailLinkRedirect', () => {
    it('returns null when URL is not an email link', () => {
      mockIsEmailLink.mockReturnValue(false);
      expect(checkEmailLinkRedirect()).toBeNull();
    });
    it('completes sign-in when email is in localStorage', async () => {
      mockIsEmailLink.mockReturnValue(true);
      window.localStorage.setItem('luminal-email-for-signin', 'foo@bar.com');
      mockSignInEmailLink.mockResolvedValue({ user: fakeUser() });
      mockGetDoc.mockResolvedValue(fakeSnap(false));
      const resolved = await checkEmailLinkRedirect()!;
      expect(resolved.needsUsername).toBe(true);
      expect(window.localStorage.getItem('luminal-email-for-signin')).toBeNull();
    });
    it('returns null if no email from localStorage or prompt', () => {
      mockIsEmailLink.mockReturnValue(true);
      vi.spyOn(window, 'prompt').mockReturnValue(null);
      expect(checkEmailLinkRedirect()).toBeNull();
    });
  });

  describe('signUpWithEmail', () => {
    it('creates user, claims username, sends verification', async () => {
      const user = fakeUser();
      mockCreateUser.mockResolvedValue({ user });
      mockCallable.mockResolvedValue({ data: {} });
      mockSendVerification.mockResolvedValue(undefined);
      const r = await signUpWithEmail('a@b.com', 'pass123', 'Player1');
      expect(r.user).toBe(user);
      expect(mockCallable).toHaveBeenCalledWith({ username: 'Player1', email: 'a@b.com' });
      expect(mockSendVerification).toHaveBeenCalledWith(user);
    });
    it('rejects short username', async () => {
      await expect(signUpWithEmail('a@b.com', 'p', 'ab')).rejects.toThrow('3-20 characters');
    });
    it('rejects long username', async () => {
      await expect(signUpWithEmail('a@b.com', 'p', 'a'.repeat(21))).rejects.toThrow('3-20 characters');
    });
    it('rejects invalid characters', async () => {
      await expect(signUpWithEmail('a@b.com', 'p', 'no spaces!')).rejects.toThrow('Letters, numbers');
    });
  });

  it('signInWithEmail — signs in and checks userDoc', async () => {
    mockSignInEmail.mockResolvedValue({ user: fakeUser() });
    mockGetDoc.mockResolvedValue(fakeSnap(true, { username: 'P1' }));
    expect((await signInWithEmail('a@b.com', 'pass')).needsUsername).toBe(false);
  });

  it('resetPassword — sends reset email', async () => {
    mockSendReset.mockResolvedValue(undefined);
    await resetPassword('a@b.com');
    expect(mockSendReset).toHaveBeenCalledWith(mockAuth, 'a@b.com');
  });
});

// ── Phone Auth ──────────────────────────────────────────
describe('Phone auth', () => {
  it('sendPhoneCode — returns confirmation result', async () => {
    const cr = { verificationId: 'v1' };
    mockSignInPhone.mockResolvedValue(cr);
    expect(await sendPhoneCode('+1555000111')).toBe(cr);
  });

  it('verifyPhoneCode — confirms code and returns user', async () => {
    const user = fakeUser();
    const cr = { confirm: vi.fn().mockResolvedValue({ user }) };
    mockGetDoc.mockResolvedValue(fakeSnap(false));
    const r = await verifyPhoneCode(cr as unknown as import('firebase/auth').ConfirmationResult, '123456');
    expect(cr.confirm).toHaveBeenCalledWith('123456');
    expect(r.needsUsername).toBe(true);
  });
});

// ── Username Management ─────────────────────────────────
describe('Username management', () => {
  describe('setUsernameForUser', () => {
    it('validates and calls claimUsername CF', async () => {
      mockCallable.mockResolvedValue({ data: {} });
      await setUsernameForUser('uid-1', 'a@b.com', 'GoodName');
      expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'claimUsername');
      expect(mockCallable).toHaveBeenCalledWith({ username: 'GoodName', email: 'a@b.com' });
    });
    it('rejects short username', async () => {
      await expect(setUsernameForUser('u', 'e', 'ab')).rejects.toThrow('3-20 characters');
    });
    it('rejects invalid characters', async () => {
      await expect(setUsernameForUser('u', 'e', 'bad name')).rejects.toThrow('Letters, numbers');
    });
    it('wraps already-exists CF error', async () => {
      mockCallable.mockRejectedValue({ code: 'functions/already-exists', message: 'taken' });
      await expect(setUsernameForUser('u', '', 'Taken')).rejects.toThrow('already taken');
    });
    it('wraps generic CF error', async () => {
      mockCallable.mockRejectedValue({ code: 'functions/internal', message: 'boom' });
      await expect(setUsernameForUser('u', '', 'Name')).rejects.toThrow('boom');
    });
  });

  describe('isUsernameTaken', () => {
    it('returns true when doc exists', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(true));
      expect(await isUsernameTaken('TakenName')).toBe(true);
      expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'usernames', 'takenname');
    });
    it('returns false when doc missing', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(false));
      expect(await isUsernameTaken('FreshName')).toBe(false);
    });
  });

  it('getUsername — returns username or null', async () => {
    mockGetDoc.mockResolvedValue(fakeSnap(true, { username: 'P1' }));
    expect(await getUsername('uid-1')).toBe('P1');
    mockGetDoc.mockResolvedValue(fakeSnap(false));
    expect(await getUsername('uid-1')).toBeNull();
  });

  describe('getUserIcon', () => {
    it('returns icon when present', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(true, { icon: 'crown' }));
      expect(await getUserIcon('uid-1')).toBe('crown');
    });
    it('returns null when no icon or no doc', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(true, {}));
      expect(await getUserIcon('uid-1')).toBeNull();
      mockGetDoc.mockResolvedValue(fakeSnap(false));
      expect(await getUserIcon('uid-1')).toBeNull();
    });
  });

  it('getUserSettings — returns settings or null', async () => {
    mockGetDoc.mockResolvedValue(fakeSnap(true, { settings: { sfx: 'off' } }));
    expect(await getUserSettings('uid-1')).toEqual({ sfx: 'off' });
    mockGetDoc.mockResolvedValue(fakeSnap(true, {}));
    expect(await getUserSettings('uid-1')).toBeNull();
  });

  describe('ensureUserIcon', () => {
    it('returns null icon when user doc missing', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(false));
      expect(await ensureUserIcon('uid-1')).toEqual({ icon: null, awarded: false });
    });
    it('returns existing icon without backfill', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(true, { icon: 'crown' }));
      expect(await ensureUserIcon('uid-1')).toEqual({ icon: 'crown', awarded: false });
      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });
    it('backfills star icon when missing', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(true, {}));
      mockUpdateDoc.mockResolvedValue(undefined);
      expect(await ensureUserIcon('uid-1')).toEqual({ icon: 'star', awarded: true });
      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), { icon: 'star' });
    });
  });
});

// ── Auth State ──────────────────────────────────────────
describe('Auth state', () => {
  describe('getAuthCreationTime', () => {
    it('returns null when no currentUser', () => {
      expect(getAuthCreationTime()).toBeNull();
    });
    it('returns Date when creationTime exists', () => {
      mockAuth.currentUser = { uid: 'u1', metadata: { creationTime: '2026-01-01T00:00:00Z' } };
      const d = getAuthCreationTime();
      expect(d).toBeInstanceOf(Date);
      expect(d!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });
    it('returns null when creationTime undefined', () => {
      mockAuth.currentUser = { uid: 'u1', metadata: {} } as typeof mockAuth.currentUser;
      expect(getAuthCreationTime()).toBeNull();
    });
  });

  it('signOutUser — signs out then re-signs in anonymously', async () => {
    mockSignOut.mockResolvedValue(undefined);
    mockSignInAnonymously.mockResolvedValue(undefined);
    await signOutUser();
    expect(mockSignOut).toHaveBeenCalledWith(mockAuth);
    expect(mockSignInAnonymously).toHaveBeenCalledWith(mockAuth);
  });

  describe('signInAnon', () => {
    it('signs in anonymously when no user present', async () => {
      const unsub = vi.fn();
      mockOnAuthStateChanged.mockImplementation((_a: unknown, cb: (u: unknown) => void) => {
        queueMicrotask(() => cb(null));
        return unsub;
      });
      mockSignInAnonymously.mockResolvedValue(undefined);
      await signInAnon();
      expect(mockSignInAnonymously).toHaveBeenCalledWith(mockAuth);
      expect(unsub).toHaveBeenCalledOnce();
    });
    it('skips anon sign-in when user already exists', async () => {
      const unsub = vi.fn();
      mockOnAuthStateChanged.mockImplementation((_a: unknown, cb: (u: unknown) => void) => {
        queueMicrotask(() => cb(fakeUser()));
        return unsub;
      });
      await signInAnon();
      expect(mockSignInAnonymously).not.toHaveBeenCalled();
      expect(unsub).toHaveBeenCalledOnce();
    });
  });

  it('onAuthChange — wraps onAuthStateChanged', () => {
    const unsub = vi.fn();
    mockOnAuthStateChanged.mockReturnValue(unsub);
    const cb = vi.fn();
    expect(onAuthChange(cb)).toBe(unsub);
    expect(mockOnAuthStateChanged).toHaveBeenCalledWith(mockAuth, cb);
  });

  it('getCurrentUser — returns auth.currentUser', () => {
    expect(getCurrentUser()).toBeNull();
    const u = fakeUser();
    mockAuth.currentUser = u;
    expect(getCurrentUser()).toBe(u);
  });
});

// ── Lobby Persistence ───────────────────────────────────
describe('Lobby persistence', () => {
  it('setUserLobby — updates Firestore', async () => {
    mockUpdateDoc.mockResolvedValue(undefined);
    await setUserLobby('uid-1', 'lobby-42', 'host');
    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), {
      currentLobby: 'lobby-42', lobbyRole: 'host',
    });
  });

  it('clearUserLobby — sets fields to null', async () => {
    mockUpdateDoc.mockResolvedValue(undefined);
    await clearUserLobby('uid-1');
    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), {
      currentLobby: null, lobbyRole: null,
    });
  });

  describe('getUserLobby', () => {
    it('returns lobby data when present', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(true, { currentLobby: 'L1', lobbyRole: 'guest' }));
      expect(await getUserLobby('uid-1')).toEqual({ lobbyId: 'L1', role: 'guest' });
    });
    it('returns null when doc missing', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(false));
      expect(await getUserLobby('uid-1')).toBeNull();
    });
    it('returns null when lobby fields missing', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(true, {}));
      expect(await getUserLobby('uid-1')).toBeNull();
    });
    it('returns null when only one lobby field set', async () => {
      mockGetDoc.mockResolvedValue(fakeSnap(true, { currentLobby: 'L1' }));
      expect(await getUserLobby('uid-1')).toBeNull();
    });
  });
});
