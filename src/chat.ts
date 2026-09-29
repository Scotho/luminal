// ── Global Chat ──────────────────────────────────────────
import { db } from './firebase';
import {
  collection, addDoc, query, orderBy, limit, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { isBlocked } from './contentFilter';
import type { ChatMessage } from './types/index';

type Unsubscribe = (() => void) | null;

const chatRef = collection(db, 'chat');
let unsubscribe: Unsubscribe = null;

// Send a message — returns { ok } or { error }
export async function sendMessage(
  uid: string,
  username: string,
  text: string,
  icon?: string,
): Promise<{ ok?: boolean; error?: string }> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 200) return { error: 'Message too long or empty' };
  if (!uid || !username) return { error: 'You must be logged in to chat' };

  if (isBlocked(trimmed)) {
    return { error: 'Message not sent' };
  }

  try {
    await addDoc(chatRef, {
      uid,
      username,
      text: trimmed,
      timestamp: Timestamp.now(),
      ...(icon ? { icon } : {}),
    });
    return { ok: true };
  } catch (e: unknown) {
    return { error: (e instanceof Error ? e.message : null) || 'Failed to send' };
  }
}

// Listen to recent messages — calls callback(messages[]) on each update
// messages = [{ uid, username, text, timestamp }, ...] newest last
export function onMessages(callback: (messages: ChatMessage[]) => void): void {
  const q = query(chatRef, orderBy('timestamp', 'desc'), limit(50));
  unsubscribe = onSnapshot(q, (snapshot) => {
    const msgs: ChatMessage[] = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      if (d.system) return;
      msgs.push({
        id: doc.id,
        uid: d.uid,
        username: d.username || 'anon',
        text: d.text,
        timestamp: d.timestamp?.toMillis?.() || Date.now(),
        icon: d.icon || undefined,
      });
    });
    // Reverse so newest is at bottom
    msgs.reverse();
    callback(msgs);
  });
}

