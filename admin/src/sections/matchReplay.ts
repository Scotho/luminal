// admin/src/sections/matchReplay.ts — Match replay inspector
import { db, rtdb } from '../firebase';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { ref, get } from 'firebase/database';
import { escapeHtml, ago } from '../ui/render';
import { icon } from '../ui/icons';

export async function renderMatchReplay(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">${icon('monitor', 18)} Match Replay</h2>
      <button id="replay-refresh" class="refresh-btn">Refresh</button>
    </div>
    <div id="replay-match-list" style="margin-bottom:16px;">
      <p style="color:var(--text-dim);">Loading recent matches...</p>
    </div>
    <div id="replay-detail" style="display:none;"></div>
  `;

  const listEl = document.getElementById('replay-match-list')!;

  try {
    const q = query(collection(db, 'matches'), orderBy('endedAt', 'desc'), limit(20));
    const snap = await getDocs(q);
    const matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (matches.length === 0) {
      listEl.innerHTML = '<p style="color:var(--text-dim);">No completed matches found</p>';
      return;
    }

    listEl.innerHTML = matches.map((m: any) => `
      <div class="replay-match-row" data-match-id="${escapeHtml(m.id)}" style="
        padding:8px 12px;background:var(--bg-panel);border:1px solid var(--border);
        border-radius:4px;margin-bottom:4px;cursor:pointer;display:flex;
        justify-content:space-between;align-items:center;transition:border-color 0.15s;
      " onmouseover="this.style.borderColor='var(--accent-dim)'" onmouseout="this.style.borderColor='var(--border)'">
        <div>
          <span style="color:var(--accent);font-family:var(--font-mono);font-size:11px;">${escapeHtml(m.id.slice(0, 12))}</span>
          <span style="margin-left:8px;font-size:12px;">${(m.players ?? []).length} players</span>
        </div>
        <span style="color:var(--text-dim);font-size:11px;">${m.endedAt ? ago(m.endedAt.toMillis?.() ?? 0) : '—'}</span>
      </div>
    `).join('');

    listEl.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest('.replay-match-row') as HTMLElement;
      if (row?.dataset.matchId) loadMatchDetail(row.dataset.matchId);
    });
  } catch (err) {
    listEl.innerHTML = `<p style="color:var(--red);">Failed to load: ${escapeHtml((err as Error).message)}</p>`;
  }

  container.querySelector('#replay-refresh')?.addEventListener('click', () => renderMatchReplay(container));
}

async function loadMatchDetail(matchId: string): Promise<void> {
  const detail = document.getElementById('replay-detail')!;
  detail.style.display = 'block';
  detail.innerHTML = '<p style="color:var(--text-dim);">Loading match data...</p>';

  try {
    // Try to get tick data from RTDB
    const tickSnap = await get(ref(rtdb, `matches/${matchId}/ticks`));
    const ticks = tickSnap.val() as Record<string, any> | null;

    const tickEntries = ticks ? Object.entries(ticks).sort(([a], [b]) => Number(a) - Number(b)) : [];

    detail.innerHTML = `
      <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:6px;padding:14px;">
        <h3 style="margin:0 0 12px;font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:2px;color:var(--text-heading);">
          MATCH ${escapeHtml(matchId.slice(0, 12))}
        </h3>
        ${tickEntries.length > 0 ? `
          <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">${tickEntries.length} ticks recorded</div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;">
            <input type="range" id="replay-scrubber" min="0" max="${tickEntries.length - 1}" value="0"
              style="flex:1;accent-color:var(--accent);" />
            <span id="replay-tick-label" style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);min-width:60px;">Tick 0</span>
          </div>
          <pre id="replay-tick-data" style="font-size:10px;max-height:300px;overflow:auto;background:var(--bg-surface);padding:8px;border-radius:4px;white-space:pre-wrap;">${escapeHtml(JSON.stringify(tickEntries[0]?.[1] ?? {}, null, 2))}</pre>
        ` : `
          <p style="color:var(--text-dim);font-size:12px;">No tick-level data recorded for this match. Only metadata available.</p>
          <p style="color:var(--text-quiet);font-size:11px;">Tick recording can be enabled in feature flags.</p>
        `}
      </div>
    `;

    if (tickEntries.length > 0) {
      const scrubber = document.getElementById('replay-scrubber') as HTMLInputElement;
      const label = document.getElementById('replay-tick-label')!;
      const dataEl = document.getElementById('replay-tick-data')!;
      scrubber?.addEventListener('input', () => {
        const idx = parseInt(scrubber.value);
        label.textContent = `Tick ${idx}`;
        dataEl.textContent = JSON.stringify(tickEntries[idx]?.[1] ?? {}, null, 2);
      });
    }
  } catch (err) {
    detail.innerHTML = `<p style="color:var(--red);">Failed to load match data: ${escapeHtml((err as Error).message)}</p>`;
  }
}
