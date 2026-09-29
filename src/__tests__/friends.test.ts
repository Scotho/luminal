// ── Friends System tests ─────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'test-uid' } },
}));

const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockDeleteDoc = vi.fn().mockResolvedValue(undefined);
const mockOnSnapshot = vi.fn();
const mockCollection = vi.fn().mockReturnValue({ id: 'mock-collection' });
const mockDoc = vi.fn().mockReturnValue({ id: 'mock-doc' });
const mockQuery = vi.fn().mockReturnValue({});
const mockWhere = vi.fn().mockReturnValue({});
const mockOrderBy = vi.fn().mockReturnValue({});
const mockTimestampNow = vi.fn().mockReturnValue({ toMillis: () => Date.now() });

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: vi.fn(),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  Timestamp: { now: () => mockTimestampNow() },
}));

import {
  sendFriendRequest,
  acceptFriendRequest,
  denyFriendRequest,
  removeFriend,
  listenRequests,
  listenFriends,
  findUserByUsername,
  stopListeningRequests,
  stopListeningFriends,
  stopAll,
} from '../friends';

function mockDocSnap(exists: boolean, data: Record<string, unknown> = {}) {
  return { exists: () => exists, data: () => data };
}

describe('friends', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('sendFriendRequest', () => {
    it('returns "sent" when no reverse request exists', async () => {
      mockGetDoc
        .mockResolvedValueOnce(mockDocSnap(false)) // not already friends
        .mockResolvedValueOnce(mockDocSnap(false)) // no existing request
        .mockResolvedValueOnce(mockDocSnap(false)); // no reverse request

      const result = await sendFriendRequest('alice', 'Alice', 'bob', 'Bob');
      expect(result).toBe('sent');
      expect(mockSetDoc).toHaveBeenCalledOnce();
    });

    it('returns "accepted" when reverse request exists (auto-accept)', async () => {
      mockGetDoc
        .mockResolvedValueOnce(mockDocSnap(false)) // not already friends
        .mockResolvedValueOnce(mockDocSnap(false)) // no existing request
        .mockResolvedValueOnce(mockDocSnap(true));  // reverse request exists

      const result = await sendFriendRequest('alice', 'Alice', 'bob', 'Bob');
      expect(result).toBe('accepted');
      // acceptFriendRequest creates 2 friend entries
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      // and deletes both request directions
      expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
    });

    it('throws when already friends', async () => {
      mockGetDoc.mockResolvedValueOnce(mockDocSnap(true)); // already friends

      await expect(sendFriendRequest('alice', 'Alice', 'bob', 'Bob'))
        .rejects.toThrow('Already friends');
    });

    it('throws when request already sent', async () => {
      mockGetDoc
        .mockResolvedValueOnce(mockDocSnap(false)) // not friends
        .mockResolvedValueOnce(mockDocSnap(true));  // request already exists

      await expect(sendFriendRequest('alice', 'Alice', 'bob', 'Bob'))
        .rejects.toThrow('Request already sent');
    });
  });

  describe('acceptFriendRequest', () => {
    it('creates friend entries for both users and deletes requests', async () => {
      mockDeleteDoc.mockResolvedValue(undefined);

      await acceptFriendRequest('me', 'Me', 'them', 'Them');

      // Two setDoc calls (one for each user's friends list)
      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      // Two deleteDoc calls (request from both directions)
      expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
    });
  });

  describe('denyFriendRequest', () => {
    it('deletes the request doc', async () => {
      await denyFriendRequest('me', 'them');
      expect(mockDeleteDoc).toHaveBeenCalledOnce();
    });
  });

  describe('removeFriend', () => {
    it('deletes friend docs for both users', async () => {
      await removeFriend('me', 'them');
      expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
    });
  });

  describe('listenRequests', () => {
    it('sets up a snapshot listener and invokes callback with data', () => {
      const unsub = vi.fn();
      mockOnSnapshot.mockImplementation((_q: unknown, cb: (snap: unknown) => void) => {
        cb({
          forEach: (fn: (d: unknown) => void) => {
            fn({ id: 'req-1', data: () => ({ fromUid: 'u1', fromUsername: 'U1' }) });
          },
        });
        return unsub;
      });

      const callback = vi.fn();
      listenRequests('me', callback);

      expect(mockOnSnapshot).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith([
        { id: 'req-1', fromUid: 'u1', fromUsername: 'U1' },
      ]);
    });
  });

  describe('listenFriends', () => {
    it('sets up a snapshot listener and invokes callback with data', () => {
      const unsub = vi.fn();
      mockOnSnapshot.mockImplementation((_q: unknown, cb: (snap: unknown) => void) => {
        cb({
          forEach: (fn: (d: unknown) => void) => {
            fn({ id: 'f-1', data: () => ({ uid: 'u2', username: 'U2' }) });
          },
        });
        return unsub;
      });

      const callback = vi.fn();
      listenFriends('me', callback);

      expect(mockOnSnapshot).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith([
        { id: 'f-1', uid: 'u2', username: 'U2' },
      ]);
    });
  });

  describe('stopListeningRequests', () => {
    it('calls the unsub function and clears it', () => {
      const unsub = vi.fn();
      mockOnSnapshot.mockReturnValue(unsub);
      listenRequests('me', vi.fn());

      stopListeningRequests();
      expect(unsub).toHaveBeenCalledOnce();

      // Second call is a no-op (already cleared)
      stopListeningRequests();
      expect(unsub).toHaveBeenCalledOnce();
    });
  });

  describe('stopListeningFriends', () => {
    it('calls the unsub function and clears it', () => {
      const unsub = vi.fn();
      mockOnSnapshot.mockReturnValue(unsub);
      listenFriends('me', vi.fn());

      stopListeningFriends();
      expect(unsub).toHaveBeenCalledOnce();

      stopListeningFriends();
      expect(unsub).toHaveBeenCalledOnce();
    });
  });

  describe('stopAll', () => {
    it('stops both listeners', () => {
      const unsubReq = vi.fn();
      const unsubFri = vi.fn();
      mockOnSnapshot
        .mockReturnValueOnce(unsubReq)
        .mockReturnValueOnce(unsubFri);

      listenRequests('me', vi.fn());
      listenFriends('me', vi.fn());

      stopAll();
      expect(unsubReq).toHaveBeenCalledOnce();
      expect(unsubFri).toHaveBeenCalledOnce();
    });
  });

  describe('findUserByUsername', () => {
    it('returns user data when found', async () => {
      mockGetDoc.mockResolvedValueOnce(mockDocSnap(true, { uid: 'abc' }));

      const result = await findUserByUsername('Alice');
      expect(result).toEqual({ uid: 'abc', username: 'Alice' });
    });

    it('returns null when user not found', async () => {
      mockGetDoc.mockResolvedValueOnce(mockDocSnap(false));

      const result = await findUserByUsername('Nobody');
      expect(result).toBeNull();
    });
  });
});
