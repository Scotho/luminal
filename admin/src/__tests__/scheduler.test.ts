// ── Scheduler section tests ────────────────────────────────
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

import { renderScheduler } from '../sections/scheduler';

// ── Fixtures ───────────────────────────────────────────────

interface ScheduledTask {
  id: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  lastRun?: number;
  lastResult?: 'success' | 'error';
}

function makeTasks(overrides: Partial<ScheduledTask>[] = []): ScheduledTask[] {
  const defaults: ScheduledTask[] = [
    { id: 'sched_1', name: 'Daily backup', schedule: '0 0 * * *', command: 'npm run backup', enabled: true, lastRun: Date.now() - 3600000, lastResult: 'success' },
    { id: 'sched_2', name: 'Hourly health check', schedule: '0 * * * *', command: 'npm run health', enabled: false, lastResult: 'error', lastRun: Date.now() - 7200000 },
  ];
  return overrides.length > 0
    ? overrides.map((o, i) => ({ ...defaults[i % defaults.length], ...o }))
    : defaults;
}

// ── Tests ──────────────────────────────────────────────────

describe('renderScheduler', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="sched-container"></div>';
    container = document.getElementById('sched-container')!;
    vi.restoreAllMocks();
  });

  it('renders empty state when no tasks', async () => {
    mockFetch([{ ok: true, json: [] }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('No scheduled tasks');
    expect(container.innerHTML).toContain('Scheduler');
  });

  it('renders task list with task names', async () => {
    const tasks = makeTasks();
    mockFetch([{ ok: true, json: tasks }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('Daily backup');
    expect(container.innerHTML).toContain('Hourly health check');
  });

  it('renders cron expressions', async () => {
    const tasks = makeTasks();
    mockFetch([{ ok: true, json: tasks }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('0 0 * * *');
    expect(container.innerHTML).toContain('0 * * * *');
  });

  it('renders command text', async () => {
    const tasks = makeTasks();
    mockFetch([{ ok: true, json: tasks }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('npm run backup');
    expect(container.innerHTML).toContain('npm run health');
  });

  it('shows green dot for enabled tasks', async () => {
    mockFetch([{ ok: true, json: [{ id: 's1', name: 'Test', schedule: '0 * * * *', command: 'echo 1', enabled: true }] }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('var(--green)');
    expect(container.innerHTML).toContain('Disable');
  });

  it('shows quiet dot for disabled tasks', async () => {
    mockFetch([{ ok: true, json: [{ id: 's1', name: 'Test', schedule: '0 * * * *', command: 'echo 1', enabled: false }] }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('var(--text-quiet)');
    expect(container.innerHTML).toContain('Enable');
  });

  it('renders last run time', async () => {
    mockFetch([{ ok: true, json: makeTasks() }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('Last:');
  });

  it('shows "never" when task has no lastRun', async () => {
    mockFetch([{ ok: true, json: [{ id: 's1', name: 'New', schedule: 'daily', command: 'echo hi', enabled: true }] }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('never');
  });

  it('renders success result in green', async () => {
    mockFetch([{ ok: true, json: [{ id: 's1', name: 'Test', schedule: 'daily', command: 'test', enabled: true, lastRun: Date.now(), lastResult: 'success' }] }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('var(--green)');
  });

  it('renders error result in red', async () => {
    mockFetch([{ ok: true, json: [{ id: 's1', name: 'Test', schedule: 'daily', command: 'test', enabled: true, lastRun: Date.now(), lastResult: 'error' }] }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('var(--red-bright)');
  });

  it('renders add button', async () => {
    mockFetch([{ ok: true, json: [] }]);
    await renderScheduler(container);
    expect(container.querySelector('#sched-add')).toBeTruthy();
  });

  it('renders toggle, run, and delete buttons per task', async () => {
    mockFetch([{ ok: true, json: makeTasks() }]);
    await renderScheduler(container);
    expect(container.querySelectorAll('.sched-toggle').length).toBe(2);
    expect(container.querySelectorAll('.sched-run').length).toBe(2);
    expect(container.querySelectorAll('.sched-delete').length).toBe(2);
  });

  it('escapes HTML in task names (XSS safety)', async () => {
    mockFetch([{ ok: true, json: [{ id: 's1', name: '<script>xss</script>', schedule: 'daily', command: 'test', enabled: true }] }]);
    await renderScheduler(container);
    expect(container.innerHTML).not.toContain('<script>xss</script>');
    expect(container.innerHTML).toContain('&lt;script&gt;');
  });

  it('handles fetch failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network error'))));
    await renderScheduler(container);
    expect(container.innerHTML).toContain('No scheduled tasks');
  });

  it('renders the Scheduler heading', async () => {
    mockFetch([{ ok: true, json: [] }]);
    await renderScheduler(container);
    expect(container.innerHTML).toContain('Scheduler');
  });
});
