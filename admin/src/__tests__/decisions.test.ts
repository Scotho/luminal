// ── Decisions section tests ───────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch before importing
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// The helpers (matchesSearch, formatDate) are not exported, so we test
// through the public renderDecisions export and verify the module loads.
import { renderDecisions } from '../sections/decisions';

describe('decisions section', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('is importable and exports renderDecisions', () => {
    expect(typeof renderDecisions).toBe('function');
  });

  it('renders empty state when no decisions exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const container = document.createElement('div');
    await renderDecisions(container);

    expect(container.innerHTML).toContain('No decisions found');
  });

  it('renders loading state then decision cards', async () => {
    const decisions = [
      {
        id: 'dec_1',
        title: 'Use Vitest',
        context: 'Need a test runner',
        options: ['Jest', 'Vitest'],
        decision: 'Vitest',
        rationale: 'Faster with Vite',
        created: '2026-04-01T10:00:00Z',
        tags: ['testing'],
      },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(decisions),
    });

    const container = document.createElement('div');
    await renderDecisions(container);

    expect(container.innerHTML).toContain('Use Vitest');
    expect(container.innerHTML).toContain('testing');
  });

  it('renders multiple decisions sorted by date (newest first)', async () => {
    const decisions = [
      {
        id: 'dec_old',
        title: 'Old Decision',
        context: '',
        options: [],
        decision: '',
        rationale: '',
        created: '2026-01-01T00:00:00Z',
        tags: [],
      },
      {
        id: 'dec_new',
        title: 'New Decision',
        context: '',
        options: [],
        decision: '',
        rationale: '',
        created: '2026-04-01T00:00:00Z',
        tags: [],
      },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(decisions),
    });

    const container = document.createElement('div');
    await renderDecisions(container);

    const html = container.innerHTML;
    const oldIdx = html.indexOf('Old Decision');
    const newIdx = html.indexOf('New Decision');
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it('handles fetch failure gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const container = document.createElement('div');
    await renderDecisions(container);

    expect(container.innerHTML).toContain('No decisions found');
  });

  it('handles network error gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const container = document.createElement('div');
    await renderDecisions(container);

    expect(container.innerHTML).toContain('No decisions found');
  });

  it('renders search input', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const container = document.createElement('div');
    await renderDecisions(container);

    const searchInput = container.querySelector<HTMLInputElement>('#dec-search');
    expect(searchInput).not.toBeNull();
    expect(searchInput!.placeholder).toBe('Search decisions...');
  });

  it('renders new decision button', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const container = document.createElement('div');
    await renderDecisions(container);

    const btn = container.querySelector('#dec-new-btn');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain('New Decision');
  });
});
