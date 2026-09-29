import type { Snapshot } from './types';

const DATA_DIR = '/data';

/**
 * Load a snapshot from admin/data/<name>.json.
 * Returns null if the file doesn't exist yet (first run).
 */
export async function loadSnapshot<T>(name: string): Promise<Snapshot<T> | null> {
  try {
    const res = await fetch(`${DATA_DIR}/${name}.json`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Save a snapshot to admin/data/<name>.json.
 * Uses a custom Vite plugin endpoint that writes the file to disk.
 */
export async function saveSnapshot<T>(name: string, snapshot: Snapshot<T>): Promise<void> {
  const body = JSON.stringify(snapshot, null, 2);
  try {
    const res = await fetch(`/__admin_save?file=${name}.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Save failed: ${res.status}`);
  } catch (e) {
    console.warn(`Failed to save snapshot ${name}:`, e);
  }
}
