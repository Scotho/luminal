import { readFileSync, readdirSync, existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { ROOT } from '../processPlugin';
import { safeError } from './routeUtils';
import { ghFetchJSON } from './githubHelper';

async function ghToRes(ghPath: string, res: ServerResponse, cacheSec = 60): Promise<boolean> {
  const data = await ghFetchJSON(ghPath, cacheSec);
  if (data === null) {
    // No GITHUB_TOKEN or API error — return empty result instead of 500
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ workflow_runs: [], total_count: 0, items: [] }));
    return true;
  }
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': `max-age=${cacheSec}`,
  });
  res.end(JSON.stringify(data));
  return true;
}

/** Parse and validate a numeric query param. Returns null if invalid. */
function numericParam(url: string, name: string): string | null {
  const parsedUrl = new URL(url, 'http://localhost');
  const val = parsedUrl.searchParams.get(name) ?? '';
  return /^\d+$/.test(val) ? val : null;
}

// ── Route handler ─────────────────────────────────────────

export async function ciRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url) return false;

  // ── GET /__admin_ci/runs ────────────────────────
  if (method === 'GET' && url === '/__admin_ci/runs') {
    return ghToRes('actions/runs?per_page=20', res, 120);
  }

  // ── GET /__admin_ci/run?id=X ────────────────────
  if (method === 'GET' && url?.startsWith('/__admin_ci/run') && !url.startsWith('/__admin_ci/runs')) {
    const id = numericParam(url, 'id');
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing id (must be numeric)' }));
      return true;
    }
    return ghToRes(`actions/runs/${id}/jobs`, res, 60);
  }

  // ── GET /__admin_ci/branches ────────────────────
  if (method === 'GET' && url === '/__admin_ci/branches') {
    return ghToRes('branches?per_page=30', res, 300);
  }

  // ── GET /__admin_ci/pulls ───────────────────────
  if (method === 'GET' && url === '/__admin_ci/pulls') {
    return ghToRes('pulls?state=all&per_page=20&sort=updated&direction=desc', res, 60);
  }

  // ── GET /__admin_ci/pull/comments?number=X ──────
  if (method === 'GET' && url?.startsWith('/__admin_ci/pull/comments')) {
    const n = numericParam(url, 'number');
    if (!n) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing number (must be numeric)' }));
      return true;
    }
    return ghToRes(`pulls/${n}/comments?per_page=100`, res, 60);
  }

  // ── GET /__admin_ci/pull/reviews?number=X ───────
  if (method === 'GET' && url?.startsWith('/__admin_ci/pull/reviews')) {
    const n = numericParam(url, 'number');
    if (!n) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing number (must be numeric)' }));
      return true;
    }
    return ghToRes(`pulls/${n}/reviews?per_page=50`, res, 60);
  }

  // ── GET /__admin_ci/issue/comments?number=X ─────
  if (method === 'GET' && url?.startsWith('/__admin_ci/issue/comments')) {
    const n = numericParam(url, 'number');
    if (!n) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing number (must be numeric)' }));
      return true;
    }
    return ghToRes(`issues/${n}/comments?per_page=100`, res, 60);
  }

  // ── GET /__admin_specs ──────────────────────────
  if (method === 'GET' && url === '/__admin_specs') {
    try {
      const specsDir = resolve(ROOT, 'docs', 'superpowers', 'specs');
      if (!existsSync(specsDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return true;
      }
      const files = readdirSync(specsDir).filter(f => f.endsWith('.md'));
      const specs = files.map(f => {
        const content = readFileSync(resolve(specsDir, f), 'utf-8');
        const head = content.slice(0, 600);
        const date = head.match(/\*\*Date:\*\*\s*(.+)/)?.[1]?.trim() ?? '';
        const status = head.match(/\*\*Status:\*\*\s*(.+)/)?.[1]?.trim() ?? '';
        const specNum = f.match(/^SPEC-(\d+)/)?.[1];
        return { file: f, date, status, specNum: specNum ? parseInt(specNum, 10) : null };
      });
      // Sort: SPEC-N numerically first, then non-SPEC files by date descending
      specs.sort((a, b) => {
        if (a.specNum !== null && b.specNum !== null) return a.specNum - b.specNum;
        if (a.specNum !== null) return -1;
        if (b.specNum !== null) return 1;
        return b.file.localeCompare(a.file);
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(specs));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── DELETE /__admin_specs?file=X ───────────────
  if (method === 'DELETE' && url?.startsWith('/__admin_specs')) {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const file = parsedUrl.searchParams.get('file') ?? '';
      if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid filename' }));
        return true;
      }
      const filePath = resolve(ROOT, 'docs', 'superpowers', 'specs', file);
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return true;
      }
      unlinkSync(filePath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: file }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── GET /__admin_specs/read?file=X ──────────────
  if (method === 'GET' && url?.startsWith('/__admin_specs/read')) {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const file = parsedUrl.searchParams.get('file') ?? '';
      if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid filename' }));
        return true;
      }
      const filePath = resolve(ROOT, 'docs', 'superpowers', 'specs', file);
      if (!existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return true;
      }
      const content = readFileSync(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ file, content }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  return false;
}
