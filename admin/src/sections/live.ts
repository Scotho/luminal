import { rtdb, db } from '../firebase';
import { ref, onValue } from 'firebase/database';
import { doc, getDoc } from 'firebase/firestore';
import { escapeHtml, ago, statCard } from '../ui/render';
import { icon } from '../ui/icons';
import { renderSparkline } from '../ui/charts';
import { getEvents, onUpdate } from '../ui/activityFeed';
import {
  renderStatCards, renderHotModules, renderWorktrees, renderCoverageHeatmap,
} from './healthHelpers';
import { getAllServiceStatuses, onServiceStatusChanged, formatTokens } from '../ui/statusBanner';
import { loadUsageRecords, aggregateUsage, usageInWindow, estimateUsagePct, formatDuration } from '../ui/ccUsage';
import { loadHistory, recordSnapshot, filterByWindow, renderTimeSeriesChart } from '../ui/playerHistory';
import { renderLobbyHealthPanel, renderErrorRatePanel } from '../ui/lobbyHealth';
import type { ActivityDigest, TestHealth, ModuleMap } from '../types';
import type { Unsubscribe } from 'firebase/database';

const _nameCache: Record<string, string> = {};
const _playerHistory: number[] = [];
const MAX_HISTORY = 30;

async function resolveName(uid: string): Promise<string> {
  if (_nameCache[uid]) return _nameCache[uid];
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    _nameCache[uid] = snap.exists() ? snap.data().username : uid.slice(0, 12);
  } catch {
    _nameCache[uid] = uid.slice(0, 12);
  }
  return _nameCache[uid];
}

function serviceMonitorsHtml(): string {
  const statuses = getAllServiceStatuses();
  return Object.entries(statuses).map(([, s]) => {
    return `<span class="status-indicator"><span class="status-dot ${s.color}"></span> <span>${escapeHtml(s.text)}</span></span>`;
  }).join('');
}

function updateServiceMonitors(): void {
  const el = document.getElementById('service-monitors');
  if (!el) return;
  el.innerHTML = serviceMonitorsHtml();
}

const STALE_MS = 120_000;

/**
 * Start all live RTDB listeners and render into the container.
 * Returns a cleanup function that unsubscribes all listeners.
 */
export function startLiveListeners(container: HTMLElement): () => void {
  const unsubs: Unsubscribe[] = [];

  container.innerHTML = `
    <h2>${icon('circle-dot', 18)} <span class="live-dot"></span> Status
      <span id="service-monitors" style="margin-left:auto; display:flex; gap:12px; align-items:center; width:fit-content;">${serviceMonitorsHtml()}</span>
    </h2>
    <div id="live-usage-panel" style="margin-bottom:16px; padding:12px 14px; background:var(--bg-surface); border:1px solid var(--border); border-radius:4px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="var(--claude)" stroke="none"><path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/></svg>
        <span style="font-family:var(--font-display); font-size:10px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--text);">Claude Usage</span>
        <span style="flex:1;"></span>
        <button id="live-usage-refresh" style="background:none; border:1px solid var(--border); border-radius:2px; color:var(--text-dim); cursor:pointer; font-size:9px; padding:1px 6px;" title="Refresh">&#8635;</button>
      </div>
      <div id="live-usage-stats" style="display:flex; gap:16px; flex-wrap:wrap; font-family:var(--font-mono); font-size:11px; color:var(--text-dim);">
        <span>Loading...</span>
      </div>
    </div>
    <h3>Server Health</h3>
    <div class="stat-grid">
      ${statCard('—', 'Online Players')}
      ${statCard('—', 'Lobbies')}
      ${statCard('—', 'Matches')}
      ${statCard('—', 'In Queue')}
    </div>
    <div id="live-sparkline" style="margin-bottom:16px;"></div>
    <div style="margin-bottom:20px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
        <h4 style="margin:0;">Player History</h4>
        <div id="chart-window-btns" style="display:flex; gap:4px;">
          <button class="chart-window-btn active" data-window="1h" style="font-size:9px; padding:2px 8px; background:none; border:1px solid var(--accent-dim); color:var(--accent); border-radius:2px; cursor:pointer; font-family:var(--font-display); font-weight:700; letter-spacing:1px;">1H</button>
          <button class="chart-window-btn" data-window="6h" style="font-size:9px; padding:2px 8px; background:none; border:1px solid var(--border); color:var(--text-dim); border-radius:2px; cursor:pointer; font-family:var(--font-display); font-weight:700; letter-spacing:1px;">6H</button>
          <button class="chart-window-btn" data-window="24h" style="font-size:9px; padding:2px 8px; background:none; border:1px solid var(--border); color:var(--text-dim); border-radius:2px; cursor:pointer; font-family:var(--font-display); font-weight:700; letter-spacing:1px;">24H</button>
          <button class="chart-window-btn" data-window="7d" style="font-size:9px; padding:2px 8px; background:none; border:1px solid var(--border); color:var(--text-dim); border-radius:2px; cursor:pointer; font-family:var(--font-display); font-weight:700; letter-spacing:1px;">7D</button>
        </div>
      </div>
      <div id="player-chart" style="background:var(--bg-surface); border:1px solid var(--border); border-radius:4px; padding:8px;"></div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
        <div id="lobby-chart" style="background:var(--bg-surface); border:1px solid var(--border); border-radius:4px; padding:8px;"></div>
        <div id="match-chart" style="background:var(--bg-surface); border:1px solid var(--border); border-radius:4px; padding:8px;"></div>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
      <div id="lobby-health-panel"></div>
      <div id="error-rate-panel"></div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
      <div>
        <h4>Online Players</h4>
        <div id="live-players" style="max-height:300px; overflow-y:auto;"></div>
      </div>
      <div>
        <h4>Active Lobbies</h4>
        <div id="live-lobbies" style="max-height:300px; overflow-y:auto;"></div>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
      <div>
        <h4>Active Matches</h4>
        <div id="live-matches" style="max-height:300px; overflow-y:auto;"></div>
      </div>
      <div></div>
    </div>
    <div style="margin-top:20px;">
      <h4>Activity Feed</h4>
      <div id="live-activity" style="max-height:250px; overflow-y:auto;"></div>
    </div>

    <hr style="border:none; border-top:1px solid var(--border); margin:24px 0;" />
    <div id="live-health-panel">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
        <h3 style="margin:0;">Project Health</h3>
        <button id="health-refresh-btn" class="refresh-btn" style="font-size:10px;">Refresh</button>
      </div>
      <p style="color:var(--text-dim); font-size:12px;">Loading health data...</p>
    </div>
  `;

  // Subscribe to service status changes to keep monitor bar current
  const statusUnsub = onServiceStatusChanged(updateServiceMonitors);
  unsubs.push(statusUnsub);

  // ── Usage panel ──────────────────────────────────────────
  const usageStatsEl = document.getElementById('live-usage-stats');
  const usageRefreshBtn = document.getElementById('live-usage-refresh');

  function pctColor(pct: number): string {
    if (pct > 80) return 'var(--red-bright,#d45234)';
    if (pct > 50) return 'var(--yellow)';
    return 'var(--green)';
  }

  async function refreshLiveUsage(): Promise<void> {
    if (!usageStatsEl) return;

    interface LiveUsage {
      available: boolean;
      five_hour?: { used_pct: number | null; resets_at: number | null };
      seven_day?: { used_pct: number | null; resets_at: number | null };
    }

    let live: LiveUsage = { available: false };
    try {
      const res = await fetch('/__admin_exec/claude-usage');
      if (res.ok) live = await res.json() as LiveUsage;
    } catch { /* fall through */ }

    const records = await loadUsageRecords();
    const agg = aggregateUsage(records);
    const total = agg.totalInput + agg.totalOutput;
    const session5h = usageInWindow(records, 5 * 3_600_000);
    const weekly = usageInWindow(records, 7 * 24 * 3_600_000);

    const parts: string[] = [];

    // Tokens + runs
    parts.push(`<span><strong style="color:var(--text);">${formatTokens(total)}</strong> tokens</span>`);
    parts.push(`<span><strong style="color:var(--text);">${agg.totalSessions}</strong> runs</span>`);

    // Usage %
    if (live.available && live.five_hour?.used_pct != null) {
      const r5 = 100 - Math.round(live.five_hour.used_pct);
      const r7 = live.seven_day?.used_pct != null ? 100 - Math.round(live.seven_day.used_pct) : null;
      parts.push(`<span style="color:${pctColor(live.five_hour.used_pct)};">${r5}% remaining (5h)</span>`);
      if (r7 != null) parts.push(`<span style="color:${pctColor(live.seven_day!.used_pct!)};">${r7}% remaining (7d)</span>`);
    } else {
      const pct = estimateUsagePct(session5h.activeTimeMs, 5);
      parts.push(`<span style="color:${pctColor(pct)};">${100 - pct}% remaining (5h est.)</span>`);
    }

    // Weekly active time
    parts.push(`<span>${formatDuration(weekly.activeTimeMs)} active this week</span>`);

    usageStatsEl.innerHTML = parts.join('<span style="color:var(--border);">&middot;</span>');
  }

  refreshLiveUsage();
  usageRefreshBtn?.addEventListener('click', refreshLiveUsage);
  const usageTick = setInterval(refreshLiveUsage, 15_000);
  unsubs.push(() => clearInterval(usageTick) as unknown as void);

  const statCards = container.querySelectorAll<HTMLElement>('.stat-val');

  // 1. Online players
  unsubs.push(onValue(ref(rtdb, 'status'), (snap) => {
    const val: Record<string, { online: boolean; ts: number }> | null = snap.val();
    const now = Date.now();
    const uids = val ? Object.keys(val).filter(uid => now - (val[uid]?.ts || 0) < STALE_MS) : [];
    statCards[0].textContent = String(uids.length);

    _playerHistory.push(uids.length);
    if (_playerHistory.length > MAX_HISTORY) _playerHistory.shift();
    renderSparkline('live-sparkline', _playerHistory);

    const el = document.getElementById('live-players');
    if (!el) return;
    renderPlayers(el, uids, val || {});
    const uncached = uids.filter(uid => !_nameCache[uid]);
    if (uncached.length) {
      Promise.all(uncached.map(resolveName)).then(() => renderPlayers(el, uids, val || {}));
    }
  }));

  // 2. Lobbies
  unsubs.push(onValue(ref(rtdb, 'lobbies'), (snap) => {
    const val: Record<string, any> | null = snap.val();
    const entries = val ? Object.entries(val) : [];
    statCards[1].textContent = String(entries.length);

    const el = document.getElementById('live-lobbies');
    if (!el) return;
    el.innerHTML = entries.map(([id, lobby]) => {
      const host = lobby.host?.username || '?';
      const guests = lobby.guests
        ? Object.values(lobby.guests).map((g: any) => g.username).join(', ')
        : '—';
      const status = lobby.status || '?';
      return `<div style="padding:6px 0; border-bottom:1px solid var(--border); font-size:13px;">
        <span style="color:var(--accent);">${escapeHtml(id.slice(0, 10))}</span>
        <span style="margin-left:8px;">${escapeHtml(host)} vs ${escapeHtml(guests)}</span>
        <span style="margin-left:8px; color:var(--text-dim);">${escapeHtml(status.toUpperCase())}</span>
      </div>`;
    }).join('') || '<div style="color:var(--text-dim);">No active lobbies</div>';
    renderLobbyHealthPanel('lobby-health-panel', val || {});
  }));

  // 3. Matches
  unsubs.push(onValue(ref(rtdb, 'matches'), (snap) => {
    const val: Record<string, any> | null = snap.val();
    const entries = val ? Object.entries(val) : [];
    statCards[2].textContent = String(entries.length);

    const el = document.getElementById('live-matches');
    if (!el) return;
    el.innerHTML = entries.map(([id, match]) => {
      const meta = match.meta || {};
      const status = meta.status || '?';
      const players: string[] = meta.players || [];
      const playerStr = players.length
        ? players.map((p: string) => p.slice(0, 8) + '...').join(' vs ')
        : '?';
      const round = meta.round ?? '?';
      return `<div style="padding:6px 0; border-bottom:1px solid var(--border); font-size:13px;">
        <span style="color:var(--accent);">${escapeHtml(id.slice(0, 10))}</span>
        <span style="margin-left:8px;">${escapeHtml(playerStr)}</span>
        <span style="margin-left:8px; color:var(--text-dim);">R${round} ${escapeHtml(String(status).toUpperCase())}</span>
      </div>`;
    }).join('') || '<div style="color:var(--text-dim);">No active matches</div>';
  }));

  // 4. Queue
  unsubs.push(onValue(ref(rtdb, 'queuePresence'), (snap) => {
    const val: Record<string, any> | null = snap.val();
    statCards[3].textContent = String(val ? Object.keys(val).length : 0);
  }));

  // Error rate monitor
  async function loadErrorRate(): Promise<void> {
    try {
      const res = await fetch('/data/bug-reports.json');
      const ct = res.headers.get('content-type') ?? '';
      if (res.ok && ct.includes('application/json')) {
        const reports = await res.json();
        if (Array.isArray(reports)) renderErrorRatePanel('error-rate-panel', reports);
      }
    } catch (err) {
      console.warn('[live] Failed to load bug reports for error rate:', err);
    }
  }
  loadErrorRate();
  const errorTick = setInterval(loadErrorRate, 30_000);
  unsubs.push(() => clearInterval(errorTick));

  // ── Time-series charts ──
  let _chartWindow: '1h' | '6h' | '24h' | '7d' = '1h';
  let _lastSnapshotTs = 0;

  async function updateCharts(): Promise<void> {
    const history = await loadHistory();
    const filtered = filterByWindow(history, _chartWindow);
    renderTimeSeriesChart('player-chart', filtered, 'players', 'rgba(110,224,240,0.8)');
    renderTimeSeriesChart('lobby-chart', filtered, 'lobbies', 'rgba(255,180,42,0.8)');
    renderTimeSeriesChart('match-chart', filtered, 'matches', 'rgba(60,255,60,0.8)');
  }

  loadHistory().then(() => updateCharts());

  // Window selector buttons
  container.querySelectorAll<HTMLElement>('.chart-window-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _chartWindow = (btn.dataset.window || '1h') as typeof _chartWindow;
      container.querySelectorAll<HTMLElement>('.chart-window-btn').forEach(b => {
        const isActive = b === btn;
        b.classList.toggle('active', isActive);
        b.style.borderColor = isActive ? 'var(--accent-dim)' : 'var(--border)';
        b.style.color = isActive ? 'var(--accent)' : 'var(--text-dim)';
      });
      updateCharts();
    });
  });

  // Record snapshots every 60 seconds
  const snapshotTick = setInterval(() => {
    const now = Date.now();
    if (now - _lastSnapshotTs < 55_000) return;
    _lastSnapshotTs = now;
    const players = parseInt(statCards[0].textContent || '0');
    const lobbies = parseInt(statCards[1].textContent || '0');
    const matches = parseInt(statCards[2].textContent || '0');
    recordSnapshot(players, lobbies, matches).then(() => updateCharts());
  }, 60_000);
  unsubs.push(() => clearInterval(snapshotTick));

  // 5. Activity Feed
  function renderActivity(): void {
    const el = document.getElementById('live-activity');
    if (!el) return;
    const events = getEvents();
    if (events.length === 0) {
      el.innerHTML = '<div style="color:var(--text-dim); font-size:12px;">No activity yet</div>';
      return;
    }
    el.innerHTML = events.slice(0, 30).map(ev => {
      const age = ago(ev.ts);
      return `<div style="padding:4px 0; border-bottom:1px solid var(--border); font-size:12px; display:flex; gap:8px; align-items:center;">
        <span>${ev.icon}</span>
        <span style="flex:1;">${escapeHtml(ev.text)}</span>
        <span style="color:var(--text-dim); font-size:11px; white-space:nowrap;">${age}</span>
      </div>`;
    }).join('');
  }
  renderActivity();
  const feedUnsub = onUpdate(renderActivity);
  unsubs.push(feedUnsub);

  // 6. Project Health (async, non-blocking)
  loadHealthPanel();

  return () => unsubs.forEach(fn => fn());
}

async function loadHealthPanel(): Promise<void> {
  const panel = document.getElementById('live-health-panel');
  if (!panel) return;

  const refreshBtn = document.getElementById('health-refresh-btn');
  refreshBtn?.addEventListener('click', () => loadHealthPanel());

  let digest: ActivityDigest;
  let testHealth: TestHealth;
  let moduleMap: ModuleMap | null = null;

  try {
    const res = await fetch('/__admin_exec/script?name=activity-digest', { method: 'POST' });
    if (!res.ok) throw new Error('Failed');
    const body = await res.json() as { output: string };
    digest = JSON.parse(body.output) as ActivityDigest;
  } catch {
    panel.innerHTML = `<p style="color:var(--red); font-size:12px;">Failed to load activity digest</p>
      <button id="health-refresh-btn" class="refresh-btn" style="font-size:10px;">Retry</button>`;
    document.getElementById('health-refresh-btn')?.addEventListener('click', () => loadHealthPanel());
    return;
  }

  try {
    const res = await fetch('/__admin_exec/script?name=test-health', { method: 'POST' });
    if (!res.ok) throw new Error('Failed');
    const body = await res.json() as { output: string };
    testHealth = JSON.parse(body.output) as TestHealth;
  } catch {
    panel.innerHTML = `<p style="color:var(--red); font-size:12px;">Failed to load test health</p>
      <button id="health-refresh-btn" class="refresh-btn" style="font-size:10px;">Retry</button>`;
    document.getElementById('health-refresh-btn')?.addEventListener('click', () => loadHealthPanel());
    return;
  }

  try {
    const res = await fetch('/__admin_exec/script?name=module-map', { method: 'POST' });
    if (!res.ok) throw new Error('Failed');
    const body = await res.json() as { output: string };
    moduleMap = JSON.parse(body.output) as ModuleMap;
  } catch { /* non-fatal */ }

  panel.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <h3 style="margin:0;">Project Health</h3>
      <button id="health-refresh-btn" class="refresh-btn" style="font-size:10px;">Refresh</button>
    </div>
    ${renderStatCards(digest, testHealth)}
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px;">
      <div>
        <h4>Hot Modules (30d)</h4>
        ${renderHotModules(digest.hotModules)}
      </div>
      <div>
        <h4>Worktrees</h4>
        ${renderWorktrees(digest.worktrees)}
      </div>
    </div>
    <div style="margin-top:20px;">
      <h4>Test Coverage Heatmap</h4>
      ${renderCoverageHeatmap(testHealth, moduleMap)}
    </div>
  `;

  document.getElementById('health-refresh-btn')?.addEventListener('click', () => loadHealthPanel());
}

function renderPlayers(el: HTMLElement, uids: string[], val: Record<string, { ts: number }>): void {
  el.innerHTML = uids.map(uid => {
    const name = _nameCache[uid];
    const display = name
      ? `<strong>${escapeHtml(name)}</strong> <span style="color:var(--text-dim);">${uid.slice(0, 12)}</span>`
      : `<span style="color:var(--text-dim);">${uid.slice(0, 12)}</span>`;
    return `<div style="padding:4px 0; border-bottom:1px solid var(--border); font-size:13px; display:flex; justify-content:space-between;">
      <span>${display}</span>
      <span style="color:var(--text-dim); font-size:11px;">${ago(val[uid]?.ts || 0)}</span>
    </div>`;
  }).join('') || '<div style="color:var(--text-dim);">No players online</div>';
}
