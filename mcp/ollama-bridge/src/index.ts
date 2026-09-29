#!/usr/bin/env node

/**
 * Ollama Bridge MCP Server
 *
 * Exposes local Ollama models (Qwen3 14B/8B) as MCP tools for Claude Code.
 * Reads role/config from the Luminal admin dashboard's ollama-config.json.
 *
 * Tools:
 *   qwen_chat        — Send a prompt, get a response (core orchestration tool)
 *   qwen_status      — Server health, loaded models, VRAM, config
 *   qwen_models      — List/pull/delete/load/unload models
 *   ollama_server     — Start/stop the Ollama daemon
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

// ── Path resolution ──────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// mcp/ollama-bridge/src → mcp/ollama-bridge → mcp → repo root
const ROOT = resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = resolve(ROOT, 'admin', 'data', 'ollama-config.json');

const OLLAMA_BASE = 'http://localhost:11434';
const TOTAL_VRAM_BYTES = 12 * 1024 * 1024 * 1024; // 12 GB RTX 4070 Super

// ── Config ───────────────────────────────────────────────

interface OllamaConfig {
  roles: Record<string, string>;
  defaultModel: string | null;
  presets: Array<{ name: string; label: string; role: string; description: string }>;
  serverAutoStart: boolean;
}

const DEFAULT_CONFIG: OllamaConfig = {
  roles: {},
  defaultModel: null,
  presets: [
    { name: 'qwen3:14b', label: 'Qwen3 14B', role: 'primary', description: 'Best balance of quality and speed' },
    { name: 'qwen3:8b', label: 'Qwen3 8B', role: 'fast', description: 'Fast utility model' },
  ],
  serverAutoStart: false,
};

function loadConfig(): OllamaConfig {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as OllamaConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

// ── Ollama API helpers ───────────────────────────────────

async function ollamaFetch(path: string, opts?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`${OLLAMA_BASE}${path}`, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await ollamaFetch('/');
    return res.ok;
  } catch {
    return false;
  }
}

async function getVersion(): Promise<string | null> {
  try {
    const res = await ollamaFetch('/api/version');
    if (!res.ok) return null;
    return ((await res.json()) as { version: string }).version;
  } catch {
    return null;
  }
}

interface LoadedModel {
  name: string;
  size_vram: number;
  details: { family: string; parameter_size: string; quantization_level: string };
  expires_at: string;
}

async function getLoadedModels(): Promise<LoadedModel[]> {
  try {
    const res = await ollamaFetch('/api/ps');
    if (!res.ok) return [];
    const data = (await res.json()) as { models: LoadedModel[] };
    return data.models ?? [];
  } catch {
    return [];
  }
}

interface InstalledModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
}

async function getInstalledModels(): Promise<InstalledModel[]> {
  try {
    const res = await ollamaFetch('/api/tags');
    if (!res.ok) return [];
    const data = (await res.json()) as { models: InstalledModel[] };
    return data.models ?? [];
  } catch {
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
}

/**
 * Resolve which model to use. Priority:
 * 1. Explicit model argument
 * 2. Config: model with 'primary' role
 * 3. Config: defaultModel
 * 4. First loaded model
 * 5. First installed model
 */
async function resolveModel(explicit?: string, role?: string): Promise<string | null> {
  if (explicit) return explicit;

  const config = loadConfig();
  const targetRole = role ?? 'primary';

  // Check role assignments
  const roleMatch = Object.entries(config.roles).find(([, r]) => r === targetRole);
  if (roleMatch) return roleMatch[0];

  // Check presets for role
  const presetMatch = config.presets.find(p => p.role === targetRole);
  if (presetMatch) {
    // Verify it's actually installed
    const installed = await getInstalledModels();
    if (installed.some(m => m.name === presetMatch.name)) return presetMatch.name;
  }

  if (config.defaultModel) return config.defaultModel;

  // Fallback: first loaded, then first installed
  const loaded = await getLoadedModels();
  if (loaded.length > 0) return loaded[0].name;

  const installed = await getInstalledModels();
  if (installed.length > 0) return installed[0].name;

  return null;
}

// ── Tool implementations ──────────────────────────────��──

async function handleQwenChat(args: Record<string, unknown>): Promise<string> {
  const prompt = String(args.prompt ?? '');
  if (!prompt) return JSON.stringify({ error: 'Missing required parameter: prompt' });

  const running = await isOllamaRunning();
  if (!running) {
    return JSON.stringify({
      error: 'Ollama is not running. Use the ollama_server tool with action "start" first.',
    });
  }

  const requestedRole = args.role as string | undefined;
  const model = await resolveModel(args.model as string | undefined, requestedRole);
  if (!model) {
    return JSON.stringify({
      error: 'No models available. Pull a model first using qwen_models with action "pull".',
    });
  }

  const system = args.system as string | undefined;
  const temperature = args.temperature as number | undefined;

  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  if (temperature !== undefined) {
    body.options = { temperature };
  }

  const startTime = Date.now();
  try {
    const controller = new AbortController();
    // 5 minute timeout for long generations
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      return JSON.stringify({ error: `Ollama error (${res.status}): ${errText}` });
    }

    const data = (await res.json()) as {
      message: { content: string };
      total_duration?: number;
      eval_count?: number;
      prompt_eval_count?: number;
    };

    const durationMs = Date.now() - startTime;
    const tokensPerSec = data.eval_count && data.total_duration
      ? ((data.eval_count / (data.total_duration / 1e9))).toFixed(1)
      : null;

    return JSON.stringify({
      response: data.message.content,
      model,
      duration_ms: durationMs,
      eval_count: data.eval_count ?? null,
      prompt_eval_count: data.prompt_eval_count ?? null,
      tokens_per_sec: tokensPerSec,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return JSON.stringify({ error: 'Request timed out (5 minute limit)' });
    }
    return JSON.stringify({ error: `Request failed: ${String(e)}` });
  }
}

async function handleQwenStatus(): Promise<string> {
  const running = await isOllamaRunning();
  const version = running ? await getVersion() : null;
  const loaded = running ? await getLoadedModels() : [];
  const installed = running ? await getInstalledModels() : [];
  const config = loadConfig();

  const totalVramUsed = loaded.reduce((sum, m) => sum + m.size_vram, 0);

  return JSON.stringify({
    running,
    version,
    installed_count: installed.length,
    loaded_count: loaded.length,
    vram_used: totalVramUsed > 0 ? formatBytes(totalVramUsed) : '0',
    vram_total: formatBytes(TOTAL_VRAM_BYTES),
    vram_pct: totalVramUsed > 0 ? Math.round((totalVramUsed / TOTAL_VRAM_BYTES) * 100) : 0,
    installed: installed.map(m => ({
      name: m.name,
      size: formatBytes(m.size),
      role: config.roles[m.name] ?? 'none',
    })),
    loaded: loaded.map(m => ({
      name: m.name,
      vram: formatBytes(m.size_vram),
      params: m.details?.parameter_size ?? 'unknown',
      quant: m.details?.quantization_level ?? 'unknown',
      expires: m.expires_at,
    })),
    config: {
      roles: config.roles,
      defaultModel: config.defaultModel,
      presets: config.presets.map(p => `${p.name} (${p.role})`),
    },
  });
}

async function handleQwenModels(args: Record<string, unknown>): Promise<string> {
  const action = String(args.action ?? 'list');
  const model = args.model as string | undefined;

  switch (action) {
    case 'list': {
      const running = await isOllamaRunning();
      if (!running) return JSON.stringify({ error: 'Ollama is not running' });

      const installed = await getInstalledModels();
      const loaded = await getLoadedModels();
      const config = loadConfig();
      const loadedNames = new Set(loaded.map(m => m.name));

      return JSON.stringify({
        models: installed.map(m => ({
          name: m.name,
          size: formatBytes(m.size),
          loaded: loadedNames.has(m.name),
          role: config.roles[m.name] ?? 'none',
          vram: loaded.find(l => l.name === m.name)
            ? formatBytes(loaded.find(l => l.name === m.name)!.size_vram)
            : null,
        })),
      });
    }

    case 'pull': {
      if (!model) return JSON.stringify({ error: 'Missing model name for pull' });
      const running = await isOllamaRunning();
      if (!running) return JSON.stringify({ error: 'Ollama is not running' });

      try {
        const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model, stream: false }),
        });

        if (!res.ok) {
          return JSON.stringify({ error: `Pull failed: ${await res.text()}` });
        }

        const data = (await res.json()) as { status: string };
        return JSON.stringify({ ok: true, status: data.status, model });
      } catch (e) {
        return JSON.stringify({ error: `Pull failed: ${String(e)}` });
      }
    }

    case 'delete': {
      if (!model) return JSON.stringify({ error: 'Missing model name for delete' });
      try {
        const res = await ollamaFetch('/api/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model }),
        });
        return JSON.stringify({ ok: res.ok, model });
      } catch (e) {
        return JSON.stringify({ error: `Delete failed: ${String(e)}` });
      }
    }

    case 'load': {
      if (!model) return JSON.stringify({ error: 'Missing model name for load' });
      try {
        const res = await ollamaFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [], keep_alive: '10m' }),
        });
        return JSON.stringify({ ok: res.ok, action: 'loaded', model });
      } catch (e) {
        return JSON.stringify({ error: `Load failed: ${String(e)}` });
      }
    }

    case 'unload': {
      if (!model) return JSON.stringify({ error: 'Missing model name for unload' });
      try {
        const res = await ollamaFetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
        });
        return JSON.stringify({ ok: res.ok, action: 'unloaded', model });
      } catch (e) {
        return JSON.stringify({ error: `Unload failed: ${String(e)}` });
      }
    }

    case 'show': {
      if (!model) return JSON.stringify({ error: 'Missing model name for show' });
      try {
        const res = await ollamaFetch('/api/show', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model }),
        });
        const data = await res.json();
        return JSON.stringify(data);
      } catch (e) {
        return JSON.stringify({ error: `Show failed: ${String(e)}` });
      }
    }

    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Use list, pull, delete, load, unload, or show.` });
  }
}

async function handleOllamaServer(args: Record<string, unknown>): Promise<string> {
  const action = String(args.action ?? 'status');

  switch (action) {
    case 'status': {
      const running = await isOllamaRunning();
      const version = running ? await getVersion() : null;
      return JSON.stringify({ running, version });
    }

    case 'start': {
      const alreadyRunning = await isOllamaRunning();
      if (alreadyRunning) {
        const version = await getVersion();
        return JSON.stringify({ ok: true, already_running: true, version });
      }

      const proc = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
      proc.unref();

      // Wait up to 8 seconds for startup
      for (let i = 0; i < 16; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await isOllamaRunning()) {
          const version = await getVersion();
          return JSON.stringify({ ok: true, started: true, version, pid: proc.pid });
        }
      }

      return JSON.stringify({ ok: false, error: 'Ollama started but not responding after 8 seconds' });
    }

    case 'stop': {
      const running = await isOllamaRunning();
      if (!running) return JSON.stringify({ ok: true, already_stopped: true });

      try {
        // Windows: taskkill
        if (process.platform === 'win32') {
          spawn('taskkill', ['/IM', 'ollama.exe', '/F'], { shell: true, stdio: 'ignore' });
        } else {
          spawn('pkill', ['-f', 'ollama serve'], { stdio: 'ignore' });
        }

        // Wait for shutdown
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 500));
          if (!(await isOllamaRunning())) {
            return JSON.stringify({ ok: true, stopped: true });
          }
        }
        return JSON.stringify({ ok: false, error: 'Stop signal sent but Ollama still running' });
      } catch (e) {
        return JSON.stringify({ error: `Stop failed: ${String(e)}` });
      }
    }

    default:
      return JSON.stringify({ error: `Unknown action: ${action}. Use status, start, or stop.` });
  }
}

// ── MCP Server ───────────────────────────────────────────

const server = new Server(
  {
    name: 'ollama-bridge',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ── Tool definitions ─────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'qwen_chat',
      description: [
        'Send a prompt to a local Qwen model via Ollama and get a response.',
        'Use for offloading simple tasks: boilerplate generation, code transforms,',
        'summaries, formatting, quick lookups. The model runs locally — no API cost,',
        'no rate limits, no data leaves the machine.',
        '',
        'Model resolution: explicit model > config "primary" role > default > first installed.',
        'Use role="fast" to select the fast model (Qwen3 8B) for simpler tasks.',
      ].join('\n'),
      inputSchema: {
        type: 'object' as const,
        properties: {
          prompt: {
            type: 'string',
            description: 'The prompt to send to the model',
          },
          model: {
            type: 'string',
            description: 'Specific model name (e.g. "qwen3:14b"). If omitted, resolves from config roles.',
          },
          role: {
            type: 'string',
            enum: ['primary', 'fast', 'specialized'],
            description: 'Select model by role instead of name. "primary" (default) = strongest, "fast" = quickest.',
          },
          system: {
            type: 'string',
            description: 'System prompt to set the model\'s behavior (e.g. "You are a TypeScript expert. Return only code, no explanation.")',
          },
          temperature: {
            type: 'number',
            description: 'Sampling temperature (0.0 = deterministic, 1.0 = creative). Default: model default (~0.7).',
          },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'qwen_status',
      description: [
        'Check Ollama server health, installed/loaded models, VRAM usage, and config.',
        'Call this before qwen_chat if unsure whether Ollama is running or models are loaded.',
        'Returns: running state, version, model list with roles, VRAM usage percentage.',
      ].join('\n'),
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'qwen_models',
      description: [
        'Manage Ollama models: list, pull, delete, load into VRAM, unload from VRAM, show info.',
        'Actions: "list" (default), "pull", "delete", "load", "unload", "show".',
        'Pull downloads a model from the Ollama registry. Load/unload controls VRAM.',
      ].join('\n'),
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'pull', 'delete', 'load', 'unload', 'show'],
            description: 'Model management action',
          },
          model: {
            type: 'string',
            description: 'Model name (required for pull, delete, load, unload, show)',
          },
        },
      },
    },
    {
      name: 'ollama_server',
      description: [
        'Control the Ollama server daemon: check status, start, or stop.',
        'Start spawns "ollama serve" as a detached process and waits for it to be ready.',
        'Stop kills the process (taskkill on Windows, pkill on Unix).',
      ].join('\n'),
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'start', 'stop'],
            description: 'Server action (default: "status")',
          },
        },
      },
    },
  ],
}));

// ── Tool dispatch ────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const toolArgs = (args ?? {}) as Record<string, unknown>;

  let result: string;

  switch (name) {
    case 'qwen_chat':
      result = await handleQwenChat(toolArgs);
      break;
    case 'qwen_status':
      result = await handleQwenStatus();
      break;
    case 'qwen_models':
      result = await handleQwenModels(toolArgs);
      break;
    case 'ollama_server':
      result = await handleOllamaServer(toolArgs);
      break;
    default:
      result = JSON.stringify({ error: `Unknown tool: ${name}` });
  }

  return {
    content: [{ type: 'text', text: result }],
  };
});

// ── Start ─────────────────────────────────────���──────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`MCP server error: ${String(e)}\n`);
  process.exit(1);
});
