// ── activity-digest tests ──────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before importing the module
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import {
  parseGitStatus,
  parseRecentCommits,
  parseHotModules,
  parseWorktrees,
} from '../activity-digest.js';

const mockExecSync = vi.mocked(execSync);

// ---------------------------------------------------------------------------
// parseGitStatus
// ---------------------------------------------------------------------------

describe('parseGitStatus', () => {
  it('counts modified, untracked, and deleted files', () => {
    const raw = [
      ' M src/foo.ts',
      ' M src/bar.ts',
      'M  src/staged.ts',
      '?? src/new.ts',
      '?? public/img.png',
      ' D src/gone.ts',
      'D  src/staged-deleted.ts',
    ].join('\n');

    const result = parseGitStatus(raw);
    expect(result.modified).toBe(3);
    expect(result.untracked).toBe(2);
    expect(result.deleted).toBe(2);
  });

  it('returns zeros for empty input', () => {
    expect(parseGitStatus('')).toEqual({ modified: 0, untracked: 0, deleted: 0 });
  });

  it('handles whitespace-only input', () => {
    expect(parseGitStatus('   \n\n  ')).toEqual({ modified: 0, untracked: 0, deleted: 0 });
  });

  it('handles only untracked files', () => {
    const raw = '?? newfile.ts\n?? another.ts';
    expect(parseGitStatus(raw)).toEqual({ modified: 0, untracked: 2, deleted: 0 });
  });

  it('handles mixed two-char status codes', () => {
    // AM = added to index, modified in worktree — counts as modified
    const raw = 'AM src/foo.ts\nMM src/bar.ts';
    const result = parseGitStatus(raw);
    expect(result.modified).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// parseRecentCommits
// ---------------------------------------------------------------------------

describe('parseRecentCommits', () => {
  it('parses a single commit with files', () => {
    const raw = [
      'abc1234 2 hours ago fix: correct typo in auth',
      'src/auth.ts',
      'src/ui/loginBeams.ts',
      '',
    ].join('\n');

    const result = parseRecentCommits(raw);
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('abc1234');
    expect(result[0].age).toBe('2 hours ago');
    expect(result[0].subject).toBe('fix: correct typo in auth');
    expect(result[0].files).toEqual(['src/auth.ts', 'src/ui/loginBeams.ts']);
  });

  it('parses multiple commits', () => {
    const raw = [
      'abc1234 2 hours ago fix: something',
      'src/foo.ts',
      '',
      'def5678 3 days ago feat: new feature',
      'src/bar.ts',
      'src/baz.ts',
      '',
    ].join('\n');

    const result = parseRecentCommits(raw);
    expect(result).toHaveLength(2);
    expect(result[0].hash).toBe('abc1234');
    expect(result[1].hash).toBe('def5678');
    expect(result[1].files).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    expect(parseRecentCommits('')).toEqual([]);
  });

  it('handles commits with no files', () => {
    const raw = 'abc1234 1 hour ago chore: empty commit\n\n';
    const result = parseRecentCommits(raw);
    expect(result).toHaveLength(1);
    expect(result[0].files).toEqual([]);
  });

  it('handles 40-char hashes', () => {
    const raw = 'abcdef1234567890abcdef1234567890abcdef12 5 minutes ago fix: long hash\nsrc/x.ts\n';
    const result = parseRecentCommits(raw);
    expect(result).toHaveLength(1);
    expect(result[0].hash).toBe('abcdef1234567890abcdef1234567890abcdef12');
  });

  it('skips lines that are not commit headers or file paths', () => {
    // Lines that look like blanks between commits should not be treated as files
    const raw = 'abc1234 2 hours ago fix: something\nsrc/real.ts\n\ndef5678 1 day ago chore: other\n';
    const result = parseRecentCommits(raw);
    expect(result[0].files).toEqual(['src/real.ts']);
    expect(result[1].files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseHotModules
// ---------------------------------------------------------------------------

describe('parseHotModules', () => {
  it('counts file occurrences and sorts descending', () => {
    const raw = [
      'src/foo.ts',
      'src/bar.ts',
      'src/foo.ts',
      'src/foo.ts',
      'src/bar.ts',
      'src/baz.ts',
      '',
    ].join('\n');

    const result = parseHotModules(raw);
    expect(result[0].path).toBe('src/foo.ts');
    expect(result[0].commits30d).toBe(3);
    expect(result[1].path).toBe('src/bar.ts');
    expect(result[1].commits30d).toBe(2);
    expect(result[2].path).toBe('src/baz.ts');
    expect(result[2].commits30d).toBe(1);
  });

  it('returns at most 15 entries', () => {
    const files = Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`);
    const raw = files.join('\n') + '\n';
    const result = parseHotModules(raw);
    expect(result.length).toBeLessThanOrEqual(15);
  });

  it('returns empty array for empty input', () => {
    expect(parseHotModules('')).toEqual([]);
  });

  it('sets lastTouched to empty string by default', () => {
    const raw = 'src/foo.ts\n';
    const result = parseHotModules(raw);
    expect(result[0].lastTouched).toBe('');
  });

  it('ignores empty lines', () => {
    const raw = '\n\nsrc/foo.ts\n\nsrc/foo.ts\n\n';
    const result = parseHotModules(raw);
    expect(result).toHaveLength(1);
    expect(result[0].commits30d).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// parseWorktrees
// ---------------------------------------------------------------------------

describe('parseWorktrees', () => {
  const sampleRaw = [
    'worktree /c/Projects/tron',
    'HEAD abc1234',
    'branch refs/heads/main',
    '',
    'worktree /c/Projects/tron/.worktrees/admin-dashboard',
    'HEAD def5678',
    'branch refs/heads/develop',
    '',
    'worktree /c/Projects/tron/.worktrees/feature-x',
    'HEAD ghi9012',
    'branch refs/heads/feature/new-ui',
    '',
  ].join('\n');

  it('skips the first (main) worktree', () => {
    const result = parseWorktrees(sampleRaw, {});
    expect(result.every(w => w.name !== 'tron')).toBe(true);
  });

  it('parses worktree names and branches', () => {
    const result = parseWorktrees(sampleRaw, {});
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('admin-dashboard');
    expect(result[0].branch).toBe('develop');
    expect(result[1].name).toBe('feature-x');
    expect(result[1].branch).toBe('feature/new-ui');
  });

  it('uses behindCounts for the behind field', () => {
    const behindCounts: Record<string, number> = {
      'admin-dashboard': 3,
      'feature-x': 0,
    };
    const result = parseWorktrees(sampleRaw, behindCounts);
    expect(result[0].behind).toBe(3);
    expect(result[1].behind).toBe(0);
  });

  it('defaults behind to 0 when not in behindCounts', () => {
    const result = parseWorktrees(sampleRaw, {});
    expect(result[0].behind).toBe(0);
    expect(result[1].behind).toBe(0);
  });

  it('defaults changedFiles to 0', () => {
    const result = parseWorktrees(sampleRaw, {});
    expect(result[0].changedFiles).toBe(0);
    expect(result[1].changedFiles).toBe(0);
  });

  it('returns empty array when only main worktree exists', () => {
    const onlyMain = [
      'worktree /c/Projects/tron',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
    ].join('\n');
    const result = parseWorktrees(onlyMain, {});
    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(parseWorktrees('', {})).toEqual([]);
  });

  it('handles detached HEAD worktrees gracefully', () => {
    const detached = [
      'worktree /c/Projects/tron',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree /c/Projects/tron/.worktrees/detached-wt',
      'HEAD def5678',
      'detached',
      '',
    ].join('\n');
    // Should not throw; detached worktree gets empty branch or is skipped
    expect(() => parseWorktrees(detached, {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generateDigest (integration — mocked execSync)
// ---------------------------------------------------------------------------

describe('generateDigest', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an ActivityDigest-shaped object', async () => {
    // Call order matches generateDigest implementation:
    // 1. git rev-parse --abbrev-ref HEAD
    // 2. git rev-list --count HEAD ^origin/HEAD
    // 3. git status --porcelain
    // 4. git log (recent commits)
    // 5. git log --since=30.days (hot modules)
    // 6. git log -1 for lastTouched (foo.ts)  ← lastTouched loop before worktrees
    // 7. git log -1 for lastTouched (bar.ts)
    // 8. git worktree list --porcelain
    mockExecSync
      .mockReturnValueOnce('develop\n')
      .mockReturnValueOnce('2\n')
      .mockReturnValueOnce(' M src/foo.ts\n?? src/new.ts\n')
      .mockReturnValueOnce('abc1234 2 hours ago fix: something\nsrc/foo.ts\n\n')
      .mockReturnValueOnce('src/foo.ts\nsrc/foo.ts\nsrc/bar.ts\n')
      .mockReturnValueOnce('2 hours ago\n')
      .mockReturnValueOnce('3 days ago\n')
      .mockReturnValueOnce('worktree /c/Projects/tron\nHEAD abc\nbranch refs/heads/main\n\n');

    const { generateDigest } = await import('../activity-digest.js');
    const digest = await generateDigest(10);

    expect(digest.branch).toBe('develop');
    expect(digest.aheadOfOrigin).toBe(2);
    expect(digest.uncommitted.modified).toBe(1);
    expect(digest.uncommitted.untracked).toBe(1);
    expect(digest.uncommitted.deleted).toBe(0);
    expect(digest.recentCommits).toHaveLength(1);
    expect(digest.hotModules.length).toBeGreaterThan(0);
    expect(digest.hotModules[0].lastTouched).toBe('2 hours ago');
    expect(typeof digest.generated).toBe('string');
  });

  it('computes behind counts and changedFiles for worktrees', async () => {
    const worktreeListOutput = [
      'worktree /c/Projects/tron',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree /c/Projects/tron/.worktrees/admin-dashboard',
      'HEAD def5678',
      'branch refs/heads/admin/dashboard-v2',
      '',
      'worktree /c/Projects/tron/.worktrees/feature-x',
      'HEAD ghi9012',
      'branch refs/heads/feature/new-ui',
      '',
    ].join('\n');

    mockExecSync
      .mockReturnValueOnce('develop\n')             // branch
      .mockReturnValueOnce('2\n')                    // ahead
      .mockReturnValueOnce('')                       // status
      .mockReturnValueOnce('')                       // log (recent)
      .mockReturnValueOnce('')                       // log (hot)
      .mockReturnValueOnce(worktreeListOutput)       // worktree list
      // Per-worktree calls for admin-dashboard:
      .mockReturnValueOnce('3\n')                    // rev-list behind count
      .mockReturnValueOnce(' M file1.ts\n M file2.ts\n') // status --porcelain
      // Per-worktree calls for feature-x:
      .mockReturnValueOnce('0\n')                    // rev-list behind count
      .mockReturnValueOnce('');                      // status --porcelain

    const { generateDigest } = await import('../activity-digest.js');
    const digest = await generateDigest(10);

    expect(digest.worktrees).toHaveLength(2);
    expect(digest.worktrees[0].name).toBe('admin-dashboard');
    expect(digest.worktrees[0].behind).toBe(3);
    expect(digest.worktrees[0].changedFiles).toBe(2);
    expect(digest.worktrees[1].name).toBe('feature-x');
    expect(digest.worktrees[1].behind).toBe(0);
    expect(digest.worktrees[1].changedFiles).toBe(0);
  });

  it('handles execSync errors gracefully (returns empty string fallback)', async () => {
    // All calls throw
    mockExecSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    const { generateDigest } = await import('../activity-digest.js');
    // Should not throw
    await expect(generateDigest()).resolves.toBeDefined();
  });
});
