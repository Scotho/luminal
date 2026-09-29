/**
 * activity-digest.ts
 *
 * Reads git state and outputs an ActivityDigest as JSON to stdout.
 *
 * Usage:
 *   npx tsx admin/scripts/activity-digest.ts [--commits N]
 */

import { execSync } from 'child_process';
import type {
  ActivityDigest,
  CommitInfo,
  HotModule,
  WorktreeInfo,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** Absolute path to the repo root (two levels up from admin/scripts/). */
const ROOT = (() => {
  // import.meta.url → file:///C:/Projects/tron/.worktrees/admin-dashboard/admin/scripts/activity-digest.ts
  // Two parents: admin/scripts → admin → admin-dashboard (worktree root)
  // Then one more parent to reach the actual repo root? No — the repo root IS
  // the worktree root for the main branch. We want the CWD of the worktree
  // being analysed (admin-dashboard), which is the project root.
  // The repo root for git commands is the top-level tron directory.
  const url = new URL('../../', import.meta.url);
  let p = url.pathname;
  // On Windows, strip the leading slash before the drive letter: /C:/... → C:/...
  p = p.replace(/^\/([A-Z]:)/, '$1');
  // Remove trailing slash
  return p.replace(/\/$/, '');
})();

// ---------------------------------------------------------------------------
// exec helper
// ---------------------------------------------------------------------------

function exec(cmd: string): string {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 10_000,
    }) as string;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Parsing functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Parses `git status --porcelain` output into counts.
 */
export function parseGitStatus(raw: string): {
  modified: number;
  untracked: number;
  deleted: number;
} {
  let modified = 0;
  let untracked = 0;
  let deleted = 0;

  for (const line of raw.split('\n')) {
    if (line.length < 2) continue;
    const xy = line.slice(0, 2);

    if (xy === '??') {
      untracked++;
    } else if (xy[0] === 'D' || xy[1] === 'D') {
      deleted++;
    } else if (xy.trim() !== '') {
      modified++;
    }
  }

  return { modified, untracked, deleted };
}

/**
 * Parses `git log --format=%h %ar %s --name-only` output into commit objects.
 *
 * Format expected:
 *   <hash> <age> <subject>
 *   <file1>
 *   <file2>
 *   (blank line)
 *   <hash> ...
 */
export function parseRecentCommits(raw: string): CommitInfo[] {
  const commitHeaderRe = /^([a-f0-9]{7,}) (.+? ago) (.+)$/;
  const commits: CommitInfo[] = [];
  let current: CommitInfo | null = null;

  for (const line of raw.split('\n')) {
    const match = commitHeaderRe.exec(line);
    if (match) {
      if (current) commits.push(current);
      current = {
        hash: match[1],
        age: match[2],
        subject: match[3],
        files: [],
      };
    } else if (current && line.trim() !== '') {
      current.files.push(line.trim());
    }
  }

  if (current) commits.push(current);
  return commits;
}

/**
 * Parses `git log --since=30.days --name-only --format=` output into hot
 * module entries, sorted by occurrence count descending (top 15).
 */
export function parseHotModules(raw: string): HotModule[] {
  const counts = new Map<string, number>();

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([path, commits30d]) => ({ path, commits30d, lastTouched: '' }));
}

/**
 * Parses `git worktree list --porcelain` output into worktree info objects.
 * Skips the first (main) worktree.
 */
export function parseWorktrees(
  raw: string,
  behindCounts: Record<string, number>,
): WorktreeInfo[] {
  if (!raw.trim()) return [];

  // Split into blocks separated by blank lines
  const blocks = raw.trim().split(/\n\n+/);
  const worktrees: WorktreeInfo[] = [];
  let isFirst = true;

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const worktreeLine = lines.find(l => l.startsWith('worktree '));
    const branchLine = lines.find(l => l.startsWith('branch refs/heads/'));

    if (!worktreeLine) continue;

    // Skip the main worktree (first block)
    if (isFirst) {
      isFirst = false;
      continue;
    }

    // Parse the worktree path to get a short name
    const worktreePath = worktreeLine.slice('worktree '.length).trim();
    // Normalise Windows paths (forward slashes)
    const normPath = worktreePath.replace(/\\/g, '/');
    const name = normPath.split('/').pop() ?? worktreePath;

    const branch = branchLine
      ? branchLine.slice('branch refs/heads/'.length).trim()
      : '';

    worktrees.push({
      name,
      branch,
      behind: behindCounts[name] ?? 0,
      changedFiles: 0,
    });
  }

  return worktrees;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Runs git commands and assembles an ActivityDigest.
 */
export async function generateDigest(commitCount = 20): Promise<ActivityDigest> {
  // Current branch
  const branch = exec('git rev-parse --abbrev-ref HEAD').trim() || 'unknown';

  // Commits ahead of origin
  const aheadRaw = exec('git rev-list --count HEAD ^origin/HEAD').trim();
  const aheadOfOrigin = parseInt(aheadRaw, 10) || 0;

  // Uncommitted changes
  const statusRaw = exec('git status --porcelain');
  const uncommitted = parseGitStatus(statusRaw);

  // Recent commits (with file lists)
  const logRaw = exec(
    `git log "--format=%h %ar %s" --name-only -n ${commitCount}`,
  );
  const recentCommits = parseRecentCommits(logRaw);

  // Hot modules (30 days)
  const hotRaw = exec('git log --since=30.days --name-only --format=');
  const hotModules = parseHotModules(hotRaw);

  // Fill in lastTouched for each hot module
  for (const mod of hotModules) {
    const touched = exec(`git log -1 "--format=%ar" -- "${mod.path}"`).trim();
    mod.lastTouched = touched;
  }

  // Worktrees — collect behind counts and changed files per worktree
  const worktreeRaw = exec('git worktree list --porcelain');

  // Extract worktree paths (skip first/main) for git commands
  const wtBlocks = worktreeRaw.trim().split(/\n\n+/).slice(1); // skip main
  const behindCounts: Record<string, number> = {};
  const changedCounts: Record<string, number> = {};

  for (const block of wtBlocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const wtLine = lines.find(l => l.startsWith('worktree '));
    const branchLine = lines.find(l => l.startsWith('branch refs/heads/'));
    if (!wtLine) continue;

    const wtPath = wtLine.slice('worktree '.length).trim();
    const normPath = wtPath.replace(/\\/g, '/');
    const name = normPath.split('/').pop() ?? '';
    const branch = branchLine ? branchLine.slice('branch refs/heads/'.length).trim() : '';

    if (branch) {
      const behind = exec(`git rev-list --count "${branch}..develop"`).trim();
      behindCounts[name] = parseInt(behind, 10) || 0;
    }

    const wtStatus = exec(`git -C "${wtPath}" status --porcelain`).trim();
    changedCounts[name] = wtStatus ? wtStatus.split('\n').length : 0;
  }

  const worktrees = parseWorktrees(worktreeRaw, behindCounts);
  for (const wt of worktrees) {
    wt.changedFiles = changedCounts[wt.name] ?? 0;
  }

  return {
    branch,
    aheadOfOrigin,
    uncommitted,
    recentCommits,
    hotModules,
    worktrees,
    generated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Detect if this module is the entry point (ESM equivalent of require.main)
const isMain = (() => {
  try {
    // import.meta.url is file:///path/to/activity-digest.ts
    // process.argv[1] is the path passed to node/tsx
    const scriptUrl = new URL(import.meta.url);
    let scriptPath = scriptUrl.pathname.replace(/^\/([A-Z]:)/, '$1');
    // Normalise slashes
    scriptPath = scriptPath.replace(/\\/g, '/');
    const argv1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
    return argv1.endsWith(scriptPath) || argv1.includes('activity-digest');
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const commitsIdx = args.indexOf('--commits');
  const commitCount = commitsIdx !== -1 ? parseInt(args[commitsIdx + 1] ?? '20', 10) : 20;

  generateDigest(commitCount)
    .then(digest => {
      process.stdout.write(JSON.stringify(digest, null, 2) + '\n');
    })
    .catch(err => {
      console.error('activity-digest error:', err);
      process.exit(1);
    });
}
