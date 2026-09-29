// ── Health section tests ───────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  renderStatCards,
  renderHotModules,
  renderWorktrees,
} from '../sections/healthHelpers';
import type { ActivityDigest, TestHealth, HotModule, WorktreeInfo } from '../types';

// ── Fixtures ────────────────────────────────────────────────

const digest: ActivityDigest = {
  branch: 'develop',
  aheadOfOrigin: 5,
  uncommitted: { modified: 2, untracked: 1, deleted: 0 },
  recentCommits: [],
  hotModules: [],
  worktrees: [],
  generated: '2026-04-05T00:00:00Z',
};

const testHealth: TestHealth = {
  configs: {},
  failures: [],
  untested: [],
  coverage: { withTests: 50, total: 120, percent: 42 },
  generated: '2026-04-05T00:00:00Z',
};

// ── renderStatCards ──────────────────────────────────────────

describe('renderStatCards', () => {
  it('renders module count from testHealth.coverage.total', () => {
    const html = renderStatCards(digest, testHealth);
    expect(html).toContain('120');
  });

  it('renders coverage percentage with % sign', () => {
    const html = renderStatCards(digest, testHealth);
    expect(html).toContain('42%');
  });

  it('renders commits ahead of origin', () => {
    const html = renderStatCards(digest, testHealth);
    expect(html).toContain('5');
  });

  it('renders active worktrees count', () => {
    const digestWithTrees: ActivityDigest = {
      ...digest,
      worktrees: [
        { name: 'feature-x', branch: 'feature/x', behind: 0, changedFiles: 1 },
        { name: 'hotfix-y', branch: 'hotfix/y', behind: 2, changedFiles: 3 },
      ],
    };
    const html = renderStatCards(digestWithTrees, testHealth);
    // worktrees.length = 2
    expect(html).toContain('2');
  });

  it('contains all 4 stat card labels', () => {
    const html = renderStatCards(digest, testHealth);
    expect(html).toContain('Modules');
    expect(html).toContain('Test Coverage');
    expect(html).toContain('Commits Ahead');
    expect(html).toContain('Active Worktrees');
  });
});

// ── renderHotModules ─────────────────────────────────────────

describe('renderHotModules', () => {
  it('returns "No data" placeholder for an empty array', () => {
    const html = renderHotModules([]);
    expect(html).toContain('No data');
  });

  it('renders module path for each entry', () => {
    const modules: HotModule[] = [
      { path: 'src/player.ts', commits30d: 10, lastTouched: '2026-04-01' },
      { path: 'src/netcode.ts', commits30d: 25, lastTouched: '2026-04-02' },
    ];
    const html = renderHotModules(modules);
    expect(html).toContain('src/player.ts');
    expect(html).toContain('src/netcode.ts');
  });

  it('renders commit count for each entry', () => {
    const modules: HotModule[] = [
      { path: 'src/player.ts', commits30d: 10, lastTouched: '2026-04-01' },
    ];
    const html = renderHotModules(modules);
    expect(html).toContain('10');
    expect(html).toContain('commits');
  });

  it('colors >40 commits red', () => {
    const modules: HotModule[] = [
      { path: 'src/hot.ts', commits30d: 55, lastTouched: '2026-04-01' },
    ];
    const html = renderHotModules(modules);
    expect(html).toContain('var(--red)');
  });

  it('colors >20 commits yellow', () => {
    const modules: HotModule[] = [
      { path: 'src/warm.ts', commits30d: 30, lastTouched: '2026-04-01' },
    ];
    const html = renderHotModules(modules);
    expect(html).toContain('var(--yellow)');
  });

  it('colors <=20 commits accent (cyan)', () => {
    const modules: HotModule[] = [
      { path: 'src/cool.ts', commits30d: 20, lastTouched: '2026-04-01' },
    ];
    const html = renderHotModules(modules);
    expect(html).toContain('var(--accent)');
  });

  it('treats exactly 40 commits as yellow, not red', () => {
    const modules: HotModule[] = [
      { path: 'src/mid.ts', commits30d: 40, lastTouched: '2026-04-01' },
    ];
    const html = renderHotModules(modules);
    expect(html).toContain('var(--yellow)');
    expect(html).not.toContain('var(--red)');
  });

  it('escapes HTML in module paths', () => {
    const modules: HotModule[] = [
      { path: 'src/<evil>.ts', commits30d: 1, lastTouched: '2026-04-01' },
    ];
    const html = renderHotModules(modules);
    expect(html).not.toContain('<evil>');
    expect(html).toContain('&lt;evil&gt;');
  });
});

// ── renderWorktrees ──────────────────────────────────────────

describe('renderWorktrees', () => {
  it('returns "No active worktrees" for an empty array', () => {
    const html = renderWorktrees([]);
    expect(html).toContain('No active worktrees');
  });

  it('renders worktree name and branch', () => {
    const trees: WorktreeInfo[] = [
      { name: 'admin-dashboard', branch: 'feature/admin', behind: 0, changedFiles: 2 },
    ];
    const html = renderWorktrees(trees);
    expect(html).toContain('admin-dashboard');
    expect(html).toContain('feature/admin');
  });

  it('renders behind count when > 0', () => {
    const trees: WorktreeInfo[] = [
      { name: 'stale-branch', branch: 'old/feature', behind: 3, changedFiles: 0 },
    ];
    const html = renderWorktrees(trees);
    expect(html).toContain('3 behind');
  });

  it('shows "up to date" when behind is 0', () => {
    const trees: WorktreeInfo[] = [
      { name: 'fresh', branch: 'main', behind: 0, changedFiles: 0 },
    ];
    const html = renderWorktrees(trees);
    expect(html).toContain('up to date');
  });

  it('renders multiple worktrees', () => {
    const trees: WorktreeInfo[] = [
      { name: 'tree-a', branch: 'branch/a', behind: 0, changedFiles: 0 },
      { name: 'tree-b', branch: 'branch/b', behind: 1, changedFiles: 2 },
    ];
    const html = renderWorktrees(trees);
    expect(html).toContain('tree-a');
    expect(html).toContain('tree-b');
  });

  it('escapes HTML in name and branch', () => {
    const trees: WorktreeInfo[] = [
      { name: '<script>', branch: '"injected"', behind: 0, changedFiles: 0 },
    ];
    const html = renderWorktrees(trees);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('"injected"');
    expect(html).toContain('&quot;injected&quot;');
  });
});
