// ── Cloud Replay Storage ────────────────────────────────
// Uploads compressed replay data to Firebase Storage and
// writes match metadata to Firestore.

import { storage, db } from './firebase';
import { ref, uploadBytes, getBlob } from 'firebase/storage';
import { doc, setDoc, collection, query, where, orderBy, limit, getDocs, startAfter, Timestamp } from 'firebase/firestore';
import type { CompressedFrame } from './types/index';
import type { DocumentSnapshot } from 'firebase/firestore';

export interface MatchMetadata {
  players: { uid: string; username: string; color: number; vehicle: string }[];
  result: string;
  winnerUid: string;
  series: number;
  matchType: 'ai' | 'casual';
  duration: number;
  map: string;
  seriesScore: { p1: number; p2: number };
  participantUids: string[];
  /**
   * TASK-292: optional stable id linking every round of a best-of together.
   * Forward-only — old cloud matches without it remain ungrouped.
   */
  seriesId?: string;
}

export interface MatchHistoryEntry extends MatchMetadata {
  id: string;
  replayStoragePath: string;
  createdAt: Date | null;
}

/** Upload a replay to Firebase Storage and write match metadata to Firestore. */
export async function uploadReplay(
  matchId: string,
  frames: CompressedFrame[],
  metadata: MatchMetadata,
): Promise<void> {
  // Compress frames to gzip before uploading
  const json = JSON.stringify(frames);
  const blob = new Blob([json]);
  const cs = new CompressionStream('gzip');
  const compressedStream = blob.stream().pipeThrough(cs);
  const compressedBlob = await new Response(compressedStream).blob();

  // Upload to Storage
  const storagePath = `replays/${matchId}.bin`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, compressedBlob);

  // Write match metadata to Firestore
  await setDoc(doc(db, 'matches', matchId), {
    ...metadata,
    replayStoragePath: storagePath,
    createdAt: Timestamp.now(),
  });
}

/** Fetch match history for a user, paginated. */
export async function fetchMatchHistory(
  uid: string,
  pageSize: number = 20,
  lastDoc?: DocumentSnapshot,
): Promise<{ entries: MatchHistoryEntry[]; lastDoc: DocumentSnapshot | null }> {
  let q = query(
    collection(db, 'matches'),
    where('participantUids', 'array-contains', uid),
    orderBy('createdAt', 'desc'),
    limit(pageSize),
  );

  if (lastDoc) {
    q = query(
      collection(db, 'matches'),
      where('participantUids', 'array-contains', uid),
      orderBy('createdAt', 'desc'),
      startAfter(lastDoc),
      limit(pageSize),
    );
  }

  const snap = await getDocs(q);
  const entries: MatchHistoryEntry[] = snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      players: data.players,
      result: data.result,
      winnerUid: data.winnerUid,
      series: data.series,
      matchType: data.matchType,
      duration: data.duration,
      map: data.map,
      seriesScore: data.seriesScore,
      participantUids: data.participantUids,
      // TASK-292: optional; undefined for legacy cloud matches.
      seriesId: data.seriesId,
      replayStoragePath: data.replayStoragePath,
      createdAt: data.createdAt?.toDate?.() || null,
    };
  });

  return {
    entries,
    lastDoc: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
  };
}

/** Download a replay from Firebase Storage. */
export async function downloadReplay(storagePath: string): Promise<CompressedFrame[]> {
  const storageRef = ref(storage, storagePath);
  const blob = await getBlob(storageRef);
  try {
    // Try gzip decompression first
    const ds = new DecompressionStream('gzip');
    const decompressedStream = blob.stream().pipeThrough(ds);
    const text = await new Response(decompressedStream).text();
    return JSON.parse(text) as CompressedFrame[];
  } catch {
    // Fallback for pre-gzip plain JSON replays
    const text = await blob.text();
    return JSON.parse(text) as CompressedFrame[];
  }
}
