import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockFetch } from './helpers';

vi.mock('../ui/render', () => ({
  escapeHtml: (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  ago: (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  },
}));

vi.mock('../ui/icons', () => ({
  icon: (_name: string) => '<svg></svg>',
}));

import { renderOverseer } from '../sections/overseer';

// Default fixtures
const defaultConfig = {
  enabled: false,
  domains: {
    'bugs': { mode: 'watch', pollIntervalMs: 120000, enabled: true },
    'tests': { mode: 'watch', pollIntervalMs: 300000, enabled: true },
    'server-health': { mode: 'watch', pollIntervalMs: 120000, enabled: true },
    'perf': { mode: 'watch', pollIntervalMs: 300000, enabled: true },
    'player-activity': { mode: 'watch', pollIntervalMs: 180000, enabled: true },
    'deploy': { mode: 'watch', pollIntervalMs: 300000, enabled: true },
    'stale-tasks': { mode: 'watch', pollIntervalMs: 600000, enabled: true },
  },
  standingOrders: [],
  claude: { maxDispatchesPerHour: 5, maxDispatchesPerDay: 20, requireApproval: true },
  discord: { enabled: true, cooldownMinutes: 15 },
  heartbeatIntervalMs: 60000,
};
const defaultState = { running: false, startedAt: 0, lastTick: {}, claudeDispatches: [], heartbeatTs: 0 };

describe('renderOverseer', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="overseer-container"></div>';
    container = document.getElementById('overseer-container')!;
    vi.restoreAllMocks();
  });

  it('renders STOPPED label when not running', async () => {
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    expect(container.innerHTML).toContain('OVERSEER');
    expect(container.innerHTML).toContain('STOPPED');
  });

  it('renders ACTIVE label when running', async () => {
    mockFetch([
      { ok: true, json: { ...defaultConfig, enabled: true } },
      { ok: true, json: { ...defaultState, running: true } },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    expect(container.innerHTML).toContain('ACTIVE');
  });

  it('renders all 7 domain cards', async () => {
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    for (const label of ['Bugs', 'Tests', 'Server Health', 'Performance', 'Player Activity', 'Deploy', 'Stale Tasks']) {
      expect(container.innerHTML).toContain(label);
    }
  });

  it('renders standing orders when present', async () => {
    const configWithOrders = {
      ...defaultConfig,
      standingOrders: [
        { id: 'order_1', text: 'Flag E2E bugs separately', createdAt: Date.now(), domains: ['bugs'] },
      ],
    };
    mockFetch([
      { ok: true, json: configWithOrders },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    expect(container.innerHTML).toContain('Standing Orders');
    expect(container.innerHTML).toContain('Flag E2E bugs separately');
  });

  it('renders activity feed entries', async () => {
    const log = [
      { id: 'olog_1', ts: Date.now(), domain: 'bugs', action: 'detected', summary: 'Bug burst detected' },
    ];
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: log },
    ]);
    await renderOverseer(container);
    expect(container.innerHTML).toContain('Bug burst detected');
  });

  it('renders Watch All / Advise All / Act All buttons', async () => {
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    expect(container.innerHTML).toContain('Watch All');
    expect(container.innerHTML).toContain('Advise All');
    expect(container.innerHTML).toContain('Act All');
  });

  it('highlights Watch All when all domains are in watch mode', async () => {
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    const watchBtn = container.querySelector('.overseer-master-mode[data-mode="watch"]') as HTMLElement;
    expect(watchBtn).toBeTruthy();
    expect(watchBtn.style.background).toContain('var(--accent)');
  });

  it('renders Start button when stopped', async () => {
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    const toggleBtn = container.querySelector('#overseer-toggle') as HTMLElement;
    expect(toggleBtn.textContent?.trim()).toBe('Start');
  });

  it('renders Stop button when running', async () => {
    mockFetch([
      { ok: true, json: { ...defaultConfig, enabled: true } },
      { ok: true, json: { ...defaultState, running: true } },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    const toggleBtn = container.querySelector('#overseer-toggle') as HTMLElement;
    expect(toggleBtn.textContent?.trim()).toBe('Stop');
  });

  it('shows domain stats in subtitle', async () => {
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    expect(container.innerHTML).toContain('7/7 domains');
    expect(container.innerHTML).toContain('0 standing orders');
    expect(container.innerHTML).toContain('Claude: 0/5 hr');
  });

  it('renders ON/OFF toggle for each domain', async () => {
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    const toggles = container.querySelectorAll('.overseer-domain-toggle');
    expect(toggles.length).toBe(7);
  });

  it('renders + Add Order button', async () => {
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    const addBtn = container.querySelector('#overseer-add-order');
    expect(addBtn).toBeTruthy();
    expect(addBtn?.textContent).toContain('Add Order');
  });

  it('renders both tab buttons', async () => {
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    const tabs = container.querySelectorAll('.overseer-tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain('Standing Orders');
    expect(tabs[1].textContent).toContain('Activity');
  });

  it('renders domain pills on standing orders', async () => {
    const configWithOrders = {
      ...defaultConfig,
      standingOrders: [
        { id: 'order_1', text: 'Check test failures', createdAt: Date.now(), domains: ['tests', 'bugs'] },
      ],
    };
    mockFetch([
      { ok: true, json: configWithOrders },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    const pills = container.querySelectorAll('.overseer-pill');
    expect(pills.length).toBeGreaterThan(0);
  });

  it('renders poll interval in human-readable form', async () => {
    mockFetch([
      { ok: true, json: defaultConfig },
      { ok: true, json: defaultState },
      { ok: true, json: [] },
    ]);
    await renderOverseer(container);
    // bugs has 120000ms = 2m
    expect(container.innerHTML).toContain('Poll: 2m');
    // stale-tasks has 600000ms = 10m
    expect(container.innerHTML).toContain('Poll: 10m');
  });

  it('renders error state on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    await renderOverseer(container);
    expect(container.innerHTML).toContain('Failed to load');
  });
});
