import { type Plugin } from 'vite';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'fs';
import type { IncomingMessage } from 'http';
import { execRoutes } from './routes/execRoutes';
import { dataRoutes } from './routes/dataRoutes';
import { ciRoutes } from './routes/ciRoutes';
import { pipelineRoutes } from './routes/pipelineRoutes';
import { deployRoutes } from './routes/deployRoutes';
import { flakinessRoutes } from './routes/flakinessRoutes';
import { ollamaRoutes } from './routes/ollamaRoutes';
import { serviceRoutes } from './routes/serviceRoutes';
import { overseerRoutes } from './routes/overseerRoutes';
import { gitRoutes } from './routes/gitRoutes';
import { fileRoutes } from './routes/fileRoutes';
import { perfRoutes } from './routes/perfRoutes';

// ── Path resolution ────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
// admin/src/middleware → admin/src → admin → repo root
export const ROOT = resolve(__dirname, '..', '..', '..');
export const ADMIN_DIR = resolve(ROOT, 'admin');
export const DATA_DIR = resolve(ADMIN_DIR, 'data');

// ── Load .env files if GITHUB_TOKEN not set ───────────────
// Check .env then .env.local (latter takes precedence, matching Vite convention)
if (!process.env.GITHUB_TOKEN) {
  for (const envFile of ['.env', '.env.local']) {
    try {
      const envContent = readFileSync(resolve(ROOT, envFile), 'utf-8');
      for (const line of envContent.split('\n')) {
        const match = line.match(/^([A-Z_]+)=(.+)$/);
        if (match) process.env[match[1]] = match[2].trim();
      }
    } catch { /* file not present */ }
  }
}

// ── Allowlists ─────────────────────────────────────────────
const ALLOWED_CONFIGS = new Set(['unit', 'e2e', 'browser', 'online', 'smoke', 'rules', 'admin', 'relay']);
const ALLOWED_SCRIPTS = new Set(['module-map', 'activity-digest', 'test-health', 'prune-sessions']);

const CONFIG_MAP: Record<string, string> = {
  unit: 'vitest.config.ts',
  e2e: 'vitest.e2e.config.ts',
  browser: 'vitest.browser.config.ts',
  online: 'vitest.online.config.ts',
  smoke: 'vitest.smoke.config.ts',
  rules: 'vitest.rules.config.ts',
  admin: 'admin/vitest.config.ts',
  relay: 'relay/vitest.config.ts',
};

// ── Timeouts (ms) ─────────────────────────────────────────
export const TIMEOUT_TEST = 5 * 60 * 1000;
export const TIMEOUT_CLAUDE = 30 * 60 * 1000;
export const TIMEOUT_SCRIPT = 30 * 1000;
export const TIMEOUT_AIDER = 20 * 60 * 1000;

// ── Pure helpers (exported for tests) ─────────────────────

export function isAllowedConfig(config: string): boolean {
  return ALLOWED_CONFIGS.has(config);
}

export function isAllowedScript(name: string): boolean {
  return ALLOWED_SCRIPTS.has(name);
}

export function resolveCommand(
  type: string,
  params: Record<string, string>,
): string | null {
  switch (type) {
    case 'test': {
      const config = params['config'] ?? '';
      if (!isAllowedConfig(config)) return null;
      return `npx vitest run --config ${CONFIG_MAP[config]} --reporter=verbose --reporter=json`;
    }
    case 'script': {
      const name = params['name'] ?? '';
      if (!isAllowedScript(name)) return null;
      return `npx tsx admin/scripts/${name}.ts`;
    }
    default:
      return null;
  }
}

export function formatSSE(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── Data helpers (used by route modules) ──────────────────

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function readJsonFile<T>(filename: string, fallback: T): T {
  ensureDataDir();
  const filepath = resolve(DATA_DIR, filename);
  if (!existsSync(filepath)) return fallback;
  try {
    return JSON.parse(readFileSync(filepath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(filename: string, data: unknown): void {
  ensureDataDir();
  writeFileSync(resolve(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
}

// ── Body parsing ───────────────────────────────────────────

export function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ── Plugin ─────────────────────────────────────────────────

export function processPlugin(): Plugin {
  return {
    name: 'admin-process',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (await execRoutes(req, res)) return;
        if (await serviceRoutes(req, res)) return;
        if (await gitRoutes(req, res)) return;
        if (await dataRoutes(req, res)) return;
        if (await ciRoutes(req, res)) return;
        if (await pipelineRoutes(req, res)) return;
        if (await deployRoutes(req, res)) return;
        if (await flakinessRoutes(req, res)) return;
        if (await ollamaRoutes(req, res)) return;
        if (await overseerRoutes(req, res)) return;
        if (await fileRoutes(req, res)) return;
        if (await perfRoutes(req, res)) return;
        next();
      });
    },
  };
}
