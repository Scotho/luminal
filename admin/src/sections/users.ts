import { db } from '../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { loadSnapshot, saveSnapshot } from '../store';
import { sectionHeader, statCard, escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';
import type { Snapshot, UserDoc } from '../types';
import { showPlayerDetail, segmentBadge } from '../ui/playerDetail';
import type { PlayerSegment } from '../ui/playerDetail';

export interface UserSummary {
  total: number;
  real: number;
  anonymous: number;
  withProfile: number;
  providers: Record<string, number>;
}

let _lastSnapshot: Snapshot<UserDoc> | null = null;
let _container: HTMLElement | null = null;

export async function renderUsers(container: HTMLElement): Promise<void> {
  _container = container;
  _lastSnapshot = await loadSnapshot<UserDoc>('users');

  if (_lastSnapshot) {
    renderFromSnapshot(container, _lastSnapshot, null);
  } else {
    container.innerHTML = sectionHeader('Users', null, refresh) +
      '<p style="color:var(--text-dim);">No snapshot yet. Click Refresh to pull user data from Firebase.</p>';
  }
}

async function refresh(): Promise<void> {
  if (!_container) return;
  _container.innerHTML = sectionHeader('Users', _lastSnapshot?.lastUpdated || null, refresh) +
    '<p style="color:var(--text-dim);">Loading...</p>';

  const snap = await getDocs(collection(db, 'users'));
  const entries: UserDoc[] = [];
  snap.forEach(doc => {
    const d = doc.data() as Omit<UserDoc, 'uid'>;
    entries.push({ uid: doc.id, ...d } as UserDoc);
  });

  const previous = _lastSnapshot;
  const now = new Date().toISOString();
  const summary = computeSummary(entries);
  _lastSnapshot = {
    lastUpdated: now,
    summary: {
      total: summary.total,
      real: summary.real,
      anonymous: summary.anonymous,
      withProfile: summary.withProfile,
    },
    entries,
  };

  await saveSnapshot('users', _lastSnapshot);
  renderFromSnapshot(_container, _lastSnapshot, previous);
}

export function computeSummary(entries: UserDoc[]): UserSummary {
  let real = 0;
  let anonymous = 0;
  let withProfile = 0;
  const providers: Record<string, number> = {};

  for (const u of entries) {
    if (u.username && u.username !== '') {
      real++;
      if (u.icon && u.icon !== 'default') withProfile++;
    } else {
      anonymous++;
    }
  }

  return { total: entries.length, real, anonymous, withProfile, providers };
}

let _activeSegment: PlayerSegment | 'all' = 'all';

function renderFromSnapshot(container: HTMLElement, current: Snapshot<UserDoc>, previous: Snapshot<UserDoc> | null): void {
  const s = current.summary;
  const prevTotal = previous ? (previous.summary.total as number) : 0;
  const delta = (s.total as number) - prevTotal;

  const sortedEntries = [...current.entries].sort((a, b) => {
    const tsA = a.createdAt?.seconds || 0;
    const tsB = b.createdAt?.seconds || 0;
    return tsB - tsA;
  });

  const filteredEntries = _activeSegment === 'all'
    ? sortedEntries
    : sortedEntries.filter(u => {
        const segs: PlayerSegment[] = (u as UserDoc & { segments?: PlayerSegment[] }).segments ?? [];
        return segs.includes(_activeSegment as PlayerSegment);
      });

  container.innerHTML = sectionHeader('Users', current.lastUpdated, refresh) + `
    <div class="stat-grid">
      ${statCard(s.total, 'Total Users', previous ? delta : undefined)}
      ${statCard(s.real, 'Real Accounts')}
      ${statCard(s.anonymous, 'Anonymous')}
      ${statCard(s.withProfile, 'With Profile')}
    </div>
    <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;" id="user-segment-filter">
      <button class="filter-btn${_activeSegment === 'all' ? ' active' : ''}" data-segment="all">All</button>
      <button class="filter-btn${_activeSegment === 'beta-tester' ? ' active' : ''}" data-segment="beta-tester">Beta Tester</button>
      <button class="filter-btn${_activeSegment === 'vip' ? ' active' : ''}" data-segment="vip">VIP</button>
      <button class="filter-btn${_activeSegment === 'reported' ? ' active' : ''}" data-segment="reported">Reported</button>
      <button class="filter-btn${_activeSegment === 'banned' ? ' active' : ''}" data-segment="banned">Banned</button>
    </div>
    <table class="data-table" id="users-table">
      <thead>
        <tr>
          <th>Username</th>
          <th>UID</th>
          <th>Created</th>
          <th>About</th>
          <th>Tags</th>
        </tr>
      </thead>
      <tbody>
        ${filteredEntries.map(u => {
            const segs: PlayerSegment[] = (u as UserDoc & { segments?: PlayerSegment[] }).segments ?? [];
            return `
              <tr data-uid="${escapeHtml(u.uid)}" style="cursor:pointer;">
                <td>${escapeHtml(u.username || '(anonymous)')}</td>
                <td style="color:var(--text-dim); font-size:11px;">${u.uid.slice(0, 16)}</td>
                <td style="color:var(--text-dim); font-size:12px;">${u.createdAt ? new Date(u.createdAt.seconds * 1000).toLocaleDateString() : '—'}</td>
                <td style="color:var(--text-dim); font-size:12px;">${escapeHtml((u.about || '').slice(0, 50))}</td>
                <td style="white-space:nowrap;">${segs.map(s => segmentBadge(s)).join(' ')}</td>
              </tr>
            `;
          }).join('')}
      </tbody>
    </table>
  `;

  // Segment filter click delegation
  container.querySelector('#user-segment-filter')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-segment]') as HTMLElement;
    if (!btn) return;
    _activeSegment = (btn.dataset.segment as PlayerSegment | 'all') ?? 'all';
    renderFromSnapshot(container, current, previous);
  });

  // Row click → player detail
  container.querySelector('#users-table')?.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('[data-uid]') as HTMLElement;
    if (row?.dataset.uid) {
      showPlayerDetail(row.dataset.uid, document.getElementById('content')!);
    }
  });
}
