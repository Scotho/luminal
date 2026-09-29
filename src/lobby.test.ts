// ── Lobby System Tests ────────────────────────────────────
// Tests for lobby creation, joining, leaving, presence, invites,
// host transfer, and orphan cleanup.

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// ── Mock Firebase modules BEFORE importing lobby ──
const mockRef = vi.fn((_db: unknown, path: string) => ({ __path: path }));
const mockSet = vi.fn(() => Promise.resolve());
const mockGet = vi.fn();
const mockOnValue = vi.fn(() => vi.fn()); // returns unsub
const mockRemove = vi.fn(() => Promise.resolve());
const mockUpdate = vi.fn(() => Promise.resolve());
const mockOnDisconnect = vi.fn(() => ({
  set: vi.fn(() => Promise.resolve()),
  cancel: vi.fn(() => Promise.resolve()),
}));
const mockRunTransaction = vi.fn();
const mockServerTimestamp = vi.fn(() => 'SERVER_TS');

vi.mock('firebase/database', () => ({
  ref: (...args: unknown[]) => mockRef(...args),
  set: (...args: unknown[]) => mockSet(...args),
  get: (...args: unknown[]) => mockGet(...args),
  onValue: (...args: unknown[]) => mockOnValue(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
  onDisconnect: (...args: unknown[]) => mockOnDisconnect(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  serverTimestamp: () => mockServerTimestamp(),
  query: vi.fn((...args: unknown[]) => args[0]),
  orderByChild: vi.fn(() => ({})),
  limitToLast: vi.fn(() => ({})),
}));

vi.mock('./firebase', () => ({
  rtdb: { __rtdb: true },
  auth: { currentUser: null },
}));

import {
  createLobby, joinLobby, leaveLobby, rejoinLobby, kickPlayer,
  startLobbyMatch, returnPartyToLobby, listenToLobby, stopListening,
  updateLobbyPlayer, updateLobbySettings, updateLobbyAis,
  checkLobby, sendLobbyInvite, listenLobbyInvites, clearLobbyInvite,
  transferHost, switchPresence, promoteToHost, fetchPublicLobbies,
} from './lobby';

// ── Helpers ─────────────────────────────────────────────
function makeLobbySnap(data: Record<string, unknown> | null) {
  return {
    exists: () => data !== null,
    val: () => data,
  };
}

const BASE_LOBBY = {
  host: { uid: 'host1', username: 'Host', color: '#ff0000' },
  settings: { seriesLength: 1, lobbySize: 2, invitePermission: 'invite' },
  status: 'waiting',
  createdAt: Date.now(),
};

describe('Lobby System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level state by stopping any active listeners
    stopListening();
    mockGet.mockResolvedValue(makeLobbySnap(null));
  });

  describe('createLobby', () => {
    it('writes lobby data with host info and returns 6-char code', async () => {
      const code = await createLobby('host1', 'Host', '#ff0000');
      expect(code).toHaveLength(6);
      expect(mockSet).toHaveBeenCalled();
      // First set call writes the lobby data
      const lobbyData = (mockSet as Mock).mock.calls[0][1];
      expect(lobbyData.host.uid).toBe('host1');
      expect(lobbyData.host.username).toBe('Host');
      expect(lobbyData.host.color).toBe('#ff0000');
      expect(lobbyData.status).toBe('waiting');
      expect(lobbyData.guest).toBeUndefined();
    });

    it('sets presence and onDisconnect handler', async () => {
      await createLobby('host1', 'Host', '#ff0000');
      // Should call onDisconnect for presence
      expect(mockOnDisconnect).toHaveBeenCalled();
      // Should set presence to true
      const setCalls = (mockSet as Mock).mock.calls;
      const presenceCall = setCalls.find((c: unknown[]) =>
        (c[0] as { __path: string }).__path?.includes('/presence'));
      expect(presenceCall).toBeTruthy();
      expect(presenceCall![1]).toBe(true);
    });

    it('generates codes using only unambiguous characters', async () => {
      // Run many times to check character set
      for (let i = 0; i < 50; i++) {
        const code = await createLobby('host1', 'Host', '#ff0000');
        expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      }
    });

    it('includes icon in host data when provided', async () => {
      await createLobby('host1', 'Host', '#ff0000', {}, 'crown');
      const lobbyData = (mockSet as Mock).mock.calls[0][1];
      expect(lobbyData.host.icon).toBe('crown');
    });

    it('excludes icon from host data when not provided', async () => {
      await createLobby('host1', 'Host', '#ff0000');
      const lobbyData = (mockSet as Mock).mock.calls[0][1];
      expect(lobbyData.host).not.toHaveProperty('icon');
    });

    it('defaults seriesLength to 1 and lobbySize to 2', async () => {
      await createLobby('host1', 'Host', '#ff0000');
      const lobbyData = (mockSet as Mock).mock.calls[0][1];
      expect(lobbyData.settings.seriesLength).toBe(1);
      expect(lobbyData.settings.lobbySize).toBe(2);
    });

    it('uses provided seriesLength and lobbySize', async () => {
      await createLobby('host1', 'Host', '#ff0000', { seriesLength: 5, lobbySize: 4 });
      const lobbyData = (mockSet as Mock).mock.calls[0][1];
      expect(lobbyData.settings.seriesLength).toBe(5);
      expect(lobbyData.settings.lobbySize).toBe(4);
    });
  });

  describe('joinLobby', () => {
    // joinLobby pre-fetches the lobby with get() for validation, then uses a
    // transaction on the guest child to atomically claim the slot, then fetches
    // the full lobby again for the return value.

    function setupJoin(lobbyData: Record<string, unknown> | null, guestSlot: unknown = null) {
      // First get() — pre-fetch for validation
      mockGet.mockResolvedValueOnce(makeLobbySnap(lobbyData));
      // Transaction on guests/{uid} child
      mockRunTransaction.mockImplementation(async (_ref: unknown, fn: (val: unknown) => unknown) => {
        const result = fn(guestSlot);
        return { committed: result !== undefined, snapshot: { val: () => result } };
      });
      // Second get() — fetch updated lobby for return value
      if (lobbyData) {
        mockGet.mockResolvedValueOnce(makeLobbySnap({ ...lobbyData, guests: { guest1: { uid: 'guest1', username: 'Guest', color: '#00ff00' } } }));
      }
    }

    it('throws when lobby does not exist', async () => {
      mockGet.mockResolvedValueOnce(makeLobbySnap(null));
      await expect(joinLobby('BADCODE', 'guest1', 'Guest', '#00ff00'))
        .rejects.toThrow('Lobby not found');
    });

    it('throws when lobby status is not waiting', async () => {
      mockGet.mockResolvedValueOnce(makeLobbySnap({ ...BASE_LOBBY, status: 'starting' }));
      await expect(joinLobby('ABC123', 'guest1', 'Guest', '#00ff00'))
        .rejects.toThrow('Lobby is no longer open');
    });

    it('throws on self-join (host uid)', async () => {
      mockGet.mockResolvedValueOnce(makeLobbySnap(BASE_LOBBY));
      await expect(joinLobby('ABC123', 'host1', 'Host', '#ff0000'))
        .rejects.toThrow('You are the host');
    });

    it('succeeds via transaction when guest slot is empty', async () => {
      setupJoin({ ...BASE_LOBBY }, null);

      const data = await joinLobby('ABC123', 'guest1', 'Guest', '#00ff00');
      expect(data.host.uid).toBe('host1');
      expect(data.guests!['guest1'].uid).toBe('guest1');
      expect(mockRunTransaction).toHaveBeenCalled();
    });

    it('aborts transaction when guest slot taken by different uid', async () => {
      const lobby = { ...BASE_LOBBY };
      mockGet.mockResolvedValueOnce(makeLobbySnap(lobby));
      mockRunTransaction.mockImplementation(async (_ref: unknown, fn: (val: unknown) => unknown) => {
        // Simulate race: slot was empty at pre-fetch but taken by the time transaction runs
        const result = fn({ uid: 'someone_else', username: 'Other', color: '#0000ff' });
        return { committed: result !== undefined };
      });

      await expect(joinLobby('ABC123', 'guest1', 'Guest', '#00ff00'))
        .rejects.toThrow('Lobby is full');
    });

    it('allows rejoining same slot (uid matches current guest)', async () => {
      const existingGuest = { uid: 'guest1', username: 'Guest', color: '#00ff00' };
      setupJoin({ ...BASE_LOBBY, guests: { guest1: existingGuest } }, existingGuest);

      const data = await joinLobby('ABC123', 'guest1', 'Guest', '#00ff00');
      expect(data).toBeTruthy();
    });

    it('includes icon in guest data when provided', async () => {
      setupJoin({ ...BASE_LOBBY }, null);

      await joinLobby('ABC123', 'guest1', 'Guest', '#00ff00', 'star');
      const txFn = (mockRunTransaction as Mock).mock.calls[0][1];
      const payload = txFn(null);
      expect(payload.icon).toBe('star');
    });

    it('sets guest presence and onDisconnect', async () => {
      setupJoin({ ...BASE_LOBBY }, null);

      await joinLobby('ABC123', 'guest1', 'Guest', '#00ff00');
      expect(mockOnDisconnect).toHaveBeenCalled();
      const presenceCall = (mockSet as Mock).mock.calls.find((c: unknown[]) =>
        (c[0] as { __path: string }).__path?.includes('/guests/guest1/presence'));
      expect(presenceCall).toBeTruthy();
    });

    it('throws when lobby is at max capacity (4 players)', async () => {
      const fullLobby = {
        ...BASE_LOBBY,
        guests: {
          guest1: { uid: 'guest1', username: 'Guest', color: '#00ff00' },
          guest2: { uid: 'guest2', username: 'Guest2', color: '#0000ff' },
          guest3: { uid: 'guest3', username: 'Guest3', color: '#ff00ff' },
        },
        settings: { seriesLength: 1, lobbySize: 4, invitePermission: 'invite' },
      };
      mockGet.mockResolvedValueOnce(makeLobbySnap(fullLobby));
      await expect(joinLobby('ABC123', 'guest4', 'Guest4', '#ffff00'))
        .rejects.toThrow('Lobby is full');
    });

    it('rejects anonymous users when allowAnonymous is false', async () => {
      // Simulate anonymous user
      const { auth: mockAuth } = await import('./firebase');
      (mockAuth as { currentUser: unknown }).currentUser = { isAnonymous: true, uid: 'anon-uid' };

      mockGet.mockResolvedValueOnce(makeLobbySnap({
        ...BASE_LOBBY,
        settings: { ...BASE_LOBBY.settings, invitePermission: 'public', allowAnonymous: false },
      }));

      await expect(joinLobby('ABC123', 'anon-uid', 'Anonymous', '#ccc'))
        .rejects.toThrow('Sign in to join this lobby');

      // Restore
      (mockAuth as { currentUser: unknown }).currentUser = null;
    });

    it('sets spectating flag when joining an active lobby', async () => {
      const lobby = {
        ...BASE_LOBBY,
        status: 'active',
      };
      mockGet.mockResolvedValueOnce(makeLobbySnap(lobby));
      mockRunTransaction.mockImplementation(async (_ref: unknown, fn: (val: unknown) => unknown) => {
        const result = fn(null);
        return { committed: result !== undefined, snapshot: { val: () => result } };
      });
      mockGet.mockResolvedValueOnce(makeLobbySnap({
        ...lobby,
        guests: { guest1: { uid: 'guest1', username: 'Guest', color: '#00ff00', spectating: true } },
      }));

      const data = await joinLobby('ABC123', 'guest1', 'Guest', '#00ff00');
      expect(data.guests!['guest1'].spectating).toBe(true);

      // Verify the transaction payload included spectating: true
      const txFn = mockRunTransaction.mock.calls[0][1] as (val: unknown) => unknown;
      const payload = txFn(null) as Record<string, unknown>;
      expect(payload.spectating).toBe(true);
    });

    it('throws when lobby status is starting', async () => {
      mockGet.mockResolvedValueOnce(makeLobbySnap({
        ...BASE_LOBBY,
        status: 'starting',
      }));

      await expect(joinLobby('ABC123', 'guest1', 'Guest', '#00ff00'))
        .rejects.toThrow('Lobby is no longer open');
    });

    it('allows 3rd player to join a size-2 lobby (auto-expand handled by host UI)', async () => {
      const lobby = {
        ...BASE_LOBBY,
        guests: { guest1: { uid: 'guest1', username: 'Guest', color: '#00ff00' } },
        settings: { seriesLength: 1, lobbySize: 4, invitePermission: 'invite' },
      };
      mockGet.mockResolvedValueOnce(makeLobbySnap(lobby));
      mockRunTransaction.mockImplementation(async (_ref: unknown, fn: (val: unknown) => unknown) => {
        const result = fn(null);
        return { committed: result !== undefined, snapshot: { val: () => result } };
      });
      mockGet.mockResolvedValueOnce(makeLobbySnap({
        ...lobby,
        guests: {
          guest1: { uid: 'guest1', username: 'Guest', color: '#00ff00' },
          guest2: { uid: 'guest2', username: 'Guest2', color: '#0000ff' },
        },
      }));

      const data = await joinLobby('ABC123', 'guest2', 'Guest2', '#0000ff');
      expect(data.guests!['guest2'].uid).toBe('guest2');
    });
  });

  describe('leaveLobby', () => {
    it('host leaving removes entire lobby', async () => {
      await leaveLobby('ABC123', 'host1', true);
      const removedPath = (mockRemove as Mock).mock.calls[0][0].__path;
      expect(removedPath).toBe('lobbies/ABC123');
    });

    it('guest leaving removes only their guest entry', async () => {
      await leaveLobby('ABC123', 'guest1', false);
      const removedPath = (mockRemove as Mock).mock.calls[0][0].__path;
      expect(removedPath).toBe('lobbies/ABC123/guests/guest1');
    });
  });

  describe('rejoinLobby', () => {
    it('returns lobby data when uid matches host role', async () => {
      const lobby = { ...BASE_LOBBY, host: { ...BASE_LOBBY.host, presence: true } };
      mockGet.mockResolvedValue(makeLobbySnap(lobby));

      const data = await rejoinLobby('ABC123', 'host1', 'host');
      expect(data).toBeTruthy();
      expect(data!.host.uid).toBe('host1');
    });

    it('returns null when host uid does not match', async () => {
      mockGet.mockResolvedValue(makeLobbySnap(BASE_LOBBY));
      const data = await rejoinLobby('ABC123', 'wrong_uid', 'host');
      expect(data).toBeNull();
    });

    it('returns null when guest uid does not match', async () => {
      const lobby = { ...BASE_LOBBY, guests: { guest1: { uid: 'guest1', username: 'Guest', color: '#00ff00' } } };
      mockGet.mockResolvedValue(makeLobbySnap(lobby));
      const data = await rejoinLobby('ABC123', 'wrong_uid', 'guest');
      expect(data).toBeNull();
    });

    it('returns null when lobby does not exist', async () => {
      mockGet.mockResolvedValue(makeLobbySnap(null));
      const data = await rejoinLobby('ABC123', 'host1', 'host');
      expect(data).toBeNull();
    });

    it('re-establishes presence and onDisconnect', async () => {
      mockGet.mockResolvedValue(makeLobbySnap(BASE_LOBBY));
      await rejoinLobby('ABC123', 'host1', 'host');
      expect(mockOnDisconnect).toHaveBeenCalled();
    });
  });

  describe('kickPlayer', () => {
    it('removes specific guest path from RTDB', async () => {
      await kickPlayer('ABC123', 'guest1');
      expect(mockRemove).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123/guests/guest1' })
      );
    });
  });

  describe('startLobbyMatch', () => {
    it('sets lobby status to starting', async () => {
      await startLobbyMatch('ABC123');
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123/status' }),
        'starting'
      );
    });
  });

  describe('returnPartyToLobby', () => {
    it('sets lobby status to returning', async () => {
      await returnPartyToLobby('ABC123');
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123/status' }),
        'returning'
      );
    });
  });

  describe('listenToLobby', () => {
    it('calls callback with lobby data on value change', () => {
      const callback = vi.fn();
      let onValueCb: ((snap: unknown) => void) | null = null;
      mockOnValue.mockImplementation((_ref: unknown, cb: (snap: unknown) => void) => {
        onValueCb = cb;
        return vi.fn();
      });

      listenToLobby('ABC123', callback);
      expect(onValueCb).not.toBeNull();

      onValueCb!(makeLobbySnap(BASE_LOBBY));
      expect(callback).toHaveBeenCalledWith(BASE_LOBBY);
    });

    it('calls callback with null when lobby destroyed', () => {
      const callback = vi.fn();
      let onValueCb: ((snap: unknown) => void) | null = null;
      mockOnValue.mockImplementation((_ref: unknown, cb: (snap: unknown) => void) => {
        onValueCb = cb;
        return vi.fn();
      });

      listenToLobby('ABC123', callback);
      onValueCb!(makeLobbySnap(null));
      expect(callback).toHaveBeenCalledWith(null);
    });

    it('unsubscribes previous listener on re-listen', () => {
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();
      mockOnValue.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2);

      listenToLobby('ABC123', vi.fn());
      listenToLobby('ABC123', vi.fn());
      expect(unsub1).toHaveBeenCalled();
    });
  });

  describe('updateLobbyPlayer', () => {
    it('updates correct RTDB path for host', async () => {
      await updateLobbyPlayer('ABC123', 'host', { color: '#0000ff' });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123/host' }),
        { color: '#0000ff' }
      );
    });

    it('updates correct RTDB path for guest (uid-based)', async () => {
      await updateLobbyPlayer('ABC123', 'guest', { username: 'NewName' }, 'guest1');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123/guests/guest1' }),
        { username: 'NewName' }
      );
    });
  });

  describe('updateLobbySettings', () => {
    it('updates settings path', async () => {
      await updateLobbySettings('ABC123', { seriesLength: 5 });
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123/settings' }),
        { seriesLength: 5 }
      );
    });
  });

  describe('updateLobbyAis', () => {
    it('sets ais with data', async () => {
      const ais = { ai1: { name: 'Bot', color: '#fff', vehicle: 'bike' } };
      await updateLobbyAis('ABC123', ais);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123/ais' }),
        ais
      );
    });

    it('sets ais to null to clear AI slots', async () => {
      await updateLobbyAis('ABC123', null);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123/ais' }),
        null
      );
    });
  });

  describe('checkLobby', () => {
    it('returns lobby data when lobby exists and host is online', async () => {
      const lobby = { ...BASE_LOBBY, host: { ...BASE_LOBBY.host, presence: true } };
      mockGet.mockResolvedValue(makeLobbySnap(lobby));
      const data = await checkLobby('ABC123');
      expect(data).toBeTruthy();
      expect(data!.host.uid).toBe('host1');
    });

    it('returns null when lobby does not exist', async () => {
      mockGet.mockResolvedValue(makeLobbySnap(null));
      const data = await checkLobby('ABC123');
      expect(data).toBeNull();
    });

    it('deletes orphaned lobby when host offline, no guest, and disconnectedAt > 2x timeout ago', async () => {
      // Threshold uses 2x margin for clock-skew tolerance (2 * 60s = 120s)
      const lobby = {
        ...BASE_LOBBY,
        host: { ...BASE_LOBBY.host, presence: false, disconnectedAt: Date.now() - 240_000 },
      };
      mockGet.mockResolvedValue(makeLobbySnap(lobby));

      const data = await checkLobby('ABC123');
      expect(data).toBeNull();
      expect(mockRemove).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123' })
      );
    });

    it('does NOT delete lobby when host offline but disconnectedAt < 60s ago', async () => {
      const lobby = {
        ...BASE_LOBBY,
        host: { ...BASE_LOBBY.host, presence: false, disconnectedAt: Date.now() - 30_000 },
      };
      mockGet.mockResolvedValue(makeLobbySnap(lobby));

      const data = await checkLobby('ABC123');
      expect(data).toBeTruthy();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('does NOT delete lobby when host offline but guest is present', async () => {
      const lobby = {
        ...BASE_LOBBY,
        host: { ...BASE_LOBBY.host, presence: false, disconnectedAt: Date.now() - 120_000 },
        guests: { guest1: { uid: 'guest1', username: 'Guest', color: '#00ff00' } },
      };
      mockGet.mockResolvedValue(makeLobbySnap(lobby));

      const data = await checkLobby('ABC123');
      expect(data).toBeTruthy();
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  describe('Lobby Invites', () => {
    it('sendLobbyInvite writes to invites/{toUid}/{fromUid}', async () => {
      await sendLobbyInvite('fromUser', 'FromName', 'toUser', 'ABC123');
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'invites/toUser/fromUser' }),
        expect.objectContaining({ fromUsername: 'FromName', lobbyId: 'ABC123' })
      );
    });

    it('listenLobbyInvites parses invite map into array', () => {
      const callback = vi.fn();
      let onValueCb: ((snap: unknown) => void) | null = null;
      mockOnValue.mockImplementation((_ref: unknown, cb: (snap: unknown) => void) => {
        onValueCb = cb;
        return vi.fn();
      });

      listenLobbyInvites('myUid', callback);
      onValueCb!({
        exists: () => true,
        val: () => ({
          user1: { fromUsername: 'User1', lobbyId: 'L1', ts: 1000 },
          user2: { fromUsername: 'User2', lobbyId: 'L2', ts: 2000 },
        }),
      });

      expect(callback).toHaveBeenCalledWith([
        { fromUid: 'user1', fromUsername: 'User1', lobbyId: 'L1', ts: 1000 },
        { fromUid: 'user2', fromUsername: 'User2', lobbyId: 'L2', ts: 2000 },
      ]);
    });

    it('listenLobbyInvites returns empty array when no invites', () => {
      const callback = vi.fn();
      let onValueCb: ((snap: unknown) => void) | null = null;
      mockOnValue.mockImplementation((_ref: unknown, cb: (snap: unknown) => void) => {
        onValueCb = cb;
        return vi.fn();
      });

      listenLobbyInvites('myUid', callback);
      onValueCb!({ exists: () => false, val: () => null });
      expect(callback).toHaveBeenCalledWith([]);
    });

    it('clearLobbyInvite removes specific invite path', async () => {
      await clearLobbyInvite('myUid', 'fromUser');
      expect(mockRemove).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'invites/myUid/fromUser' })
      );
    });
  });

  describe('transferHost', () => {
    it('swaps host and guest data with presence: true', async () => {
      const newHost = { uid: 'guest1', username: 'Guest', color: '#00ff00' };
      const demotedHost = { uid: 'host1', username: 'Host', color: '#ff0000' };
      await transferHost('ABC123', newHost, demotedHost);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123' }),
        {
          host: { ...newHost, presence: true },
          'guests/guest1': null,
          'guests/host1': { ...demotedHost, presence: true },
        }
      );
    });
  });

  describe('switchPresence', () => {
    it('sets up new presence ref for given role', async () => {
      await switchPresence('ABC123', 'guest', 'guest1');
      expect(mockOnDisconnect).toHaveBeenCalled();
      const presenceCall = (mockSet as Mock).mock.calls.find((c: unknown[]) =>
        (c[0] as { __path: string }).__path?.includes('/guests/guest1/presence'));
      expect(presenceCall).toBeTruthy();
    });
  });

  describe('promoteToHost', () => {
    it('claims host when host node is missing (transaction succeeds)', async () => {
      mockRunTransaction.mockImplementation(async (_ref: unknown, fn: (val: unknown) => unknown) => {
        const result = fn(null);
        return { committed: true, snapshot: { val: () => result } };
      });

      const success = await promoteToHost('ABC123', 'guest1', 'Guest', '#00ff00');
      expect(success).toBe(true);
      // Should remove own guest entry
      expect(mockRemove).toHaveBeenCalledWith(
        expect.objectContaining({ __path: 'lobbies/ABC123/guests/guest1' })
      );
    });

    it('claims host when host presence is false', async () => {
      mockRunTransaction.mockImplementation(async (_ref: unknown, fn: (val: unknown) => unknown) => {
        const result = fn({ uid: 'oldHost', presence: false });
        return { committed: result !== undefined };
      });

      const success = await promoteToHost('ABC123', 'guest1', 'Guest', '#00ff00');
      expect(success).toBe(true);
    });

    it('aborts when host is back online (presence true)', async () => {
      mockRunTransaction.mockImplementation(async (_ref: unknown, fn: (val: unknown) => unknown) => {
        const result = fn({ uid: 'oldHost', presence: true });
        return { committed: result !== undefined };
      });

      const success = await promoteToHost('ABC123', 'guest1', 'Guest', '#00ff00');
      expect(success).toBe(false);
    });

    it('includes icon in promoted host data when provided', async () => {
      mockRunTransaction.mockImplementation(async (_ref: unknown, fn: (val: unknown) => unknown) => {
        const result = fn(null);
        return { committed: true, snapshot: { val: () => result } };
      });

      await promoteToHost('ABC123', 'guest1', 'Guest', '#00ff00', 'crown');
      const txFn = (mockRunTransaction as Mock).mock.calls[0][1];
      const payload = txFn(null);
      expect(payload.icon).toBe('crown');
    });

    it('returns false on transaction error', async () => {
      mockRunTransaction.mockRejectedValue(new Error('Network error'));
      const success = await promoteToHost('ABC123', 'guest1', 'Guest', '#00ff00');
      expect(success).toBe(false);
    });
  });

  describe('fetchPublicLobbies', () => {
    beforeEach(() => {
      mockGet.mockReset();
    });

    it('returns public waiting lobbies sorted newest first', async () => {
      mockGet.mockResolvedValueOnce({
        exists: () => true,
        val: () => ({
          LOBBY1: {
            host: { uid: 'h1', username: 'Alice', color: '#00ff00' },
            guests: { g1: { uid: 'g1', username: 'Bob', color: '#ff0000' } },
            settings: { seriesLength: 3, lobbySize: 4, invitePermission: 'public', allowAnonymous: true },
            status: 'waiting',
            createdAt: 1000,
          },
          LOBBY2: {
            host: { uid: 'h2', username: 'Carol', color: '#0000ff' },
            settings: { seriesLength: 1, lobbySize: 2, invitePermission: 'public', allowAnonymous: false },
            status: 'waiting',
            createdAt: 2000,
          },
        }),
      });

      const result = await fetchPublicLobbies();

      expect(result).toHaveLength(2);
      expect(result[0].lobbyId).toBe('LOBBY2');
      expect(result[0].hostName).toBe('Carol');
      expect(result[0].playerCount).toBe(1);
      expect(result[0].allowAnonymous).toBe(false);
      expect(result[0].status).toBe('waiting');
      expect(result[1].lobbyId).toBe('LOBBY1');
      expect(result[1].hostName).toBe('Alice');
      expect(result[1].playerCount).toBe(2);
      expect(result[1].allowAnonymous).toBe(true);
      expect(result[1].status).toBe('waiting');
    });

    it('excludes full lobbies', async () => {
      mockGet.mockResolvedValueOnce({
        exists: () => true,
        val: () => ({
          FULL: {
            host: { uid: 'h1', username: 'Host', color: '#fff' },
            guests: { g1: { uid: 'g1', username: 'G1', color: '#aaa' } },
            settings: { seriesLength: 1, lobbySize: 2, invitePermission: 'public', allowAnonymous: true },
            status: 'waiting',
            createdAt: 1000,
          },
        }),
      });

      const result = await fetchPublicLobbies();
      expect(result).toHaveLength(0);
    });

    it('returns empty array when no lobbies exist', async () => {
      mockGet.mockResolvedValueOnce({
        exists: () => false,
        val: () => null,
      });

      const result = await fetchPublicLobbies();
      expect(result).toEqual([]);
    });

    it('includes active lobbies with status field', async () => {
      mockGet.mockResolvedValueOnce({
        exists: () => true,
        val: () => ({
          ACTIVE: {
            host: { uid: 'h1', username: 'Host', color: '#fff' },
            guests: { g1: { uid: 'g1', username: 'G1', color: '#aaa' } },
            settings: { seriesLength: 1, lobbySize: 2, invitePermission: 'public', allowAnonymous: true },
            status: 'active',
            createdAt: 1000,
          },
        }),
      });

      const result = await fetchPublicLobbies();
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
      expect(result[0].playerCount).toBe(2);
    });

    it('excludes starting and returning lobbies', async () => {
      mockGet.mockResolvedValueOnce({
        exists: () => true,
        val: () => ({
          STARTING: {
            host: { uid: 'h1', username: 'Host', color: '#fff' },
            settings: { seriesLength: 1, lobbySize: 2, invitePermission: 'public', allowAnonymous: true },
            status: 'starting',
            createdAt: 1000,
          },
          RETURNING: {
            host: { uid: 'h2', username: 'Host2', color: '#fff' },
            settings: { seriesLength: 1, lobbySize: 2, invitePermission: 'public', allowAnonymous: true },
            status: 'returning',
            createdAt: 2000,
          },
        }),
      });

      const result = await fetchPublicLobbies();
      expect(result).toEqual([]);
    });

    it('shows active lobbies even when full (spectator join)', async () => {
      mockGet.mockResolvedValueOnce({
        exists: () => true,
        val: () => ({
          FULL_ACTIVE: {
            host: { uid: 'h1', username: 'Host', color: '#fff' },
            guests: { g1: { uid: 'g1', username: 'G1', color: '#aaa' } },
            settings: { seriesLength: 1, lobbySize: 2, invitePermission: 'public', allowAnonymous: true },
            status: 'active',
            createdAt: 1000,
          },
        }),
      });

      const result = await fetchPublicLobbies();
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('active');
    });

    it('sorts waiting lobbies before active, newest first within each', async () => {
      mockGet.mockResolvedValueOnce({
        exists: () => true,
        val: () => ({
          ACTIVE_OLD: {
            host: { uid: 'h1', username: 'A', color: '#fff' },
            settings: { seriesLength: 1, lobbySize: 4, invitePermission: 'public', allowAnonymous: true },
            status: 'active',
            createdAt: 1000,
          },
          WAITING_NEW: {
            host: { uid: 'h2', username: 'B', color: '#fff' },
            settings: { seriesLength: 1, lobbySize: 4, invitePermission: 'public', allowAnonymous: true },
            status: 'waiting',
            createdAt: 3000,
          },
          ACTIVE_NEW: {
            host: { uid: 'h3', username: 'C', color: '#fff' },
            settings: { seriesLength: 1, lobbySize: 4, invitePermission: 'public', allowAnonymous: true },
            status: 'active',
            createdAt: 2000,
          },
        }),
      });

      const result = await fetchPublicLobbies();
      expect(result).toHaveLength(3);
      expect(result[0].lobbyId).toBe('WAITING_NEW');   // waiting first
      expect(result[1].lobbyId).toBe('ACTIVE_NEW');     // active, newest
      expect(result[2].lobbyId).toBe('ACTIVE_OLD');     // active, oldest
    });

    it('excludes private and invite-only lobbies', async () => {
      mockGet.mockResolvedValueOnce({
        exists: () => true,
        val: () => ({
          PRIVATE: {
            host: { uid: 'h1', username: 'Host', color: '#fff' },
            settings: { seriesLength: 1, lobbySize: 2, invitePermission: 'private', allowAnonymous: true },
            status: 'waiting',
            createdAt: 1000,
          },
          INVITE: {
            host: { uid: 'h2', username: 'Host2', color: '#fff' },
            settings: { seriesLength: 1, lobbySize: 2, invitePermission: 'invite', allowAnonymous: true },
            status: 'waiting',
            createdAt: 2000,
          },
        }),
      });

      const result = await fetchPublicLobbies();
      expect(result).toEqual([]);
    });
  });
});
