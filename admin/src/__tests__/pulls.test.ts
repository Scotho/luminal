import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module import test ────────────────────────────────────────────────────────
// pulls.ts only exports renderPulls (an async DOM renderer). We test:
// 1. The module can be imported without error
// 2. renderPulls handles fetch failure gracefully
// 3. renderPulls handles empty PR list
// 4. renderPulls renders PR rows on success
// 5. Re-render cleans up previous click handler

describe('pulls module', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('can be imported without error', async () => {
    const mod = await import('../sections/pulls');
    expect(mod).toBeDefined();
    expect(typeof mod.renderPulls).toBe('function');
  });

  it('shows error message when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { renderPulls } = await import('../sections/pulls');
    const container = document.createElement('div');
    document.body.appendChild(container);

    await renderPulls(container);

    expect(container.innerHTML).toContain('Failed to load PRs');
  });

  it('shows "No PRs found" for empty array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
    }));

    const { renderPulls } = await import('../sections/pulls');
    const container = document.createElement('div');
    document.body.appendChild(container);

    await renderPulls(container);

    expect(container.innerHTML).toContain('No PRs found');
    expect(container.querySelector('#pulls-refresh')).toBeTruthy();
  });

  it('renders PR rows for valid data', async () => {
    const mockPRs = [
      {
        number: 1,
        title: 'Add feature X',
        state: 'open',
        merged_at: null,
        user: { login: 'alice', avatar_url: '' },
        head: { ref: 'feat/x', sha: 'abc123' },
        base: { ref: 'main' },
        created_at: '2026-04-01T10:00:00Z',
        updated_at: '2026-04-02T12:00:00Z',
        html_url: 'https://github.com/test/repo/pull/1',
        body: 'Some description',
        draft: false,
      },
      {
        number: 2,
        title: 'Fix bug Y',
        state: 'closed',
        merged_at: '2026-04-03T08:00:00Z',
        user: { login: 'bob', avatar_url: '' },
        head: { ref: 'fix/y', sha: 'def456' },
        base: { ref: 'main' },
        created_at: '2026-04-01T09:00:00Z',
        updated_at: '2026-04-03T08:00:00Z',
        html_url: 'https://github.com/test/repo/pull/2',
        body: null,
        draft: false,
      },
    ];

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve(mockPRs),
    }));

    const { renderPulls } = await import('../sections/pulls');
    const container = document.createElement('div');
    document.body.appendChild(container);

    await renderPulls(container);

    // Should render PR rows
    const rows = container.querySelectorAll('.pr-row');
    expect(rows.length).toBe(2);

    // First PR: open
    expect(rows[0].getAttribute('data-pr-number')).toBe('1');
    expect(rows[0].textContent).toContain('#1');
    expect(rows[0].textContent).toContain('Add feature X');
    expect(rows[0].textContent).toContain('Open');

    // Second PR: merged
    expect(rows[1].getAttribute('data-pr-number')).toBe('2');
    expect(rows[1].textContent).toContain('Merged');
  });

  it('marks draft PRs with [DRAFT] label', async () => {
    const mockPRs = [
      {
        number: 3,
        title: 'WIP feature',
        state: 'open',
        merged_at: null,
        user: { login: 'charlie', avatar_url: '' },
        head: { ref: 'wip/feature', sha: 'ghi789' },
        base: { ref: 'main' },
        created_at: '2026-04-01T10:00:00Z',
        updated_at: '2026-04-01T10:00:00Z',
        html_url: 'https://github.com/test/repo/pull/3',
        body: null,
        draft: true,
      },
    ];

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve(mockPRs),
    }));

    const { renderPulls } = await import('../sections/pulls');
    const container = document.createElement('div');
    document.body.appendChild(container);

    await renderPulls(container);

    expect(container.innerHTML).toContain('[DRAFT]');
  });

  it('handles non-array response gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ error: 'not found' }),
    }));

    const { renderPulls } = await import('../sections/pulls');
    const container = document.createElement('div');
    document.body.appendChild(container);

    await renderPulls(container);

    // Should treat non-array as empty
    expect(container.innerHTML).toContain('No PRs found');
  });
});
