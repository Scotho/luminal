// admin/src/ui/playerDetail.ts — Player detail slide-out panel + moderation controls + segments
import { db, rtdb } from '../firebase';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, limit, increment } from 'firebase/firestore';
import { ref, get, set } from 'firebase/database';
import { escapeHtml, ago } from './render';
import { icon } from './icons';

// ── Player segments ─────────────────────────────────────

const SEGMENTS = ['beta-tester', 'vip', 'reported', 'banned', 'muted'] as const;
export type PlayerSegment = typeof SEGMENTS[number];

const SEGMENT_COLORS: Record<PlayerSegment, string> = {
  'beta-tester': 'var(--accent)',
  'vip': 'var(--gold)',
  'reported': 'var(--orange)',
  'banned': 'var(--red-bright)',
  'muted': 'var(--text-quiet)',
};

export function segmentBadge(seg: PlayerSegment): string {
  const color = SEGMENT_COLORS[seg] ?? 'var(--text-dim)';
  return `<span class="player-segment-badge" style="color:${color};border-color:${color};">${seg}</span>`;
}

// ── Detail Panel ────────────────────────────────────────

let _panelEl: HTMLElement | null = null;

export function showPlayerDetail(uid: string, container: HTMLElement): void {
  closePlayerDetail();

  _panelEl = document.createElement('div');
  _panelEl.id = 'player-detail-panel';
  _panelEl.className = 'player-detail-panel open';
  _panelEl.innerHTML = `
    <div class="player-detail-header">
      <span class="player-detail-title">Player Detail</span>
      <button id="player-detail-close" class="banner-icon-btn" style="width:24px;height:24px;">&times;</button>
    </div>
    <div id="player-detail-content" style="padding:14px; overflow-y:auto; flex:1;">
      <p style="color:var(--text-dim);">Loading...</p>
    </div>
  `;
  container.appendChild(_panelEl);

  _panelEl.querySelector('#player-detail-close')?.addEventListener('click', closePlayerDetail);
  document.addEventListener('keydown', _escHandler);

  loadPlayerData(uid);
}

function _escHandler(e: KeyboardEvent): void {
  if (e.key === 'Escape') closePlayerDetail();
}

export function closePlayerDetail(): void {
  if (_panelEl) {
    _panelEl.classList.remove('open');
    setTimeout(() => { _panelEl?.remove(); _panelEl = null; }, 200);
  }
  document.removeEventListener('keydown', _escHandler);
}

async function loadPlayerData(uid: string): Promise<void> {
  const content = document.getElementById('player-detail-content');
  if (!content) return;

  try {
    // Fetch user profile
    const userSnap = await getDoc(doc(db, 'users', uid));
    const userData = userSnap.exists() ? userSnap.data() : null;

    // Fetch online status
    const statusSnap = await get(ref(rtdb, `status/${uid}`));
    const statusData = statusSnap.val() as { online?: boolean; ts?: number } | null;
    const isOnline = statusData?.online && (Date.now() - (statusData.ts || 0)) < 120_000;

    // Fetch recent matches (up to 10)
    let matchHistory: Array<{ id: string; ts: number; result?: string }> = [];
    try {
      const matchesRef = collection(db, 'matches');
      const q = query(matchesRef, where('participantUids', 'array-contains', uid), orderBy('createdAt', 'desc'), limit(10));
      const matchSnap = await getDocs(q);
      matchHistory = matchSnap.docs.map(d => ({
        id: d.id,
        ts: d.data().createdAt?.toMillis?.() ?? Date.now(),
        result: d.data().result,
      }));
    } catch { /* matches collection may not exist or lack index */ }

    // Fetch segments
    const segments: PlayerSegment[] = (userData?.segments as PlayerSegment[]) ?? [];

    // Fetch playtime
    const playtimeSeconds = Number(userData?.timePlayed ?? userData?.playtime ?? 0);
    const lastSeen = statusData?.ts ?? userData?.lastLogin ?? null;

    const onlineDot = isOnline
      ? '<span class="status-dot green" style="width:8px;height:8px;"></span>'
      : '<span class="status-dot dim" style="width:8px;height:8px;"></span>';

    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        ${onlineDot}
        <div>
          <div style="font-size:15px;font-weight:700;">${escapeHtml(userData?.username ?? uid.slice(0, 12))}</div>
          <div style="font-size:10px;color:var(--text-dim);font-family:var(--font-mono);">${escapeHtml(uid)}</div>
        </div>
      </div>

      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;" id="player-segments">
        ${segments.map(s => segmentBadge(s)).join('')}
        <button id="add-segment-btn" class="admin-btn admin-btn--small" style="font-size:8px;padding:2px 8px;">+ Tag</button>
      </div>

      <div class="stat-grid" style="margin-bottom:16px;">
        <div class="stat-card"><div class="stat-val">${isOnline ? 'Online' : 'Offline'}</div><div class="stat-label">Status</div></div>
        <div class="stat-card"><div class="stat-val">${lastSeen ? ago(lastSeen) : '—'}</div><div class="stat-label">Last Seen</div></div>
        <div class="stat-card"><div class="stat-val">${formatPlaytime(playtimeSeconds)}</div><div class="stat-label">Playtime</div></div>
        <div class="stat-card"><div class="stat-val">${matchHistory.length}</div><div class="stat-label">Matches</div></div>
      </div>

      <h4 style="margin:0 0 8px;">Moderation</h4>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
        <button class="admin-btn admin-btn--small admin-btn--danger mod-action" data-action="ban" data-uid="${escapeHtml(uid)}">Ban</button>
        <button class="admin-btn admin-btn--small admin-btn--danger mod-action" data-action="mute" data-uid="${escapeHtml(uid)}">Mute</button>
        <button class="admin-btn admin-btn--small mod-action" data-action="kick" data-uid="${escapeHtml(uid)}">Kick</button>
        <button class="admin-btn admin-btn--small mod-action" data-action="unban" data-uid="${escapeHtml(uid)}" style="display:${segments.includes('banned') ? 'inline-flex' : 'none'};">Unban</button>
      </div>

      <h4 style="margin:0 0 8px;">Testing Tools</h4>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
        <input id="flow-amount-input" type="number" value="1000" min="1" max="999999"
          style="width:90px;padding:4px 8px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r-sm,4px);color:var(--text);font-size:12px;font-family:var(--font-mono);" />
        <button class="admin-btn admin-btn--small" id="add-flow-btn">ADD FLOW</button>
        <button class="admin-btn admin-btn--small admin-btn--danger" id="reset-shop-btn">RESET SHOP</button>
      </div>
      <div id="testing-tools-feedback" style="font-size:11px;min-height:16px;margin-bottom:14px;"></div>

      <h4 style="margin:0 0 8px;">Recent Matches</h4>
      <div style="max-height:200px;overflow-y:auto;">
        ${matchHistory.length > 0 ? matchHistory.map(m => `
          <div style="padding:4px 0;border-bottom:1px solid var(--border);font-size:12px;display:flex;justify-content:space-between;">
            <span style="color:var(--accent);font-family:var(--font-mono);">${escapeHtml(m.id.slice(0, 10))}</span>
            <span style="color:var(--text-dim);">${ago(m.ts)}</span>
          </div>
        `).join('') : '<div style="color:var(--text-dim);font-size:12px;">No match history</div>'}
      </div>
    `;

    // Wire moderation buttons
    content.querySelectorAll<HTMLElement>('.mod-action').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const targetUid = btn.dataset.uid;
        if (!action || !targetUid) return;

        btn.textContent = '...';
        try {
          switch (action) {
            case 'ban':
              await updateDoc(doc(db, 'users', targetUid), {
                segments: [...new Set([...segments, 'banned' as PlayerSegment])],
                banned: true,
                bannedAt: Date.now(),
              });
              break;
            case 'unban':
              await updateDoc(doc(db, 'users', targetUid), {
                segments: segments.filter(s => s !== 'banned'),
                banned: false,
              });
              break;
            case 'mute':
              await updateDoc(doc(db, 'users', targetUid), {
                segments: [...new Set([...segments, 'muted' as PlayerSegment])],
                muted: true,
                mutedAt: Date.now(),
              });
              break;
            case 'kick':
              await set(ref(rtdb, `status/${targetUid}/kicked`), true);
              break;
          }
          // Reload detail
          loadPlayerData(targetUid);
        } catch (err) {
          btn.textContent = 'Error';
          btn.title = (err as Error).message;
        }
      });
    });

    // Wire add segment
    content.querySelector('#add-segment-btn')?.addEventListener('click', () => {
      const seg = window.prompt(`Add segment tag:\n${SEGMENTS.join(', ')}`) as PlayerSegment | null;
      if (seg && SEGMENTS.includes(seg as PlayerSegment)) {
        updateDoc(doc(db, 'users', uid), {
          segments: [...new Set([...segments, seg])],
        }).then(() => loadPlayerData(uid));
      }
    });

    // Wire testing tools
    const feedbackEl = content.querySelector<HTMLElement>('#testing-tools-feedback');
    const setFeedback = (msg: string, ok: boolean): void => {
      if (!feedbackEl) return;
      feedbackEl.textContent = msg;
      feedbackEl.style.color = ok ? 'var(--green)' : 'var(--red)';
      setTimeout(() => { if (feedbackEl) feedbackEl.textContent = ''; }, 4000);
    };

    content.querySelector('#add-flow-btn')?.addEventListener('click', async () => {
      const input = content.querySelector<HTMLInputElement>('#flow-amount-input');
      const amount = Number(input?.value ?? 1000);
      if (!Number.isFinite(amount) || amount <= 0) { setFeedback('Invalid amount', false); return; }
      const btn = content.querySelector<HTMLButtonElement>('#add-flow-btn')!;
      const prev = btn.textContent;
      btn.textContent = '...';
      btn.disabled = true;
      try {
        await updateDoc(doc(db, 'users', uid), { bankedFlow: increment(amount) });
        setFeedback(`+${amount} FLOW added`, true);
      } catch (err) {
        setFeedback(`Error: ${(err as Error).message}`, false);
      } finally {
        btn.textContent = prev;
        btn.disabled = false;
      }
    });

    content.querySelector('#reset-shop-btn')?.addEventListener('click', async () => {
      const btn = content.querySelector<HTMLButtonElement>('#reset-shop-btn')!;
      const prev = btn.textContent;
      btn.textContent = '...';
      btn.disabled = true;
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (!snap.exists()) throw new Error('User doc not found');
        const data = snap.data();
        const unlockedItems: string[] = (data?.progression?.unlockedItems as string[]) ?? [];
        const unlockLog: Array<{ itemId?: string; source?: string }> =
          (data?.unlockLog as Array<{ itemId?: string; source?: string }>) ?? [];

        const shopItemIds = new Set(
          unlockLog.filter(e => e.source === 'shop').map(e => e.itemId).filter(Boolean),
        );
        const nonShopItems = unlockedItems.filter(id => !shopItemIds.has(id));
        const nonShopLog = unlockLog.filter(e => e.source !== 'shop');

        await updateDoc(doc(db, 'users', uid), {
          bankedFlow: 0,
          'progression.unlockedItems': nonShopItems,
          unlockLog: nonShopLog,
        });
        setFeedback('Shop reset — bankedFlow=0, shop items removed', true);
      } catch (err) {
        setFeedback(`Error: ${(err as Error).message}`, false);
      } finally {
        btn.textContent = prev;
        btn.disabled = false;
      }
    });

  } catch (err) {
    content.innerHTML = `<p style="color:var(--red);">Failed to load: ${escapeHtml((err as Error).message)}</p>`;
  }
}

// suppress unused import warning — icon is available for future use
void (icon as unknown);

function formatPlaytime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
