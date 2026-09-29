import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { confirmAction } from '../ui/confirm';
import { icon } from '../ui/icons';

async function exportConfig(): Promise<void> {
  const config: Record<string, unknown> = {};

  // localStorage items
  const lsKeys = ['luminal-admin-sidebar-order', 'luminal-admin-favorites', 'luminal-admin-theme'];
  for (const key of lsKeys) {
    const val = localStorage.getItem(key);
    if (!val) continue;
    try {
      config[key] = JSON.parse(val);
    } catch {
      config[key] = val;
    }
  }

  // Data files
  const dataFiles = ['notes.json', 'tasks.json', 'sessions.json'];
  for (const file of dataFiles) {
    try {
      const res = await fetch(`/data/${file}`);
      if (res.ok) config[`data:${file}`] = await res.json();
    } catch { /* skip */ }
  }

  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `luminal-admin-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importConfig(): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const config = JSON.parse(text) as Record<string, unknown>;

      // Restore localStorage
      const lsKeys = ['luminal-admin-sidebar-order', 'luminal-admin-favorites', 'luminal-admin-theme'];
      for (const key of lsKeys) {
        if (config[key] != null) localStorage.setItem(key, JSON.stringify(config[key]));
      }

      // Restore data files
      for (const [k, v] of Object.entries(config)) {
        if (k.startsWith('data:')) {
          const filename = k.slice(5);
          await fetch(`/__admin_save?file=${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(v, null, 2),
          });
        }
      }

      // Reload to apply
      window.location.reload();
    } catch (err) {
      alert('Import failed: ' + String(err));
    }
  });
  input.click();
}

const purgeLobbiesFn = httpsCallable<{ filter: string }, { purged: number; total: number }>(functions, 'purgeLobbies');
const purgeMatchesFn = httpsCallable<void, { success: boolean }>(functions, 'purgeMatches');
const purgeDebugReportsFn = httpsCallable<void, { success: boolean }>(functions, 'purgeDebugReports');

export function showResult(container: HTMLElement, message: string, isError = false): void {
  const el = container.querySelector<HTMLElement>('#purge-result');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? 'var(--red)' : 'var(--green)';
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

export function renderPurge(container: HTMLElement): void {
  container.innerHTML = `
    <h2>${icon('trash-2', 18)} Admin Actions</h2>
    <p style="color:var(--text-dim); margin-bottom:20px;">
      All actions require double-click confirmation. First click shows "CONFIRM?", second click executes.
    </p>
    <div id="purge-result" style="display:none; padding:8px 12px; margin-bottom:16px; border-radius:4px; font-size:13px; font-weight:600;"></div>
    <h3>Lobby Purge</h3>
    <div class="purge-grid" style="margin-bottom:24px;">
      <button class="purge-btn" id="purge-all-lobbies">Purge All Lobbies</button>
      <button class="purge-btn" id="purge-unknown-lobbies">Purge Unknown Status</button>
      <button class="purge-btn" id="purge-waiting-lobbies">Purge Waiting Lobbies</button>
      <button class="purge-btn" id="purge-stale-lobbies">Purge Stale (8h)</button>
    </div>
    <h3>Data Purge</h3>
    <div class="purge-grid">
      <button class="purge-btn" id="purge-all-matches">Purge All Matches</button>
      <button class="purge-btn" id="purge-all-reports">Purge All Bug Reports</button>
    </div>
    <h3 style="margin-top:24px;">Config Backup</h3>
    <div class="purge-grid">
      <button class="purge-btn" id="purge-export" style="border-color:var(--accent-dim,rgba(46,108,123,0.56)); color:var(--accent);">Export Config</button>
      <button class="purge-btn" id="purge-import" style="border-color:var(--accent-dim,rgba(46,108,123,0.56)); color:var(--accent);">Import Config</button>
    </div>
  `;

  const lobbyAction = (filter: string) => () =>
    purgeLobbiesFn({ filter }).then(
      r => { showResult(container, `Purged ${r.data.purged} of ${r.data.total} lobbies`); },
      e => { showResult(container, `Failed: ${String(e)}`, true); throw e; },
    );

  confirmAction(document.getElementById('purge-all-lobbies')!, 'Purge All Lobbies', lobbyAction('all'));
  confirmAction(document.getElementById('purge-unknown-lobbies')!, 'Purge Unknown Status', lobbyAction('unknown'));
  confirmAction(document.getElementById('purge-waiting-lobbies')!, 'Purge Waiting Lobbies', lobbyAction('waiting'));
  confirmAction(document.getElementById('purge-stale-lobbies')!, 'Purge Stale (8h)', lobbyAction('stale'));
  confirmAction(
    document.getElementById('purge-all-matches')!,
    'Purge All Matches',
    () => purgeMatchesFn().then(
      () => { showResult(container, 'All matches purged'); },
      e => { showResult(container, `Failed: ${String(e)}`, true); throw e; },
    ),
  );
  confirmAction(
    document.getElementById('purge-all-reports')!,
    'Purge All Bug Reports',
    () => purgeDebugReportsFn().then(
      () => { showResult(container, 'All bug reports purged'); },
      e => { showResult(container, `Failed: ${String(e)}`, true); throw e; },
    ),
  );

  document.getElementById('purge-export')!.addEventListener('click', () => {
    exportConfig().then(
      () => { showResult(container, 'Config exported'); },
      e => { showResult(container, `Export failed: ${String(e)}`, true); },
    );
  });

  document.getElementById('purge-import')!.addEventListener('click', () => {
    importConfig();
  });
}
