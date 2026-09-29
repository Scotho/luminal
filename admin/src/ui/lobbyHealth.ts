// admin/src/ui/lobbyHealth.ts — Lobby health monitor + error rate tracking
import { escapeHtml, ago } from './render';

export interface LobbyInfo {
  id: string;
  status: string;
  host: string;
  playerCount: number;
  createdAt: number;
  lastActivity: number;
}

const STALE_THRESHOLD = 5 * 60_000; // 5 minutes

export function analyzeLobbyHealth(lobbies: Record<string, any>): {
  total: number;
  stale: LobbyInfo[];
  byStatus: Record<string, number>;
  avgWaitMs: number;
} {
  const entries = Object.entries(lobbies);
  const now = Date.now();
  const stale: LobbyInfo[] = [];
  const byStatus: Record<string, number> = {};
  let totalWait = 0;
  let waitCount = 0;

  for (const [id, lobby] of entries) {
    const status = (lobby.status || 'unknown').toLowerCase();
    byStatus[status] = (byStatus[status] || 0) + 1;

    const lastActivity = lobby.lastActivity ?? lobby.createdAt ?? 0;
    const createdAt = lobby.createdAt ?? 0;
    const host = lobby.host?.username ?? '?';
    const playerCount = 1 + (lobby.guests ? Object.keys(lobby.guests).length : 0);

    if (now - lastActivity > STALE_THRESHOLD) {
      stale.push({ id, status, host, playerCount, createdAt, lastActivity });
    }

    if (status === 'waiting' && createdAt > 0) {
      totalWait += now - createdAt;
      waitCount++;
    }
  }

  return {
    total: entries.length,
    stale,
    byStatus,
    avgWaitMs: waitCount > 0 ? totalWait / waitCount : 0,
  };
}

export function renderLobbyHealthPanel(containerId: string, lobbies: Record<string, any>): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  const health = analyzeLobbyHealth(lobbies);
  const staleCount = health.stale.length;
  const staleColor = staleCount > 0 ? 'var(--orange)' : 'var(--green)';
  const avgWaitSec = Math.round(health.avgWaitMs / 1000);
  const avgWaitStr = avgWaitSec > 60 ? `${Math.floor(avgWaitSec / 60)}m ${avgWaitSec % 60}s` : `${avgWaitSec}s`;

  const statusChips = Object.entries(health.byStatus).map(([status, count]) => {
    const color = status === 'waiting' ? 'var(--yellow)' : status === 'in-game' ? 'var(--green)' : 'var(--text-dim)';
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:1px solid ${color}40;border-radius:2px;font-size:10px;color:${color};">
      ${escapeHtml(status)} <strong>${count}</strong>
    </span>`;
  }).join('');

  const staleRows = health.stale.slice(0, 5).map(s =>
    `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px;border-bottom:1px solid var(--border);">
      <span style="color:var(--accent);font-family:var(--font-mono);">${escapeHtml(s.id.slice(0, 10))}</span>
      <span style="color:var(--text-dim);">${escapeHtml(s.host)}</span>
      <span style="color:var(--orange);">stale ${ago(s.lastActivity)}</span>
    </div>`
  ).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <h4 style="margin:0;">Lobby Health</h4>
      <span style="color:${staleColor};font-size:10px;font-family:var(--font-display);font-weight:700;letter-spacing:1px;">
        ${staleCount > 0 ? `${staleCount} STALE` : 'HEALTHY'}
      </span>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
      ${statusChips || '<span style="color:var(--text-dim);font-size:11px;">No lobbies</span>'}
    </div>
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">
      Avg wait: <strong style="color:var(--text);">${avgWaitStr}</strong>
    </div>
    ${staleRows ? `<div style="margin-top:6px;">${staleRows}</div>` : ''}
  `;
}

// ── Error Rate Monitor ──────────────────────────────────

interface ErrorEntry {
  ts: string;
  error: string;
}

export function analyzeErrorRate(reports: ErrorEntry[]): {
  hourly: number[];
  currentHour: number;
  avgRate: number;
  isSpike: boolean;
} {
  const now = Date.now();
  const hourly: number[] = new Array(24).fill(0);

  for (const r of reports) {
    const ts = new Date(r.ts).getTime();
    const hoursAgo = Math.floor((now - ts) / 3_600_000);
    if (hoursAgo >= 0 && hoursAgo < 24) {
      hourly[23 - hoursAgo]++;
    }
  }

  const currentHour = hourly[23];
  const avgRate = hourly.slice(0, 23).reduce((a, b) => a + b, 0) / 23;
  const isSpike = currentHour > avgRate * 2 && currentHour >= 3;

  return { hourly, currentHour, avgRate, isSpike };
}

export function renderErrorRatePanel(containerId: string, reports: ErrorEntry[]): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  const analysis = analyzeErrorRate(reports);
  const spikeColor = analysis.isSpike ? 'var(--red-bright)' : 'var(--green)';
  const max = Math.max(...analysis.hourly, 1);

  // Mini bar chart
  const barWidth = 100 / 24;
  const bars = analysis.hourly.map((count, i) => {
    const height = Math.max(2, (count / max) * 40);
    const isLast = i === 23;
    const color = isLast && analysis.isSpike ? 'var(--red-bright)' : isLast ? 'var(--accent)' : 'rgba(110,224,240,0.3)';
    return `<div style="width:${barWidth}%;height:${height}px;background:${color};border-radius:1px;"></div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <h4 style="margin:0;">Error Rate (24h)</h4>
      <span style="color:${spikeColor};font-size:10px;font-family:var(--font-display);font-weight:700;letter-spacing:1px;">
        ${analysis.isSpike ? 'SPIKE DETECTED' : 'NORMAL'}
      </span>
    </div>
    <div style="display:flex;align-items:flex-end;gap:1px;height:40px;margin-bottom:4px;">
      ${bars}
    </div>
    <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-quiet);">
      <span>24h ago</span>
      <span>Now: ${analysis.currentHour} err/h (avg: ${analysis.avgRate.toFixed(1)})</span>
    </div>
  `;
}
