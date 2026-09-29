import { initializeApp, getApp } from 'firebase/app';
import { getDatabase, ref, onValue } from 'firebase/database';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import type { ServerMeta } from '../types';
import { loadUsageRecords, aggregateUsage, usageInWindow, estimateUsagePct, formatDuration } from './ccUsage';
import { sessionManager } from './ccSessionManager';

// ── Service status cache (shared with env dropdown + status page) ─────────

export type StatusColor = 'green' | 'yellow' | 'red' | 'dim';

export interface ServiceStatus {
  color: StatusColor;
  text: string;
}

const _serviceStatus: Record<string, ServiceStatus> = {
  live:  { color: 'dim', text: 'LIVE —' },
  test:  { color: 'dim', text: 'TEST —' },
  local: { color: 'dim', text: 'LOCAL —' },
  fn:    { color: 'dim', text: 'Fn —' },
};

const _statusListeners: Array<() => void> = [];

/** Subscribe to service status changes. Returns unsubscribe function. */
export function onServiceStatusChanged(fn: () => void): () => void {
  _statusListeners.push(fn);
  return () => {
    const idx = _statusListeners.indexOf(fn);
    if (idx >= 0) _statusListeners.splice(idx, 1);
  };
}

/** Get current status for a service. */
export function getServiceStatus(service: string): ServiceStatus {
  return _serviceStatus[service] ?? { color: 'dim', text: '—' };
}

/** Get all service statuses. */
export function getAllServiceStatuses(): Record<string, ServiceStatus> {
  return { ..._serviceStatus };
}

// ── Helpers ──────────────────────────────────────────────

function setIndicator(
  containerId: string,
  color: StatusColor,
  text: string,
): void {
  // Update cache
  const key = containerId.replace('banner-', '');
  if (_serviceStatus[key]) {
    _serviceStatus[key] = { color, text };
    for (const fn of _statusListeners) fn();
  }

  // Update DOM element if present
  const el = document.getElementById(containerId);
  if (!el) return;
  const dot = el.querySelector<HTMLElement>('.status-dot');
  const span = el.querySelector<HTMLElement>('span:last-child');
  if (dot) {
    dot.className = `status-dot ${color}`;
  }
  if (span) span.textContent = text;
}

export function ageColor(deployedAt: number): 'green' | 'yellow' | 'red' {
  const hoursAgo = (Date.now() - deployedAt) / (1000 * 60 * 60);
  if (hoursAgo < 24) return 'green';
  if (hoursAgo < 72) return 'yellow';
  return 'red';
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function formatResetTime(records: { ts: string }[]): string {
  if (records.length === 0) return '—';
  const earliest = records.reduce((min, r) => r.ts < min ? r.ts : min, records[0].ts);
  const startDate = new Date(earliest);
  const now = new Date();
  const diffMs = now.getTime() - startDate.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffM = Math.floor((diffMs % 3_600_000) / 60_000);
  if (diffH > 0) return `${diffH}h ${diffM}m tracked`;
  return `${diffM}m tracked`;
}

// ── Hardcoded DB URLs for monitors ──────────────────────

const PROD_DB_URL = 'https://luminal-game-default-rtdb.firebaseio.com';
const LOCAL_GAME_URL = 'http://localhost:5173';

function getOrCreateApp(name: string, dbUrl: string) {
  try { return getApp(name); } catch { return initializeApp({ databaseURL: dbUrl }, name); }
}

// ── Init ─────────────────────────────────────────────────

let _healthInterval: ReturnType<typeof setInterval> | null = null;

export function initBanner(): () => void {
  const cleanups: (() => void)[] = [];

  // ── LIVE monitor (always reads from production DB) ──
  try {
    const liveApp = getOrCreateApp('banner-live', PROD_DB_URL);
    const liveDb = getDatabase(liveApp);
    const liveRef = ref(liveDb, 'meta/serverVersion');
    const liveUnsub = onValue(liveRef, (snap) => {
      const data = snap.val() as ServerMeta | null;
      if (data) {
        setIndicator('banner-live', 'green', `LIVE ${data.version}`);
      } else {
        setIndicator('banner-live', 'red', 'LIVE —');
      }
    }, () => setIndicator('banner-live', 'red', 'LIVE —'));
    cleanups.push(liveUnsub);
  } catch {
    setIndicator('banner-live', 'red', 'LIVE —');
  }

  // ── TEST monitor (always reads from production DB, test path) ──
  try {
    const testApp = getOrCreateApp('banner-test', PROD_DB_URL);
    const testDb = getDatabase(testApp);
    const testRef = ref(testDb, 'meta/testServerVersion');
    const testUnsub = onValue(testRef, (snap) => {
      const data = snap.val() as ServerMeta | null;
      if (data) {
        setIndicator('banner-test', 'green', `TEST ${data.version}`);
      } else {
        setIndicator('banner-test', 'red', 'TEST —');
      }
    }, () => setIndicator('banner-test', 'red', 'TEST —'));
    cleanups.push(testUnsub);
  } catch {
    setIndicator('banner-test', 'red', 'TEST —');
  }

  // ── LOCAL monitor (pings localhost game server + reads version) ──
  let _localVersion: string | null = null;

  // Fetch version once from admin middleware (always available, independent of game server)
  (async () => {
    try {
      const vRes = await fetch('/__admin_exec/version');
      if (vRes.ok) {
        const vData = await vRes.json() as { version?: string };
        if (vData.version) _localVersion = vData.version.startsWith('v') ? vData.version : `v${vData.version}`;
      }
    } catch { /* non-fatal */ }
  })();

  async function checkLocal(): Promise<void> {
    try {
      await fetch(LOCAL_GAME_URL, { mode: 'no-cors', signal: AbortSignal.timeout(2000) });
      setIndicator('banner-local', 'green', _localVersion ? `LOCAL ${_localVersion}` : 'LOCAL OK');
    } catch {
      setIndicator('banner-local', 'red', _localVersion ? `LOCAL ${_localVersion}` : 'LOCAL —');
    }
  }
  checkLocal();
  const localTick = setInterval(checkLocal, 15_000);
  cleanups.push(() => clearInterval(localTick));

  // ── Functions health check ──
  const healthCheckFn = httpsCallable<void, { ok: boolean; ts: number }>(functions, 'healthCheck');

  async function checkFnHealth(): Promise<void> {
    try {
      await healthCheckFn();
      setIndicator('banner-fn', 'green', 'Fn OK');
    } catch {
      setIndicator('banner-fn', 'red', 'Fn DOWN');
    }
  }

  checkFnHealth();
  _healthInterval = setInterval(checkFnHealth, 60_000);
  cleanups.push(() => {
    if (_healthInterval) { clearInterval(_healthInterval); _healthInterval = null; }
  });

  // ── CC Usage display ──
  const tokensEl = document.getElementById('cc-usage-tokens');
  const sessionsEl = document.getElementById('cc-usage-sessions');
  const resetEl = document.getElementById('cc-usage-reset');
  const refreshBtn = document.getElementById('cc-usage-refresh');

  interface LiveUsage {
    available: boolean;
    five_hour?: { used_pct: number | null; resets_at: number | null };
    seven_day?: { used_pct: number | null; resets_at: number | null };
  }

  function pctColor(pct: number): string {
    if (pct > 80) return 'var(--red-bright,#d45234)';
    if (pct > 50) return 'var(--yellow)';
    return 'var(--green)';
  }

  function formatCountdown(resetEpoch: number): string {
    const ms = resetEpoch * 1000 - Date.now();
    if (ms <= 0) return 'now';
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}h${m}m` : `${m}m`;
  }

  async function refreshUsage(): Promise<void> {
    let live: LiveUsage = { available: false };
    try {
      const liveRes = await fetch('/__admin_exec/claude-usage');
      if (liveRes.ok) live = await liveRes.json() as LiveUsage;
    } catch { /* fall through to local tracking */ }

    const records = await loadUsageRecords();
    const agg = aggregateUsage(records);
    const total = agg.totalInput + agg.totalOutput;

    if (tokensEl) tokensEl.textContent = `${formatTokens(total)} tok`;
    if (sessionsEl) sessionsEl.textContent = `${agg.totalSessions} runs`;

    if (resetEl) {
      if (live.available && live.five_hour?.used_pct != null) {
        const u5 = Math.round(live.five_hour.used_pct);
        const u7 = live.seven_day?.used_pct != null ? Math.round(live.seven_day.used_pct) : null;
        const r5 = live.five_hour.resets_at ? formatCountdown(live.five_hour.resets_at) : '';
        const r7 = live.seven_day?.resets_at ? formatCountdown(live.seven_day.resets_at) : '';

        const remain5 = 100 - u5;
        const remain7 = u7 != null ? 100 - u7 : null;

        let html = `<span style="color:${pctColor(u5)};">${remain5}% 5h</span>`;
        if (r5) html += `<span style="color:var(--text-quiet);"> ${r5}</span>`;
        if (remain7 != null) {
          html += ` \u00B7 <span style="color:${pctColor(u7!)};">${remain7}% 7d</span>`;
          if (r7) html += `<span style="color:var(--text-quiet);"> ${r7}</span>`;
        }
        resetEl.innerHTML = html;
      } else {
        const session5h = usageInWindow(records, 5 * 3_600_000);
        const sessionPct = estimateUsagePct(session5h.activeTimeMs, 5);
        const weekly = usageInWindow(records, 7 * 24 * 3_600_000);
        const weeklyActiveTime = formatDuration(weekly.activeTimeMs);
        resetEl.innerHTML = `<span style="color:${pctColor(sessionPct)};">${100 - sessionPct}% 5h</span> \u00B7 ${weeklyActiveTime}/wk`;
      }
    }
  }

  refreshUsage();
  refreshBtn?.addEventListener('click', refreshUsage);

  const usageUnsub = sessionManager.onChange(() => {
    const active = sessionManager.active();
    if (!active) refreshUsage();
  });
  cleanups.push(usageUnsub);

  const usageTick = setInterval(refreshUsage, 10_000);
  cleanups.push(() => clearInterval(usageTick));

  return () => { for (const fn of cleanups) fn(); };
}
