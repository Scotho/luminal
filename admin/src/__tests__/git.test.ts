import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitTab } from '../sections/git';

describe('git tab router', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('exports expected types and functions', async () => {
    const mod = await import('../sections/git');
    expect(typeof mod.getGitState).toBe('function');
    expect(typeof mod.getActiveTab).toBe('function');
    expect(typeof mod.refreshGitState).toBe('function');
    expect(typeof mod.renderGit).toBe('function');
  });

  it('getActiveTab returns the default tab', async () => {
    const { getActiveTab } = await import('../sections/git');
    // Default tab should be 'working-tree' (set during module init or renderGit)
    const tab = getActiveTab();
    expect(['working-tree', 'log', 'branches', 'prs', 'ci']).toContain(tab);
  });

  it('getGitState returns initial empty state', async () => {
    const { getGitState } = await import('../sections/git');
    const state = getGitState();
    expect(state).toBeDefined();
    expect(state.branch).toBe('');
    expect(state.oid).toBe('');
    expect(state.ahead).toBe(0);
    expect(state.behind).toBe(0);
    expect(state.staged).toEqual([]);
    expect(state.unstaged).toEqual([]);
    expect(state.untracked).toEqual([]);
    expect(state.conflicts).toEqual([]);
    expect(state.stashCount).toBe(0);
  });

  it('refreshGitState populates state from API response', async () => {
    const mockResponse = {
      branch: 'develop',
      oid: 'abc1234',
      ahead: 2,
      behind: 1,
      staged: [{ path: 'src/main.ts', status: 'M' }],
      unstaged: [{ path: 'src/utils.ts', status: 'M' }],
      untracked: ['src/newFile.ts'],
      conflicts: ['src/conflict.ts'],
      stashCount: 3,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const { refreshGitState, getGitState } = await import('../sections/git');
    await refreshGitState();

    const state = getGitState();
    expect(state.branch).toBe('develop');
    expect(state.oid).toBe('abc1234');
    expect(state.ahead).toBe(2);
    expect(state.behind).toBe(1);
    expect(state.staged).toHaveLength(1);
    expect(state.staged[0]).toEqual({ path: 'src/main.ts', status: 'M', staged: true });
    expect(state.unstaged).toHaveLength(1);
    expect(state.unstaged[0]).toEqual({ path: 'src/utils.ts', status: 'M', staged: false });
    expect(state.untracked).toHaveLength(1);
    expect(state.untracked[0]).toEqual({ path: 'src/newFile.ts', status: 'A', staged: false });
    expect(state.conflicts).toEqual(['src/conflict.ts']);
    expect(state.stashCount).toBe(3);
  });

  it('refreshGitState handles missing fields gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ branch: 'main' }),
    }));

    const { refreshGitState, getGitState } = await import('../sections/git');
    await refreshGitState();

    const state = getGitState();
    expect(state.branch).toBe('main');
    expect(state.oid).toBe('');
    expect(state.ahead).toBe(0);
    expect(state.behind).toBe(0);
    expect(state.staged).toEqual([]);
    expect(state.unstaged).toEqual([]);
    expect(state.untracked).toEqual([]);
    expect(state.conflicts).toEqual([]);
    expect(state.stashCount).toBe(0);
  });

  it('refreshGitState survives fetch failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const { refreshGitState } = await import('../sections/git');
    // Should not throw
    await expect(refreshGitState()).resolves.toBeUndefined();
  });

  it('refreshGitState ignores non-ok responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    }));

    const { refreshGitState, getGitState } = await import('../sections/git');
    // First populate with real data
    const prevState = { ...getGitState() };
    await refreshGitState();
    // State should remain unchanged
    expect(getGitState().branch).toBe(prevState.branch);
  });

  it('renderGit returns a cleanup function', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ branch: 'main', staged: [], unstaged: [], untracked: [] }),
    }));

    const { renderGit } = await import('../sections/git');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const cleanup = renderGit(container);
    expect(typeof cleanup).toBe('function');

    // Container should have git-header and git-body elements
    expect(container.querySelector('#git-header')).toBeTruthy();
    expect(container.querySelector('#git-body')).toBeTruthy();

    // Should add class
    expect(container.classList.contains('section--git')).toBe(true);

    // Cleanup should remove class
    cleanup();
    expect(container.classList.contains('section--git')).toBe(false);
  });

  it('GitTab type covers all expected tabs', () => {
    // Type-level test: ensure all tabs are assignable
    const tabs: GitTab[] = ['working-tree', 'log', 'branches', 'prs', 'ci'];
    expect(tabs).toHaveLength(5);
  });
});
