// ── Replay Storage (IndexedDB) ───────────────────────────
// Stores last 10 match replays + favorites

import type { ReplayFrame, CompressedFrame, ReplayEntry, LoadedReplayEntry, ReplayListEntry, MatchInfo, ReplaySnapshot } from './types/index';
import { DEFAULT_PLAYER_COLOR_KEY, FALLBACK_OPPONENT_COLOR_KEY, getPlayerColor } from './playerColors';

const DB_NAME: string = 'luminal-replays';
const DB_VERSION: number = 1;
const STORE_NAME: string = 'replays';
const MAX_RECENT: number = 10;

let db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (db) { resolve(db); return; }
    const req: IDBOpenDBRequest = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
      const d: IDBDatabase = (e.target as IDBOpenDBRequest).result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        const store: IDBObjectStore = d.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
        store.createIndex('favorite', 'favorite');
      }
    };
    req.onsuccess = (e: Event) => { db = (e.target as IDBOpenDBRequest).result; resolve(db!); };
    req.onerror = () => reject(req.error);
  });
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Compress frame data to reduce storage (round floats, drop redundant fields)
export function compressFrames(frames: ReplayFrame[]): CompressedFrame[] {
  return frames.map((f: ReplayFrame): CompressedFrame => ({
    t: Math.round(f.t * 100) / 100,
    p: f.player.alive ? [
      Math.round(f.player.x * 10) / 10,
      Math.round(f.player.z * 10) / 10,
      Math.round(f.player.angle * 1000) / 1000,
      Math.round(f.player.speed),
      (f.player.boosting ? 1 : 0) | (f.player.dashing ? 2 : 0),
    ] : null,
    a: f.ais.map((ai) => ai.alive ? [
      Math.round(ai.x * 10) / 10,
      Math.round(ai.z * 10) / 10,
      Math.round(ai.angle * 1000) / 1000,
      Math.round(ai.speed),
      (ai.boosting ? 1 : 0) | (ai.dashing ? 2 : 0),
    ] : null),
  }));
}

export function decompressFrames(compressed: CompressedFrame[]): ReplayFrame[] {
  return compressed.map((f: CompressedFrame): ReplayFrame => ({
    t: f.t,
    player: f.p ? {
      x: f.p[0], z: f.p[1], angle: f.p[2], speed: f.p[3],
      boosting: !!(f.p[4] & 1), dashing: !!(f.p[4] & 2), alive: true,
    } : { x: 0, z: 0, angle: 0, speed: 0, boosting: false, dashing: false, alive: false },
    ais: f.a.map((a: number[] | null) => a ? {
      x: a[0], z: a[1], angle: a[2], speed: a[3],
      boosting: !!(a[4] & 1), dashing: !!(a[4] & 2), alive: true,
    } : { x: 0, z: 0, angle: 0, speed: 0, boosting: false, dashing: false, alive: false }),
  }));
}

// Save a match replay. snapshot = recorder.getSnapshot(), result/seriesInfo for display.
export async function saveReplay(snapshot: ReplaySnapshot, matchInfo: MatchInfo): Promise<string> {
  const d: IDBDatabase = await openDB();
  const entry: ReplayEntry = {
    id: generateId(),
    timestamp: Date.now(),
    favorite: false,
    result: matchInfo.result, // 'player', 'ai', 'draw'
    matchType: matchInfo.matchType || 'ai', // 'ai', 'casual'
    winnerName: matchInfo.winnerName || '',
    opponentName: matchInfo.opponentName || 'AI',
    duration: snapshot.duration,
    playerColor: snapshot.playerColor,
    playerEmissive: snapshot.playerEmissive,
    playerVehicle: snapshot.playerVehicle || 'bike',
    aiColors: snapshot.aiColors,
    aiVehicles: snapshot.aiVehicles || [],
    seriesInfo: matchInfo.seriesInfo || null, // { length, playerWins, aiWins, roundIndex }
    frames: compressFrames(snapshot.frames),
  };

  return new Promise<string>((resolve, reject) => {
    const tx: IDBTransaction = d.transaction(STORE_NAME, 'readwrite');
    const store: IDBObjectStore = tx.objectStore(STORE_NAME);
    store.put(entry);
    tx.oncomplete = () => {
      pruneOldReplays().then(() => resolve(entry.id));
    };
    tx.onerror = () => reject(tx.error);
  });
}

// Remove oldest non-favorite replays if over MAX_RECENT
async function pruneOldReplays(): Promise<void> {
  const d: IDBDatabase = await openDB();
  return new Promise<void>((resolve) => {
    const tx: IDBTransaction = d.transaction(STORE_NAME, 'readwrite');
    const store: IDBObjectStore = tx.objectStore(STORE_NAME);
    const all: IDBRequest<ReplayEntry[]> = store.getAll();
    all.onsuccess = () => {
      const entries: ReplayEntry[] = all.result;
      const nonFav: ReplayEntry[] = entries.filter((e: ReplayEntry) => !e.favorite).sort((a: ReplayEntry, b: ReplayEntry) => b.timestamp - a.timestamp);
      const toDelete: ReplayEntry[] = nonFav.slice(MAX_RECENT);
      for (const e of toDelete) {
        store.delete(e.id);
      }
    };
    tx.oncomplete = () => resolve();
  });
}

/**
 * TASK-292: Return every list entry whose `seriesInfo.seriesId` matches `seriesId`.
 * Used by match-history UI (TASK-295) to group all rounds of a best-of together.
 * Filters the full list in-memory — cheap at the current MAX_RECENT=10 scale.
 */
export async function getSeriesById(seriesId: string): Promise<ReplayListEntry[]> {
  const all: ReplayListEntry[] = await getReplayList();
  return all.filter((e: ReplayListEntry) => e.seriesInfo?.seriesId === seriesId);
}

// Get all replays sorted by timestamp desc
export async function getReplayList(): Promise<ReplayListEntry[]> {
  const d: IDBDatabase = await openDB();
  return new Promise<ReplayListEntry[]>((resolve) => {
    const tx: IDBTransaction = d.transaction(STORE_NAME, 'readonly');
    const store: IDBObjectStore = tx.objectStore(STORE_NAME);
    const all: IDBRequest<ReplayEntry[]> = store.getAll();
    all.onsuccess = () => {
      const entries: ReplayEntry[] = all.result.sort((a: ReplayEntry, b: ReplayEntry) => b.timestamp - a.timestamp);
      // Return without frames for list display
      resolve(entries.map((e: ReplayEntry): ReplayListEntry => ({
        id: e.id,
        timestamp: e.timestamp,
        favorite: e.favorite,
        result: e.result,
        duration: e.duration,
        playerColor: e.playerColor,
        aiColors: e.aiColors,
        // TASK-292: backfill seriesId on pre-migration entries so consumers
        // can always read `.seriesId` (will be null for ungrouped old rounds).
        seriesInfo: e.seriesInfo
          ? { ...e.seriesInfo, seriesId: e.seriesInfo.seriesId ?? null }
          : null,
        matchType: e.matchType || 'ai',
        winnerName: e.winnerName || '',
        opponentName: e.opponentName || 'AI',
      })));
    };
  });
}

// Load a specific replay with full frame data
export async function loadReplay(id: string): Promise<LoadedReplayEntry | null> {
  const d: IDBDatabase = await openDB();
  return new Promise<LoadedReplayEntry | null>((resolve) => {
    const tx: IDBTransaction = d.transaction(STORE_NAME, 'readonly');
    const store: IDBObjectStore = tx.objectStore(STORE_NAME);
    const req: IDBRequest<ReplayEntry | undefined> = store.get(id);
    req.onsuccess = () => {
      const entry: ReplayEntry | undefined = req.result;
      if (!entry) { resolve(null); return; }
      // Normalize old replay formats — add missing fields with sensible defaults
      if (!entry.playerEmissive) entry.playerEmissive = entry.playerColor || getPlayerColor(DEFAULT_PLAYER_COLOR_KEY).color;
      if (!entry.aiColors) entry.aiColors = [];
      for (const c of entry.aiColors) {
        if (!c.emissive) c.emissive = c.color || getPlayerColor(FALLBACK_OPPONENT_COLOR_KEY).color;
      }
      if (!entry.matchType) entry.matchType = 'ai';
      if (!entry.winnerName) entry.winnerName = '';
      if (!entry.opponentName) entry.opponentName = 'AI';
      // TASK-292: backfill seriesId on pre-migration entries.
      if (entry.seriesInfo && entry.seriesInfo.seriesId === undefined) {
        entry.seriesInfo.seriesId = null;
      }
      // Decompress frames back to full format
      resolve({
        ...entry,
        frames: decompressFrames(entry.frames),
      });
    };
  });
}

// Toggle favorite status
export async function toggleFavorite(id: string): Promise<boolean> {
  const d: IDBDatabase = await openDB();
  return new Promise<boolean>((resolve) => {
    const tx: IDBTransaction = d.transaction(STORE_NAME, 'readwrite');
    const store: IDBObjectStore = tx.objectStore(STORE_NAME);
    const req: IDBRequest<ReplayEntry | undefined> = store.get(id);
    req.onsuccess = () => {
      const entry: ReplayEntry | undefined = req.result;
      if (!entry) { resolve(false); return; }
      entry.favorite = !entry.favorite;
      store.put(entry);
      tx.oncomplete = () => resolve(entry.favorite);
    };
  });
}

/**
 * TASK-295: Cascade favourite toggle across every round of a series.
 * If ALL siblings are currently favourited, unfavourite them all. Otherwise
 * favourite them all. Returns the new unified favourite state.
 * Uses a single IDB readwrite transaction so UI stays in sync with storage.
 */
export async function toggleFavoriteSeries(seriesId: string): Promise<boolean> {
  const siblings: ReplayListEntry[] = await getSeriesById(seriesId);
  if (siblings.length === 0) return false;
  const currentlyAllFav: boolean = siblings.every((s: ReplayListEntry) => s.favorite);
  const desired: boolean = !currentlyAllFav;

  const d: IDBDatabase = await openDB();
  return new Promise<boolean>((resolve, reject) => {
    const tx: IDBTransaction = d.transaction(STORE_NAME, 'readwrite');
    const store: IDBObjectStore = tx.objectStore(STORE_NAME);
    for (const s of siblings) {
      const req: IDBRequest<ReplayEntry | undefined> = store.get(s.id);
      req.onsuccess = () => {
        const entry: ReplayEntry | undefined = req.result;
        if (!entry) return;
        entry.favorite = desired;
        store.put(entry);
      };
    }
    tx.oncomplete = () => resolve(desired);
    tx.onerror = () => reject(tx.error);
  });
}

/** Find a local replay matching a cloud match by timestamp proximity and duration. */
export async function findLocalReplay(
  cloudTimestamp: number,
  duration: number,
  matchType: string,
): Promise<LoadedReplayEntry | null> {
  const d: IDBDatabase = await openDB();
  return new Promise((resolve) => {
    const tx = d.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all: IDBRequest<ReplayEntry[]> = store.getAll();
    all.onsuccess = () => {
      const entries = all.result;
      // Match by: timestamp within 30 seconds, same matchType, similar duration (within 2s)
      const match = entries.find(e =>
        Math.abs(e.timestamp - cloudTimestamp) < 30_000
        && (e.matchType || 'ai') === matchType
        && Math.abs(e.duration - duration) < 2
      );
      if (!match) { resolve(null); return; }
      // Normalize and decompress (same as loadReplay)
      if (!match.playerEmissive) match.playerEmissive = match.playerColor;
      if (!match.aiColors) match.aiColors = [];
      if (!match.matchType) match.matchType = 'ai';
      resolve({
        ...match,
        frames: decompressFrames(match.frames),
      });
    };
    tx.onerror = () => resolve(null);
  });
}

