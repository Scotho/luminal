import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { loadSnapshot, saveSnapshot } from '../store';
import { sectionHeader, statCard, escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';
import type { Snapshot, UserDoc } from '../types';

let _lastSnapshot: Snapshot<UserDoc> | null = null;
let _container: HTMLElement | null = null;

export async function renderPlaytime(container: HTMLElement): Promise<void> {
  _container = container;
  _lastSnapshot = await loadSnapshot<UserDoc>('playtime');

  if (_lastSnapshot) {
    renderFromSnapshot(container, _lastSnapshot, null);
  } else {
    container.innerHTML = sectionHeader('Playtime', null, refresh) +
      '<p style="color:var(--text-dim);">No snapshot yet. Click Refresh to pull player lifetime playtime from Firebase.</p>';
  }
}

async function refresh(): Promise<void> {
  if (!_container) return;
  _container.innerHTML = sectionHeader('Playtime', _lastSnapshot?.lastUpdated || null, refresh) +
    '<p style="color:var(--text-dim);">Loading...</p>';

  const snap = await getDocs(collection(db, 'users'));
  const entries: UserDoc[] = [];
  snap.forEach(doc => {
    entries.push({ uid: doc.id, ...(doc.data() as Omit<UserDoc, 'uid'>) } as UserDoc);
  });

  const previous = _lastSnapshot;
  const summary = computeSummary(entries);
  _lastSnapshot = {
    lastUpdated: new Date().toISOString(),
    summary,
    entries,
  };

  await saveSnapshot('playtime', _lastSnapshot);
  renderFromSnapshot(_container, _lastSnapshot, previous);
}

function computeSummary(entries: UserDoc[]): Record<string, number> {
  let totalTime = 0;
  let trackedPlayers = 0;

  for (const e of entries) {
    const timePlayed = Number(e.timePlayed ?? e.playtime ?? 0);
    totalTime += timePlayed;
    if (timePlayed > 0) trackedPlayers++;
  }

  return { totalTime, trackedPlayers, uniquePlayers: entries.length };
}

function renderFromSnapshot(container: HTMLElement, current: Snapshot<UserDoc>, previous: Snapshot<UserDoc> | null): void {
  const s = current.summary;
  const prevTime = previous ? (previous.summary.totalTime as number) : 0;
  const deltaTime = (s.totalTime as number) - prevTime;

  const players = current.entries
    .map((e) => ({
      username: e.username,
      totalTime: Number(e.timePlayed ?? e.playtime ?? 0),
    }))
    .filter((p) => p.totalTime > 0)
    .sort((a, b) => b.totalTime - a.totalTime);

  const avgPlayerTime = players.length > 0
    ? Math.round(players.reduce((sum, p) => sum + p.totalTime, 0) / players.length)
    : 0;

  container.innerHTML = sectionHeader('Playtime', current.lastUpdated, refresh) + `
    <div class="stat-grid">
      ${statCard(formatTime(s.totalTime as number), 'Total Playtime', previous ? Math.round(deltaTime / 60) : undefined)}
      ${statCard(s.trackedPlayers, 'Players With Time')}
      ${statCard(s.uniquePlayers, 'Total Users')}
      ${statCard(formatTime(avgPlayerTime), 'Avg Per Player')}
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Player</th>
          <th>Lifetime Playtime</th>
        </tr>
      </thead>
      <tbody>
        ${players.map(p => `
          <tr>
            <td>${escapeHtml(p.username || '?')}</td>
            <td>${formatTime(p.totalTime)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function formatTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
