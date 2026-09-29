// admin/src/sections/firebaseMetrics.ts — Firebase usage metrics dashboard
import { statCard } from '../ui/render';
import { icon } from '../ui/icons';

interface FirebaseUsage {
  rtdb: { reads: number; writes: number; bandwidth: string };
  firestore: { reads: number; writes: number; deletes: number };
  functions: { invocations: number; errors: number; avgDuration: string };
  storage: { size: string; downloads: number };
}

export async function renderFirebaseMetrics(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">${icon('database', 18)} Firebase Metrics</h2>
      <button id="fb-metrics-refresh" class="refresh-btn">Refresh</button>
    </div>
    <p style="color:var(--text-dim);font-size:11px;margin-bottom:16px;">
      Metrics are estimated from local tracking. For exact billing data, visit the Firebase Console.
    </p>
    <div id="fb-metrics-content"><p style="color:var(--text-dim);">Loading metrics...</p></div>
  `;

  await loadMetrics(container);
  container.querySelector('#fb-metrics-refresh')?.addEventListener('click', () => loadMetrics(container));
}

async function loadMetrics(container: HTMLElement): Promise<void> {
  const content = document.getElementById('fb-metrics-content');
  if (!content) return;

  // Attempt to fetch from admin middleware
  let metrics: FirebaseUsage | null = null;
  try {
    const res = await fetch('/__admin_exec/firebase-metrics');
    if (res.ok) metrics = await res.json() as FirebaseUsage;
  } catch (err) {
    console.warn('[firebaseMetrics] Failed to fetch metrics:', err);
  }

  if (!metrics) {
    content.innerHTML = `
      <div style="padding:20px;text-align:center;color:var(--text-dim);font-size:12px;">
        <p style="margin:0 0 8px;">No metrics data available.</p>
        <p style="margin:0;font-size:10px;color:var(--text-quiet);">Connect the admin middleware or visit the <a href="https://console.firebase.google.com" target="_blank" style="color:var(--accent);">Firebase Console</a> for usage data.</p>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <h3 style="font-size:11px;color:var(--text-heading);font-family:var(--font-display);letter-spacing:2px;margin:0 0 8px;">REALTIME DATABASE</h3>
    <div class="stat-grid" style="margin-bottom:16px;">
      ${statCard(String(metrics.rtdb.reads), 'Reads')}
      ${statCard(String(metrics.rtdb.writes), 'Writes')}
      ${statCard(metrics.rtdb.bandwidth, 'Bandwidth')}
    </div>

    <h3 style="font-size:11px;color:var(--text-heading);font-family:var(--font-display);letter-spacing:2px;margin:0 0 8px;">FIRESTORE</h3>
    <div class="stat-grid" style="margin-bottom:16px;">
      ${statCard(String(metrics.firestore.reads), 'Reads')}
      ${statCard(String(metrics.firestore.writes), 'Writes')}
      ${statCard(String(metrics.firestore.deletes), 'Deletes')}
    </div>

    <h3 style="font-size:11px;color:var(--text-heading);font-family:var(--font-display);letter-spacing:2px;margin:0 0 8px;">CLOUD FUNCTIONS</h3>
    <div class="stat-grid" style="margin-bottom:16px;">
      ${statCard(String(metrics.functions.invocations), 'Invocations')}
      ${statCard(String(metrics.functions.errors), 'Errors')}
      ${statCard(metrics.functions.avgDuration, 'Avg Duration')}
    </div>

    <h3 style="font-size:11px;color:var(--text-heading);font-family:var(--font-display);letter-spacing:2px;margin:0 0 8px;">STORAGE</h3>
    <div class="stat-grid" style="margin-bottom:16px;">
      ${statCard(metrics.storage.size, 'Total Size')}
      ${statCard(String(metrics.storage.downloads), 'Downloads')}
    </div>
  `;
}
