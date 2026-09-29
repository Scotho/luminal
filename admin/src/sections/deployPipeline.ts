// ── Deploy Pipeline section ───────────────────────────────
// One-click deploy UI backed by /__admin_deploy/* routes.
//
// Exported entry follows the cleanup-function pattern (see git.ts / viewer.ts):
//   const cleanup = renderDeployPipeline(container);
//   // ... later, on section switch
//   cleanup();
//
// Responsibilities:
//   • Render target picker, deploy / dry-run buttons, log pane and history table.
//   • Confirm destructive deploys via window.confirm (mockable in tests).
//   • Stream live logs from the server via EventSource when a deploy is in flight.
//   • Disable buttons while a deploy is running.

import { escapeHtml } from '../ui/render';
import type { DeployRecord, DeployTarget } from '../types';

interface DeployRunResponse {
  ok?: boolean;
  id?: string;
  agentId?: string;
  command?: string;
  error?: string;
}

const TARGETS: readonly DeployTarget[] = ['live', 'test', 'rules', 'functions', 'hosting'] as const;

/** Small helper so tests can stub it out. */
function confirmLiveDeploy(target: DeployTarget): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true;
  const msg = target === 'live'
    ? 'Deploy to LIVE? This will affect real users. Continue?'
    : `Deploy to ${target}? Continue?`;
  return window.confirm(msg);
}

/** Render a DeployRecord into an HTML table row. */
function renderHistoryRow(r: DeployRecord): string {
  const started = new Date(r.startedAt).toLocaleString();
  const duration = r.finishedAt
    ? `${Math.round((r.finishedAt - r.startedAt) / 1000)}s`
    : r.status === 'running' ? '…' : '—';
  const statusColor: Record<DeployRecord['status'], string> = {
    running: 'var(--accent, #4af)',
    success: 'var(--text-ok, #4c6)',
    failure: 'var(--text-err, #f55)',
    aborted: 'var(--text-dim, #888)',
  };
  return `
    <tr data-deploy-id="${escapeHtml(r.id)}">
      <td style="font-family:var(--font-mono);font-size:10px;">${escapeHtml(r.target)}</td>
      <td style="color:${statusColor[r.status]};font-weight:700;">${escapeHtml(r.status.toUpperCase())}</td>
      <td>${duration}</td>
      <td style="color:var(--text-dim);font-size:10px;">${escapeHtml(started)}</td>
      <td>
        <button class="refresh-btn" data-action="view-log" data-id="${escapeHtml(r.id)}">View log</button>
      </td>
    </tr>
  `;
}

/** Load history from the server into the table. */
async function loadHistory(container: HTMLElement): Promise<void> {
  const tbody = container.querySelector<HTMLElement>('#deploy-history-tbody');
  if (!tbody) return;
  try {
    const res = await fetch('/__admin_deploy/history');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json() as DeployRecord[];
    if (list.length === 0) {
      tbody.innerHTML = `
        <tr><td colspan="5" style="color:var(--text-dim);font-size:11px;text-align:center;padding:12px;">
          No deploys yet.
        </td></tr>
      `;
      return;
    }
    tbody.innerHTML = list.map(renderHistoryRow).join('');
  } catch (err) {
    tbody.innerHTML = `
      <tr><td colspan="5" style="color:var(--text-err);font-size:11px;">
        Failed to load history: ${escapeHtml(err instanceof Error ? err.message : String(err))}
      </td></tr>
    `;
  }
}

/** Append a log line to the pane (auto-scrolled to bottom). */
function appendLog(pane: HTMLElement, line: string): void {
  pane.textContent = `${pane.textContent ?? ''}${line}\n`;
  pane.scrollTop = pane.scrollHeight;
}

function setButtonsDisabled(container: HTMLElement, disabled: boolean): void {
  container.querySelectorAll<HTMLButtonElement>('button[data-action="deploy"], button[data-action="dry-run"]')
    .forEach(btn => { btn.disabled = disabled; });
}

function selectedTarget(container: HTMLElement): DeployTarget {
  const picker = container.querySelector<HTMLSelectElement>('#deploy-target');
  const val = picker?.value ?? 'test';
  return (TARGETS as readonly string[]).includes(val) ? val as DeployTarget : 'test';
}

async function runDeploy(
  container: HTMLElement,
  logPane: HTMLElement,
  target: DeployTarget,
  dryRun: boolean,
  eventSourceRef: { current: EventSource | null },
): Promise<void> {
  if (!dryRun && !confirmLiveDeploy(target)) return;

  logPane.textContent = '';
  appendLog(logPane, `▸ ${dryRun ? 'DRY-RUN' : 'DEPLOY'} ${target}`);
  setButtonsDisabled(container, true);

  let runResp: DeployRunResponse;
  try {
    const res = await fetch('/__admin_deploy/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, dryRun }),
    });
    runResp = await res.json() as DeployRunResponse;
    if (!res.ok || !runResp.ok) {
      appendLog(logPane, `ERROR: ${runResp.error ?? `HTTP ${res.status}`}`);
      setButtonsDisabled(container, false);
      void loadHistory(container);
      return;
    }
  } catch (err) {
    appendLog(logPane, `NETWORK ERROR: ${err instanceof Error ? err.message : String(err)}`);
    setButtonsDisabled(container, false);
    return;
  }

  const id = runResp.id;
  if (!id) {
    appendLog(logPane, 'ERROR: server did not return a deploy id');
    setButtonsDisabled(container, false);
    return;
  }
  if (runResp.command) appendLog(logPane, `$ ${runResp.command}`);

  // Open SSE
  if (eventSourceRef.current) {
    eventSourceRef.current.close();
    eventSourceRef.current = null;
  }
  const es = new EventSource(`/__admin_deploy/stream?id=${encodeURIComponent(id)}`);
  eventSourceRef.current = es;

  const parseLine = (ev: MessageEvent): string => {
    try {
      const data = JSON.parse(ev.data as string) as { line?: string };
      return data.line ?? String(ev.data);
    } catch {
      return String(ev.data);
    }
  };

  es.addEventListener('stdout', (ev: MessageEvent) => appendLog(logPane, parseLine(ev)));
  es.addEventListener('stderr', (ev: MessageEvent) => appendLog(logPane, parseLine(ev)));
  es.addEventListener('status', (ev: MessageEvent) => appendLog(logPane, parseLine(ev)));
  es.addEventListener('exit', (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data as string) as { code?: number | null };
      appendLog(logPane, `▸ exit ${data.code ?? '?'}`);
    } catch {
      appendLog(logPane, '▸ exit');
    }
    es.close();
    eventSourceRef.current = null;
    setButtonsDisabled(container, false);
    void loadHistory(container);
  });
  es.onerror = () => {
    // SSE errors happen on server close after exit — benign.
    setButtonsDisabled(container, false);
  };
}

function buildMarkup(): string {
  const targetOptions = TARGETS.map(t =>
    `<option value="${t}">${t}</option>`
  ).join('');

  return `
    <div class="section__header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">Deploy Pipeline</h2>
      <button class="refresh-btn" data-action="refresh-history">Refresh</button>
    </div>

    <div class="deploy-controls" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;padding:12px;border:1px solid var(--border);border-radius:4px;">
      <label style="display:flex;flex-direction:column;font-size:10px;color:var(--text-dim);">
        TARGET
        <select id="deploy-target" style="margin-top:4px;padding:6px 8px;background:var(--bg-elev, #111);color:inherit;border:1px solid var(--border);min-width:140px;">
          ${targetOptions}
        </select>
      </label>
      <button class="refresh-btn" data-action="dry-run">Dry-run preview</button>
      <button class="refresh-btn" data-action="deploy" style="border-color:var(--accent);">Deploy</button>
    </div>

    <h3 style="font-size:11px;font-weight:700;letter-spacing:2px;color:var(--text-heading);margin:0 0 8px;">LOG OUTPUT</h3>
    <pre id="deploy-log" style="background:var(--bg-elev, #0a0a0a);border:1px solid var(--border);padding:10px;font-family:var(--font-mono, monospace);font-size:11px;height:260px;overflow:auto;white-space:pre-wrap;margin:0 0 16px;" aria-live="polite"></pre>

    <h3 style="font-size:11px;font-weight:700;letter-spacing:2px;color:var(--text-heading);margin:0 0 8px;">RECENT DEPLOYS</h3>
    <table class="deploy-history" style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr style="text-align:left;color:var(--text-dim);border-bottom:1px solid var(--border);">
          <th style="padding:6px 8px;">TARGET</th>
          <th style="padding:6px 8px;">STATUS</th>
          <th style="padding:6px 8px;">DURATION</th>
          <th style="padding:6px 8px;">STARTED</th>
          <th style="padding:6px 8px;"></th>
        </tr>
      </thead>
      <tbody id="deploy-history-tbody">
        <tr><td colspan="5" style="color:var(--text-dim);padding:8px;">Loading…</td></tr>
      </tbody>
    </table>
  `;
}

/** Entry point. Returns cleanup function (main.ts registers it in _cleanups). */
export function renderDeployPipeline(container: HTMLElement): () => void {
  container.innerHTML = buildMarkup();

  const logPane = container.querySelector<HTMLElement>('#deploy-log');
  const eventSourceRef: { current: EventSource | null } = { current: null };

  const onClick = (e: Event): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'refresh-history') {
      void loadHistory(container);
      return;
    }
    if (!logPane) return;
    if (action === 'deploy') {
      void runDeploy(container, logPane, selectedTarget(container), false, eventSourceRef);
    } else if (action === 'dry-run') {
      void runDeploy(container, logPane, selectedTarget(container), true, eventSourceRef);
    } else if (action === 'view-log') {
      const id = btn.dataset.id;
      if (!id) return;
      void fetch('/__admin_deploy/history')
        .then(r => r.json() as Promise<DeployRecord[]>)
        .then(list => {
          const match = list.find(r => r.id === id);
          logPane.textContent = match?.logTail ?? '(no log tail stored for this entry)';
        })
        .catch(err => {
          logPane.textContent = `Failed to load: ${err instanceof Error ? err.message : String(err)}`;
        });
    }
  };

  container.addEventListener('click', onClick);
  void loadHistory(container);

  return () => {
    container.removeEventListener('click', onClick);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    container.innerHTML = '';
  };
}
