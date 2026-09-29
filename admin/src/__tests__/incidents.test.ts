// ── Incidents section tests ────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockFetch } from './helpers';

vi.mock('../ui/render', () => ({
  escapeHtml: (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
}));

vi.mock('../ui/icons', () => ({
  icon: (_name: string) => '<svg></svg>',
}));

import { renderIncidents } from '../sections/incidents';

// ── Fixtures ───────────────────────────────────────────────

interface Incident {
  id: string;
  ts: number;
  type: 'outage' | 'deploy' | 'config-change' | 'hotfix' | 'rollback';
  title: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  resolved: boolean;
  resolvedAt?: number;
}

const now = Date.now();

const sampleIncidents: Incident[] = [
  { id: 'inc_1', ts: now - 3600000, type: 'outage', title: 'Server outage', description: 'Main server went down', severity: 'critical', resolved: false },
  { id: 'inc_2', ts: now - 7200000, type: 'deploy', title: 'v1.0.8 deploy', description: 'Deployed to production', severity: 'minor', resolved: true, resolvedAt: now - 3000000 },
  { id: 'inc_3', ts: now - 1800000, type: 'hotfix', title: 'Fix lobby crash', description: 'Patched lobby disconnect', severity: 'major', resolved: false },
];

// ── Tests ──────────────────────────────────────────────────

describe('renderIncidents', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="inc-container"></div>';
    container = document.getElementById('inc-container')!;
    vi.restoreAllMocks();
  });

  it('renders empty state when no incidents', async () => {
    mockFetch([{ ok: true, json: [] }]);
    await renderIncidents(container);
    expect(container.innerHTML).toContain('No incidents logged');
  });

  it('renders Incident Timeline heading', async () => {
    mockFetch([{ ok: true, json: [] }]);
    await renderIncidents(container);
    expect(container.innerHTML).toContain('Incident Timeline');
  });

  it('renders incident titles', async () => {
    mockFetch([{ ok: true, json: sampleIncidents }]);
    await renderIncidents(container);
    expect(container.innerHTML).toContain('Server outage');
    expect(container.innerHTML).toContain('v1.0.8 deploy');
    expect(container.innerHTML).toContain('Fix lobby crash');
  });

  it('renders incident descriptions', async () => {
    mockFetch([{ ok: true, json: sampleIncidents }]);
    await renderIncidents(container);
    expect(container.innerHTML).toContain('Main server went down');
    expect(container.innerHTML).toContain('Deployed to production');
  });

  it('renders severity labels', async () => {
    mockFetch([{ ok: true, json: sampleIncidents }]);
    await renderIncidents(container);
    expect(container.innerHTML).toContain('critical');
    expect(container.innerHTML).toContain('minor');
    expect(container.innerHTML).toContain('major');
  });

  it('applies severity colors', async () => {
    mockFetch([{ ok: true, json: sampleIncidents }]);
    await renderIncidents(container);
    expect(container.innerHTML).toContain('var(--red-bright)');
    expect(container.innerHTML).toContain('var(--yellow)');
    expect(container.innerHTML).toContain('var(--orange)');
  });

  it('renders type icons', async () => {
    mockFetch([{ ok: true, json: sampleIncidents }]);
    await renderIncidents(container);
    // Outage icon
    expect(container.innerHTML).toContain('🔴');
    // Deploy icon
    expect(container.innerHTML).toContain('🚀');
    // Hotfix icon
    expect(container.innerHTML).toContain('🩹');
  });

  it('renders RESOLVED badge for resolved incidents', async () => {
    mockFetch([{ ok: true, json: sampleIncidents }]);
    await renderIncidents(container);
    expect(container.innerHTML).toContain('RESOLVED');
  });

  it('renders Resolve button for unresolved incidents', async () => {
    mockFetch([{ ok: true, json: sampleIncidents }]);
    await renderIncidents(container);
    const resolveButtons = container.querySelectorAll('.incident-resolve');
    expect(resolveButtons.length).toBe(2); // 2 unresolved
  });

  it('sorts incidents by timestamp (newest first)', async () => {
    mockFetch([{ ok: true, json: sampleIncidents }]);
    await renderIncidents(container);
    const html = container.innerHTML;
    const hotfixIdx = html.indexOf('Fix lobby crash');   // most recent (1800s ago)
    const outageIdx = html.indexOf('Server outage');      // 3600s ago
    const deployIdx = html.indexOf('v1.0.8 deploy');      // oldest (7200s ago)
    expect(hotfixIdx).toBeLessThan(outageIdx);
    expect(outageIdx).toBeLessThan(deployIdx);
  });

  it('renders add incident button', async () => {
    mockFetch([{ ok: true, json: [] }]);
    await renderIncidents(container);
    expect(container.querySelector('#incident-add-btn')).toBeTruthy();
  });

  it('escapes HTML in incident titles (XSS safety)', async () => {
    mockFetch([{ ok: true, json: [
      { id: 'inc_xss', ts: now, type: 'outage', title: '<script>alert(1)</script>', description: 'xss', severity: 'minor', resolved: false },
    ] }]);
    await renderIncidents(container);
    expect(container.innerHTML).not.toContain('<script>alert(1)');
    expect(container.innerHTML).toContain('&lt;script&gt;');
  });

  it('escapes HTML in descriptions (XSS safety)', async () => {
    mockFetch([{ ok: true, json: [
      { id: 'inc_xss2', ts: now, type: 'deploy', title: 'Safe', description: '<img onerror="alert(1)">', severity: 'minor', resolved: false },
    ] }]);
    await renderIncidents(container);
    expect(container.innerHTML).not.toContain('<img onerror');
  });

  it('handles fetch failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('fail'))));
    await renderIncidents(container);
    expect(container.innerHTML).toContain('No incidents logged');
  });

  it('renders timeline border structure', async () => {
    mockFetch([{ ok: true, json: sampleIncidents }]);
    await renderIncidents(container);
    expect(container.querySelector('#incident-timeline')).toBeTruthy();
  });

  it('renders config-change type icon', async () => {
    mockFetch([{ ok: true, json: [
      { id: 'inc_cfg', ts: now, type: 'config-change', title: 'Config update', description: 'Changed settings', severity: 'minor', resolved: true },
    ] }]);
    await renderIncidents(container);
    expect(container.innerHTML).toContain('⚙️');
  });

  it('renders rollback type icon', async () => {
    mockFetch([{ ok: true, json: [
      { id: 'inc_rb', ts: now, type: 'rollback', title: 'Rollback', description: 'Rolled back', severity: 'major', resolved: false },
    ] }]);
    await renderIncidents(container);
    expect(container.innerHTML).toContain('⏪');
  });
});
