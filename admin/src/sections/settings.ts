import { escapeHtml } from '../ui/render';
import { loadSettings, saveSettings, type AdminSettings } from '../ui/settingsStore';
import { renderHotkeysPanel } from '../ui/keyboardShortcuts';
import { FONT_PRESETS, applyFontPreset } from '../ui/fontLoader';
import { THEME_PRESETS, applyTheme } from '../ui/themeManager';
import { icon } from '../ui/icons';

export function renderSettings(container: HTMLElement): void {
  const s = loadSettings();

  container.innerHTML = `
    <h2>${icon('settings', 18)} Settings</h2>

    <div style="max-width:560px;">

      ${group('Auto-Refresh', `
        <p class="settings-desc">Sections backed by local data auto-refresh on a timer. Firebase and GitHub API sections always require manual refresh.</p>
        ${toggle('autoRefreshEnabled', 'Enable auto-refresh', s.autoRefreshEnabled)}
        ${select('autoRefreshIntervalMs', 'Refresh interval', s.autoRefreshIntervalMs, [
          { value: 60000, label: '1 minute' },
          { value: 120000, label: '2 minutes' },
          { value: 300000, label: '5 minutes' },
          { value: 600000, label: '10 minutes' },
        ])}
        <p class="settings-hint">Auto-refreshed: Sessions, Tasks, Pipeline, E2E Matrix, Notes, Audits, Links, Notifications</p>
        <p class="settings-hint">Manual only: Live &amp; Health, Users, Matches, Playtime, Bugs, CI, PR Reviews</p>
      `)}

      ${group('Agent', `
        ${select('claudeTimeoutMin', 'Claude process timeout', s.claudeTimeoutMin, [
          { value: 10, label: '10 minutes' },
          { value: 30, label: '30 minutes' },
          { value: 60, label: '60 minutes' },
        ])}
        ${select('maxConcurrentAgents', 'Max concurrent agents', s.maxConcurrentAgents, [
          { value: 1, label: '1' },
          { value: 2, label: '2' },
          { value: 3, label: '3' },
          { value: 5, label: '5' },
        ])}
      `)}

      ${group('Notifications', `
        ${select('toastDurationMs', 'Toast display duration', s.toastDurationMs, [
          { value: 2000, label: '2 seconds' },
          { value: 4000, label: '4 seconds' },
          { value: 8000, label: '8 seconds' },
        ])}
        ${toggle('suppressToastsDuringChat', 'Suppress toasts during Chat sessions', s.suppressToastsDuringChat)}
      `)}

      ${group('Display', `
        ${select('defaultSection', 'Default section on load', s.defaultSection, [
          { value: 'live', label: 'Status' },
          { value: 'sessions', label: 'Sessions' },
          { value: 'tasks', label: 'Tasks' },
          { value: 'pipeline', label: 'Pipeline' },
        ])}
        ${themeSelector(s.theme)}
        ${fontSelector(s.fontFamily)}
      `)}

      <div id="settings-hotkeys" style="margin-bottom:20px;"></div>

      <div id="settings-config-export" style="margin-bottom:20px;"></div>

      <div style="margin-top:24px; padding-top:16px; border-top:1px solid var(--border); display:flex; gap:10px;">
        <button id="settings-reset" class="refresh-btn" style="color:var(--orange); border-color:var(--orange);">Reset to Defaults</button>
        <button id="settings-reset-sidebar" class="refresh-btn">Reset Sidebar Layout</button>
      </div>
    </div>
  `;

  renderHotkeysPanel('settings-hotkeys');
  renderConfigExportImport('settings-config-export');
  wireEvents(container);
}

// ── UI Builders ──────────────────────────────────────────

function group(title: string, body: string): string {
  return `
    <div style="margin-bottom:20px; border:1px solid var(--border); border-radius:4px;">
      <div style="padding:10px 14px; border-bottom:1px solid var(--border); font-weight:700; font-size:13px; color:var(--text-heading);">${escapeHtml(title)}</div>
      <div style="padding:12px 14px;">${body}</div>
    </div>
  `;
}

function toggle(key: string, label: string, checked: boolean): string {
  return `
    <label class="settings-row" style="display:flex; align-items:center; gap:10px; padding:6px 0; cursor:pointer;">
      <input type="checkbox" class="settings-toggle" data-key="${key}" ${checked ? 'checked' : ''}
        style="width:16px; height:16px; accent-color:var(--accent); cursor:pointer;" />
      <span style="font-size:12px;">${escapeHtml(label)}</span>
    </label>
  `;
}

function select(key: string, label: string, current: number | string, options: { value: number | string; label: string }[]): string {
  const optHtml = options.map(o =>
    `<option value="${o.value}" ${String(o.value) === String(current) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
  ).join('');

  return `
    <div class="settings-row" style="display:flex; align-items:center; justify-content:space-between; padding:6px 0;">
      <span style="font-size:12px;">${escapeHtml(label)}</span>
      <select class="settings-select" data-key="${key}" style="background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:3px; padding:4px 8px; font-size:12px; font-family:var(--font-body);">
        ${optHtml}
      </select>
    </div>
  `;
}

function fontSelector(current: string): string {
  const options = FONT_PRESETS.map(p => {
    const selected = p.key === current ? 'selected' : '';
    // Each option previews in its own font via inline style
    return `<option value="${escapeHtml(p.key)}" ${selected} style="font-family:${p.body};">${escapeHtml(p.label)}  —  ${escapeHtml(p.category)}</option>`;
  }).join('');

  return `
    <div class="settings-row" style="display:flex; align-items:center; justify-content:space-between; padding:6px 0;">
      <span style="font-size:12px;">Font</span>
      <select id="settings-font" style="background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:3px; padding:4px 8px; font-size:12px; font-family:var(--font-body); max-width:240px;">
        ${options}
      </select>
    </div>
    <p class="settings-hint">Changes the dashboard body and display fonts. Monospace font is unaffected.</p>
  `;
}

function themeSelector(current: string): string {
  const options = THEME_PRESETS.map((theme) => {
    const selected = theme.key === current ? 'selected' : '';
    return `<option value="${escapeHtml(theme.key)}" ${selected}>${escapeHtml(theme.label)} — ${escapeHtml(theme.description)}</option>`;
  }).join('');

  return `
    <div class="settings-row" style="display:flex; align-items:center; justify-content:space-between; padding:6px 0;">
      <span style="font-size:12px;">Theme</span>
      <select id="settings-theme" style="background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:3px; padding:4px 8px; font-size:12px; font-family:var(--font-body); max-width:300px;">
        ${options}
      </select>
    </div>
    <p class="settings-hint">Includes Luminal, Monokai, and more strictly professional admin themes.</p>
  `;
}

// ── Event Wiring ─────────────────────────────────────────

function wireEvents(container: HTMLElement): void {
  // Toggle changes
  container.querySelectorAll<HTMLInputElement>('.settings-toggle').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.key as keyof AdminSettings;
      saveSettings({ [key]: input.checked } as Partial<AdminSettings>);
      showSaved(input);
    });
  });

  // Select changes
  container.querySelectorAll<HTMLSelectElement>('.settings-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.key as keyof AdminSettings;
      // Auto-detect number vs string values
      const raw = sel.value;
      const num = Number(raw);
      const value = !isNaN(num) && key !== 'defaultSection' ? num : raw;
      saveSettings({ [key]: value } as Partial<AdminSettings>);
      showSaved(sel);
    });
  });

  // Font selector
  container.querySelector('#settings-font')?.addEventListener('change', (e) => {
    const key = (e.target as HTMLSelectElement).value;
    saveSettings({ fontFamily: key });
    void applyFontPreset(key);
    showSaved(e.target as HTMLElement);
  });

  // Theme selector
  container.querySelector('#settings-theme')?.addEventListener('change', (e) => {
    const val = applyTheme((e.target as HTMLSelectElement).value);
    saveSettings({ theme: val });
    showSaved(e.target as HTMLElement);
  });

  // Reset settings
  container.querySelector('#settings-reset')?.addEventListener('click', () => {
    localStorage.removeItem('luminal-admin-settings');
    void applyFontPreset('default');
    applyTheme('graphite');
    renderSettings(container);
  });

  // Reset sidebar layout
  container.querySelector('#settings-reset-sidebar')?.addEventListener('click', () => {
    localStorage.removeItem('luminal-admin-sidebar-order');
    location.reload();
  });
}

// ── Config Export / Import ────────────────────────────

function renderConfigExportImport(containerId: string): void {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = `
    <div style="margin-bottom:20px; border:1px solid var(--border); border-radius:4px;">
      <div style="padding:10px 14px; border-bottom:1px solid var(--border); font-weight:700; font-size:13px; color:var(--text-heading);">Config Export / Import</div>
      <div style="padding:12px 14px;">
        <p class="settings-desc">Export or import all dashboard settings, sidebar order, collapsed groups, and preferences.</p>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button id="config-export-btn" class="admin-btn admin-btn--small">Export Config</button>
          <button id="config-import-btn" class="admin-btn admin-btn--small">Import Config</button>
        </div>
        <input type="file" id="config-import-file" accept=".json" style="display:none;" />
      </div>
    </div>
  `;

  el.querySelector('#config-export-btn')?.addEventListener('click', () => {
    const config: Record<string, string | null> = {};
    const keys = ['luminal-admin-sidebar-order', 'luminal-admin-favorites', 'luminal-admin-collapsed-groups',
      'luminal-admin-db-env', 'luminal-admin-game-env', 'luminal-admin-sidebar-width',
      'luminal-admin-theme', 'luminal-admin-settings', 'luminal-admin-active-agents'];
    for (const k of keys) config[k] = localStorage.getItem(k);
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'luminal-admin-config.json'; a.click();
    URL.revokeObjectURL(url);
  });

  el.querySelector('#config-import-btn')?.addEventListener('click', () => {
    (el.querySelector('#config-import-file') as HTMLInputElement)?.click();
  });

  el.querySelector('#config-import-file')?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const config = JSON.parse(text) as Record<string, string | null>;
    for (const [k, v] of Object.entries(config)) {
      if (v != null) localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    }
    alert('Config imported! Reloading...');
    location.reload();
  });
}

/** Flash a brief "saved" indicator next to the control. */
function showSaved(el: HTMLElement): void {
  const existing = el.parentElement?.querySelector('.settings-saved');
  if (existing) existing.remove();
  const badge = document.createElement('span');
  badge.className = 'settings-saved';
  badge.textContent = 'saved';
  badge.style.cssText = 'color:var(--green); font-size:10px; margin-left:8px; transition:opacity 0.3s;';
  el.parentElement?.appendChild(badge);
  setTimeout(() => { badge.style.opacity = '0'; }, 1200);
  setTimeout(() => badge.remove(), 1600);
}
