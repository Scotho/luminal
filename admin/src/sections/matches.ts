import { db } from '../firebase';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { loadSnapshot, saveSnapshot } from '../store';
import { sectionHeader, statCard, escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';
import type { Snapshot, MatchDoc } from '../types';

let _lastSnapshot: Snapshot<MatchDoc> | null = null;
let _container: HTMLElement | null = null;

export async function renderMatches(container: HTMLElement): Promise<void> {
  _container = container;
  _lastSnapshot = await loadSnapshot<MatchDoc>('matches');

  if (_lastSnapshot) {
    renderFromSnapshot(container, _lastSnapshot, null);
  } else {
    container.innerHTML = sectionHeader('Matches', null, refresh) +
      '<p style="color:var(--text-dim);">No snapshot yet. Click Refresh to pull match data.</p>';
  }
}

async function refresh(): Promise<void> {
  if (!_container) return;
  _container.innerHTML = sectionHeader('Matches', _lastSnapshot?.lastUpdated || null, refresh) +
    '<p style="color:var(--text-dim);">Loading...</p>';

  const q = query(collection(db, 'matches'), orderBy('createdAt', 'desc'), limit(500));
  const snap = await getDocs(q);
  const entries: (MatchDoc & { id: string })[] = [];
  snap.forEach(doc => {
    entries.push({ id: doc.id, ...doc.data() } as MatchDoc & { id: string });
  });

  const previous = _lastSnapshot;
  const summary = computeSummary(entries);
  _lastSnapshot = {
    lastUpdated: new Date().toISOString(),
    summary,
    entries,
  };

  await saveSnapshot('matches', _lastSnapshot);
  renderFromSnapshot(_container, _lastSnapshot, previous);
}

export function computeSummary(entries: MatchDoc[]): Record<string, number> {
  let ai = 0, casual = 0, online = 0;
  let totalDuration = 0;
  for (const m of entries) {
    if (m.matchType === 'ai') ai++;
    else if (m.matchType === 'casual') casual++;
    else online++;
    totalDuration += m.duration || 0;
  }
  const avgDuration = entries.length > 0 ? Math.round(totalDuration / entries.length) : 0;
  return { total: entries.length, ai, casual, online, avgDuration };
}

function renderFromSnapshot(container: HTMLElement, current: Snapshot<MatchDoc>, previous: Snapshot<MatchDoc> | null): void {
  const s = current.summary;
  const prevTotal = previous ? (previous.summary.total as number) : 0;
  const delta = (s.total as number) - prevTotal;

  container.innerHTML = sectionHeader('Matches', current.lastUpdated, refresh) + `
    <div class="stat-grid">
      ${statCard(s.total, 'Total Matches', previous ? delta : undefined)}
      ${statCard(s.ai, 'vs AI')}
      ${statCard(s.casual, 'Casual')}
      ${statCard(s.online, 'Online')}
      ${statCard(formatDuration(s.avgDuration as number), 'Avg Duration')}
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Players</th>
          <th>Type</th>
          <th>Result</th>
          <th>Duration</th>
          <th>Map</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        ${current.entries.slice(0, 100).map((m: any) => `
          <tr>
            <td>${(m.players || []).map((p: any) => escapeHtml(p.username || '?')).join(' vs ')}</td>
            <td style="color:var(--text-dim);">${escapeHtml(m.matchType || '?')}</td>
            <td>${escapeHtml(m.result || '?')}</td>
            <td style="color:var(--text-dim);">${formatDuration(m.duration || 0)}</td>
            <td style="color:var(--text-dim);">${escapeHtml(m.map || '?')}</td>
            <td style="color:var(--text-dim); font-size:12px;">${m.createdAt ? new Date(m.createdAt.seconds * 1000).toLocaleDateString() : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
