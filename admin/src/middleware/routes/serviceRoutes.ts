// admin/src/middleware/routes/serviceRoutes.ts — Local service health + start/stop

import { spawn, type ChildProcess } from 'child_process';
import { createConnection } from 'net';
import type { IncomingMessage, ServerResponse } from 'http';
import { parseBody, ROOT } from '../processPlugin';
import { safeError } from './routeUtils';

// ── Service definitions ────────────────────────────────────

interface ServiceDef {
  name: string;
  port: number;
  group: 'emulators' | 'dev';
}

const SERVICES: ServiceDef[] = [
  { name: 'auth',       port: 9099, group: 'emulators' },
  { name: 'rtdb',       port: 9000, group: 'emulators' },
  { name: 'firestore',  port: 8080, group: 'emulators' },
  { name: 'vite',       port: 5173, group: 'dev' },
  { name: 'preview',    port: 5174, group: 'dev' },
  { name: 'admin-cold', port: 5176, group: 'dev' },
];

// ── Port probing ───────────────────────────────────────────

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: 'localhost' });
    socket.setTimeout(1500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

// ── Port killing ───────────────────────────────────────────

function killPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn('npx kill-port ' + String(port), [], {
      shell: true,
      cwd: ROOT,
      stdio: 'ignore',
    });
    const timer = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } resolve(); }, 5000);
    proc.on('close', () => { clearTimeout(timer); resolve(); });
  });
}

// ── Managed child processes ────────────────────────────────

const _managed = new Map<string, ChildProcess>();

function spawnDetached(label: string, command: string, env?: Record<string, string>): void {
  const existing = _managed.get(label);
  if (existing) {
    try { existing.kill('SIGTERM'); } catch { /* already dead */ }
  }
  const proc = spawn(command, [], {
    shell: true,
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, ...env },
  });
  proc.unref();
  proc.on('exit', () => _managed.delete(label));
  _managed.set(label, proc);
}

// ── Routes ─────────────────────────────────────────────────

export async function serviceRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url) return false;

  // ── GET /__admin_exec/services ──────────────────────
  if (method === 'GET' && url === '/__admin_exec/services') {
    const results = await Promise.all(
      SERVICES.map(async (s) => ({
        name: s.name,
        port: s.port,
        group: s.group,
        up: await checkPort(s.port),
      })),
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ services: results }));
    return true;
  }

  // ── POST /__admin_exec/service/start ────────────────
  if (method === 'POST' && url === '/__admin_exec/service/start') {
    try {
      const body = await parseBody(req);
      const target = String(body['service'] ?? '');

      switch (target) {
        case 'emulators':
          await Promise.all([killPort(9099), killPort(9000), killPort(8080)]);
          spawnDetached(
            'emulators',
            'npx firebase emulators:start --only auth,database,firestore --project luminal-game',
          );
          break;

        case 'vite':
          await killPort(5173);
          spawnDetached('vite', 'npx vite --port 5173 --strictPort');
          break;

        case 'preview':
          await killPort(5174);
          spawnDetached(
            'preview',
            'npx vite build && npx vite preview --port 5174 --strictPort',
          );
          break;

        case 'admin-cold':
          await killPort(5176);
          spawnDetached(
            'admin-cold',
            'npx vite build --config admin/vite.config.ts && npx vite preview --config admin/vite.config.ts --port 5176 --strictPort',
          );
          break;

        default:
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown service: ${target}` }));
          return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, started: target }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_exec/service/stop ─────────────────
  if (method === 'POST' && url === '/__admin_exec/service/stop') {
    try {
      const body = await parseBody(req);
      const target = String(body['service'] ?? '');

      const portMap: Record<string, number[]> = {
        emulators: [9099, 9000, 8080],
        vite: [5173],
        preview: [5174],
        'admin-cold': [5176],
      };

      const ports = portMap[target];
      if (!ports) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Unknown service: ${target}` }));
        return true;
      }

      // Kill managed process if we own it
      const managed = _managed.get(target);
      if (managed) {
        try { managed.kill('SIGTERM'); } catch { /* gone */ }
        _managed.delete(target);
      }

      // Kill by port as fallback (handles externally-started processes)
      await Promise.all(ports.map(killPort));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, stopped: target }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_exec/service/rebuild ──────────────
  if (method === 'POST' && url === '/__admin_exec/service/rebuild') {
    try {
      const proc = spawn('npx vite build', [], {
        shell: true,
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const chunks: string[] = [];
      proc.stdout?.on('data', (d: Buffer) => chunks.push(d.toString()));
      proc.stderr?.on('data', (d: Buffer) => chunks.push(d.toString()));
      const timer = setTimeout(() => proc.kill('SIGTERM'), 60_000);
      proc.on('close', (code) => {
        clearTimeout(timer);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: code === 0, output: chunks.join('') }));
      });
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  return false;
}
