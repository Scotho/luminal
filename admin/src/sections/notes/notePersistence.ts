// ── Persistence (Load / Save) ─────────────────────────────────────────────

import { NotesState, updateModifiedTimes, defaultState } from './noteModel';

let _saveTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadNotes(): Promise<NotesState> {
  try {
    const res = await fetch('/data/notes.json');
    if (!res.ok) return defaultState();
    const data = await res.json() as NotesState;
    if (!data.tabs || data.tabs.length === 0) return defaultState();
    return data;
  } catch {
    return defaultState();
  }
}

export function scheduleSave(state: NotesState): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    state.tabs.forEach(tab => updateModifiedTimes(tab.root));
    try {
      await fetch('/__admin_save?file=notes.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state, null, 2),
      });
    } catch (e) {
      console.warn('Failed to save notes:', e);
    }
  }, 500);
}
