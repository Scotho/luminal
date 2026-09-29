// ── Firebase Mocks ─────────────────────────────────────
// vi.mock calls for all Firebase modules used in the project.

import { vi } from 'vitest';

export function setupFirebaseMocks(): void {
  vi.mock('../../firebase', () => ({
    auth: { currentUser: null, onAuthStateChanged: vi.fn() },
    db: {},
    rtdb: {},
}));

  vi.mock('firebase/auth', () => ({
    onAuthStateChanged: vi.fn(),
    signInWithPopup: vi.fn(),
    GoogleAuthProvider: vi.fn(),
    signInAnonymously: vi.fn(),
    sendSignInLinkToEmail: vi.fn(),
    isSignInWithEmailLink: vi.fn(() => false),
    signOut: vi.fn(),
    getAuth: vi.fn(),
  }));

  vi.mock('firebase/database', () => ({
    ref: vi.fn(),
    set: vi.fn(),
    get: vi.fn(() => Promise.resolve({ val: () => null, exists: () => false })),
    onValue: vi.fn(),
    off: vi.fn(),
    push: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
    onDisconnect: vi.fn(() => ({ set: vi.fn(), remove: vi.fn() })),
    serverTimestamp: vi.fn(() => 0),
  }));

  vi.mock('firebase/firestore', () => ({
    doc: vi.fn(),
    getDoc: vi.fn(() => Promise.resolve({ exists: () => false, data: () => null })),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    collection: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(() => Promise.resolve({ docs: [], empty: true, forEach: vi.fn() })),
    orderBy: vi.fn(),
    limit: vi.fn(),
    serverTimestamp: vi.fn(() => 0),
    increment: vi.fn(),
    runTransaction: vi.fn((_db: unknown, fn: (t: unknown) => Promise<unknown>) => {
      const mockTransaction = {
        get: vi.fn(() => Promise.resolve({ exists: () => true, data: () => ({ bankedFlow: 0, progression: { unlockedItems: [] } }) })),
        update: vi.fn(),
        set: vi.fn(),
      };
      return fn(mockTransaction);
    }),
    arrayUnion: vi.fn((...args: unknown[]) => args),
  }));

  // Project-level Firebase wrappers
  vi.mock('../../auth', () => ({
    onAuthChange: vi.fn(),
    signInWithGoogle: vi.fn(),
    sendEmailLink: vi.fn(),
    checkEmailLinkRedirect: vi.fn(() => false),
    setUsernameForUser: vi.fn(),
    signOutUser: vi.fn(),
    getUsername: vi.fn(() => Promise.resolve(null)),
    getCurrentUser: vi.fn(() => null),
  }));

  vi.mock('../../presence', () => ({
    initPresence: vi.fn(),
    onOnlineCount: vi.fn(),
    onConnectionChange: vi.fn(),
    onGlobalTimePlayed: vi.fn(),
  }));

  vi.mock('../../chat', () => ({
    sendMessage: vi.fn(),
    onMessages: vi.fn(),
    stopListening: vi.fn(),
  }));

  vi.mock('../../matchmaking', () => ({
    enterQueue: vi.fn(),
    leaveQueue: vi.fn(),
    onMatchFound: vi.fn(),
    onQueueCount: vi.fn(),
    listenForMatch: vi.fn(),
    confirmMatchStarted: vi.fn(),
    removeFromQueue: vi.fn(),
  }));

  vi.mock('../../leaderboard', () => ({
    submitMatch: vi.fn(),
    fetchLeaderboard: vi.fn(() => Promise.resolve([])),
    fetchUserStats: vi.fn(() => Promise.resolve(null)),
    getUserRank: vi.fn(() => Promise.resolve(null)),
    fetchAggregateStats: vi.fn(() => Promise.resolve(null)),
  }));

  vi.mock('../../friends', () => ({
    sendFriendRequest: vi.fn(),
    acceptFriendRequest: vi.fn(),
    denyFriendRequest: vi.fn(),
    removeFriend: vi.fn(),
    listenRequests: vi.fn(),
    listenFriends: vi.fn(),
    findUserByUsername: vi.fn(),
    stopAll: vi.fn(),
  }));

  vi.mock('../../lobby', () => ({
    createLobby: vi.fn(),
    joinLobby: vi.fn(),
    leaveLobby: vi.fn(),
    startLobbyMatch: vi.fn(),
    listenToLobby: vi.fn(),
    stopListening: vi.fn(),
    getLobbyUrl: vi.fn(() => ''),
    checkLobby: vi.fn(),
  }));
}
