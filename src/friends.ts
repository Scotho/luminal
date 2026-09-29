// ── Friends System ───────────────────────────────────────
import { db } from './firebase';
import {
  doc, setDoc, getDoc, deleteDoc, collection,
  query, orderBy, onSnapshot, Timestamp,
} from 'firebase/firestore';
import type { FriendRequest, FriendEntry } from './types/index';

type Unsubscribe = (() => void) | null;

let _requestsUnsub: Unsubscribe = null;
let _friendsUnsub: Unsubscribe = null;

// Send a friend request
export async function sendFriendRequest(
  fromUid: string,
  fromUsername: string,
  toUid: string,
  toUsername: string,
): Promise<'sent' | 'accepted'> {
  // Check not already friends
  const existing = await getDoc(doc(db, 'friends', fromUid, 'list', toUid));
  if (existing.exists()) throw new Error('Already friends');

  // Check not already requested
  const existingReq = await getDoc(doc(db, 'friends', toUid, 'requests', fromUid));
  if (existingReq.exists()) throw new Error('Request already sent');

  // Check if they already sent us a request — auto-accept
  const reverseReq = await getDoc(doc(db, 'friends', fromUid, 'requests', toUid));
  if (reverseReq.exists()) {
    await acceptFriendRequest(fromUid, fromUsername, toUid, toUsername);
    return 'accepted';
  }

  await setDoc(doc(db, 'friends', toUid, 'requests', fromUid), {
    fromUid,
    fromUsername,
    timestamp: Timestamp.now(),
  });
  return 'sent';
}

// Accept a friend request
export async function acceptFriendRequest(
  myUid: string,
  myUsername: string,
  fromUid: string,
  fromUsername: string,
): Promise<void> {
  // Add to both friends lists
  const now = Timestamp.now();
  await setDoc(doc(db, 'friends', myUid, 'list', fromUid), {
    uid: fromUid,
    username: fromUsername,
    addedAt: now,
  });
  await setDoc(doc(db, 'friends', fromUid, 'list', myUid), {
    uid: myUid,
    username: myUsername,
    addedAt: now,
  });

  // Remove the request from both directions
  await deleteDoc(doc(db, 'friends', myUid, 'requests', fromUid)).catch(() => {});
  await deleteDoc(doc(db, 'friends', fromUid, 'requests', myUid)).catch(() => {});
}

// Deny / dismiss a friend request
export async function denyFriendRequest(myUid: string, fromUid: string): Promise<void> {
  await deleteDoc(doc(db, 'friends', myUid, 'requests', fromUid));
}

// Remove a friend
export async function removeFriend(myUid: string, friendUid: string): Promise<void> {
  await deleteDoc(doc(db, 'friends', myUid, 'list', friendUid));
  await deleteDoc(doc(db, 'friends', friendUid, 'list', myUid)).catch(() => {});
}

// Listen for incoming friend requests (real-time)
export function listenRequests(
  myUid: string,
  callback: (requests: (FriendRequest & { id: string })[]) => void,
): void {
  stopListeningRequests();
  const q = query(collection(db, 'friends', myUid, 'requests'), orderBy('timestamp', 'desc'));
  _requestsUnsub = onSnapshot(q, (snap) => {
    const requests: (FriendRequest & { id: string })[] = [];
    snap.forEach(d => {
      requests.push({ id: d.id, ...d.data() } as FriendRequest & { id: string });
    });
    callback(requests);
  });
}

// Listen for friends list (real-time)
export function listenFriends(
  myUid: string,
  callback: (friends: (FriendEntry & { id: string })[]) => void,
): void {
  stopListeningFriends();
  const q = query(collection(db, 'friends', myUid, 'list'), orderBy('addedAt', 'desc'));
  _friendsUnsub = onSnapshot(q, (snap) => {
    const friends: (FriendEntry & { id: string })[] = [];
    snap.forEach(d => {
      friends.push({ id: d.id, ...d.data() } as FriendEntry & { id: string });
    });
    callback(friends);
  });
}

// Look up a user by username for adding friends
export async function findUserByUsername(
  username: string,
): Promise<{ uid: string; username: string } | null> {
  const snap = await getDoc(doc(db, 'usernames', username));
  if (!snap.exists()) return null;
  return { uid: snap.data().uid, username };
}

export function stopListeningRequests(): void {
  if (_requestsUnsub) { _requestsUnsub(); _requestsUnsub = null; }
}

export function stopListeningFriends(): void {
  if (_friendsUnsub) { _friendsUnsub(); _friendsUnsub = null; }
}

export function stopAll(): void {
  stopListeningRequests();
  stopListeningFriends();
}
