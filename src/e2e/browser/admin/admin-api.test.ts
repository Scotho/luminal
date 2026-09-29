// src/e2e/browser/admin/admin-api.test.ts
// E2E tests: Admin API endpoints — verifies all key REST endpoints
// respond correctly without a browser. Tests the middleware layer.

import { describe, it, expect, beforeAll } from 'vitest';
import { preflight } from './helpers';

const BASE = 'http://localhost:5175';

describe('Admin API Endpoints', () => {
  beforeAll(async () => {
    const status = await preflight();
    if (!status.admin) throw new Error('Admin dashboard not running at localhost:5175');
  });

  // ── Exec Routes ──────────────────────────────────────────

  describe('Exec routes', () => {
    it('GET /__admin_exec/status returns agent status', async () => {
      const res = await fetch(`${BASE}/__admin_exec/status`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('agents');
      expect(Array.isArray(data.agents)).toBe(true);
    });

    it('GET /__admin_exec/services returns service health', async () => {
      const res = await fetch(`${BASE}/__admin_exec/services`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(typeof data).toBe('object');
    });

    it('GET /__admin_exec/agents returns agent list', async () => {
      const res = await fetch(`${BASE}/__admin_exec/agents`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
    });

    it('GET /__admin_exec/firebase-metrics responds', async () => {
      const res = await fetch(`${BASE}/__admin_exec/firebase-metrics`);
      expect(res.ok).toBe(true);
    });
  });

  // ── Specs Routes ─────────────────────────────────────────

  describe('Specs routes', () => {
    it('GET /__admin_specs returns spec list', async () => {
      const res = await fetch(`${BASE}/__admin_specs`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      // Each spec should have file, date, status
      const first = data[0];
      expect(first).toHaveProperty('file');
      expect(first).toHaveProperty('date');
      expect(first).toHaveProperty('status');
      expect(first).toHaveProperty('specNum');
    });

    it('GET /__admin_specs/read returns spec content', async () => {
      // Get the first spec filename
      const listRes = await fetch(`${BASE}/__admin_specs`);
      const specs = await listRes.json();
      if (specs.length > 0) {
        const res = await fetch(`${BASE}/__admin_specs/read?file=${encodeURIComponent(specs[0].file)}`);
        expect(res.ok).toBe(true);
        const data = await res.json();
        expect(data).toHaveProperty('content');
        expect(data.content.length).toBeGreaterThan(0);
      }
    });

    it('GET /__admin_specs/read rejects path traversal', async () => {
      const res = await fetch(`${BASE}/__admin_specs/read?file=../../../etc/passwd`);
      expect(res.ok).toBe(false);
    });
  });

  // ── Git Routes ───────────────────────────────────────────

  describe('Git routes', () => {
    it('GET /__admin_git/status returns branch info', async () => {
      const res = await fetch(`${BASE}/__admin_git/status`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('branch');
      expect(typeof data.branch).toBe('string');
    });

    it('GET /__admin_git/log returns commit history', async () => {
      const res = await fetch(`${BASE}/__admin_git/log?limit=3`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('commits');
      expect(Array.isArray(data.commits)).toBe(true);
      expect(data.commits.length).toBeGreaterThan(0);
      expect(data.commits[0]).toHaveProperty('subject');
    });

    it('GET /__admin_git/branches lists branches', async () => {
      const res = await fetch(`${BASE}/__admin_git/branches`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('branches');
      expect(Array.isArray(data.branches)).toBe(true);
    });

    it('GET /__admin_git/diff returns diff output', async () => {
      const res = await fetch(`${BASE}/__admin_git/diff`);
      expect(res.ok).toBe(true);
    });
  });

  // ── File System Routes ───────────────────────────────────

  describe('File system routes', () => {
    it('GET /__admin_fs/list returns directory listing', async () => {
      const res = await fetch(`${BASE}/__admin_fs/list?path=.`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      const names = data.map((e: { name: string }) => e.name);
      expect(names).toContain('src');
      expect(names).toContain('admin');
      expect(names).toContain('package.json');
    });

    it('GET /__admin_fs/read returns file contents', async () => {
      const res = await fetch(`${BASE}/__admin_fs/read?path=package.json`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('content');
    });

    it('GET /__admin_fs/list validates path', async () => {
      const res = await fetch(`${BASE}/__admin_fs/list?path=../../..`);
      // Should either reject or clamp to project root
      expect(res.status).toBeLessThan(500);
    });
  });

  // ── Data Files ───────────────────────────────────────────

  describe('Data file endpoints', () => {
    const dataFiles = [
      'tasks.json',
      'sessions.json',
      'counters.json',
    ];

    for (const file of dataFiles) {
      it(`GET /data/${file} is accessible`, async () => {
        const res = await fetch(`${BASE}/data/${file}`);
        expect(res.ok).toBe(true);
        const data = await res.json();
        expect(data).toBeTruthy();
      });
    }

    it('POST /__admin_save validates file parameter', async () => {
      const res = await fetch(`${BASE}/__admin_save?file=`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      // Should reject empty filename
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ── Ref System ───────────────────────────────────────────

  describe('Ref system', () => {
    it('POST /__admin_ref/next returns a valid ref', async () => {
      const res = await fetch(`${BASE}/__admin_ref/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'QA' }),
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('ref');
      expect(data.ref).toMatch(/^QA-\d+$/);
      expect(data).toHaveProperty('counter');
    });
  });

  // ── Session Routes ───────────────────────────────────────

  describe('Session routes', () => {
    let testSessionId: string | null = null;

    it('POST /__admin_session creates a session', async () => {
      const res = await fetch(`${BASE}/__admin_session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'QA: e2e test session',
          type: 'chore',
          status: 'active',
          section: 'current-stack',
          phases: ['test'],
          plan: 'Automated test session',
          refs: [],
        }),
      });
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('id');
      testSessionId = data.id;
    });

    it('GET /__admin_session?id=<id> retrieves the session', async () => {
      if (!testSessionId) return;
      const res = await fetch(`${BASE}/__admin_session?id=${testSessionId}`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.summary).toContain('QA');
    });

    it('POST /__admin_session/note adds a note', async () => {
      if (!testSessionId) return;
      const res = await fetch(`${BASE}/__admin_session/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: testSessionId, text: 'Automated e2e test note' }),
      });
      expect(res.ok).toBe(true);
    });

    it('PATCH /__admin_session/status updates status', async () => {
      if (!testSessionId) return;
      const res = await fetch(`${BASE}/__admin_session/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: testSessionId, status: 'done' }),
      });
      expect(res.ok).toBe(true);
    });
  });

  // ── Ollama Routes ────────────────────────────────────────

  describe('Ollama routes', () => {
    it('GET /__admin_ollama/status returns running state', async () => {
      const res = await fetch(`${BASE}/__admin_ollama/status`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toHaveProperty('running');
      expect(typeof data.running).toBe('boolean');
    });

    it('GET /__admin_ollama/config returns config', async () => {
      const res = await fetch(`${BASE}/__admin_ollama/config`);
      expect(res.ok).toBe(true);
    });
  });

  // ── Overseer Routes ──────────────────────────────────────

  describe('Overseer routes', () => {
    it('GET /__admin_overseer/config returns config', async () => {
      const res = await fetch(`${BASE}/__admin_overseer/config`);
      expect(res.ok).toBe(true);
    });

    it('GET /__admin_overseer/state returns state', async () => {
      const res = await fetch(`${BASE}/__admin_overseer/state`);
      expect(res.ok).toBe(true);
    });

    it('GET /__admin_overseer/orders returns orders', async () => {
      const res = await fetch(`${BASE}/__admin_overseer/orders`);
      expect(res.ok).toBe(true);
    });

    it('GET /__admin_overseer/log returns log data', async () => {
      const res = await fetch(`${BASE}/__admin_overseer/log`);
      expect(res.ok).toBe(true);
    });
  });

  // ── Commands ─────────────────────────────────────────────

  describe('Commands route', () => {
    it('GET /__admin_commands returns command registry', async () => {
      const res = await fetch(`${BASE}/__admin_commands?format=json`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data).toBeTruthy();
    });
  });
});
