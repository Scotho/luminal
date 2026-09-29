import { escapeHtml, statCard } from '../ui/render';
import { confirmAction } from '../ui/confirm';
import { setLocalPoolStatus } from '../ui/agentPools';
import { renderAgentManager } from '../ui/agentManager';
import { loadUsageRecords, aggregateUsage, estimateCost, usageInWindow, estimateUsagePct, formatDuration, resetUsageRecords } from '../ui/ccUsage';
import { icon } from '../ui/icons';
import type { OllamaConfig, OllamaStatus, OllamaModel, OllamaLoadedModel, OllamaRole, OllamaPreset } from '../ollamaTypes';

// ── Module-level state ────────────────────────────────────────────────────────

let _container: HTMLElement | null = null;
let _pullingModel: string | null = null;

const TOTAL_VRAM = 12 * 1024 * 1024 * 1024; // 12 GB RTX 4070 Super

// ── Utility helpers ───────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function roleBadge(role: OllamaRole): string {
  if (role === 'none' || !role) return '';
  const colors: Record<Exclude<OllamaRole, 'none'>, string> = {
    primary:     'var(--accent)',
    fast:        'var(--green)',
    specialized: 'var(--purple)',
  };
  const color = colors[role as Exclude<OllamaRole, 'none'>] ?? 'var(--text-dim)';
  return `<span style="display:inline-block; font-size:9px; font-weight:700; letter-spacing:1px; text-transform:uppercase; padding:2px 6px; border-radius:2px; border:1px solid ${color}; color:${color}; background:${color}1a; font-family:var(--font-display);">${escapeHtml(role)}</span>`;
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderServerControl(status: OllamaStatus): string {
  const dotColor = status.running ? 'var(--green)' : 'var(--red)';
  const statusText = status.running ? 'Running' : 'Stopped';
  const versionText = status.version ? `v${escapeHtml(status.version)}` : '—';
  const btnLabel = status.running ? 'Stop' : 'Start';
  const btnClass = status.running ? 'admin-btn admin-btn--danger admin-btn--small' : 'admin-btn admin-btn--small';
  const btnId = status.running ? 'ollama-stop-btn' : 'ollama-start-btn';

  return `
    <div style="background:var(--bg-panel-alt); border:1px solid var(--border); border-radius:6px; padding:16px 20px; display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${dotColor}; box-shadow:0 0 6px ${dotColor};"></span>
        <span style="font-size:15px; font-weight:600;">${statusText}</span>
        <span style="font-size:12px; color:var(--text-dim); font-family:var(--font-mono);">${versionText}</span>
      </div>
      <button id="${btnId}" class="${btnClass}">${btnLabel}</button>
    </div>
  `;
}

function renderPresets(config: OllamaConfig, installedNames: Set<string>, pullingName: string | null): string {
  if (!config.presets || config.presets.length === 0) return '';

  const cards = config.presets.map((preset: OllamaPreset) => {
    const installed = installedNames.has(preset.name);
    const isPulling = pullingName === preset.name;

    let actionHtml: string;
    if (isPulling) {
      actionHtml = `
        <div style="margin-top:10px;">
          <div class="pull-bar-wrap" style="background:var(--border); border-radius:2px; height:6px; overflow:hidden; margin-bottom:4px;">
            <div class="pull-bar" data-model="${escapeHtml(preset.name)}" style="height:100%; width:0%; background:var(--accent); transition:width 0.2s ease;"></div>
          </div>
          <span class="pull-status" data-model="${escapeHtml(preset.name)}" style="font-size:11px; color:var(--text-dim);">Pulling...</span>
        </div>
      `;
    } else if (installed) {
      actionHtml = `
        <div style="margin-top:10px; display:flex; align-items:center; gap:6px;">
          <span style="color:var(--green); font-size:14px;">&#10003;</span>
          <span style="font-size:12px; color:var(--green);">Installed</span>
        </div>
      `;
    } else {
      actionHtml = `
        <button class="admin-btn admin-btn--small ollama-pull-btn" data-model="${escapeHtml(preset.name)}" style="margin-top:10px;">Pull</button>
      `;
    }

    return `
      <div style="background:var(--bg-panel-alt); border:1px solid var(--border); border-radius:6px; padding:14px 16px; flex:1; min-width:200px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
          <span style="font-size:13px; font-weight:600;">${escapeHtml(preset.label)}</span>
          ${roleBadge(preset.role)}
        </div>
        <p style="font-size:12px; color:var(--text-dim); margin:0 0 2px 0; line-height:1.4;">${escapeHtml(preset.description)}</p>
        <div style="font-size:10px; color:var(--text-quiet); font-family:var(--font-mono);">${escapeHtml(preset.name)}</div>
        ${actionHtml}
      </div>
    `;
  }).join('');

  return `
    <div style="margin-bottom:20px;">
      <h4>Recommended Presets</h4>
      <div style="display:flex; flex-wrap:wrap; gap:12px;">
        ${cards}
      </div>
    </div>
  `;
}

function renderModelGrid(models: OllamaModel[], loaded: OllamaLoadedModel[], config: OllamaConfig): string {
  if (models.length === 0) {
    return '<p style="color:var(--text-dim); font-size:13px;">No models installed. Pull a preset or use <code>ollama pull</code>.</p>';
  }

  const loadedMap = new Map<string, OllamaLoadedModel>(loaded.map(m => [m.name, m]));

  const cards = models.map((model: OllamaModel) => {
    const loadedInfo = loadedMap.get(model.name);
    const isLoaded = !!loadedInfo;
    const dotColor = isLoaded ? 'var(--green)' : 'var(--text-quiet, #555)';
    const dotTitle = isLoaded ? 'Loaded in VRAM' : 'Not loaded';
    const vramText = isLoaded && loadedInfo ? formatBytes(loadedInfo.size_vram) : '—';
    const paramSize = isLoaded && loadedInfo ? escapeHtml(loadedInfo.details.parameter_size) : '—';
    const quantLevel = isLoaded && loadedInfo ? escapeHtml(loadedInfo.details.quantization_level) : '—';

    const currentRole: OllamaRole = (config.roles?.[model.name] as OllamaRole) ?? 'none';
    const roleOptions: OllamaRole[] = ['none', 'primary', 'fast', 'specialized'];

    const roleSelect = `
      <select class="ollama-role-select" data-model="${escapeHtml(model.name)}" style="font-size:11px; background:var(--bg-panel); border:1px solid var(--border); color:var(--text-dim); border-radius:3px; padding:2px 4px; cursor:pointer;">
        ${roleOptions.map(r => `<option value="${r}"${r === currentRole ? ' selected' : ''}>${r === 'none' ? 'No role' : r}</option>`).join('')}
      </select>
    `;

    const loadBtnId = `ollama-load-${model.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const loadBtnLabel = isLoaded ? 'Unload' : 'Load';
    const loadBtnClass = isLoaded ? 'admin-btn admin-btn--small admin-btn--danger ollama-unload-btn' : 'admin-btn admin-btn--small ollama-load-btn';
    const loadBtnData = `data-model="${escapeHtml(model.name)}"`;

    const infoBtnId = `ollama-info-${model.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const deleteBtnId = `ollama-delete-${model.name.replace(/[^a-zA-Z0-9]/g, '_')}`;

    return `
      <div style="background:var(--bg-panel-alt); border:1px solid var(--border); border-radius:6px; padding:14px 16px;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:8px; min-width:0;">
            <span title="${dotTitle}" style="flex-shrink:0; display:inline-block; width:8px; height:8px; border-radius:50%; background:${dotColor};${isLoaded ? ` box-shadow:0 0 5px ${dotColor};` : ''}"></span>
            <span style="font-size:13px; font-weight:600; font-family:var(--font-mono); word-break:break-all;">${escapeHtml(model.name)}</span>
          </div>
          ${isLoaded ? roleBadge(currentRole) : ''}
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-bottom:10px; font-size:11px;">
          <div style="color:var(--text-dim);">Disk: <span style="color:var(--text);">${formatBytes(model.size)}</span></div>
          <div style="color:var(--text-dim);">VRAM: <span style="color:${isLoaded ? 'var(--green)' : 'var(--text)'}">${vramText}</span></div>
          <div style="color:var(--text-dim);">Params: <span style="color:var(--text);">${paramSize}</span></div>
          <div style="color:var(--text-dim);">Quant: <span style="color:var(--text);">${quantLevel}</span></div>
        </div>

        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          ${roleSelect}
          <button id="${loadBtnId}" class="${loadBtnClass}" ${loadBtnData}>${loadBtnLabel}</button>
          <button id="${infoBtnId}" class="admin-btn admin-btn--small ollama-info-btn" data-model="${escapeHtml(model.name)}">Info</button>
          <button id="${deleteBtnId}" class="admin-btn admin-btn--small admin-btn--danger ollama-delete-btn" data-model="${escapeHtml(model.name)}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
      ${cards}
    </div>
  `;
}

// ── Info Modal ────────────────────────────────────────────────────────────────

function showInfoModal(name: string, data: Record<string, unknown>): void {
  document.getElementById('ollama-info-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'ollama-info-modal';
  modal.style.cssText = 'position:fixed; inset:0; z-index:200; display:flex; align-items:center; justify-content:center; background:rgba(2,3,5,0.8);';

  const json = JSON.stringify(data, null, 2);

  modal.innerHTML = `
    <div style="background:var(--bg); border:1px solid var(--border); border-radius:6px; width:80vw; max-width:860px; max-height:80vh; display:flex; flex-direction:column;">
      <div style="padding:12px 16px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
        <span style="font-family:var(--font-display); font-size:10px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:var(--text-heading);">Model Info — ${escapeHtml(name)}</span>
        <button id="ollama-info-close" style="background:none; border:1px solid var(--border); border-radius:2px; color:var(--text-dim); cursor:pointer; font-size:16px; width:28px; height:28px; display:flex; align-items:center; justify-content:center;">&times;</button>
      </div>
      <pre style="flex:1; overflow:auto; padding:12px 16px; margin:0; font-family:var(--font-mono); font-size:11px; line-height:1.6; white-space:pre-wrap; word-break:break-all;">${escapeHtml(json)}</pre>
    </div>
  `;

  document.body.appendChild(modal);

  const close = (): void => { modal.remove(); };
  modal.querySelector('#ollama-info-close')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', function handler(e: KeyboardEvent) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', handler); }
  });
}

// ── SSE Pull ──────────────────────────────────────────────────────────────────

async function pullModel(name: string): Promise<void> {
  _pullingModel = name;

  // Re-render to show progress bar
  if (_container) await renderOllama(_container);

  const barEl = _container?.querySelector<HTMLElement>(`.pull-bar[data-model="${CSS.escape(name)}"]`);
  const statusEl = _container?.querySelector<HTMLElement>(`.pull-status[data-model="${CSS.escape(name)}"]`);

  try {
    const res = await fetch('/__admin_ollama/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Pull failed: ${res.status} ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let currentEvent = '';
      let currentData = '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice('event:'.length).trim();
        } else if (line.startsWith('data:')) {
          currentData = line.slice('data:'.length).trim();
        } else if (line === '') {
          // Dispatch the event
          if (currentEvent === 'progress' && currentData) {
            try {
              const payload = JSON.parse(currentData) as { status?: string; completed?: number; total?: number };
              if (statusEl && payload.status) {
                statusEl.textContent = payload.status;
              }
              if (barEl && payload.total && payload.completed !== undefined) {
                const pct = Math.round((payload.completed / payload.total) * 100);
                barEl.style.width = `${pct}%`;
              }
            } catch {
              // ignore parse errors
            }
          } else if (currentEvent === 'done') {
            if (barEl) barEl.style.width = '100%';
            if (statusEl) statusEl.textContent = 'Done';
          }
          currentEvent = '';
          currentData = '';
        }
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `Error: ${(err as Error).message}`;
      statusEl.style.color = 'var(--red)';
    }
  } finally {
    _pullingModel = null;
    if (_container) await renderOllama(_container);
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents(container: HTMLElement): void {
  // Start button
  const startBtn = container.querySelector<HTMLButtonElement>('#ollama-start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      startBtn.disabled = true;
      startBtn.textContent = 'Starting...';
      try {
        const res = await fetch('/__admin_ollama/start', { method: 'POST' });
        const data = await res.json() as { ok: boolean; error?: string };
        if (!data.ok) throw new Error(data.error ?? 'Start failed');
        await renderOllama(container);
      } catch (err) {
        startBtn.disabled = false;
        startBtn.textContent = 'Start';
        startBtn.title = (err as Error).message;
      }
    });
  }

  // Stop button — uses confirmAction pattern
  const stopBtn = container.querySelector<HTMLButtonElement>('#ollama-stop-btn');
  if (stopBtn) {
    confirmAction(stopBtn, 'Stop', async () => {
      const res = await fetch('/__admin_ollama/stop', { method: 'POST' });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Stop failed');
      await renderOllama(container);
    });
  }

  // Pull buttons
  container.querySelectorAll<HTMLButtonElement>('.ollama-pull-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.model ?? '';
      if (!name || _pullingModel) return;
      void pullModel(name);
    });
  });

  // Load buttons
  container.querySelectorAll<HTMLButtonElement>('.ollama-load-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.model ?? '';
      if (!name) return;
      btn.disabled = true;
      btn.textContent = 'Loading...';
      try {
        const res = await fetch('/__admin_ollama/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const data = await res.json() as { ok: boolean; error?: string };
        if (!data.ok) throw new Error(data.error ?? 'Load failed');
        await renderOllama(container);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Load';
        btn.title = (err as Error).message;
      }
    });
  });

  // Unload buttons
  container.querySelectorAll<HTMLButtonElement>('.ollama-unload-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.model ?? '';
      if (!name) return;
      btn.disabled = true;
      btn.textContent = 'Unloading...';
      try {
        const res = await fetch('/__admin_ollama/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, unload: true }),
        });
        const data = await res.json() as { ok: boolean; error?: string };
        if (!data.ok) throw new Error(data.error ?? 'Unload failed');
        await renderOllama(container);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Unload';
        btn.title = (err as Error).message;
      }
    });
  });

  // Info buttons
  container.querySelectorAll<HTMLButtonElement>('.ollama-info-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.model ?? '';
      if (!name) return;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const res = await fetch('/__admin_ollama/show', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const data = await res.json() as Record<string, unknown>;
        showInfoModal(name, data);
      } catch (err) {
        btn.title = (err as Error).message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Info';
      }
    });
  });

  // Delete buttons — confirmAction double-click pattern
  container.querySelectorAll<HTMLButtonElement>('.ollama-delete-btn').forEach(btn => {
    confirmAction(btn, 'Delete', async () => {
      const name = btn.dataset.model ?? '';
      if (!name) throw new Error('No model name');
      const res = await fetch('/__admin_ollama/model', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'Delete failed');
      await renderOllama(container);
    });
  });

  // Role dropdowns
  container.querySelectorAll<HTMLSelectElement>('.ollama-role-select').forEach(select => {
    select.addEventListener('change', async () => {
      const name = select.dataset.model ?? '';
      const role = select.value as OllamaRole;
      if (!name) return;

      const originalValue = select.getAttribute('data-previous') ?? select.value;
      select.setAttribute('data-previous', role);

      try {
        // Build updated roles map — fetch current config first
        const statusRes = await fetch('/__admin_ollama/status');
        const statusData = await statusRes.json() as { running: boolean; version: string | null; loaded: OllamaLoadedModel[]; config: OllamaConfig };
        const currentRoles = { ...(statusData.config?.roles ?? {}) };

        if (role === 'none') {
          delete currentRoles[name];
        } else {
          currentRoles[name] = role;
        }

        const res = await fetch('/__admin_ollama/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roles: currentRoles }),
        });
        const data = await res.json() as { ok: boolean; error?: string };
        if (!data.ok) throw new Error(data.error ?? 'Config update failed');
      } catch (err) {
        // Revert
        select.value = originalValue;
        select.title = (err as Error).message;
      }
    });
    // Store initial value for revert on error
    select.setAttribute('data-previous', select.value);
  });

  // Refresh button
  container.querySelector('#ollama-refresh-btn')?.addEventListener('click', () => {
    void renderOllama(container);
  });
}

// ── Claude section ────────────────────────────────────────────────────────────

async function renderClaudeSection(): Promise<string> {
  const records = await loadUsageRecords();
  const agg = aggregateUsage(records);
  const cost = estimateCost(records);
  const total = agg.totalInput + agg.totalOutput;
  const w5h = usageInWindow(records, 5 * 3_600_000);
  const pct5h = estimateUsagePct(w5h.activeTimeMs, 5);
  const w7d = usageInWindow(records, 7 * 24 * 3_600_000);

  return `
    <h3 class="agents-section-header">${icon('claude', 14)} CLAUDE</h3>
    <div class="stat-grid" style="margin-bottom:12px;">
      ${statCard((total / 1000).toFixed(1) + 'K', 'Total Tokens')}
      ${statCard(agg.totalSessions.toString(), 'Sessions')}
      ${statCard('$' + cost.toFixed(2), 'Est. Cost')}
      ${statCard(formatDuration(agg.totalDurationMs), 'Active Time')}
    </div>
    <div class="stat-grid" style="margin-bottom:12px;">
      ${statCard((100 - pct5h) + '%', '5h Remaining')}
      ${statCard(w5h.sessions.toString(), '5h Sessions')}
      ${statCard(formatDuration(w7d.activeTimeMs), '7d Active')}
      ${statCard(w7d.sessions.toString(), '7d Sessions')}
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <button id="claude-reset-usage" class="admin-btn admin-btn--small admin-btn--danger">Reset Usage Data</button>
      <button id="claude-export-usage" class="admin-btn admin-btn--small">Export Usage JSON</button>
    </div>
  `;
}

// ── Section entry point ───────────────────────────────────────────────────────

export async function renderOllama(container: HTMLElement): Promise<void> {
  _container = container;

  container.innerHTML = `
    <h2>Agents <button id="ollama-refresh-btn" class="refresh-btn" style="margin-left:auto;">Refresh</button></h2>
    <p style="color:var(--text-dim);">Loading...</p>
  `;

  // Fetch status (includes config)
  let status: OllamaStatus;
  let config: OllamaConfig;
  let models: OllamaModel[];

  try {
    const statusRes = await fetch('/__admin_ollama/status');
    if (!statusRes.ok) throw new Error(`Status fetch failed: ${statusRes.status}`);
    const statusData = await statusRes.json() as { running: boolean; version: string | null; loaded: OllamaLoadedModel[]; config: OllamaConfig };
    status = { running: statusData.running, version: statusData.version, loaded: statusData.loaded ?? [] };
    config = statusData.config ?? { roles: {}, defaultModel: null, presets: [], serverAutoStart: false };
    // Sync pool status
    const primaryModel = config.defaultModel ?? status.loaded[0]?.name;
    setLocalPoolStatus(status.running && status.loaded.length > 0, primaryModel ?? undefined);
  } catch (err) {
    container.innerHTML = `
      <h2>Agents <button id="ollama-refresh-btn" class="refresh-btn" style="margin-left:auto;">Refresh</button></h2>
      <p style="color:var(--red);">Failed to load Ollama status: ${escapeHtml((err as Error).message)}</p>
    `;
    container.querySelector('#ollama-refresh-btn')?.addEventListener('click', () => {
      void renderOllama(container);
    });
    return;
  }

  try {
    const modelsRes = await fetch('/__admin_ollama/models');
    if (!modelsRes.ok) throw new Error(`Models fetch failed: ${modelsRes.status}`);
    const modelsData = await modelsRes.json() as { models: OllamaModel[] };
    models = modelsData.models ?? [];
  } catch {
    models = [];
  }

  // Compute stat values
  const installedNames = new Set(models.map(m => m.name));
  const loadedCount = status.loaded.length;
  const totalVramUsed = status.loaded.reduce((sum, m) => sum + (m.size_vram ?? 0), 0);
  const vramPercent = TOTAL_VRAM > 0 ? Math.round((totalVramUsed / TOTAL_VRAM) * 100) : 0;
  const vramDisplay = totalVramUsed > 0 ? `${formatBytes(totalVramUsed)} (${vramPercent}%)` : '0 B';
  const versionDisplay = status.version ?? '—';

  // Server control + stat row + presets + model grid
  const serverControlHtml = renderServerControl(status);
  const presetsHtml = renderPresets(config, installedNames, _pullingModel);
  const modelGridHtml = renderModelGrid(models, status.loaded, config);

  // Build the Claude section HTML
  const claudeHtml = await renderClaudeSection();

  container.innerHTML = `
    <h2 style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
      Agents
      <button id="ollama-refresh-btn" class="refresh-btn">Refresh</button>
    </h2>

    <!-- ── Agent Manager ──────────────────────────────── -->
    <div class="agents-panel">
      <h3 class="agents-section-header">${icon('users', 14)} AGENT MANAGER</h3>
      <div id="agent-manager-mount"></div>
    </div>

    <!-- ── Claude ─────────────────────────────────────── -->
    <div class="agents-panel">
      ${claudeHtml}
    </div>

    <!-- ── Ollama ─────────────────────────────────────── -->
    <div class="agents-panel">
      <h3 class="agents-section-header">${icon('server', 14)} OLLAMA</h3>

      ${serverControlHtml}

      <div class="stat-grid" style="margin-bottom:16px;">
        ${statCard(models.length.toString(), 'Installed')}
        ${statCard(loadedCount.toString(), 'Loaded')}
        ${statCard(vramDisplay, 'VRAM Used')}
        ${statCard(versionDisplay, 'Version')}
      </div>

      ${presetsHtml}

      <h4>Installed Models</h4>
      ${modelGridHtml}
    </div>
  `;

  // Mount Agent Manager (needs DOM to be ready)
  const agentMgrMount = container.querySelector('#agent-manager-mount') as HTMLElement;
  if (agentMgrMount) renderAgentManager(agentMgrMount);

  // Wire Claude section buttons
  const resetBtn = container.querySelector('#claude-reset-usage') as HTMLButtonElement;
  if (resetBtn) {
    confirmAction(resetBtn, 'Reset', async () => {
      await resetUsageRecords();
      await renderOllama(container);
    });
  }

  container.querySelector('#claude-export-usage')?.addEventListener('click', async () => {
    const records = await loadUsageRecords();
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'claude-usage.json'; a.click();
    URL.revokeObjectURL(url);
  });

  wireEvents(container);
}
