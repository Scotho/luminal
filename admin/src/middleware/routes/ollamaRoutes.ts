import { spawn, type ChildProcess } from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';
import type { OllamaConfig } from '../../ollamaTypes';
import { parseBody, formatSSE, readJsonFile, writeJsonFile } from '../processPlugin';
import { safeError } from './routeUtils';

// ── Constants ──────────────────────────────────────────────
const OLLAMA_BASE = 'http://localhost:11434';

const DEFAULT_CONFIG: OllamaConfig = {
  roles: {},
  defaultModel: null,
  presets: [],
  serverAutoStart: false,
};

// ── Module state ───────────────────────────────────────────
let _ollamaProc: ChildProcess | null = null;

// ── Helpers ────────────────────────────────────────────────

async function ollamaFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${OLLAMA_BASE}${path}`, options);
}

/** Wait up to maxMs for Ollama to respond on GET /. */
async function waitForOllama(maxMs = 5000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${OLLAMA_BASE}/`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

/** Resolve which model to use for a chat request. */
async function resolveModel(
  bodyModel: unknown,
  config: OllamaConfig,
): Promise<string | null> {
  // 1. Explicit model in request body
  if (typeof bodyModel === 'string' && bodyModel.trim()) return bodyModel.trim();

  // 2. Model with 'primary' role in config
  const primary = Object.entries(config.roles).find(([, role]) => role === 'primary');
  if (primary) return primary[0];

  // 3. defaultModel from config
  if (config.defaultModel) return config.defaultModel;

  // 4. First installed model
  try {
    const res = await ollamaFetch('/api/tags');
    if (res.ok) {
      const data = await res.json() as { models?: Array<{ name: string }> };
      if (data.models && data.models.length > 0) return data.models[0].name;
    }
  } catch {
    // Ollama not running
  }

  return null;
}

// ── Route handler ──────────────────────────────────────────

export async function ollamaRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const { method, url } = req;
  if (!url) return false;

  // ── GET /__admin_ollama/status ──────────────────────────
  if (method === 'GET' && url === '/__admin_ollama/status') {
    const config = readJsonFile<OllamaConfig>('ollama-config.json', DEFAULT_CONFIG);

    const [rootRes, versionRes, psRes] = await Promise.allSettled([
      ollamaFetch('/'),
      ollamaFetch('/api/version'),
      ollamaFetch('/api/ps'),
    ]);

    const running = rootRes.status === 'fulfilled' && rootRes.value.ok;
    let version: string | null = null;
    let loaded: unknown[] = [];

    if (versionRes.status === 'fulfilled' && versionRes.value.ok) {
      try {
        const data = await versionRes.value.json() as { version?: string };
        version = data.version ?? null;
      } catch { /* Ollama version response unparseable — non-critical */ }
    }

    if (psRes.status === 'fulfilled' && psRes.value.ok) {
      try {
        const data = await psRes.value.json() as { models?: unknown[] };
        loaded = data.models ?? [];
      } catch { /* Ollama model list response unparseable — non-critical */ }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ running, version, loaded, config }));
    return true;
  }

  // ── GET /__admin_ollama/models ──────────────────────────
  if (method === 'GET' && url === '/__admin_ollama/models') {
    try {
      const upstream = await ollamaFetch('/api/tags');
      const data = await upstream.json();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ollama not reachable', detail: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_ollama/pull (SSE) ─────────────────────
  if (method === 'POST' && url === '/__admin_ollama/pull') {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      const upstream = await ollamaFetch('/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: body['name'], stream: true }),
      });

      const reader = upstream.body?.getReader();
      if (!reader) {
        res.write(formatSSE('error', { error: 'No response body from Ollama' }));
        res.end();
        return true;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            res.write(formatSSE('progress', parsed));
          } catch { /* skip malformed lines */ }
        }
      }

      // Flush any remaining buffer content
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          res.write(formatSSE('progress', parsed));
        } catch { /* skip */ }
      }

      res.write(formatSSE('done', { ok: true }));
    } catch (err) {
      res.write(formatSSE('error', { error: safeError(err) }));
    }

    res.end();
    return true;
  }

  // ── DELETE /__admin_ollama/model ────────────────────────
  if (method === 'DELETE' && url === '/__admin_ollama/model') {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }

    try {
      const upstream = await ollamaFetch('/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: body['name'] }),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errText }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ollama not reachable', detail: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_ollama/show ───────────────────────────
  if (method === 'POST' && url === '/__admin_ollama/show') {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }

    try {
      const upstream = await ollamaFetch('/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: body['name'] }),
      });
      const data = await upstream.json();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ollama not reachable', detail: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_ollama/load ───────────────────────────
  // body: { model: string, unload?: boolean }
  if (method === 'POST' && url === '/__admin_ollama/load') {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }

    const model = String(body['model'] ?? '');
    if (!model) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'model is required' }));
      return true;
    }

    const keepAlive = body['unload'] ? 0 : '10m';

    try {
      const upstream = await ollamaFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [], keep_alive: keepAlive, stream: false }),
      });
      const data = await upstream.json();
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: upstream.ok, ...data }));
    } catch (err) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ollama not reachable', detail: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_ollama/config ─────────────────────────
  if (method === 'POST' && url === '/__admin_ollama/config') {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }

    const existing = readJsonFile<OllamaConfig>('ollama-config.json', DEFAULT_CONFIG);
    const updated: OllamaConfig = {
      ...existing,
      ...(body['roles'] !== undefined ? { roles: body['roles'] as OllamaConfig['roles'] } : {}),
      ...(body['defaultModel'] !== undefined ? { defaultModel: body['defaultModel'] as string | null } : {}),
      ...(body['presets'] !== undefined ? { presets: body['presets'] as OllamaConfig['presets'] } : {}),
      ...(body['serverAutoStart'] !== undefined ? { serverAutoStart: Boolean(body['serverAutoStart']) } : {}),
    };
    writeJsonFile('ollama-config.json', updated);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, config: updated }));
    return true;
  }

  // ── POST /__admin_ollama/start ──────────────────────────
  if (method === 'POST' && url === '/__admin_ollama/start') {
    // Check if already running
    try {
      const check = await fetch(`${OLLAMA_BASE}/`, { signal: AbortSignal.timeout(500) });
      if (check.ok) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, alreadyRunning: true }));
        return true;
      }
    } catch { /* not running, continue */ }

    try {
      _ollamaProc = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
      _ollamaProc.unref();

      const ready = await waitForOllama(5000);
      if (ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, started: true }));
      } else {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Ollama process spawned but did not become ready within 5s' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_ollama/stop ───────────────────────────
  if (method === 'POST' && url === '/__admin_ollama/stop') {
    try {
      if (_ollamaProc && !_ollamaProc.killed) {
        // We started it — kill our handle
        _ollamaProc.kill();
        _ollamaProc = null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, method: 'kill-owned' }));
      } else {
        // External process — use taskkill on Windows
        const killer = spawn('taskkill', ['/IM', 'ollama.exe', '/F'], { shell: true });
        killer.on('close', (code) => {
          if (code === 0) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, method: 'taskkill' }));
          } else {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `taskkill exited with code ${code}` }));
          }
        });
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
    }
    return true;
  }

  // ── POST /__admin_exec/ollama-chat (SSE — CC format) ────
  if (method === 'POST' && url === '/__admin_exec/ollama-chat') {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }

    const config = readJsonFile<OllamaConfig>('ollama-config.json', DEFAULT_CONFIG);
    const model = await resolveModel(body['model'], config);

    if (!model) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No model available. Install a model or set defaultModel in config.' }));
      return true;
    }

    const messages = Array.isArray(body['messages']) ? body['messages'] : [];
    if (body['prompt'] && messages.length === 0) {
      messages.push({ role: 'user', content: String(body['prompt']) });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      const upstream = await ollamaFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: true }),
      });

      const reader = upstream.body?.getReader();
      if (!reader) {
        res.write(formatSSE('exit', { code: 1, error: 'No response body from Ollama' }));
        res.end();
        return true;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let finalStats: Record<string, unknown> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as {
              message?: { content?: string };
              done?: boolean;
              total_duration?: number;
              eval_count?: number;
              [key: string]: unknown;
            };
            if (parsed.done) {
              // Capture final stats for the exit event
              finalStats = { ...parsed };
            } else if (parsed.message?.content !== undefined) {
              res.write(formatSSE('stdout', { line: parsed.message.content }));
            }
          } catch { /* skip malformed lines */ }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as {
            message?: { content?: string };
            done?: boolean;
            [key: string]: unknown;
          };
          if (parsed.message?.content !== undefined && !parsed.done) {
            res.write(formatSSE('stdout', { line: parsed.message.content }));
          }
          if (parsed.done) {
            finalStats = { ...parsed };
          }
        } catch { /* skip */ }
      }

      res.write(formatSSE('exit', { code: 0, model, ...finalStats }));
    } catch (err) {
      res.write(formatSSE('exit', { code: 1, error: safeError(err) }));
    }

    res.end();
    return true;
  }

  // ── POST /__admin_exec/ollama-vision (SSE — NDJSON image) ──
  if (method === 'POST' && url === '/__admin_exec/ollama-vision') {
    let body: Record<string, unknown>;
    try {
      body = await parseBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return true;
    }

    const image = body['image'];
    const prompt = body['prompt'];
    const model = typeof body['model'] === 'string' && body['model'].trim()
      ? body['model'].trim()
      : 'qwen2.5-vl:7b';

    if (typeof image !== 'string' || !image) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'image (base64 string) is required' }));
      return true;
    }

    if (typeof prompt !== 'string' || !prompt) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'prompt is required' }));
      return true;
    }

    try {
      const upstream = await ollamaFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, images: [image], stream: true }),
      });

      if (!upstream.ok) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Ollama returned ' + upstream.status }));
        return true;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const reader = upstream.body?.getReader();
      if (!reader) {
        res.write(formatSSE('exit', { code: 1, error: 'No response body from Ollama' }));
        res.end();
        return true;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          res.write(`data: ${trimmed}\n\n`);
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        res.write(`data: ${buffer.trim()}\n\n`);
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeError(err) }));
      return true;
    }

    res.end();
    return true;
  }

  return false;
}
