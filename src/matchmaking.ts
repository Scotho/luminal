// ── Matchmaking System ───────────────────────────────────
import { db, rtdb } from './firebase';
import {
  doc, setDoc, deleteDoc, getDoc, getDocs,
  collection, runTransaction, onSnapshot,
} from 'firebase/firestore';
import { ref, set, get, onDisconnect, onValue, remove, query as rtdbQuery, limitToFirst, runTransaction as rtdbRunTransaction } from 'firebase/database';
import type { QueueEntry, MatchFoundData, OnlineMatchDoc, MapType } from './types/index';
import type { DocumentData, QueryDocumentSnapshot, Unsubscribe } from 'firebase/firestore';
import type { DatabaseReference, Unsubscribe as RTDBUnsubscribe } from 'firebase/database';
import { net } from './netLog';
import { swallow, warnDev } from './swallow';

let queueUnsub: Unsubscribe | null = null;
let matchCheckInterval: ReturnType<typeof setInterval> | null = null;
let queuePresenceRef: DatabaseReference | null = null;
let _onMatchCallback: ((data: MatchFoundData) => void) | null = null;
let _searching: boolean = false;

const QUEUE_STALE_MS: number = 90000; // 90s

// ── Enter Queue ──────────────────────────────────────────
export async function enterQueue(
  uid: string,
  username: string,
  color: string,
  mapVote: MapType | null = null,
): Promise<void> {
  net.log(`enterQueue uid=${uid} name=${username} map=${mapVote ?? 'none'}`);
  // Clear any stale presence from a prior session (e.g. different tab/device)
  const oldPresRef = ref(rtdb, `queuePresence/${uid}`);
  await remove(oldPresRef).catch(swallow('matchmaking'));

  // Write presence FIRST so other players' pruneStaleQueue doesn't
  // delete our queue doc before we appear as online
  queuePresenceRef = ref(rtdb, `queuePresence/${uid}`);
  await set(queuePresenceRef, Date.now());
  onDisconnect(queuePresenceRef).remove();

  // Clean own stale entry
  try { await deleteDoc(doc(db, 'queue', uid)); } catch (e) { warnDev('matchmaking', e); }
  await pruneStaleQueue();

  await setDoc(doc(db, 'queue', uid), {
    uid,
    username,
    color,
    status: 'waiting',
    joinedAt: Date.now(),
    mapVote: mapVote ?? null,
  });

  _searching = true;
  startMatchSearch(uid, username, color);
}

// ── Leave Queue ──────────────────────────────────────────
export async function leaveQueue(uid: string): Promise<void> {
  net.log(`leaveQueue uid=${uid}`);
  _searching = false;
  stopMatchSearch();
  try { await deleteDoc(doc(db, 'queue', uid)); } catch (e) { warnDev('matchmaking', e); }
  if (queuePresenceRef) {
    await remove(queuePresenceRef).catch(swallow('matchmaking'));
    queuePresenceRef = null;
  }
}

// ── Remove both players from queue (call when match actually starts) ──
export async function confirmMatchStarted(uid1: string, uid2: string): Promise<void> {
  await deleteDoc(doc(db, 'queue', uid1)).catch(swallow('matchmaking'));
  await deleteDoc(doc(db, 'queue', uid2)).catch(swallow('matchmaking'));
  await remove(ref(rtdb, `queuePresence/${uid1}`)).catch(swallow('matchmaking'));
  await remove(ref(rtdb, `queuePresence/${uid2}`)).catch(swallow('matchmaking'));
}

// ── Remove a player's queue doc (for cleaning up opponent entries) ──
export async function removeFromQueue(uid: string): Promise<void> {
  try { await deleteDoc(doc(db, 'queue', uid)); } catch (e) { warnDev('matchmaking', e); }
}

// ── Prune stale queue entries ────────────────────────────
async function pruneStaleQueue(): Promise<void> {
  try {
    const presSnap = await get(rtdbQuery(ref(rtdb, 'queuePresence'), limitToFirst(500)));
    const onlineUids: Set<string> = new Set();
    if (presSnap.exists()) {
      Object.keys(presSnap.val()).forEach((uid: string) => onlineUids.add(uid));
    }

    const qSnap = await getDocs(collection(db, 'queue'));
    const now: number = Date.now();

    qSnap.forEach((d: QueryDocumentSnapshot<DocumentData>) => {
      const data = d.data() as QueueEntry;
      const age: number = now - (data.joinedAt || 0);
      if (!onlineUids.has(d.id) || age > QUEUE_STALE_MS) {
        deleteDoc(doc(db, 'queue', d.id)).catch(swallow('matchmaking'));
      }
    });
  } catch (e) { warnDev('matchmaking', e); }
}

// ── Match Search (polling) ───────────────────────────────
function startMatchSearch(myUid: string, myUsername: string, myColor: string): void {
  matchCheckInterval = setInterval(async (): Promise<void> => {
    if (!_searching) return;
    try { await tryFindMatch(myUid, myUsername, myColor); } catch (e) { warnDev('matchmaking', e); }
  }, 2000);
  tryFindMatch(myUid, myUsername, myColor);
}

async function tryFindMatch(myUid: string, myUsername: string, myColor: string): Promise<void> {
  if (!_searching) return;

  const presSnap = await get(rtdbQuery(ref(rtdb, 'queuePresence'), limitToFirst(500)));
  const onlineUids: Set<string> = new Set();
  if (presSnap.exists()) {
    Object.keys(presSnap.val()).forEach((uid: string) => onlineUids.add(uid));
  }

  const snap = await getDocs(collection(db, 'queue'));
  const now: number = Date.now();
  const candidates: QueueEntry[] = [];

  snap.forEach((d: QueryDocumentSnapshot<DocumentData>) => {
    const data = d.data() as QueueEntry;
    if (d.id === myUid) return;
    const age: number = now - (data.joinedAt || 0);

    // Only match with 'waiting' candidates that are online and not stale
    if (data.status === 'waiting' && onlineUids.has(d.id) && age < QUEUE_STALE_MS) {
      candidates.push(data);
    } else if (!onlineUids.has(d.id) || age > QUEUE_STALE_MS) {
      deleteDoc(doc(db, 'queue', d.id)).catch(swallow('matchmaking'));
    }
  });

  if (candidates.length === 0) return;

  candidates.sort((a: QueueEntry, b: QueueEntry) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const opponent: QueueEntry = candidates[0];

  // Stop polling to prevent double-matching race, but keep the passive
  // listenForMatch listener alive so the other player can still notify us
  if (matchCheckInterval) { clearInterval(matchCheckInterval); matchCheckInterval = null; }

  try {
    const result = await createMatch(myUid, myUsername, myColor, opponent);
    if (result) {
      _searching = false;
      stopMatchSearch();
      if (_onMatchCallback) _onMatchCallback({
        matchId: result.matchId,
        seed: result.seed,
        opponents: [{
          uid: opponent.uid,
          name: opponent.username,
          color: opponent.color,
          mapVote: result.oppMapVote,
        }],
        isInitiator: true,
        myMapVote: result.myMapVote,
      });
      return;
    }
  } catch (err) {
    net.warn('matchmaking: createMatch failed — will check for incoming match', err);
  }

  // createMatch failed or returned undefined — check if we were matched by someone else.
  // Guard: if listenForMatch already handled this (set _searching = false), skip.
  if (!_searching) return;
  try {
    const mySnap = await getDoc(doc(db, 'queue', myUid));
    // Re-check after await — listenForMatch may have fired during getDoc
    if (!_searching) return;
    if (mySnap.exists() && mySnap.data()!.status === 'matched' && mySnap.data()!.matchId) {
      _searching = false;
      stopMatchSearch();
      // Direct get by known matchId — avoids secondary index propagation delay
      const matchId: string = mySnap.data()!.matchId;
      const matchSnap = await getDoc(doc(db, 'onlineMatches', matchId));
      if (matchSnap.exists() && _onMatchCallback) {
        const match = { ...(matchSnap.data() as OnlineMatchDoc), id: matchSnap.id };
        const opponents = match.players.filter(p => p.uid !== myUid);
        const me = match.players.find(p => p.uid === myUid);
        _onMatchCallback({
          matchId: match.id,
          opponents: opponents.map(o => ({ uid: o.uid, name: o.username, color: o.color, mapVote: o.mapVote ?? null })),
          seed: match.seed,
          isInitiator: false,
          myMapVote: me?.mapVote ?? null,
        });
        return;
      }
    }
  } catch (e) { warnDev('matchmaking', e); }

  // Neither worked — resume searching (unless listenForMatch handled it)
  if (!_searching) return;
  _searching = true;
  startMatchSearch(myUid, myUsername, myColor);
}

function stopMatchSearch(): void {
  if (matchCheckInterval) { clearInterval(matchCheckInterval); matchCheckInterval = null; }
  if (queueUnsub) { queueUnsub(); queueUnsub = null; }
}

// ── Create Match (Firestore Transaction) ─────────────────
// Marks both as 'matched' instead of deleting — prevents re-matching
async function createMatch(
  myUid: string,
  myUsername: string,
  myColor: string,
  opponent: QueueEntry,
): Promise<{ matchId: string; seed: number; myMapVote: MapType | null; oppMapVote: MapType | null } | undefined> {
  const matchId: string = generateMatchId();
  net.info(`createMatch id=${matchId} me=${myUid} vs ${opponent.uid} (${opponent.username})`);
  const seed: number = Math.floor(Math.random() * 2147483647);

  // Write RTDB meta FIRST — if this fails, Firestore is never touched.
  // Use an RTDB transaction to atomically check-and-set: if another client
  // already created a match for the same pair, bail out (BUG-4 fix).
  const metaRef: DatabaseReference = ref(rtdb, `matches/${matchId}/meta`);
  const metaPayload = {
    players: [myUid, opponent.uid],
    seriesLength: 3,
    status: 'pending',
    round: 1,
    scores: { [myUid]: 0, [opponent.uid]: 0 },
    seed,
  };
  const { committed } = await rtdbRunTransaction(metaRef, (current: unknown) => {
    if (current !== null) {
      // Another client already created this match entry — abort
      return undefined;
    }
    return metaPayload;
  });
  if (!committed) {
    net.info(`createMatch aborted — RTDB entry already exists for ${matchId}`);
    return undefined;
  }

  let myMapVote: MapType | null = null;
  const oppMapVote: MapType | null = opponent.mapVote ?? null;

  await runTransaction(db, async (transaction) => {
    const myDoc = await transaction.get(doc(db, 'queue', myUid));
    const oppDoc = await transaction.get(doc(db, 'queue', opponent.uid));

    if (!myDoc.exists() || !oppDoc.exists()) throw new Error('Gone');
    if (myDoc.data().status !== 'waiting' || oppDoc.data().status !== 'waiting') {
      throw new Error('Already matched');
    }

    // Capture map votes from the authoritative queue docs — opponent.mapVote
    // from the candidate snapshot may be stale by a poll interval.
    myMapVote = (myDoc.data() as QueueEntry).mapVote ?? null;
    const oppMapVoteFresh: MapType | null = (oppDoc.data() as QueueEntry).mapVote ?? null;

    // Mark both as matched (not deleted — so they can be restored on timeout)
    transaction.update(doc(db, 'queue', myUid), { status: 'matched', matchId });
    transaction.update(doc(db, 'queue', opponent.uid), { status: 'matched', matchId });

    transaction.set(doc(db, 'onlineMatches', matchId), {
      id: matchId,
      players: [
        { uid: myUid, username: myUsername, color: myColor, mapVote: myMapVote },
        { uid: opponent.uid, username: opponent.username, color: opponent.color, mapVote: oppMapVoteFresh },
      ],
      seed,
      seriesLength: 3,
      status: 'pending',
      createdAt: Date.now(),
    });
  });

  return { matchId, seed, myMapVote, oppMapVote };
}

// ── Listen for being matched (passive side) ──────────────
export function listenForMatch(myUid: string, callback: (data: MatchFoundData) => void): void {
  // Clean up any previous listener to prevent orphaned subscriptions
  if (queueUnsub) { queueUnsub(); queueUnsub = null; }
  queueUnsub = onSnapshot(doc(db, 'queue', myUid), async (snap) => {
    if (!snap.exists()) return;
    const data = snap.data() as QueueEntry;
    if (data.status === 'matched' && data.matchId && _searching) {
      net.info(`matchFound (passive) matchId=${data.matchId}`);
      _searching = false;
      stopMatchSearch();
      // Use direct get by known matchId — avoids secondary index propagation delay
      const matchSnap = await getDoc(doc(db, 'onlineMatches', data.matchId));
      if (matchSnap.exists() && callback) {
        const match = { ...(matchSnap.data() as OnlineMatchDoc), id: matchSnap.id };
        const opponents = match.players.filter(p => p.uid !== myUid);
        const me = match.players.find(p => p.uid === myUid);
        callback({
          matchId: match.id,
          opponents: opponents.map(o => ({ uid: o.uid, name: o.username, color: o.color, mapVote: o.mapVote ?? null })),
          seed: match.seed,
          isInitiator: false,
          myMapVote: me?.mapVote ?? null,
        });
      }
    }
  });
}

function generateMatchId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function onMatchFound(callback: (data: MatchFoundData) => void): void { _onMatchCallback = callback; }

export function onQueueCount(callback: (count: number) => void): RTDBUnsubscribe {
  const qRef: DatabaseReference = ref(rtdb, 'queuePresence');
  return onValue(qRef, (snap) => {
    const val = snap.val();
    callback(val ? Object.keys(val).length : 0);
  });
}
