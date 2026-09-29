// admin/src/ui/playerHistory.ts — Persistent player/lobby/match time-series
import { renderTimeSeriesChart as renderChart } from './charts';

interface HistoryEntry {
  ts: number;
  players: number;
  lobbies: number;
  matches: number;
}

const MAX_ENTRIES = 10080; // 7 days at 1-minute intervals

let _history: HistoryEntry[] = [];
let _loaded = false;

export async function loadHistory(): Promise<HistoryEntry[]> {
  if (_loaded) return _history;
  try {
    const res = await fetch('/data/player-history.json');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) _history = data as HistoryEntry[];
    }
  } catch (err) {
    console.warn('[playerHistory] Failed to load player-history.json:', err);
  }
  _loaded = true;
  return _history;
}

export async function recordSnapshot(players: number, lobbies: number, matches: number): Promise<void> {
  await loadHistory();
  _history.push({ ts: Date.now(), players, lobbies, matches });
  if (_history.length > MAX_ENTRIES) _history.splice(0, _history.length - MAX_ENTRIES);
  try {
    await fetch('/__admin_save?file=player-history.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_history),
    });
  } catch { /* best-effort */ }
}

export function getHistory(): HistoryEntry[] {
  return _history;
}

type TimeWindow = '1h' | '6h' | '24h' | '7d';

export function filterByWindow(entries: HistoryEntry[], window: TimeWindow): HistoryEntry[] {
  const windowMs: Record<TimeWindow, number> = {
    '1h':  3_600_000,
    '6h':  21_600_000,
    '24h': 86_400_000,
    '7d':  604_800_000,
  };
  const cutoff = Date.now() - windowMs[window];
  return entries.filter(e => e.ts >= cutoff);
}

export function renderTimeSeriesChart(
  containerId: string,
  entries: HistoryEntry[],
  field: 'players' | 'lobbies' | 'matches',
  color: string = 'rgba(110,224,240,0.8)',
): void {
  const data = entries.map(e => ({ ts: e.ts, value: Number(e[field]) || 0 }));
  renderChart(containerId, data, { color });
}
