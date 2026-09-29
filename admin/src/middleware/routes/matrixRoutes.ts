import type { IncomingMessage, ServerResponse } from 'http';
import { parseBody, readJsonFile, writeJsonFile } from '../processPlugin';
import { safeError } from './routeUtils';

export async function matrixRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url) return false;

  // ── GET /__admin_e2e_matrix ──────────────────────
  if (method === 'GET' && new URL(url, 'http://localhost').pathname === '/__admin_e2e_matrix') {
    try {
      const data = await readJsonFile<{ tests: unknown[]; lastUpdated: string }>('e2e-matrix.json', { tests: [], lastUpdated: '' });
      let tests = data.tests ?? [];
      const parsedUrl = new URL(url, 'http://localhost');
      const statusFilter = parsedUrl.searchParams.get('status');
      const idFilter = parsedUrl.searchParams.get('id');
      const categoryFilter = parsedUrl.searchParams.get('category');

      if (statusFilter) {
        tests = tests.filter((t: any) => t.status === statusFilter);
      }
      if (idFilter) {
        const ids = new Set(idFilter.split(',').map(s => s.trim()));
        tests = tests.filter((t: any) => ids.has(t.id));
      }
      if (categoryFilter) {
        tests = tests.filter((t: any) => t.category === categoryFilter);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tests, lastUpdated: data.lastUpdated }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── PATCH /__admin_e2e_matrix ──────────────────────
  if (method === 'PATCH' && url === '/__admin_e2e_matrix') {
    try {
      const body = await parseBody(req);
      const id = String(body['id'] ?? '');
      interface MatrixEntry { id: string; status?: string; notes?: string; lastRun?: string; lastResult?: string }
      interface MatrixData { tests: MatrixEntry[]; lastUpdated: string }
      const data = await readJsonFile<MatrixData>('e2e-matrix.json', { tests: [], lastUpdated: '' });
      const entry = data.tests.find((t: MatrixEntry) => t.id === id);
      if (!entry) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Test ${id} not found in matrix` }));
        return true;
      }
      if (body['status']) entry.status = String(body['status']);
      if (body['notes'] !== undefined) entry.notes = String(body['notes']);
      if (body['lastRun']) entry.lastRun = String(body['lastRun']);
      if (body['lastResult']) entry.lastResult = String(body['lastResult']);
      data.lastUpdated = new Date().toISOString();
      await writeJsonFile('e2e-matrix.json', data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, entry }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_e2e_matrix/batch-update ───────
  if (method === 'POST' && url === '/__admin_e2e_matrix/batch-update') {
    try {
      const body = await parseBody(req);
      const updates = body['updates'] as Array<{ id: string; [key: string]: unknown }>;
      if (!Array.isArray(updates)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'updates must be an array' }));
        return true;
      }
      const data = await readJsonFile<{ tests: unknown[]; lastUpdated: string }>('e2e-matrix.json', { tests: [], lastUpdated: '' });
      const tests = data.tests as Array<Record<string, unknown>>;
      let updated = 0;
      for (const update of updates) {
        const entry = tests.find((t: any) => t.id === update.id);
        if (entry) {
          Object.assign(entry, update);
          updated++;
        }
      }
      data.lastUpdated = new Date().toISOString();
      await writeJsonFile('e2e-matrix.json', data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, updated }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_e2e_matrix/scan ──────────────────
  if (method === 'POST' && url === '/__admin_e2e_matrix/scan') {
    try {
      const { execSync } = await import('child_process');
      interface MatrixEntry { id: string; name: string; file: string; status: string }
      interface MatrixData { tests: MatrixEntry[]; lastUpdated: string }
      const data = await readJsonFile<MatrixData>('e2e-matrix.json', { tests: [], lastUpdated: '' });

      // Check which test files exist
      for (const entry of data.tests) {
        try {
          const fileCheck = execSync(`test -f "${entry.file}" && echo "exists" || echo "missing"`, { encoding: 'utf-8', cwd: process.cwd() }).trim();
          if (fileCheck === 'exists' && (entry.status === 'planned' || entry.status === 'infra-needed')) {
            // Check if the test ID or name appears in the file
            const content = execSync(`cat "${entry.file}"`, { encoding: 'utf-8', cwd: process.cwd() });
            if (content.includes(entry.id) || content.includes(entry.name)) {
              entry.status = 'implemented';
            }
          }
        } catch {
          // File doesn't exist or can't be read — keep current status
        }
      }

      data.lastUpdated = new Date().toISOString();
      await writeJsonFile('e2e-matrix.json', data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, scanned: data.tests.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  return false;
}
