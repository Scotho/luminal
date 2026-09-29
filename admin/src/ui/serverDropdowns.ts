// admin/src/ui/serverDropdowns.ts — Emulators + Dev Server control dropdowns

import { icon } from './icons';
import { closeAllDropdowns, registerDropdownCloser } from '../envSwitcher';

// ── Types ──────────────────────────────────────────────────

interface ServiceInfo {
  name: string;
  port: number;
  group: string;
  up: boolean;
}

// ── Shared state ───────────────────────────────────────────

let _services: ServiceInfo[] = [];
const _renderCallbacks: Array<() => void> = [];
let _pollTimer: ReturnType<typeof setInterval> | null = null;

async function fetchServices(): Promise<void> {
  try {
    const res = await fetch('/__admin_exec/services');
    if (res.ok) {
      const data = await res.json() as { services: ServiceInfo[] };
      _services = data.services;
      for (const cb of _renderCallbacks) cb();
    }
  } catch { /* admin middleware not ready yet */ }
}

function startPolling(): void {
  if (_pollTimer) return;
  fetchServices();
  _pollTimer = setInterval(fetchServices, 10_000);
}

// ── Service actions ────────────────────────────────────────

async function serviceAction(action: 'start' | 'stop', service: string): Promise<void> {
  try {
    await fetch(`/__admin_exec/service/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service }),
    });
  } catch { /* caught by next poll */ }
  // Quick polls to catch the status change
  setTimeout(fetchServices, 2000);
  setTimeout(fetchServices, 5000);
  setTimeout(fetchServices, 10_000);
}

async function rebuildDist(): Promise<void> {
  try {
    await fetch('/__admin_exec/service/rebuild', { method: 'POST' });
  } catch { /* non-fatal */ }
}

// ── Helpers ────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  auth: 'Auth',
  rtdb: 'RTDB',
  firestore: 'Firestore',
  vite: 'Vite HMR',
  preview: 'Preview',
  'admin-cold': 'Admin (cold)',
};

const SERVICE_URLS: Record<string, string> = {
  vite: 'http://localhost:5173',
  preview: 'http://localhost:5174',
  'admin-cold': 'http://localhost:5176',
};

function groupServices(group: string): ServiceInfo[] {
  return _services.filter(s => s.group === group);
}

function groupColor(group: string): string {
  const svcs = groupServices(group);
  if (svcs.length === 0) return '#666';
  const upCount = svcs.filter(s => s.up).length;
  if (upCount === svcs.length) return '#22c55e';
  if (upCount > 0) return '#f59e0b';
  return '#ef4444';
}

// ── Row / button rendering ─────────────────────────────────

const BTN = 'font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:3px;cursor:pointer;font-family:inherit;transition:all 0.15s;line-height:1.2;';

function actionBtn(
  action: string,
  service: string,
  label: string,
  color: string,
  bg: string,
  bgHover: string,
): string {
  return `<button class="svc-action" data-action="${action}" data-service="${service}" style="${BTN}background:${bg};color:${color};" onmouseover="this.style.background='${bgHover}'" onmouseout="this.style.background='${bg}'">${label}</button>`;
}

function serviceRow(s: ServiceInfo, inlineAction: boolean): string {
  const dotColor = s.up ? 'var(--green)' : 'var(--red-bright,#d45234)';
  const url = SERVICE_URLS[s.name];
  const label = LABELS[s.name] ?? s.name;
  const nameHtml = s.up && url
    ? `<a href="${url}" target="_blank" rel="noopener" style="flex:1;font-size:11px;color:var(--accent);text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${label}</a>`
    : `<span style="flex:1;font-size:11px;color:var(--text);">${label}</span>`;
  let btn = '';
  if (inlineAction) {
    btn = s.up
      ? actionBtn('stop', s.name, 'Stop', 'var(--red-bright,#d45234)', 'rgba(239,68,68,0.08)', 'rgba(239,68,68,0.18)')
      : actionBtn('start', s.name, 'Start', 'var(--green)', 'rgba(34,197,94,0.08)', 'rgba(34,197,94,0.18)');
  }
  return `
    <div style="display:flex;align-items:center;gap:6px;padding:5px 10px;">
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dotColor};box-shadow:0 0 3px ${dotColor};flex-shrink:0;"></span>
      ${nameHtml}
      <span style="font-size:10px;color:var(--text-quiet);font-family:var(--font-mono);">:${s.port}</span>
      ${btn}
    </div>`;
}

// ── Dropdown content builders ──────────────────────────────

function emulatorsContent(): string {
  const svcs = groupServices('emulators');
  const allUp = svcs.length > 0 && svcs.every(s => s.up);
  const noneUp = svcs.every(s => !s.up);

  const startLabel = allUp ? 'Restart' : 'Start';
  const startColor = allUp ? 'var(--yellow)' : 'var(--green)';
  const startBg = allUp ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)';
  const startHover = allUp ? 'rgba(245,158,11,0.18)' : 'rgba(34,197,94,0.18)';

  return `
    <div style="position:absolute;top:100%;left:0;margin-top:4px;background:var(--bg-card,#1a1a2e);border:1px solid var(--border,#333);border-radius:4px;min-width:210px;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.4);overflow:hidden;">
      <div style="padding:6px 10px;font-size:9px;color:var(--text-quiet);font-weight:700;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid var(--border);">Firebase Emulators</div>
      ${svcs.map(s => serviceRow(s, false)).join('')}
      <div style="display:flex;gap:6px;padding:7px 10px;border-top:1px solid var(--border);">
        ${actionBtn('start', 'emulators', startLabel, startColor, startBg, startHover)}
        ${!noneUp ? actionBtn('stop', 'emulators', 'Stop', 'var(--red-bright,#d45234)', 'rgba(239,68,68,0.08)', 'rgba(239,68,68,0.18)') : ''}
      </div>
    </div>`;
}

function devContent(): string {
  const svcs = groupServices('dev');
  const previewUp = svcs.find(s => s.name === 'preview')?.up;

  return `
    <div style="position:absolute;top:100%;left:0;margin-top:4px;background:var(--bg-card,#1a1a2e);border:1px solid var(--border,#333);border-radius:4px;min-width:230px;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.4);overflow:hidden;">
      <div style="padding:6px 10px;font-size:9px;color:var(--text-quiet);font-weight:700;letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid var(--border);">Dev Servers</div>
      ${svcs.map(s => serviceRow(s, true)).join('')}
      ${previewUp ? `<div style="padding:7px 10px;border-top:1px solid var(--border);">${actionBtn('rebuild', 'preview', 'Rebuild dist', 'var(--accent)', 'rgba(110,224,240,0.08)', 'rgba(110,224,240,0.18)')}</div>` : ''}
    </div>`;
}

// ── Dropdown factory ───────────────────────────────────────

function createDropdown(
  container: HTMLElement,
  group: string,
  iconName: string,
  label: string,
  title: string,
  renderContent: () => string,
): () => void {
  let open = false;
  const btnId = `svc-${group}-btn`;

  function close(): void {
    if (open) { open = false; render(); }
  }

  function render(): void {
    const color = groupColor(group);
    container.innerHTML = `
      <button id="${btnId}" class="env-split-btn" title="${title}">
        ${icon(iconName, 14)}
        <span class="env-split-label" style="color:${color};">${label}</span>
        <span class="env-split-caret">\u25BE</span>
      </button>
      ${open ? renderContent() : ''}`;
  }

  function handleClick(e: MouseEvent): void {
    e.stopPropagation();
    const target = e.target as HTMLElement;

    // Action buttons
    const btn = target.closest('.svc-action') as HTMLElement | null;
    if (btn) {
      const action = btn.dataset.action!;
      const svc = btn.dataset.service!;
      btn.style.opacity = '0.5';
      btn.style.pointerEvents = 'none';
      if (action === 'rebuild') {
        rebuildDist();
      } else {
        serviceAction(action as 'start' | 'stop', svc);
      }
      return;
    }

    // Toggle
    if (target.closest(`#${btnId}`)) {
      const wasOpen = open;
      closeAllDropdowns();
      if (!wasOpen) {
        open = true;
        registerDropdownCloser(close);
      }
      render();
    }
  }

  function handleDocClick(e: MouseEvent): void {
    if (!open) return;
    if (!container.contains(e.target as HTMLElement)) {
      open = false;
      render();
    }
  }

  container.addEventListener('click', handleClick);
  document.addEventListener('click', handleDocClick);
  _renderCallbacks.push(render);
  render();

  return () => {
    container.removeEventListener('click', handleClick);
    document.removeEventListener('click', handleDocClick);
    const idx = _renderCallbacks.indexOf(render);
    if (idx >= 0) _renderCallbacks.splice(idx, 1);
  };
}

// ── Public API ─────────────────────────────────────────────

export function renderEmulatorsDropdown(container: HTMLElement): () => void {
  startPolling();
  return createDropdown(container, 'emulators', 'zap', 'EMU', 'Firebase Emulators', emulatorsContent);
}

export function renderDevServersDropdown(container: HTMLElement): () => void {
  startPolling();
  return createDropdown(container, 'dev', 'monitor', 'DEV', 'Dev Servers', devContent);
}
