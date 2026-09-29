// ── Private Lobby System ──────────────────────────────────
// Host creates a lobby, gets a shareable link. Guest joins via link.
// Host sees who joined and can start the match.

import { rtdb, auth } from './firebase';
import { ref, set, get, onValue, remove, onDisconnect, update, serverTimestamp, runTransaction, query, orderByChild, limitToLast } from 'firebase/database';
import type { LobbyData, LobbyPlayer, PublicLobbyInfo } from './types/index';
import { getGuestCount } from './types/index';
import type { DatabaseReference, Unsubscribe } from 'firebase/database';

let _lobbyUnsub: Unsubscribe | null = null;
let _presenceRef: DatabaseReference | null = null;
let _disconnectRef: ReturnType<typeof onDisconnect> | null = null;

function generateLobbyId(): string {
  // Short 6-char code for easy sharing
  const chars: string = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for clarity
  let code: string = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Create a new lobby as host
export async function createLobby(uid: string, username: string, color: string, settings: { seriesLength?: number; lobbySize?: number } = {}, icon?: string): Promise<string> {
  const lobbyId: string = generateLobbyId();
  const lobbyRef: DatabaseReference = ref(rtdb, `lobbies/${lobbyId}`);

  await set(lobbyRef, {
    host: { uid, username, color, ...(icon ? { icon } : {}) },
    settings: {
      seriesLength: settings.seriesLength ?? 1,
      lobbySize: settings.lobbySize ?? 2,
      invitePermission: 'invite',
      allowAnonymous: true,
    },
    status: 'waiting', // waiting, starting, active
    createdAt: Date.now(),
  });

  // Set presence — on disconnect just flag offline (don't delete lobby)
  _presenceRef = ref(rtdb, `lobbies/${lobbyId}/host/presence`);
  await set(_presenceRef, true);
  _disconnectRef = onDisconnect(_presenceRef);
  _disconnectRef.set(false);

  // Also write disconnectedAt timestamp on disconnect for auto-cleanup
  const dcRef = ref(rtdb, `lobbies/${lobbyId}/host/disconnectedAt`);
  await set(dcRef, null); // clear initially
  onDisconnect(dcRef).set(serverTimestamp());

  return lobbyId;
}

// Join an existing lobby as guest
export async function joinLobby(lobbyId: string, uid: string, username: string, color: string, icon?: string): Promise<LobbyData> {
  // Pre-fetch lobby to validate state (also primes local cache for the transaction).
  // Without this, runTransaction can receive null on its first call when the guest's
  // client has never fetched this path — a well-known Firebase RTDB gotcha.
  const lobbyRef: DatabaseReference = ref(rtdb, `lobbies/${lobbyId}`);
  const snap = await get(lobbyRef);
  if (!snap.exists()) throw new Error('Lobby not found');
  const data = migrateLobbyData(snap.val());
  const isActive = data.status === 'active';
  if (data.status !== 'waiting' && !isActive) throw new Error('Lobby is no longer open');
  if (data.host.uid === uid) throw new Error('You are the host');

  // Block anonymous users if host disabled anonymous access
  if (data.settings.allowAnonymous === false && auth.currentUser?.isAnonymous) {
    throw new Error('Sign in to join this lobby');
  }

  // If joining mid-match, flag as spectator so they don't participate until next round
  const guestPayload: LobbyPlayer = { uid, username, color, ...(icon ? { icon } : {}), ...(isActive ? { spectating: true } : {}) };

  // Capacity: only reject at hard cap of 4. Below that, let the guest in —
  // the host's UI auto-expands lobbySize when it detects a new guest joined.
  // NOTE: This check is outside the transaction, so rapid concurrent joins could
  // theoretically exceed the cap. The per-UID transaction prevents duplicate slots
  // but not total count overflow. Acceptable at current scale (<100 concurrent users).
  const MAX_LOBBY_SIZE = 4;
  const guestCount = getGuestCount(data);
  const isNewJoin = data.guests?.[uid] === undefined;
  if (isNewJoin && 1 + guestCount >= MAX_LOBBY_SIZE) {
    throw new Error('Lobby is full');
  }

  // Claim guest slot atomically via transaction on guests/{uid}.
  // Writing per-UID prevents collisions between different joining players.
  const guestRef: DatabaseReference = ref(rtdb, `lobbies/${lobbyId}/guests/${uid}`);
  let claimError: string | null = null;
  const result = await runTransaction(guestRef, (current: LobbyPlayer | null) => {
    if (current && current.uid !== uid) { claimError = 'Lobby is full'; return undefined; }
    return guestPayload;
  });
  if (!result.committed) throw new Error(claimError || 'Lobby is full');

  // Set presence — on disconnect just flag offline (don't delete guest)
  _presenceRef = ref(rtdb, `lobbies/${lobbyId}/guests/${uid}/presence`);
  await set(_presenceRef, true);
  _disconnectRef = onDisconnect(_presenceRef);
  _disconnectRef.set(false);

  // Return full lobby state
  const updatedSnap = await get(lobbyRef);
  return migrateLobbyData(updatedSnap.val());
}

// Kick a player from the lobby (host action — removes specific guest)
export async function kickPlayer(lobbyId: string, guestUid: string): Promise<void> {
  await remove(ref(rtdb, `lobbies/${lobbyId}/guests/${guestUid}`));
}

// Leave a lobby (guest only — host leaving destroys it)
export async function leaveLobby(lobbyId: string, uid: string, isHost: boolean): Promise<void> {
  stopListening();
  // Cancel onDisconnect so it doesn't fire after intentional leave
  if (_disconnectRef) { _disconnectRef.cancel().catch(e => console.warn('lobby: cancel onDisconnect', e)); _disconnectRef = null; }
  if (isHost) {
    await remove(ref(rtdb, `lobbies/${lobbyId}`)).catch(e => console.warn('lobby: remove lobby', e));
  } else {
    await remove(ref(rtdb, `lobbies/${lobbyId}/guests/${uid}`)).catch(e => console.warn('lobby: remove guest', e));
  }
  _presenceRef = null;
}

// Rejoin a lobby after page refresh — re-establish presence + onDisconnect
export async function rejoinLobby(lobbyId: string, uid: string, role: 'host' | 'guest'): Promise<LobbyData | null> {
  const data = await checkLobby(lobbyId);
  if (!data) return null;

  // Verify we're still the right player
  if (role === 'host' && data.host.uid !== uid) return null;
  if (role === 'guest' && !data.guests?.[uid]) return null;

  // Re-establish presence
  const presencePath = role === 'host' ? `lobbies/${lobbyId}/host/presence` : `lobbies/${lobbyId}/guests/${uid}/presence`;
  _presenceRef = ref(rtdb, presencePath);
  await set(_presenceRef, true);
  _disconnectRef = onDisconnect(_presenceRef);
  _disconnectRef.set(false);

  return data;
}

// Host starts the match
export async function startLobbyMatch(lobbyId: string): Promise<void> {
  await set(ref(rtdb, `lobbies/${lobbyId}/status`), 'starting');
}

// Host returns all players to the lobby
export async function returnPartyToLobby(lobbyId: string): Promise<void> {
  await set(ref(rtdb, `lobbies/${lobbyId}/status`), 'returning');
}

// Listen for lobby state changes (both host and guest use this)
export function listenToLobby(lobbyId: string, callback: (data: LobbyData | null) => void): void {
  stopListening();
  const lobbyRef: DatabaseReference = ref(rtdb, `lobbies/${lobbyId}`);
  _lobbyUnsub = onValue(lobbyRef, (snap) => {
    if (!snap.exists()) {
      callback(null); // lobby was destroyed
      return;
    }
    callback(migrateLobbyData(snap.val()));
  });
}

// Update a player's fields (e.g. color) in real-time
export async function updateLobbyPlayer(lobbyId: string, role: 'host' | 'guest', updates: Partial<LobbyPlayer>, uid?: string): Promise<void> {
  const path = role === 'host' ? `lobbies/${lobbyId}/host` : `lobbies/${lobbyId}/guests/${uid}`;
  await update(ref(rtdb, path), updates);
}

// Update lobby settings (host only)
export async function updateLobbySettings(lobbyId: string, settings: Partial<LobbyData['settings']>): Promise<void> {
  await update(ref(rtdb, `lobbies/${lobbyId}/settings`), settings);
}

// Sync AI slots to Firebase (host only) — pass null to clear all
export async function updateLobbyAis(lobbyId: string, ais: Record<string, { name: string; color: string; vehicle: string }> | null): Promise<void> {
  await set(ref(rtdb, `lobbies/${lobbyId}/ais`), ais);
}

// Stop listening to lobby changes
export function stopListening(): void {
  if (_lobbyUnsub) {
    _lobbyUnsub();
    _lobbyUnsub = null;
  }
}

/** One-shot fetch of public, joinable lobbies (waiting + active). Capped to 200 most recent. */
export async function fetchPublicLobbies(): Promise<PublicLobbyInfo[]> {
  const lobbiesRef = query(ref(rtdb, 'lobbies'), orderByChild('createdAt'), limitToLast(200));
  const snap = await get(lobbiesRef);
  if (!snap.exists()) return [];

  const all = snap.val() as Record<string, LobbyData>;
  const results: PublicLobbyInfo[] = [];

  for (const [lobbyId, lobby] of Object.entries(all)) {
    if (lobby.settings?.invitePermission !== 'public') continue;
    const isWaiting = lobby.status === 'waiting';
    const isActive = lobby.status === 'active';
    if (!isWaiting && !isActive) continue;
    const guestCount = lobby.guests ? Object.keys(lobby.guests).length : 0;
    const playerCount = 1 + guestCount;
    const lobbySize = lobby.settings.lobbySize ?? 2;
    // Waiting lobbies: exclude if full. Active lobbies: always show (join as spectator).
    if (isWaiting && playerCount >= lobbySize) continue;

    results.push({
      lobbyId,
      hostName: lobby.host.username,
      hostColor: lobby.host.color,
      seriesLength: lobby.settings.seriesLength,
      lobbySize,
      playerCount,
      allowAnonymous: lobby.settings.allowAnonymous !== false,
      status: lobby.status as 'waiting' | 'active',
      createdAt: lobby.createdAt,
    });
  }

  // Waiting lobbies first, then active; within each group, newest first
  results.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'waiting' ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
  return results;
}

// Check if a lobby exists — also auto-cleans orphaned lobbies
const ORPHAN_TIMEOUT_MS = 60_000; // 60 seconds

export async function checkLobby(lobbyId: string): Promise<LobbyData | null> {
  const snap = await get(ref(rtdb, `lobbies/${lobbyId}`));
  if (!snap.exists()) return null;

  const data = migrateLobbyData(snap.val());

  // Auto-cleanup: if host is offline and disconnectedAt is old enough → delete
  // Guest presence doesn't matter — if the host is gone, the lobby is orphaned.
  if (data.host?.presence === false) {
    const dcAt = data.host?.disconnectedAt;
    const guestAlive = data.guests && Object.values(data.guests).some(g => g.presence !== false);
    // Use 2x margin to tolerate client/server clock skew
    if (dcAt && typeof dcAt === 'number' && Date.now() - dcAt > ORPHAN_TIMEOUT_MS * 2 && !guestAlive) {
      await remove(ref(rtdb, `lobbies/${lobbyId}`)).catch(() => {});
      return null;
    }
  }

  return data;
}

// Get the invite URL for a lobby
export function getLobbyUrl(lobbyId: string): string {
  return `${window.location.origin}/?lobby=${lobbyId}`;
}

// ── Lobby Invites (push to specific friends via RTDB) ────

let _inviteUnsub: Unsubscribe | null = null;

export async function sendLobbyInvite(fromUid: string, fromUsername: string, toUid: string, lobbyId: string): Promise<void> {
  await set(ref(rtdb, `invites/${toUid}/${fromUid}`), { fromUsername, lobbyId, ts: Date.now() });
}

export interface LobbyInviteData { fromUid: string; fromUsername: string; lobbyId: string; ts: number }

export function listenLobbyInvites(myUid: string, callback: (invites: LobbyInviteData[]) => void): void {
  stopListeningInvites();
  const invitesRef: DatabaseReference = ref(rtdb, `invites/${myUid}`);
  _inviteUnsub = onValue(invitesRef, (snap) => {
    const invites: LobbyInviteData[] = [];
    if (snap.exists()) {
      const data = snap.val() as Record<string, { fromUsername: string; lobbyId: string; ts: number }>;
      for (const [fromUid, val] of Object.entries(data)) {
        invites.push({ fromUid, fromUsername: val.fromUsername, lobbyId: val.lobbyId, ts: val.ts });
      }
    }
    callback(invites);
  });
}

export function stopListeningInvites(): void {
  if (_inviteUnsub) { _inviteUnsub(); _inviteUnsub = null; }
}

export async function clearLobbyInvite(myUid: string, fromUid: string): Promise<void> {
  await remove(ref(rtdb, `invites/${myUid}/${fromUid}`)).catch(() => {});
}

// ── Transfer Host (voluntary promotion) ─────────────────
/** Host voluntarily transfers host role to a guest. */
export async function transferHost(lobbyId: string, newHost: LobbyPlayer, demotedHost: LobbyPlayer): Promise<void> {
  await update(ref(rtdb, `lobbies/${lobbyId}`), {
    host: { ...newHost, presence: true },
    [`guests/${newHost.uid}`]: null, // remove promoted guest
    [`guests/${demotedHost.uid}`]: { ...demotedHost, presence: true }, // add demoted host as guest
  });
}

// ── Switch Presence ref after role change ────────────────
export async function switchPresence(lobbyId: string, newRole: 'host' | 'guest', uid?: string): Promise<void> {
  if (_disconnectRef) { _disconnectRef.cancel().catch(() => {}); _disconnectRef = null; }
  const path = newRole === 'host' ? `lobbies/${lobbyId}/host/presence` : `lobbies/${lobbyId}/guests/${uid}/presence`;
  _presenceRef = ref(rtdb, path);
  await set(_presenceRef, true);
  _disconnectRef = onDisconnect(_presenceRef);
  _disconnectRef.set(false);
}

// ── Host Promotion (on host DC) ─────────────────────────
/** Attempt to promote self to host when current host's presence is false.
 *  Uses a transaction for first-write-wins in multi-player lobbies. */
export async function promoteToHost(lobbyId: string, uid: string, username: string, color: string, icon?: string): Promise<boolean> {
  const hostRef = ref(rtdb, `lobbies/${lobbyId}/host`);
  try {
    const result = await runTransaction(hostRef, (currentHost: LobbyPlayer | null) => {
      if (!currentHost) {
        // Host node missing — claim it
        return { uid, username, color, ...(icon ? { icon } : {}), presence: true };
      }
      if (currentHost.presence === false) {
        // Host is offline — take over
        return { uid, username, color, ...(icon ? { icon } : {}), presence: true };
      }
      // Host is back online — abort
      return undefined;
    });

    if (result.committed) {
      // Clear our guest entry (we moved from guest to host)
      await remove(ref(rtdb, `lobbies/${lobbyId}/guests/${uid}`)).catch(() => {});
      // Re-establish presence as host
      _presenceRef = ref(rtdb, `lobbies/${lobbyId}/host/presence`);
      await set(_presenceRef, true);
      _disconnectRef = onDisconnect(_presenceRef);
      _disconnectRef.set(false);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Promote a spectating guest to a full participant (remove spectating flag)
export async function promoteSpectator(lobbyId: string, guestUid: string): Promise<void> {
  await set(ref(rtdb, `lobbies/${lobbyId}/guests/${guestUid}/spectating`), null);
}

// ── Migration: old single-guest → multi-guest record ────
/** Convert legacy `guest` field to `guests` record. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateLobbyData(raw: any): LobbyData {
  const data = raw as LobbyData & { guest?: LobbyPlayer | null };
  if (data.guest && !data.guests) {
    data.guests = { [data.guest.uid]: data.guest };
  }
  delete data.guest;
  return data;
}
