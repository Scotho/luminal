import { resolve, extname } from 'path';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
  copyFileSync,
  mkdirSync,
  statSync,
  existsSync,
} from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { ROOT, parseBody } from '../processPlugin';
import { json, safeError } from './routeUtils';

// ── Types ──────────────────────────────────────────────────

interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtime: number;
  extension: string;
}

// ── Helpers ────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.html', '.css',
  '.txt', '.yml', '.yaml', '.sh', '.env', '.toml', '.xml', '.svg', '.sql',
]);

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', '.worktrees']);

const MAX_TEXT_SIZE = 1024 * 1024; // 1 MB

function safeguard(rawPath: string): string | null {
  const resolved = resolve(ROOT, rawPath.replace(/\\/g, '/'));
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

function relativePath(absPath: string): string {
  return absPath.slice(ROOT.length + 1).replace(/\\/g, '/');
}

// ── Route handler ──────────────────────────────────────────

export async function fileRoutes(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const { method, url } = req;
  if (!url?.startsWith('/__admin_fs/')) return false;

  // ── GET /__admin_fs/list?path=<dir> ───────────────────
  if (method === 'GET' && url.startsWith('/__admin_fs/list')) {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const rawPath = parsedUrl.searchParams.get('path') ?? '.';
      const dirPath = safeguard(rawPath);
      if (!dirPath) { json(res, 403, { error: 'Path outside project root' }); return true; }
      if (!existsSync(dirPath)) { json(res, 404, { error: 'Directory not found' }); return true; }

      const entries: FsEntry[] = [];
      for (const name of readdirSync(dirPath)) {
        if (EXCLUDED_DIRS.has(name)) continue;
        const abs = resolve(dirPath, name);
        try {
          const stat = statSync(abs);
          entries.push({
            name,
            path: relativePath(abs),
            type: stat.isDirectory() ? 'directory' : 'file',
            size: stat.isDirectory() ? 0 : stat.size,
            mtime: stat.mtimeMs,
            extension: stat.isDirectory() ? '' : extname(name),
          });
        } catch {
          // skip entries we can't stat (broken symlinks, etc.)
        }
      }

      // directories first, then alphabetical
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      json(res, 200, entries);
    } catch (err) {
      json(res, 500, { error: safeError(err) });
    }
    return true;
  }

  // ── GET /__admin_fs/read?path=<file> ──────────────────
  if (method === 'GET' && url.startsWith('/__admin_fs/read')) {
    try {
      const parsedUrl = new URL(url, 'http://localhost');
      const rawPath = parsedUrl.searchParams.get('path') ?? '';
      if (!rawPath) { json(res, 400, { error: 'Missing path' }); return true; }
      const filePath = safeguard(rawPath);
      if (!filePath) { json(res, 403, { error: 'Path outside project root' }); return true; }
      if (!existsSync(filePath)) { json(res, 404, { error: 'File not found' }); return true; }

      const stat = statSync(filePath);
      const ext = extname(filePath).toLowerCase();
      const isText = TEXT_EXTENSIONS.has(ext) && stat.size <= MAX_TEXT_SIZE;

      if (isText) {
        const content = readFileSync(filePath, 'utf-8');
        json(res, 200, { content, size: stat.size, mtime: stat.mtimeMs, encoding: 'utf-8' });
      } else {
        json(res, 200, { content: null, size: stat.size, mtime: stat.mtimeMs, encoding: 'binary' });
      }
    } catch (err) {
      json(res, 500, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_fs/write ────────────────────────────
  if (method === 'POST' && url.startsWith('/__admin_fs/write')) {
    try {
      const body = await parseBody(req);
      const rawPath = body['path'];
      const content = body['content'];
      if (typeof rawPath !== 'string' || typeof content !== 'string') {
        json(res, 400, { error: 'Missing path or content' }); return true;
      }
      const filePath = safeguard(rawPath);
      if (!filePath) { json(res, 403, { error: 'Path outside project root' }); return true; }

      const dir = resolve(filePath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, content, 'utf-8');

      const stat = statSync(filePath);
      json(res, 200, { ok: true, size: stat.size, mtime: stat.mtimeMs });
    } catch (err) {
      json(res, 500, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_fs/rename ───────────────────────────
  if (method === 'POST' && url.startsWith('/__admin_fs/rename')) {
    try {
      const body = await parseBody(req);
      const rawOld = body['oldPath'];
      const rawNew = body['newPath'];
      if (typeof rawOld !== 'string' || typeof rawNew !== 'string') {
        json(res, 400, { error: 'Missing oldPath or newPath' }); return true;
      }
      const oldPath = safeguard(rawOld);
      const newPath = safeguard(rawNew);
      if (!oldPath || !newPath) { json(res, 403, { error: 'Path outside project root' }); return true; }
      if (!existsSync(oldPath)) { json(res, 404, { error: 'Source not found' }); return true; }

      const destDir = resolve(newPath, '..');
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      renameSync(oldPath, newPath);

      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 500, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_fs/delete ───────────────────────────
  if (method === 'POST' && url.startsWith('/__admin_fs/delete')) {
    try {
      const body = await parseBody(req);
      const rawPath = body['path'];
      if (typeof rawPath !== 'string') { json(res, 400, { error: 'Missing path' }); return true; }
      const targetPath = safeguard(rawPath);
      if (!targetPath) { json(res, 403, { error: 'Path outside project root' }); return true; }
      if (!existsSync(targetPath)) { json(res, 404, { error: 'Not found' }); return true; }

      const stat = statSync(targetPath);
      if (stat.isDirectory()) {
        rmdirSync(targetPath);
      } else {
        unlinkSync(targetPath);
      }

      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 500, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_fs/copy ─────────────────────────────
  if (method === 'POST' && url.startsWith('/__admin_fs/copy')) {
    try {
      const body = await parseBody(req);
      const rawSrc = body['src'];
      const rawDest = body['dest'];
      if (typeof rawSrc !== 'string' || typeof rawDest !== 'string') {
        json(res, 400, { error: 'Missing src or dest' }); return true;
      }
      const srcPath = safeguard(rawSrc);
      const destPath = safeguard(rawDest);
      if (!srcPath || !destPath) { json(res, 403, { error: 'Path outside project root' }); return true; }
      if (!existsSync(srcPath)) { json(res, 404, { error: 'Source not found' }); return true; }

      const destDir = resolve(destPath, '..');
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      copyFileSync(srcPath, destPath);

      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 500, { error: safeError(err) });
    }
    return true;
  }

  // ── POST /__admin_fs/mkdir ────────────────────────────
  if (method === 'POST' && url.startsWith('/__admin_fs/mkdir')) {
    try {
      const body = await parseBody(req);
      const rawPath = body['path'];
      if (typeof rawPath !== 'string') { json(res, 400, { error: 'Missing path' }); return true; }
      const dirPath = safeguard(rawPath);
      if (!dirPath) { json(res, 403, { error: 'Path outside project root' }); return true; }

      mkdirSync(dirPath, { recursive: true });
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 500, { error: safeError(err) });
    }
    return true;
  }

  return false;
}
