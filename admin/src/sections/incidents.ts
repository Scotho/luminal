// admin/src/sections/incidents.ts — Incident timeline
import { escapeHtml } from '../ui/render';
import { icon } from '../ui/icons';

interface Incident {
  id: string;
  ts: number;
  type: 'outage' | 'deploy' | 'config-change' | 'hotfix' | 'rollback';
  title: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  resolved: boolean;
  resolvedAt?: number;
  source?: 'manual' | 'overseer';
}

const TYPE_ICONS: Record<string, string> = {
  outage: '🔴',
  deploy: '🚀',
  'config-change': '⚙️',
  hotfix: '🩹',
  rollback: '⏪',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--red-bright)',
  major: 'var(--orange)',
  minor: 'var(--yellow)',
};

export async function renderIncidents(container: HTMLElement): Promise<void> {
  let incidents: Incident[] = [];
  try {
    const res = await fetch('/data/incidents.json');
    if (res.ok) incidents = await res.json();
  } catch (err) {
    console.warn('[incidents] Failed to load incidents.json:', err);
  }

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">${icon('activity', 18)} Incident Timeline</h2>
      <button id="incident-add-btn" class="admin-btn admin-btn--small">+ Log Incident</button>
    </div>
    <div id="incident-timeline" style="position:relative;padding-left:24px;border-left:2px solid var(--border);">
      ${incidents.length > 0 ? incidents.sort((a, b) => b.ts - a.ts).map(renderIncidentCard).join('') : '<p style="color:var(--text-dim);">No incidents logged. Click + to add one.</p>'}
    </div>
  `;

  container.querySelector('#incident-add-btn')?.addEventListener('click', async () => {
    const title = window.prompt('Incident title:');
    if (!title?.trim()) return;
    const type = window.prompt('Type (outage/deploy/config-change/hotfix/rollback):') ?? 'outage';
    const severity = window.prompt('Severity (critical/major/minor):') ?? 'minor';
    const description = window.prompt('Description:') ?? '';

    const newIncident: Incident = {
      id: `inc_${Date.now()}`,
      ts: Date.now(),
      type: type as Incident['type'],
      title: title.trim(),
      description,
      severity: severity as Incident['severity'],
      resolved: false,
    };

    incidents.push(newIncident);
    await fetch('/__admin_save?file=incidents.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(incidents, null, 2),
    });
    renderIncidents(container);
  });

  // Wire resolve buttons
  container.querySelectorAll<HTMLElement>('.incident-resolve').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const inc = incidents.find(i => i.id === id);
      if (inc) {
        inc.resolved = true;
        inc.resolvedAt = Date.now();
        await fetch('/__admin_save?file=incidents.json', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(incidents, null, 2),
        });
        renderIncidents(container);
      }
    });
  });
}

function renderIncidentCard(inc: Incident): string {
  const typeIcon = TYPE_ICONS[inc.type] ?? '📋';
  const color = SEVERITY_COLORS[inc.severity] ?? 'var(--text-dim)';
  const date = new Date(inc.ts);
  const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const resolvedBadge = inc.resolved
    ? `<span style="color:var(--green);font-size:9px;font-family:var(--font-display);letter-spacing:1px;">RESOLVED</span>`
    : `<button class="admin-btn admin-btn--small incident-resolve" data-id="${inc.id}" style="font-size:8px;padding:2px 8px;">Resolve</button>`;
  const sourceBadge = inc.source === 'overseer'
    ? '<span style="font-size:8px;background:var(--accent-dim);color:var(--accent);padding:1px 5px;border-radius:2px;font-family:var(--font-display);letter-spacing:1px;">OVERSEER</span>'
    : '';

  return `
    <div style="margin-bottom:16px;position:relative;">
      <div style="position:absolute;left:-31px;top:4px;width:12px;height:12px;border-radius:50%;background:${color};border:2px solid var(--bg-panel);"></div>
      <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;padding:10px 14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span>${typeIcon}</span>
          ${sourceBadge}
          <span style="font-size:13px;font-weight:700;">${escapeHtml(inc.title)}</span>
          <span style="color:${color};font-size:9px;font-family:var(--font-display);font-weight:700;letter-spacing:1px;text-transform:uppercase;">${inc.severity}</span>
          <span style="margin-left:auto;">${resolvedBadge}</span>
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">${escapeHtml(inc.description)}</div>
        <div style="font-size:10px;color:var(--text-quiet);">${dateStr}</div>
      </div>
    </div>
  `;
}
