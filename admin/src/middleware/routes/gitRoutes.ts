// admin/src/middleware/routes/gitRoutes.ts — Git operations for unified git environment

import { spawn } from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';
import { parseBody, ROOT } from '../processPlugin';
import { json, param, hasTraversal, safeError } from './routeUtils';

const TIMEOUT_GIT = 30_000;
const SHA_RE = /^[0-9a-f]{4,40}$/;
const BRANCH_RE = /^[a-zA-Z0-9_./-]+$/;

// ── Helpers ───────────────────────────────────────────────

function git(args: string[], timeout = TIMEOUT_GIT): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, {
      cwd: ROOT,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', FORCE_COLOR: '0' },
    });
    const out: string[] = [];
    const err: string[] = [];
    proc.stdout?.on('data', (d: Buffer) => out.push(d.toString()));
    proc.stderr?.on('data', (d: Buffer) => err.push(d.toString()));
    const timer = setTimeout(() => proc.kill('SIGTERM'), timeout);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: out.join(''), stderr: err.join('') });
    });
  });
}

// ── Parse porcelain v2 status ─────────────────────────────

interface GitStatus {
  branch: string;
  oid: string;
  ahead: number;
  behind: number;
  staged: { path: string; status: string }[];
  unstaged: { path: string; status: string }[];
  untracked: string[];
  conflicts: string[];
  stashCount: number;
}

function parseStatusV2(raw: string): Omit<GitStatus, 'stashCount'> {
  const lines = raw.split('\n');
  let branch = '';
  let oid = '';
  let ahead = 0;
  let behind = 0;
  const staged: { path: string; status: string }[] = [];
  const unstaged: { path: string; status: string }[] = [];
  const untracked: string[] = [];
  const conflicts: string[] = [];

  for (const line of lines) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length);
    } else if (line.startsWith('# branch.oid ')) {
      oid = line.slice('# branch.oid '.length);
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { ahead = parseInt(m[1], 10); behind = parseInt(m[2], 10); }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // Changed entry: "1 XY sub mH mI mW hH hI path" or "2 XY sub mH mI mW hH hI X\tscore\tpath\torigPath"
      const xy = line.slice(2, 4);
      const x = xy[0];
      const y = xy[1];
      // Path is last space-delimited field for type 1, tab-delimited for type 2
      let path: string;
      if (line.startsWith('2 ')) {
        const tabParts = line.split('\t');
        path = tabParts[tabParts.length - 2] ?? tabParts[tabParts.length - 1] ?? '';
      } else {
        const parts = line.split(' ');
        path = parts[parts.length - 1] ?? '';
      }
      if (x !== '.' && x !== '?') staged.push({ path, status: x });
      if (y !== '.' && y !== '?') unstaged.push({ path, status: y });
    } else if (line.startsWith('u ')) {
      // Unmerged entry — conflict
      const parts = line.split(' ');
      conflicts.push(parts[parts.length - 1] ?? '');
    } else if (line.startsWith('? ')) {
      untracked.push(line.slice(2));
    }
  }

  return { branch, oid, ahead, behind, staged, unstaged, untracked, conflicts };
}

// ── Parse log format ──────────────────────────────────────

interface GitCommit {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  body: string;
  refs: string;
}

const LOG_SEP = '@@GIT_SEP@@';
const LOG_REC = '@@GIT_REC@@';
const LOG_FORMAT = [
  '%H', '%h', '%an', '%ae', '%aI', '%s', '%b', '%D',
].join(LOG_SEP);

function parseLog(raw: string): GitCommit[] {
  if (!raw.trim()) return [];
  return raw.trim().split(LOG_REC).filter(Boolean).map((entry) => {
    const parts = entry.split(LOG_SEP);
    return {
      sha: parts[0] ?? '',
      shortSha: parts[1] ?? '',
      author: parts[2] ?? '',
      email: parts[3] ?? '',
      date: parts[4] ?? '',
      subject: parts[5] ?? '',
      body: (parts[6] ?? '').trim(),
      refs: parts[7] ?? '',
    };
  });
}

// ── Parse branch list ─────────────────────────────────────

interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  upstream: string;
  ahead: number;
  behind: number;
  lastCommit: string;
}

function parseBranches(raw: string): GitBranch[] {
  if (!raw.trim()) return [];
  return raw.trim().split('\n').filter(Boolean).map((line) => {
    // Format: HEAD|refname:short|upstream:short|upstream:track|authordate:relative
    const parts = line.split('|');
    const head = parts[0] ?? '';
    const name = parts[1] ?? '';
    const upstream = parts[2] ?? '';
    const track = parts[3] ?? '';
    const lastCommit = parts[4] ?? '';
    const current = head === '*';
    const remote = name.startsWith('remotes/') || name.startsWith('origin/');

    let ahead = 0;
    let behind = 0;
    const aheadMatch = track.match(/ahead (\d+)/);
    const behindMatch = track.match(/behind (\d+)/);
    if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
    if (behindMatch) behind = parseInt(behindMatch[1], 10);

    return { name, current, remote, upstream, ahead, behind, lastCommit };
  });
}

// ── Route handler ─────────────────────────────────────────

export async function gitRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url?.startsWith('/__admin_git/')) return false;

  const path = url.split('?')[0];

  // ── GET /__admin_git/status ───────────────────────
  if (method === 'GET' && path === '/__admin_git/status') {
    const result = await git(['status', '--porcelain=v2', '--branch']);
    if (result.code !== 0) {
      json(res, 500, { error: result.stderr });
      return true;
    }
    const status = parseStatusV2(result.stdout);

    // Get stash count
    const stashResult = await git(['stash', 'list']);
    const stashCount = stashResult.stdout.trim()
      ? stashResult.stdout.trim().split('\n').length
      : 0;

    json(res, 200, { ...status, stashCount } satisfies GitStatus);
    return true;
  }

  // ── GET /__admin_git/diff ─────────────────────────
  if (method === 'GET' && path === '/__admin_git/diff') {
    const staged = param(url, 'staged') === 'true';
    const file = param(url, 'file');
    if (file && hasTraversal(file)) {
      json(res, 400, { error: 'Invalid file path' });
      return true;
    }
    const args = ['diff', '--no-color'];
    if (staged) args.push('--cached');
    if (file) args.push('--', file);
    const result = await git(args);
    json(res, 200, { diff: result.stdout });
    return true;
  }

  // ── GET /__admin_git/diff-branch ──────────────────
  if (method === 'GET' && path === '/__admin_git/diff-branch') {
    const base = param(url, 'base') || 'main';
    if (!BRANCH_RE.test(base)) {
      json(res, 400, { error: 'Invalid base branch name' });
      return true;
    }
    const result = await git(['diff', '--no-color', `${base}...HEAD`]);
    json(res, 200, { diff: result.stdout, base });
    return true;
  }

  // ── GET /__admin_git/log ──────────────────────────
  if (method === 'GET' && path === '/__admin_git/log') {
    const limit = parseInt(param(url, 'limit') || '50', 10);
    const branch = param(url, 'branch');
    const all = param(url, 'all') === 'true';

    if (branch && !BRANCH_RE.test(branch)) {
      json(res, 400, { error: 'Invalid branch name' });
      return true;
    }

    const safeLimit = Math.min(Math.max(1, limit), 500);
    const args = ['log', `--format=${LOG_REC}${LOG_FORMAT}`, `-${safeLimit}`];
    if (all) args.push('--all');
    if (branch) args.push(branch);

    const result = await git(args);
    const commits = parseLog(result.stdout);

    // Also get graph text for visual rendering
    const graphArgs = ['log', '--oneline', '--graph', `--decorate`, `-${safeLimit}`];
    if (all) graphArgs.push('--all');
    if (branch) graphArgs.push(branch);
    const graphResult = await git(graphArgs);

    json(res, 200, { commits, graph: graphResult.stdout });
    return true;
  }

  // ── GET /__admin_git/branches ─────────────────────
  if (method === 'GET' && path === '/__admin_git/branches') {
    const fmt = '%(HEAD)|%(refname:short)|%(upstream:short)|%(upstream:track)|%(authordate:relative)';
    const result = await git(['branch', '-a', `--format=${fmt}`]);
    if (result.code !== 0) {
      json(res, 500, { error: result.stderr });
      return true;
    }
    const branches = parseBranches(result.stdout);
    json(res, 200, { branches });
    return true;
  }

  // ── GET /__admin_git/show ─────────────────────────
  if (method === 'GET' && path === '/__admin_git/show') {
    const sha = param(url, 'sha');
    if (!sha || !SHA_RE.test(sha)) {
      json(res, 400, { error: 'Invalid or missing sha (hex, 4-40 chars)' });
      return true;
    }
    const result = await git(['show', '--no-color', '--stat', '--patch', sha]);
    if (result.code !== 0) {
      json(res, 500, { error: result.stderr });
      return true;
    }
    json(res, 200, { sha, detail: result.stdout });
    return true;
  }

  // ── GET /__admin_git/blame ────────────────────────
  if (method === 'GET' && path === '/__admin_git/blame') {
    const file = param(url, 'file');
    if (!file || hasTraversal(file)) {
      json(res, 400, { error: 'Invalid or missing file path' });
      return true;
    }
    const result = await git(['blame', '--porcelain', file]);
    if (result.code !== 0) {
      json(res, 500, { error: result.stderr });
      return true;
    }
    json(res, 200, { file, blame: result.stdout });
    return true;
  }

  // ── GET /__admin_git/conflicts ────────────────────
  if (method === 'GET' && path === '/__admin_git/conflicts') {
    const result = await git(['diff', '--name-only', '--diff-filter=U']);
    const files = result.stdout.trim() ? result.stdout.trim().split('\n') : [];
    json(res, 200, { files });
    return true;
  }

  // ── POST /__admin_git/stage ───────────────────────
  if (method === 'POST' && path === '/__admin_git/stage') {
    try {
      const body = await parseBody(req);
      const all = body['all'] === true;
      const files = Array.isArray(body['files']) ? (body['files'] as string[]) : [];

      if (!all && files.length === 0) {
        json(res, 400, { error: 'Provide { files: [...] } or { all: true }' });
        return true;
      }
      if (!all && files.some((f) => hasTraversal(String(f)))) {
        json(res, 400, { error: 'Invalid file path' });
        return true;
      }

      const args = all ? ['add', '-A'] : ['add', '--', ...files.map(String)];
      const result = await git(args);
      json(res, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        error: result.code !== 0 ? result.stderr : undefined,
      });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_git/unstage ─────────────────────
  if (method === 'POST' && path === '/__admin_git/unstage') {
    try {
      const body = await parseBody(req);
      const all = body['all'] === true;
      const files = Array.isArray(body['files']) ? (body['files'] as string[]) : [];

      if (!all && files.length === 0) {
        json(res, 400, { error: 'Provide { files: [...] } or { all: true }' });
        return true;
      }
      if (!all && files.some((f) => hasTraversal(String(f)))) {
        json(res, 400, { error: 'Invalid file path' });
        return true;
      }

      const args = all
        ? ['restore', '--staged', '.']
        : ['restore', '--staged', '--', ...files.map(String)];
      const result = await git(args);
      json(res, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        error: result.code !== 0 ? result.stderr : undefined,
      });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_git/commit ──────────────────────
  if (method === 'POST' && path === '/__admin_git/commit') {
    try {
      const body = await parseBody(req);
      const message = String(body['message'] ?? '');
      if (!message) {
        json(res, 400, { error: 'Missing commit message' });
        return true;
      }
      const result = await git(['commit', '-m', message]);
      json(res, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        output: result.stdout + result.stderr,
      });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_git/push ────────────────────────
  if (method === 'POST' && path === '/__admin_git/push') {
    try {
      const body = await parseBody(req);
      const setUpstream = body['setUpstream'] === true;
      const args = ['push'];
      if (setUpstream) {
        // Get current branch to set upstream
        const branchResult = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
        const currentBranch = branchResult.stdout.trim();
        args.push('-u', 'origin', currentBranch);
      }
      const result = await git(args);
      json(res, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        output: result.stdout + result.stderr,
      });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_git/pull ────────────────────────
  if (method === 'POST' && path === '/__admin_git/pull') {
    try {
      const body = await parseBody(req);
      const rebase = body['rebase'] === true;
      const args = ['pull'];
      if (rebase) args.push('--rebase');
      const result = await git(args);
      json(res, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        output: result.stdout + result.stderr,
      });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_git/stash ───────────────────────
  if (method === 'POST' && path === '/__admin_git/stash') {
    try {
      const body = await parseBody(req);
      const action = String(body['action'] ?? '');
      const message = typeof body['message'] === 'string' ? body['message'] : undefined;
      const index = typeof body['index'] === 'number' ? body['index'] : undefined;

      const allowed = new Set(['push', 'pop', 'apply', 'drop', 'list']);
      if (!allowed.has(action)) {
        json(res, 400, { error: `Invalid stash action. Allowed: ${[...allowed].join(', ')}` });
        return true;
      }

      const args = ['stash', action];
      if (action === 'push' && message) args.push('-m', message);
      if (['pop', 'apply', 'drop'].includes(action) && index !== undefined) {
        args.push(`stash@{${index}}`);
      }

      const result = await git(args);
      json(res, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        output: result.stdout + result.stderr,
      });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_git/checkout ────────────────────
  if (method === 'POST' && path === '/__admin_git/checkout') {
    try {
      const body = await parseBody(req);
      const branch = String(body['branch'] ?? '');
      const create = body['create'] === true;
      const base = typeof body['base'] === 'string' ? body['base'] : undefined;

      if (!branch || !BRANCH_RE.test(branch)) {
        json(res, 400, { error: 'Invalid or missing branch name' });
        return true;
      }
      if (base && !BRANCH_RE.test(base)) {
        json(res, 400, { error: 'Invalid base branch name' });
        return true;
      }

      const args = ['checkout'];
      if (create) args.push('-b');
      args.push(branch);
      if (create && base) args.push(base);

      const result = await git(args);
      json(res, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        output: result.stdout + result.stderr,
      });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_git/merge ───────────────────────
  if (method === 'POST' && path === '/__admin_git/merge') {
    try {
      const body = await parseBody(req);
      const abort = body['abort'] === true;
      const branch = String(body['branch'] ?? '');

      if (abort) {
        const result = await git(['merge', '--abort']);
        json(res, result.code === 0 ? 200 : 500, {
          ok: result.code === 0,
          output: result.stdout + result.stderr,
        });
        return true;
      }

      if (!branch || !BRANCH_RE.test(branch)) {
        json(res, 400, { error: 'Invalid or missing branch name' });
        return true;
      }

      const result = await git(['merge', branch]);
      json(res, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        output: result.stdout + result.stderr,
      });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_git/create-pr ───────────────────
  if (method === 'POST' && path === '/__admin_git/create-pr') {
    try {
      const body = await parseBody(req);
      const title = String(body['title'] ?? '');
      const prBody = String(body['body'] ?? '');
      const base = String(body['base'] ?? 'main');
      const draft = body['draft'] === true;

      if (!title) {
        json(res, 400, { error: 'Missing PR title' });
        return true;
      }
      if (!BRANCH_RE.test(base)) {
        json(res, 400, { error: 'Invalid base branch name' });
        return true;
      }

      const args = ['pr', 'create', '--title', title, '--body', prBody, '--base', base];
      if (draft) args.push('--draft');

      // Use gh CLI instead of git
      const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        const proc = spawn('gh', args, {
          cwd: ROOT,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', FORCE_COLOR: '0' },
        });
        const out: string[] = [];
        const err: string[] = [];
        proc.stdout?.on('data', (d: Buffer) => out.push(d.toString()));
        proc.stderr?.on('data', (d: Buffer) => err.push(d.toString()));
        const timer = setTimeout(() => proc.kill('SIGTERM'), TIMEOUT_GIT);
        proc.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code: code ?? 1, stdout: out.join(''), stderr: err.join('') });
        });
      });

      json(res, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        url: result.stdout.trim(),
        output: result.stdout + result.stderr,
      });
    } catch (err) {
      json(res, 400, { error: safeError(err) });
    }
    return true;
  }

  return false;
}
