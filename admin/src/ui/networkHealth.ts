// admin/src/ui/networkHealth.ts — Desync + latency monitoring panels
import { rtdb } from '../firebase';
import { ref, get } from 'firebase/database';
import { escapeHtml } from './render';

interface DesyncEvent {
  ts: number;
  matchId: string;
  players: string[];
  tick: number;
  delta: number;
}

interface LatencyBucket {
  range: string;
  count: number;
}

export async function renderNetworkHealth(containerId: string): Promise<void> {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = '<p style="color:var(--text-dim);">Loading network health...</p>';

  // Fetch desync events
  let desyncs: DesyncEvent[] = [];
  try {
    const snap = await get(ref(rtdb, 'metrics/desync'));
    const val = snap.val() as Record<string, DesyncEvent> | null;
    if (val) desyncs = Object.values(val).sort((a, b) => b.ts - a.ts).slice(0, 50);
  } catch (err) {
    console.warn('[networkHealth] Failed to load desync metrics:', err);
  }

  // Fetch latency data
  let latencyBuckets: LatencyBucket[] = [];
  try {
    const snap = await get(ref(rtdb, 'metrics/latency'));
    const val = snap.val() as Record<string, number> | null;
    if (val) {
      latencyBuckets = Object.entries(val).map(([range, count]) => ({ range, count }));
    }
  } catch (err) {
    console.warn('[networkHealth] Failed to load latency metrics:', err);
  }

  const desyncCount = desyncs.length;
  const desyncColor = desyncCount > 10 ? 'var(--red-bright)' : desyncCount > 0 ? 'var(--yellow)' : 'var(--green)';

  const maxLatency = Math.max(...latencyBuckets.map(b => b.count), 1);
  const latencyBars = latencyBuckets.map(b => {
    const pct = Math.round((b.count / maxLatency) * 100);
    return `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
        <span style="min-width:60px;font-size:10px;color:var(--text-dim);text-align:right;">${escapeHtml(b.range)}</span>
        <div style="flex:1;height:8px;background:var(--border);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px;"></div>
        </div>
        <span style="min-width:30px;font-size:10px;color:var(--text-quiet);">${b.count}</span>
      </div>
    `;
  }).join('');

  const desyncRows = desyncs.slice(0, 10).map(d => {
    const time = new Date(d.ts);
    return `<div style="padding:3px 0;border-bottom:1px solid var(--border);font-size:11px;display:flex;gap:8px;">
      <span style="color:var(--text-quiet);min-width:50px;">${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      <span style="color:var(--accent);font-family:var(--font-mono);">${escapeHtml(d.matchId.slice(0, 8))}</span>
      <span style="color:var(--text-dim);">tick ${d.tick}, delta ${d.delta}ms</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div>
        <h4 style="display:flex;align-items:center;gap:6px;margin:0 0 8px;">
          Desync Events
          <span style="color:${desyncColor};font-size:9px;font-family:var(--font-display);font-weight:700;letter-spacing:1px;">${desyncCount} TOTAL</span>
        </h4>
        ${desyncRows || '<p style="color:var(--text-dim);font-size:11px;">No desync events recorded</p>'}
      </div>
      <div>
        <h4 style="margin:0 0 8px;">Latency Distribution</h4>
        ${latencyBars || '<p style="color:var(--text-dim);font-size:11px;">No latency data. Enable metrics collection in feature flags.</p>'}
      </div>
    </div>
  `;
}

